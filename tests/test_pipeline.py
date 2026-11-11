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
        self.assertEqual(c.classify_outcome('uncoded'),'unrecognised')
        for raw,expected in [
            ('computationally reproducible, robustness challenges',('successful','challenges')),
            ('technical failure, not checked',('technical_failure','not_checked')),
            ('not checked, robust',('not_checked','robust')),
            ('NA',('missing','missing')),
        ]:
            self.assertEqual(c.parse_reproduction_outcome(raw),expected)

    def test_shared_outcome_cases_and_r_replication_classifier(self):
        cases=json.loads((ROOT/'tests/fixtures/outcome-vocabulary.json').read_text())
        for case in cases:
            with self.subTest(case=case):
                self.assertEqual(c.classify_outcome(case['raw'],case['dimension']),case['key'])
        import shutil
        import subprocess
        if not shutil.which('Rscript'):
            self.skipTest('Rscript is unavailable; Python cases passed')
        code = """library(jsonlite)
root <- normalizePath('.')
source('scripts/outcome_vocabulary.R')
cases <- fromJSON('tests/fixtures/outcome-vocabulary.json')
cases <- cases[cases$dimension == 'replication', ]
stopifnot(identical(classify_outcome(cases$raw), cases$key))
"""
        subprocess.run(['Rscript','-e',code],cwd=ROOT,check=True,capture_output=True,text=True)

    def test_snapshot_outcomes_and_model_eligibility_stay_separate(self):
        from collections import Counter
        with (ROOT/'data/flora.csv').open() as source:
            rows=list(csv.DictReader(source))
        rep=[row for row in rows if 'replication' in row['type'].lower() and 'reproduc' not in row['type'].lower()]
        counts=Counter(c.classify_outcome(row['outcome']) for row in rep)
        publication=json.loads((ROOT/'data/pub_status_data.json').read_text())
        self.assertEqual(len(rep),publication['replication']['overview']['n_total'])
        self.assertEqual(Counter(row['outcome'] for row in publication['replication']['pub_studies']),
                         Counter(row['outcome'] for row in rep))
        self.assertEqual(dict(counts),{key:sum(group[key] for group in publication['replication']['by_outcome'].values())
                                      for key in counts})
        dims=[c.parse_reproduction_outcome(row['outcome']) for row in rows if 'reproduc' in row['type'].lower()]
        comp={'successful','issues','technical_failure'}
        robust={'robust','challenges'}
        self.assertEqual(sum(d[0] in comp for d in dims),publication['reproduction-numerical']['overview']['n_total'])
        self.assertEqual(sum(d[1] in robust for d in dims),publication['reproduction-robustness']['overview']['n_total'])
        self.assertTrue(any(d[0] in comp and d[1] in robust for d in dims))
        self.assertTrue(any(d[0]=='not_checked' for d in dims))
        with (ROOT/'data/flora_with_omc.csv').open() as source:
            matched=[row for row in csv.DictReader(source) if 'replication' in row['type'].lower()
                     and 'reproduc' not in row['type'].lower() and row['impact_factor']
                     and float(row['impact_factor'])<35]
        matched_counts=Counter(c.classify_outcome(row['outcome']) for row in matched)
        result=json.loads((ROOT/'data/impact_factor_data.json').read_text())
        self.assertEqual(result['overview']['n_total'],len(matched))
        self.assertEqual(result['stats']['n_model'],matched_counts['successful']+matched_counts['failed'])
        for key in c.REPLICATION_OUTCOMES:
            self.assertEqual(sum(bin[key] for bin in result['histogram']),matched_counts[key],key)
        self.assertEqual(result['overview']['n_classified'],sum(matched_counts[key] for key in ['successful','failed','mixed']))
        # Saved RR matches reproduce the recorded coverage without a live library lookup.
        snapshot=json.loads((ROOT/'data/rr_status_data.json').read_text())
        dois,titles=rr.cached_matches(snapshot)
        self.assertTrue(dois)
        self.assertTrue(titles)
        with self.assertRaises(ValueError):
            rr.cached_matches({})
        with patch.object(rr,'rr_dois',dois,create=True), patch.object(rr,'rr_titles',titles,create=True):
            # RR coverage has its own snapshot date, independent of the daily CSV.
            frame=pd.DataFrame(snapshot['replication']['rr_studies'])
            frame['bucket']=frame['outcome'].map(c.classify_outcome)
            rebuilt=rr.compute_rr_result(frame,'bucket',c.REPLICATION_OUTCOMES)
        self.assertEqual(rebuilt['overview']['n_rr'],snapshot['replication']['overview']['n_rr'])
        self.assertEqual(rebuilt['overview']['n_non_rr'],0)
        self.assertEqual(rebuilt['by_outcome']['rr'],snapshot['replication']['by_outcome']['rr'])
        for result in snapshot.values():
            self.assertEqual(sum(sum(group.values()) for group in result['by_outcome'].values()),result['overview']['n_total'])

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
                with patch.object(rr.requests,'get',return_value=response), patch.object(rr,'fetch_non_rr_keys',return_value={'READING'}), patch.object(rr,'OUT_DATA',output), patch.object(rr,'OUT_META',meta):
                    with self.assertRaises(ValueError): rr.main()
                self.assertEqual(output.read_text(),'previous data')
                self.assertEqual(meta.read_text(),'previous metadata')
            # A failed reading-list lookup must not replace the outputs either.
            valid=Mock(text='key,DOI,title\nRR1,10.test/a,Example title\n')
            for failure in [ValueError('no reading-list items'), rr.requests.HTTPError('503')]:
                with patch.object(rr.requests,'get',return_value=valid), patch.object(rr,'fetch_non_rr_keys',side_effect=failure), patch.object(rr,'OUT_DATA',output), patch.object(rr,'OUT_META',meta):
                    with self.assertRaises(type(failure)): rr.main()
                self.assertEqual(output.read_text(),'previous data')
                self.assertEqual(meta.read_text(),'previous metadata')
            csv_text='key,DOI,title\nRR1,https://doi.org/10.test/A,Example title\nREADING,10.1126/science.aac4716,Estimating the reproducibility of psychological science\n'
            with patch.object(rr.requests,'get',return_value=Mock(text=csv_text)), patch.object(rr,'fetch_non_rr_keys',return_value={'READING'}):
                self.assertEqual(rr.fetch_rr_library(),({'10.test/a'},{'exampletitle'}))

    def test_rrdb_skips_items_filed_only_in_the_reading_list(self):
        def page(items,total):
            return Mock(json=Mock(return_value=items),headers={'Total-Results':str(total)},raise_for_status=Mock())
        only_list={'key':'A','data':{'key':'A','collections':['BB5B9YHG']}}
        also_rr={'key':'B','data':{'key':'B','collections':['BB5B9YHG','RRCOLL']}}
        unfiled={'key':'C','data':{'key':'C','collections':[]}}
        with patch.object(rr.requests,'get',side_effect=[page([only_list,also_rr],3),page([unfiled],3)]) as get:
            self.assertEqual(rr.fetch_non_rr_keys(),{'A'})
        self.assertEqual(get.call_args_list[1].kwargs['params']['start'],2)
        with patch.object(rr.requests,'get',return_value=page([],0)):
            with self.assertRaises(ValueError): rr.fetch_non_rr_keys()
        with patch.object(rr.requests,'get',return_value=page([also_rr],1)):
            self.assertEqual(rr.fetch_non_rr_keys(),set())

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

if __name__=='__main__':
    unittest.main()
