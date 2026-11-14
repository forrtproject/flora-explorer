"""
Determine which FLoRA replications were published as Registered Reports (RR).

Matches each replication's DOI/title against the Registered Reports Database
(RRDB) - a CSV export of the FORRT Zotero "Registered Reports" group library
(https://www.zotero.org/groups/5937153/registered_reports), maintained and
regularly updated at https://github.com/LukasRoeseler/RRDB. Items filed only in
the group's shared reading list (not Registered Reports) are excluded using one
paginated Zotero API lookup of that collection. RRDB is otherwise preferred
over querying the Zotero API directly: one small, reliable GET instead of a
paginated/rate-limited API walk, and RRDB is itself a citable, actively
maintained project (see RRDB_CITATION below).

A replication that appears in that library is classified as an RR; every
other replication falls into the "rest" (non-RR) group. Outcome counts are
then compared between the two groups.

Note this only tells us whether the *replication itself* was published as a
Registered Report - not whether the original study was. Coverage of the RR
library is itself incomplete, so "non-RR" really means "not (yet) found in the
RR library", not "confirmed to not be a Registered Report".

Output:
  data/rr_status_data.json
  data/rr_status_meta.json
"""
from __future__ import annotations

import io
import json
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

from classification import classify_outcome, classify_venue, REPLICATION_OUTCOMES, MULTI_TARGET_THRESHOLD, VENUE_LABELS
import pandas as pd
import requests

ROOT     = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
IN_CSV   = DATA_DIR / "flora.csv"
OUT_DATA = DATA_DIR / "rr_status_data.json"
OUT_META = DATA_DIR / "rr_status_meta.json"

RRDB_CSV_URL = "https://raw.githubusercontent.com/LukasRoeseler/RRDB/main/zotero_registered_reports.csv"
RRDB_SOURCE_URL = "https://github.com/LukasRoeseler/RRDB/blob/main/zotero_registered_reports.csv"
# The Zotero group also holds "QRCshared", a shared reading list (collection BB5B9YHG) of
# background literature such as Ioannidis (2005) and OSC (2015). RRDB exports the whole
# library, so items filed only in that collection are dropped before matching. Same rule
# as forrtproject/chromium-extension#286.
ZOTERO_GROUP_ID = "5937153"
NON_RR_COLLECTIONS = {"BB5B9YHG"}
ZOTERO_PAGE_SIZE = 100

RRDB_CITATION = (
    "Montoya, A. K., Krenzer, W. L. D., Buchanan, E. M., Pronizius, E., Wang, Y. A., "
    "Morillo, D., … Armstrong, C. (2026, May 14). Database of Published "
    "Registered Reports. https://doi.org/10.17605/OSF.IO/VUR72"
)


def normalize_doi(doi) -> str:
    """Lowercase, strip whitespace/prefixes so DOIs compare equal regardless of formatting."""
    if not isinstance(doi, str) or not doi.strip():
        return ""
    d = doi.strip().lower()
    d = re.sub(r"^https?://(dx\.)?doi\.org/", "", d)
    d = re.sub(r"^doi:\s*", "", d)
    return d.strip("/ ")


def normalize_title(title) -> str:
    """Lowercase, strip diacritics/punctuation/whitespace to a compact alnum key."""
    if not isinstance(title, str) or not title.strip():
        return ""
    t = unicodedata.normalize("NFD", title)
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]", "", t.lower())


def only_in_non_rr_collections(collections) -> bool:
    collections = list(collections or [])
    return bool(collections) and all(c in NON_RR_COLLECTIONS for c in collections)


def fetch_non_rr_keys() -> set[str]:
    """Zotero item keys filed only in a non-RR collection (the shared reading list)."""
    keys: set[str] = set()
    n_fetched = 0
    for collection in sorted(NON_RR_COLLECTIONS):
        url = f"https://api.zotero.org/groups/{ZOTERO_GROUP_ID}/collections/{collection}/items/top"
        start = 0
        while True:
            resp = requests.get(url, params={"format": "json", "limit": ZOTERO_PAGE_SIZE, "start": start}, timeout=60)
            resp.raise_for_status()
            page = resp.json()
            n_fetched += len(page)
            for item in page:
                data = item.get("data", {})
                if only_in_non_rr_collections(data.get("collections")):
                    keys.add(data.get("key") or item.get("key"))
            total = int(resp.headers.get("Total-Results", 0))
            start += len(page)
            if not page or start >= total:
                break
    if not n_fetched:
        # An empty collection means the lookup failed or the list moved; items filed in
        # both the list and an RR collection are kept, so an empty key set is fine.
        raise ValueError("Zotero returned no reading-list items; retaining previous outputs")
    return keys


