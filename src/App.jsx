import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {flushSync} from 'react-dom';
import logoUrl from '../assets/logo.svg';
import {AppContext} from './state/context.jsx';
import {TABS, parseView, buildUrl} from './state/url.js';
import {loadStamps, loadCitation} from './state/data.js';
import {setLive} from './testHooks.js';
import Overview from './tabs/Overview.jsx';
import Browse from './tabs/Browse.jsx';
import Trends from './tabs/Trends.jsx';
import CitationImpact from './tabs/CitationImpact.jsx';
import MeanCitedness from './tabs/MeanCitedness.jsx';
import AuthorshipOverlap from './tabs/AuthorshipOverlap.jsx';
import PublicationType from './tabs/PublicationType.jsx';

const TAB_CONTENT = {
    'overview-tab': Overview, 'browse-tab': Browse, 'trends-tab': Trends, 'citation-tab': CitationImpact,
    'mc-tab': MeanCitedness, 'overlap-tab': AuthorshipOverlap, 'pub-tab': PublicationType,
};

// Tabs render their markup before the CSV arrives, as the static page did.
const NO_ROWS = [];

export default function App({dataPromise}) {
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [view, setView] = useState(() => parseView(new URL(location.href)));
    const [visited, setVisited] = useState(() => new Set([view.tab]));
    const [theme, setTheme] = useState(() => document.documentElement.getAttribute('data-theme') || 'light');
    const [stamps, setStamps] = useState({});
    const [citation, setCitation] = useState(null);
    const [feedback, setFeedback] = useState('');
    // Set while state is restored from history, so the citation dialog can return focus to the pane.
    const historyNav = useRef(false);
    const ready = !!data;
    const readyRef = useRef(false); readyRef.current = ready;

    useEffect(() => {
        dataPromise.then(setData, e => setError('Error loading FLoRA data: ' + (e?.message || e)));
        loadStamps().then(setStamps);
        loadCitation().then(setCitation);
    }, [dataPromise]);

    useEffect(() => { setLive('rows', data?.rows); }, [data]);

    const updateView = useCallback(patch => setView(v => ({...v, ...(typeof patch === 'function' ? patch(v) : patch)})), []);
    const updateBrowse = useCallback(patch => setView(v => ({...v, browse: {...v.browse, ...(typeof patch === 'function' ? patch(v.browse) : patch)}})), []);

    const viewRef = useRef(view); viewRef.current = view;
    const selectTab = useCallback(tab => {
        if (viewRef.current.tab === tab) return;
        if (readyRef.current) history.pushState(null, '', location.href);
        setView(v => ({...v, tab, doi: tab === 'citation-tab' ? v.doi : null}));
    }, []);

    // State is written to the address bar only once data is ready, as before the rewrite.
    useEffect(() => {
        if (ready) history.replaceState(null, '', buildUrl(view));
    }, [ready, view]);

    useEffect(() => {
        const onPop = () => {
            const url = new URL(location.href);
            // Back/forward always dismisses a timeline, including its shareable DOI.
            url.searchParams.delete('doi');
            history.replaceState(null, '', url);
            historyNav.current = true;
            setView(parseView(url));
        };
        window.addEventListener('popstate', onPop);
        return () => window.removeEventListener('popstate', onPop);
    }, []);

    // Children's layout effects have read the flag by the time this runs.
    useEffect(() => { historyNav.current = false; });

    useEffect(() => {
        setVisited(s => s.has(view.tab) ? s : new Set(s).add(view.tab));
        const main = document.querySelector('.app-main');
        if (main) main.scrollTop = 0;
        const frame = requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
        return () => cancelAnimationFrame(frame);
    }, [view.tab]);

    const toggleTheme = () => {
        const next = theme === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        try { localStorage.setItem('flora-theme', next); } catch { /* storage unavailable */ }
        setTheme(next);
    };

    // A theme set directly on the root element (e.g. by tests) still re-themes the charts.
    useEffect(() => {
        const observer = new MutationObserver(() => setTheme(document.documentElement.getAttribute('data-theme') || 'light'));
        observer.observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme']});
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        let opening = null;
        const onOpening = e => { opening = e.detail; requestAnimationFrame(() => requestAnimationFrame(() => { if (opening === e.detail) opening = null; })); };
        const onKey = e => { if (e.key === 'Escape') document.dispatchEvent(new CustomEvent('flora-dismiss-tips')); };
        const onScroll = e => {
            if (!matchMedia('(max-width: 600px)').matches || e.target.closest?.('.info-tip, .gloss-tip')) return;
            document.dispatchEvent(new CustomEvent('flora-dismiss-tips', {detail: opening}));
        };
        window.addEventListener('flora-tip-opening', onOpening);
        document.addEventListener('keydown', onKey);
        document.addEventListener('scroll', onScroll, true);
        return () => {
            window.removeEventListener('flora-tip-opening', onOpening);
            document.removeEventListener('keydown', onKey);
            document.removeEventListener('scroll', onScroll, true);
        };
    }, []);

    // In-page links to another tab switch tabs without reloading; modified clicks keep link behaviour.
    const tabLink = useCallback(tab => e => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        flushSync(() => selectTab(tab));
        const button = document.getElementById(tab);
        const pane = document.getElementById(TABS.find(t => t.id === tab).pane);
        if (button?.offsetParent) button.focus();
        else if (pane) { pane.setAttribute('tabindex', '-1'); pane.focus({preventScroll: true}); }
    }, [selectTab]);

    const context = useMemo(() => ({
        rows: data?.rows || NO_ROWS, disciplineForJournal: data?.disciplineForJournal, ready,
        stamps, theme, citation, view, updateView, updateBrowse, selectTab, tabLink, historyNav,
        announce: setFeedback,
    }), [data, ready, stamps, theme, citation, view, updateView, updateBrowse, selectTab, tabLink]);

    return <AppContext.Provider value={context}>
        <a className="skip-link" href="#main-content">Skip to main content</a>
        <TopBar activeTab={view.tab} onSelect={selectTab} onToggleTheme={toggleTheme} />
        <main className="app-main" id="main-content" tabIndex={-1}>
            <span id="analysis-feedback" className="visually-hidden" role="status">{feedback}</span>
            <div className="container">
                <div id="global-loading" className="loading-spinner" style={{display: ready || error ? 'none' : undefined}}>
                    <div className="spinner-border" role="status"></div>
                    <span className="ms-3">Loading FLoRA data…</span>
                </div>
                <div id="global-error" className="alert alert-danger" style={{display: error ? 'block' : 'none'}}>{error}</div>
                <div className="tab-content" id="floraTabsContent" style={{display: ready ? 'block' : 'none'}}>
                    {TABS.map(t => {
                        const Content = TAB_CONTENT[t.id];
                        const active = view.tab === t.id;
                        return <div key={t.id} className={'tab-pane fade' + (active ? ' show active' : '')} id={t.pane} role="tabpanel" aria-labelledby={t.id}>
                            <Content active={active} visited={visited.has(t.id)} />
                        </div>;
                    })}
                </div>
            </div>
        </main>
        <footer className="footer-bar">
            <span>FLoRA &middot; Tracking reproductions and replications across the sciences and humanities</span>
            <div>
                <a href="https://github.com/forrtproject/FReD-data" target="_blank" rel="noopener noreferrer">FORRT FLoRA Project</a>
                <a href="https://forrt.org/replication-hub/" target="_blank" rel="noopener noreferrer">FORRT Replication Hub</a>
            </div>
        </footer>
    </AppContext.Provider>;
}

