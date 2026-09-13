"""Regression checks for scientific categories, unique counts, and failed lookups."""
import csv
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import pandas as pd
import classification as c
import refresh_data as pipeline

class PipelineTests(unittest.TestCase):
    def test_qualified_success_and_reproduction_dimensions(self):
        with (ROOT/'data/flora.csv').open() as source:
            rows=list(csv.DictReader(source))
        qualified=[r for r in rows if r['outcome']=='statistically successful but flawed']
        self.assertEqual(len(qualified),7)
        self.assertTrue(all(c.classify_outcome(r['outcome'])=='qualified' for r in qualified))
        for raw,expected in [
            ('computationally reproducible, robustness challenges',('successful','challenges')),
            ('technical failure, not checked',('technical_failure','not_checked')),
            ('not checked, robust',('not_checked','robust')),
            ('NA',(None,None)),
        ]:
            self.assertEqual(c.parse_reproduction_outcome(raw),expected)
        repro=[r for r in rows if 'reproduc' in r['type']]
        dimensions=[c.parse_reproduction_outcome(r['outcome']) for r in repro]
        self.assertEqual(sum(d[0] in {'successful','issues','technical_failure'} for d in dimensions),294)
        self.assertEqual(sum(d[1] in {'robust','challenges'} for d in dimensions),167)

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

if __name__=='__main__':
    unittest.main()
