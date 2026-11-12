import {useMemo} from 'react';
import {POOL_BEFORE, byField, byJournal, byYear} from '../lib/aggregate.js';
import {BROWSE_KIND_LABELS} from '../lib/config.js';
import {pairs, wrapLabel} from '../lib/format.js';
import {filterByKind, outcomeBuckets} from '../lib/outcomes.js';
import {setHook} from '../lib/hooks.js';
import {useData} from '../state/data.jsx';
import {useEnv, usePane} from '../state/env.jsx';
import {useView} from '../state/view.jsx';
import {ChartCopy, ChartData, axisColors, useBarChart} from '../components/charts.jsx';
import {CiteBlock, DataStamp, KindFilter, OutcomeDefinitions, Pane, Placeholder, byKind, kindLabel, repWord} from '../components/common.jsx';

function stackedConfig(agg, buckets, horizontal) {
    const ac = axisColors();
    const labels = agg.map(r => horizontal ? wrapLabel(r.key, window.innerWidth < 600 ? 18 : 38) : r.key);
    // A dashed rule sets a pooled leading column apart from the year-by-year axis.
    const pooledSeparator = {
        id: 'pooledSeparator',
        afterDatasetsDraw(chart) {
            if (!agg[0]?.pooled || agg.length < 2) return;
            const x = chart.scales.x, area = chart.chartArea, c = chart.ctx;
            const between = (x.getPixelForValue(0) + x.getPixelForValue(1)) / 2;
            c.save(); c.strokeStyle = ac.tick; c.setLineDash([4, 3]); c.lineWidth = 1;
            c.beginPath(); c.moveTo(between, area.top); c.lineTo(between, area.bottom); c.stroke(); c.restore();
        },
    };
    return {
        type: 'bar',
        data: {labels, datasets: buckets.map(b => ({label: b.label, data: agg.map(r => r.counts[b.key] || 0), backgroundColor: b.color}))},
        options: {
            responsive: true, maintainAspectRatio: false, indexAxis: horizontal ? 'y' : 'x',
            plugins: {
                legend: {display: true, position: 'bottom', labels: {color: ac.legend, boxWidth: 14, font: {size: 11}}},
                tooltip: {callbacks: {title: items => { const label = items[0].label; return Array.isArray(label) ? label.join(' ') : label; }}},
            },
            scales: {
                x: {stacked: true, grid: {color: ac.grid}, ticks: {color: ac.tick}},
                y: {stacked: true, grid: {color: ac.grid, display: !horizontal}, ticks: {color: ac.tick, font: {size: horizontal ? 11 : 12}}},
            },
            layout: horizontal ? {padding: {left: 6}} : {},
        },
        plugins: [pooledSeparator],
    };
}

function TrendBlock({id, title, agg, kind, eligible, horizontal, minHeight, children}) {
    const pane = usePane();
    const {theme, tick} = useEnv();
    const buckets = useMemo(() => outcomeBuckets(kind), [kind, theme]);
    const {canvasProps, table} = useBarChart(id, title, () => stackedConfig(agg, buckets, horizontal), [agg, buckets, horizontal, tick], {enabled: pane.visited, eligible});
    const lines = agg.reduce((n, r) => { const label = wrapLabel(r.key, window.innerWidth < 600 ? 18 : 38); return n + (Array.isArray(label) ? label.length : 1) * 15 + 15; }, 70);
    const height = horizontal ? Math.max(minHeight, lines) : undefined;
    return (
        <section className="card"><div className="card-body"><div className="trend-block">
            <div className="trend-desc">
                <div className="trend-title"><h3>{title}</h3><ChartCopy id={id} title={title} table={table} /></div>
                {children}
            </div>
            <div className="trend-chart">
                <div className="chart-container" id={id + '-container'} style={height ? {height} : undefined}><canvas {...canvasProps} /></div>
                <ChartData id={id} title={title} table={table} />
            </div>
        </div></div></section>
    );
}

function TopN({id, value, onChange, noun}) {
    return (
        <div className="top-n">
            <label htmlFor={id} className="note note-label">Show top:</label>
            <select id={id} className="form-select top-n-select" value={value} onChange={e => onChange(e.target.value)}>
                {[10, 15, 25, 50].map(n => <option key={n} value={n}>{n} {noun}</option>)}
            </select>
        </div>
    );
}

