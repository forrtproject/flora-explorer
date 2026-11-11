import {useEffect, useMemo, useState} from 'react';
import {useApp, PaneContext} from '../state/context.jsx';
import {filterByKind, studyTypeOutcomeBuckets, kindText, BROWSE_KIND_LABELS, KIND_FILTER_BUTTONS} from '../lib/outcomes.js';
import {aggregateByYear, aggregateByJournal, aggregateByField, TREND_POOL_BEFORE} from '../lib/aggregate.js';
import {wrapLabel} from '../lib/format.js';
import {theme as chartTheme} from '../lib/chartUtils.js';
import {registerRenderer, setLive} from '../testHooks.js';
import {ChartCanvas, ChartCopy, ChartData, useChartJsTable} from '../components/Charts.jsx';
import {CiteBlock, DataStamp, KindFilter, KindText} from '../components/Common.jsx';

function stackedCountConfig(agg, horizontal, buckets, wrapLabels) {
    const t = chartTheme();
    const labels = agg.map(r => wrapLabels ? wrapLabel(r.key, window.innerWidth < 600 ? 18 : 38) : r.key);
    // A dashed rule sets the pooled leading column apart from the year-by-year axis.
    const pooledSeparator = {
        id: 'pooledSeparator',
        afterDatasetsDraw(chart) {
            if (!agg[0]?.pooled || agg.length < 2) return;
            const x = chart.scales.x, area = chart.chartArea, c = chart.ctx;
            const between = (x.getPixelForValue(0) + x.getPixelForValue(1)) / 2;
            c.save(); c.strokeStyle = t.tick; c.setLineDash([4, 3]); c.lineWidth = 1;
            c.beginPath(); c.moveTo(between, area.top); c.lineTo(between, area.bottom); c.stroke(); c.restore();
        },
    };
    const height = horizontal ? Math.max(400, labels.reduce((n, l) => n + (Array.isArray(l) ? l.length : 1) * 15 + 15, 70)) : undefined;
    return {
        height,
        config: {
            type: 'bar',
            data: {labels, datasets: buckets.map(b => ({label: b.label, data: agg.map(r => r.counts[b.key] || 0), backgroundColor: b.color}))},
            options: {
                responsive: true, maintainAspectRatio: false, indexAxis: horizontal ? 'y' : 'x',
                plugins: {
                    legend: {display: true, position: 'bottom', labels: {color: t.font, boxWidth: 14, font: {size: 11}}},
                    tooltip: {callbacks: {title: items => { const label = items[0].label; return Array.isArray(label) ? label.join(' ') : label; }}},
                },
                scales: {
                    x: {stacked: true, grid: {color: t.grid}, ticks: {color: t.tick, autoSkip: !horizontal}},
                    y: {stacked: true, grid: {color: t.grid, display: !horizontal}, ticks: {color: t.tick, autoSkip: false, font: {size: horizontal ? 11 : 12}}},
                },
                layout: horizontal ? {padding: {left: 6}} : {},
            },
            plugins: [pooledSeparator],
        },
    };
}

function TrendChart({id, containerId, title, agg, horizontal = false, buckets, eligible, version, children}) {
    const {theme} = useApp();
    const built = useMemo(() => stackedCountConfig(agg, horizontal, buckets, horizontal), [agg, horizontal, buckets, theme, version]); // eslint-disable-line react-hooks/exhaustive-deps
    const table = useChartJsTable(id, built.config, eligible);
    return <div className="card"><div className="card-body"><div className="trend-block">
        <div className="trend-desc">
            <div className="trend-title"><h3>{title}</h3><ChartCopy id={id} title={title} table={table} /></div>
            {children}
        </div>
        <div className="chart-container" id={containerId} style={built.height ? {height: built.height + 'px'} : undefined}>
            <ChartCanvas id={id} config={built.config} title={title} />
        </div>
        <ChartData id={id} title={title} table={table} />
    </div></div></div>;
}

