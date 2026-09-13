"""Summarise recorded publication venues and reports with more than three targets.

Venue categories are metadata heuristics, not verified peer-review status.
Unknown venues remain unknown. Counts refer to reference pairs; project lists
contain one record per repetition report.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from classification import classify_outcome, classify_venue, REPLICATION_OUTCOMES, MULTI_TARGET_THRESHOLD, VENUE_LABELS
import pandas as pd

ROOT     = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
IN_CSV   = DATA_DIR / "flora.csv"
OUT_DATA = DATA_DIR / "pub_status_data.json"
OUT_META = DATA_DIR / "pub_status_meta.json"

if not IN_CSV.exists():
    raise SystemExit(f"{IN_CSV} not found.")

from classification import parse_reproduction_outcome, reference_key



def _clean(v):
    """Convert pandas NaN to None; JSON has no NaN literal that JS's JSON.parse accepts."""
    return None if pd.isna(v) else v



# Rows without an actual verdict on a dimension ("not checked"/uncoded) are dropped from
# that dimension entirely rather than kept as their own bucket - they say nothing about it.
# Applied per dimension, so a reproduction whose robustness was never checked still counts
# toward the computational breakdown.
COMPUTATIONAL_BUCKETS = ["successful", "issues", "technical_failure"]
ROBUSTNESS_BUCKETS = ["robust", "challenges"]


def compute_pub_status_result(sub: pd.DataFrame, bucket_col: str, buckets: list[str]) -> dict:
    sub = sub.copy()
    sub["pub_status"] = sub.get("journal_r", pd.Series(index=sub.index, dtype=str)).apply(classify_venue)
    n_total = len(sub)
    counts = sub["pub_status"].value_counts().to_dict()
    n_journal, n_preprint, n_unknown = (int(counts.get(k, 0)) for k in ['journal','preprint','unknown'])
    by_outcome = {group: {b: int(((sub.pub_status == group) & (sub[bucket_col] == b)).sum()) for b in buckets} for group in VENUE_LABELS}

    # Every row of this kind, not a subset - unlike the Registered Reports table,
    # which only lists the RR-matched studies.
    pub_studies = [
        {
            "title_r": _clean(row.get("title_r")),
            "journal_r": _clean(row.get("journal_r")),
            "year_r": _clean(row.get("year_r")),
            "outcome": _clean(row.get("outcome")),
            "doi_r": _clean(row.get("doi_r")),
            "url_r": _clean(row.get("url_r")),
            "pub_status": row["pub_status"],
        }
        for _, row in sub.iterrows()
    ]
    pub_studies.sort(key=lambda s: (s["year_r"] is None, s["year_r"]), reverse=True)

    return {
        "overview": {
            "n_total": n_total,
            "n_journal": n_journal,
            "n_preprint": n_preprint,
            "n_unknown": n_unknown,
            "n_conference": int(counts.get("conference", 0)),
            "n_thesis": int(counts.get("thesis", 0)),
            "pct_journal": round(100 * n_journal / n_total, 1) if n_total else 0,
            "pct_preprint": round(100 * n_preprint / n_total, 1) if n_total else 0,
        },
        "by_outcome": by_outcome,
        "pub_studies": pub_studies,
    }


LARGE_SCALE_THRESHOLD = MULTI_TARGET_THRESHOLD


