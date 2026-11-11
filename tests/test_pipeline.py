"""Regression checks for scientific categories, unique counts, and failed lookups."""
import csv
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch, Mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import pandas as pd
import classification as c
import refresh_data as pipeline
import compute_omc as omc
import compute_rr_status as rr
import rebuild_cached_citations as rebuild

class PipelineTests(unittest.TestCase):
    def test_qualified_success_and_reproduction_dimensions(self):
        self.assertEqual(c.classify_outcome('statistically successful but flawed'),'qualified')
        self.assertEqual(c.classify_outcome('successful'),'successful')
        self.assertEqual(c.classify_outcome('uncoded'),'other')
        for raw,expected in [
            ('computationally reproducible, robustness challenges',('successful','challenges')),
            ('technical failure, not checked',('technical_failure','not_checked')),
            ('not checked, robust',('not_checked','robust')),
            ('NA',(None,None)),
        ]:
            self.assertEqual(c.parse_reproduction_outcome(raw),expected)

    def test_venue_evidence_does_not_infer_peer_review(self):
        self.assertEqual(c.classify_venue(None),'unknown')
        self.assertEqual(c.classify_venue(float('nan')),'unknown')
        self.assertEqual(c.classify_venue('Digital Library of Theses and Dissertations, Universidade de São Paulo'),'thesis')
        self.assertEqual(c.classify_venue('Proceedings of the annual conference'),'conference')
        self.assertEqual(c.classify_venue('SSRN Electronic Journal'),'preprint')
        self.assertEqual(c.VENUE_LABELS[c.classify_venue('An unfamiliar venue')],'Other named venue')

    def test_timeline_partitions_unique_citing_works(self):
        frame=pd.DataFrame([dict(doi_o='10.test/original',doi_r=f'10.test/{outcome}',outcome=outcome,
            title_o='Original',author_o='Author',year_o=2010,journal_o='Venue',title_r='Repetition',
            author_r='Author',year_r=2015,pub_status='individual') for outcome in ['failed','mixed']])
        lists={'10.test/original':[{'citing':'one','year':2016},{'citing':'both','year':2016},{'citing':'both','year':2016},{'citing':'neither','year':2016}],
               '10.test/failed':[{'citing':'one','year':2016},{'citing':'both','year':2016}],
               '10.test/mixed':[{'citing':'both','year':2016}]}
        with patch.object(pipeline,'fetch_oc_citations',side_effect=lambda doi:lists[doi]), patch.object(pipeline,'should_stop',return_value=False):
            result=pipeline.build_study_data(frame)['10.test/original']
        self.assertEqual(result['n_citations'],3)
        self.assertEqual(result['n_cocitations'],2)
        self.assertEqual(result['timeline'],[dict(year=2016,only=1,with_successful=0,with_failed=1,with_mixed=0,with_multiple=1,with_any=2)])

    def test_failed_reproduction_lookup_cannot_be_reported_as_zero(self):
        frame=pd.DataFrame([dict(doi_o='10.test/original',doi_r='10.test/reproduction',computational_bucket='successful',robustness_bucket='robust')])
        with patch.object(pipeline,'fetch_oc_citations',return_value=None):
            with self.assertRaisesRegex(RuntimeError,'retaining previous'):
                pipeline.compute_reproduction_citations(frame)

    def test_shared_reproduction_report_is_counted_once(self):
        frame=pd.DataFrame([dict(doi_o=f'10.test/{i}',doi_r='10.test/reproduction',computational_bucket='successful',robustness_bucket='robust') for i in [1,2]])
        with patch.object(pipeline,'fetch_oc_citations',return_value=[{'citing':'one','year':2020}]), patch.object(pipeline,'oc_entity_ids',side_effect=lambda doi:{'doi:'+doi}):
            data=pipeline.compute_reproduction_citations(frame)['reproduction-numerical']['successful']
        self.assertEqual(data['n_citations_to_reproduction'],1)
        self.assertEqual(data['n_citations_to_original'],2)

    def test_empty_run_preserves_committed_outputs(self):
        before=(ROOT/'data/meta.json').read_bytes()
        with self.assertRaisesRegex(RuntimeError,'retaining the previous'):
            pipeline.write_outputs({},pd.DataFrame(),partial=True)
        self.assertEqual((ROOT/'data/meta.json').read_bytes(),before)

    def test_journal_matching_rejects_generic_overlap_and_old_cache_hits(self):
        for query, candidate in [
            ('Journal of Clinical Psychology','Journal of Cognitive Psychology'),
            ('Intelligence','IEEE Transactions on Pattern Analysis and Machine Intelligence'),
            ('Brain','Brain Research'), ('Climate','Journal of Climate'),
            ('Educational Psychology','Journal of Educational Psychology'), ('Journal of Personality','Journal of Personality and Social Psychology'),
        ]:
            self.assertFalse(omc.names_match(query,candidate))
        for query,candidate in [('Journal of Clinical Psychology','journal of clinical psychology'),
                                ('The Journal of Neuroscience','Journal of Neuroscience')]:
            self.assertTrue(omc.names_match(query,candidate))
        with tempfile.TemporaryDirectory() as tmp:
            cache=Path(tmp)/'cache.json'
            cache.write_text(json.dumps({'brain':{'display_name':'Brain Research'},'missing':None}))
            with patch.object(omc,'CACHE_FILE',cache):
                self.assertEqual(omc.load_cache(),{'missing':None})

    def test_enrichment_budget_preserves_outputs_and_saves_cache(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp)
            source=folder/'flora.csv'; source.write_text('journal_o\nNew Journal\n')
            output=folder/'flora_with_omc.csv'; output.write_text('previous complete CSV')
            meta=folder/'flora_with_omc_meta.json'; meta.write_text('previous metadata')
            with patch.object(omc,'IN_CSV',source), patch.object(omc,'OUT_CSV',output), \
                 patch.object(omc,'DATA_DIR',folder), patch.object(omc,'load_cache',return_value={}), \
                 patch.object(omc,'save_cache') as save, patch.object(omc,'should_stop',return_value=True):
                with self.assertRaisesRegex(SystemExit,'previous enrichment outputs retained'):
                    omc.main()
                save.assert_called_once_with({})
            self.assertEqual(output.read_text(),'previous complete CSV')
            self.assertEqual(meta.read_text(),'previous metadata')

    def test_report_keys_merge_doi_variants_before_counting_targets(self):
        rows=[(report,target) for report in ['10.test/report','https://doi.org/10.test/REPORT','doi:10.test/report']
              for target in ['10.test/a','https://doi.org/10.test/a','10.test/b','10.test/c']]
        targets={}
        for report,target in rows:
            targets.setdefault(c.reference_key(report),set()).add(c.reference_key(target))
        self.assertEqual(targets,{'10.test/report':{'10.test/a','10.test/b','10.test/c'}})
        self.assertFalse(len(targets['10.test/report'])>c.MULTI_TARGET_THRESHOLD)
        self.assertEqual(c.reference_key(float('nan'),' HTTPS://EXAMPLE.ORG/REPORT '),'https://example.org/report')
        self.assertIsNone(c.reference_key(None,None))

    def test_rrdb_rejects_invalid_inputs_before_replacing_outputs(self):
        with tempfile.TemporaryDirectory() as tmp:
            output=Path(tmp)/'data.json'; output.write_text('previous data')
            meta=Path(tmp)/'meta.json'; meta.write_text('previous metadata')
            for text in ['error\nService unavailable\n','DOI,title\n,\n','DOI,title,itemType\n10.test/a,Attachment,attachment\n']:
                response=Mock(text=text)
                with patch.object(rr.requests,'get',return_value=response), patch.object(rr,'OUT_DATA',output), patch.object(rr,'OUT_META',meta):
                    with self.assertRaises(ValueError): rr.main()
                self.assertEqual(output.read_text(),'previous data')
                self.assertEqual(meta.read_text(),'previous metadata')
            with patch.object(rr.requests,'get',return_value=Mock(text='DOI,title\nhttps://doi.org/10.test/A,Example title\n')):
                self.assertEqual(rr.fetch_rr_library(),({'10.test/a'},{'exampletitle'}))

    def test_cache_rebuild_preserves_report_size_outside_surviving_cohort(self):
        previous={'studies':{'one':dict(doi='one',title='O',author='A',year=2010,venue='',replications=[
            dict(doi='report',title='R',author='B',year=2015,outcome='failed',pub_status='large_project')])}}
        frame=rebuild.cohort_frame(previous)
        self.assertEqual(frame['pub_status'].tolist(),['large_project'])
        self.assertEqual(frame.doi_o.nunique(),1)

    def test_reproduction_budget_is_checked_between_lookups(self):
        frame=pd.DataFrame([dict(doi_o='original',doi_r='report',computational_bucket='successful',robustness_bucket='robust')])
        with patch.object(pipeline,'should_stop',side_effect=[False,True]), patch.object(pipeline,'fetch_oc_citations',return_value=[]) as fetch:
            with self.assertRaisesRegex(RuntimeError,'Time budget exhausted'):
                pipeline.compute_reproduction_citations(frame)
            fetch.assert_called_once_with('report')
        with patch.object(pipeline,'read_cache',return_value=None), patch.object(pipeline,'should_stop',side_effect=[False,True]), \
             patch.object(pipeline.session,'get',side_effect=pipeline.requests.exceptions.Timeout) as request, patch.object(pipeline.time,'sleep') as sleep:
            self.assertIsNone(pipeline.fetch_oc_citations('10.test/budget'))
            request.assert_called_once(); sleep.assert_not_called()
        with patch.object(pipeline,'read_cache',return_value=[]), patch.object(pipeline,'should_stop',return_value=True):
            self.assertEqual(pipeline.fetch_oc_citations('10.test/cached'),[])

    def test_mean_citedness_counts_reconcile_with_enriched_csv(self):
        with (ROOT/'data/flora_with_omc.csv').open() as source:
            rows=list(csv.DictReader(source))
        eligible=[r for r in rows if r.get('impact_factor') and float(r['impact_factor'])<35]
        rep=[r for r in eligible if 'replication' in r['type'].lower() and 'reproduc' not in r['type'].lower()]
        result=json.loads((ROOT/'data/impact_factor_data.json').read_text())
        self.assertEqual(result['overview']['n_total'],len(rep))
        reproductions=json.loads((ROOT/'data/impact_factor_reproductions.json').read_text())
        repro=[c.parse_reproduction_outcome(r['outcome']) for r in eligible if 'reproduc' in r['type'].lower()]
        for index,kind,buckets in [(0,'reproduction-numerical',{'successful','issues','technical_failure'}),(1,'reproduction-robustness',{'robust','challenges'})]:
            self.assertEqual(reproductions[kind]['overview']['n_total'],sum(d[index] in buckets for d in repro))

    def test_reproduction_outcome_sheet_rejects_malformed_or_unusable_records(self):
        header='validation,doi_r,outcome_computational,outcome_robustness\n'
        for text in ['error\nUnavailable\n',header,header+',10.test/a,,\n',header+'validated - discarded,10.test/a,computationally reproducible,robust\n']:
            with patch.object(pipeline.requests,'get',return_value=Mock(text=text)):
                with self.assertRaises(ValueError): pipeline.fetch_reproduction_outcomes()
        with patch.object(pipeline.requests,'get',return_value=Mock(text=header+',https://doi.org/10.test/a,computationally reproducible,\n')):
            self.assertEqual(pipeline.fetch_reproduction_outcomes(),{'10.test/a':'computationally reproducible, '})

    def test_merged_reproduction_dois_are_not_cocitations(self):
        frame=pd.DataFrame([dict(doi_o='original',doi_r='report',computational_bucket='successful',robustness_bucket='robust')])
        for ids,expected in [({'doi:original','doi:report','omid:br/one'},0),({'doi:original','omid:br/one'},1)]:
            with patch.object(pipeline,'fetch_oc_citations',return_value=[{'citing':'shared','year':2020}]), patch.object(pipeline,'oc_entity_ids',return_value=ids) as fetch:
                result=pipeline.compute_reproduction_citations(frame)
                self.assertEqual(result['reproduction-numerical']['successful']['n_cocitations'],expected)
                self.assertEqual(result['reproduction-robustness']['robust']['n_cocitations'],expected)
                fetch.assert_called_once_with('original')
        with patch.object(pipeline,'fetch_oc_citations',return_value=[{'citing':'shared','year':2020}]), patch.object(pipeline,'oc_entity_ids',return_value=set()):
            with self.assertRaisesRegex(RuntimeError,'Cannot verify merged'):
                pipeline.compute_reproduction_citations(frame)

    def citation_fixture(self):
        study = dict(doi='10.test/original', title='Original', author='A', year=2020, venue='Venue',
            n_citations=3, n_citations_post_first_rep=3, n_cocitations=2, n_replications=1,
            outcome_mix={'failed':1}, pubstatus_mix={'individual':1},
            first_replication_year=2021, first_replication_outcome='failed',
            timeline=[dict(year=2021,only=1,with_failed=2,with_mixed=0,with_successful=0,with_multiple=0,with_any=2)],
            replications=[dict(doi='10.test/report',title='Report',author='B',year=2021,outcome='failed',pub_status='individual')],
            cocit_by_outcome={'failed':2},n_citations_post_by_outcome={'failed':3},
            cocit_by_pubstatus={'individual':2},n_citations_post_by_pubstatus={'individual':3})
        previous={'studies':{study['doi']:study}}
        return previous, rebuild.cohort_frame(previous)

    def assert_withheld(self, aggregate):
        for group in aggregate.values():
            for key in ['citations_model','cocitations_model']:
                model=group[key]
                self.assertEqual(model['status'],'withheld_pending_reestimation')
                for field in ['event_time','estimate','ci_low','ci_high']:
                    self.assertEqual(model[field],[])
                for field in ['att','att_ci','n_units']:
                    self.assertIsNone(model[field])

    def test_writes_withhold_models_and_preserve_descriptive_records(self):
        previous,frame=self.citation_fixture()
        with tempfile.TemporaryDirectory() as tmp, patch.object(pipeline,'DATA_DIR',Path(tmp)), \
             patch.object(pipeline,'event_study',side_effect=AssertionError('Must not fit withdrawn models')) as fit:
            pipeline.write_outputs(previous['studies'],frame)
            aggregate=json.loads((Path(tmp)/'aggregate.json').read_text())
            self.assert_withheld(aggregate)
            expected=pipeline.descriptive_trajectory(pipeline.build_panel(previous['studies']),['failed'])
            self.assertEqual(aggregate['failed']['descriptive'],expected)
            written=json.loads((Path(tmp)/'originals.json').read_text())
            self.assertEqual(written['studies'],previous['studies'])
            self.assertEqual(len(json.loads((Path(tmp)/'originals_index.json').read_text())),1)
            fit.assert_not_called()

    def test_cache_rebuild_preserves_snapshot_denominators_and_exclusions(self):
        previous,frame=self.citation_fixture()
        meta=dict(last_updated='2026-10-19T00:00:00Z',n_originals=1,n_replications=7,
            outcome_counts={'failed':5,'mixed':2},partial_run=True,originals_skipped=2,
            exclusions={'10.test/missing':'lookup failed'},input_snapshot='source-hash')
        with tempfile.TemporaryDirectory() as tmp, patch.object(pipeline,'DATA_DIR',Path(tmp)), \
             patch.object(pipeline,'event_study',side_effect=AssertionError('Must not fit withdrawn models')) as fit, \
             patch.object(pipeline,'build_study_data',return_value=previous['studies']), \
             patch.object(pipeline,'cache_path',return_value=Path(tmp)/'cache.json'), \
             patch.object(pipeline,'fetch_oc_citations'), patch.object(pipeline,'oc_entity_ids'), patch.object(pipeline.session,'get'):
            (Path(tmp)/'originals.json').write_text(json.dumps(previous))
            (Path(tmp)/'meta.json').write_text(json.dumps(meta))
            (Path(tmp)/'cache.json').write_text('[]')
            rebuild.main()
            rebuilt=json.loads((Path(tmp)/'meta.json').read_text())
            for key,value in meta.items():
                self.assertEqual(rebuilt[key],value,key)
            self.assertIn('recalculated_at',rebuilt)
            self.assert_withheld(json.loads((Path(tmp)/'aggregate.json').read_text()))
            fit.assert_not_called()

    def test_sanitise_models_only_leaves_descriptive_arrays_and_metadata_unchanged(self):
        aggregate={label:dict(descriptive={'event_time':[0,1],'mean_citations':[2,3],'n_units':[4,2]},
            citations_model={'att':0.2393,'estimate':[0.1]},cocitations_model={'att':0.1})
            for label in ['all','failed','successful','mixed']}
        with tempfile.TemporaryDirectory() as tmp, patch.object(pipeline,'DATA_DIR',Path(tmp)), \
             patch.object(pipeline.session,'get',side_effect=AssertionError('No network')):
            (Path(tmp)/'aggregate.json').write_text(json.dumps(aggregate))
            (Path(tmp)/'meta.json').write_text('unchanged coverage date')
            rebuild.withhold_models()
            result=json.loads((Path(tmp)/'aggregate.json').read_text())
            self.assert_withheld(result)
            for label in aggregate:
                self.assertEqual(result[label]['descriptive'],aggregate[label]['descriptive'])
            self.assertEqual((Path(tmp)/'meta.json').read_text(),'unchanged coverage date')
        self.assert_withheld(json.loads((ROOT/'data/aggregate.json').read_text()))

    def test_original_lookup_failure_is_omitted_but_genuine_zero_is_retained(self):
        _,frame=self.citation_fixture()
        for original_citations,replication_citations,included in [(None,[],False),([],None,False),([],[],True)]:
            stats=dict(originals_skipped=0,originals_errored=0,rep_fetch_error_dois=[])
            with patch.object(pipeline,'RUN_STATS',stats), patch.object(pipeline,'should_stop',return_value=False), \
                 patch.object(pipeline,'fetch_oc_citations',side_effect=lambda doi:original_citations if doi=='10.test/original' else replication_citations):
                studies=pipeline.build_study_data(frame)
            self.assertEqual(len(studies),int(included))
            if included:
                self.assertEqual(studies['10.test/original']['n_citations'],0)
                self.assertEqual(studies['10.test/original']['n_cocitations'],0)
            else:
                self.assertEqual(stats['originals_skipped']+stats['originals_errored'],1)

    def test_retained_cohort_rules_and_overlapping_rates(self):
        base=dict(doi_o='10.test/a',doi_r='10.test/r',type='replication',outcome='failed',journal_r='')
        rows=[base,dict(base),dict(base,outcome='mixed'),dict(base,doi_r=None),
              dict(base,doi_o=None),dict(base,doi_r='qualified',outcome='statistically successful but flawed'),
              dict(base,doi_r='reproduction',type='reproduction'),dict(base,doi_r='mixed',outcome='mixed')]
        frame=pipeline.filter_replications(pd.DataFrame(rows))
        self.assertEqual(frame[['doi_r','outcome']].values.tolist(),[['10.test/r','failed'],['mixed','mixed']])
        previous,_=self.citation_fixture()
        study=previous['studies']['10.test/original']
        study['outcome_mix']['mixed']=1
        study['cocit_by_outcome']['mixed']=1
        study['n_citations_post_by_outcome']['mixed']=2
        rates=pipeline.compute_cocit_breakdown(previous['studies'])['outcome']
        self.assertEqual(rates['failed']['n_originals'],1)
        self.assertEqual(rates['mixed']['n_originals'],1)
        self.assertEqual(rates['failed']['mean_rate'],0.6667)
        self.assertEqual(rates['mixed']['mean_rate'],0.5)
        study['n_citations_post_by_outcome']['mixed']=0
        rates=pipeline.compute_cocit_breakdown(previous['studies'])['outcome']
        self.assertEqual(rates['mixed']['n_originals'],0)
        self.assertIsNone(rates['mixed']['mean_rate'])

if __name__=='__main__':
    unittest.main()
