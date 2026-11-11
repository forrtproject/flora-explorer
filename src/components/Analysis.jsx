import {useEffect, useState} from 'react';
import {theme as chartTheme} from '../lib/chartUtils.js';
import {studyTypeOutcomeBuckets} from '../lib/outcomes.js';
import {registerRenderer, setLive} from '../testHooks.js';
import {PlotlyChart} from './Charts.jsx';

// Fetches the given JSON files once the tab is first opened. The loaded object stays
// mutable and is exposed for tests; `refresh` redraws after an in-place change.
export function useAnalysisData(name, liveKey, enabled, loader) {
    const [state, setState] = useState({status: 'idle', data: null, error: null});
    const [version, setVersion] = useState(0);
    useEffect(() => registerRenderer(name, () => setVersion(v => v + 1)), [name]);
    useEffect(() => {
        if (!enabled || state.status !== 'idle') return;
        setState({status: 'loading', data: null, error: null});
        loader().then(data => { if (liveKey) setLive(liveKey, data); setState({status: 'ready', data, error: null}); },
            error => setState({status: 'error', data: null, error}));
    }, [enabled, state.status]); // eslint-disable-line react-hooks/exhaustive-deps
    return {...state, version};
}

export async function fetchJson(url, {optional = false} = {}) {
    const res = await fetch(url, {cache: 'no-cache'});
    if (!res.ok) { if (optional) return null; throw new Error('HTTP ' + res.status); }
    if (!optional) return res.json();
    try { return await res.json(); } catch { return null; }
}

export const Stat = ({value, label, box = false}) => <div className={box ? 'mc-stat-box' : 'mc-stat'}>
    <div className="mc-stat-value">{value}</div><div className="mc-stat-label">{label}</div>
</div>;

export function Loading({id, show}) {
    return <div id={id} className="note note-loading" style={show ? undefined : {display: 'none'}}>Loading analysis…</div>;
}

export function LoadError({id, error, children}) {
    return <div id={id} className="note" style={error ? {display: 'block'} : {display: 'none'}}>
        {children}{' '}<code id={id + '-detail'} className="note-detail">{error ? String(error) : ''}</code>
    </div>;
}

// Grouped outcome bars per group; FloraCharts turns them into within-group percentages.
export function ComparisonChart({id, title, kind, groups, by, deps}) {
    const build = () => {
        const th = chartTheme();
        const buckets = studyTypeOutcomeBuckets(kind);
        const noun = kind === 'replication' ? 'replications' : 'reproductions';
        return {
            traces: buckets.map(b => ({name: b.label, type: 'bar', x: groups.map(([, label]) => label),
                y: groups.map(([g]) => (by[g] && by[g][b.key]) || 0), marker: {color: b.color}})),
            layout: {
                barmode: 'group', height: 420, paper_bgcolor: th.paper, plot_bgcolor: th.plot,
                font: {color: th.font, size: 13}, legend: {orientation: 'h', y: -0.18, font: {color: th.font}},
                margin: {l: 50, r: 20, t: 20, b: 80},
                yaxis: {title: 'Number of ' + noun, gridcolor: th.grid, zerolinecolor: th.grid, tickfont: {color: th.font}, titlefont: {color: th.font}},
                xaxis: {tickfont: {color: th.font}},
            },
            config: {responsive: true, displayModeBar: false},
        };
    };
    return <div className="mc-chart-wrap"><PlotlyChart id={id} className="" title={title} build={build} deps={deps} /></div>;
}

export const kindPairsLabel = kind => kind === 'replication' ? 'Replication' : 'Reproduction';
