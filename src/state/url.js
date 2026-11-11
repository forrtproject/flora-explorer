import {normalizeBrowseKind, STUDY_TYPES} from '../lib/outcomes.js';

export const TABS = [
    {id: 'overview-tab', pane: 'overview', label: 'Overview', param: 'overview'},
    {id: 'browse-tab', pane: 'browse', label: 'Browse Studies', param: 'browse'},
    {id: 'trends-tab', pane: 'trends', label: 'Years & Disciplines', param: 'trends'},
    {id: 'citation-tab', pane: 'citation-impact', label: 'Citation Impact', param: 'citations'},
    {id: 'mc-tab', pane: 'mean-citedness', label: 'Mean Citedness', param: 'mean-citedness'},
    {id: 'overlap-tab', pane: 'authorship-overlap', label: 'Authorship Overlap', param: 'authorship-overlap'},
    {id: 'pub-tab', pane: 'publication-type', label: 'Publication Type', param: 'publication-type'},
];
export const TAB_ID_TO_PARAM = Object.fromEntries(TABS.map(t => [t.id, t.param]));

// Friendly and pre-merge ?tab= aliases, kept so old links still land on the right tab.
const TAB_PARAM_MAP = {
    overview: 'overview-tab', browse: 'browse-tab',
    trends: 'trends-tab', years: 'trends-tab', disciplines: 'trends-tab',
    citations: 'citation-tab', 'citation-impact': 'citation-tab',
    'mean-citedness': 'mc-tab', omc: 'mc-tab',
    'authorship-overlap': 'overlap-tab', overlap: 'overlap-tab',
    'registered-reports': 'pub-tab', rr: 'pub-tab',
    'publication-status': 'pub-tab', 'pub-status': 'pub-tab', pub: 'pub-tab',
    'publication-type': 'pub-tab',
};

export const BROWSE_DEFAULT_SORT = [4, 'desc'];
export const PAGE_LENGTHS = [10, 25, 50, 100, -1];
const TOP_N = ['10', '15', '25', '50'];
const CI_OUTCOMES = ['all', 'failed', 'successful', 'mixed'];
const CI_FILTERS = ['', 'failed', 'successful', 'mixed'];
const TRENDS_KINDS = ['all', 'replication', 'reproduction-numerical', 'reproduction-robustness'];

const pick = (value, allowed, fallback) => allowed.includes(value) ? value : fallback;
const positiveIndex = value => { const n = Number(value || 1); return Number.isSafeInteger(n) && n > 0 ? n - 1 : 0; };

export function parseView(url) {
    const p = url.searchParams;
    const tabParam = (p.get('tab') || (p.get('doi') ? 'citations' : '')).toLowerCase();
    const sort = p.get('sort')?.split(':');
    const pageLength = Number(p.get('page-size') || 25);
    return {
        tab: TAB_PARAM_MAP[tabParam] || 'overview-tab',
        doi: p.get('doi') || null,
        browse: {
            q: p.get('q') || '',
            kind: normalizeBrowseKind(p.get('kind')),
            sort: sort && /^[1-8]$/.test(sort[0]) && ['asc', 'desc'].includes(sort[1]) ? [Number(sort[0]), sort[1]] : BROWSE_DEFAULT_SORT,
            pageLength: PAGE_LENGTHS.includes(pageLength) ? pageLength : 25,
            page: positiveIndex(p.get('page')),
            mobilePage: positiveIndex(p.get('mobile-page')),
        },
        trendsKind: pick(p.get('trends-kind'), TRENDS_KINDS, 'replication'),
        journalTopN: pick(p.get('journal-top-n'), TOP_N, '15'),
        repJournalTopN: pick(p.get('rep-journal-top-n'), TOP_N, '15'),
        ciKind: pick(p.get('ci-kind'), STUDY_TYPES, 'replication'),
        ciOutcome: pick(p.get('ci-outcome'), CI_OUTCOMES, 'all'),
        ciQuery: p.get('ci-q') ?? p.get('search-input') ?? '',
        ciFilter: pick(p.get('filter-outcome'), CI_FILTERS, ''),
        mcKind: pick(p.get('mc-kind'), STUDY_TYPES, 'replication'),
        aoKind: pick(p.get('ao-kind'), STUDY_TYPES, 'replication'),
        pubKind: pick(p.get('pub-kind'), STUDY_TYPES, 'replication'),
    };
}

const STATE_KEYS = ['tab', 'q', 'kind', 'sort', 'page', 'page-size', 'mobile-page', 'trends-kind', 'search-input',
    'mc-kind', 'ao-kind', 'pub-kind', 'ci-kind', 'ci-outcome', 'journal-top-n', 'rep-journal-top-n', 'filter-outcome', 'ci-q'];

// A shared URL contains only the active view's non-default choices; unknown params are kept.
export function buildUrl(view, href = location.href) {
    const url = new URL(href);
    for (const key of STATE_KEYS) url.searchParams.delete(key);
    const put = (key, value, fallback) => { if (String(value) !== String(fallback)) url.searchParams.set(key, value); };
    put('tab', TAB_ID_TO_PARAM[view.tab], 'overview');
    if (view.tab === 'citation-tab' && view.doi) url.searchParams.set('doi', view.doi);
    else url.searchParams.delete('doi');
    const b = view.browse;
    if (view.tab === 'browse-tab') {
        put('q', b.q, ''); put('kind', b.kind, 'all');
        put('sort', b.sort.join(':'), BROWSE_DEFAULT_SORT.join(':'));
        put('page', b.page + 1, 1); put('page-size', b.pageLength, 25);
        put('mobile-page', b.mobilePage + 1, 1);
    }
    if (view.tab === 'trends-tab') {
        put('trends-kind', view.trendsKind, 'replication');
        put('journal-top-n', view.journalTopN, '15'); put('rep-journal-top-n', view.repJournalTopN, '15');
    }
    if (view.tab === 'mc-tab') put('mc-kind', view.mcKind, 'replication');
    if (view.tab === 'overlap-tab') put('ao-kind', view.aoKind, 'replication');
    if (view.tab === 'pub-tab') put('pub-kind', view.pubKind, 'replication');
    if (view.tab === 'citation-tab') {
        put('ci-kind', view.ciKind, 'replication'); put('ci-outcome', view.ciOutcome, 'all');
        put('filter-outcome', view.ciFilter, ''); put('ci-q', view.ciQuery, '');
    }
    return url;
}