def compute_large_scale_result(sub: pd.DataFrame, bucket_col: str, buckets: list[str]) -> dict:
    sub = sub.copy()
    n_originals_per_doi_r = df.groupby("report_key")["target_key"].nunique()
    # DOI or URL keys identify reports and targets; unknown identifiers are not evidence of a multi-target report.
    sub["n_originals_in_rep"] = sub["report_key"].map(n_originals_per_doi_r).fillna(0)
    sub["is_large_scale"] = sub["n_originals_in_rep"] > LARGE_SCALE_THRESHOLD

    n_total = len(sub)
    n_large_scale = int(sub["is_large_scale"].sum())
    n_individual = n_total - n_large_scale

    by_outcome: dict[str, dict[str, int]] = {}
    for grp, flag in [("individual", False), ("large_scale", True)]:
        bkt = sub.loc[sub["is_large_scale"] == flag, bucket_col]
        by_outcome[grp] = {b: int((bkt == b).sum()) for b in buckets}

    # One row per large-scale *publication* (doi_r), not per target study - a single
    # project can report on dozens of originals, and listing every one of those rows
    # individually would mostly repeat the same title/journal/DOI. outcome_mix instead
    # summarises how that project's many individual outcomes broke down.
    large_scale_studies = []
    for doi_r, grp in sub.loc[sub["is_large_scale"]].groupby("report_key"):
        first = grp.iloc[0]
        outcome_mix = {b: int((grp[bucket_col] == b).sum()) for b in buckets if (grp[bucket_col] == b).any()}
        large_scale_studies.append({
            "title_r": _clean(first.get("title_r")),
            "journal_r": _clean(first.get("journal_r")),
            "year_r": _clean(first.get("year_r")),
            "doi_r": _clean(first.get("doi_r")),
            "url_r": _clean(first.get("url_r")),
            "n_originals": int(first["n_originals_in_rep"]),
            "outcome_mix": outcome_mix,
        })
    large_scale_studies.sort(key=lambda s: (s["year_r"] is None, s["year_r"]), reverse=True)

    return {
        "overview": {
            "n_total": n_total,
            "n_individual": n_individual,
            "n_large_scale": n_large_scale,
            "n_unknown": 0,
            "pct_individual": round(100 * n_individual / n_total, 1) if n_total else 0,
            "pct_large_scale": round(100 * n_large_scale / n_total, 1) if n_total else 0,
        },
        "by_outcome": by_outcome,
        "large_scale_studies": large_scale_studies,
    }


# ── Load & split by study type ─────────────────────────────────────────────────
df = pd.read_csv(IN_CSV, low_memory=False, na_values=["", "NA"])
for suffix, key in [("r", "report_key"), ("o", "target_key")]:
    df[key] = df.apply(lambda row: reference_key(row.get("doi_" + suffix), row.get("url_" + suffix)), axis=1)
df["type_lc"] = df.get("type", pd.Series(dtype=str)).astype(str).str.lower()
df["outcome_lc"] = df.get("outcome", pd.Series(dtype=str)).astype(str).str.lower().str.strip()

is_reproduction = df["type_lc"].str.contains("reproduc", na=False)
is_replication = df["type_lc"].str.contains("replication", na=False) & ~is_reproduction
df.loc[is_replication, "outcome_lc"] = df.loc[is_replication, "outcome_lc"].map(classify_outcome)

repro_df = df[is_reproduction].copy()
repro_dims = repro_df["outcome_lc"].apply(parse_reproduction_outcome)
repro_df["computational_bucket"] = repro_dims.apply(lambda t: t[0] or "not_coded")
repro_df["robustness_bucket"] = repro_dims.apply(lambda t: t[1] or "not_coded")

repro_comp_df = repro_df[repro_df["computational_bucket"].isin(COMPUTATIONAL_BUCKETS)]
repro_robust_df = repro_df[repro_df["robustness_bucket"].isin(ROBUSTNESS_BUCKETS)]

result = {
    "replication": compute_pub_status_result(df[is_replication], "outcome_lc", REPLICATION_OUTCOMES),
    "reproduction-numerical": compute_pub_status_result(repro_comp_df, "computational_bucket", COMPUTATIONAL_BUCKETS),
    "reproduction-robustness": compute_pub_status_result(repro_robust_df, "robustness_bucket", ROBUSTNESS_BUCKETS),
}
result["replication"]["large_scale"] = compute_large_scale_result(df[is_replication], "outcome_lc", REPLICATION_OUTCOMES)
result["reproduction-numerical"]["large_scale"] = compute_large_scale_result(repro_comp_df, "computational_bucket", COMPUTATIONAL_BUCKETS)
result["reproduction-robustness"]["large_scale"] = compute_large_scale_result(repro_robust_df, "robustness_bucket", ROBUSTNESS_BUCKETS)

OUT_DATA.write_text(json.dumps(result), encoding="utf-8")
OUT_META.write_text(json.dumps({
    "last_updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "n_total": {k: v["overview"]["n_total"] for k, v in result.items()},
    "source": "scripts/compute_pub_status.py",
}, indent=2), encoding="utf-8")

for kind, r in result.items():
    ov = r["overview"]
    ls = r["large_scale"]["overview"]
    print(f"{kind}: n_total={ov['n_total']}, journal={ov['n_journal']} ({ov['pct_journal']}%), "
          f"preprint={ov['n_preprint']} ({ov['pct_preprint']}%); "
          f"individual={ls['n_individual']} ({ls['pct_individual']}%), "
          f"large_scale={ls['n_large_scale']} ({ls['pct_large_scale']}%)")
print(f"Written: {OUT_DATA}")
