import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {useApp, PaneContext} from '../state/context.jsx';
import {normalizeDoi} from '../lib/search.js';
import {citationAuthors} from '../lib/format.js';
import {number, countAxis, theme as chartTheme, token} from '../lib/chartUtils.js';
import {PlotlyChart} from '../components/Charts.jsx';
import {CI_COLORS, citationLink} from '../lib/citationShared.js';

const TIMELINE_NARROW = 600;
const MODAL_PANE = {sources: ['citations'], selection: []};
const studyCache = {};

async function loadStudy(entry) {
    if (studyCache[entry.doi]) return studyCache[entry.doi];
    const res = await fetch('data/originals/' + encodeURIComponent(entry.file));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return (studyCache[entry.doi] = await res.json());
}

// Display order only; stored order still defines ties in the aggregate model.
const chronological = s => [...(s.replications || [])].sort((a, b) => (Number(a.year) || Infinity) - (Number(b.year) || Infinity));

function setBackgroundInert(value) {
    document.querySelectorAll('.top-bar, .app-main, .footer-bar').forEach(el => { el.inert = value; });
}

export default function CitationModal({index, meta, openRef}) {
    const {view, updateView, historyNav} = useApp();
    const [loaded, setLoaded] = useState({doi: null, study: null, error: false});
    const lastFocus = useRef(null);
    const closeRef = useRef(null), modalRef = useRef(null);

    const matchDoi = index && view.doi ? index.find(s => normalizeDoi(s.doi) === normalizeDoi(view.doi))?.doi : null;
    const entry = matchDoi ? index.find(s => s.doi === matchDoi) : null;
    const open = !!entry && view.tab === 'citation-tab';

    openRef.current = doi => {
        lastFocus.current = document.activeElement;
        // A user-opened timeline gets its own history entry; share links stay in place.
        history.pushState(null, '', citationLink(doi));
        updateView({doi});
    };

    // A deep link may name the DOI with a prefix or different case; keep the index's form.
    useEffect(() => { if (open && matchDoi !== view.doi) updateView({doi: matchDoi}); }, [open, matchDoi, view.doi, updateView]);

    useEffect(() => {
        if (!entry) return;
        let cancelled = false;
        setLoaded(l => l.doi === entry.doi ? l : {doi: entry.doi, study: null, error: false});
        loadStudy(entry).then(study => { if (!cancelled) setLoaded({doi: entry.doi, study, error: false}); },
            e => { console.error('Citation timeline load failed:', e); if (!cancelled) setLoaded({doi: entry.doi, study: null, error: true}); });
        return () => { cancelled = true; };
    }, [entry]);

    const wasOpen = useRef(false);
    useLayoutEffect(() => {
        if (open) {
            if (!wasOpen.current && !lastFocus.current) lastFocus.current = document.activeElement;
            setBackgroundInert(true);
            closeRef.current?.focus();
        } else if (wasOpen.current) {
            setBackgroundInert(false);
            if (historyNav.current) {
                // History restoration focuses the destination pane, never the hidden citation pane.
                const pane = document.querySelector('.tab-pane.active');
                pane?.setAttribute('tabindex', '-1'); pane?.focus({preventScroll: true});
            } else if (lastFocus.current?.isConnected) lastFocus.current.focus();
            else document.querySelector(`#originals-table .timeline-open`)?.focus();
            lastFocus.current = null;
        }
        wasOpen.current = open;
    }, [open, loaded.study]); // eslint-disable-line react-hooks/exhaustive-deps

    const close = () => updateView({doi: null});

    useEffect(() => {
        if (!open) return;
        const onKey = e => {
            const modal = modalRef.current;
            if (e.key === 'Tab') {
                const items = [...modal.querySelectorAll('button, a[href], input, select, summary, [tabindex="0"]')].filter(el => el.getClientRects().length);
                const first = items[0], last = items[items.length - 1];
                if (e.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) { e.preventDefault(); last?.focus(); }
                else if (!e.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) { e.preventDefault(); first?.focus(); }
            }
            if (e.key === 'Escape') close();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }); // eslint-disable-line react-hooks/exhaustive-deps

    const study = loaded.doi === entry?.doi ? loaded.study : null;
    const failed = loaded.doi === entry?.doi && loaded.error;

    return createPortal(
        <div className="modal-backdrop" id="ci-modal" role="dialog" aria-modal="true" aria-label="Citation timeline and replication evidence" hidden={!open}
            ref={modalRef} onClick={e => { if (e.target.id === 'ci-modal') close(); }}>
            <div className="modal-card">
                <div className="modal-toolbar"><span>Citation timeline</span><button className="modal-close" id="ci-modal-close" type="button" aria-label="Close citation timeline" ref={closeRef} onClick={close}>×</button></div>
                <div id="ci-modal-body">{open && <PaneContext.Provider value={MODAL_PANE}>
                    <div className="modal-body">
                        <Header entry={study || entry} />
                        {study ? <StudyBody study={study} meta={meta} />
                            : <p className="muted" style={{padding: '40px 0', textAlign: 'center'}}>{failed ? 'Could not load the citation timeline for this study.' : 'Loading citation timeline…'}</p>}
                    </div>
                </PaneContext.Provider>}</div>
            </div>
        </div>, document.body);
}

function Header({entry}) {
    return <>
        <h2>{entry.title || '(untitled)'}</h2>
        <p className="muted">{citationAuthors(entry.author)} · {entry.year || '?'}{' '}
            {entry.venue && entry.venue !== 'nan' ? '· ' + entry.venue : ''}<br />
            <a href={`https://doi.org/${entry.doi}`} target="_blank">{entry.doi}</a></p>
    </>;
}

function ShareButton({doi}) {
    const [copied, setCopied] = useState(false);
    const share = () => {
        const link = citationLink(doi);
        navigator.clipboard.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })
            .catch(() => window.prompt('Copy this link:', link));
    };
    return <button type="button" className="ci-share-btn" data-doi={doi} onClick={share}>{copied ? 'Link copied' : 'Copy link to this chart'}</button>;
}

