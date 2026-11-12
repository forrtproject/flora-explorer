import {useMemo, useRef} from 'react';
import {ANALYSIS_MIN_N, URLS} from '../lib/config.js';
import {percent} from '../lib/format.js';
import {outcomeBuckets, studyTypeLabel} from '../lib/outcomes.js';
import {chartTheme} from '../lib/theme.js';
import {setHook} from '../lib/hooks.js';
import {useJson} from '../state/data.jsx';
import {useEnv} from '../state/env.jsx';
import {useView} from '../state/view.jsx';
import {Plot} from '../components/charts.jsx';
import {Chips, CiteBlock, DataStamp, Gloss, OutcomeDefinitions, Pane, Placeholder, StatTiles, byKind, kindLabel} from '../components/common.jsx';

function distributionSpec(d, buckets) {
    const t = chartTheme();
    const bins = d.histogram || [];
    const axis = {gridcolor: t.grid, color: t.font, tickfont: {color: t.font}};
    return {
        traces: buckets.map(b => ({x: bins.map(bin => +((bin.bin_lo + bin.bin_hi) / 2).toFixed(2)), y: bins.map(bin => bin[b.key] || 0), name: b.label, type: 'bar',
            marker: {color: b.color}, hovertemplate: 'OMC %{x:.2f}<br>%{y:,.0f} reference pairs<extra>%{fullData.name}</extra>'})),
        layout: {
            barmode: 'stack', bargap: 0.05, margin: {t: 10, r: 10, b: 50, l: 55}, height: 320,
            xaxis: {title: 'OpenAlex Mean Citedness (OMC)', ...axis}, yaxis: {title: 'Reference pairs', tickformat: ',d', ...axis},
            plot_bgcolor: t.plot, paper_bgcolor: t.paper, font: {family: t.fontFamily, size: 12, color: t.font},
            legend: {orientation: 'h', y: -0.2, font: {color: t.font}},
        },
        config: {displayModeBar: false, responsive: true},
    };
}

function modelSpec(d, jitter) {
    const t = chartTheme();
    const curve = Array.isArray(d.gam_curve) ? d.gam_curve : [], stats = d.stats || {}, points = Array.isArray(d.jitter) ? d.jitter : [];
    if (!curve.length || !(stats.n_model >= 30)) return {message: 'No fitted model is available for this snapshot. A model requires at least 30 eligible successful/failed pairs and sufficient variation.'};
    const x = curve.map(p => p.omc);
    const axis = {gridcolor: t.grid, color: t.font, tickfont: {color: t.font}};
    return {
        traces: [
            {x, y: curve.map(p => p.p_lo), type: 'scatter', mode: 'lines', line: {width: 0}, showlegend: false, hoverinfo: 'skip', name: '_lo'},
            {x, y: curve.map(p => p.p_hi), type: 'scatter', mode: 'lines', fill: 'tonexty', fillcolor: t.band, line: {width: 0}, showlegend: false, hoverinfo: 'skip', name: '_hi'},
            {x, y: curve.map(p => p.p), type: 'scatter', mode: 'lines', line: {color: t.primary, width: 2.5}, name: 'Smooth fit', hovertemplate: 'OMC = %{x:.2f}<br>P(success) = %{y:.1%}<extra>Smooth fit</extra>'},
            {x: jitter.map(p => p.x), y: jitter.map(p => p.y), type: 'scatter', mode: 'markers', marker: {color: t.point, size: 5, line: {width: 0}},
                name: 'Reference pairs', text: jitter.map(p => p.label), hovertemplate: 'OMC = %{x:.2f}<br>%{text}<extra></extra>'},
        ],
        layout: {
            height: 640, margin: {t: 10, r: 10, b: 50, l: 60},
            xaxis: {title: 'OpenAlex Mean Citedness (OMC)', ...axis},
            yaxis: {title: 'P(success | successful or failed)', range: [-0.08, 1.08], tickformat: '.0%', ...axis},
            plot_bgcolor: t.plot, paper_bgcolor: t.paper, font: {family: t.fontFamily, size: 12, color: t.font},
            legend: {orientation: 'h', y: -0.2, font: {color: t.font}},
            shapes: [{type: 'line', xref: 'paper', x0: 0, x1: 1, yref: 'y', y0: 0.5, y1: 0.5, line: {color: t.rule, width: 1.5, dash: 'dash'}}],
            annotations: [{xref: 'paper', x: 1, xanchor: 'right', yref: 'y', y: 0.5, yanchor: 'bottom', text: '50% reference', showarrow: false, font: {size: 11, color: t.ruleLabel}}],
        },
        config: {displayModeBar: false, responsive: true},
        // The table lists model quantities and raw sample values, not interval-band traces or jittered positions.
        table: {
            headers: ['Row type', 'OMC', 'Estimated P(success)', '95% CI lower', '95% CI upper', 'Observed outcome (1 = successful, 0 = failed)'],
            rows: [...curve.map(p => ['Fitted curve', p.omc, p.p, p.p_lo, p.p_hi, '']), ...points.map(p => ['Displayed pair', p.omc, '', '', '', p.outcome])],
            summary: `Fitted curve: logistic smooth with pointwise 95% intervals, estimated from ${Number(stats.n_model).toLocaleString()} successful or failed reference pairs. Displayed pairs: a random sample of ${points.length.toLocaleString()} of these pairs, with their raw OMC and outcome; the chart jitters their positions for legibility. The sample has no pair identifiers.`,
        },
    };
}

