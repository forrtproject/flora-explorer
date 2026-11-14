import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {TABS, URLS} from './lib/config.js';
import {useData} from './state/data.jsx';
import {useEnv} from './state/env.jsx';
import {useView} from './state/view.jsx';
import {Icon} from './components/common.jsx';
import Overview, {useDatasetCitation} from './tabs/Overview.jsx';
import Browse from './tabs/Browse.jsx';
import Trends from './tabs/Trends.jsx';
import CitationImpact, {CitationDialog, useCitations} from './tabs/CitationImpact.jsx';
import MeanCitedness from './tabs/MeanCitedness.jsx';
import AuthorshipOverlap from './tabs/AuthorshipOverlap.jsx';
import PublicationType from './tabs/PublicationType.jsx';
import logo from '/assets/logo.svg';

function TopBar() {
    const {view, switchTab, linkFor} = useView();
    const {theme, toggleTheme} = useEnv();
    const bar = useRef(null), tabs = useRef(null), select = useRef(null);
    const [collapsed, setCollapsed] = useState(false);

    // The full strip is measured with the select hidden, so no viewport breakpoint is needed.
    useLayoutEffect(() => {
        const fit = () => {
            const strip = tabs.current, menu = select.current.parentElement;
            strip.style.display = 'flex'; menu.style.display = 'none';
            const overflowing = strip.scrollWidth > strip.clientWidth + 1;
            strip.style.display = ''; menu.style.display = '';
            setCollapsed(overflowing);
        };
        const observer = new ResizeObserver(fit);
        observer.observe(bar.current);
        document.fonts?.ready.then(fit);
        fit();
        return () => observer.disconnect();
    }, [view.tab]);

    const onKeyDown = e => {
        const step = {ArrowRight: 1, ArrowLeft: -1}[e.key];
        if (!step) return;
        const next = TABS[(TABS.findIndex(t => t.id === view.tab) + step + TABS.length) % TABS.length];
        switchTab(next.id);
        document.getElementById(next.id)?.focus();
    };
    return (
        <header className={'top-bar' + (collapsed ? ' navigation-collapsed' : '')}>
            <nav className="top-bar-inner" aria-label="Explorer views" ref={bar}>
                <a className="brand-mark" href={linkFor({tab: 'overview-tab'})} aria-label="FLoRA Replication Explorer overview"
                    onClick={e => { if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) { e.preventDefault(); switchTab('overview-tab'); } }}>
                    <span className="brand-icon"><img src={logo} alt="" /></span>
                    <span className="brand-name"><strong>FLoRA</strong><span>Explorer</span></span>
                </a>
                <label className="mobile-navigation"><span>Explore</span>{' '}
                    <select id="mobile-navigation" ref={select} aria-label="Choose explorer tab" value={view.tab} onChange={e => switchTab(e.target.value)}>
                        {TABS.map(tab => <option key={tab.id} value={tab.id}>{tab.label}</option>)}
                    </select>
                </label>
                <ul className="nav nav-tabs" id="floraTabs" role="tablist" ref={tabs} onKeyDown={onKeyDown}>
                    {TABS.map(tab => (
                        <li className="nav-item" role="presentation" key={tab.id}>
                            <button className={'nav-link' + (view.tab === tab.id ? ' active' : '')} id={tab.id} type="button" role="tab" aria-selected={view.tab === tab.id}
                                aria-controls={tab.pane} tabIndex={view.tab === tab.id ? 0 : -1} onClick={() => switchTab(tab.id)}>{tab.label}</button>
                        </li>
                    ))}
                </ul>
                <div className="top-bar-actions">
                    <a className="top-bar-cta" href={URLS.atlas} target="_blank" rel="noopener noreferrer">Replication Atlas <Icon.arrow /></a>
                    <button className="theme-toggle" id="theme-toggle" type="button" aria-label="Toggle dark mode" title="Toggle dark mode" aria-pressed={theme === 'dark'} onClick={toggleTheme}><Icon.moon /><Icon.sun /></button>
                </div>
            </nav>
        </header>
    );
}

export default function App() {
    const {status, error, vocabulary} = useData();
    const {view, announcement} = useView();
    const main = useRef(null);
    const citation = useDatasetCitation();
    const citations = useCitations();
    const ready = status === 'ready';

    useEffect(() => { if (main.current) main.current.scrollTop = 0; }, [view.tab]);
    // Charts measured while their pane was hidden re-fit once it is shown.
    useEffect(() => { const frame = requestAnimationFrame(() => window.dispatchEvent(new Event('resize'))); return () => cancelAnimationFrame(frame); }, [view.tab, ready]);

    return (
        <>
            <a className="skip-link" href="#main-content">Skip to main content</a>
            <TopBar />
            <main className="app-main" id="main-content" tabIndex={-1} ref={main}>
                <span id="analysis-feedback" className="visually-hidden" role="status">{announcement}</span>
                <div className="container">
                    {status === 'loading' && <div id="global-loading" className="loading-spinner" role="status" aria-label="Loading FLoRA data…">
                        <div className="skeleton" style={{height: '3rem', width: '55%'}} /><div className="skeleton" style={{height: '1.2rem', width: '70%'}} />
                        <div className="skeleton" style={{height: '9rem'}} /><div className="skeleton" style={{height: '16rem'}} />
                    </div>}
                    {status === 'error' && <div id="global-error" className="alert" role="alert">{error} <button type="button" className="browse-download" onClick={() => location.reload()}>Reload</button></div>}
                    <div className="tab-content" id="floraTabsContent" style={{display: ready ? 'block' : 'none'}}>
                        {ready && <>
                            <Overview citation={citation} />
                            <Browse citation={citation} />
                            <Trends />
                            <CitationImpact data={citations} />
                            <MeanCitedness />
                            <AuthorshipOverlap />
                            <PublicationType />
                        </>}
                    </div>
                </div>
            </main>
            <footer className="footer-bar">
                <span>FLoRA &middot; Tracking reproductions and replications across the sciences and humanities</span>
                <div>
                    <a href="https://github.com/forrtproject/FReD-data" target="_blank" rel="noopener noreferrer">FORRT FLoRA Project</a>
                    <a href="https://forrt.org/replication-hub/" target="_blank" rel="noopener noreferrer">FORRT Replication Hub</a>
                    <a href={URLS.atlas} target="_blank" rel="noopener noreferrer">Replication Atlas</a>
                </div>
            </footer>
            {/* A DOI deep link can open its timeline before the pairs finish loading. */}
            {vocabulary ? <CitationDialog data={citations} /> : <div className="modal-backdrop" id="ci-modal" role="dialog" aria-modal="true" aria-label="Citation timeline and replication evidence" hidden />}
        </>
    );
}
