import {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState} from 'react';
import {BROWSE_KIND_LABELS, KINDS, TABS, TAB_ALIASES} from '../lib/config.js';

const DEFAULTS = {
    tab: 'overview-tab', doi: '',
    q: '', kind: 'all', sort: '4:desc', page: 1, pageSize: 25, mobilePage: 1,
    trendsKind: 'replication', journalTopN: '15', repJournalTopN: '15',
    ciKind: 'replication', ciOutcome: 'all', filterOutcome: '', ciQ: '',
    mcKind: 'replication', aoKind: 'replication', pubKind: 'replication',
};

// [state key, URL parameter, owning tab]; a shared URL carries only the active view's choices.
const PARAMS = [
    ['q', 'q', 'browse-tab'], ['kind', 'kind', 'browse-tab'], ['sort', 'sort', 'browse-tab'], ['page', 'page', 'browse-tab'],
    ['pageSize', 'page-size', 'browse-tab'], ['mobilePage', 'mobile-page', 'browse-tab'],
    ['trendsKind', 'trends-kind', 'trends-tab'], ['journalTopN', 'journal-top-n', 'trends-tab'], ['repJournalTopN', 'rep-journal-top-n', 'trends-tab'],
    ['ciKind', 'ci-kind', 'citation-tab'], ['ciOutcome', 'ci-outcome', 'citation-tab'], ['filterOutcome', 'filter-outcome', 'citation-tab'], ['ciQ', 'ci-q', 'citation-tab'],
    ['mcKind', 'mc-kind', 'mc-tab'], ['aoKind', 'ao-kind', 'overlap-tab'], ['pubKind', 'pub-kind', 'pub-tab'],
];

const oneOf = (value, allowed, fallback) => allowed.includes(value) ? value : fallback;
const positive = (value, fallback) => { const n = Number(value); return Number.isSafeInteger(n) && n > 0 ? n : fallback; };

function parse(url) {
    const get = key => url.searchParams.get(key);
    const tabParam = (get('tab') || '').toLowerCase();
    const sort = get('sort')?.split(':');
    return {
        // A DOI-only share link targets Citation Impact.
        tab: TABS.find(t => t.param === tabParam)?.id || TAB_ALIASES[tabParam] || (get('doi') && !get('tab') ? 'citation-tab' : 'overview-tab'),
        doi: get('doi') || '',
        q: get('q') || '',
        kind: oneOf(get('kind'), Object.keys(BROWSE_KIND_LABELS), 'all'),
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
    };
}

function serialize(view) {
    const url = new URL(location.href);
    for (const key of ['tab', 'doi', 'search-input', ...PARAMS.map(p => p[1])]) url.searchParams.delete(key);
    const tab = TABS.find(t => t.id === view.tab);
    if (tab.param !== 'overview') url.searchParams.set('tab', tab.param);
    for (const [key, param, owner] of PARAMS) {
        if (owner === view.tab && String(view[key]) !== String(DEFAULTS[key])) url.searchParams.set(param, view[key]);
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

    const setView = useCallback(patch => setState(prev => ({...prev, ...(typeof patch === 'function' ? patch(prev) : patch)})), []);
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
