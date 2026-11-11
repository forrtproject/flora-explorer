import {Fragment, useEffect, useId, useRef, useState} from 'react';
import {flushSync} from 'react-dom';
import {useApp, stampParts} from '../state/context.jsx';
import {classifyOutcome, parseReproductionOutcome, STUDY_TYPE_CHIPS, KIND_FILTER_BUTTONS} from '../lib/outcomes.js';

export const ExternalLink = ({href, className = 'doi-link', children, ...rest}) =>
    <a href={href} target="_blank" rel="noopener noreferrer" className={className} {...rest}>{children}</a>;

const REPRO_LABELS = {successful: 'Reproducible', issues: 'Computational issues', technical_failure: 'Technical failure',
    robust: 'Robust', challenges: 'Robustness challenges', not_checked: 'Not checked'};
const reproTone = key => key === 'successful' || key === 'robust' ? 'successful'
    : key === 'issues' || key === 'challenges' || key === 'technical_failure' ? 'failed' : 'unknown';

export function OutcomeBadge({outcome}) {
    const raw = String(outcome || 'Not coded');
    if (raw.includes(',') || /computational|robustness/i.test(raw)) {
        const d = parseReproductionOutcome(raw);
        return <>{[['Computational', d.computational], ['Robustness', d.robustness]].map(([label, key], i) => <Fragment key={label}>
            {i > 0 && ' '}<span className={`badge badge-${reproTone(key)}`}>{label}: {REPRO_LABELS[key] || 'Not coded'}</span>
        </Fragment>)}</>;
    }
    return <span className={`badge badge-${classifyOutcome(raw)}`}>{raw}</span>;
}

// Hover/focus definitions; Escape (and page scroll on phones) dismisses the open one.
// Native listeners also catch bare `focus` events, which React's onFocus (focusin) misses.
function useDismissibleTip() {
    const ref = useRef(null);
    const [dismissed, setDismissed] = useState(false);
    useEffect(() => {
        const el = ref.current;
        const onDismiss = e => { if (el.matches(':hover, :focus') && e.detail !== el) flushSync(() => setDismissed(true)); };
        const reset = () => flushSync(() => setDismissed(false));
        const onFocus = () => { reset(); window.dispatchEvent(new CustomEvent('flora-tip-opening', {detail: el})); };
        const events = [['focus', onFocus], ['click', reset], ['mouseleave', reset], ['blur', reset]];
        events.forEach(([type, fn]) => el.addEventListener(type, fn));
        document.addEventListener('flora-dismiss-tips', onDismiss);
        return () => {
            events.forEach(([type, fn]) => el.removeEventListener(type, fn));
            document.removeEventListener('flora-dismiss-tips', onDismiss);
        };
    }, []);
    return {ref, dismissed, handlers: {}};
}

const INFO_SVG = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>;

export function InfoTip({label, children}) {
    const id = useId();
    const {ref, dismissed, handlers} = useDismissibleTip();
    return <span ref={ref} className={'info-icon' + (dismissed ? ' tip-dismissed' : '')} role="img" tabIndex={0} aria-label={label} aria-describedby={id} {...handlers}>
        {INFO_SVG}<span className="info-tip" id={id} role="tooltip">{children}</span>
    </span>;
}

export function Gloss({term, children}) {
    const id = useId();
    const {ref, dismissed, handlers} = useDismissibleTip();
    return <span ref={ref} className={'gloss' + (dismissed ? ' tip-dismissed' : '')} tabIndex={0} aria-describedby={id} {...handlers}>
        {term}<span className="gloss-tip" id={id} role="tooltip">{children}</span>
    </span>;
}

