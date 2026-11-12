export const URLS = {
    csv: 'data/flora.csv',
    remoteCsv: 'https://raw.githubusercontent.com/forrtproject/fred-data/refs/heads/main/output/flora.csv',
    vocabulary: 'data/outcome_vocabulary.json',
    disciplines: 'data/disciplines.json',
    impact: 'data/impact_factor_data.json',
    impactReproductions: 'data/impact_factor_reproductions.json',
    overlap: 'data/author_overlap_data.json',
    rr: 'data/rr_status_data.json',
    pubStatus: 'data/pub_status_data.json',
    citationMeta: 'data/meta.json',
    aggregate: 'data/aggregate.json',
    originalsIndex: 'data/originals_index.json',
    cocitBreakdown: 'data/cocit_breakdown.json',
    reproductionCitations: 'data/reproduction_citations.json',
    originals: 'data/originals/',
    cff: 'https://raw.githubusercontent.com/forrtproject/fred-data/refs/heads/main/CITATION.cff',
    faq: 'https://raw.githubusercontent.com/forrtproject/fred-data/refs/heads/main/output/flora_faq.md',
    faqPage: 'https://github.com/forrtproject/fred-data/blob/main/output/flora_faq.md',
    atlas: 'https://forrt.org/flora-replication-atlas/',
    submit: 'https://forrt.org/replication-hub/submit/',
    site: 'https://forrt.org/flora-explorer/',
};

export const STAMPS = {
    flora: {label: 'FLoRA data', url: 'data/flora_meta.json', staleDays: 3},
    citations: {label: 'Citation data', url: 'data/meta.json', staleDays: 14},
    reproduction_citations: {label: 'Reproduction citation coverage', url: 'data/reproduction_citations_meta.json', staleDays: 14},
    impact_factor: {label: 'Mean Citedness analysis', url: 'data/impact_factor_meta.json', staleDays: 14},
    author_overlap: {label: 'Authorship Overlap data', url: 'data/author_overlap_meta.json', staleDays: 3},
    rr_status: {label: 'Registered Reports data', url: 'data/rr_status_meta.json', staleDays: 14},
    pub_status: {label: 'Publication Status data', url: 'data/pub_status_meta.json', staleDays: 3},
};

export const TABS = [
    {id: 'overview-tab', pane: 'overview', param: 'overview', label: 'Overview'},
    {id: 'browse-tab', pane: 'browse', param: 'browse', label: 'Browse reference pairs'},
    {id: 'trends-tab', pane: 'trends', param: 'trends', label: 'Years & Disciplines'},
    {id: 'citation-tab', pane: 'citation-impact', param: 'citations', label: 'Citation Impact'},
    {id: 'mc-tab', pane: 'mean-citedness', param: 'mean-citedness', label: 'Mean Citedness'},
    {id: 'overlap-tab', pane: 'authorship-overlap', param: 'authorship-overlap', label: 'Authorship Overlap'},
    {id: 'pub-tab', pane: 'publication-type', param: 'publication-type', label: 'Publication Type'},
];

// Pre-merge names stay so old links and bookmarks land on the combined tab.
export const TAB_ALIASES = {
    years: 'trends-tab', disciplines: 'trends-tab', 'citation-impact': 'citation-tab', omc: 'mc-tab', overlap: 'overlap-tab',
    'registered-reports': 'pub-tab', rr: 'pub-tab', 'publication-status': 'pub-tab', 'pub-status': 'pub-tab', pub: 'pub-tab',
};

export const KINDS = ['replication', 'reproduction-numerical', 'reproduction-robustness'];
export const BROWSE_KIND_LABELS = {all: 'All studies', replication: 'Replications', reproduction: 'Reproductions', 'reproduction-numerical': 'Numerical reproductions', 'reproduction-robustness': 'Robustness reproductions'};
export const BROWSE_KIND_NOUNS = {all: 'reference pairs', replication: 'replications', reproduction: 'reproductions', 'reproduction-numerical': 'numerical reproductions', 'reproduction-robustness': 'robustness reproductions'};
export const ANALYSIS_MIN_N = 5;
export const WEBSITE_CITATION = 'Wallrich, L., & Röseler, L. (2026). FLoRA Explorer [Website]. https://forrt.org/flora-explorer/';
