import {useMemo, useRef} from 'react';
import {ANALYSIS_MIN_N, URLS} from '../lib/config.js';
import {percent} from '../lib/format.js';
import {coverageText, nPairs} from '../lib/coverage.js';
import {kindNoun, kindPairCount, outcomeBuckets, studyTypeLabel} from '../lib/outcomes.js';
import {chartTheme} from '../lib/theme.js';
import {setHook} from '../lib/hooks.js';
import {useData, useJson} from '../state/data.jsx';
import {useEnv} from '../state/env.jsx';
import {useView} from '../state/view.jsx';
import {Plot} from '../components/charts.jsx';
import {Chips, CiteBlock, DataStamp, Gloss, Pane, Placeholder, StatTiles, byKind, kindLabel} from '../components/common.jsx';

function distributionSpec(d, buckets, coverage) {
    const t = chartTheme();
    const bins = d.histogram || [];
    const axis = {gridcolor: t.grid, color: t.font, tickfont: {color: t.font}};
    return {
        coverage,
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

function modelSpec(d, jitter, coverage) {
    const t = chartTheme();
    const curve = Array.isArray(d.gam_curve) ? d.gam_curve : [], stats = d.stats || {}, points = Array.isArray(d.jitter) ? d.jitter : [];
    if (!curve.length || !(stats.n_model >= 30)) return {message: 'No fitted model is available for this snapshot. A model requires at least 30 eligible successful/failed pairs and sufficient variation.'};
    const window = d.curve && d.curve.end_omc !== undefined ? d.curve : null;
    // Plotted on log(OMC + 1), the model's scale; a true log axis cannot show OMC = 0.
    const x = curve.map(p => Math.log1p(p.omc));
    // The window ends with the curve; pairs beyond it stay in the model and the data table.
    const minOmc = Math.min(...curve.map(p => p.omc), ...jitter.map(p => p.omc));
    const maxOmc = window ? window.end_omc : Math.max(...curve.map(p => p.omc), ...jitter.map(p => p.omc));
    const ticks = [0, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].filter(v => v >= minOmc && v <= maxOmc);
    const range = [Math.log1p(minOmc) - 0.05, Math.log1p(maxOmc) + 0.05];
    const shown = jitter.filter(p => p.x <= range[1]);
    const axis = {gridcolor: t.grid, color: t.font, tickfont: {color: t.font}};
    return {
        coverage,
        traces: [
            {x, y: curve.map(p => p.p_lo), type: 'scatter', mode: 'lines', line: {width: 0}, showlegend: false, hoverinfo: 'skip', name: '_lo'},
            {x, y: curve.map(p => p.p_hi), customdata: curve.map(p => [p.omc, p.p_lo, p.p_hi]), type: 'scatter', mode: 'lines', fill: 'tonexty', fillcolor: t.band, line: {width: 0},
                name: '95% confidence interval', hovertemplate: 'OMC = %{customdata[0]:.2f}<br>95% CI: %{customdata[1]:.1%} to %{customdata[2]:.1%}<extra></extra>'},
            {x: shown.map(p => p.x), y: shown.map(p => p.y), customdata: shown.map(p => p.omc), type: 'scatter', mode: 'markers', marker: {color: t.point, size: 5, line: {width: 0}},
                name: 'Reference pairs', text: shown.map(p => p.label), hovertemplate: 'OMC = %{customdata:.2f}<br>%{text}<extra></extra>'},
        ],
        layout: {
            height: 640, margin: {t: 10, r: 10, b: 50, l: 60},
            xaxis: {title: 'OpenAlex Mean Citedness (OMC, log scale)', range, tickvals: ticks.map(Math.log1p), ticktext: ticks.map(String), ...axis},
            yaxis: {title: 'P(success | successful or failed)', range: [-0.08, 1.08], tickformat: '.0%', ...axis},
            plot_bgcolor: t.plot, paper_bgcolor: t.paper, font: {family: t.fontFamily, size: 12, color: t.font},
            legend: {orientation: 'h', y: -0.2, font: {color: t.font}},
            shapes: [{type: 'line', xref: 'paper', x0: 0, x1: 1, yref: 'y', y0: 0.5, y1: 0.5, line: {color: t.rule, width: 1.5, dash: 'dash'}}],
            annotations: [{xref: 'paper', x: 1, xanchor: 'right', yref: 'y', y: 0.5, yanchor: 'bottom', text: '50% reference', showarrow: false, font: {size: 11, color: t.ruleLabel}}],
        },
        config: {displayModeBar: false, responsive: true},
        // The table lists model quantities and raw sample values, not interval-band traces or jittered positions.
        table: {
            headers: ['Row type', 'OMC', 'Estimated P(success)', '95% CI lower', '95% CI upper', 'Observed outcome (1 = successful, 0 = failed)', 'Original (DOI or title)', 'Report (DOI, URL or title)'],
            rows: [...curve.map(p => ['Fitted curve', p.omc, p.p, p.p_lo, p.p_hi, '', '', '']), ...points.map(p => ['Displayed pair', p.omc, '', '', '', p.outcome, p.original || '', p.report || ''])],
            summary: `Fitted curve: logistic smooth of log(OMC + 1) with pointwise 95% intervals, estimated from ${Number(stats.n_model).toLocaleString()} successful or failed reference pairs${window ? ` and shown up to OMC ${window.end_omc}` : ''}. Model statistics at full precision: edf = ${stats.edf}, χ² = ${stats.chi_sq}, p = ${stats.p_val}, McFadden R² = ${stats.r2}. Displayed pairs: ${points.length.toLocaleString()} of these pairs (a random sample${window && window.n_beyond ? `, plus all ${window.n_beyond.toLocaleString('en-GB')} beyond the curve` : ''}), with their raw OMC, outcome and identifiers; the chart jitters their positions for legibility.`,
        },
    };
}

const NO_OMC = 'without an OMC (no original journal recorded, journal not found in OpenAlex, or OMC set aside)';
const sig2 = v => Number(v).toLocaleString('en-GB', {maximumSignificantDigits: 2});

function setAsideNote(s) {
    const n = s ? (s.too_few_papers || 0) + (s.placeholder_record || 0) : 0;
    if (!n) return '';
    const parts = [
        s.too_few_papers && `${nPairs(s.too_few_papers)} from journals with fewer than ${s.min_works} papers in total`,
        s.placeholder_record && `${nPairs(s.placeholder_record)} from journals whose OpenAlex record counts a journal-level placeholder as a heavily cited paper`,
    ].filter(Boolean);
    const why = [s.too_few_papers && 'an average over so few papers', s.placeholder_record && 'one inflated by a placeholder'].filter(Boolean).join(', or ');
    return `OMC is treated as missing for ${parts.join(', and ')}: ${why} is not a reliable measure.`;
}

export default function MeanCitedness() {
    const {view, setView} = useView();
    const {rows} = useData();
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
    if (all && !jitterCache.current) jitterCache.current = (all.replication.jitter || []).map(p => ({x: Math.abs(Math.log1p(p.omc) + (Math.random() - 0.5) * 0.04), omc: p.omc, y: p.outcome + (Math.random() - 0.5) * 0.06, label: p.outcome === 1 ? 'Successful' : 'Failed'}));

    const enough = d?.overview && d.overview.n_total >= ANALYSIS_MIN_N;
    const buckets = useMemo(() => all ? outcomeBuckets(kind) : [], [all, kind, theme]);
    const ov = d?.overview, stats = d?.stats || {};
    // The replication summary names its success count n_success; histogram keys use the bucket key.
    const overviewKey = b => kind === 'replication' && b.key === 'successful' ? 'n_success' : 'n_' + b.key;
    const notModelled = buckets.filter(b => !['successful', 'failed'].includes(b.key));
    const distCoverage = enough ? coverageText(ov.n_total, kindPairCount(rows, kind), [[ov.n_excluded || 0, NO_OMC]], kindNoun(kind), kind) : '';
    const modelCoverage = enough && kind === 'replication' ? coverageText(stats.n_model || 0, kindPairCount(rows, 'replication'),
        [[ov.n_excluded || 0, NO_OMC], ...notModelled.map(b => [ov[overviewKey(b)] || 0, b.label.toLowerCase()])], 'replication reference pairs', 'replication') : '';
    const distribution = useMemo(() => enough ? distributionSpec(d, buckets, distCoverage) : null, [enough, d, buckets, distCoverage]);
    const model = useMemo(() => enough && kind === 'replication' ? modelSpec(d, jitterCache.current, modelCoverage) : null, [enough, d, kind, theme, modelCoverage]);
    const modelExcluded = notModelled.filter(b => ov?.[overviewKey(b)] > 0).map(b => `${b.label.toLowerCase()} ${ov[overviewKey(b)].toLocaleString('en-GB')}`);
    const aside = setAsideNote(d?.set_aside);

    return (
        <Pane id="mean-citedness" tabId="mc-tab" sources={['impact_factor']} selection={[kindLabel(kind)]} kind={kind}
            title={{heading: 'Mean Citedness', lede: 'Journal-level citation rates of original studies, set against the outcomes recorded for attempts to repeat them.'}}>
            <div className="pane-meta">
                <DataStamp source="impact_factor" />
                <CiteBlock><div className="cite-ref">Röseler, J., &amp; Röseler, L. (in preparation). <em>Guess the replication: How Journal Prestige affects Predicted and Actual Replication Success.</em></div></CiteBlock>
            </div>
            <section className="card">
                <h2 className="card-header">Journal Mean Citedness and Recorded Outcomes</h2>
                <div className="card-body">
                    <p className="muted">
                        This tab {byKind(kind, ['presents a statistical analysis of whether', 'describes, without a fitted model, how computational verdicts vary with', 'describes, without a fitted model, how robustness verdicts vary with'])} the <strong>OpenAlex Mean Citedness</strong> (OMC) of an original study's journal{kind === 'replication' && ' is associated with replication success'}.
                        Mean Citedness is a journal-level measure from OpenAlex: the journal's total citations divided by its total papers, across all years. Unlike the two-year Journal Impact Factor, it reflects a journal's long-run citation level, and it favours journals whose papers have had longer to collect citations. It is retrieved at enrichment time, not matched to the original publication year, and is not the original article’s citation count. The update stamp identifies the analysis snapshot. Any fitted model describes an association.
                    </p>
                    <Chips id="mc-study-type" label="Mean Citedness study type" value={kind} onChange={k => setView({mcKind: k})} />
                    <div className="study-type-note">Reproduction summaries include only pairs with a verdict on the selected dimension and an available OMC. Unchecked and uncoded dimensions are excluded; the two subsets can overlap.</div>
                    {aside && <p id="mc-set-aside" className="study-type-note">{aside}</p>}
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
                                <p id="mc-eligible" className="mc-model-note">{distCoverage}</p>
                                <div className="mc-chart-wrap"><Plot id="mc-dist-chart" title="Distribution of reference pairs by journal Mean Citedness" spec={distribution} /></div>
                            </div>
                            {kind !== 'replication' && <p id="mc-repro-note" className="mc-model-note">Reproduction summaries are descriptive. No reproduction model has been fitted.</p>}
                        </>}
                        <div id="mc-gam-card" className="mc-chart-card" style={model ? undefined : {display: 'none'}}>
                            <h3 className="mc-chart-title">Success probability among successful / failed replications</h3>
                            <p id="mc-gam-stats" className="mc-model-note">
                                {model && !model.message && <>
                                    Logistic smooth of log(OMC + 1): <Gloss term="edf">Effective degrees of freedom: how flexible the fitted curve is. edf ≈ 1 is close to a straight line; higher values mean a more flexible, wigglier fit.</Gloss> = {sig2(stats.edf)}, χ² = {sig2(stats.chi_sq)}
                                    {stats.p_val != null && (stats.p_val < 0.001 ? ', p < .001' : ', p = ' + stats.p_val.toFixed(3))}; <Gloss term="McFadden R²">McFadden’s pseudo-R²: a goodness-of-fit measure for logistic models. It compares the fitted logistic model with an intercept-only model; it is not the fraction of variance explained.</Gloss> = {sig2(stats.r2)}; N = {stats.n_model.toLocaleString('en-GB')} of {nPairs(ov.n_total)} with OMC (successful vs. failed){modelExcluded.length > 0 && '; excluded: ' + modelExcluded.join(', ')}.
                                </>}
                            </p>
                            <div className="mc-chart-wrap">
                                {model ? <Plot id="mc-gam-chart" title="Success probability among successful / failed replications" spec={model} className="mc-gam-chart" /> : <div id="mc-gam-chart" />}
                            </div>
                            <p className="mc-model-note">The data underlying the graph include all records from the FLORA database with complete information, particularly a lifetime Mean Citedness for the journal in which the original study was published, and a clearly successful or unsuccessful replication outcome (i.e., replications with mixed outcomes were excluded). The shaded band shows the 95% confidence interval for the estimated probability of success.</p>
                        </div>
                    </div>
                </div>
            </section>
        </Pane>
    );
}