function StudyBody({study: s, meta}) {
    const reps = chronological(s);
    const conflated = s.cocit_conflated;
    return <>
        <ShareButton doi={s.doi} />
        <h3 style={{marginTop: 18}}>Citation timeline</h3>
        {conflated ? <p className="cocit-warning">Co-citation can't be measured for {conflated > 1 ? 'some replications of ' : ''}this study: OpenCitations groups the original and {conflated > 1 ? 'those replications' : 'its replication'} under one record, so citations of the two can't be told apart. The timeline below counts all of them as citations of the original.</p> : null}
        {(s.timeline || []).length === 0
            ? <div id="study-plot" style={{width: '100%'}}><div style={{padding: 80, textAlign: 'center', color: 'var(--color-muted-fg)'}}>No citation data available</div></div>
            : <PlotlyChart id="study-plot" className="" title="Citation timeline" style={TIMELINE_STYLE} build={el => timelineSpec(el, s, reps, meta)} deps={[s]} />}
        <h3 style={{marginTop: 18}}>Replications ({number(s.n_replications)})</h3>
        <ul className="rep-list">{reps.map((r, i) => <li key={i}>
            <span className="rep-marker" role="img" style={{color: CI_COLORS[r.outcome] || 'inherit'}} aria-label={`Marker ${i + 1}`}>{i + 1}</span>{' '}
            <span className={'outcome-badge ' + r.outcome}>{r.outcome}</span>{' '}
            <strong>{citationAuthors(r.author, 2)} ({r.year || '?'})</strong>{' '}
            {r.title ? '— ' + r.title : ''}
            {r.doi && <><br /><a href={`https://doi.org/${r.doi}`} target="_blank" className="small">{r.doi}</a></>}
        </li>)}</ul>
    </>;
}
const TIMELINE_STYLE = {width: '100%', height: '380px'};

