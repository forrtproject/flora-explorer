"""
Enrich the FLoRA dataset with the lifetime OpenAlex Mean Citedness (OMC) of each
original study's journal: its total citations divided by its total papers, all years.

Produces data/flora_with_omc.csv with the columns of flora.csv plus:
  - openalex_venue_id   (string, may be empty if no match)
  - openalex_venue_name (string)
  - impact_factor       (float, lifetime cited_by_count / works_count; blank when set aside)
  - omc_works           (papers the journal has published in all years)
  - omc_status          (ok / no_match / no_omc / too_few_papers / placeholder_record)

The OMC value is what feeds the Mean Citedness analysis rendered by R.

OpenAlex is free and does not require an API key, but it asks for a contact
email in the User-Agent string. Set MY_EMAIL via repo secrets to be polite.

Designed for GitHub Actions with a per-run time budget and on-disk caching of
venue lookups (cache/openalex_venues.json) so weekly runs are fast.
"""
from __future__ import annotations

import csv
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
CACHE_DIR = ROOT / "cache"
DATA_DIR.mkdir(exist_ok=True)
CACHE_DIR.mkdir(exist_ok=True)

IN_CSV = DATA_DIR / "flora.csv"
OUT_CSV = DATA_DIR / "flora_with_omc.csv"
CACHE_FILE = CACHE_DIR / "openalex_venues.json"

EMAIL = os.environ.get("MY_EMAIL", "").strip() or "noreply@example.org"
# Without a key OpenAlex allows a small daily credit budget per IP (a search costs 10 credits).
API_KEY = os.environ.get("OPENALEX_API_KEY", "").strip()
AUTH = {"api_key": API_KEY} if API_KEY else {}
SESSION = requests.Session()
SESSION.headers.update({"User-Agent": f"FLoRA-Explorer/1.0 (mailto:{EMAIL})"})

OPENALEX_SOURCES = "https://api.openalex.org/sources"
OPENALEX_WORKS = "https://api.openalex.org/works"
BASE_DELAY = 0.12  # OpenAlex allows ~10 req/s with mailto
ID_BATCH = 50

# A mean over fewer papers is unreliable.
MIN_WORKS = 20
# Journal-level DOIs indexed as "paratext" works collect citations meant for the whole journal.
PLACEHOLDER_MIN_CITATIONS = 100
PLACEHOLDER_MAX_SHARE = 0.10
JUMP_FACTOR = 2.0
# Matches are re-checked so merged or re-identified OpenAlex sources are picked up; misses
# sooner, since OpenAlex keeps adding journals. Entries without a check date count as expired.
MATCH_MAX_AGE_DAYS = 90
MISS_MAX_AGE_DAYS = 30
# OpenAlex's free daily budget covers about 100 searches, so expired matches are re-checked
# oldest first, a few per run; journals not yet in the cache are always looked up.
MAX_RECHECKS_PER_RUN = 50
JUMP_MIN_CHANGE = 1.0

# Per-run time budget (mirrors refresh_data.py's should_stop pattern) so a slow
# run saves its lookup cache and retains complete published outputs if time runs out.
MAX_RUNTIME_SECONDS = int(os.environ.get("MAX_RUNTIME_SECONDS", 3 * 3600))
START_TIME = time.time()


def should_stop(reserve_seconds: int = 300) -> bool:
    return (time.time() - START_TIME) > (MAX_RUNTIME_SECONDS - reserve_seconds)


def normalize_name(name: str) -> str:
    if not name:
        return ""
    s = name.lower().strip()
    s = re.sub(r"\s+", " ", s)
    s = re.sub(r"[^\w\s&:,.\-/]", "", s)
    return s


def today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def cache_entry_fresh(key: str, value, now: datetime | None = None) -> bool:
    if not isinstance(value, dict) or not value.get("checked"):
        return False
    try:
        checked = datetime.fromisoformat(value["checked"]).replace(tzinfo=timezone.utc)
    except ValueError:
        return False
    if value.get("id"):
        if not names_match(key, value.get("display_name", "")):
            return False
        max_age = MATCH_MAX_AGE_DAYS
    else:
        max_age = MISS_MAX_AGE_DAYS
    return ((now or datetime.now(timezone.utc)) - checked).days < max_age


def load_cache() -> dict:
    """Journal-name matches and misses of any age; main() decides which to look up again."""
    if CACHE_FILE.exists():
        try:
            cache = json.loads(CACHE_FILE.read_text(encoding="utf-8"))
            out = {}
            for key, value in cache.items():
                value = value or {"id": None}
                if (value.get("id") or value.get("display_name")) and not names_match(key, value.get("display_name", "")):
                    continue
                out[key] = {k: value[k] for k in ("id", "display_name", "checked") if k in value}
            return out
        except Exception:
            pass
    return {}