def drop_non_rr_items(df_rr: pd.DataFrame, non_rr_keys: set[str]) -> pd.DataFrame:
    if "key" not in df_rr.columns:
        raise ValueError("RRDB CSV has no Zotero key column; cannot exclude the reading list")
    return df_rr[~df_rr["key"].astype(str).isin(non_rr_keys)]


def fetch_rr_library() -> tuple[set[str], set[str]]:
    """Load the RRDB CSV (a regularly-updated export of the FORRT Zotero Registered
    Reports group library) and return (dois, titles) sets for matching."""
    resp = requests.get(RRDB_CSV_URL, timeout=60)
    resp.raise_for_status()
    df_rr = pd.read_csv(io.StringIO(resp.text), low_memory=False)

    if not {"DOI", "title"}.issubset(df_rr.columns):
        raise ValueError("RRDB CSV is missing required DOI/title columns; retaining previous outputs")
    is_attachment_or_note = df_rr.get("itemType", pd.Series("", index=df_rr.index)).astype(str).str.lower().isin(["attachment", "note"])
    df_rr = df_rr[~is_attachment_or_note]
    n_before = len(df_rr)
    df_rr = drop_non_rr_items(df_rr, fetch_non_rr_keys())
    print(f"RRDB: dropped {n_before - len(df_rr)} items filed only in the shared reading list")

    dois = set(df_rr.get("DOI", pd.Series(dtype=str)).apply(normalize_doi)) - {""}
    titles = set(df_rr.get("title", pd.Series(dtype=str)).apply(normalize_title)) - {""}
    if not dois and not titles:
        raise ValueError("RRDB CSV has no usable DOI or title; retaining previous outputs")
    return dois, titles




from classification import load_outcome_columns, reproduction_dimensions, study_outcome_fields



def _classify(row) -> bool | None:
    """RR-vs-not classification is purely DOI/title matching against the Zotero
    library, so it works identically for replication and reproduction rows."""
    doi = normalize_doi(row.get("doi_r", ""))
    title = normalize_title(row.get("title_r", ""))
    if not doi and not title:
        return None
    if doi and doi in rr_dois:
        return True
    if title and title in rr_titles:
        return True
    return False


def _clean(v):
    """Convert pandas NaN to None; JSON has no NaN literal that JS's JSON.parse accepts."""
    return None if pd.isna(v) else v


def report_key(row) -> str:
    """One repetition report: DOI, else URL, else title. Must match reportKey() in assets/app.js."""
    doi = normalize_doi(row.get("doi_r"))
    if doi:
        return "doi:" + doi
    url = row.get("url_r")
    if isinstance(url, str) and url.strip():
        return "url:" + url.strip().lower()
    title = normalize_title(row.get("title_r"))
    return "title:" + title if title else ""


def n_distinct_reports(df: pd.DataFrame) -> int:
    return len({k for k in df.apply(report_key, axis=1)} - {""}) if len(df) else 0



# Rows without an actual verdict on a dimension ("not checked"/uncoded) are dropped from
# that dimension entirely rather than kept as their own bucket - they say nothing about it.
# Applied per dimension, so a reproduction whose robustness was never checked still counts
# toward the computational breakdown.
COMPUTATIONAL_BUCKETS = ["successful", "issues", "technical_failure"]
ROBUSTNESS_BUCKETS = ["robust", "challenges"]


def compute_rr_result(sub: pd.DataFrame, bucket_col: str, buckets: list[str]) -> dict:
    sub = sub.copy()
    sub["is_rr"] = sub.apply(_classify, axis=1)

    known = sub[sub["is_rr"].notna()].copy()
    n_total = len(known)
    n_rr = int(known["is_rr"].sum())
    n_non_rr = n_total - n_rr
    n_unknown = int(sub["is_rr"].isna().sum())

    by_outcome: dict[str, dict[str, int]] = {}
    for grp, flag in [("rr", True), ("non_rr", False)]:
        bkt = known.loc[known["is_rr"] == flag, bucket_col]
        by_outcome[grp] = {b: int((bkt == b).sum()) for b in buckets}

    rr_studies = [
        {
            "title_r": _clean(row.get("title_r")),
            "journal_r": _clean(row.get("journal_r")),
            "year_r": _clean(row.get("year_r")),
            **study_outcome_fields(row),
            "doi_r": _clean(row.get("doi_r")),
            "url_r": _clean(row.get("url_r")),
        }
        for _, row in known.loc[known["is_rr"]].iterrows()
    ]
    rr_studies.sort(key=lambda s: (s["year_r"] is None, s["year_r"]), reverse=True)

    return {
        "overview": {
            "n_total": n_total,
            "n_rr": n_rr,
            "n_non_rr": n_non_rr,
            "n_unknown": n_unknown,
            "n_rr_reports": n_distinct_reports(known[known["is_rr"] == True]),
            "n_non_rr_reports": n_distinct_reports(known[known["is_rr"] == False]),
            "pct_rr": round(100 * n_rr / n_total, 1) if n_total else 0,
            "pct_non_rr": round(100 * n_non_rr / n_total, 1) if n_total else 0,
        },
        "by_outcome": by_outcome,
        "rr_studies": rr_studies,
    }


