import {useEffect, useMemo, useRef, useState, useCallback} from 'react';
import {Chart} from 'chart.js/auto';
import {useApp, usePane, exportContext} from '../state/context.jsx';
import {csvText, formatCell} from '../lib/chartUtils.js';
import {chartJsTable, createChart, COMPARISON_IDS, purge} from '../lib/floraCharts.js';

export const useChartJsTable = (id, config, eligible) => useMemo(() => chartJsTable(id, config, eligible), [id, config, eligible]);

export function useExportContext() {
    const {stamps} = useApp();
    return exportContext(stamps, usePane());
}

export function ChartData({id, title, table}) {
    const context = useExportContext();
    if (!table) return null;
    return (
        <details id={id + '-data'} className="chart-data">
            <summary aria-label={`View chart data for ${title}`}>View chart data</summary>
            <p className="chart-summary">{table.summary}</p>
            <p className="chart-context">{context}</p>
            <div className="table-scroll" tabIndex={0} role="region" aria-label={`${title}: chart values`}>
                <table>
                    <caption>{title}</caption>
                    <thead><tr>{table.headers.map((h, i) => <th scope="col" key={i}>{h}</th>)}</tr></thead>
                    <tbody>{table.rows.map((row, r) => (
                        <tr key={r}>{row.map((v, i) => i
                            ? <td key={i}>{formatCell(v, table.headers[i])}</td>
                            : <th scope="row" key={i}>{formatCell(v, table.headers[i])}</th>)}</tr>
                    ))}</tbody>
                </table>
            </div>
        </details>
    );
}

const COPY_ICON = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>;

export function ChartCopy({id, title, table}) {
    const context = useExportContext();
    const [state, setState] = useState('idle');
    const [status, setStatus] = useState('');
    const timer = useRef();
    useEffect(() => () => clearTimeout(timer.current), []);
    if (!table) return null;
    const copy = async () => {
        setStatus('');
        try {
            await navigator.clipboard.writeText(csvText(table.headers, table.rows, table.summary + '\n' + context));
            setState('copied'); setStatus('Chart CSV copied');
            clearTimeout(timer.current);
            timer.current = setTimeout(() => setState('idle'), 2000);
        } catch {
            setState('failed'); setStatus('Could not copy chart CSV');
        }
    };
    const label = state === 'copied' ? 'Chart CSV copied for ' + title : 'Copy chart CSV for ' + title;
    const tip = {copied: 'Chart CSV copied', failed: 'Could not copy chart CSV'}[state] || 'Copy chart CSV';
    return <>
        <button id={id + '-data-copy'} type="button" className="chart-copy icon-action" aria-label={label} title={tip} onClick={copy}>{COPY_ICON}</button>
        <span id={id + '-data-copy-status'} className="visually-hidden" role="status">{status}</span>
    </>;
}

// Chart.js canvas; `config` must be rebuilt (new object) whenever the chart should redraw.
export function ChartCanvas({id, config, title}) {
    const ref = useRef(null);
    useEffect(() => {
        if (!config) return undefined;
        const chart = createChart(ref.current, config);
        return () => chart.destroy();
    }, [config]); // eslint-disable-line react-hooks/exhaustive-deps
    return <canvas id={id} ref={ref} role="img" aria-label={title + '. Values in the following data table.'} aria-describedby={id + '-data'} />;
}

export const getChart = id => Chart.getChart(id);

/**
 * Plotly chart owned by Plotly (React renders no children into it).
 * build(el) → {traces, layout, config, options} | {empty: message} | null, called at every draw
 * so width-dependent layouts recompute. Redraws on `deps`, theme, mode and debounced resize.
 */
export function PlotlyChart({id, className = 'plot', build, deps = [], title, active = true, copyBeforeChart = false, style}) {
    const {theme} = useApp();
    const ref = useRef(null);
    const [table, setTable] = useState(null);
    const [empty, setEmpty] = useState(null);
    const [mode, setMode] = useState('percent');
    const buildRef = useRef(build); buildRef.current = build;
    const comparison = COMPARISON_IDS.has(id);

    const draw = useCallback(() => {
        const el = ref.current;
        if (!el) return;
        const spec = active ? buildRef.current(el) : null;
        if (!spec || spec.empty) {
            purge(el); setTable(null); setEmpty(spec?.empty || null);
            el.removeAttribute('role'); el.removeAttribute('aria-label');
            return;
        }
        setEmpty(null);
        const result = window.FloraCharts.plot(id, spec.traces, spec.layout, spec.config, {...spec.options, mode, title});
        Promise.resolve(result).then(r => { if (r && ref.current === el) setTable(r.table); });
    }, [id, active, mode, title]);

    useEffect(() => { draw(); }, [draw, theme, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        let t;
        const onResize = () => {
            clearTimeout(t);
            t = setTimeout(() => { if (ref.current?.getClientRects().length) draw(); }, 120);
        };
        window.addEventListener('resize', onResize);
        return () => { window.removeEventListener('resize', onResize); clearTimeout(t); };
    }, [draw]);

    useEffect(() => () => purge(ref.current), []);

    const shown = table && !empty;
    const copy = shown && <ChartCopy id={id} title={title} table={table} />;
    return <>
        {comparison && shown && (
            <button id={id + '-mode'} type="button" className="chart-mode"
                aria-label={(mode === 'count' ? 'Show percentages' : 'Show counts') + ' for ' + title}
                onClick={() => setMode(m => m === 'count' ? 'percent' : 'count')}>
                {mode === 'count' ? 'Show percentages' : 'Show counts'}
            </button>
        )}
        {copyBeforeChart && copy}
        <div id={id} ref={ref} className={className} style={empty ? {...style, display: 'none'} : style}
            aria-describedby={shown ? id + '-data' : undefined} />
        {empty && <div className="chart-empty" style={{display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 180, color: 'var(--color-muted-fg)', fontSize: '0.9rem', textAlign: 'center', padding: '2rem'}}>{empty}</div>}
        {!copyBeforeChart && copy}
        {shown && <ChartData id={id} title={title} table={table} />}
    </>;
}
