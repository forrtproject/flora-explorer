"""Explicit outcome and venue categories shared by the data summaries.

Qualified success remains separate from unqualified success. Venue labels describe
recorded metadata; they do not establish peer review.
"""
import re
import json
from pathlib import Path

OUTCOME_VOCABULARY = json.loads((Path(__file__).resolve().parents[1] / "data/outcome_vocabulary.json").read_text(encoding="utf-8"))

REPLICATION_OUTCOMES = [item['key'] for item in OUTCOME_VOCABULARY['replication']]
MULTI_TARGET_THRESHOLD = 3
VENUE_LABELS = {'journal': 'Other named venue', 'preprint': 'Repository / preprint',
                'conference': 'Conference output', 'thesis': 'Thesis / dissertation', 'unknown': 'Unknown venue'}

def classify_outcome(raw, dimension='replication'):
    value = str(raw if raw is not None else '').strip().lower()
    if value in OUTCOME_VOCABULARY['missing_markers']:
        return 'missing'
    return next((item['key'] for item in OUTCOME_VOCABULARY[dimension]
                 if value in item['aliases']), 'unrecognised')

def classify_venue(raw):
    j = str(raw or '').strip().lower()
    if j in ('', 'na', 'nan', 'none', 'null'):
        return 'unknown'
    if any(k in j for k in ['thesis', 'theses', 'dissertation', 'dissertaç', 'teses']):
        return 'thesis'
    if any(k in j for k in ['conference', 'proceedings', 'symposium', 'workshop']):
        return 'conference'
    if any(k in j for k in ['osf', 'arxiv', 'preprint', 'ssrn', 'working paper', 'repository', 'registries', 'biorxiv', 'medrxiv', 'psyarxiv', 'psycharchiv', 'zenodo']):
        return 'preprint'
    return 'journal'

def normalize_doi(raw):
    d = str(raw or '').strip().lower()
    if d in ('nan', 'na', 'none'): return ''
    return re.sub(r'^(https?://(dx\.)?doi\.org/|doi:\s*)', '', d).strip('/ ')

# Each study type is described by its own columns. The combined outcome, outcome_quote and
# outcome_quote_source stay in flora.csv for backward compatibility only; nothing classifies them.
REPLICATION_COLUMNS = ("outcome_replication", "outcome_replication_quote", "out_quote_replication_source")
REPRODUCTION_OUTCOME_COLUMNS = ("outcome_computation", "outcome_robustness")
OUTCOME_COLUMNS = ("outcome_replication",) + REPRODUCTION_OUTCOME_COLUMNS
# TODO: remove after the first FLoRA release that ships the replication columns. Until then
# they are copied from the combined fields, which hold identical values for replications.
_REPLICATION_FALLBACK = dict(zip(REPLICATION_COLUMNS, ("outcome", "outcome_quote", "outcome_quote_source")))


def is_reproduction(row) -> bool:
    return "reproduc" in str(row.get("type") or "").lower()


def with_outcome_columns(df):
    """Return a DataFrame that has the replication columns (see _REPLICATION_FALLBACK)."""
    df = df.copy()
    reproduction = df["type"].astype(str).str.lower().str.contains("reproduc", na=False)
    for column, combined in _REPLICATION_FALLBACK.items():
        if column not in df.columns and combined in df.columns:
            df[column] = df[combined].where(~reproduction, "")
    return df


def add_outcome_columns(rows: list[dict]) -> list[dict]:
    """The same fallback as with_outcome_columns(), for csv.DictReader rows."""
    for row in rows:
        for column, combined in _REPLICATION_FALLBACK.items():
            if column not in row and combined in row:
                row[column] = "" if is_reproduction(row) else row[combined]
    return rows


def load_outcome_columns(path):
    """Outcome columns of flora.csv as recorded, without pandas turning "NA" into a missing value."""
    import pandas as pd
    raw = with_outcome_columns(pd.read_csv(path, keep_default_na=False, dtype=str))
    return raw[[column for column in OUTCOME_COLUMNS if column in raw.columns]]


def replication_outcome(row) -> str:
    return classify_outcome(row.get("outcome_replication"))


def reproduction_dimensions(row):
    """Classify a reproduction row's two independent verdicts from their own columns."""
    return (classify_outcome(row.get("outcome_computation"), "computational"),
            classify_outcome(row.get("outcome_robustness"), "robustness"))


def study_outcome_fields(row) -> dict:
    """Verdict columns to carry into a per-study summary for this row's study type."""
    columns = REPRODUCTION_OUTCOME_COLUMNS if is_reproduction(row) else ("outcome_replication",)
    return {column: _clean_text(row.get(column)) for column in columns}


def _clean_text(value):
    text = "" if value is None or value != value else str(value).strip()  # value != value: NaN
    return text or None


def reference_key(doi, url=None):
    """Use a canonical DOI, or the recorded URL when no DOI is available."""
    key = normalize_doi(doi)
    if not key:
        key = str(url or '').strip().lower()
    return None if key in ('', 'nan', 'na', 'none', 'null') else key