def cached_matches(snapshot):
    """Reuse positive report matches recorded in the committed summary, offline.

    This is a vocabulary-only recalculation, not a new RRDB coverage lookup.
    """
    if not snapshot:
        raise ValueError('No committed RR summary available; retaining previous outputs')
    studies = [study for result in snapshot.values() for study in result['rr_studies']]
    return ({normalize_doi(study.get('doi_r')) for study in studies} - {''},
            {normalize_title(study.get('title_r')) for study in studies} - {''})


def main(argv=()):
    global rr_dois, rr_titles
    if not IN_CSV.exists():
        raise SystemExit(f"{IN_CSV} not found.")
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--cached-matches', action='store_true',
                        help='Reclassify outcomes offline using matches in the existing summary')
    args = parser.parse_args(argv)
    previous = json.loads(OUT_DATA.read_text()) if args.cached_matches else None
    print("Reusing committed RR matches …" if args.cached_matches else f"Fetching Registered Reports Database (RRDB) from {RRDB_CSV_URL} …")
    rr_dois, rr_titles = cached_matches(previous) if args.cached_matches else fetch_rr_library()
    print(f"RRDB: {len(rr_dois)} DOIs, {len(rr_titles)} titles")

    # ── Load & split by study type ─────────────────────────────────────────────────
    df = pd.read_csv(IN_CSV, low_memory=False, na_values=["", "NA"])
    # Preserve source outcome codes; pandas also applies NA conversion after converters.
    for column, values in load_outcome_columns(IN_CSV).items():
        df[column] = values
    df["type_lc"] = df.get("type", pd.Series(dtype=str)).astype(str).str.lower()
    df["outcome_lc"] = df["outcome_replication"].astype(str).str.lower().str.strip()

    is_reproduction = df["type_lc"].str.contains("reproduc", na=False)
    is_replication = df["type_lc"].str.contains("replication", na=False) & ~is_reproduction
    df.loc[is_replication, "outcome_lc"] = df.loc[is_replication, "outcome_lc"].map(classify_outcome)

    repro_df = df[is_reproduction].copy()
    repro_dims = repro_df.apply(reproduction_dimensions, axis=1)
    repro_df["computational_bucket"] = repro_dims.apply(lambda t: t[0] or "not_coded")
    repro_df["robustness_bucket"] = repro_dims.apply(lambda t: t[1] or "not_coded")

    result = {
        "replication": compute_rr_result(df[is_replication], "outcome_lc", REPLICATION_OUTCOMES),
        "reproduction-numerical": compute_rr_result(
            repro_df[repro_df["computational_bucket"].isin(COMPUTATIONAL_BUCKETS)],
            "computational_bucket", COMPUTATIONAL_BUCKETS),
        "reproduction-robustness": compute_rr_result(
            repro_df[repro_df["robustness_bucket"].isin(ROBUSTNESS_BUCKETS)],
            "robustness_bucket", ROBUSTNESS_BUCKETS),
    }

    if previous:
        # Reproduction totals depend on outcome bucketing, so only replication totals must match exactly.
        new_dois, new_titles = cached_matches(result)
        old_dois, old_titles = cached_matches(previous)
        pair_counts = lambda r: {k: r['replication']['overview'][k] for k in ('n_total', 'n_rr', 'n_non_rr', 'n_unknown')}
        if (pair_counts(result) != pair_counts(previous)
                or not new_dois <= old_dois or not new_titles <= old_titles):
            raise ValueError('Cached matches changed RR coverage; retaining previous outputs')
    OUT_DATA.write_text(json.dumps(result), encoding="utf-8")
    if previous:
        print(f"Reclassified outcomes offline; RR coverage and metadata retained: {OUT_DATA}")
        return
    OUT_META.write_text(json.dumps({
        "last_updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "n_total": {k: v["overview"]["n_total"] for k, v in result.items()},
        "n_rr_library_items": len(rr_dois | rr_titles),
        "source": "scripts/compute_rr_status.py",
        "source_url": RRDB_SOURCE_URL,
        "source_citation": RRDB_CITATION,
    }, indent=2), encoding="utf-8")

    for kind, r in result.items():
        ov = r["overview"]
        print(f"{kind}: n_total={ov['n_total']}, rr={ov['n_rr']} ({ov['pct_rr']}%), "
              f"non_rr={ov['n_non_rr']}, unknown={ov['n_unknown']}")
    print(f"Written: {OUT_DATA}")


if __name__ == "__main__":
    import sys
    main(sys.argv[1:])