def save_cache(cache: dict) -> None:
    # Write to a temp file then atomically replace, so a crash mid-write can't
    # truncate the committed cache/openalex_venues.json.
    tmp = CACHE_FILE.with_name(CACHE_FILE.name + ".tmp")
    tmp.write_text(json.dumps(cache, indent=2), encoding="utf-8")
    os.replace(tmp, CACHE_FILE)


def name_tokens(s: str) -> set[str]:
    return set(re.sub(r"[^\w\s]", " ", normalize_name(s)).split())


def names_match(query: str, display: str) -> bool:
    """Require the same distinctive words; generic journal words are insufficient."""
    q, d = name_tokens(query), name_tokens(display)
    if not q or not d:
        return False
    if q == d:
        return True
    # Journal, International, and subject words distinguish real source titles.
    generic = {"the", "and"}
    return bool(q - generic) and q - generic == d - generic


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


def lookup_venue(name: str, cache: dict) -> dict | None:
    """Resolve a journal name to an OpenAlex Source."""
    key = normalize_name(name)
    if not key:
        return None
    if key in cache:
        return cache[key]

    # Fuzzy search on display_name, restricted to journal-like sources.
    params = {
        "search": name,
        "per-page": "1",
        "filter": "type:journal|conference|repository|ebook platform",
        "mailto": EMAIL,
        **AUTH,
    }

    r = None
    for attempt in range(1, 4):
        try:
            r = SESSION.get(OPENALEX_SOURCES, params=params, timeout=30)
        except requests.exceptions.RequestException as e:
            if attempt == 3:
                print(f"  ! network error for {name[:60]}: {e}")
                return None  # transient: do NOT cache, retry next run
            time.sleep(2 ** attempt)
            continue
        if r.status_code == 429 or r.status_code >= 500:
            # Rate limiting and server-side (5xx) errors are transient — back
            # off and retry within the same attempt budget.
            if attempt == 3:
                print(f"  ! persistent HTTP {r.status_code} for {name[:60]}")
                return None  # transient: do NOT cache
            wait = retry_after_seconds(r, 2.0 * attempt)
            time.sleep(wait)
            continue
        break

    if r is None or r.status_code != 200:
        # Transient HTTP error (5xx etc.): do NOT cache, so it retries next run.
        print(f"  ! HTTP {getattr(r, 'status_code', 'none')} for {name[:60]}")
        return None

    try:
        results = r.json().get("results", [])
    except ValueError:
        return None  # transient parse failure: do NOT cache

    if not results:
        cache[key] = {"id": None, "checked": today()}  # genuine 200-with-no-results: cache the miss
        return None

    src = results[0]
    display = src.get("display_name") or ""
    if not names_match(name, display):
        # Fuzzy top hit is unrelated to the queried journal — record a miss
        # rather than attaching a wrong venue/impact factor.
        print(f"  ~ weak match for {name[:50]!r} -> {display[:50]!r}; recording miss")
        cache[key] = {"id": None, "checked": today()}
        return None

    entry = {"id": src.get("id"), "display_name": src.get("display_name"), "checked": today()}
    cache[key] = entry
    time.sleep(BASE_DELAY)
    return entry


def openalex_get(url: str, params: dict) -> dict:
    """GET with the lookup retry policy; raises after three transient failures."""
    for attempt in range(1, 4):
        try:
            r = SESSION.get(url, params={**params, "mailto": EMAIL, **AUTH}, timeout=60)
        except requests.exceptions.RequestException:
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)
            continue
        if r.status_code == 429 or r.status_code >= 500:
            if attempt == 3:
                r.raise_for_status()
            time.sleep(retry_after_seconds(r, 2.0 * attempt))
            continue
        r.raise_for_status()
        time.sleep(BASE_DELAY)
        return r.json()
    raise RuntimeError("unreachable")


def short_id(openalex_id: str) -> str:
    return openalex_id.rsplit("/", 1)[-1]


def fetch_source_stats(ids: list[str]) -> dict:
    """Lifetime citations and papers for each source, fetched fresh by ID every run."""
    stats = {}
    for i in range(0, len(ids), ID_BATCH):
        batch = ids[i:i + ID_BATCH]
        data = openalex_get(OPENALEX_SOURCES, {
            "filter": "ids.openalex:" + "|".join(short_id(s) for s in batch),
            "per-page": str(ID_BATCH), "select": "id,works_count,cited_by_count"})
        for src in data.get("results", []):
            works, cites = src.get("works_count") or 0, src.get("cited_by_count") or 0
            stats[src["id"]] = {"impact_factor": cites / works if works else None,
                                "works": works, "cited_by_count": cites}
    return stats


