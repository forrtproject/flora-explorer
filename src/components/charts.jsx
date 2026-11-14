import {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {barChart, barSummary, barTable, cellText, csvText, loadPlotly, plain, plotlyNow, preparePlot} from '../lib/charts.js';
import {FloraVocabulary} from '../lib/vocabulary.js';
import {percent} from '../lib/format.js';
import {useEnv, usePane} from '../state/env.jsx';
import {Icon} from './common.jsx';
import {Button, Figure, IconButton} from './ui.jsx';

function useChartContext() {
    const pane = usePane();
    return useMemo(() => {
        const reportKind = pane.kind?.startsWith('reproduction') ? 'reproduction' : pane.kind === 'replication' ? 'replication' : 'replication or reproduction';
        const unit = FloraVocabulary.unitDefinition('Reference pair').replace('replication or reproduction', reportKind);
        return `${pane.stamps || 'Snapshot date: see tab update stamp'}. ${pane.selection ? 'Selection: ' + pane.selection + '. ' : ''}Values and units correspond to the labelled series. ${unit ? unit + ' ' : ''}Reproduction dimensions can overlap.`;
    }, [pane.stamps, pane.selection, pane.kind]);
}

// The same plotted values as a keyboard-accessible table.
export function ChartData({id, title, table}) {
    const context = useChartContext();
    if (!table) return null;
    return (
        <details id={id + '-data'} className="disclosure chart-data">
            <summary aria-label={'View chart data for ' + title}>View chart data</summary>
            <p className="chart-summary">{table.summary}</p>
            <p className="chart-context">{context}</p>
            <div className="table-scroll" tabIndex={0} role="region" aria-label={title + ': chart values'}>
                <table>
                    <caption>{title}</caption>
                    <thead><tr>{table.headers.map(h => <th scope="col" key={h}>{h}</th>)}</tr></thead>
                    <tbody>{table.rows.map((row, r) => (
                        <tr key={r}>{row.map((v, i) => i
                            ? <td key={i}>{cellText(v, table.headers[i])}</td>
                            : <th scope="row" key={i}>{cellText(v, table.headers[i])}</th>)}</tr>
                    ))}</tbody>
                </table>
            </div>
        </details>
    );
}

export function ChartCopy({id, title, table}) {
    const context = useChartContext();
    const [state, setState] = useState('idle');
    if (!table) return null;
    const copy = async () => {
        setState('idle');
        try {
            await navigator.clipboard.writeText(csvText(table.headers, table.rows, table.summary + '\n' + context));
            setState('copied');
            setTimeout(() => setState(s => s === 'copied' ? 'idle' : s), 2000);
        } catch { setState('failed'); }
    };
    const label = state === 'copied' ? 'Chart CSV copied' : state === 'failed' ? 'Could not copy chart CSV' : 'Copy chart CSV';
    return (
        <>
            <IconButton id={id + '-data-copy'} className="chart-copy" label={(state === 'copied' ? 'Chart CSV copied for ' : 'Copy chart CSV for ') + title} title={label} onClick={copy}><Icon.copy /></IconButton>
            <span id={id + '-data-copy-status'} className="visually-hidden" role="status">{state === 'idle' ? '' : label}</span>
        </>
    );
}

// Draws a Chart.js bar chart from build() and returns its ref plus the table describing it.
export function useBarChart(id, title, build, deps, {enabled = true, eligible = 0, scope = 'counts'} = {}) {
    const ref = useRef(null);
    const chart = useRef(null);
    const {theme} = useEnv();
    const [table, setTable] = useState(null);
    useLayoutEffect(() => {
        if (!enabled || !ref.current) return;
        const config = build();
        const {headers, rows, total} = barTable(config);
        setTable({headers, rows, summary: barSummary(total, eligible, scope)});
        chart.current = barChart(ref.current, config);
        return () => { chart.current?.destroy(); chart.current = null; };
    }, [enabled, theme, eligible, scope, ...deps]);
    const canvasProps = {id, ref, role: 'img', 'aria-label': title + '. Values in the following data table.', 'aria-describedby': table ? id + '-data' : undefined};
    return {canvasProps, table};
}

// One horizontal stacked bar: the share of each outcome within a dimension.
export function outcomeBarConfig(datasets, total, categoryLabel) {
    return {
        type: 'bar',
        data: {labels: [categoryLabel], datasets},
        options: {
            indexAxis: 'y',
            plugins: {tooltip: {callbacks: {label: ctx => `${ctx.dataset.label}: ${ctx.parsed.x.toLocaleString()} (${percent(ctx.parsed.x, total, 1)}%)`}}},
            // A proportion bar: its caption states the counts, so it carries no axis.
            scales: {x: {display: false, min: 0, max: Math.max(total, 1)}, y: {display: false}},
            datasets: {bar: {maxBarThickness: 18}},
        },
    };
}

// A Chart.js figure: canvas, copy action and data table under one frame.
export function BarFigure({id, title, canvasProps, table, note, heading, height, containerId, className}) {
    return (
        <Figure className={className} title={heading} note={note} actions={<ChartCopy id={id} title={title} table={table} />}>
            <div className="chart-box" id={containerId} style={height ? {height} : undefined}><canvas {...canvasProps} /></div>
            <ChartData id={id} title={title} table={table} />
        </Figure>
    );
}

const COMPARISON_IDS = new Set(['ao-chart', 'rr-chart', 'pub-chart', 'ls-chart']);

// spec: {traces, layout, config, table?} draws a Plotly chart; {message} shows text instead.
// heading and note fill the figure's head; frameId names the figure for callers that show or hide it.
export function Plot({id, title, spec, className = '', height, redrawOnResize = true, heading, note, frameId}) {
    const ref = useRef(null);
    const pane = usePane();
    const {tick} = useEnv();
    const [counts, setCounts] = useState(false);
    const [loaded, setLoaded] = useState(Boolean(plotlyNow()));
    const comparison = COMPARISON_IDS.has(id);
    const drawable = spec && !spec.message;
    const widthKey = redrawOnResize ? tick : 0;
    const prepared = useMemo(() => drawable ? preparePlot(id, spec, {comparison, counts, fallbackHeight: height || 380}) : null,
        [id, spec, comparison, counts, height, widthKey, drawable]);

    useEffect(() => { if (drawable && !plotlyNow()) loadPlotly().then(() => setLoaded(true)); }, [drawable]);
    useEffect(() => {
        const el = ref.current, Plotly = plotlyNow();
        // A hidden pane gives Plotly a zero-width container, so drawing waits until the pane is shown.
        if (!prepared || !el || !Plotly || !pane.active) return;
        el.style.height = prepared.layout.height ? prepared.layout.height + 'px' : height ? height + 'px' : '';
        Plotly.react(el, prepared.display, prepared.layout, prepared.config);
    }, [prepared, pane.active, loaded, height]);
    useEffect(() => {
        const el = ref.current;
        return () => { const Plotly = plotlyNow(); if (Plotly && el) Plotly.purge(el); };
    }, [drawable]);

    const modeLabel = counts ? 'Show percentages' : 'Show counts';
    return (
        <Figure id={frameId} title={heading} note={note} actions={drawable && <>
            {comparison && <Button id={id + '-mode'} className="chart-mode" aria-label={`${modeLabel} for ${title}`} onClick={() => setCounts(c => !c)}>{modeLabel}</Button>}
            <ChartCopy id={id} title={title} table={prepared.table} />
        </>}>
            {drawable
                ? <div id={id} key="plot" ref={ref} className={className} style={height ? {height} : undefined} role="img"
                    aria-label={plain(spec.layout?.title?.text || title) + '. Values in the following data table.'} aria-describedby={id + '-data'} />
                : <div id={id} key="message" className={className + ' plot-message'}>{spec?.message}</div>}
            {drawable && <ChartData id={id} title={title} table={prepared.table} />}
        </Figure>
    );
}

// Shared layout for the grouped outcome comparisons (authorship, Registered Reports, venue, report size).
export function comparisonSpec(buckets, groups, labels, by) {
    return {
        traces: buckets.map(b => ({name: b.label, type: 'bar', x: groups.map(g => labels[g]), y: groups.map(g => by?.[g]?.[b.key] || 0), marker: {color: b.color}})),
        layout: {barmode: 'group', height: 420, margin: {l: 50, r: 20, t: 20, b: 80}, yaxis: {title: 'Reference pairs'}, xaxis: {}},
    };
}
