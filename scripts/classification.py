"""Explicit outcome and venue categories shared by the data summaries.

Qualified success remains separate from unqualified success. Venue labels describe
recorded metadata; they do not establish peer review.
"""
import re

REPLICATION_OUTCOMES = ['successful', 'failed', 'mixed', 'inconclusive', 'qualified', 'other']
MULTI_TARGET_THRESHOLD = 3
VENUE_LABELS = {'journal': 'Other named venue', 'preprint': 'Repository / preprint',
                'conference': 'Conference output', 'thesis': 'Thesis / dissertation', 'unknown': 'Unknown venue'}

def classify_outcome(raw):
    return {'successful': 'successful', 'replicated': 'successful', 'failed': 'failed',
            'not replicated': 'failed', 'mixed': 'mixed', 'partial': 'mixed',
            'inconclusive': 'inconclusive', 'statistically successful but flawed': 'qualified'}.get(str(raw or '').strip().lower(), 'other')

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
    parts = str(raw or '').lower().split(',')
    computational = {'computationally reproducible':'successful', 'computationally successful':'successful',
                     'computational issues':'issues', 'technical failure':'technical_failure',
                     'failed':'technical_failure', 'not checked':'not_checked'}
    robustness = {'robust':'robust', 'robustness challenges':'challenges', 'not checked':'not_checked',
                  'robustness not checked':'not_checked'}
    return computational.get(parts[0].strip()), robustness.get(parts[1].strip() if len(parts)>1 else '')


def reference_key(doi, url=None):
    """Use a canonical DOI, or the recorded URL when no DOI is available."""
    key = normalize_doi(doi)
    if not key:
        key = str(url or '').strip().lower()
    return None if key in ('', 'nan', 'na', 'none', 'null') else key