def fetch_placeholders(ids: list[str]) -> dict:
    """Heavily cited paratext records per source, from any year."""
    found: dict[str, list[dict]] = {}
    for i in range(0, len(ids), ID_BATCH):
        batch = ids[i:i + ID_BATCH]
        cursor = "*"
        while cursor:
            data = openalex_get(OPENALEX_WORKS, {
                "filter": ",".join([
                    "primary_location.source.id:" + "|".join(short_id(s) for s in batch),
                    "type:paratext", f"cited_by_count:>{PLACEHOLDER_MIN_CITATIONS - 1}"]),
                "per-page": "200", "cursor": cursor, "select": "id,doi,cited_by_count,primary_location"})
            results = data.get("results", [])
            for work in results:
                source = ((work.get("primary_location") or {}).get("source") or {}).get("id")
                if source:
                    found.setdefault(source, []).append(
                        {"id": work.get("id"), "doi": work.get("doi"), "cited_by_count": work.get("cited_by_count")})
            cursor = (data.get("meta") or {}).get("next_cursor") if results else None
    return found


def placeholder_share(stats: dict, placeholders: list | None) -> float:
    """Largest placeholder's share of all the journal's citations."""
    if not placeholders:
        return 0.0
    top = max(w.get("cited_by_count") or 0 for w in placeholders)
    total = stats.get("cited_by_count") or 0
    return 1.0 if total <= 0 else top / total


def omc_status(stats: dict | None, placeholders: list | None) -> str:
    if not stats or stats.get("impact_factor") is None:
        return "no_omc"
    if placeholder_share(stats, placeholders) >= PLACEHOLDER_MAX_SHARE:
        return "placeholder_record"
    if stats["works"] < MIN_WORKS:
        return "too_few_papers"
    return "ok"


def lookups_due(journals: list[str], cache: dict, now: datetime | None = None) -> list[str]:
    """Uncached journals, then the oldest expired matches up to MAX_RECHECKS_PER_RUN."""
    new = [j for j in journals if normalize_name(j) not in cache]
    expired = [j for j in journals if normalize_name(j) in cache
               and not cache_entry_fresh(normalize_name(j), cache[normalize_name(j)], now)]
    expired.sort(key=lambda j: cache[normalize_name(j)].get("checked") or "")
    return new + expired[:MAX_RECHECKS_PER_RUN]


def omc_jumps(previous: dict, current: dict) -> list[tuple[str, float, float]]:
    """Sources whose OMC changed by JUMP_FACTOR or more since the previous snapshot."""
    jumps = []
    for source, new in current.items():
        old = previous.get(source)
        if old is None or new is None or abs(new - old) < JUMP_MIN_CHANGE:
            continue
        if min(old, new) == 0 or max(old, new) / min(old, new) >= JUMP_FACTOR:
            jumps.append((source, old, new))
    return sorted(jumps)


def previous_omc(path: Path) -> dict:
    if not path.exists():
        return {}
    with path.open(encoding="utf-8", newline="") as f:
        out = {}
        for row in csv.DictReader(f):
            try:
                out[row["openalex_venue_id"]] = float(row["impact_factor"])
            except (KeyError, TypeError, ValueError):
                continue
        return out


def warn(message: str) -> None:
    # The ::warning:: prefix surfaces the line as an annotation on the GitHub Actions run.
    print(f"::warning::{message}" if os.environ.get("GITHUB_ACTIONS") else f"  ! {message}")


def load_disciplines() -> dict:
    """journal name (lowercase, trimmed) -> discipline, from data/disciplines.json's
    {discipline: [journal, ...]} shape."""
    path = DATA_DIR / "disciplines.json"
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    mapping = {}
    for discipline, journals in data.items():
        for j in journals:
            mapping[str(j).strip().lower()] = discipline
    return mapping


from classification import REPLICATION_COLUMNS, add_outcome_columns, reproduction_dimensions



