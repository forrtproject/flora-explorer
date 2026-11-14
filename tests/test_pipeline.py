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
        for computational,robustness,expected in [
            ('computationally reproducible','robustness challenges',('successful','challenges')),
            ('technical failure','not checked',('technical_failure','not_checked')),
            ('not checked','robust',('not_checked','robust')),
            ('NA','',('missing','missing')),
        ]:
            # The combined outcome is never read when the per-axis columns are present.
            row=dict(type='reproduction',outcome='computationally reproducible, robust',
                     outcome_computation=computational,outcome_robustness=robustness)
            self.assertEqual(c.reproduction_dimensions(row),expected)
        self.assertEqual(c.replication_outcome(dict(type='replication',outcome='successful',outcome_replication='failed')),'failed')

    def test_replication_columns_fall_back_to_combined_fields_only_when_absent(self):
        rows=[dict(type='replication',outcome='failed',outcome_quote='q',outcome_quote_source='abstract'),
              dict(type='reproduction',outcome='computational issues, robust',outcome_quote='Computational: q',outcome_quote_source='results')]
        frame=c.with_outcome_columns(pd.DataFrame(rows))
        self.assertEqual(list(frame['outcome_replication']),['failed',''])
        self.assertEqual(list(frame['outcome_replication_quote']),['q',''])
        self.assertEqual(list(frame['out_quote_replication_source']),['abstract',''])
        dicts=c.add_outcome_columns([dict(row) for row in rows])
        self.assertEqual([row['outcome_replication'] for row in dicts],['failed',''])
        shipped=c.with_outcome_columns(pd.DataFrame([dict(type='replication',outcome='failed',outcome_replication='mixed')]))
        self.assertEqual(shipped.loc[0,'outcome_replication'],'mixed')
        alt=c.with_outcome_columns(pd.DataFrame([dict(Study_Type='reproduction',outcome='robust'),dict(Study_Type='replication',outcome='failed')]))
        self.assertEqual(list(alt['outcome_replication']),['','failed'])
        untyped=c.with_outcome_columns(pd.DataFrame([dict(outcome='failed')]))
        self.assertEqual(untyped.loc[0,'outcome_replication'],'failed')
        self.assertEqual(c.study_outcome_fields(dict(type='reproduction',outcome_computation='computational issues',outcome_robustness=float('nan'))),
                         {'outcome_computation':'computational issues','outcome_robustness':None})
        self.assertEqual(c.study_outcome_fields(dict(type='replication',outcome_replication='failed')),{'outcome_replication':'failed'})

    def test_shared_outcome_cases_and_r_replication_classifier(self):
        cases=json.loads((ROOT/'tests/fixtures/outcome-vocabulary.json').read_text(encoding='utf-8'))
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
        result=subprocess.run(['Rscript','-e',code],cwd=ROOT,capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)

    def test_cached_rr_matches_allow_reproduction_rebucketing_but_not_new_coverage(self):
        source=pd.read_csv(ROOT/'data/flora.csv',keep_default_na=False,dtype=str)
        snapshot=(ROOT/'data/rr_status_data.json').read_text(encoding='utf-8')
        repro=source.index[source['type'].str.lower().str.contains('reproduc')
                           & source['outcome_computation'].str.lower().eq('computationally reproducible')][0]
        rebucketed=source.copy(); rebucketed.loc[repro,'outcome_computation']='not yet coded'
        extra_replication=pd.concat([source,source[source['type'].str.lower()=='replication'].head(1).assign(doi_r='10.0/new',title_r='New report')])
        for frame,should_pass in [(rebucketed,True),(extra_replication,False)]:
            with self.subTest(should_pass=should_pass), tempfile.TemporaryDirectory() as tmp:
                csv_path,out=Path(tmp)/'flora.csv',Path(tmp)/'rr.json'
                frame.to_csv(csv_path,index=False); out.write_text(snapshot,encoding='utf-8')
                with patch.object(rr,'IN_CSV',csv_path), patch.object(rr,'OUT_DATA',out), patch.object(rr,'OUT_META',Path(tmp)/'meta.json'):
                    if should_pass:
                        rr.main(['--cached-matches'])
                        self.assertLess(json.loads(out.read_text(encoding='utf-8'))['reproduction-numerical']['overview']['n_total'],
                                        json.loads(snapshot)['reproduction-numerical']['overview']['n_total'])
                    else:
                        with self.assertRaises(ValueError):
                            rr.main(['--cached-matches'])
                        self.assertEqual(out.read_text(encoding='utf-8'),snapshot)

    def test_snapshot_outcomes_and_model_eligibility_stay_separate(self):
        from collections import Counter
        with (ROOT/'data/flora.csv').open(encoding='utf-8') as source:
            rows=c.add_outcome_columns(list(csv.DictReader(source)))
        rep=[row for row in rows if 'replication' in row['type'].lower() and 'reproduc' not in row['type'].lower()]
        counts=Counter(c.replication_outcome(row) for row in rep)
        publication=json.loads((ROOT/'data/pub_status_data.json').read_text(encoding='utf-8'))
        self.assertEqual(len(rep),publication['replication']['overview']['n_total'])
        self.assertEqual(Counter(row['outcome_replication'] for row in publication['replication']['pub_studies']),
                         Counter(row['outcome_replication'] or None for row in rep))
        groups=publication['replication']['by_outcome'].values()
        keys=set(counts)|{key for group in groups for key in group}
        self.assertEqual({key:counts.get(key,0) for key in keys},{key:sum(group.get(key,0) for group in groups) for key in keys})
        dims=[c.reproduction_dimensions(row) for row in rows if 'reproduc' in row['type'].lower()]
        comp={'successful','issues','technical_failure'}
        robust={'robust','challenges'}
        self.assertEqual(sum(d[0] in comp for d in dims),publication['reproduction-numerical']['overview']['n_total'])
        self.assertEqual(sum(d[1] in robust for d in dims),publication['reproduction-robustness']['overview']['n_total'])
        self.assertTrue(any(d[0] in comp and d[1] in robust for d in dims))
        self.assertTrue(any(d[0]=='not_checked' for d in dims))
        with (ROOT/'data/flora_with_omc.csv').open(encoding='utf-8') as source:
            matched=[row for row in csv.DictReader(source) if 'replication' in row['type'].lower()
                     and 'reproduc' not in row['type'].lower() and row['impact_factor']]
        matched_counts=Counter(c.replication_outcome(row) for row in matched)
        result=json.loads((ROOT/'data/impact_factor_data.json').read_text(encoding='utf-8'))
        self.assertEqual(result['overview']['n_total'],len(matched))
        self.assertEqual(result['stats']['n_model'],matched_counts['successful']+matched_counts['failed'])
        for key in c.REPLICATION_OUTCOMES:
            self.assertEqual(sum(bin[key] for bin in result['histogram']),matched_counts[key],key)
        self.assertEqual(result['overview']['n_classified'],sum(matched_counts[key] for key in ['successful','failed','mixed']))
        # Saved RR matches reproduce the recorded coverage without a live library lookup.
        snapshot=json.loads((ROOT/'data/rr_status_data.json').read_text(encoding='utf-8'))
        dois,titles=rr.cached_matches(snapshot)
        self.assertTrue(dois)
        self.assertTrue(titles)
        with self.assertRaises(ValueError):
            rr.cached_matches({})
        with patch.object(rr,'rr_dois',dois,create=True), patch.object(rr,'rr_titles',titles,create=True):
            # RR coverage has its own snapshot date, independent of the daily CSV.
            frame=pd.DataFrame(snapshot['replication']['rr_studies'])
            frame['bucket']=frame['outcome_replication'].map(c.classify_outcome)
            rebuilt=rr.compute_rr_result(frame,'bucket',c.REPLICATION_OUTCOMES)
        self.assertEqual(rebuilt['overview']['n_rr'],snapshot['replication']['overview']['n_rr'])
        self.assertEqual(rebuilt['overview']['n_non_rr'],0)
        self.assertEqual(rebuilt['by_outcome']['rr'],snapshot['replication']['by_outcome']['rr'])
        for result in snapshot.values():
            self.assertEqual(sum(sum(group.values()) for group in result['by_outcome'].values()),result['overview']['n_total'])

    def test_rr_counts_distinct_reports_beside_pairs(self):
        frame=pd.DataFrame([
            {'doi_r':'https://doi.org/10.1/A','url_r':None,'title_r':'Many targets','bucket':'successful'},
            {'doi_r':'10.1/a','url_r':None,'title_r':'Many targets','bucket':'failed'},
            {'doi_r':None,'url_r':'https://osf.io/x','title_r':'Preprint','bucket':'failed'},
            {'doi_r':None,'url_r':None,'title_r':'Préprint, no link','bucket':'mixed'},
            {'doi_r':None,'url_r':None,'title_r':'Préprint no link','bucket':'mixed'},
        ])
        with patch.object(rr,'rr_dois',{'10.1/a'},create=True), patch.object(rr,'rr_titles',{'preprint','preprintnolink'},create=True):
            ov=rr.compute_rr_result(frame,'bucket',c.REPLICATION_OUTCOMES)['overview']
        self.assertEqual((ov['n_rr'],ov['n_rr_reports']),(5,3))
        self.assertEqual(ov['n_non_rr_reports'],0)

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

    def test_reproduction_cocitation_rate_counts_only_citations_after_the_reproduction(self):
        frame=pd.DataFrame([dict(doi_o='10.test/original',doi_r='10.test/reproduction',year_r='2020',computational_bucket='successful',robustness_bucket='robust')])
        lists={'10.test/original':[{'citing':'early','year':2010},{'citing':'late','year':2021},{'citing':'both','year':2021}],
               '10.test/reproduction':[{'citing':'both','year':2021}]}
        with patch.object(pipeline,'fetch_oc_citations',side_effect=lambda doi:lists[doi]):
            data=pipeline.compute_reproduction_citations(frame)['reproduction-numerical']['successful']
        self.assertEqual(data['mean_cocitation_rate'],0.5)
        self.assertEqual(data['n_citations_to_original'],3)

    def test_panel_is_balanced_over_complete_years(self):
        def study(year,treat):
            return dict(year=year,first_replication_year=treat,first_replication_outcome='failed',
                        timeline=[dict(year=y,only=1,with_successful=0,with_failed=1,with_mixed=0,with_any=1) for y in range(year,pipeline.CURRENT_YEAR+1)])
        latest=pipeline.LAST_COMPLETE_YEAR-pipeline.EVENT_WINDOW[1]
        studies={'eligible':study(latest-10,latest),'partial-year':study(latest-9,latest+1),'replicated-first':study(latest-2,latest-3)}
        panel=pipeline.build_panel(studies,require_pre_window=False)
        self.assertEqual(set(panel['doi']),{'eligible'})
        self.assertEqual(panel['year'].max(),pipeline.LAST_COMPLETE_YEAR)

    def test_empty_run_preserves_committed_outputs(self):
        before=(ROOT/'data/meta.json').read_bytes()
        with self.assertRaisesRegex(RuntimeError,'retaining the previous'):
            pipeline.write_outputs({},pd.DataFrame(),partial=True)
        self.assertEqual((ROOT/'data/meta.json').read_bytes(),before)

    def test_excluded_originals_are_listed_with_reasons_and_left_out_of_the_index(self):
        def pair(doi_o,doi_r,title):
            return dict(doi_o=doi_o,doi_r=doi_r,outcome='failed',title_o=title,author_o='Caspi, A.',year_o=2003,
                        journal_o='Venue',title_r='Rep',author_r='Author',year_r=2015,pub_status='individual')
        frame=pd.DataFrame([pair('10.test/a-own','10.test/r-ok','Own fails'),
                            pair('10.test/b-rep','10.test/r-bad','Rep fails B'),
                            pair('10.test/c-rep','10.test/r-bad','Rep fails C'),
                            pair('10.test/d-ok','10.test/r-ok','Included')])
        lists={'10.test/a-own':None,'10.test/b-rep':[{'citing':'x','year':2016}],'10.test/c-rep':[{'citing':'x','year':2016}],
               '10.test/d-ok':[{'citing':'x','year':2016}],'10.test/r-ok':[{'citing':'x','year':2016}],'10.test/r-bad':None}
        stats=dict(rep_fetch_error_dois=[],originals_errored=0,originals_skipped=0,excluded_reasons={})
        with tempfile.TemporaryDirectory() as tmp, patch.object(pipeline,'RUN_STATS',stats), \
             patch.object(pipeline,'DATA_DIR',Path(tmp)), \
             patch.object(pipeline,'fetch_oc_citations',side_effect=lambda doi:lists[doi]), \
             patch.object(pipeline,'should_stop',return_value=False):
            pipeline.write_outputs(pipeline.build_study_data(frame),frame,partial=True)
            meta=json.loads((Path(tmp)/'meta.json').read_text())
            index=json.loads((Path(tmp)/'originals_index.json').read_text())
        self.assertEqual({e['doi']:e['reason'] for e in meta['excluded_originals']},
                         {'10.test/a-own':'own_fetch_failed','10.test/b-rep':'replication_fetch_failed','10.test/c-rep':'replication_fetch_failed'})
        self.assertEqual(meta['excluded_originals'][0]['title'],'Own fails')
        self.assertEqual(meta['n_originals_eligible'],meta['n_originals']+len(meta['excluded_originals']))
        self.assertEqual(meta['n_pairs_excluded'],3)
        self.assertEqual(meta['rep_fetch_failed_attempts'],2)
        self.assertEqual(meta['n_fetch_error_dois'],1)
        self.assertEqual(meta['fetch_error_dois'],['10.test/r-bad'])
        self.assertEqual({row['doi'] for row in index},{'10.test/d-ok'})

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
                self.assertEqual(omc.load_cache(),{'missing':{'id':None}})

    def test_omc_set_aside_rules(self):
        ok={'impact_factor':30.0,'works':200,'cited_by_count':6000}
        self.assertEqual(omc.omc_status(ok,None),'ok')
        self.assertEqual(omc.omc_status(None,None),'no_omc')
        self.assertEqual(omc.omc_status({'impact_factor':None,'works':0,'cited_by_count':0},None),'no_omc')
        self.assertEqual(omc.omc_status({'impact_factor':6.0,'works':11,'cited_by_count':66},None),'too_few_papers')
        self.assertEqual(omc.omc_status(ok,[{'cited_by_count':1200}]),'placeholder_record')
        self.assertEqual(omc.omc_status(ok,[{'cited_by_count':300}]),'ok')

    def test_expired_matches_are_rechecked_oldest_first_within_the_cap(self):
        now=omc.datetime(2026,11,13,tzinfo=omc.timezone.utc)
        cache={f'journal {i}':{'id':f'S{i}','display_name':f'Journal {i}','checked':f'2025-01-{i % 28 + 1:02d}'} for i in range(80)}
        cache['fresh']={'id':'S999','display_name':'Fresh','checked':'2026-11-01'}
        due=omc.lookups_due(['Brand New']+[f'Journal {i}' for i in range(80)]+['Fresh'],cache,now)
        self.assertEqual(due[0],'Brand New')
        self.assertEqual(len(due),1+omc.MAX_RECHECKS_PER_RUN)
        self.assertNotIn('Fresh',due)
        checked=[cache[omc.normalize_name(j)]['checked'] for j in due[1:]]
        self.assertEqual(checked,sorted(checked))

    def test_placeholder_search_reads_every_page(self):
        work=lambda n,src:{'id':f'W{n}','doi':None,'cited_by_count':150,'primary_location':{'source':{'id':src}}}
        pages=[{'results':[work(1,'S1')],'meta':{'next_cursor':'abc'}},
               {'results':[work(2,'S2')],'meta':{'next_cursor':'def'}},
               {'results':[],'meta':{'next_cursor':None}}]
        with patch.object(omc,'openalex_get',side_effect=pages) as get:
            found=omc.fetch_placeholders(['S1','S2'])
        self.assertEqual(sorted(found),['S1','S2'])
        self.assertEqual([c.args[1]['cursor'] for c in get.call_args_list],['*','abc','def'])

    def test_omc_jumps_flag_large_relative_changes_only(self):
        jumps=omc.omc_jumps({'a':2.0,'b':2.0,'c':0.2,'d':0.0,'e':5.0},{'a':4.1,'b':3.0,'c':0.5,'d':3.0,'f':9.0})
        self.assertEqual([j[0] for j in jumps],['a','d'])

    def test_cache_keeps_only_the_journal_match(self):
        with tempfile.TemporaryDirectory() as tmp:
            cache=Path(tmp)/'cache.json'
            cache.write_text(json.dumps({'brain research':{'id':'S1','display_name':'Brain Research','impact_factor':9.0}}))
            with patch.object(omc,'CACHE_FILE',cache):
                self.assertEqual(omc.load_cache(),{'brain research':{'id':'S1','display_name':'Brain Research'}})

    def test_cache_entries_expire_by_kind(self):
        now=omc.datetime(2026,11,13,tzinfo=omc.timezone.utc)
        match=lambda d:{'id':'S1','display_name':'Brain Research','checked':d}
        self.assertTrue(omc.cache_entry_fresh('brain research',match('2026-09-01'),now))
        self.assertFalse(omc.cache_entry_fresh('brain research',match('2026-08-01'),now))
        self.assertTrue(omc.cache_entry_fresh('unknown',{'id':None,'checked':'2026-10-20'},now))
        self.assertFalse(omc.cache_entry_fresh('unknown',{'id':None,'checked':'2026-10-01'},now))
        self.assertFalse(omc.cache_entry_fresh('brain research',{'id':'S1','display_name':'Brain Research'},now))
        self.assertFalse(omc.cache_entry_fresh('unknown',None,now))

    def test_failed_refresh_keeps_the_expired_match(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp)
            source=folder/'flora.csv'; source.write_text('journal_o\nBrain Research\n')
            stale={'brain research':{'id':'S1','display_name':'Brain Research','checked':'2020-01-01'}}
            with patch.object(omc,'IN_CSV',source), patch.object(omc,'OUT_CSV',folder/'out.csv'), \
                 patch.object(omc,'DATA_DIR',folder), patch.object(omc,'ROOT',folder), patch.object(omc,'load_cache',return_value=dict(stale)), \
                 patch.object(omc,'save_cache') as save, patch.object(omc,'lookup_venue',return_value=None), \
                 patch.object(omc,'fetch_source_stats',return_value={'S1':{'impact_factor':3.0,'works':50,'cited_by_count':150}}), \
                 patch.object(omc,'fetch_placeholders',return_value={}), \
                 patch.object(omc,'compute_reproduction_impact_stats'):
                omc.main()
            self.assertEqual(save.call_args[0][0],stale)
            self.assertIn('S1,Brain Research,3.0000,50,ok',(folder/'out.csv').read_text())

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
        eligible=[r for r in rows if r.get('impact_factor')]
        result=json.loads((ROOT/'data/impact_factor_data.json').read_text())
        rep=[r for r in eligible if 'replication' in r['type'].lower() and 'reproduc' not in r['type'].lower()]
        self.assertEqual(result['overview']['n_total'],len(rep))
        meta=json.loads((ROOT/'data/flora_with_omc_meta.json').read_text())
        for r in rows:
            if r['impact_factor']:
                self.assertEqual(r['omc_status'],'ok')
                self.assertGreaterEqual(int(r['omc_works']),meta['min_works'])
        for key in ['too_few_papers','placeholder_record']:
            self.assertEqual(result['set_aside'][key],sum(r['omc_status']==key for r in rows
                             if 'replication' in r['type'].lower() and 'reproduc' not in r['type'].lower()))
        curve=result['curve']
        self.assertLessEqual(max(p['omc'] for p in result['gam_curve']),curve['end_omc']+0.01)
        # end_omc is rounded to 2 decimals and points to 3, so pairs at the cut can differ by rounding.
        beyond=[p for p in result['jitter'] if p['omc']>curve['end_omc']+0.01]
        self.assertEqual(len(beyond),curve['n_beyond'])
        reproductions=json.loads((ROOT/'data/impact_factor_reproductions.json').read_text())
        repro=[c.reproduction_dimensions(r) for r in eligible if 'reproduc' in r['type'].lower()]
        for index,kind,buckets in [(0,'reproduction-numerical',{'successful','issues','technical_failure'}),(1,'reproduction-robustness',{'robust','challenges'})]:
            self.assertEqual(reproductions[kind]['overview']['n_total'],sum(d[index] in buckets for d in repro))

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
