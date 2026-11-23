import {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState} from 'react';
import {BROWSE_KIND_LABELS, KINDS, TABS, TAB_ALIASES} from '../lib/config.js';
import {kindDimension} from '../lib/outcomes.js';
import {FloraVocabulary} from '../lib/vocabulary.js';

const OUTCOME_KINDS = new Set(KINDS);
function normalizeOutcome(kind, raw) {
    if (!OUTCOME_KINDS.has(kind)) return '';
    const value = String(raw || '').trim().toLowerCase();
    if (!value) return '';
    if (!FloraVocabulary.loaded()) return value;
    const dim = kindDimension(kind);
    return FloraVocabulary.entries(dim).some(e => (dim === 'replication' || e.assessed) && e.key === value) ? value : '';
}

const DEFAULTS = {
    tab: 'overview-tab', doi: '',
    q: '', kind: 'all', outcome: '', sort: '4:desc', page: 1, pageSize: 25, mobilePage: 1,
    trendsKind: 'replication', journalTopN: '15', repJournalTopN: '15',
    ciKind: 'replication', ciOutcome: 'all', filterOutcome: '', ciQ: '',
    mcKind: 'replication', aoKind: 'replication', pubKind: 'replication',
    // Comparison charts shown as counts instead of within-group percentages.
    aoCounts: false, pubCounts: false, rrCounts: false, lsCounts: false,
    // Years & Disciplines field chart: counts instead of within-field percentages.
    fieldCounts: false,
};

// [state key, URL parameter, owning tab]; a shared URL carries only the active view's choices.
const PARAMS = [
    ['q', 'q', 'browse-tab'], ['kind', 'kind', 'browse-tab'], ['outcome', 'outcome', 'browse-tab'], ['sort', 'sort', 'browse-tab'], ['page', 'page', 'browse-tab'],
    ['pageSize', 'page-size', 'browse-tab'], ['mobilePage', 'mobile-page', 'browse-tab'],
    ['trendsKind', 'trends-kind', 'trends-tab'], ['journalTopN', 'journal-top-n', 'trends-tab'], ['repJournalTopN', 'rep-journal-top-n', 'trends-tab'],
    ['ciKind', 'ci-kind', 'citation-tab'], ['ciOutcome', 'ci-outcome', 'citation-tab'], ['filterOutcome', 'filter-outcome', 'citation-tab'], ['ciQ', 'ci-q', 'citation-tab'],
    ['mcKind', 'mc-kind', 'mc-tab'], ['aoKind', 'ao-kind', 'overlap-tab'], ['pubKind', 'pub-kind', 'pub-tab'],
    ['aoCounts', 'ao-counts', 'overlap-tab'], ['pubCounts', 'pub-counts', 'pub-tab'], ['rrCounts', 'rr-counts', 'pub-tab'], ['lsCounts', 'ls-counts', 'pub-tab'],
    ['fieldCounts', 'field-counts', 'trends-tab'],
];

const oneOf = (value, allowed, fallback) => allowed.includes(value) ? value : fallback;
const flag = value => value === 'true' || value === '1';
const positive = (value, fallback) => { const n = Number(value); return Number.isSafeInteger(n) && n > 0 ? n : fallback; };

