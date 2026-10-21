"""Explicit outcome and venue categories shared by the data summaries.

Qualified success remains separate from unqualified success. Venue labels describe
recorded metadata; they do not establish peer review.
"""
import re
from urllib.parse import urlsplit

REPLICATION_OUTCOMES = ['successful', 'failed', 'mixed', 'inconclusive', 'qualified', 'other']
MULTI_TARGET_THRESHOLD = 3
VENUE_LABELS = {'journal': 'Other named venue', 'preprint': 'Repository / preprint',
                'conference': 'Conference output', 'thesis': 'Thesis / dissertation', 'unknown': 'Unknown venue'}

def classify_outcome(raw):
    return {'successful': 'successful', 'replicated': 'successful', 'failed': 'failed',
            'not replicated': 'failed', 'mixed': 'mixed', 'partial': 'mixed',
            'inconclusive': 'inconclusive', 'statistically successful but flawed': 'qualified'}.get(str(raw or '').strip().lower(), 'other')

# Patterns classify the recorded identifier, not the report's current publication status.
REPOSITORY_DOI_RULES = {
    'psyarxiv': r'10\.31234/osf\.io/\S+',
    'osf_preprints': r'10\.31219/osf\.io/\S+',
    'osf': r'10\.17605/osf\.io/\S+',
    'biorxiv_medrxiv': r'10\.(?:1101|64898)/(?:[0-9]{6}|[0-9]{4}\.[0-9]{2}\.[0-9]{2}\.[0-9]{6,8})(?:v[0-9]+)?',
    'ssrn': r'10\.2139/ssrn\.\S+',
    'zenodo': r'10\.5281/zenodo\.\S+',
    'arxiv': r'10\.48550/arxiv\.\S+',
    'research_square': r'10\.21203/rs\.\S+',
    'socarxiv': r'10\.31235/osf\.io/\S+',
    'psycharchives': r'10\.23668/psycharchives\.\S+',
    'peerj_preprints': r'10\.7287/peerj\.preprints\.\S+',
    'preprints_org': r'10\.20944/preprints\S+',
}
REPOSITORY_HOSTS = (
    'osf.io', 'psyarxiv.com', 'socarxiv.org', 'biorxiv.org', 'medrxiv.org',
    'ssrn.com', 'zenodo.org', 'arxiv.org', 'researchsquare.com',
    'psycharchives.org', 'preprints.org', 'hal.science',
)
REPOSITORY_NAME_TERMS = (
    'osf', 'arxiv', 'preprint', 'ssrn', 'working paper', 'repository',
    'registries', 'biorxiv', 'medrxiv', 'psyarxiv', 'psycharchiv', 'zenodo',
    'research square', 'researchsquare',
)


def _venue_text(raw):
    text = str(raw).strip().lower() if raw is not None else ''
    return '' if text in ('', 'na', 'nan', 'none', 'null') else text


def _http_url(raw):
    try:
        parsed = urlsplit(_venue_text(raw))
        return parsed if parsed.scheme in ('http', 'https') and parsed.hostname else None
    except ValueError:
        return None


def classify_venue_evidence(raw, doi=None, url=None):
    """Return the category and the first recognised evidence rule, in precedence order."""
    name = _venue_text(raw)
    for category, terms in [
        ('thesis', ('thesis', 'theses', 'dissertation', 'dissertaç', 'teses')),
        ('conference', ('conference', 'proceedings', 'symposium', 'workshop')),
    ]:
        for term in terms:
            if term in name:
                return dict(category=category, basis='venue_name', rule=term)

    identifier = normalize_doi(_venue_text(doi))
    parsed = _http_url(url)
    if not re.fullmatch(r'10\.[0-9]{4,9}/\S+', identifier):
        identifier = ''
        if parsed and parsed.hostname in ('doi.org', 'dx.doi.org'):
            identifier = normalize_doi(parsed.path)
    for rule, pattern in REPOSITORY_DOI_RULES.items():
        if re.fullmatch(pattern, identifier):
            return dict(category='preprint', basis='doi', rule=rule)
    for term in REPOSITORY_NAME_TERMS:
        if term in name:
            return dict(category='preprint', basis='venue_name', rule=term)
    if name:
        return dict(category='journal', basis='venue_name', rule='named_venue')
    if parsed:
        for host in REPOSITORY_HOSTS:
            if parsed.hostname == host or parsed.hostname.endswith('.' + host):
                return dict(category='preprint', basis='url', rule=host)
        if (parsed.hostname == 'peerj.com' or parsed.hostname.endswith('.peerj.com')) and parsed.path.startswith('/preprints/'):
            return dict(category='preprint', basis='url', rule='peerj.com/preprints/')
    return dict(category='unknown', basis='none', rule='no_recognised_evidence')


def classify_venue(raw, doi=None, url=None):
    return classify_venue_evidence(raw, doi, url)['category']

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
