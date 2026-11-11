#!/usr/bin/env python3
"""Recalculate the committed citation cohort from cache, without network requests.

The citation coverage date stays unchanged; recalculated_at records the calculation
date. Missing citation lists or metadata needed to check merged records abort the
run before outputs are written. Use refresh_data.py for a new coverage snapshot.
"""
import argparse
import json
from datetime import datetime, timezone
import pandas as pd
import refresh_data as pipeline


def cohort_frame(previous):
    """Preserve report labels established before citation-cohort filtering."""
    rows = []
    for s in previous['studies'].values():
        for r in s['replications']:
            rows.append(dict(doi_o=s['doi'], title_o=s['title'], author_o=s['author'],
                year_o=s['year'], journal_o=s['venue'], doi_r=r['doi'], title_r=r['title'],
                author_r=r['author'], year_r=r['year'], outcome=r['outcome'], type='replication', journal_r='', pub_status=r['pub_status']))
    return pd.DataFrame(rows)


def main():
    previous = json.loads((pipeline.DATA_DIR / 'originals.json').read_text())
    previous_meta = json.loads((pipeline.DATA_DIR / 'meta.json').read_text())
    frame = cohort_frame(previous)
    def cache_rows(kind, doi):
        path = pipeline.cache_path(kind, doi)
        if not path.exists():
            raise RuntimeError(f'Missing {kind} cache for {doi}; run a normal refresh first')
        value = json.loads(path.read_text())
        return value['rows'] if isinstance(value, dict) else value
    for doi in set(frame.doi_o) | set(frame.doi_r):
        cache_rows('oc', doi)
    def citations(doi):
        return list({pipeline.citing_key(c['citing']): {'citing':pipeline.citing_key(c['citing']), 'year':c['year']}
            for c in cache_rows('oc',doi) if c.get('citing') and c.get('year')}.values())
    pipeline.fetch_oc_citations = citations
    pipeline.oc_entity_ids = lambda doi: set(cache_rows('oc_meta', doi))
    pipeline.session.get = lambda *a, **kw: (_ for _ in ()).throw(RuntimeError('Network is disabled for this rebuild'))
    studies = pipeline.build_study_data(frame)
    assert set(studies) == set(previous['studies']), 'Rebuild must preserve the complete citation cohort'
    pipeline.write_outputs(studies,frame,partial=previous_meta.get('partial_run',False))
    # Retain the input cohort denominators, coverage date and any exclusion
    # metadata: the surviving cached cohort is not a new eligibility snapshot.
    meta = dict(previous_meta)
    meta['recalculated_at'] = datetime.now(timezone.utc).isoformat()
    meta['source'] = 'Committed OpenCitations cache; unchanged citation cohort'
    (pipeline.DATA_DIR / 'meta.json').write_text(json.dumps(meta,indent=2))

def withhold_models():
    """Sanitise only model payloads; preserve descriptive data and coverage dates."""
    path = pipeline.DATA_DIR / 'aggregate.json'
    aggregate = json.loads(path.read_text())
    for group in aggregate.values():
        for key in ['citations_model', 'cocitations_model']:
            group[key] = pipeline.withheld_model()
    path.write_text(json.dumps(aggregate, indent=2, allow_nan=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--withhold-models-only', action='store_true',
                        help='Sanitise committed aggregate estimates without rebuilding records')
    args = parser.parse_args()
    if args.withhold_models_only:
        withhold_models()
    else:
        main()
