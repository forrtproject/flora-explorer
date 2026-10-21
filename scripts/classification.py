"""Explicit outcome and venue categories shared by the data summaries.

Qualified success remains separate from unqualified success. Venue labels describe
recorded metadata; they do not establish peer review.
"""
import re
import json
from pathlib import Path

OUTCOME_VOCABULARY = json.loads((Path(__file__).resolve().parents[1] / "data/outcome_vocabulary.json").read_text())

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

def parse_reproduction_outcome(raw):
    """Read independent computational and robustness dimensions, in that order."""
    parts = str(raw if raw is not None else '').split(',')
    return (classify_outcome(parts[0], 'computational'),
            classify_outcome(parts[1] if len(parts) > 1 else '', 'robustness'))


def reference_key(doi, url=None):
    """Use a canonical DOI, or the recorded URL when no DOI is available."""
    key = normalize_doi(doi)
    if not key:
        key = str(url or '').strip().lower()
    return None if key in ('', 'nan', 'na', 'none', 'null') else key
