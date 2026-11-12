import {useEffect, useId, useMemo, useRef, useState} from 'react';
import {STAMPS, KINDS} from '../lib/config.js';
import {FloraVocabulary} from '../lib/vocabulary.js';
import {classifyKind, classifyOutcome, parseReproductionOutcome} from '../lib/outcomes.js';
import {useData} from '../state/data.jsx';
import {PaneContext} from '../state/env.jsx';
import {useView} from '../state/view.jsx';

const svg = {viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true};
export const Icon = {
    info: () => <svg {...svg}><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>,
    copy: () => <svg {...svg}><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg>,
    link: () => <svg {...svg}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>,
    download: () => <svg {...svg}><path d="M12 3v12m-4-4 4 4 4-4M4 17v3h16v-3" /></svg>,
    search: () => <svg {...svg}><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>,
    arrow: () => <svg {...svg} width="14" height="14"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>,
    chevron: () => <svg {...svg} strokeWidth="2.5" className="faq-chevron"><polyline points="9 6 15 12 9 18" /></svg>,
    shuffle: () => <svg {...svg} strokeWidth="2.5" width="14" height="14"><polyline points="16 3 21 3 21 8" /><line x1="4" y1="20" x2="21" y2="3" /><polyline points="21 16 21 21 16 21" /><line x1="15" y1="15" x2="21" y2="21" /><line x1="4" y1="4" x2="9" y2="9" /></svg>,
    moon: () => <svg viewBox="0 0 24 24" fill="currentColor" className="icon-moon" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>,
    sun: () => <svg {...svg} className="icon-sun"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></svg>,
};

