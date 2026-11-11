export const LOCAL_CSV_URL = 'data/flora.csv';
export const REMOTE_CSV_URL = 'https://raw.githubusercontent.com/forrtproject/fred-data/refs/heads/main/output/flora.csv';
export const DISCIPLINES_URL = 'data/disciplines.json';
export const CITATION_URL = 'https://raw.githubusercontent.com/forrtproject/fred-data/refs/heads/main/CITATION.cff';
export const FAQ_URL = 'https://raw.githubusercontent.com/forrtproject/fred-data/refs/heads/main/output/flora_faq.md';
export const FAQ_PAGE_URL = 'https://github.com/forrtproject/fred-data/blob/main/output/flora_faq.md';

export const IMPACT_DATA_URL = 'data/impact_factor_data.json';
export const IMPACT_REPRODUCTIONS_URL = 'data/impact_factor_reproductions.json';
export const OVERLAP_DATA_URL = 'data/author_overlap_data.json';
export const RR_DATA_URL = 'data/rr_status_data.json';
export const PUB_STATUS_DATA_URL = 'data/pub_status_data.json';

export const WEBSITE_CITATION_PLAIN = 'Wallrich, L., & Röseler, L. (2026). FLoRA Explorer [Website]. https://forrt.org/flora-explorer/';

export const STAMP_LABELS = {
    flora: 'FLoRA data',
    citations: 'Citation data',
    reproduction_citations: 'Reproduction citation coverage',
    impact_factor: 'Mean Citedness analysis',
    author_overlap: 'Authorship Overlap data',
    rr_status: 'Registered Reports data',
    pub_status: 'Publication Status data',
};
export const STAMP_URLS = {
    flora: 'data/flora_meta.json',
    citations: 'data/meta.json',
    reproduction_citations: 'data/reproduction_citations_meta.json',
    impact_factor: 'data/impact_factor_meta.json',
    author_overlap: 'data/author_overlap_meta.json',
    rr_status: 'data/rr_status_meta.json',
    pub_status: 'data/pub_status_meta.json',
};
// Weekly sources are stale after two weeks; daily ones after three days.
export const WEEKLY_STAMP_SOURCES = new Set(['citations', 'reproduction_citations', 'impact_factor', 'rr_status']);

// Below this n a per-bucket breakdown is replaced by an explicit low-N message.
export const ANALYSIS_MIN_N = 5;
