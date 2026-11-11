import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {useApp, PaneContext} from '../state/context.jsx';
import {STUDY_TYPE_CHIPS, kindText} from '../lib/outcomes.js';
import {normalizedQuery, searchAuthorNames, searchTokens, matchesSearchTokens, normalizeDoi} from '../lib/search.js';
import {citationAuthors} from '../lib/format.js';
import {number, percent, countAxis, theme as chartTheme} from '../lib/chartUtils.js';
import {CI_COLORS} from '../lib/citationShared.js';
import {PlotlyChart} from '../components/Charts.jsx';
import {ChipGroup, CiteBlock, DataStamp, Gloss, KindText, StudyTypeChips} from '../components/Common.jsx';
import CitationModal from './CitationModal.jsx';

const REPRO_BUCKETS = {
    'reproduction-numerical': [{key: 'successful', label: 'Successful'}, {key: 'issues', label: 'Computational issues'}, {key: 'technical_failure', label: 'Technical failure'}],
    'reproduction-robustness': [{key: 'robust', label: 'Robust'}, {key: 'challenges', label: 'Robustness challenges'}],
};
const REPRO_MIN_N = 5;
const PER_PAGE = 20;
const OUTCOME_CHIPS = [{value: 'all', label: 'All'}, {value: 'failed', label: 'Failed'}, {value: 'successful', label: 'Successful'}, {value: 'mixed', label: 'Mixed'}];
const PUBSTATUS_LABELS = {individual: 'Up to 3 targets', large_project: 'Multiple-target report (>3 targets)'};
const BREAKDOWN_OUTCOME_LABELS = {successful: 'Successful', failed: 'Failed', mixed: 'Mixed'};
const MUTED = {textAlign: 'center', color: 'var(--color-muted-fg)'};


async function loadCitationData() {
    const [metaRes, aggRes, idxRes] = await Promise.all([fetch('data/meta.json'), fetch('data/aggregate.json'), fetch('data/originals_index.json')]);
    if (!metaRes.ok || !aggRes.ok || !idxRes.ok) throw new Error('Citation data not available');
    const [meta, agg, index] = await Promise.all([metaRes.json(), aggRes.json(), idxRes.json()]);
    const optional = async url => { try { const r = await fetch(url); return r.ok ? await r.json() : null; } catch { return null; } };
    const [cocitBreakdown, repro] = await Promise.all([optional('data/cocit_breakdown.json'), optional('data/reproduction_citations.json')]);
    return {meta, agg, index, cocitBreakdown, repro};
}

// The citation snapshot stops display names after six authors; FLoRA rows keep full lists.
function buildSearchIndex(index, rows) {
    const authorsByDoi = new Map();
    for (const row of rows || []) {
        const doi = normalizeDoi(row.doi_o), names = searchAuthorNames(row.author_o);
        if (!doi || !names) continue;
        if (!authorsByDoi.has(doi)) authorsByDoi.set(doi, new Set());
        authorsByDoi.get(doi).add(names);
    }
    return index.map(s => {
        // Citations before any replication existed could never have co-cited one.
        const cocit_prop = s.n_citations_post_first_rep > 0 ? s.n_cocitations / s.n_citations_post_first_rep : 0;
        const authors = [...(authorsByDoi.get(normalizeDoi(s.doi)) || [])];
        return {...s, cocit_prop, searchText: normalizedQuery([s.title, searchAuthorNames(s.author), ...authors, s.year, s.venue, s.doi].filter(Boolean).join(' | '))};
    });
}

