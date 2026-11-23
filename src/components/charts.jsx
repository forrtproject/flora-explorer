import {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {cellText, comparisonOption, comparisonTable, csvText, echarts, plain} from '../lib/charts.js';
import {FloraVocabulary} from '../lib/vocabulary.js';
import {useEnv, usePane} from '../state/env.jsx';
import {useView} from '../state/view.jsx';

// View keys holding each comparison chart's counts/percentages choice.
const COUNTS_KEYS = {'ao-chart': 'aoCounts', 'pub-chart': 'pubCounts', 'rr-chart': 'rrCounts', 'ls-chart': 'lsCounts'};
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
        } catch { setState('failed'); setTimeout(() => setState(s => s === 'failed' ? 'idle' : s), 3000); }
    };
    const label = state === 'copied' ? 'Chart CSV copied' : state === 'failed' ? 'Could not copy chart CSV' : 'Copy chart CSV';
    // The result shows beside the button for two seconds (a check mark and a short label) and is announced.
    return (
        <span className="chart-copy-wrap">
            {state !== 'idle' && <span className={'copy-feedback' + (state === 'failed' ? ' copy-feedback--failed' : '')} aria-hidden="true">{state === 'copied' ? 'CSV copied' : 'Copy failed'}</span>}
            <IconButton id={id + '-data-copy'} className="chart-copy" label={(state === 'copied' ? 'Chart CSV copied for ' : 'Copy chart CSV for ') + title} title={label} onClick={copy}>{state === 'copied' ? <Icon.check /> : <Icon.copy />}</IconButton>
            <span id={id + '-data-copy-status'} className="visually-hidden" role="status">{state === 'idle' ? '' : label}</span>
        </span>
    );
}

// Draws an ECharts option into a div. `option` is an option object, or a function of
// {width} for charts whose layout depends on the space they have. A hidden pane gives the
// div no width, so drawing waits until it is shown; resizes redraw at the new width.
// aspect (height ÷ width) lets a chart grow taller as it gets wider, from `height` up to 70% of the
// window, so wide screens get well-proportioned charts instead of long flat strips.
// heightFor(width), when given, sets the height outright: charts whose rows need a set amount of space each.
export function EChart({id, title, option, height: minHeight, aspect, heightFor, className = '', describedBy}) {
    const ref = useRef(null);
    const chart = useRef(null);
    const [width, setWidth] = useState(0);
    useLayoutEffect(() => {
        const el = ref.current;
        let frame;
        const observer = new ResizeObserver(() => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => { setWidth(Math.round(el.clientWidth)); chart.current?.resize(); });
        });
        observer.observe(el);
        setWidth(Math.round(el.clientWidth));
        return () => { cancelAnimationFrame(frame); observer.disconnect(); chart.current?.dispose(); chart.current = null; };
    }, []);
    const resolved = useMemo(() => width ? (typeof option === 'function' ? option({width}) : option) : null, [option, width]);
    const height = heightFor && width ? heightFor(width)
        : aspect && width && typeof minHeight === 'number' ? Math.round(Math.max(minHeight, Math.min(width * aspect, window.innerHeight * 0.7))) : minHeight;
    useEffect(() => {
        const el = ref.current;
        if (!resolved) return;
        // Only creating a chart needs a visible box; a chart hidden later still takes new data.
        if (!chart.current) {
            if (!el.clientWidth) return;
            chart.current = echarts.init(el, null, {renderer: 'svg'});
        }
        if (el.clientWidth) chart.current.resize();
        chart.current.setOption(resolved, {notMerge: true});
    }, [resolved, height]);
    return <div id={id} ref={ref} className={'echart ' + className} style={height ? {height} : undefined} role="img"
        aria-label={plain(title) + '. Values in the following data table.'} aria-describedby={describedBy || id + '-data'} />;
}

// spec: {option, table, coverage} draws a chart; {comparison: {groups, series}, coverage} draws a
// grouped outcome comparison with a percentages/counts switch; {message} shows text instead.
// heading and note fill the figure's head; frameId names the figure for callers that show or hide it.
// actions adds chart-specific controls before the shared ones (counts switch, CSV copy).
export function Plot({id, title, spec, className = '', height, heading, note, frameId, actions}) {
    const {theme} = useEnv();
    const {view, setView} = useView();
    // A comparison's counts/percentages choice is part of the view, so a shared link reopens it the same way.
    const countsKey = COUNTS_KEYS[id];
    const counts = Boolean(countsKey && view[countsKey]);
    const setCounts = flip => countsKey && setView(prev => ({[countsKey]: flip(Boolean(prev[countsKey]))}));
    const drawable = spec && !spec.message;
    const comparison = drawable && spec.comparison;
    const option = useMemo(() => !drawable ? null : comparison ? ({width}) => comparisonOption(comparison, {counts, width}) : spec.option,
        [drawable, comparison, spec, counts, theme]);
    const table = useMemo(() => {
        if (!drawable) return null;
        const own = comparison ? comparisonTable(comparison) : spec.table;
        return own && {...own, summary: [spec.coverage, own.summary].filter(Boolean).join(' ')};
    }, [drawable, comparison, spec]);

    // Comparisons lay their groups down the side on narrow containers, matching comparisonOption's 600px threshold.
    const comparisonHeightFor = useMemo(() => comparison
        ? width => (width < 600 ? Math.max(440, comparison.groups.length * 65 + 200) : Math.round(Math.max(420, Math.min(width * 0.42, window.innerHeight * 0.7))))
        : undefined, [comparison]);
    const modeLabel = counts ? 'Show percentages' : 'Show counts';
    // Chart-specific actions (such as sharing) stay available when the chart shows a message instead.
    return (
        <Figure id={frameId} title={heading} note={note} actions={(actions || drawable) && <>
            {actions}
            {drawable && comparison && <Button id={id + '-mode'} className="chart-mode" aria-label={`${modeLabel} for ${title}`} onClick={() => setCounts(c => !c)}>{modeLabel}</Button>}
            {drawable && <ChartCopy id={id} title={title} table={table} />}
        </>}>
            {drawable
                ? <EChart key="plot" id={id} title={title} option={option} height={height || spec.height || 380} heightFor={comparisonHeightFor} className={className}
                    aspect={comparison ? undefined : spec.aspect ?? 0.42} />
                : <div id={id} key="message" className={className + ' plot-message'}>{spec?.message}</div>}
            {drawable && <ChartData id={id} title={title} table={table} />}
        </Figure>
    );
}

// Shared data for the grouped outcome comparisons (authorship, Registered Reports, venue, report size).
export function comparisonSpec(buckets, groups, labels, by) {
    return {comparison: {groups: groups.map(g => labels[g]), series: buckets.map(b => ({name: b.label, color: b.color, values: groups.map(g => by?.[g]?.[b.key] || 0)}))}};
}
