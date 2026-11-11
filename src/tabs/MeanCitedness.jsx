import {useMemo, useRef} from 'react';
import {useApp, PaneContext} from '../state/context.jsx';
import {OUTCOME_COLORS, REPRODUCTION_COLORS, STUDY_TYPE_CHIPS, kindText, studyTypeLabel} from '../lib/outcomes.js';
import {IMPACT_DATA_URL, IMPACT_REPRODUCTIONS_URL, ANALYSIS_MIN_N} from '../lib/config.js';
import {percent, theme as chartTheme} from '../lib/chartUtils.js';
import {PlotlyChart} from '../components/Charts.jsx';
import {CiteBlock, DataStamp, Gloss, KindText, StudyTypeChips} from '../components/Common.jsx';
import {useAnalysisData, fetchJson, Loading, LoadError} from '../components/Analysis.jsx';

// Overview keys follow the replication analysis's R naming (n_success) while its histogram
// keys are "successful"; both are tracked explicitly rather than assumed to match.
function bucketConfig(kind) {
    if (kind === 'reproduction-numerical') return [
        {histKey: 'successful', overviewKey: 'n_successful', label: 'Successful', color: REPRODUCTION_COLORS.successful},
        {histKey: 'issues', overviewKey: 'n_issues', label: 'Computational issues', color: REPRODUCTION_COLORS.issues},
        {histKey: 'technical_failure', overviewKey: 'n_technical_failure', label: 'Technical failure', color: REPRODUCTION_COLORS.technical_failure},
    ];
    if (kind === 'reproduction-robustness') return [
        {histKey: 'robust', overviewKey: 'n_robust', label: 'Robust', color: REPRODUCTION_COLORS.robust},
        {histKey: 'challenges', overviewKey: 'n_challenges', label: 'Robustness challenges', color: REPRODUCTION_COLORS.challenges},
    ];
    return [
        {histKey: 'successful', overviewKey: 'n_success', label: 'Successful', color: OUTCOME_COLORS.successful},
        {histKey: 'failed', overviewKey: 'n_failed', label: 'Failed', color: OUTCOME_COLORS.failed},
        {histKey: 'mixed', overviewKey: 'n_mixed', label: 'Mixed', color: OUTCOME_COLORS.mixed},
        {histKey: 'inconclusive', overviewKey: 'n_inconclusive', label: 'Inconclusive', color: OUTCOME_COLORS.inconclusive},
        {histKey: 'qualified', overviewKey: 'n_qualified', label: 'Successful but flawed', color: OUTCOME_COLORS.qualified},
        {histKey: 'other', overviewKey: 'n_other', label: 'Other / not coded', color: OUTCOME_COLORS.other},
    ];
}

async function loadMeanCitedness() {
    const [replication, repro] = await Promise.all([fetchJson(IMPACT_DATA_URL), fetchJson(IMPACT_REPRODUCTIONS_URL, {optional: true})]);
    return {replication, 'reproduction-numerical': repro?.['reproduction-numerical'] || null, 'reproduction-robustness': repro?.['reproduction-robustness'] || null};
}

const axis = (t, title, extra = {}) => ({title, gridcolor: t.grid, color: t.font, tickfont: {color: t.font}, ...extra});