function TopNSelect({id, value, onChange, noun}) {
    return <div className="mt-3">
        <label htmlFor={id} className="note note-label">Show top:</label>{' '}
        <select id={id} className="form-select d-inline-block top-n-select" value={value} onChange={e => onChange(e.target.value)}>
            {['10', '15', '25', '50'].map(n => <option key={n} value={n}>{n} {noun}</option>)}
        </select>
    </div>;
}

export default function Trends({visited}) {
    const {rows, view, updateView, disciplineForJournal} = useApp();
    const kind = view.trendsKind;
    const [version, setVersion] = useState(0);
    useEffect(() => registerRenderer('trends', () => setVersion(v => v + 1)), []);

    const data = useMemo(() => filterByKind(rows, kind), [rows, kind, version]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => setLive('trendsRows', () => filterByKind(rows, kind)), [rows, kind]);
    const buckets = useMemo(() => studyTypeOutcomeBuckets(kind), [kind]);
    const show = kind !== 'all';
    const charts = visited && show;
    const origYear = useMemo(() => charts ? aggregateByYear(data, 'year_o', kind, TREND_POOL_BEFORE) : [], [charts, data, kind]);
    const repYear = useMemo(() => charts ? aggregateByYear(data, 'year_r', kind) : [], [charts, data, kind]);
    const journals = useMemo(() => charts ? aggregateByJournal(data, 'journal_o', Number(view.journalTopN), kind) : [], [charts, data, kind, view.journalTopN]);
    const repJournals = useMemo(() => charts ? aggregateByJournal(data, 'journal_r', Number(view.repJournalTopN), kind) : [], [charts, data, kind, view.repJournalTopN]);
    const fields = useMemo(() => charts ? aggregateByField(data, kind, disciplineForJournal) : [], [charts, data, kind, disciplineForJournal]);

    const n = data.length;
    const count = kind === 'all' ? `${n.toLocaleString()} reference ${n === 1 ? 'pair' : 'pairs'}` : `${n.toLocaleString()} of ${rows.length.toLocaleString()} reference ${rows.length === 1 ? 'pair' : 'pairs'}`;
    const k = (...v) => <KindText>{kindText(kind, ...v)}</KindText>;
    const repWord = kindText(kind, 'replication', 'reproduction', 'reproduction');
    const rep = k('replication', 'reproduction', 'reproduction');
    const target = k('replication', 'numerical reproduction', 'robustness reproduction');
    const selection = KIND_FILTER_BUTTONS.find(b => b.kind === kind)?.label;
    const pane = useMemo(() => ({sources: ['flora'], selection: [selection]}), [selection]);
    const common = {buckets, eligible: n, version};

    return <PaneContext.Provider value={pane}>
        <h1 className="visually-hidden">Years &amp; Disciplines</h1>
        <h2 className="visually-hidden">Outcome summaries</h2>
        <DataStamp source="flora" />
        <CiteBlock><div className="cite-ref">Röseler, L. et al. (in preparation). <em>The FORRT Library of Reproduction and Replication Attempts: Documenting the Reproducibility and Replicability of the Sciences and Humanities.</em></div></CiteBlock>

        <KindFilter value={kind} onChange={v => updateView({trendsKind: v})} countId="trend-filter-count" countRole="status"
            count={<><span className="visually-hidden">{BROWSE_KIND_LABELS[kind]}: </span>{count}</>} />

        <div id="trends-placeholder" className="coming-soon-placeholder" style={show ? {display: 'none'} : undefined}>
            Select a study type above (Replications, Numerical Reproductions, or Robustness Reproductions) to see year, journal, and field breakdowns. "All studies" mixes two different outcome vocabularies, so it isn't shown here.
        </div>

        <div id="trends-charts" style={show ? undefined : {display: 'none'}}>{charts && <>
            <TrendChart id="trend-orig-year" title="Outcomes by original study year" agg={origYear} {...common}>
                <p>{k(<>How have findings from different eras fared when researchers tried to replicate them? Each bar groups replication reference pairs by the year the <strong>original</strong> study was published, split by recorded replication outcome.</>,
                    <>How have findings from different eras fared when researchers tried to reproduce them by re-analysing the original data? Each bar groups numerical-reproduction reference pairs by the year the <strong>original</strong> study was published, split by computational verdict.</>,
                    <>How have findings from different eras held up under alternative analysis choices? Each bar groups robustness-reproduction reference pairs by the year the <strong>original</strong> study was published, split by robustness verdict.</>)}</p>
                <p id="trend-orig-year-axis-note">{origYear[0]?.pooled
                    ? `Pairs with original studies published before ${TREND_POOL_BEFORE} are sparse and are pooled into the first column, set apart by a dashed line. From ${TREND_POOL_BEFORE} the axis runs year by year, so years without any recorded pair appear as gaps.`
                    : 'The axis runs year by year, so years without any recorded pair appear as gaps and elapsed time keeps its scale.'}</p>
                <p className="trend-note">Reference pairs without a recorded original publication year are excluded.</p>
            </TrendChart>

            <TrendChart id="trend-rep-year" title={`Outcomes by ${repWord} report year`} agg={repYear} {...common}>
                <p>Grouped by the year of the <strong>{rep}</strong> report itself, this view shows the growth of FLoRA's coverage and how outcome profiles have shifted over time.</p>
                <p>The rightmost years may reflect ongoing data entry rather than a genuine decline in activity.</p>
                <p className="trend-note">Reference pairs without a recorded {rep} year are excluded.</p>
            </TrendChart>

            <TrendChart id="trend-journal" containerId="trend-journal-container" title="Outcomes by original journal" agg={journals} horizontal {...common}>
                <p>The journals whose articles have most frequently been the target of {target} attempts. For each journal, the bar shows the outcome breakdown of those attempts.</p>
                <p>{k("Frequency shows where replication effort has gone, not how replicable a journal's research is.", "Frequency shows where reproduction effort has gone, not how reproducible a journal's research is.", "Frequency shows where reproduction effort has gone, not how robust a journal's research is.")}</p>
                <TopNSelect id="journal-top-n" value={view.journalTopN} onChange={v => updateView({journalTopN: v})} noun="journals" />
            </TrendChart>

            <TrendChart id="trend-rep-journal" containerId="trend-rep-journal-container" title={`Outcomes by recorded ${repWord} venue`} agg={repJournals} horizontal {...common}>
                <p>Each bar groups reference pairs by the venue recorded for the {rep} report, which can be a journal or a repository such as OSF, split by recorded outcome.</p>
                <p>Counts reflect FLoRA’s coverage, and one report may contribute several pairs, so bars do not rank how actively venues publish {rep} research.</p>
                <p className="trend-note">Annotation of {k('replication', 'reproduction', 'reproduction')}-journal data is a work in progress; some journals may be missing or under-represented at the moment.</p>
                <TopNSelect id="rep-journal-top-n" value={view.repJournalTopN} onChange={v => updateView({repJournalTopN: v})} noun="venues" />
            </TrendChart>

            <TrendChart id="trend-field" containerId="trend-field-container" title="Outcomes by field" agg={fields} horizontal {...common}>
                <p>A bird's-eye view grouping reference pairs by research discipline. Each bar shows the outcome breakdown of {target} attempts targeting work originally published in journals from that field.</p>
                <p>Disciplines are inferred from the original study's journal name using a hand-curated dictionary (<a href="data/disciplines.json" target="_blank" rel="noopener noreferrer" className="doi-link">journal-to-discipline mapping</a>). Journals that have not been mapped yet are collected under <em>Uncategorized</em>.</p>
                <p className="trend-note">Coverage is still growing. Journals that are not yet classified may leave some fields under-represented.</p>
            </TrendChart>
        </>}</div>
    </PaneContext.Provider>;
}