export function stampInfo(source, meta) {
    const {label, staleDays} = STAMPS[source];
    if (!meta?.last_updated) return {text: `${label}: no snapshot yet`, missing: true, label};
    const date = new Date(meta.last_updated);
    const when = date.toLocaleString('en-GB', {year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short'});
    const snapshot = meta.input_snapshot ? new Date(meta.input_snapshot) : null;
    const snapshotLabel = snapshot && (isNaN(snapshot) ? String(meta.input_snapshot) : snapshot.toLocaleDateString(undefined, {year: 'numeric', month: 'short', day: 'numeric'}));
    const extras = [
        snapshotLabel && `input snapshot: ${snapshotLabel}`,
        meta.recalculated_at && `recalculated: ${new Date(meta.recalculated_at).toLocaleDateString()}`,
        meta.partial_run && 'Partial refresh: some records are unavailable',
        meta.source_url && `${label} source`,
    ].filter(Boolean);
    return {text: [`${label} last updated: ${when}`, ...extras].join(' · '), label, when, snapshotLabel, meta,
        stale: (Date.now() - date.getTime()) / 864e5 > staleDays};
}

export function DataStamp({source}) {
    const {stamps} = useData();
    if (!stamps) return <div className="data-stamp" data-stamp-source={source} />;
    const info = stampInfo(source, stamps[source]);
    if (info.missing) return <div className="data-stamp missing" data-stamp-source={source}>{info.label}: <em>no snapshot yet</em></div>;
    const {meta} = info;
    return (
        <div className={'data-stamp' + (info.stale ? ' stale' : '')} data-stamp-source={source}>
            {info.label} last updated: <strong>{info.when}</strong>
            {info.snapshotLabel && <> · <span title={String(meta.input_snapshot)}>input snapshot: {info.snapshotLabel}</span></>}
            {meta.recalculated_at && <> · recalculated: {new Date(meta.recalculated_at).toLocaleDateString()}</>}
            {meta.partial_run && ' · Partial refresh: some records are unavailable'}
            {meta.source_url && <> · <a className="doi-link" href={meta.source_url} target="_blank" rel="noopener noreferrer">{info.label} source</a></>}
        </div>
    );
}

// Every tab stays mounted so its charts and scroll survive a switch; inactive panes are hidden.
export function Pane({id, tabId, title, sources = [], selection = [], kind = '', children}) {
    const {view} = useView();
    const {stamps} = useData();
    const active = view.tab === tabId;
    const [visited, setVisited] = useState(active);
    useEffect(() => { if (active) setVisited(true); }, [active]);
    const stampText = stamps ? sources.map(s => stampInfo(s, stamps[s]).text).join('; ') : '';
    const context = useMemo(() => ({active, visited: visited || active, stamps: stampText, selection: selection.join('; '), kind}),
        [active, visited, stampText, selection.join('; '), kind]);
    return (
        <div className={'tab-pane' + (active ? ' show active' : '')} id={id} role="tabpanel" aria-labelledby={tabId} tabIndex={-1}>
            <PaneContext.Provider value={context}>
                {title && <header className="pane-head"><h1>{title.heading}</h1>{title.lede && <p>{title.lede}</p>}</header>}
                {children}
            </PaneContext.Provider>
        </div>
    );
}

export function CiteBlock({label = 'How to cite', children}) {
    return (
        <details className="tab-cite-block">
            <summary>Citation and reuse guidance</summary>
            <div className="tab-cite-block-label">{label}</div>
            {children}
        </details>
    );
}
export const WebsiteCitation = () => <>Wallrich, L., &amp; Röseler, L. (2026). <em>FLoRA Explorer</em> [Website]. <a href="https://forrt.org/flora-explorer/" target="_blank" rel="noopener noreferrer" className="doi-link">https://forrt.org/flora-explorer/</a></>;

const DIMENSION_TITLES = {replication: 'Replication outcomes', computational: 'Computational reproducibility', robustness: 'Robustness'};
export function OutcomeDefinitions() {
    return (
        <details className="outcome-definitions" data-outcome-definitions>
            <summary>Outcome definitions</summary>
            {Object.entries(DIMENSION_TITLES).map(([dimension, title]) => (
                <section key={dimension}>
                    <h3>{title}</h3>
                    <dl>{FloraVocabulary.entries(dimension).map(entry => <div key={entry.key}><dt>{entry.label}</dt><dd>{entry.definition}</dd></div>)}</dl>
                </section>
            ))}
            <section>
                <h3>Units</h3>
                <dl>{Object.entries(FloraVocabulary.units()).map(([unit, definition]) => <div key={unit}><dt>{unit}</dt><dd>{definition}</dd></div>)}</dl>
            </section>
        </details>
    );
}

// A definition that opens on hover or focus and closes on Escape without moving focus.
function useTip() {
    const id = useId();
    const [dismissed, setDismissed] = useState(false);
    const engaged = useRef(false);
    const opening = useRef(false);
    useEffect(() => {
        const onKey = e => { if (e.key === 'Escape' && engaged.current) setDismissed(true); };
        const onScroll = e => {
            // On phones a scroll closes the tip, unless the scroll is the browser revealing a newly focused one.
            if (!engaged.current || opening.current || !matchMedia('(max-width: 600px)').matches || e.target.closest?.('.info-tip, .gloss-tip')) return;
            setDismissed(true);
        };
        document.addEventListener('keydown', onKey);
        document.addEventListener('scroll', onScroll, true);
        return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('scroll', onScroll, true); };
    }, []);
    const engage = () => { engaged.current = true; setDismissed(false); };
    const release = () => { engaged.current = false; setDismissed(false); };
    const node = useRef(null);
    // Native listener: assistive tools can dispatch a non-bubbling focus that React's focusin handler never sees.
    useEffect(() => {
        const el = node.current;
        const onFocus = () => { engage(); opening.current = true; requestAnimationFrame(() => requestAnimationFrame(() => { opening.current = false; })); };
        el.addEventListener('focus', onFocus);
        return () => el.removeEventListener('focus', onFocus);
    }, []);
    return {id, dismissed, trigger: {
        ref: node, tabIndex: 0, 'aria-describedby': id,
        onMouseEnter: engage, onClick: engage, onMouseLeave: release, onBlur: release,
    }};
}
export function InfoTip({label, wide, children}) {
    const tip = useTip();
    return (
        <span className={'info-icon' + (tip.dismissed ? ' tip-dismissed' : '')} role="img" aria-label={label} {...tip.trigger}>
            <Icon.info />
            <span className={'info-tip' + (wide ? ' info-tip-wide' : '')} id={tip.id} role="tooltip">{children}</span>
        </span>
    );
}
export function Gloss({term, children}) {
    const tip = useTip();
    return <span className={'gloss' + (tip.dismissed ? ' tip-dismissed' : '')} {...tip.trigger}>{term}<span className="gloss-tip" id={tip.id} role="tooltip">{children}</span></span>;
}

function Badge({dimension, outcomeKey, prefix}) {
    const entry = FloraVocabulary.item(dimension, outcomeKey);
    // "Robustness challenges" under a "Robustness" heading reads as "Challenges".
    const value = prefix && entry.label.toLowerCase().startsWith(prefix.toLowerCase() + ' ')
        ? entry.label.slice(prefix.length + 1).replace(/^./, c => c.toUpperCase()) : entry.label;
    return (
        <span className={`badge outcome-tag badge-${entry.key === 'technical_failure' ? 'failed' : entry.color}`} title={entry.definition}>
            {prefix && <><span className="badge-dim">{prefix}<span className="visually-hidden">:</span></span>{' '}</>}
            <span className="badge-value">{value}</span>
        </span>
    );
}
export function OutcomeBadge({row}) {
    if (classifyKind(row) !== 'reproduction') return <Badge dimension="replication" outcomeKey={classifyOutcome(row.outcome)} />;
    const d = parseReproductionOutcome(row.outcome);
    return <span className="outcome-tags"><Badge dimension="computational" outcomeKey={d.computational} prefix="Computational" /> <Badge dimension="robustness" outcomeKey={d.robustness} prefix="Robustness" /></span>;
}

const KIND_OPTIONS = [['all', 'All'], ['replication', 'Replications'], ['reproduction-numerical', 'Numerical reproductions'], ['reproduction-robustness', 'Robustness reproductions']];
export const kindLabel = kind => KIND_OPTIONS.find(o => o[0] === kind)?.[1] || kind;

// Study-type filter with an "All" option (Browse, Years & Disciplines).
export function KindFilter({value, onChange, buttonClass = '', count, countId, className = '', live}) {
    return (
        <div className={'trend-filter ' + className} role="group" aria-label="Study type">
            <span className="trend-filter-label">Study type:</span>
            {KIND_OPTIONS.map(([kind, label]) => (
                <button key={kind} type="button" className={`trend-filter-btn ${buttonClass}${value === kind ? ' active' : ''}`} data-kind={kind}
                    aria-pressed={value === kind} onClick={() => onChange(kind)}>{label}</button>
            ))}
            <span className="trend-filter-count" id={countId} role={live ? 'status' : undefined}>{count}</span>
        </div>
    );
}

// Single-select chips where one option is always active (analysis tabs).
export function Chips({id, label, value, onChange, options = KIND_OPTIONS.filter(o => KINDS.includes(o[0])), heading = 'Study type:', className = 'study-type-select'}) {
    const {announce} = useView();
    return (
        <div className={'chip-group ' + className} id={id} role="group" aria-label={label}>
            {heading && <span className="filter-label">{heading}</span>}
            {options.map(([key, text]) => (
                <button key={key} type="button" className={'chip' + (value === key ? ' active' : '')} data-value={key} aria-pressed={value === key}
                    onClick={() => { onChange(key); announce(`${label}: ${text} selected.`); }}>{text}</button>
            ))}
        </div>
    );
}

// Zero-valued categories carry no information as headline tiles.
export function StatTiles({id, tiles, box}) {
    const shown = tiles.filter(t => t && (t.always || t.value > 0));
    return (
        <div id={id} className="mc-overview-grid" data-count={shown.length}>
            {shown.map(t => (
                <div className={box ? 'mc-stat-box' : 'mc-stat'} key={t.label}>
                    <div className="mc-stat-value">{t.value.toLocaleString('en-GB')}</div>
                    <div className="mc-stat-label">{t.label}</div>
                </div>
            ))}
        </div>
    );
}

export const Placeholder = ({id, children}) => <div id={id} className="coming-soon-placeholder">{children}</div>;
export const Caveat = ({id, children}) => <div id={id} className="key-distinction"><strong>Interpretation caveat:</strong> {children}</div>;

// Picks the copy variant for the selected study type: [replication, numerical, robustness].
export const byKind = (kind, variants) => variants[Math.max(0, KINDS.indexOf(kind))] ?? variants[0];
export const repWord = kind => kind === 'replication' ? 'replication' : 'reproduction';

export function ExternalLink({href, children, className = 'doi-link', ...rest}) {
    return <a href={href} target="_blank" rel="noopener noreferrer" className={className} {...rest}>{children}</a>;
}

export function CopyButton({getText, className = 'copy-btn', label, children = 'Copy', id}) {
    const [copied, setCopied] = useState(false);
    return (
        <button type="button" id={id} className={className} aria-label={label}
            onClick={() => navigator.clipboard.writeText(getText()).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}>
            {copied ? 'Copied!' : children}
        </button>
    );
}