function parse(url) {
    const get = key => url.searchParams.get(key);
    const tabParam = (get('tab') || '').toLowerCase();
    const sort = get('sort')?.split(':');
    const kind = oneOf(get('kind'), Object.keys(BROWSE_KIND_LABELS), 'all');
    return {
        // A DOI-only share link targets Citation Impact.
        tab: TABS.find(t => t.param === tabParam)?.id || TAB_ALIASES[tabParam] || (get('doi') && !get('tab') ? 'citation-tab' : 'overview-tab'),
        doi: get('doi') || '',
        q: get('q') || '',
        kind,
        outcome: normalizeOutcome(kind, get('outcome')),
        sort: sort && /^[1-8]$/.test(sort[0]) && ['asc', 'desc'].includes(sort[1]) ? sort.join(':') : '4:desc',
        page: positive(get('page'), 1),
        pageSize: oneOf(Number(get('page-size') || 25), [10, 25, 50, 100, -1], 25),
        mobilePage: positive(get('mobile-page'), 1),
        trendsKind: oneOf(get('trends-kind'), ['all', ...KINDS], 'replication'),
        journalTopN: oneOf(get('journal-top-n'), ['10', '15', '25', '50'], '15'),
        repJournalTopN: oneOf(get('rep-journal-top-n'), ['10', '15', '25', '50'], '15'),
        ciKind: oneOf(get('ci-kind'), KINDS, 'replication'),
        ciOutcome: oneOf(get('ci-outcome'), ['all', 'failed', 'successful', 'mixed'], 'all'),
        filterOutcome: oneOf(get('filter-outcome'), ['', 'failed', 'successful', 'mixed', 'multiple'], ''),
        ciQ: get('ci-q') ?? get('search-input') ?? '',
        mcKind: oneOf(get('mc-kind'), KINDS, 'replication'),
        aoKind: oneOf(get('ao-kind'), KINDS, 'replication'),
        pubKind: oneOf(get('pub-kind'), KINDS, 'replication'),
        aoCounts: flag(get('ao-counts')), pubCounts: flag(get('pub-counts')), rrCounts: flag(get('rr-counts')), lsCounts: flag(get('ls-counts')),
        fieldCounts: flag(get('field-counts')),
    };
}

function serialize(view) {
    const url = new URL(location.href);
    for (const key of ['tab', 'doi', 'search-input', ...PARAMS.map(p => p[1])]) url.searchParams.delete(key);
    const tab = TABS.find(t => t.id === view.tab);
    if (tab.param !== 'overview') url.searchParams.set('tab', tab.param);
    for (const [key, param, owner] of PARAMS) {
        const val = key === 'outcome' ? normalizeOutcome(view.kind, view.outcome) : view[key];
        if (owner === view.tab && String(val) !== String(DEFAULTS[key])) url.searchParams.set(param, val);
    }
    if (view.tab === 'citation-tab' && view.doi) url.searchParams.set('doi', view.doi);
    return url;
}

const ViewContext = createContext(null);
export const useView = () => useContext(ViewContext);

export function ViewProvider({children}) {
    const [view, setState] = useState(() => parse(new URL(location.href)));
    const [announcement, setAnnouncement] = useState('');
    // Bumped by back/forward so views can drop transient state such as an open timeline.
    const [historyTick, setHistoryTick] = useState(0);
    const current = useRef(view);
    current.current = view;

    useEffect(() => { history.replaceState(null, '', serialize(view)); }, [view]);
    useEffect(() => {
        let cancelled = false;
        FloraVocabulary.ready.then(() => {
            if (cancelled) return;
            setState(prev => {
                const clean = normalizeOutcome(prev.kind, prev.outcome);
                return clean === prev.outcome ? prev : {...prev, outcome: clean};
            });
        }, () => {});
        return () => { cancelled = true; };
    }, []);

    const setView = useCallback(patch => setState(prev => {
        const delta = typeof patch === 'function' ? patch(prev) : patch;
        const next = {...prev, ...delta};
        const kindChanged = 'kind' in delta && next.kind !== prev.kind;
        next.outcome = normalizeOutcome(next.kind, kindChanged && !('outcome' in delta) ? '' : next.outcome);
        return next;
    }), []);
    const pushEntry = useCallback(() => history.pushState(null, '', location.href), []);
    const switchTab = useCallback(tab => {
        if (current.current.tab === tab) return;
        pushEntry();
        setState(prev => ({...prev, tab, doi: ''}));
    }, [pushEntry]);

    useEffect(() => {
        const onPop = () => {
            // Back/forward always dismisses a timeline, including its shareable DOI.
            setState({...parse(new URL(location.href)), doi: ''});
            setHistoryTick(n => n + 1);
        };
        window.addEventListener('popstate', onPop);
        return () => window.removeEventListener('popstate', onPop);
    }, []);

    const value = useMemo(() => ({view, setView, switchTab, pushEntry, announce: setAnnouncement, announcement, historyTick, linkFor: patch => serialize({...current.current, ...patch}).href}),
        [view, setView, switchTab, pushEntry, announcement, historyTick]);
    return <ViewContext.Provider value={value}>{children}</ViewContext.Provider>;
}