function TopBar({activeTab, onSelect, onToggleTheme}) {
    const barRef = useRef(null), innerRef = useRef(null), tabsRef = useRef(null), mobileRef = useRef(null);
    const [collapsed, setCollapsed] = useState(false);

    // Measures the full tab strip with the select hidden; no viewport breakpoint is needed.
    const fit = useCallback(() => {
        const tabs = tabsRef.current, mobile = mobileRef.current;
        if (!tabs || !mobile) return;
        tabs.style.display = 'flex'; mobile.style.display = 'none';
        const overflow = tabs.scrollWidth > tabs.clientWidth + 1;
        tabs.style.display = ''; mobile.style.display = '';
        setCollapsed(overflow);
    }, []);
    useLayoutEffect(() => {
        const observer = new ResizeObserver(fit);
        observer.observe(innerRef.current);
        document.fonts?.ready.then(fit);
        fit();
        return () => observer.disconnect();
    }, [fit]);
    useLayoutEffect(fit, [activeTab, fit]);

    const onKeyDown = e => {
        const ids = TABS.map(t => t.id);
        const i = ids.indexOf(e.target.id);
        const next = {ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: ids.length - 1}[e.key];
        if (next === undefined || i < 0) return;
        e.preventDefault();
        const id = ids[(next + ids.length) % ids.length];
        flushSync(() => onSelect(id));
        document.getElementById(id)?.focus();
    };

    return <header ref={barRef} className={'top-bar' + (collapsed ? ' navigation-collapsed' : '')}>
        <nav className="top-bar-inner" aria-label="Explorer views" ref={innerRef}>
            <a className="brand-mark" href="?tab=overview" aria-label="FLoRA Replication Explorer overview">
                <span className="brand-icon"><img src={logoUrl} alt="" /></span>
                <span className="brand-name"><strong>FLoRA</strong><span>Explorer</span></span>
            </a>
            <label className="mobile-navigation" ref={mobileRef}><span>Explore</span>{' '}
                <select id="mobile-navigation" aria-label="Choose explorer tab" value={activeTab} onChange={e => onSelect(e.target.value)}>
                    {TABS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
            </label>
            <ul className="nav nav-tabs" id="floraTabs" role="tablist" ref={tabsRef} onKeyDown={onKeyDown}>
                {TABS.map(t => <li key={t.id} className="nav-item" role="presentation">
                    <button className={'nav-link' + (activeTab === t.id ? ' active' : '')} id={t.id} type="button" role="tab"
                        aria-controls={t.pane} aria-selected={activeTab === t.id} tabIndex={activeTab === t.id ? undefined : -1}
                        onClick={() => onSelect(t.id)}>{t.label}</button>
                </li>)}
            </ul>
            <button className="theme-toggle" id="theme-toggle" aria-label="Toggle dark mode" title="Toggle dark mode" onClick={onToggleTheme}>
                <svg className="icon-moon" viewBox="0 0 24 24" fill="currentColor"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
                <svg className="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
            </button>
        </nav>
    </header>;
}