export default function Trends() {
    const {rows, disciplineFor} = useData();
    const {view, setView} = useView();
    const {rev} = useEnv();
    const kind = view.trendsKind;
    const data = useMemo(() => filterByKind(rows, kind), [rows, kind, rev]);
    const chartKind = kind === 'all' ? 'replication' : kind;
    const origYear = useMemo(() => byYear(data, 'year_o', chartKind, POOL_BEFORE), [data, chartKind]);
    const repYear = useMemo(() => byYear(data, 'year_r', chartKind), [data, chartKind]);
    const journals = useMemo(() => byJournal(data, 'journal_o', Number(view.journalTopN), chartKind), [data, chartKind, view.journalTopN]);
    const venues = useMemo(() => byJournal(data, 'journal_r', Number(view.repJournalTopN), chartKind), [data, chartKind, view.repJournalTopN]);
    const fields = useMemo(() => byField(data, chartKind, disciplineFor), [data, chartKind, disciplineFor]);
    setHook('trendsFilteredData', () => data);

    const word = repWord(chartKind), attempt = byKind(chartKind, ['replication', 'numerical reproduction', 'robustness reproduction']);
    const count = kind === 'all' ? `${data.length.toLocaleString()} ${pairs(data.length)}` : `${data.length.toLocaleString()} of ${rows.length.toLocaleString()} ${pairs(rows.length)}`;
    const common = {kind: chartKind, eligible: data.length};
    return (
        <Pane id="trends" tabId="trends-tab" sources={['flora']} selection={[kindLabel(kind)]} kind={kind}
            title={{heading: 'Years & Disciplines', lede: 'How recorded outcomes are spread across publication years, journals, venues and research fields.'}}>
            <h2 className="visually-hidden">Outcome summaries</h2>
            <div className="pane-meta">
                <DataStamp source="flora" />
                <OutcomeDefinitions />
                <CiteBlock><div className="cite-ref">Röseler, L. et al. (in preparation). <em>The FORRT Library of Reproduction and Replication Attempts: Documenting the Reproducibility and Replicability of the Sciences and Humanities.</em></div></CiteBlock>
            </div>
            <KindFilter value={kind} onChange={k => setView({trendsKind: k})} countId="trend-filter-count" live
                count={<><span className="visually-hidden">{BROWSE_KIND_LABELS[kind]}: </span>{count}</>} />

            {kind === 'all' && <Placeholder id="trends-placeholder">All mixes replication and reproduction reference pairs, which use different outcome categories, so no outcome charts are shown. Choose a study type to see year, journal and field breakdowns.</Placeholder>}

            <div id="trends-charts" style={kind === 'all' ? {display: 'none'} : undefined}>
                <TrendBlock id="trend-orig-year" title="Outcomes by original study year" agg={origYear} {...common}>
                    <p>{byKind(chartKind, [
                        <>How have findings from different eras fared when researchers tried to replicate them? Each bar groups replication reference pairs by the year the <strong>original</strong> study was published, split by recorded replication outcome.</>,
                        <>How have findings from different eras fared when researchers tried to reproduce them by re-analysing the original data? Each bar groups numerical-reproduction reference pairs by the year the <strong>original</strong> study was published, split by computational verdict.</>,
                        <>How have findings from different eras held up under alternative analysis choices? Each bar groups robustness-reproduction reference pairs by the year the <strong>original</strong> study was published, split by robustness verdict.</>,
                    ])}</p>
                    <p id="trend-orig-year-axis-note">{origYear[0]?.pooled
                        ? `Pairs with original studies published before ${POOL_BEFORE} are sparse and are pooled into the first column, set apart by a dashed line. From ${POOL_BEFORE} the axis runs year by year, so years without any recorded pair appear as gaps.`
                        : 'The axis runs year by year, so years without any recorded pair appear as gaps and elapsed time keeps its scale.'}</p>
                    <p className="trend-note">Reference pairs without a recorded original publication year are excluded.</p>
                </TrendBlock>

                <TrendBlock id="trend-rep-year" title={`Outcomes by ${word} report year`} agg={repYear} {...common}>
                    <p>Grouped by the year of the <strong>{word}</strong> report itself, this view shows the growth of FLoRA's coverage and how outcome profiles have shifted over time.</p>
                    <p>The rightmost years may reflect ongoing data entry rather than a genuine decline in activity.</p>
                    <p className="trend-note">Reference pairs without a recorded {word} year are excluded.</p>
                </TrendBlock>

                <TrendBlock id="trend-journal" title="Outcomes by original journal" agg={journals} horizontal minHeight={Math.max(400, journals.length * 36)} {...common}>
                    <p>The journals whose articles have most frequently been the target of {attempt} attempts. For each journal, the bar shows the outcome breakdown of those attempts.</p>
                    <p>{byKind(chartKind, [
                        "Frequency shows where replication effort has gone, not how replicable a journal's research is.",
                        "Frequency shows where reproduction effort has gone, not how reproducible a journal's research is.",
                        "Frequency shows where reproduction effort has gone, not how robust a journal's research is.",
                    ])}</p>
                    <TopN id="journal-top-n" value={view.journalTopN} onChange={v => setView({journalTopN: v})} noun="journals" />
                </TrendBlock>

                <TrendBlock id="trend-rep-journal" title={`Outcomes by recorded ${word} venue`} agg={venues} horizontal minHeight={Math.max(400, venues.length * 36)} {...common}>
                    <p>Each bar groups reference pairs by the venue recorded for the {word} report, which can be a journal or a repository such as OSF, split by recorded outcome.</p>
                    <p>Counts reflect FLoRA’s coverage, and one report may contribute several pairs, so bars do not rank how actively venues publish {word} research.</p>
                    <p className="trend-note">Annotation of {word}-journal data is a work in progress; some journals may be missing or under-represented at the moment.</p>
                    <TopN id="rep-journal-top-n" value={view.repJournalTopN} onChange={v => setView({repJournalTopN: v})} noun="venues" />
                </TrendBlock>

                <TrendBlock id="trend-field" title="Outcomes by field" agg={fields} horizontal minHeight={Math.max(360, fields.length * 44)} {...common}>
                    <p>A bird's-eye view grouping reference pairs by research discipline. Each bar shows the outcome breakdown of {attempt} attempts targeting work originally published in journals from that field.</p>
                    <p>Disciplines are inferred from the original study's journal name using a hand-curated dictionary (<a href="data/disciplines.json" target="_blank" rel="noopener noreferrer" className="doi-link">journal-to-discipline mapping</a>). Journals that have not been mapped yet are collected under <em>Uncategorized</em>.</p>
                    <p className="trend-note">Coverage is still growing. Journals that are not yet classified may leave some fields under-represented.</p>
                </TrendBlock>
            </div>
        </Pane>
    );
}