export function DataStamp({source}) {
    const {stamps} = useApp();
    const meta = stamps[source];
    if (meta === undefined) return <div className="data-stamp" data-stamp-source={source} />;
    const p = stampParts(source, meta);
    if (p.missing) return <div className="data-stamp missing" data-stamp-source={source}>{p.label}: <em>no snapshot yet</em></div>;
    const ageDays = (Date.now() - p.dt.getTime()) / 86400000;
    const stale = ['citations', 'reproduction_citations', 'impact_factor', 'rr_status'].includes(source) ? ageDays > 14 : ageDays > 3;
    return <div className={'data-stamp' + (stale ? ' stale' : '')} data-stamp-source={source}>
        {p.label} last updated: <strong>{p.formatted}</strong>
        {p.snapshot && <> · <span title={p.snapshot.raw}>input snapshot: {p.snapshot.text}</span></>}
        {p.recalculated && <> · recalculated: {p.recalculated}</>}
        {p.partial && ' · Partial refresh: some records are unavailable'}
        {p.sourceUrl && <> · <ExternalLink href={p.sourceUrl}>{p.label} source</ExternalLink></>}
    </div>;
}

export const WebsiteCitation = () => <>Wallrich, L., &amp; Röseler, L. (2026). <em>FLoRA Explorer</em> [Website]. <ExternalLink href="https://forrt.org/flora-explorer/">https://forrt.org/flora-explorer/</ExternalLink></>;

export function DatasetCitation() {
    const {citation} = useApp();
    if (!citation) return 'Loading citation…';
    if (citation.error) return <span style={{color: 'var(--color-muted-fg)'}}>Could not load live citation. Please see the <a href={citation.url} target="_blank" className="doi-link">CITATION.cff file</a>.</span>;
    const c = citation;
    return <>{c.authorsStr && c.authorsStr + ' '}({c.year}). <em>{c.title}</em>{c.version} [Dataset].{c.doi && <> <a href={`https://doi.org/${c.doi}`} target="_blank" className="doi-link">https://doi.org/{c.doi}</a></>}</>;
}

export function CiteBlock({label = 'How to cite', children}) {
    return <details className="tab-cite-block"><summary>Citation and reuse guidance</summary>
        <div className="tab-cite-block-label">{label}</div>{children}</details>;
}

export const REUSE_TEXT = 'The projects embedded in this website are the work of over two hundred paid and volunteer researchers over more than four years. Please cite the respective works when (re-)using them. If you expect to profit from this work, for example through a grant application based on these data, please consider reaching out to us to involve members of the community.';

export function StudyTypeChips({id, label, value, onChange}) {
    const {announce} = useApp();
    return <div className="chip-group study-type-select" id={id} role="group" aria-label={label}>
        {STUDY_TYPE_CHIPS.map(c => <button key={c.value} className={'chip' + (value === c.value ? ' active' : '')} data-value={c.value}
            aria-pressed={value === c.value} onClick={() => { onChange(c.value); announce(`${label}: ${c.label} selected.`); }}>{c.label}</button>)}
    </div>;
}

export function ChipGroup({id, label, options, value, onChange, className = 'chip-group'}) {
    const {announce} = useApp();
    return <div className={className} id={id} role="group" aria-label={label}>
        {options.map(o => <button key={o.value} className={'chip' + (value === o.value ? ' active' : '')} data-value={o.value}
            aria-pressed={value === o.value} onClick={() => { onChange(o.value); announce(`${label}: ${o.label} selected.`); }}>{o.label}</button>)}
    </div>;
}

export function KindFilter({value, onChange, buttonClass = '', count, countId, countRole, className = ''}) {
    return <div className={'trend-filter ' + className} role="group" aria-label="Filter by study kind">
        <span className="trend-filter-label">Show:</span>
        {KIND_FILTER_BUTTONS.map(b => <button key={b.kind} type="button" className={`trend-filter-btn ${buttonClass}${value === b.kind ? ' active' : ''}`}
            data-kind={b.kind} aria-pressed={value === b.kind} onClick={() => onChange(b.kind)}>{b.label}</button>)}
        <span className="trend-filter-count" id={countId} role={countRole}>{count}</span>
    </div>;
}

// Marks copy that varies with the selected study type.
export const KindText = ({children}) => <span data-kind-text="">{children}</span>;

export const Placeholder = ({id, children}) => <div id={id} className="coming-soon-placeholder">{children}</div>;
