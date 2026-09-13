"""
FLoRA × OpenCitations pipeline for the public Citation Impact Explorer.

Optimised for GitHub Actions:
- Uses FLoRA's own metadata (no OC metadata calls)
- Time-budgeted (exits cleanly before workflow timeout)
- Resumes from disk cache (committed between runs)
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import re
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

import numpy as np
import pandas as pd
import requests
import statsmodels.api as sm
from tqdm import tqdm

from split_originals import write_split

# ------------------------------------------------------------------ config
ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
CACHE_DIR = ROOT / "cache"
DATA_DIR.mkdir(exist_ok=True)
CACHE_DIR.mkdir(exist_ok=True)

FLORA_URL = "https://raw.githubusercontent.com/forrtproject/FReD-data/main/output/flora.csv"
REPRODUCTIONS_GSHEET_URL = (
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vT0VnLyrf9GCYXtN6l1DgaoLlg6H5r-08Op9eJzSripS1QBSHL031Arc27yUDe0YY7cB4TOnYMm2Vh1"
    "/pub?gid=984458430&single=true&output=csv"
)
OC_BASE = "https://opencitations.net/index/api/v2"
OC_META = "https://opencitations.net/meta/api/v1"
OC_KEY = os.environ.get("OC_API_KEY", "").strip()
EMAIL = os.environ.get("MY_EMAIL", "").strip()

CACHE_TTL_DAYS = 30
CURRENT_YEAR = datetime.now(timezone.utc).year
EVENT_WINDOW = (-10, 10)

MAX_RUNTIME_SECONDS = int(os.environ.get("MAX_RUNTIME_SECONDS", 5 * 3600))
START_TIME = time.time()

BASE_DELAY = 0.7
MAX_429_ATTEMPTS = 4
OUTCOMES_KEEP = {"successful", "failed", "mixed"}

# Accumulates run-level problems so meta.json can flag an incomplete run.
RUN_STATS = {
    "rep_fetch_error_dois": [],   # replications whose citations we couldn't fetch
    "originals_errored": 0,       # originals skipped because a replication fetch failed
    "originals_skipped": 0,       # originals skipped because their own fetch failed
}

session = requests.Session()
session.headers.update({"User-Agent": f"FLoRA-Explorer/1.0 ({EMAIL})"})
if OC_KEY:
    session.headers.update({"authorization": OC_KEY})


# ------------------------------------------------------------------ helpers
def time_left() -> float:
    return MAX_RUNTIME_SECONDS - (time.time() - START_TIME)


def should_stop(reserve_seconds: int = 600) -> bool:
    return time_left() < reserve_seconds


def doi_clean(s) -> str | None:
    if not isinstance(s, str):
        return None
    s = s.strip().lower()
    s = re.sub(r"^https?://(dx\.)?doi\.org/", "", s)
    s = re.sub(r"^doi:\s*", "", s)
    return s if s and s != "nan" else None


def doi_slug(doi: str) -> str:
    return hashlib.sha1(doi.encode()).hexdigest()[:16]


def cache_path(kind: str, doi: str) -> Path:
    return CACHE_DIR / kind / f"{doi_slug(doi)}.json"


def read_cache(p: Path) -> list | None:
    """Return the cached rows if the file exists, is in the new wrapped format
    ({"fetched_at": ISO, "rows": [...]}), and is within the TTL. Returns None
    for missing, unreadable, TTL-expired, or old-format (bare-list, no
    fetched_at) files so they refetch once and upgrade to the new format.

    TTL is measured from the embedded `fetched_at` timestamp rather than the
    file mtime, because a git checkout in CI resets mtime and would otherwise
    make every cached file look freshly written."""
    if not p.exists():
        return None
    try:
        payload = json.loads(p.read_text())
    except Exception:
        return None
    if not isinstance(payload, dict) or "fetched_at" not in payload:
        return None  # old bare-list format -> treat as stale, refetch & upgrade
    try:
        fetched = datetime.fromisoformat(payload["fetched_at"])
        age_days = (datetime.now(timezone.utc) - fetched).total_seconds() / 86400
    except Exception:
        return None
    if age_days >= CACHE_TTL_DAYS:
        return None
    rows = payload.get("rows")
    return rows if isinstance(rows, list) else None


def write_cache(p: Path, rows: list) -> None:
    p.write_text(json.dumps({
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "rows": rows,
    }))


def citing_key(citing: str) -> str:
    """Extract a stable identity key from an OpenCitations v2 composite `citing`
    string like 'omid:br/06... 10.1016/... openalex:w... pmid:...'. Prefer the
    OMID token (OpenCitations' canonical resource id); fall back to the DOI
    token (starts with '10.'); else the whole string lowercased. Idempotent, so
    it is safe to apply both when caching and when reading cached rows."""
    if not citing:
        return ""
    toks = str(citing).strip().split()
    for t in toks:
        if t.startswith("omid:"):
            return t
    for t in toks:
        tl = t[4:] if t.startswith("doi:") else t
        if tl.startswith("10."):
            return tl.lower()
    return str(citing).strip().lower()


def retry_after_seconds(resp, default: float, max_wait: float = 120.0) -> float:
    """Honor a Retry-After header, which may be either delta-seconds or an
    HTTP-date. Clamp to a sane maximum and fall back to `default` otherwise."""
    ra = resp.headers.get("Retry-After")
    if ra:
        ra = ra.strip()
        try:
            return min(max(float(ra), 0.0), max_wait)
        except ValueError:
            pass
        try:
            when = parsedate_to_datetime(ra)
            if when is not None:
                if when.tzinfo is None:
                    when = when.replace(tzinfo=timezone.utc)
                delta = (when - datetime.now(timezone.utc)).total_seconds()
                return min(max(delta, 0.0), max_wait)
        except (TypeError, ValueError):
            pass
    return default


def parse_year(s) -> int | None:
    if s is None or (isinstance(s, float) and np.isnan(s)):
        return None
    m = re.search(r"\b(19|20)\d{2}\b", str(s))
    return int(m.group(0)) if m else None

import json as _json

def parse_flora_authors(raw, max_n: int = 6) -> str:
    """Parse FLoRA author field (JSON-like) into a clean 'Family, G.; ...' string."""
    if raw is None or (isinstance(raw, float) and np.isnan(raw)):
        return ""
    s = str(raw).strip()
    if not s:
        return ""
    if not (s.startswith("[") or '"family"' in s or "'family'" in s):
        return s[:200]
    parsed = None
    try:
        parsed = _json.loads(s.replace("'", '"'))
    except Exception:
        # Regex fallback for malformed strings
        pairs = re.findall(
            r'"given"\s*:\s*"([^"]*)"[^}]*?"family"\s*:\s*"([^"]*)"'
            r'|"family"\s*:\s*"([^"]*)"[^}]*?"given"\s*:\s*"([^"]*)"'
            r'|"family"\s*:\s*"([^"]*)"',
            s,
        )
        parsed = []
        for g1, f1, f2, g2, f3 in pairs:
            parsed.append({"given": g1 or g2, "family": f1 or f2 or f3})

    if not isinstance(parsed, list):
        return s[:200]

    names = []
    for a in parsed:
        if not isinstance(a, dict):
            continue
        family = (a.get("family") or a.get("last") or "").strip()
        given = (a.get("given") or a.get("first") or "").strip()
        if not family:
            continue
        initials = " ".join(
            p[0].upper() + "." for p in given.split() if p
        ).strip()
        names.append(f"{family}, {initials}" if initials else family)

    if not names:
        return s[:200]
    if len(names) <= max_n:
        return "; ".join(names)
    return "; ".join(names[:max_n]) + f", … (+{len(names)-max_n})"

def clean_for_json(obj):
    """Recursively convert NaN / numpy types to JSON-safe values."""
    if isinstance(obj, dict):
        return {k: clean_for_json(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [clean_for_json(v) for v in obj]
    if isinstance(obj, float):
        if np.isnan(obj) or np.isinf(obj):
            return None
        return obj
    if isinstance(obj, np.floating):
        f = float(obj)
        return None if (np.isnan(f) or np.isinf(f)) else f
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, np.ndarray):
        return clean_for_json(obj.tolist())
    try:
        if pd.isna(obj):
            return None
    except (TypeError, ValueError):
        pass
    return obj


# ------------------------------------------------------------------ FLoRA
def fetch_text(url: str, attempts: int = 3, timeout: int = 60) -> str:
    """GET text via the shared session with a timeout and simple exponential
    backoff, so a transient blip doesn't hang or fail the long CI job."""
    last_err = None
    for attempt in range(1, attempts + 1):
        try:
            r = session.get(url, timeout=timeout)
            r.raise_for_status()
            return r.text
        except requests.exceptions.RequestException as e:
            last_err = e
            if attempt == attempts:
                break
            wait = 2 ** attempt
            print(f"  retry {attempt}/{attempts} for {url} in {wait}s: {e}")
            time.sleep(wait)
    raise SystemExit(f"Failed to fetch {url} after {attempts} attempts: {last_err}")


def fetch_reproduction_outcomes() -> dict:
    """Load the reproductions Google Sheet, returning normalised doi_r -> "computational,
    robustness" combined outcome string. FReD-data's pipeline now sources reproductions
    from this two-axis sheet but has a bug where that data never reaches flora.csv's
    single `outcome` column (bind_rows() silently drops it - see scripts/refresh_flora.py
    for the full rationale). Until that's fixed upstream, this backfills the same way
    refresh_flora.py does, since this script fetches FLORA_URL directly rather than
    reading the locally-patched data/flora.csv."""
    r = requests.get(REPRODUCTIONS_GSHEET_URL, timeout=60)
    r.raise_for_status()
    gsheet = pd.read_csv(io.StringIO(r.text), low_memory=False).fillna("")
    required = {"validation", "doi_r", "outcome_computational", "outcome_robustness"}
    missing = required - set(gsheet.columns)
    if missing:
        raise ValueError(f"Reproduction outcome sheet is missing columns: {sorted(missing)}")
    by_doi: dict[str, str] = {}
    for _, row in gsheet.iterrows():
        if str(row.get("validation") or "").strip().lower() == "validated - discarded":
            continue
        computational = str(row.get("outcome_computational") or "").strip()
        robustness = str(row.get("outcome_robustness") or "").strip()
        if not computational and not robustness:
            continue
        doi_key = doi_clean(row.get("doi_r", ""))
        if doi_key:
            by_doi[doi_key] = f"{computational}, {robustness}"
    if not by_doi:
        raise ValueError("Reproduction outcome sheet has no usable outcome records")
    return by_doi


def load_flora_raw() -> pd.DataFrame:
    """Fetch + parse FLoRA into the common column shape, before any type/outcome
    filtering - so both filter_replications() and filter_reproductions() can work
    from the same parsed frame."""
    print("Fetching FLoRA…")
    df = pd.read_csv(DATA_DIR / "flora.csv", low_memory=False) if (DATA_DIR / "flora.csv").exists() else pd.read_csv(io.StringIO(fetch_text(FLORA_URL)), low_memory=False)
    print(f"  {len(df)} rows; columns: {list(df.columns)[:14]}…")

    def find_col(names, required=True, default=None):
        for n in names:
            for c in df.columns:
                if c.lower() == n.lower():
                    return c
        if required:
            raise KeyError(f"None of {names} found in FLoRA columns")
        return default

    col_doi_o   = find_col(["doi_o"])
    col_doi_r   = find_col(["doi_r"])
    col_outcome = find_col(["result", "outcome", "result_class"], required=False)
    col_type    = find_col(["type", "study_type", "ref_type"], required=False)

    col_title_o = find_col(["title_o", "ref_o"], required=False)
    col_auth_o  = find_col(["author_o"], required=False)
    col_year_o  = find_col(["year_o"], required=False)
    col_journal_o = find_col(["journal_o"], required=False)

    col_title_r = find_col(["title_r", "ref_r"], required=False)
    col_auth_r  = find_col(["author_r"], required=False)
    col_year_r  = find_col(["year_r"], required=False)
    col_journal_r = find_col(["journal_r"], required=False)

    out = pd.DataFrame({
        "doi_o":     df[col_doi_o].map(doi_clean),
        "doi_r":     df[col_doi_r].map(doi_clean),
        "outcome":   df[col_outcome].astype(str).str.lower().str.strip() if col_outcome else "unknown",
        "type":      df[col_type].astype(str).str.lower().str.strip() if col_type else "replication",
        "title_o":   df[col_title_o] if col_title_o else "",
        "author_o":  df[col_auth_o] if col_auth_o else "",
        "year_o":    df[col_year_o] if col_year_o else None,
        "journal_o": df[col_journal_o] if col_journal_o else "",
        "title_r":   df[col_title_r] if col_title_r else "",
        "author_r":  df[col_auth_r] if col_auth_r else "",
        "year_r":    df[col_year_r] if col_year_r else None,
        "journal_r": df[col_journal_r] if col_journal_r else "",
    })

    is_reproduction = out["type"].str.contains("reproduc", na=False)
    missing_outcome = out["outcome"].isna() | out["outcome"].isin(["", "na", "nan"])
    needs_backfill = is_reproduction & missing_outcome
    if needs_backfill.any():
        try:
            by_doi = fetch_reproduction_outcomes()
            filled = out.loc[needs_backfill, "doi_r"].map(by_doi)
            out.loc[needs_backfill, "outcome"] = filled.combine_first(out.loc[needs_backfill, "outcome"])
            print(f"  Backfilled outcome for {filled.notna().sum()}/{needs_backfill.sum()} "
                  f"reproduction rows from the Google Sheet")
        except requests.exceptions.RequestException as e:
            print(f"  ! could not fetch reproduction outcomes ({e}); leaving outcome as-is")

    return out


def filter_replications(out: pd.DataFrame) -> pd.DataFrame:
    all_targets = out.groupby("doi_r")["doi_o"].nunique()
    n0 = len(out)
    out = out[out["type"].str.contains("replication", na=False)
              & ~out["type"].str.contains("reproduc", na=False)]
    out = out[out["outcome"].isin(OUTCOMES_KEEP)]
    out = out.dropna(subset=["doi_o", "doi_r"]).drop_duplicates(subset=["doi_o", "doi_r"])
    out["journal_r"] = out["journal_r"].replace("", np.nan)

    # Report size is based on all recorded pairs, before restricting outcomes.
    # It does not establish publication or peer-review status.
    n_originals_per_doi_r = all_targets
    out["n_originals_in_rep"] = out["doi_r"].map(n_originals_per_doi_r)
    out["pub_status"] = np.where(out["n_originals_in_rep"] > 3, "large_project", "individual")

    print(f"  Filtered: {n0} → {len(out)} (replications with known outcomes)")
    return out.reset_index(drop=True)


def load_flora() -> pd.DataFrame:
    """Back-compat: raw fetch + the replication filter, exactly as before this
    was split so build_study_data()'s event-study path is unaffected."""
    return filter_replications(load_flora_raw())


from classification import parse_reproduction_outcome



def filter_reproductions(out: pd.DataFrame) -> pd.DataFrame:
    """Reproduction rows with both DOIs present, so their citations can be fetched
    from OpenCitations the same way as replications. Unlike filter_replications(),
    outcome is not restricted to a fixed set here - callers bucket by the parsed
    computational/robustness dimension and drop the rows that carry no verdict on the
    dimension they're bucketing by."""
    is_repro = out["type"].str.contains("reproduc", na=False)
    repro = (out[is_repro]
             .dropna(subset=["doi_o", "doi_r"])
             .drop_duplicates(subset=["doi_o", "doi_r"])
             .copy())
    dims = repro["outcome"].apply(parse_reproduction_outcome)
    repro["computational_bucket"] = dims.apply(lambda t: t[0] or "not_coded")
    repro["robustness_bucket"] = dims.apply(lambda t: t[1] or "not_coded")
    return repro.reset_index(drop=True)


# ------------------------------------------------------------------ OpenCitations
def fetch_oc_citations(doi: str) -> list[dict] | None:
    cp = cache_path("oc", doi)
    cached = read_cache(cp)
    if cached is not None:
        # Normalise citing ids to the stable key at read time so pre-existing
        # cache files (which store the full composite string) stay valid.
        return [{"citing": citing_key(c.get("citing", "")), "year": c.get("year")}
                for c in cached]

    cp.parent.mkdir(exist_ok=True)
    url = f"{OC_BASE}/citations/doi:{doi}"

    for attempt in range(1, MAX_429_ATTEMPTS + 1):
        if should_stop(105):  # 45-second request plus 60 seconds to finish outputs
            return None
        try:
            r = session.get(url, timeout=45)
        except requests.exceptions.RequestException as e:
            # Network blips are transient — back off and retry like a 429.
            if attempt == MAX_429_ATTEMPTS:
                print(f"  ! network error {doi[:40]} (persistent): {e}")
                return None
            wait = BASE_DELAY * (2 ** attempt)
            if should_stop(105 + wait):
                return None
            time.sleep(wait)
            continue

        if r.status_code == 200:
            try:
                rows = r.json()
            except Exception:
                # A 200 whose body doesn't parse is transient (proxy/HTML error
                # page); treat as a failure and do NOT cache it as zero citations.
                print(f"  ! JSON parse error for {doi[:40]} (200); not caching")
                return None
            out = []
            for row in rows:
                citing = citing_key(str(row.get("citing", "")))
                creation = row.get("creation", "")
                year = None
                if creation and len(creation) >= 4 and creation[:4].isdigit():
                    year = int(creation[:4])
                if citing and year:
                    out.append({"citing": citing, "year": year})
            write_cache(cp, out)
            time.sleep(BASE_DELAY)
            return out

        if r.status_code == 404:
            write_cache(cp, [])
            time.sleep(BASE_DELAY)
            return []

        if r.status_code == 429 or r.status_code >= 500:
            # Rate limiting and server-side (5xx) errors are transient — back
            # off and retry within the same attempt budget.
            if attempt == MAX_429_ATTEMPTS:
                print(f"  · skip {doi[:40]} (persistent HTTP {r.status_code})")
                return None
            wait = retry_after_seconds(r, BASE_DELAY * (2 ** attempt))
            if should_stop(105 + wait):
                return None
            time.sleep(wait)
            continue

        # Other 4xx: not retryable.
        print(f"  ! HTTP {r.status_code} for {doi[:40]}")
        return None

    return None


def oc_entity_ids(doi: str) -> set[str]:
    """All identifiers OpenCitations groups under this DOI's bibliographic
    resource (its OMID). When an original and its replication share an OMID,
    OpenCitations returns the same citation list for both, so co-citation of the
    replication cannot be told apart from plain citation of the original. We use
    this to detect and drop such conflated replications."""
    cp = cache_path("oc_meta", doi)
    cached = read_cache(cp)
    if cached is not None:
        return set(cached)

    cp.parent.mkdir(exist_ok=True)
    url = f"{OC_META}/metadata/doi:{doi}"
    ids: set[str] = set()
    try:
        r = session.get(url, timeout=45)
    except requests.exceptions.RequestException:
        return ids  # transient: don't cache, retry next run

    if r.status_code != 200:
        # Non-200 without an exception (e.g. 429/5xx) must NOT be cached as an
        # empty id set, or the OMID-conflation check is silently defeated for
        # 30 days. Return the (empty) set without writing the cache.
        return ids
    try:
        for rec in r.json():
            ids.update(rec.get("id", "").split())
    except ValueError:
        return ids  # parse failure: transient, don't cache

    write_cache(cp, sorted(ids))
    time.sleep(BASE_DELAY)
    return ids


# ------------------------------------------------------------------ build per-study panel
def build_study_data(flora: pd.DataFrame) -> dict:
    studies = {}
    originals = sorted(flora["doi_o"].unique())
    print(f"Fetching citations for {len(originals)} originals…")

    meta_o_by_doi = (
        flora.groupby("doi_o")
        .agg(title=("title_o", "first"),
             author=("author_o", "first"),
             year=("year_o", "first"),
             venue=("journal_o", "first"))
        .to_dict("index")
    )

    n_skipped = 0
    conflated = []  # (doi_o, doi_r, kind) for replications OC can't tell from the original

    for doi_o in tqdm(originals):
        if should_stop():
            print(f"⏰ Time budget exhausted; stopping at {len(studies)} originals.")
            break

        meta_o = meta_o_by_doi.get(doi_o, {})
        cites_o = fetch_oc_citations(doi_o)
        if cites_o is None:
            n_skipped += 1
            RUN_STATS["originals_skipped"] += 1
            continue

        reps_df = flora[flora["doi_o"] == doi_o][
            ["doi_r", "outcome", "title_r", "author_r", "year_r", "pub_status"]
        ].drop_duplicates(subset=["doi_r"])

        co = {c["citing"] for c in cites_o}

        rep_info = []
        rep_citings_by_outcome = {"successful": set(), "failed": set(), "mixed": set()}
        rep_citings_by_pubstatus = {"individual": set(), "large_project": set(), "unpublished": set()}
        outcome_min_year: dict = {}
        pubstatus_min_year: dict = {}
        entity_o = None  # original's OMID identifier set, fetched only when needed
        n_conflated = 0
        rep_fetch_failed = False
        budget_exhausted = False

        for _, row in reps_df.iterrows():
            if should_stop():
                # Budget ran out partway through this original's replications.
                # Publishing it now would under-count its co-citations exactly
                # like a fetch failure, so treat it the same: mark incomplete,
                # skip it this run, and stop the outer loop so it retries next run.
                rep_fetch_failed = True
                budget_exhausted = True
                break
            doi_r = row["doi_r"]
            cites_r = fetch_oc_citations(doi_r)
            if cites_r is None:
                # A failed replication fetch would silently under-count this
                # original's co-citations (writing an artificially low number
                # while the run commits as "complete"). Skip the whole original
                # instead and retry it next run, so we never publish wrong counts.
                rep_fetch_failed = True
                RUN_STATS["rep_fetch_error_dois"].append(doi_r)
                break
            year_r = parse_year(row["year_r"])
            rep_info.append({
                "doi": doi_r,
                "year": year_r,
                "outcome": row["outcome"],
                "pub_status": row["pub_status"],
                "title": str(row["title_r"])[:300] if pd.notna(row["title_r"]) else "",
                "author": parse_flora_authors(row["author_r"]),
            })

            # Skip replications OpenCitations cannot distinguish from the
            # original — same DOI in FLoRA, or merged under one OMID. Their
            # citing set is identical to the original's, so counting them would
            # mark every citation of the original as a co-citation. The cheap
            # set-equality test is a necessary condition; the OMID lookup (only
            # run for those rare candidates) confirms it and spares genuine
            # coincidences where a few papers happen to cite both works.
            cr = {c["citing"] for c in cites_r}
            if doi_r == doi_o:
                conflated.append((doi_o, doi_r, "same-doi")); n_conflated += 1
                continue
            if cr and cr == co:
                if entity_o is None:
                    entity_o = oc_entity_ids(doi_o)
                if f"doi:{doi_r}" in entity_o:
                    conflated.append((doi_o, doi_r, "omid-merge")); n_conflated += 1
                    continue

            rep_citings_by_outcome[row["outcome"]].update(cr)
            rep_citings_by_pubstatus[row["pub_status"]].update(cr)
            if year_r is not None:
                outcome_min_year[row["outcome"]] = min(outcome_min_year.get(row["outcome"], year_r), year_r)
                pubstatus_min_year[row["pub_status"]] = min(pubstatus_min_year.get(row["pub_status"], year_r), year_r)

        if rep_fetch_failed:
            RUN_STATS["originals_errored"] += 1
            if budget_exhausted:
                print(f"⏰ Time budget exhausted mid-study; stopping at "
                      f"{len(studies)} originals (current original deferred).")
                break  # stop the outer loop; this original retries next run
            continue  # don't publish under-counted co-citations; retry next run

        cites_o = list({c["citing"]: c for c in cites_o}.values())
        per_year = {}
        for c in cites_o:
            y = c["year"]; citing = c["citing"]
            bucket = per_year.setdefault(y, {
                "only": 0, "with_successful": 0, "with_failed": 0,
                "with_mixed": 0, "with_multiple": 0, "with_any": 0,
            })
            cocited = {o for o, s in rep_citings_by_outcome.items() if citing in s}
            if not cocited:
                bucket["only"] += 1
            else:
                if len(cocited) > 1:
                    bucket["with_multiple"] += 1
                else:
                    bucket["with_" + next(iter(cocited))] += 1
                # Deduped: a citing work co-citing replications of two outcomes
                # counts once here, matching study-level n_cocitations.
                bucket["with_any"] += 1

        timeline = sorted([{"year": y, **v} for y, v in per_year.items()],
                          key=lambda x: x["year"])

        # A citing work can only be a co-citation once a replication exists to
        # be co-cited, so the fair denominator for a co-citation *rate* is not
        # the original's lifetime citation count but only the citations that
        # occurred on/after the earliest replication in that bucket. Otherwise
        # an original with a long pre-replication citation history (e.g. a
        # decades-old classic paired with a brand-new replication) gets an
        # artificially deflated rate purely from citation-years in which
        # co-citation was structurally impossible.
        def n_citations_since(min_year):
            return sum(1 for c in cites_o if c["year"] >= min_year) if min_year is not None else None

        cocit_by_outcome = {k: sum(1 for c in co if c in s)
                            for k, s in rep_citings_by_outcome.items()}
        cocit_by_pubstatus = {k: sum(1 for c in co if c in s)
                              for k, s in rep_citings_by_pubstatus.items()}
        # Distinct co-citing works, not summed across outcome buckets — a work
        # co-citing both a failed and a successful replication must only count
        # once towards the original's overall co-citation count.
        any_rep_citing = set().union(*rep_citings_by_outcome.values())
        n_cocitations = sum(1 for c in co if c in any_rep_citing)
        n_citations_post_by_outcome = {k: n_citations_since(outcome_min_year.get(k))
                                       for k in rep_citings_by_outcome}
        n_citations_post_by_pubstatus = {k: n_citations_since(pubstatus_min_year.get(k))
                                         for k in rep_citings_by_pubstatus}
        pubstatus_mix = dict(reps_df["pub_status"].value_counts())
        pubstatus_mix = {k: int(v) for k, v in pubstatus_mix.items()}

        rep_years = [r["year"] for r in rep_info if r["year"]]
        treat_year = min(rep_years) if rep_years else None
        n_citations_post_first_rep = n_citations_since(treat_year)

        first_outcome = None
        if rep_info:
            sorted_reps = sorted(
                rep_info, key=lambda r: (r["year"] is None, r["year"] or 9999)
            )
            first_outcome = sorted_reps[0]["outcome"]

        year_o = parse_year(meta_o.get("year"))
        title = str(meta_o.get("title") or "")[:300]
        author = parse_flora_authors(meta_o.get("author"))
        venue_raw = meta_o.get("venue")
        venue = str(venue_raw)[:200] if pd.notna(venue_raw) and str(venue_raw).strip().lower() not in {"nan", "na", "none"} else ""

        outcome_mix = dict(reps_df["outcome"].value_counts())
        outcome_mix = {k: int(v) for k, v in outcome_mix.items()}

        studies[doi_o] = {
            "doi": doi_o,
            "title": title,
            "author": author,
            "year": year_o,
            "venue": venue,
            "n_citations": len(cites_o),
            "n_citations_post_first_rep": n_citations_post_first_rep,
            "n_cocitations": n_cocitations,
            "replications": rep_info,
            "n_replications": len(rep_info),
            "outcome_mix": outcome_mix,
            "pubstatus_mix": pubstatus_mix,
            "cocit_by_outcome": cocit_by_outcome,
            "cocit_by_pubstatus": cocit_by_pubstatus,
            "n_citations_post_by_outcome": n_citations_post_by_outcome,
            "n_citations_post_by_pubstatus": n_citations_post_by_pubstatus,
            "first_replication_year": treat_year,
            "first_replication_outcome": first_outcome,
            "timeline": timeline,
        }
        if n_conflated:
            studies[doi_o]["cocit_conflated"] = n_conflated

    if n_skipped:
        print(f"  ({n_skipped} originals skipped due to API issues; will retry next run)")
    if RUN_STATS["originals_errored"]:
        print(f"  ({RUN_STATS['originals_errored']} originals errored: a replication's "
              f"citations could not be fetched; skipped to avoid under-counting, "
              f"will retry next run)")
    if conflated:
        same_doi = [c for c in conflated if c[2] == "same-doi"]
        merges = [c for c in conflated if c[2] == "omid-merge"]
        print(f"  ({len(conflated)} replications dropped as indistinguishable from "
              f"their original: {len(merges)} OMID merges, {len(same_doi)} same-DOI "
              f"FLoRA entries)")
        for o, r, kind in same_doi:
            print(f"    same-DOI in FReD-data (fix upstream): original == replication {r}")
        for o, r, kind in merges:
            print(f"    OpenCitations OMID merge: {o} <-> {r}")
    return studies


# ------------------------------------------------------------------ aggregate event-study
def build_panel(studies: dict) -> pd.DataFrame:
    rows = []
    for doi, s in studies.items():
        if s["year"] is None:
            continue
        y_min = s["year"]; y_max = CURRENT_YEAR
        # Distinct citing works per year. "only" and "with_any" are disjoint
        # (a work either co-cites no replication or is counted once in with_any),
        # so only+with_any avoids double-counting a work that co-cites
        # replications of two outcomes. Legacy fallback for timeline rows written
        # before with_any existed sums the (potentially overlapping) buckets.
        cite_by_year = {
            t["year"]: (t["only"] + t["with_any"]) if "with_any" in t
            else sum(t[k] for k in ("only", "with_successful", "with_failed", "with_mixed"))
            for t in s["timeline"]
        }
        # Use the deduped per-year count so a citing work co-citing replications
        # of two outcomes is not double-counted (matches study-level
        # n_cocitations). Fall back to the summed buckets for any older timeline
        # rows written before "with_any" existed.
        cocite_by_year = {
            t["year"]: t.get("with_any",
                             t["with_successful"] + t["with_failed"] + t["with_mixed"])
            for t in s["timeline"]
        }
        for y in range(y_min, y_max + 1):
            rows.append({
                "doi": doi, "year": y, "age": y - s["year"],
                "n_cit": cite_by_year.get(y, 0),
                "n_cocit": cocite_by_year.get(y, 0),
                "treat_year": s["first_replication_year"],
                "outcome": s["first_replication_outcome"],
            })
    if not rows:
        return pd.DataFrame(columns=["doi","year","age","n_cit","n_cocit",
                                      "treat_year","outcome","event_time","post"])
    panel = pd.DataFrame(rows)
    panel["event_time"] = panel["year"] - panel["treat_year"]
    panel["post"] = (panel["event_time"] >= 0).astype(int)
    return panel


def event_study(panel: pd.DataFrame, outcomes: list[str], depvar: str) -> dict:
    """
    Event-study with study + year fixed effects via manual two-way demeaning.
    Outcome is log(1+y); coefficients are interpreted as approx. log effects.
    Robust to thousands of units.
    """
    empty = {"event_time": [], "estimate": [], "ci_low": [], "ci_high": [],
             "att": None, "att_ci": None, "n_units": 0}
    if panel.empty or "outcome" not in panel.columns:
        return empty

    p = panel[panel["outcome"].isin(outcomes) & panel["treat_year"].notna()].copy()
    if p.empty:
        return empty

    lo, hi = EVENT_WINDOW
    p = p[p["event_time"].between(lo, hi)].copy()
    if p.empty or p["doi"].nunique() < 5:
        return empty | {"n_units": int(p["doi"].nunique())}

    p["y"] = np.log1p(p[depvar].astype(float))

    dummies = pd.get_dummies(p["event_time"].astype(int), prefix="et", drop_first=False)
    if "et_-1" in dummies.columns:
        dummies = dummies.drop(columns=["et_-1"])

    work_cols = ["y"] + list(dummies.columns)
    work = pd.concat([
        p[["doi", "year", "y"]].reset_index(drop=True),
        dummies.reset_index(drop=True).astype(float),
    ], axis=1)

    # Iterative two-way within transformation
    try:
        for _ in range(20):
            for grp in ["doi", "year"]:
                work[work_cols] = work[work_cols] - work.groupby(grp)[work_cols].transform("mean")
    except Exception as e:
        print(f"  ! demean fail ({outcomes}, {depvar}): {e}")
        return empty | {"n_units": int(p["doi"].nunique())}

    X = work[list(dummies.columns)].values
    y = work["y"].values
    try:
        ols = sm.OLS(y, X).fit(cov_type="cluster",
                                cov_kwds={"groups": p["doi"].values})
    except Exception as e:
        print(f"  ! event_study OLS fail ({outcomes}, {depvar}): {e}")
        return empty | {"n_units": int(p["doi"].nunique())}

    coef = dict(zip(dummies.columns, ols.params))
    se = dict(zip(dummies.columns, ols.bse))

    rows = []
    for t in range(lo, hi + 1):
        if t == -1:
            rows.append({"event_time": t, "estimate": 0.0, "ci_low": 0.0, "ci_high": 0.0})
            continue
        key = f"et_{t}"
        if key not in coef:
            continue
        b = float(coef[key]); s = float(se[key])
        rows.append({"event_time": t, "estimate": b,
                     "ci_low": b - 1.96 * s, "ci_high": b + 1.96 * s})

    post = [r for r in rows if r["event_time"] >= 0]
    att = float(np.mean([r["estimate"] for r in post])) if post else None
    att_ci = None
    if post:
        ses = [(r["ci_high"] - r["estimate"]) / 1.96 for r in post]
        avg_se = float(np.sqrt(np.mean(np.square(ses))) / np.sqrt(len(post)))
        att_ci = [att - 1.96 * avg_se, att + 1.96 * avg_se]

    return {
        "event_time": [r["event_time"] for r in rows],
        "estimate":   [r["estimate"]   for r in rows],
        "ci_low":     [r["ci_low"]     for r in rows],
        "ci_high":    [r["ci_high"]    for r in rows],
        "att": att, "att_ci": att_ci,
        "n_units": int(p["doi"].nunique()),
    }


def descriptive_trajectory(panel: pd.DataFrame, outcomes: list[str]) -> dict:
    if panel.empty or "outcome" not in panel.columns:
        return {"event_time": [], "mean_citations": [], "mean_cocitations": [], "n_units": []}
    p = panel[panel["outcome"].isin(outcomes) & panel["treat_year"].notna()]
    lo, hi = EVENT_WINDOW
    p = p[p["event_time"].between(lo, hi)]
    if p.empty:
        return {"event_time": [], "mean_citations": [], "mean_cocitations": [], "n_units": []}
    g = p.groupby("event_time").agg(
        cites=("n_cit", "mean"),
        cocites=("n_cocit", "mean"),
        n=("doi", "nunique"),
    ).reset_index()
    return {
        "event_time":      g["event_time"].tolist(),
        "mean_citations":  g["cites"].round(3).tolist(),
        "mean_cocitations":g["cocites"].round(3).tolist(),
        "n_units":         g["n"].tolist(),
    }


PUBSTATUS_LABELS = ["individual", "large_project"]
OUTCOME_LABELS = ["successful", "failed", "mixed"]


def compute_cocit_breakdown(studies: dict) -> dict:
    """Co-citation rate of each original, broken down by a property of its
    replication(s) (publication status, or outcome). An original with e.g.
    both a failed and a successful replication contributes its rate to both
    the "failed" and "successful" rows — the rate is per original, not per
    replication, since co-citation can only be measured against the pooled
    set of citations to the original. The denominator is citations to the
    original since the earliest replication in that bucket was published
    (see n_citations_since in build_study_data) — not lifetime citations —
    since co-citation is structurally impossible before a replication exists.
    """
    def summarize(dim_key: str, denom_key: str, labels: list[str]) -> dict:
        out = {}
        for label in labels:
            rates, n_cocit_sum, n_cit_sum = [], 0, 0
            for s in studies.values():
                mix_key = "outcome_mix" if dim_key == "cocit_by_outcome" else "pubstatus_mix"
                if not s.get(mix_key, {}).get(label):
                    continue
                n_cit = s[denom_key].get(label)
                if not n_cit:
                    continue
                n_cocit = s[dim_key].get(label, 0)
                rates.append(n_cocit / n_cit)
                n_cocit_sum += n_cocit
                n_cit_sum += n_cit
            out[label] = {
                "n_originals": len(rates),
                "mean_rate": round(float(np.mean(rates)), 4) if rates else None,
                "median_rate": round(float(np.median(rates)), 4) if rates else None,
                "grand_mean_rate": round(n_cocit_sum / n_cit_sum, 4) if n_cit_sum else None,
            }
        return out

    return {
        "pub_status": summarize("cocit_by_pubstatus", "n_citations_post_by_pubstatus", PUBSTATUS_LABELS),
        "outcome": summarize("cocit_by_outcome", "n_citations_post_by_outcome", OUTCOME_LABELS),
    }


def compute_reproduction_citations(repro: pd.DataFrame) -> dict:
    """Descriptive citation counts by assessed reproduction dimension.

    Original and reproduction reports are counted once per outcome bucket. A
    shared report can occur in several buckets; those totals are not additive.
    Failed lookups abort the summary rather than substituting zero citations.
    No reproduction event-study model is fitted.
    """
    citation_cache = {}
    entity_cache = {}
    def required_citations(doi):
        if doi not in citation_cache:
            if should_stop(60):
                raise RuntimeError("Time budget exhausted; retaining previous reproduction summary")
            rows = fetch_oc_citations(doi)
            if rows is None:
                raise RuntimeError(f"Citation lookup failed for {doi}; retaining previous reproduction summary")
            citation_cache[doi] = {citing_key(c["citing"]) for c in rows if c.get("citing")}
        return citation_cache[doi]

    def bucket_stats(bucket_col: str, buckets: list[str]) -> dict:
        out = {}
        for b in buckets:
            sub = repro[repro[bucket_col] == b]
            n_citations_o = 0
            n_citations_r = sum(len(required_citations(doi)) for doi in sub["doi_r"].unique())
            n_cocitations = 0
            for doi_o, grp in sub.groupby("doi_o"):
                co = required_citations(doi_o)
                n_citations_o += len(co)
                rep_citing = set()
                for _, row in grp.iterrows():
                    if row["doi_r"] != doi_o:
                        cr = required_citations(row["doi_r"])
                        if cr and cr == co:
                            if doi_o not in entity_cache:
                                if should_stop(105):
                                    raise RuntimeError("Time budget exhausted; retaining previous reproduction summary")
                                ids = oc_entity_ids(doi_o)
                                if not ids:
                                    raise RuntimeError("Cannot verify merged citation records; retaining previous reproduction summary")
                                entity_cache[doi_o] = ids
                            if f"doi:{row['doi_r']}" in entity_cache[doi_o]:
                                continue
                        rep_citing.update(cr)
                n_cocitations += sum(1 for c in co if c in rep_citing)
            out[b] = {
                "n_originals": int(sub["doi_o"].nunique()),
                "n_citations_to_original": int(n_citations_o),
                "n_citations_to_reproduction": int(n_citations_r),
                "n_cocitations": int(n_cocitations),
            }
        return out

    return {
        "reproduction-numerical": bucket_stats("computational_bucket", ["successful", "issues", "technical_failure"]),
        "reproduction-robustness": bucket_stats("robustness_bucket", ["robust", "challenges"]),
    }


def write_outputs(studies: dict, flora: pd.DataFrame, partial: bool = False):
    if not studies:
        raise RuntimeError("No complete originals; retaining the previous citation outputs")
    panel = build_panel(studies)
    aggregate = {}
    for label, outcomes in [
        ("all", ["successful", "failed", "mixed"]),
        ("failed", ["failed"]),
        ("successful", ["successful"]),
        ("mixed", ["mixed"]),
    ]:
        aggregate[label] = {
            "descriptive":       descriptive_trajectory(panel, outcomes),
            "citations_model":   event_study(panel, outcomes, "n_cit"),
            "cocitations_model": event_study(panel, outcomes, "n_cocit"),
        }

    originals_index = []
    for doi, s in studies.items():
        originals_index.append({
            "doi": doi,
            "title": s["title"], "author": s["author"], "year": s["year"],
            "venue": s["venue"],
            "n_citations": s["n_citations"], "n_citations_post_first_rep": s["n_citations_post_first_rep"],
            "n_cocitations": s["n_cocitations"], "n_replications": s["n_replications"],
            "outcome_mix": s["outcome_mix"],
            "pubstatus_mix": s["pubstatus_mix"],
            "first_replication_year": s["first_replication_year"],
            "first_replication_outcome": s["first_replication_outcome"],
        })

    meta = {
        "last_updated": datetime.now(timezone.utc).isoformat(),
        "n_originals": len(studies),
        "n_replications": int(flora.shape[0]),
        "outcome_counts": {k: int(v) for k, v in flora["outcome"].value_counts().items()},
        "pub_status_counts": {k: int(v) for k, v in flora["pub_status"].value_counts().items()},
        "partial_run": partial,
        "fetch_errors": len(RUN_STATS["rep_fetch_error_dois"]),
        "fetch_error_dois": RUN_STATS["rep_fetch_error_dois"][:50],
        "originals_errored": RUN_STATS["originals_errored"],
        "originals_skipped": RUN_STATS["originals_skipped"],
    }
    (DATA_DIR / "meta.json").write_text(
        json.dumps(clean_for_json(meta), indent=2, allow_nan=False))
    clean_studies = clean_for_json(studies)
    clean_index = clean_for_json(originals_index)
    (DATA_DIR / "originals.json").write_text(
        json.dumps({"studies": clean_studies, "index": clean_index},
                   allow_nan=False))
    write_split(clean_studies, clean_index, DATA_DIR)
    (DATA_DIR / "aggregate.json").write_text(
        json.dumps(clean_for_json(aggregate), indent=2, allow_nan=False))
    (DATA_DIR / "cocit_breakdown.json").write_text(
        json.dumps(clean_for_json(compute_cocit_breakdown(studies)), indent=2, allow_nan=False))
    print(f"✔ wrote {len(studies)} studies "
          f"({'partial' if partial else 'complete'} run)")


# ------------------------------------------------------------------ main
def main():
    raw = load_flora_raw()
    flora = filter_replications(raw)
    studies = {}
    partial = True
    try:
        studies = build_study_data(flora)
        # A run is partial if it ran out of time, skipped originals whose own
        # fetch failed, or errored originals because a replication fetch failed.
        partial = (should_stop()
                   or RUN_STATS["originals_errored"] > 0
                   or RUN_STATS["originals_skipped"] > 0)
    except KeyboardInterrupt:
        print("⛔ interrupted")
    finally:
        write_outputs(studies, flora, partial=partial)
    print(f"Done. {len(studies)} originals processed.")

    # Reproductions: a small, separate, best-effort addition. Wrapped so any failure
    # here can never affect the replication pipeline above, which has already written
    # its outputs by this point.
    if should_stop(60):
        print("⏰ low on time budget; skipping reproduction citation stats this run.")
    else:
        try:
            repro = filter_reproductions(raw)
            repro_result = compute_reproduction_citations(repro)
            (DATA_DIR / "reproduction_citations.json").write_text(
                json.dumps(clean_for_json(repro_result), indent=2, allow_nan=False))
            (DATA_DIR / "reproduction_citations_meta.json").write_text(json.dumps({
                "last_updated": datetime.now(timezone.utc).isoformat(),
                "input_snapshot": json.loads((DATA_DIR / "flora_meta.json").read_text())["last_updated"],
                "source": "OpenCitations; cached citation coverage varies by report",
            }, indent=2))
            print(f"✔ wrote reproduction citation stats ({len(repro)} reproduction rows)")
        except Exception as e:
            print(f"! reproduction citation stats failed (non-fatal): {e}")


if __name__ == "__main__":
    main()
