"""Pair-weighted comparison denominators and unadjusted Wilson intervals."""
from collections import Counter
from math import sqrt

from classification import reference_key

MIN_SHARE_PAIRS = 20
INTERVAL_METHOD = "Wilson 95%; assumes independent pairs"


def wilson_interval(k, n):
    """Two-sided 95% Wilson bounds on the percentage scale; empty is unavailable."""
    if not 0 <= k <= n:
        raise ValueError("Outcome pairs must lie between zero and group pairs")
    if not n:
        return [None, None]
    z = 1.959963984540054
    p = k / n
    centre = p + z * z / (2 * n)
    radius = z * sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    divisor = 1 + z * z / n
    return [max(0, 100 * (centre - radius) / divisor), min(100, 100 * (centre + radius) / divisor)]


def summarise_groups(frame, group_col, groups, bucket_col, buckets):
    """Count distinct repetition reports within exactly the eligible pair subset.

    Missing identifiers stay missing; they never create synthetic independent reports.
    Reports can span groups, so the report counts must not be added across groups.
    """
    result = {}
    for group in groups:
        sub = frame[frame[group_col] == group]
        keys = [reference_key(row.get('doi_r'), row.get('url_r')) for _, row in sub.iterrows()]
        n = len(sub)
        counts = {b: int((sub[bucket_col] == b).sum()) for b in buckets}
        result[group] = {
            'pairs': n,
            'reports': len(set(keys) - {None}),
            'pairs_without_report_identifiers': keys.count(None),
            'top_two_report_pairs': sum(n for _, n in Counter(k for k in keys if k is not None).most_common(2)),
            'outcomes': {b: {'pairs': k, 'share': 100 * k / n if n else None,
                             'wilson': wilson_interval(k, n)} for b, k in counts.items()},
        }
    return result


def interval_metadata():
    return {'minimum_share_pairs': MIN_SHARE_PAIRS, 'interval_method': INTERVAL_METHOD,
            'interval_caveat': 'Pairs are treated as independent; intervals are too narrow when pairs share reports.'}


def write_summary(result, out_data, out_meta, metadata, recalculate=False):
    """Preserve coverage and reject changed evidence during an offline recalculation."""
    import json
    from datetime import datetime, timezone

    if recalculate:
        previous = json.loads(out_data.read_text())

        def without_groups(value):
            if isinstance(value, dict):
                return {k: without_groups(v) for k, v in value.items() if k != 'groups'}
            if isinstance(value, list):
                return [without_groups(v) for v in value]
            return value

        if without_groups(result) != without_groups(previous):
            raise ValueError('Recalculation changed existing counts or evidence; retaining previous outputs')
        metadata = json.loads(out_meta.read_text())
    metadata['comparison'] = interval_metadata()
    metadata['comparison']['recalculated_at'] = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    out_data.write_text(json.dumps(result), encoding='utf-8')
    out_meta.write_text(json.dumps(metadata, indent=2), encoding='utf-8')