export default function CitationImpact({visited, active}) {
    const {rows, view, updateView} = useApp();
    const {ciKind: kind, ciOutcome: outcome, ciQuery: query, ciFilter: filter, doi} = view;
    const [state, setState] = useState({status: 'idle'});
    const [sort, setSort] = useState({col: 'n_citations', dir: 'desc'});
    const [page, setPage] = useState(1);
    const inputRef = useRef(null), tableRef = useRef(null), paginationRef = useRef(null);
    const pendingFocus = useRef(null);

    const wanted = visited || (active && doi);
    useEffect(() => {
        if (!wanted || state.status !== 'idle') return;
        setState({status: 'loading'});
        loadCitationData().then(d => setState({status: 'ready', ...d}), e => { console.error('Citation Impact load failed:', e); setState({status: 'error'}); });
    }, [wanted, state.status]);

    const index = useMemo(() => state.index ? buildSearchIndex(state.index, rows) : null, [state.index, rows]);

    const applyQuery = useCallback(q => { setPage(1); updateView({ciQuery: q}); }, [updateView]);
    useEffect(() => {
        const input = inputRef.current;
        let timer;
        const onInput = () => { clearTimeout(timer); timer = setTimeout(() => applyQuery(input.value), 200); };
        input.addEventListener('input', onInput);
        input.cancelPendingSearch = () => clearTimeout(timer);
        return () => { input.removeEventListener('input', onInput); clearTimeout(timer); };
    }, [applyQuery]);
    useEffect(() => { if (inputRef.current.value !== query) inputRef.current.value = query; }, [query]);

    const results = useMemo(() => {
        if (!index) return [];
        const tokens = searchTokens(query);
        const out = index.filter(s => matchesSearchTokens(s.searchText, tokens) && (!filter || (s.outcome_mix && s.outcome_mix[filter])));
        const {col, dir} = sort;
        return out.sort((a, b) => {
            const av = a[col] != null ? a[col] : -Infinity, bv = b[col] != null ? b[col] : -Infinity;
            return dir === 'asc' ? av - bv : bv - av;
        });
    }, [index, query, filter, sort]);
    const pages = Math.max(1, Math.ceil(results.length / PER_PAGE));
    const currentPage = page > pages ? 1 : page;
    const slice = results.slice((currentPage - 1) * PER_PAGE, currentPage * PER_PAGE);
    // Every applied search, filter, sort or page re-renders the rows, as the table always did.
    const renderKey = [query, filter, sort.col, sort.dir, currentPage].join('|');

    const sortBy = col => {
        setSort(s => s.col === col ? {col, dir: s.dir === 'desc' ? 'asc' : 'desc'} : {col, dir: 'desc'});
        setPage(1);
    };
    const goToPage = (p, action) => { pendingFocus.current = {p, action}; setPage(p); };
    useLayoutEffect(() => {
        const focus = pendingFocus.current; pendingFocus.current = null;
        if (!focus) return;
        const pag = paginationRef.current;
        (pag?.querySelector(focus.action ? `[data-action="${focus.action}"]` : `[data-p="${focus.p}"]`) || pag?.querySelector('[aria-current]'))?.focus({preventScroll: true});
    }, [currentPage]);

    const openStudy = useRef(null);
    const clearSearch = () => { inputRef.current.cancelPendingSearch?.(); inputRef.current.value = ''; applyQuery(''); inputRef.current.focus(); };

    const k = (...v) => kindText(kind, ...v);
    const kt = (...v) => <KindText>{k(...v)}</KindText>;
    const selection = [STUDY_TYPE_CHIPS.find(c => c.value === kind).label, OUTCOME_CHIPS.find(c => c.value === outcome).label];
    const pane = useMemo(() => ({sources: ['citations', 'reproduction_citations'], selection}), [selection.join()]); // eslint-disable-line react-hooks/exhaustive-deps
    const ready = state.status === 'ready';
    const failed = state.status === 'error';
    const q = query.trim();

    return <PaneContext.Provider value={pane}>
        <h1 className="visually-hidden">Citation Impact</h1>
        <DataStamp source="citations" />
        <CiteBlock>
            <p className="reuse-text">This is a simplified preview of the methods pre-registered for our ongoing confirmatory study:</p>
            <div className="cite-ref">Weinerova, J., Wallrich, L., Röseler, L., Feuerriegel, S., &amp; Azevedo, F. (2026, April 30). (When) Do Replications Influence the Impact of Original Claims? A Bibliometric Investigation. <a href="https://doi.org/10.17605/OSF.IO/WJGM3" target="_blank" rel="noopener noreferrer" className="doi-link">https://doi.org/10.17605/OSF.IO/WJGM3</a></div>
        </CiteBlock>

        <div className="ci-intro">
            <h2 className="ci-h2">{k('Citation patterns around the first replication', 'Citation counts for numerical reproductions', 'Citation counts for robustness reproductions')}</h2>
            <StudyTypeChips id="ci-study-type" label="Citation Impact study type" value={kind} onChange={v => updateView({ciKind: v})} />
            <div className="study-type-note">Numerical and robustness reproductions show descriptive citation counts. No reproduction event-study model is fitted.</div>
            <p className="ci-lede">
                This tab combines the FLoRA dataset with citation data from{' '}
                <a href="https://opencitations.net" target="_blank" rel="noopener noreferrer">OpenCitations</a> to{' '}
                {kt('describe citations to the original around the first recorded replication', 'count citations to originals and their numerical reproductions', 'count citations to originals and their robustness reproductions')},
                and how often the two are "co-cited" (cited together by the same later work).
            </p>
        </div>

        <ReproductionGate kind={kind} repro={state.repro} ready={ready} />

        <div id="ci-content" style={kind === 'replication' ? undefined : {display: 'none'}}>
            <div className="kpi-row" id="kpis">
                {ready ? <Kpis meta={state.meta} /> : failed ? <Unavailable /> : <div style={{padding: 24, ...MUTED, gridColumn: '1 / -1'}}>⏳ Loading citation data…</div>}
            </div>

            <div className="card ci-card">
                <h2 className="card-header">Aggregate impact of replications</h2>
                <div className="card-body">
                    <p className="muted">
                        Event-study estimates: each original is aligned at <em>t = 0</em>, the year of its first
                        published replication. Raw trajectories show average counts. The separate coefficient plots show OLS estimates and 95% confidence intervals on the log(1 + count) scale, relative to year −1, adjusting for original and calendar-year fixed effects. These associations do not establish a causal effect.
                    </p>
                    <div className="filters">
                        <span className="filter-label">Replication outcome</span>
                        <ChipGroup id="outcome-chips" label="Replication outcome" options={OUTCOME_CHIPS} value={outcome} onChange={v => updateView({ciOutcome: v})} />
                    </div>
                    <div className="att-callout" id="att-callout">{ready && <AttCallout data={state.agg[outcome]} />}</div>
                    <div className="plot-grid">
                        <div className="plot-card">
                            <h3>Citations to the original</h3>
                            <AggregatePlots id="plot-cit" heading="Citations to the original" status={state.status} data={state.agg?.[outcome]} outcome={outcome} active={active}
                                descField="mean_citations" modelField="citations_model" ylabel="Mean citations per year" />
                        </div>
                        <div className="plot-card">
                            <h3>Co-citations (original and replication)</h3>
                            <AggregatePlots id="plot-cocit" heading="Co-citations (original and replication)" status={state.status} data={state.agg?.[outcome]} outcome={outcome} active={active}
                                descField="mean_cocitations" modelField="cocitations_model" ylabel="Mean co-citations per year" />
                        </div>
                    </div>
                </div>
            </div>

            <div className="card ci-card">
                <h2 className="card-header">Co-citation rate by replication report size &amp; outcome</h2>
                <div className="card-body">
                    <p className="muted">
                        The co-citation rate is the share of an original's citations that also cite one of its
                        replications, counted from the year of its first replication. Originals with multiple
                        replications appear in every row that applies. Rates vary widely across originals, so three
                        summaries are shown:{' '}
                        <strong>per-paper mean</strong> (each original weighted equally),{' '}
                        <strong>median</strong> (robust to outliers), and{' '}
                        <strong>weighted mean</strong> (pooled co-citations ÷ pooled citations, effectively weighted
                        by citation volume).
                    </p>
                    <div className="cocit-breakdown-grid" id="cocit-breakdown">
                        {ready && (state.cocitBreakdown
                            ? <><BreakdownTable title="By replication report size" dim={state.cocitBreakdown.pub_status || {}} labels={PUBSTATUS_LABELS} />
                                <BreakdownTable title="By outcome of the replication" dim={state.cocitBreakdown.outcome || {}} labels={BREAKDOWN_OUTCOME_LABELS} /></>
                            : <p className="muted">Not available yet — this analysis is included from the next scheduled data refresh.</p>)}
                    </div>
                </div>
            </div>

            <div className="card ci-card">
                <h2 className="card-header">Browse all originals</h2>
                <div className="card-body">
                    <p className="muted">Choose Timeline to see a report’s citation timeline with replication events marked.</p>
                    <label htmlFor="search-input" className="search-label">Search originals</label>
                    <div className="search-row">
                        <input id="search-input" ref={inputRef} type="search" placeholder="Title, author, year, journal, DOI or DOI URL" defaultValue={query} />
                        <select id="filter-outcome" aria-label="Filter originals by any recorded replication outcome" value={filter} onChange={e => { setPage(1); updateView({ciFilter: e.target.value}); }}>
                            <option value="">All outcomes</option>
                            <option value="failed">Has failed replication</option>
                            <option value="successful">Has successful replication</option>
                            <option value="mixed">Has mixed replication</option>
                        </select>
                    </div>
                    <div id="ci-search-empty" className="browse-empty" role="status" hidden={!ready || results.length > 0}>
                        <p id="ci-search-empty-message"><span key={renderKey}>{q ? `No originals match “${q}” with the current outcome selection.` : 'No originals match the current outcome selection.'}</span></p>
                        <button type="button" id="ci-clear-search" className="browse-download" hidden={!q} onClick={clearSearch}>Clear search</button>
                    </div>
                    <div className="table-wrap">
                        <table id="originals-table" tabIndex={-1} ref={tableRef}>
                            <thead><tr>
                                <th>Original</th>
                                {[['year', 'Year'], ['n_replications', 'Replications'], ['n_citations', 'Citations, all years']].map(([col, label]) =>
                                    <th key={col} className={'sortable' + (sort.col === col ? ' sort-' + sort.dir : '')} data-sort={col} scope="col"
                                        aria-sort={sort.col === col ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                                        <button type="button" className="table-sort" data-sort={col} onClick={() => sortBy(col)}>{label}</button>
                                    </th>)}
                                <th className="cocit-th" scope="col" aria-sort={['n_cocitations', 'cocit_prop'].includes(sort.col) ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                                    Co-citations since first recorded replication <span className="cocit-sort-toggle">
                                        {[['n_cocitations', '#', 'Sort by co-citation count', 'Sort by co-citation count'], ['cocit_prop', '%', 'Sort by co-citation share', 'Sort by co-citation percentage']].map(([col, label, title, aria]) =>
                                            <button key={col} type="button" className={'cocit-sort-btn' + (sort.col === col ? ' sort-' + sort.dir : '')} data-sort={col} title={title} aria-label={aria}
                                                aria-pressed={sort.col === col} onClick={() => sortBy(col)}>{label}</button>)}
                                    </span>
                                </th>
                                <th scope="col"><span className="visually-hidden">Timeline</span></th>
                            </tr></thead>
                            <tbody>
                                {!ready && <tr><td colSpan={6} style={{...MUTED, padding: 40}}>{failed ? 'No data yet. First refresh in progress.' : 'Loading…'}</td></tr>}
                                {ready && slice.map(s => <OriginalRow key={renderKey + '|' + s.doi} s={s} onOpen={() => openStudy.current?.(s.doi)} />)}
                            </tbody>
                        </table>
                    </div>
                    <nav className="pagination" id="pagination" aria-label="Pagination" ref={paginationRef}>
                        {ready && results.length > 0 && <PageButtons page={currentPage} pages={pages} onPage={goToPage} />}
                    </nav>
                </div>
            </div>

            <div className="card ci-card">
                <h2 className="card-header">About this analysis</h2>
                <div className="card-body">
                    <p>
                        Data are refreshed weekly. The pipeline filters FLoRA to{' '}
                        <strong>conceptual and direct replications</strong> with outcomes labelled{' '}
                        <em>successful</em>, <em>failed</em>, or <em>mixed</em> (reproductions are excluded).
                        For each included original and replication, we retrieve all citing works from
                        OpenCitations COCI. A "co-citation" is any work that cites both the original and at
                        least one of its replications.
                    </p>
                    <p>The outcome filters group originals by the outcome of their earliest recorded replication year; same-year ties follow the stored record order. Later replications can have different outcomes. The table’s outcome filter instead matches any replication of an original. Qualified success, descriptive-only, uninformative, and missing outcomes are excluded from the citation model.</p>
                    <p>Each timeline bar counts distinct citing works. Works that cite replications with more than one outcome appear once in the “multiple outcome categories” segment. The outcome-specific co-citation rate tables are overlapping summaries and should not be added.</p>
                    <p>
                        The aggregate plots show event-study estimates from an OLS two-way fixed-effects
                        model, a transparent analogue of the <Gloss term="FECT">Fixed Effects Counterfactual estimator: the causal-inference method specified in our preregistered protocol. This chart approximates it with a simpler OLS two-way fixed-effects model.</Gloss> specification used in the
                        preregistered analysis. See the{' '}
                        <a href="https://github.com/forrtproject/FReD-data" target="_blank" rel="noopener noreferrer">FReD-data repository</a>{' '}
                        for the underlying FLoRA dataset.
                    </p>
                </div>
            </div>
        </div>
        <CitationModal index={index} meta={state.meta} openRef={openStudy} />
    </PaneContext.Provider>;
}

function Unavailable() {
    return <div style={{padding: 24, background: 'var(--color-surface-raised)', border: '1px solid var(--color-border)', borderRadius: 8, ...MUTED, gridColumn: '1 / -1'}}>
        ⏳ <strong>Citation data not yet available.</strong><br />Citation data could not be loaded. Please try again later.
    </div>;
}

function ReproductionGate({kind, repro, ready}) {
    if (kind === 'replication') return <><div id="ci-placeholder" className="coming-soon-placeholder" style={{display: 'none'}} /><div id="ci-repro-content" style={{display: 'none'}} /></>;
    const buckets = REPRO_BUCKETS[kind] || [];
    const data = repro && repro[kind];
    const total = data ? buckets.reduce((sum, b) => sum + ((data[b.key] && data[b.key].n_originals) || 0), 0) : 0;
    const enough = ready && data && total >= REPRO_MIN_N;
    return <>
        <div id="ci-placeholder" className="coming-soon-placeholder" style={!ready || enough ? {display: 'none'} : undefined}>
            {`Not enough reproductions with citation data yet (n=${total}; need at least ${REPRO_MIN_N}).`}
        </div>
        <div id="ci-repro-content" className="card ci-card" style={enough ? undefined : {display: 'none'}}>
            <DataStamp source="reproduction_citations" />
            <h2 className="card-header">Reproduction citation counts</h2>
            <div className="card-body">
                <p className="muted">Counts are grouped by the assessed dimension. A report can contribute to several outcome groups, so group totals are not additive.</p>
                <div className="table-wrap">
                    <table className="table table-striped table-hover" id="ci-repro-table" style={{width: '100%'}}>
                        <thead><tr><th scope="col"><span className="visually-hidden">Outcome</span></th><th>Originals</th><th>Citations to original</th><th>Citations to reproduction</th><th>Co-citations</th></tr></thead>
                        <tbody>{enough && buckets.map(b => { const row = data[b.key] || {}; return <tr key={b.key}>
                            <td>{b.label}</td><td>{number(row.n_originals || 0)}</td><td>{number(row.n_citations_to_original || 0)}</td>
                            <td>{number(row.n_citations_to_reproduction || 0)}</td><td>{number(row.n_cocitations || 0)}</td></tr>; })}</tbody>
                    </table>
                </div>
            </div>
        </div>
    </>;
}

function Kpis({meta}) {
    const c = meta?.outcome_counts || {};
    const fmt = n => n == null ? '—' : number(n);
    return <>
        <div className="kpi"><div className="kpi-value">{fmt(meta?.n_originals)}</div><div className="kpi-label">Original reports with complete citation data</div></div>
        <div className="kpi"><div className="kpi-value">{fmt(meta?.n_replications)}</div><div className="kpi-label">Eligible replication reference pairs</div></div>
        <div className="kpi"><div className="kpi-value">{fmt(c.failed)}</div><div className="kpi-label">Eligible pairs: failed</div></div>
        <div className="kpi"><div className="kpi-value">{fmt(c.successful)}</div><div className="kpi-label">Eligible pairs: successful</div></div>
        <p className="muted kpi-note">Eligible pair counts are measured before citation lookup, so they include pairs whose originals lack complete citation data.</p>
    </>;
}

function AttCallout({data}) {
    if (!data) return null;
    const model = data.citations_model || {}, desc = data.descriptive || {};
    if (model.att != null && Number.isFinite(model.att)) {
        const interval = model.att_ci || [];
        const ci = interval.length === 2 && interval.every(Number.isFinite) ? ` (95% CI ${number(interval[0], 3)} to ${number(interval[1], 3)})` : '';
        return <><strong>Adjusted post-replication association:</strong> {number(model.att, 3)} log(1 + citations) units{ci}, based on {number(model.n_units)} originals. This is not a percentage change in raw citations or evidence that replication caused the change.</>;
    }
    if (desc.n_units?.length) return <><strong>Descriptive trajectory shown.</strong>{' '}
        <span className="muted">{number(Math.max(...desc.n_units))} originals contribute at peak. Each line shows the average citation count by years relative to the first replication.</span></>;
    return <><strong>Insufficient data</strong> for the selected outcome group.</>;
}

function AggregatePlots({id, heading, status, data, outcome, descField, modelField, ylabel, active}) {
    if (status !== 'ready') return <div id={id} className="plot"><div style={{padding: '80px 20px', ...MUTED}}>{status === 'error' ? 'No data yet' : 'Loading…'}</div></div>;
    const desc = data?.descriptive || {}, model = data?.[modelField] || {};
    const valid = (model.event_time || []).map((x, i) => ({x, y: model.estimate?.[i], lo: model.ci_low?.[i], hi: model.ci_high?.[i]}))
        .filter(p => [p.y, p.lo, p.hi].every(v => typeof v === 'number' && Number.isFinite(v)));
    const buildRaw = () => {
        const color = CI_COLORS[outcome] || CI_COLORS.all, t = chartTheme();
        const traces = [];
        if (desc.event_time?.length) traces.push({x: desc.event_time, y: desc[descField], type: 'scatter', mode: 'lines+markers',
            line: {color, width: 2.5}, marker: {color, size: 7}, name: 'Mean (raw)',
            text: desc.event_time.map((x, i) => `Years from first replication: ${number(x)}<br>${ylabel}: ${number(desc[descField][i], 2)}`), hovertemplate: '%{text}<extra></extra>'});
        if (desc.event_time && desc.n_units?.length) traces.push({x: desc.event_time, y: desc.n_units, type: 'scatter', mode: 'lines',
            line: {color: t.rule, width: 1, dash: 'dot'}, name: 'N (right axis)', yaxis: 'y2',
            text: desc.event_time.map((x, i) => `Years from first replication: ${number(x)}<br>Original reports: ${number(desc.n_units[i])}`), hovertemplate: '%{text}<extra></extra>'});
        if (!traces.length) return {empty: 'No data for this filter'};
        return {traces, config: {displayModeBar: false, responsive: true}, layout: {
            margin: {t: 30, r: 50, b: 50, l: 60},
            xaxis: {title: 'Years relative to first replication', zeroline: false, gridcolor: t.grid, color: t.font},
            yaxis: {title: ylabel, gridcolor: t.grid, color: t.font, rangemode: 'tozero'},
            yaxis2: {title: 'N studies', ...countAxis(Math.max(0, ...(desc.n_units || []))), overlaying: 'y', side: 'right', showgrid: false, rangemode: 'tozero', tickfont: {color: t.muted, size: 10}, titlefont: {color: t.muted, size: 10}},
            shapes: [{type: 'line', x0: 0, x1: 0, yref: 'paper', y0: 0, y1: 1, line: {color: t.primary, width: 1.5, dash: 'dash'}}],
            annotations: [{x: 0, yref: 'paper', y: 1.04, xref: 'x', yanchor: 'bottom', text: 'Replication published', showarrow: false, font: {size: 11, color: t.primary}}],
            plot_bgcolor: t.plot, paper_bgcolor: t.paper, font: {family: t.fontFamily, size: 12, color: t.font},
            legend: {orientation: 'h', y: -0.22, font: {color: t.font}},
        }};
    };
    const buildModel = () => {
        if (!valid.length) return {empty: 'No fitted model for this selection.'};
        const t = chartTheme();
        return {traces: [{name: 'OLS coefficient (95% CI)', x: valid.map(p => p.x), y: valid.map(p => p.y), type: 'scatter', mode: 'markers',
            text: valid.map(p => `Years from first replication: ${number(p.x)}<br>Coefficient: ${number(p.y, 3)}<br>95% CI: ${number(p.lo, 3)} to ${number(p.hi, 3)}`),
            hovertemplate: '%{text}<extra></extra>', error_y: {type: 'data', symmetric: false, array: valid.map(p => p.hi - p.y), arrayminus: valid.map(p => p.y - p.lo)}, marker: {color: t.font}}],
        layout: {title: {text: 'Adjusted association: log(1 + count)', font: {size: 14}}, height: 340,
            xaxis: {title: 'Years from first replication', automargin: true, color: t.font},
            yaxis: {title: 'Coefficient (reference: year −1)', zeroline: true, zerolinecolor: t.font, automargin: true, color: t.font},
            margin: {t: 45, r: 20, b: 60, l: 65}, plot_bgcolor: t.plot, paper_bgcolor: t.paper, font: {color: t.font}},
        config: {responsive: true, displayModeBar: false}};
    };
    return <>
        <PlotlyChart id={id} title={'Raw trajectory: ' + heading} build={buildRaw} deps={[data, outcome]} />
        <PlotlyChart id={id + '-model'} className="coefficient-plot" title={'Adjusted association: ' + heading} build={buildModel} deps={[data, outcome]} />
    </>;
}

function BreakdownTable({title, dim, labels}) {
    const fmt = v => v == null ? '—' : percent(v, 1, 1) + '%';
    return <div className="cocit-breakdown-table" tabIndex={0} role="region" aria-label={title}>
        <h3>{title}</h3>
        <table>
            <thead><tr><th>Group</th><th>N originals</th><th>Per-paper mean</th><th>Median</th><th>Weighted mean</th></tr></thead>
            <tbody>{Object.keys(labels).map(key => { const d = dim[key] || {}; return <tr key={key}>
                <td>{labels[key]}</td><td>{d.n_originals != null ? number(d.n_originals) : '—'}</td>
                <td>{fmt(d.mean_rate)}</td><td>{fmt(d.median_rate)}</td><td>{fmt(d.grand_mean_rate)}</td></tr>; })}</tbody>
        </table>
    </div>;
}

function OutcomeBar({mix, n}) {
    if (!mix || !n) return '—';
    const order = ['failed', 'mixed', 'successful'];
    const tooltip = order.filter(o => mix[o]).map(o => `${number(mix[o])} ${o}`).join(', ');
    return <div className="rep-bar-wrap" title={tooltip}>
        <div className="rep-bar">{order.map(o => mix[o]
            ? <div key={o} className={'rep-seg ' + o} style={{width: (mix[o] / n * 100).toFixed(1) + '%'}} title={`${number(mix[o])} ${o}`}></div> : null)}</div>
        <span className="rep-count">{number(n)}</span>
    </div>;
}

function CocitCell({s}) {
    if (!s.n_cocitations && s.n_cocitations !== 0) return '—';
    const denom = s.n_citations_post_first_rep;
    const pct = denom > 0 ? percent(s.cocit_prop, 1, 1) + '%' : '—';
    const tooltip = denom
        ? `${number(s.n_cocitations)} of ${number(denom)} citations since the first replication (${s.first_replication_year}) also cite a replication`
        : `${number(s.n_cocitations)} co-citations`;
    return <span title={tooltip}>{number(s.n_cocitations)}<span className="cocit-pct"> ({pct}{denom > 0 ? ` of ${number(denom)}` : ''})</span></span>;
}

function OriginalRow({s, onOpen}) {
    return <tr data-doi={s.doi} onClick={onOpen}>
        <td>
            <div className="title-cell">{s.title || '(untitled)'}</div>
            <div className="author-cell">{citationAuthors(s.author)} {s.venue && s.venue !== 'nan' ? '· ' + s.venue : ''}</div>
        </td>
        <td>{s.year || '—'}</td>
        <td><OutcomeBar mix={s.outcome_mix} n={s.n_replications} /></td>
        <td>{number(s.n_citations || 0)}</td>
        <td><CocitCell s={s} /></td>
        <td><button type="button" className="timeline-open" aria-label={`Open citation timeline for ${s.title || s.doi}`}>Timeline</button></td>
    </tr>;
}

function PageButtons({page, pages, onPage}) {
    const start = Math.max(1, page - 2), end = Math.min(pages, start + 4);
    const numbers = [];
    for (let i = start; i <= end; i++) numbers.push(i);
    return <>
        {page > 1 && <button type="button" data-action="previous" data-p={page - 1} aria-label="Previous page" onClick={() => onPage(page - 1, 'previous')}>‹</button>}
        {numbers.map(i => <button key={i} type="button" data-p={i} aria-current={i === page ? 'page' : undefined} className={i === page ? 'active' : ''} aria-label={`Page ${i}`} onClick={() => onPage(i)}>{i}</button>)}
        {page < pages && <button type="button" data-action="next" data-p={page + 1} aria-label="Next page" onClick={() => onPage(page + 1, 'next')}>›</button>}
    </>;
}