// Each numbered event label takes a pixel-spaced lane so nearby (and same-year) events never overlap.
function timelineSpec(el, s, reps, meta) {
    const tl = s.timeline;
    const years = tl.map(t => t.year);
    const traces = [
        {x: years, y: tl.map(t => t.only), name: 'Cites original only', type: 'bar', marker: {color: token('--color-chart-neutral')}},
        {x: years, y: tl.map(t => t.with_failed), name: 'Co-cites failed rep', type: 'bar', marker: {color: CI_COLORS.failed}},
        {x: years, y: tl.map(t => t.with_mixed), name: 'Co-cites mixed rep', type: 'bar', marker: {color: CI_COLORS.mixed}},
        {x: years, y: tl.map(t => t.with_successful), name: 'Co-cites successful rep', type: 'bar', marker: {color: CI_COLORS.successful}},
        {x: years, y: tl.map(t => t.with_multiple || 0), name: 'Co-cites multiple outcome categories', type: 'bar', marker: {color: token('--color-chart-qualified')}},
    ].filter(trace => trace.y.some(v => v > 0));
    // The coverage year stays partial even if this snapshot is viewed in a later year.
    const partialYear = Number((meta?.last_updated || '').slice(0, 4)) || new Date().getFullYear();
    traces.forEach(trace => {
        trace.marker.opacity = years.map(year => year === partialYear ? 0.45 : 1);
        trace.hovertemplate = 'Year: %{x}<br>Citations: %{y:,.0f}<extra>%{fullData.name}</extra>';
    });
    const maxYearlyCount = Math.max(0, ...years.map((_, i) => traces.reduce((n, trace) => n + trace.y[i], 0)));
    const t = chartTheme();
    const narrow = window.innerWidth < TIMELINE_NARROW;
    const shapes = [], annotations = [], lanes = [];
    const width = el.clientWidth - (narrow ? 80 : 60);
    const minYear = Math.min(...years), span = Math.max(...years) - minYear + 1;
    reps.forEach((r, i) => {
        if (!r.year) return;
        const color = CI_COLORS[r.outcome] || t.primary;
        shapes.push({type: 'line', x0: r.year, x1: r.year, yref: 'paper', y0: 0, y1: 1, line: {color, width: 2, dash: 'dash'}});
        const label = narrow ? String(i + 1) : `${i + 1} · ${r.outcome} ${r.year}`;
        const x = (r.year - minYear) * width / span, half = label.length * (narrow ? 3.5 : 3) + 5;
        let row = lanes.findIndex(end => end + 6 < x - half);
        if (row < 0) row = lanes.length;
        lanes[row] = x + half;
        annotations.push({name: 'replication-event', x: r.year, yref: 'paper', y: 1.02, yshift: -row * 22, text: label, showarrow: false, borderpad: 2, font: {size: narrow ? 11 : 10, color}, bgcolor: t.paper});
    });
    if (years.includes(partialYear)) annotations.push({name: 'partial-year', x: partialYear, xref: 'x', yref: 'paper', y: 1.14, xanchor: 'right', text: `${partialYear}: partial year`, showarrow: false, font: {size: 11, color: t.muted}});
    return {traces, config: {displayModeBar: false, responsive: true}, options: {height: '380px'}, layout: {
        barmode: 'stack', margin: {t: 50, r: 10, b: 40, l: 50},
        xaxis: {title: 'Year', gridcolor: t.grid, color: t.font},
        yaxis: {title: 'Citing preprints / papers', ...countAxis(maxYearlyCount), gridcolor: t.grid, color: t.font},
        shapes, annotations, hoverlabel: {namelength: -1},
        plot_bgcolor: t.plot, paper_bgcolor: t.paper,
        legend: {orientation: 'h', y: -0.18, font: {color: t.font}},
        font: {family: t.fontFamily, size: 12, color: t.font},
    }};
}