def compute_reproduction_impact_stats(rows: list[dict]) -> None:
    """Write descriptive journal Mean Citedness summaries for each reproduction dimension.

    No reproduction model is fitted. Unchecked dimensions and unmatched journals
    are excluded independently, and the two assessed subsets can overlap.
    """
    discipline_map = load_disciplines()
    repro_rows = []
    set_aside_rows = []
    for row in rows:
        if "reproduc" not in (row.get("type") or "").lower():
            continue
        computational, robustness = reproduction_dimensions(row)
        if row.get("omc_status") in ("too_few_papers", "placeholder_record"):
            set_aside_rows.append({"status": row["omc_status"], "computational": computational,
                                   "robustness": robustness})
        try:
            impact = float(row.get("impact_factor") or "")
        except ValueError:
            impact = None
        journal = (row.get("journal_o") or "").strip()
        repro_rows.append({
            "impact_factor": impact,
            "journal": journal,
            "discipline": discipline_map.get(journal.lower(), "Uncategorized"),
            "computational": computational or "not_coded",
            "robustness": robustness or "not_coded",
        })

    def build_dimension(bucket_key: str, buckets: list[str]) -> dict:
        # Rows without an actual verdict on this dimension ("not checked"/uncoded) are
        # dropped rather than kept as their own bucket - they say nothing about it. Applied
        # per dimension, so a reproduction whose robustness was never checked still counts
        # toward the computational breakdown.
        with_verdict = [r for r in repro_rows if r[bucket_key] in buckets]
        rows = [r for r in with_verdict if r["impact_factor"] is not None]
        journals = {r["journal"] for r in rows if r["journal"]}
        disciplines = {r["discipline"] for r in rows if r["discipline"] != "Uncategorized"}
        overview = {"n_total": len(rows), "n_input": len(with_verdict),
                    "n_excluded": len(with_verdict) - len(rows),
                    "n_journals": len(journals), "n_disciplines": len(disciplines)}
        for b in buckets:
            overview[f"n_{b}"] = sum(1 for r in rows if r[bucket_key] == b)

        top = max((r["impact_factor"] for r in rows), default=0)
        breaks = [i * 0.5 for i in range(int(top // 0.5) + 2)]  # Matches the R histogram's bins.
        histogram = []
        for lo, hi in zip(breaks[:-1], breaks[1:]):
            counts = {b: 0 for b in buckets}
            for r in rows:
                if lo <= r["impact_factor"] < hi:
                    counts[r[bucket_key]] += 1
            histogram.append({"bin_lo": lo, "bin_hi": hi, **counts})

        aside = [r["status"] for r in set_aside_rows if r[bucket_key] in buckets]
        return {
            "overview": overview,
            "set_aside": {"too_few_papers": aside.count("too_few_papers"),
                          "placeholder_record": aside.count("placeholder_record"),
                          "min_works": MIN_WORKS},
            "histogram": histogram,
            "stats": {"edf": None, "chi_sq": None, "p_val": None, "r2": None, "n_model": 0},
            "gam_curve": [],
            "jitter": [],
        }

    result = {
        "reproduction-numerical": build_dimension("computational", ["successful", "issues", "technical_failure"]),
        "reproduction-robustness": build_dimension("robustness", ["robust", "challenges"]),
    }
    out_path = DATA_DIR / "impact_factor_reproductions.json"
    out_path.write_text(json.dumps(result), encoding="utf-8")
    print(f"✔ Wrote {out_path.relative_to(ROOT)} "
          f"(numerical n={result['reproduction-numerical']['overview']['n_total']}, "
          f"robustness n={result['reproduction-robustness']['overview']['n_total']})")


def main():
    if not IN_CSV.exists():
        raise SystemExit(f"{IN_CSV} not found. Run refresh_flora.py first.")

    cache = load_cache()

    with IN_CSV.open(encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        rows = add_outcome_columns(list(reader))
        base_columns = list(reader.fieldnames or [])
    base_columns += [c for c in REPLICATION_COLUMNS if c not in base_columns and rows and c in rows[0]]

    extra_cols = ["openalex_venue_id", "openalex_venue_name", "impact_factor", "omc_works", "omc_status"]
    out_columns = list(base_columns) + [c for c in extra_cols if c not in base_columns]

    unique_journals = sorted({(r.get("journal_o") or "").strip() for r in rows if (r.get("journal_o") or "").strip()})
    print(f"{len(unique_journals)} unique journals to resolve "
          f"(cache has {len(cache)} entries)")

    new_lookups = 0
    transient_errors = 0
    partial = False
    due = lookups_due(unique_journals, cache)
    for i, j in enumerate(due, 1):
        key = normalize_name(j)
        if should_stop():
            print(f"⏰ Time budget reached at {i}/{len(due)}; "
                  f"retaining the previous complete enrichment.")
            partial = True
            break
        previous = cache.pop(key, None)
        lookup_venue(j, cache)
        # A lookup that neither cached a hit nor a genuine miss was a
        # transient failure (network / 429 / 5xx / parse).
        if key not in cache:
            transient_errors += 1
            if previous:
                cache[key] = previous  # Keep the expired match until a lookup succeeds.
        new_lookups += 1
        if new_lookups % 50 == 0:
            save_cache(cache)
            print(f"  resolved {new_lookups} new or expired journals ({i}/{len(due)})")

    save_cache(cache)
    print(f"✔ {new_lookups} new or expired venues looked up; cache size now {len(cache)}")

    if partial:
        sys.exit("Time budget exhausted; cache saved, previous enrichment outputs retained")

    # A widespread OpenAlex outage would otherwise yield an incompletely
    # enriched CSV with a fresh timestamp. Exit nonzero (cache already saved,
    # CSV unwritten) so the workflow fails instead of committing it as fresh.
    if new_lookups >= 10 and transient_errors / new_lookups > 0.5:
        sys.exit(f"✗ {transient_errors}/{new_lookups} venue lookups failed "
                 f"transiently - OpenAlex looks unhealthy, aborting run")

    entries = {j: cache.get(normalize_name(j)) for j in unique_journals}
    source_ids = sorted({e["id"] for e in entries.values() if e and e.get("id")})
    try:
        stats = fetch_source_stats(source_ids)
        placeholders = fetch_placeholders(source_ids)
    except (requests.exceptions.RequestException, ValueError) as e:
        sys.exit(f"✗ OpenAlex source refresh failed ({e}); previous enrichment outputs retained")
    # A few IDs can vanish when OpenAlex merges sources; losing most of them means an outage.
    if source_ids and len(stats) < 0.9 * len(source_ids):
        sys.exit(f"✗ OpenAlex returned {len(stats)}/{len(source_ids)} sources; previous enrichment outputs retained")

    status = {s: omc_status(stats.get(s), placeholders.get(s)) for s in source_ids}
    for s in source_ids:
        if s in placeholders and s in stats:
            top = max(placeholders[s], key=lambda w: w["cited_by_count"] or 0)
            action = "OMC set aside" if status[s] == "placeholder_record" else "OMC kept"
            warn(f"{action} for {s}: placeholder record {top['doi'] or top['id']} has "
                 f"{top['cited_by_count']} citations, {placeholder_share(stats[s], placeholders[s]):.0%} of the journal's total")
    for s, old, new in omc_jumps(previous_omc(OUT_CSV),
                                 {s: stats[s]["impact_factor"] for s in source_ids if status[s] == "ok"}):
        warn(f"OMC for {s} moved from {old:.2f} to {new:.2f} since the previous snapshot; check it")

    enriched = 0
    for row in rows:
        j = (row.get("journal_o") or "").strip()
        entry = entries.get(j) if j else None
        source = (entry or {}).get("id") or ""
        row["openalex_venue_id"] = source
        row["openalex_venue_name"] = (entry or {}).get("display_name") or ""
        row["omc_status"] = status.get(source, "no_match")
        row["omc_works"] = stats[source]["works"] if source in stats else ""
        if_val = stats[source]["impact_factor"] if row["omc_status"] == "ok" else None
        row["impact_factor"] = "" if if_val is None else f"{if_val:.4f}"
        if if_val is not None:
            enriched += 1
    set_aside = {k: sum(r["omc_status"] == k for r in rows) for k in ("too_few_papers", "placeholder_record")}
    print(f"  OMC set aside: {set_aside['too_few_papers']} rows from journals with fewer than "
          f"{MIN_WORKS} papers in total, "
          f"{set_aside['placeholder_record']} rows from journals with a placeholder record")

    with OUT_CSV.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=out_columns, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)

    meta = {
        "last_updated": datetime.now(timezone.utc).isoformat(),
        "n_rows": len(rows),
        "n_with_omc": enriched,
        "measure": "lifetime cited_by_count / works_count",
        "min_works": MIN_WORKS,
        "placeholder_min_citations": PLACEHOLDER_MIN_CITATIONS,
        "placeholder_max_share": PLACEHOLDER_MAX_SHARE,
        "n_set_aside": set_aside,
        "source": "OpenAlex Sources API (cited_by_count / works_count)",
    }
    (DATA_DIR / "flora_with_omc_meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(f"✔ Wrote {OUT_CSV.relative_to(ROOT)} ({enriched}/{len(rows)} rows have OMC)")

    compute_reproduction_impact_stats(rows)


if __name__ == "__main__":
    main()