export default function MeanCitedness() {
    const {view, setView} = useView();
    const {theme} = useEnv();
    const kind = view.mcKind;
    const active = view.tab === 'mc-tab';
    const replication = useJson(URLS.impact, active);
    const reproductions = useJson(URLS.impactReproductions, active, true);
    const all = useMemo(() => replication.data && reproductions.data ? {replication: replication.data, 'reproduction-numerical': reproductions.data['reproduction-numerical'] || null, 'reproduction-robustness': reproductions.data['reproduction-robustness'] || null} : null,
        [replication.data, reproductions.data]);
    setHook('_mcData', () => all);
    const d = all?.[kind];
    // Jitter is fixed per data load so points do not jump when the theme changes.
    const jitterCache = useRef(null);
    if (all && !jitterCache.current) jitterCache.current = (all.replication.jitter || []).map(p => ({x: p.omc + (Math.random() - 0.5) * 0.15, y: p.outcome + (Math.random() - 0.5) * 0.06, label: p.outcome === 1 ? 'Successful' : 'Failed'}));

    const enough = d?.overview && d.overview.n_total >= ANALYSIS_MIN_N;
    const buckets = useMemo(() => all ? outcomeBuckets(kind) : [], [all, kind, theme]);
    const distribution = useMemo(() => enough ? distributionSpec(d, buckets) : null, [enough, d, buckets]);
    const model = useMemo(() => enough && kind === 'replication' ? modelSpec(d, jitterCache.current) : null, [enough, d, kind, theme]);
    const ov = d?.overview, stats = d?.stats || {};
    // The replication summary names its success count n_success; histogram keys use the bucket key.
    const overviewKey = b => kind === 'replication' && b.key === 'successful' ? 'n_success' : 'n_' + b.key;

    return (
        <Pane id="mean-citedness" tabId="mc-tab" sources={['impact_factor']} selection={[kindLabel(kind)]} kind={kind}
            title={{heading: 'Mean Citedness', lede: 'Journal-level citation rates of original studies, set against the outcomes recorded for attempts to repeat them.'}}>
            <div className="pane-meta">
                <DataStamp source="impact_factor" />
                <OutcomeDefinitions />
                <CiteBlock><div className="cite-ref">Röseler, J., &amp; Röseler, L. (in preparation). <em>Guess the replication: How Journal Prestige affects Predicted and Actual Replication Success.</em></div></CiteBlock>
            </div>
            <section className="card">
                <h2 className="card-header">Journal Mean Citedness and Recorded Outcomes</h2>
                <div className="card-body">
                    <p className="muted">
                        This tab {byKind(kind, ['presents a statistical analysis of whether', 'describes, without a fitted model, how computational verdicts vary with', 'describes, without a fitted model, how robustness verdicts vary with'])} the <strong>OpenAlex Mean Citedness</strong> (OMC) of an original study's journal{kind === 'replication' && ' predicts replication success'}. OMC is a proxy for the Journal Impact Factor.
                        Mean Citedness is a journal-level measure from OpenAlex: the mean citations to its works published in the previous two years. It is retrieved at enrichment time, not matched to the original publication year, and is not the original article’s citation count. The update stamp identifies the analysis snapshot. Any fitted model describes an association.
                    </p>
                    <Chips id="mc-study-type" label="Mean Citedness study type" value={kind} onChange={k => setView({mcKind: k})} />
                    <div className="study-type-note">Reproduction summaries include only pairs with a verdict on the selected dimension and an available OMC below 35. Unchecked and uncoded dimensions are excluded; the two subsets can overlap.</div>
                    <div id="mc-content">
                        {!all && !replication.error && <div id="mc-loading" className="note note-loading">Loading analysis…</div>}
                        {replication.error && <div id="mc-error" className="note">Failed to load analysis data. <code id="mc-error-detail" className="note-detail">{replication.error}</code></div>}
                        {all && !enough && <Placeholder id="mc-placeholder">Not enough {studyTypeLabel(kind)} with a Mean Citedness match yet (n={ov?.n_total || 0}; need at least {ANALYSIS_MIN_N}).</Placeholder>}
                        {enough && <>
                            <StatTiles id="mc-overview" tiles={[
                                {value: ov.n_total, label: 'Reference pairs with OMC', always: true},
                                ...buckets.map(b => ({value: ov[overviewKey(b)] || 0, label: `${b.label} (${percent(ov[overviewKey(b)] || 0, ov.n_total)}%)`})),
                                {value: ov.n_journals, label: 'Journals matched', always: true},
                                {value: ov.n_disciplines, label: 'Disciplines', always: true},
                            ]} />
                            <div id="mc-dist-card" className="mc-chart-card">
                                <h3 className="mc-chart-title">Distribution of reference pairs by journal Mean Citedness</h3>
                                <div className="mc-chart-wrap"><Plot id="mc-dist-chart" title="Distribution of reference pairs by journal Mean Citedness" spec={distribution} /></div>
                            </div>
                            {kind !== 'replication' && <p id="mc-repro-note" className="mc-model-note">Reproduction summaries are descriptive. No reproduction model has been fitted.</p>}
                        </>}
                        <div id="mc-gam-card" className="mc-chart-card" style={model ? undefined : {display: 'none'}}>
                            <h3 className="mc-chart-title">Success probability among successful / failed replications</h3>
                            <p id="mc-gam-stats" className="mc-model-note">
                                {model && !model.message && <>
                                    Logistic smooth: <Gloss term="edf">Effective degrees of freedom: how flexible the fitted curve is. edf ≈ 1 is close to a straight line; higher values mean a more flexible, wigglier fit.</Gloss> = {stats.edf}, χ² = {stats.chi_sq}
                                    {stats.p_val != null && (stats.p_val < 0.001 ? ', p < .001' : ', p = ' + stats.p_val.toFixed(3))}; <Gloss term="McFadden R²">McFadden’s pseudo-R²: a goodness-of-fit measure for logistic models. It compares the fitted logistic model with an intercept-only model; it is not the fraction of variance explained.</Gloss> = {stats.r2}; N = {stats.n_model.toLocaleString('en-GB')} (successful vs. failed)
                                </>}
                            </p>
                            <div className="mc-chart-wrap">
                                {model ? <Plot id="mc-gam-chart" title="Success probability among successful / failed replications" spec={model} className="mc-gam-chart" /> : <div id="mc-gam-chart" />}
                            </div>
                            <p className="mc-model-note">Conditional on unqualified successful or failed outcomes; other outcomes are excluded. Association does not establish causation.</p>
                        </div>
                    </div>
                </div>
            </section>
        </Pane>
    );
}