export default function MeanCitedness({visited}) {
    const {view, updateView} = useApp();
    const kind = view.mcKind;
    const {status, data, error, version} = useAnalysisData('meanCitedness', 'mcData', visited, loadMeanCitedness);
    const d = data?.[kind];
    const enough = d?.overview && d.overview.n_total >= ANALYSIS_MIN_N;
    const buckets = bucketConfig(kind);
    const st = d?.stats || {};
    const curve = Array.isArray(d?.gam_curve) ? d.gam_curve : [];
    const isReplication = kind === 'replication';
    const hasModel = isReplication && curve.length > 0 && st.n_model >= 30;
    const k = (...v) => kindText(kind, ...v);
    const kt = (...v) => <KindText>{k(...v)}</KindText>;
    const selection = STUDY_TYPE_CHIPS.find(c => c.value === kind).label;
    const pane = useMemo(() => ({sources: ['impact_factor'], selection: [selection]}), [selection]);

    // Jitter is drawn once per data load so points stay put across re-renders.
    const jitterRef = useRef({source: null, points: []});
    const jitter = () => {
        const source = data?.replication?.jitter;
        if (jitterRef.current.source !== source) jitterRef.current = {source, points: (Array.isArray(source) ? source : []).map(pt => ({
            x: pt.omc + (Math.random() - 0.5) * 0.15, y: pt.outcome + (Math.random() - 0.5) * 0.06, lbl: pt.outcome === 1 ? 'Successful' : 'Failed'}))};
        return jitterRef.current.points;
    };

    const buildDist = () => {
        const t = chartTheme(), bins = d.histogram || [];
        const xMids = bins.map(b => +((b.bin_lo + b.bin_hi) / 2).toFixed(2));
        return {
            traces: buckets.map(b => ({x: xMids, y: bins.map(row => row[b.histKey] || 0), name: b.label, type: 'bar', marker: {color: b.color},
                hovertemplate: 'OMC %{x:.2f}<br>%{y:,.0f} reference pairs<extra>%{fullData.name}</extra>'})),
            layout: {barmode: 'stack', bargap: 0.05, margin: {t: 10, r: 10, b: 50, l: 55},
                xaxis: axis(t, 'OpenAlex Mean Citedness (OMC)'), yaxis: axis(t, 'Reference pairs', {tickformat: ',d'}),
                plot_bgcolor: t.plot, paper_bgcolor: t.paper, font: {family: t.fontFamily, size: 12, color: t.font},
                legend: {orientation: 'h', y: -0.2, font: {color: t.font}}, height: 320},
            config: {displayModeBar: false, responsive: true},
        };
    };

    const buildModel = () => {
        if (!hasModel) return {empty: 'No fitted model is available for this snapshot. A model requires at least 30 eligible successful/failed pairs and sufficient variation.'};
        const t = chartTheme(), pts = jitter(), x = curve.map(p => p.omc);
        const points = Array.isArray(d.jitter) ? d.jitter : [];
        return {
            traces: [
                {x, y: curve.map(p => p.p_lo), type: 'scatter', mode: 'lines', line: {width: 0}, showlegend: false, hoverinfo: 'skip', name: '_lo'},
                {x, y: curve.map(p => p.p_hi), type: 'scatter', mode: 'lines', fill: 'tonexty', fillcolor: t.band, line: {width: 0}, showlegend: false, hoverinfo: 'skip', name: '_hi'},
                {x, y: curve.map(p => p.p), type: 'scatter', mode: 'lines', line: {color: t.primary, width: 2.5}, name: 'Smooth fit',
                    hovertemplate: 'OMC = %{x:.2f}<br>P(success) = %{y:.1%}<extra>Smooth fit</extra>'},
                {x: pts.map(p => p.x), y: pts.map(p => p.y), type: 'scatter', mode: 'markers', marker: {color: t.point, size: 5, line: {width: 0}},
                    name: 'Studies', text: pts.map(p => p.lbl), hovertemplate: 'OMC = %{x:.2f}<br>%{text}<extra></extra>'},
            ],
            layout: {height: 640, margin: {t: 10, r: 10, b: 50, l: 60},
                xaxis: axis(t, 'OpenAlex Mean Citedness (OMC)'),
                yaxis: axis(t, 'P(success | successful or failed)', {range: [-0.08, 1.08], tickformat: '.0%'}),
                plot_bgcolor: t.plot, paper_bgcolor: t.paper, font: {family: t.fontFamily, size: 12, color: t.font},
                legend: {orientation: 'h', y: -0.2, font: {color: t.font}},
                shapes: [{type: 'line', xref: 'paper', x0: 0, x1: 1, yref: 'y', y0: 0.5, y1: 0.5, line: {color: t.rule, width: 1.5, dash: 'dash'}}],
                annotations: [{xref: 'paper', x: 1, xanchor: 'right', yref: 'y', y: 0.5, yanchor: 'bottom', text: '50% reference', showarrow: false, font: {size: 11, color: t.ruleLabel}}]},
            config: {displayModeBar: false, responsive: true},
            // The table lists model quantities and raw sample values, not plotting internals.
            options: {table: {
                headers: ['Row type', 'OMC', 'Estimated P(success)', '95% CI lower', '95% CI upper', 'Observed outcome (1 = successful, 0 = failed)'],
                rows: [...curve.map(p => ['Fitted curve', p.omc, p.p, p.p_lo, p.p_hi, '']), ...points.map(p => ['Displayed pair', p.omc, '', '', '', p.outcome])],
                summary: `Fitted curve: logistic smooth with pointwise 95% intervals, estimated from ${Number(st.n_model).toLocaleString()} successful or failed reference pairs. Displayed pairs: a random sample of ${points.length.toLocaleString()} of these pairs, with their raw OMC and outcome; the chart jitters their positions for legibility. The sample has no pair identifiers.`,
            }},
        };
    };

    const ov = d?.overview;
    const pNote = st.p_val !== null && st.p_val !== undefined ? (st.p_val < 0.001 ? 'p < .001' : 'p = ' + st.p_val.toFixed(3)) : '';
    const loaded = status === 'ready';

    return <PaneContext.Provider value={pane}>
        <h1 className="visually-hidden">Mean Citedness</h1>
        <DataStamp source="impact_factor" />
        <CiteBlock><div className="cite-ref">Röseler, J., &amp; Röseler, L. (in preparation). <em>Guess the replication: How Journal Prestige affects Predicted and Actual Replication Success.</em></div></CiteBlock>
        <div className="card">
            <h2 className="card-header">Journal Mean Citedness and Recorded Outcomes</h2>
            <div className="card-body">
                <p className="muted" style={{marginBottom: '0.75rem'}}>
                    This tab {kt('presents a statistical analysis of whether', 'describes, without a fitted model, how computational verdicts vary with', 'describes, without a fitted model, how robustness verdicts vary with')} the{' '}
                    <strong>OpenAlex Mean Citedness</strong> (OMC) of an original study's journal{kt(' predicts replication success', '', '')}. OMC is a proxy for the Journal Impact Factor.
                    Mean Citedness is a journal-level measure from OpenAlex: the mean citations to its works published in the previous two years. It is retrieved at enrichment time, not matched to the original publication year, and is not the original article’s citation count. The update stamp identifies the analysis snapshot. Any fitted model describes an association.
                </p>
                <StudyTypeChips id="mc-study-type" label="Mean Citedness study type" value={kind} onChange={v => updateView({mcKind: v})} />
                <div className="study-type-note">Reproduction summaries include only pairs with a verdict on the selected dimension and an available OMC below 35. Unchecked and uncoded dimensions are excluded; the two subsets can overlap.</div>
                <div id="mc-placeholder" className="coming-soon-placeholder" style={loaded && !enough ? undefined : {display: 'none'}}>
                    {`Not enough ${studyTypeLabel(kind)} with a Mean Citedness match yet (n=${ov ? ov.n_total : 0}; need at least ${ANALYSIS_MIN_N}).`}
                </div>
                <div id="mc-content">
                    <Loading id="mc-loading" show={status === 'loading' || status === 'idle'} />
                    <div id="mc-overview" className="mc-overview-grid" style={loaded && enough ? undefined : {display: 'none'}}>
                        {loaded && enough && <>
                            <div className="mc-stat"><span className="mc-stat-value">{ov.n_total.toLocaleString()}</span><span className="mc-stat-label">Reference pairs with OMC</span></div>
                            {buckets.filter(b => ov[b.overviewKey] > 0).map(b => <div className="mc-stat" key={b.histKey}>
                                <span className="mc-stat-value">{ov[b.overviewKey].toLocaleString()}</span><span className="mc-stat-label">{b.label} ({percent(ov[b.overviewKey], ov.n_total)}%)</span></div>)}
                            <div className="mc-stat"><span className="mc-stat-value">{ov.n_journals.toLocaleString()}</span><span className="mc-stat-label">Journals matched</span></div>
                            <div className="mc-stat"><span className="mc-stat-value">{ov.n_disciplines.toLocaleString('en-GB')}</span><span className="mc-stat-label">Disciplines</span></div>
                        </>}
                    </div>
                    <div id="mc-dist-card" className="mc-chart-card" style={loaded && enough ? undefined : {display: 'none'}}>
                        <h3 className="mc-chart-title">Distribution of reference pairs by journal Mean Citedness</h3>
                        <div className="mc-chart-wrap">{loaded && enough && <PlotlyChart id="mc-dist-chart" className="" title="Distribution of reference pairs by journal Mean Citedness" build={buildDist} deps={[d, kind, version]} />}</div>
                    </div>
                    <p id="mc-repro-note" className="mc-model-note" style={loaded && enough && !isReplication ? undefined : {display: 'none'}}>Reproduction summaries are descriptive. No reproduction model has been fitted.</p>
                    <div id="mc-gam-card" className="mc-chart-card" style={loaded && enough && isReplication ? undefined : {display: 'none'}}>
                        <h3 className="mc-chart-title">Success probability among successful / failed replications</h3>
                        <p id="mc-gam-stats" className="mc-model-note">{loaded && enough && hasModel && <>
                            Logistic smooth: <Gloss term="edf">Effective degrees of freedom: how flexible the fitted curve is. edf ≈ 1 is close to a straight line; higher values mean a more flexible, wigglier fit.</Gloss> = {st.edf}, χ² = {st.chi_sq}{pNote ? ', ' + pNote : ''};{' '}
                            <Gloss term="McFadden R²">McFadden’s pseudo-R²: a goodness-of-fit measure for logistic models. It compares the fitted logistic model with an intercept-only model; it is not the fraction of variance explained.</Gloss> = {st.r2}; N = {st.n_model.toLocaleString('en-GB')} (successful vs. failed)
                        </>}</p>
                        <div className="mc-chart-wrap"><PlotlyChart id="mc-gam-chart" className="" title="Success probability among successful / failed replications"
                            active={loaded && !!enough && isReplication} build={buildModel} deps={[d, kind, version]} /></div>
                        <p className="mc-model-note" style={{marginTop: '0.6rem'}}>Conditional on unqualified successful or failed outcomes; other outcomes are excluded. Association does not establish causation.</p>
                    </div>
                    <LoadError id="mc-error" error={error}>Failed to load analysis data.</LoadError>
                </div>
            </div>
        </div>
    </PaneContext.Provider>;
}
