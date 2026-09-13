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
        with patch.object(pipeline,'fetch_oc_citations',return_value=[{'citing':'one','year':2020}]):
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

if __name__=='__main__':
    unittest.main()
