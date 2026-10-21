"""Regression checks for scientific categories, unique counts, and failed lookups."""
import csv
import json
import hashlib
import importlib
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
import compute_pub_status as pub

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

    def test_repository_doi_rules_and_wrappers(self):
        examples = {
            'psyarxiv': '10.31234/osf.io/abc12', 'osf_preprints': '10.31219/osf.io/abc12',
            'osf': '10.17605/osf.io/abc12', 'biorxiv_medrxiv': '10.1101/123456',
            'ssrn': '10.2139/ssrn.123', 'zenodo': '10.5281/zenodo.123',
            'arxiv': '10.48550/arxiv.1234.56789', 'research_square': '10.21203/rs.3.rs-123/v1',
            'socarxiv': '10.31235/osf.io/abc12', 'psycharchives': '10.23668/psycharchives.123',
            'peerj_preprints': '10.7287/peerj.preprints.123v1', 'preprints_org': '10.20944/preprints202001.123.v1',
        }
        for rule, doi in examples.items():
            for wrapped in [doi, ' DOI: ' + doi.upper() + ' ', 'https://doi.org/' + doi, 'HTTP://DX.DOI.ORG/' + doi.upper()]:
                with self.subTest(rule=rule, wrapped=wrapped):
                    self.assertEqual(c.classify_venue_evidence(None, wrapped),
                                     dict(category='preprint', basis='doi', rule=rule))
        for prefix in ['10.1101', '10.64898']:
            for suffix in ['123456', '123456v2', '2026.01.12.123456', '2026.01.12.1234567v12', '2026.01.12.12345678']:
                with self.subTest(prefix=prefix, suffix=suffix):
                    self.assertEqual(c.classify_venue(None, prefix + '/' + suffix), 'preprint')
        for missing in [None, float('nan'), '', ' NA ', 'NaN', 'None', 'null']:
            self.assertEqual(c.classify_venue(missing, missing, missing), 'unknown')
            self.assertEqual(c.classify_venue_evidence(missing, missing, missing)['basis'], 'none')
            self.assertEqual(c.classify_venue(None, missing, 'https://doi.org/10.31234/osf.io/abc12'), 'preprint')
        for invalid in ['not a doi', 'https://example.org/10.5281/zenodo.123']:
            self.assertEqual(c.classify_venue(None, invalid, 'HTTP://DX.DOI.ORG/10.5281/ZENODO.123'), 'preprint')
        # A valid but unrecognised DOI must not be replaced by a second DOI in the URL.
        self.assertEqual(c.classify_venue(None, '10.1234/publisher', 'https://doi.org/10.5281/zenodo.123'), 'unknown')

    def test_repository_hosts_and_negative_evidence(self):
        hosts = ['osf.io', 'psyarxiv.com', 'socarxiv.org', 'biorxiv.org', 'medrxiv.org', 'ssrn.com',
                 'zenodo.org', 'arxiv.org', 'researchsquare.com', 'psycharchives.org', 'preprints.org', 'hal.science']
        for host in hosts:
            for url in ['http://' + host, ' HTTPS://' + host.upper() + '/record ', 'https://sub.' + host + '/record']:
                with self.subTest(url=url):
                    self.assertEqual(c.classify_venue_evidence(None, url=url),
                                     dict(category='preprint', basis='url', rule=host))
        for url in ['https://peerj.com/preprints/123', 'http://www.peerj.com/preprints/123']:
            self.assertEqual(c.classify_venue(None, url=url), 'preprint')
        for url in ['https://osf.io.example.org/a', 'https://example.org/osf.io/a',
                    'https://example.org/?url=https://osf.io/a', 'https://osf.io@example.org/a',
                    'ftp://osf.io/a', '//osf.io/a', 'https://peerj.com/articles/123',
                    'https://peerj.com/preprints', 'https://drive.google.com/a', 'https://github.com/a',
                    'https://openalex.org/a', 'https://hdl.handle.net/123', 'https://institution.edu/repository/a',
                    'https://[broken', 'https://doi.org.example.org/10.5281/zenodo.123']:
            with self.subTest(url=url):
                self.assertEqual(c.classify_venue(None, url=url), 'unknown')
        for doi in ['10.1101/lm.053631.122', '10.312340/osf.io/abc', '10.1234/unknown',
                    '10.1101/12345', '10.1101/1234567', '10.64898/2026.01.12.12345',
                    '10.1101/2026.01.12.123456789', '10.1101/123456v', '10.52810/zenodo.123',
                    '10.31234/osf.io/', '10.2139/ssrn.', '10.20944/preprints']:
            with self.subTest(doi=doi):
                self.assertEqual(c.classify_venue(None, doi=doi), 'unknown')
        # Every DOI rule requires a remainder after its platform marker.
        for doi in ['10.31219/osf.io/', '10.17605/osf.io/', '10.5281/zenodo.', '10.48550/arxiv.',
                    '10.21203/rs.', '10.31235/osf.io/', '10.23668/psycharchives.', '10.7287/peerj.preprints.']:
            self.assertEqual(c.classify_venue(None, doi), 'unknown')

    def test_venue_precedence_and_known_edge_cases(self):
        for name in ['OSF', 'arXiv', 'Preprint', 'SSRN', 'Working paper', 'Repository', 'Registries',
                     'bioRxiv', 'medRxiv', 'PsyArXiv', 'PsychArchives', 'Zenodo', 'Research Square', 'ResearchSquare']:
            self.assertEqual(c.classify_venue(name, '10.1234/unfamiliar'), 'preprint')
            self.assertEqual(c.classify_venue_evidence(name)['basis'], 'venue_name')
        for name, expected in [('Thesis', 'thesis'), ('Theses', 'thesis'), ('Dissertation', 'thesis'),
                               ('Dissertação', 'thesis'), ('Teses', 'thesis'), ('Conference', 'conference'),
                               ('Proceedings', 'conference'), ('Symposium', 'conference'), ('Workshop', 'conference')]:
            evidence = c.classify_venue_evidence(name, '10.5281/zenodo.123', 'https://osf.io/a')
            self.assertEqual(evidence['category'], expected)
            self.assertEqual(evidence['basis'], 'venue_name')
        self.assertEqual(c.classify_venue('Thesis conference preprint', '10.5281/zenodo.123'), 'thesis')
        self.assertEqual(c.classify_venue('Learning & Memory', '10.1101/lm.053631.122'), 'journal')
        self.assertEqual(c.classify_venue('Named journal', '10.1234/published', 'https://osf.io/a'), 'journal')
        self.assertEqual(c.classify_venue('Named journal', None, 'https://osf.io/a'), 'journal')
        self.assertEqual(c.classify_venue('Named journal', '10.5281/zenodo.123'), 'preprint')
        self.assertEqual(c.classify_venue_evidence('Clearer Thinking', '10.5281/zenodo.123')['basis'], 'doi')
        self.assertEqual(c.classify_venue_evidence('Leibniz Institute for Psychology (ZPID)', '10.23668/psycharchives.123'),
                         dict(category='preprint', basis='doi', rule='psycharchives'))
        self.assertEqual(c.classify_venue('Named journal', None, 'https://doi.org/10.5281/zenodo.123'), 'preprint')
        self.assertEqual(c.classify_venue('Research Square', '10.5281/zenodo.123'), 'preprint')
        self.assertEqual(c.classify_venue_evidence('Research Square', '10.5281/zenodo.123')['basis'], 'doi')

    def test_venue_aggregation_preserves_pairs_outcomes_and_dimensions(self):
        rows = [dict(type='replication', doi_o='10.1234/' + str(i), doi_r='10.5281/zenodo.123',
                     journal_r=None, outcome=outcome, title_r='Repeated report')
                for i, outcome in enumerate(['statistically successful but flawed', 'uncoded'])]
        rows += [dict(type='reproduction', doi_o='10.1234/' + str(i), doi_r='10.5281/zenodo.456', journal_r=None,
                      outcome=outcome) for i, outcome in enumerate([
                          'computationally reproducible, robust', 'technical failure, not checked',
                          'not checked, robustness challenges', 'uncoded'])]
        result = pub.compute_results(pd.DataFrame(rows))
        replication = result['replication']
        self.assertEqual(replication['overview']['n_total'], 2)
        self.assertEqual(replication['overview']['n_preprint'], 2)
        self.assertEqual(replication['by_outcome']['preprint']['qualified'], 1)
        self.assertEqual(replication['by_outcome']['preprint']['other'], 1)
        self.assertEqual([s['outcome'] for s in replication['pub_studies']], ['statistically successful but flawed', 'uncoded'])
        self.assertEqual([s['venue_basis'] for s in replication['pub_studies']], ['doi', 'doi'])
        for kind, expected in [('reproduction-numerical', {'successful': 1, 'issues': 0, 'technical_failure': 1}),
                               ('reproduction-robustness', {'robust': 1, 'challenges': 1})]:
            self.assertEqual(result[kind]['overview']['n_total'], 2)
            self.assertEqual(result[kind]['by_outcome']['preprint'], expected)
        empty = pub.compute_pub_status_result(pd.DataFrame(columns=['outcome_lc']), 'outcome_lc', c.REPLICATION_OUTCOMES)
        self.assertEqual(empty['overview']['n_total'], 0)
        self.assertEqual(empty['pub_studies'], [])

    def test_publication_summary_import_has_no_file_side_effects(self):
        with patch.object(pd, 'read_csv', side_effect=AssertionError('Import must not read the CSV')), \
             patch.object(Path, 'write_text', side_effect=AssertionError('Import must not write outputs')):
            importlib.reload(pub)

    def test_venue_snapshot_reconciles_and_preserves_report_size(self):
        source = pd.read_csv(ROOT/'data/flora.csv', low_memory=False, na_values=['', 'NA'])
        result = json.loads((ROOT/'data/pub_status_data.json').read_text())
        self.assertEqual(pub.compute_results(source), result)
        expected = {
            'replication': (2692, 2304, 287, 46, 52, 3, '598cda3de1091f32134e4e5c9e7bea0fe2a71e92cffd7fba37a00854f7fb91ee'),
            'reproduction-numerical': (303, 121, 147, 34, 1, 0, '5650b1aa84435197e951b515ba7bbaa1dc926852df2e6c517df5439bbdbcd9c8'),
            'reproduction-robustness': (222, 163, 24, 34, 1, 0, '6f25188de2e9e793114d92421ba2a68cfa0712da1f08e92b4fa2662db7e4bae1'),
        }
        for kind, (total, journal, preprint, unknown, conference, thesis, report_size_hash) in expected.items():
            data = result[kind]
            self.assertEqual([data['overview']['n_' + k] for k in ['total', 'journal', 'preprint', 'unknown', 'conference', 'thesis']],
                             [total, journal, preprint, unknown, conference, thesis])
            self.assertEqual(len(data['pub_studies']), total)
            # Pin the pre-change report-size outputs, including all evidence records.
            self.assertEqual(hashlib.sha256(json.dumps(data['large_scale'], sort_keys=True).encode()).hexdigest(), report_size_hash)
            for group in c.VENUE_LABELS:
                studies = [s for s in data['pub_studies'] if s['pub_status'] == group]
                self.assertEqual(len(studies), data['overview']['n_' + group])
                for bucket, count in data['by_outcome'][group].items():
                    def outcome(study):
                        if kind == 'replication': return c.classify_outcome(study['outcome'])
                        return c.parse_reproduction_outcome(study['outcome'])[0 if kind == 'reproduction-numerical' else 1]
                    self.assertEqual(sum(outcome(s) == bucket for s in studies), count)
                for study in studies:
                    evidence = c.classify_venue_evidence(study['journal_r'], study['doi_r'], study['url_r'])
                    self.assertEqual((study['pub_status'], study['venue_basis'], study['venue_rule']),
                                     (evidence['category'], evidence['basis'], evidence['rule']))
        meta = json.loads((ROOT/'data/pub_status_meta.json').read_text())
        self.assertEqual(meta['venue_rules_version'], 2)
        self.assertEqual(meta['source_last_updated'], json.loads((ROOT/'data/flora_meta.json').read_text())['last_updated'])

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

if __name__=='__main__':
    unittest.main()
