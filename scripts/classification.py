"""Explicit outcome and venue categories shared by the data summaries.

Qualified success remains separate from unqualified success. Venue labels describe
recorded metadata; they do not establish peer review.

Venue rules:
  * "Proceedings" alone is ambiguous (PNAS, Academy of Management Proceedings are
    journals). It only counts as a conference when the name also carries an event
    marker (a number such as "57th"/"2019", or words like congress/meeting/annual).
  * Venues that are blank stay "unknown" unless the report's own DOI or URL points
    to a repository, in which case they are labelled repository / preprint. The
    repository identifiers (DOI prefixes, URL hosts) are learned from the data.
"""
import re
from collections import Counter
from urllib.parse import urlparse

REPLICATION_OUTCOMES = ['successful', 'failed', 'mixed', 'inconclusive', 'qualified', 'other']
MULTI_TARGET_THRESHOLD = 3
VENUE_LABELS = {'journal': 'Other named venue', 'preprint': 'Repository / preprint',
                'conference': 'Conference output', 'thesis': 'Thesis / dissertation', 'unknown': 'Unknown venue'}

def classify_outcome(raw):
    return {'successful': 'successful', 'replicated': 'successful', 'failed': 'failed',
            'not replicated': 'failed', 'mixed': 'mixed', 'partial': 'mixed',
            'inconclusive': 'inconclusive', 'statistically successful but flawed': 'qualified'}.get(str(raw or '').strip().lower(), 'other')

PREPRINT_KEYS = ['osf', 'arxiv', 'preprint', 'ssrn', 'working paper', 'repository', 'registries', 'biorxiv',
                 'medrxiv', 'psyarxiv', 'psycharchiv', 'zenodo']
THESIS_KEYS = ['thesis', 'theses', 'dissertation', 'dissertaç', 'teses']
STRONG_CONFERENCE_KEYS = ['conference', 'symposium', 'workshop']
EVENT_KEYS = ['congress', 'meeting', 'annual', 'international']
_MISSING = ('', 'na', 'nan', 'none', 'null')


def _is_conference(j):
    if any(k in j for k in STRONG_CONFERENCE_KEYS):
        return True
    if 'proceedings' in j:
        # Ambiguous on its own: journals such as PNAS or Academy of Management Proceedings
        # have no event marker; real proceedings name an edition, a year or an event.
        return bool(re.search(r'\d', j)) or any(k in j for k in EVENT_KEYS)
    return False


def venue_only(raw):
    """Venue rules applied to the recorded venue name alone (no DOI/URL fallback)."""
    j = str(raw or '').strip().lower()
    if j in _MISSING:
        return 'unknown'
    if any(k in j for k in THESIS_KEYS):
        return 'thesis'
    if _is_conference(j):
        return 'conference'
    if any(k in j for k in PREPRINT_KEYS):
        return 'preprint'
    return 'journal'


def _tokens(s):
    """Alphabetic tokens (3+ letters) of an identifier; digits-bearing ids and versions are ignored."""
    return {t for t in re.split(r'[^a-z0-9]+', str(s or '').lower()) if len(t) >= 3 and t.isalpha()}


def doi_prefix(doi):
    d = normalize_doi(doi)
    return d.split('/')[0] if '/' in d else ''


def _host(url):
    u = str(url or '').strip().lower()
    if u in _MISSING:
        return ''
    host = urlparse(u if '//' in u else '//' + u).netloc.split(':')[0]
    return host[4:] if host.startswith('www.') else host


def url_host(url):
    """Registered domain of a URL (shs.hal.science -> hal.science); '' when absent."""
    host = _host(url)
    return '.'.join(host.split('.')[-2:]) if host else ''


def _identifier_signals(doi, url):
    """Three kinds of identifier evidence for one reference: DOI prefix, URL host, name tokens."""
    d = normalize_doi(doi)
    suffix = d.split('/', 1)[1] if '/' in d else d
    return {'doi_prefixes': {doi_prefix(d)} - {''},
            'hosts': {url_host(url)} - {''},
            'tokens': _tokens(suffix) | _tokens(_host(url))}


def learn_repositories(df, venue_col='journal_r', doi_col='doi_r', url_col='url_r', min_n=2, min_share=0.5):
    """Learn repository identifiers from the data, with no names supplied.

    Over rows with a recorded venue, every DOI prefix, URL host and identifier word (e.g. the
    "osf" in 10.31234/osf.io/abc, the "arxiv" in 10.48550/arxiv.2101.1) is scored by the share of
    rows that the venue rules label preprint. A signal is kept when a majority (> min_share) of at
    least min_n rows are preprints. Returns {'doi_prefixes', 'hosts', 'tokens'} as sets.
    """
    tot = {k: Counter() for k in ('doi_prefixes', 'hosts', 'tokens')}
    pre = {k: Counter() for k in tot}
    for venue, doi, url in zip(df[venue_col], df[doi_col], df[url_col]):
        status = venue_only(venue)
        if status == 'unknown':
            continue
        for kind, keys in _identifier_signals(doi, url).items():
            for key in keys:
                tot[kind][key] += 1
                pre[kind][key] += (status == 'preprint')
    return {k: {x for x, n in tot[k].items() if n >= min_n and pre[k][x] / n > min_share} for k in tot}


def is_repository_reference(doi=None, url=None, repos=None):
    if not repos:
        return False
    return any(sig & repos[kind] for kind, sig in _identifier_signals(doi, url).items())


def classify_venue(raw, doi=None, url=None, repos=None):
    """Venue label. For blank venues, a repository DOI/URL gives 'preprint'; otherwise 'unknown'."""
    status = venue_only(raw)
    if status == 'unknown' and is_repository_reference(doi, url, repos):
        return 'preprint'
    return status


def legacy_classify_venue(raw):
    """Previous venue rules (any "proceedings" is a conference; no identifier fallback).

    Kept only as the baseline for the audit in compute_pub_status.py, which lists the pairs
    whose category differs from these rules. Not used to produce the published data.
    """
    j = str(raw or '').strip().lower()
    if j in _MISSING:
        return 'unknown'
    if any(k in j for k in THESIS_KEYS):
        return 'thesis'
    if any(k in j for k in STRONG_CONFERENCE_KEYS + ['proceedings']):
        return 'conference'
    if any(k in j for k in PREPRINT_KEYS):
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