import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {URLS} from '../lib/config.js';
import {categoryAxis, countAxis, escapeHtml, finishOption, labelColor, pointTable, stackCorners, tipLines, tipRow, valueAxis} from '../lib/charts.js';
import {citationAuthors, number, percent} from '../lib/format.js';
import {coverageText} from '../lib/coverage.js';
import {outcomeBuckets} from '../lib/outcomes.js';
import {matchesTokens, normalizeDoi, normalizedQuery, searchAuthorNames, searchTokens} from '../lib/search.js';
import {chartTheme, textScale, token} from '../lib/theme.js';
import {FloraVocabulary} from '../lib/vocabulary.js';
import {describeLoadError, useData} from '../state/data.jsx';
import {PaneContext, useEnv} from '../state/env.jsx';
import {useView} from '../state/view.jsx';
import {Plot} from '../components/charts.jsx';
import {Button, Callout, Figure, LoadError, Note, Section, TableScroll} from '../components/ui.jsx';
import {Chips, CiteBlock, Icon, DataStamp, ExcludedRows, ExternalLink, Gloss, Pane, Placeholder, byKind, kindLabel, excludedOriginalLabel, exclusionReason, stampInfo} from '../components/common.jsx';

const PER_PAGE = 20;
const EMPTY = [];
const REPRO_MIN_N = 5;
const OUTCOME_OPTIONS = [['all', 'All'], ['failed', 'Failed'], ['successful', 'Successful'], ['mixed', 'Mixed']];
const outcomeColor = outcome => outcome === 'all' || !outcome ? token('--color-primary') : token('--color-chart-' + outcome);
const venueText = venue => venue && venue !== 'nan' ? ' · ' + venue : '';

async function fetchJson(url, optional) {
    try {
        const res = await fetch(url, {cache: 'no-cache'});
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return await res.json();
    } catch (e) { if (optional) return null; throw e; }
}

// Loads the citation snapshot once, when the tab or a DOI deep link first needs it.
function useCitationData(enabled) {
    const [state, setState] = useState({status: 'idle'});
    useEffect(() => {
        if (!enabled || state.status !== 'idle') return;
        setState({status: 'loading'});
        Promise.all([fetchJson(URLS.citationMeta), fetchJson(URLS.aggregate), fetchJson(URLS.originalsIndex), fetchJson(URLS.cocitBreakdown, true), fetchJson(URLS.reproductionCitations, true)])
            .then(([meta, agg, index, breakdown, repro]) => setState({status: 'ready', meta, agg, index, breakdown, repro}),
                e => { console.error('Citation Impact load failed:', e); setState({status: 'error', reason: describeLoadError(e)}); });
    }, [enabled, state.status]);
    // Back to idle, so the effect above loads again.
    const retry = useCallback(() => setState({status: 'idle'}), []);
    return {...state, retry};
}

const COCIT_WINDOW = [0, 5];

function sliceDescriptive(desc, [lo, hi]) {
    const keep = desc.event_time.map((x, i) => x >= lo && x <= hi ? i : -1).filter(i => i >= 0);
    return Object.fromEntries(Object.entries(desc).map(([k, v]) => [k, Array.isArray(v) && v.length === desc.event_time.length ? keep.map(i => v[i]) : v]));
}

function trajectorySpec(desc, field, ylabel, outcome, coverage) {
    const t = chartTheme(), color = outcomeColor(outcome);
    if (!desc?.event_time?.length) return {message: 'No data for this filter'};
    const x = desc.event_time, y = desc[field], name = 'Mean (raw)';
    const unit = field === 'mean_citations' ? 'Mean citations per original per year' : 'Mean co-citations per original per year';
    const startsAtZero = Math.min(...x) >= 0;
    return {coverage, table: pointTable([{name, x, y}], unit),
        // One series needs no legend: the axis title names what is plotted.
        option: ({width}) => finishOption({legend: {show: false},
            series: [{name, type: 'line', data: x.map((v, i) => [v, y[i]]), lineStyle: {color, width: 2.25}, itemStyle: {color, borderColor: t.paper, borderWidth: 1.5},
                symbol: 'circle', symbolSize: 7, areaStyle: {color: t.band, opacity: 1}, emphasis: {disabled: true},
                markLine: {silent: true, symbol: 'none', lineStyle: {color: t.primary, width: 1.5, type: 'dashed'}, data: [{xAxis: 0}],
                    label: {position: 'end', formatter: 'Replication published', color: t.primary, fontSize: 11, ...(startsAtZero ? {align: 'left', distance: 8} : {})}}}],
            tooltip: {formatter: p => tipLines([`Years from first replication: ${number(p.value[0])}`, `${escapeHtml(ylabel)}: ${number(p.value[1], 2)}`])},
            // Padded so the first and last points are not cut by the plot edge; ticks stay on whole years.
            xAxis: valueAxis({name: 'Years relative to first replication', nameGap: 26, min: Math.min(...x) - .35, max: Math.max(...x) + .35, splitLine: {show: false},
                axisLabel: {customValues: x}, axisTick: {customValues: x}}),
            yAxis: valueAxis({name: ylabel, min: 0}),
        }, {width, top: startsAtZero ? 26 : 18}),
    };
}

// "N of M originals" for one panel, and the same coverage as a sentence for its chart data.
function sampleSize(desc, group, criterion, excludedWhy) {
    const n = Math.max(0, ...(desc?.n_units || []));
    const m = Math.max(n, group.length);
    // The pipeline drops these before any window check.
    const badYears = group.filter(s => !s.year || !s.first_replication_year || s.first_replication_year < s.year).length;
    return {n, note: n ? `Sample size: ${number(n)} of ${number(m)} originals ${criterion}` : '',
        coverage: coverageText(n, m, [[badYears, 'with a missing original or replication year, or a replication dated before its original'], [m - n - badYears, excludedWhy]], 'originals')};
}

function AggregatePlots({data, outcome}) {
    const {theme} = useEnv();
    const agg = data.agg[outcome];
    const built = useMemo(() => {
        if (!agg) return null;
        // Originals whose first replication falls in the selected outcome group.
        const group = data.index.filter(s => outcome === 'all' ? s.first_replication_outcome : s.first_replication_outcome === outcome);
        const citDesc = agg.descriptive, rawCocit = agg.descriptive_cocit || agg.descriptive;
        const cocitDesc = rawCocit?.event_time ? sliceDescriptive(rawCocit, COCIT_WINDOW) : rawCocit;
        const cit = sampleSize(citDesc, group, 'with 5 years of citation data before and after the first replication', 'whose first replication is too recent, or too soon after the original, for 5 years either side');
        const cocit = sampleSize(cocitDesc, group, 'with 5 years of citation data after the first replication', 'whose first replication is too recent for 5 years after it');
        return {cit, cocit,
            citSpec: trajectorySpec(citDesc, 'mean_citations', 'Mean citations per year', outcome, cit.coverage),
            cocitSpec: trajectorySpec(cocitDesc, 'mean_cocitations', 'Mean co-citations per year', outcome, cocit.coverage),
            span: [Math.min(...(citDesc?.event_time || [0])), Math.max(...(citDesc?.event_time || [0]))]};
    }, [agg, outcome, data.index, theme]);
    if (!built) return null;
    const label = outcome === 'all' ? '' : FloraVocabulary.label(outcome).toLowerCase();
    const tableN = outcome === 'all' ? data.index.filter(s => s.n_citations_post_first_rep > 0).length : data.breakdown?.outcome?.[outcome]?.n_originals;
    const group = outcome === 'all' ? 'replication' : `${label} replication`;
    return (
        // The two trajectories sit side by side on wide screens, each with its own note beneath it.
        <div className="ci-pair">
            <div className="stack">
                <Plot id="plot-cit" className="plot" heading="Citations to the original" title="Raw trajectory: Citations to the original" spec={built.citSpec} note={<Note id="plot-cit-sample">{built.cit.note}</Note>} />
                <Note id="plot-cit-footnote">{built.cit.n > 0 && <>Mean citations estimated for <strong><i>N</i> = {number(built.cit.n)}</strong> originals (first replication {outcome === 'all' ? 'successful, failed or mixed' : label}; each observed over t = {number(built.span[0])} to +{number(built.span[1])} years).</>}</Note>
            </div>
            <div className="stack">
                <Plot id="plot-cocit" className="plot" heading="Co-citations (original and replication)" title="Raw trajectory: Co-citations (original and replication)" spec={built.cocitSpec} note={<Note id="plot-cocit-sample">{built.cocit.note}</Note>} />
                <Note id="plot-cocit-denominator">{tableN != null && <>The co-citation rate table below covers <strong><i>N</i> = {number(tableN)}</strong> originals (≥ 1 {group}; ≥ 1 citation since the first {group}), a wider set than the plotted panel above.</>}</Note>
            </div>
        </div>
    );
}

function BreakdownTable({title, dim = {}, labels}) {
    const rate = v => v == null ? '—' : percent(v, 1, 1) + '%';
    return (
        <div className="cocit-breakdown-table" tabIndex={0} role="region" aria-label={title}>
            <h3>{title}</h3>
            <table>
                <thead><tr><th>Group</th><th>N originals</th><th>Per-paper mean</th><th>Median</th><th>Weighted mean</th></tr></thead>
                <tbody>{Object.entries(labels).map(([key, label]) => {
                    const d = dim[key] || {};
                    return <tr key={key}><td>{label}</td><td>{d.n_originals != null ? number(d.n_originals) : '—'}</td><td>{rate(d.mean_rate)}</td><td>{rate(d.median_rate)}</td><td>{rate(d.grand_mean_rate)}</td></tr>;
                })}</tbody>
            </table>
        </div>
    );
}

const MIX_ORDER = ['successful', 'failed', 'mixed'];
function OutcomeMixBar({mix, total}) {
    if (!mix || !total) return '—';
    const parts = MIX_ORDER.filter(o => mix[o]).map(o => `${number(mix[o])} ${FloraVocabulary.label(o)}`).join(', ');
    return (
        <div className="rep-bar-wrap" role="img" aria-label={`${parts}; ${number(total)} reference pairs`} title={parts}>
            <div className="rep-bar">{MIX_ORDER.filter(o => mix[o]).map(o => <div key={o} className={`rep-seg ${o}`} style={{width: (mix[o] / total * 100).toFixed(1) + '%'}} title={`${number(mix[o])} ${FloraVocabulary.label(o)}`} />)}</div>
            <span className="rep-count">{number(total)}</span>
        </div>
    );
}
function CocitCell({s}) {
    if (!s.n_cocitations && s.n_cocitations !== 0) return '—';
    const denom = s.n_citations_post_first_rep;
    const title = denom ? `${number(s.n_cocitations)} of ${number(denom)} citations since the first replication (${s.first_replication_year}) also cite a replication` : `${number(s.n_cocitations)} co-citations`;
    return <span title={title}>{number(s.n_cocitations)}<span className="cocit-pct"> ({denom > 0 ? `${percent(s.cocit_prop, 1)}% of ${number(denom)}` : '—'})</span></span>;
}

// The single outcome shared by all of an original's replications, or 'multiple'.
const outcomeGroup = s => {
    const outcomes = Object.keys(s.outcome_mix || {}).filter(k => s.outcome_mix[k]);
    return outcomes.length === 1 ? outcomes[0] : outcomes.length ? 'multiple' : null;
};

function OriginalsTable({index, excluded, onOpen, status}) {
    const {view, setView} = useView();
    const [input, setInput] = useState(view.ciQ);
    const [sort, setSort] = useState({col: 'n_citations', dir: 'desc'});
    const [page, setPage] = useState(1);
    const debounce = useRef();
    const inputRef = useRef(null);
    const pagination = useRef(null);
    const refocus = useRef(false);
    useEffect(() => { setInput(view.ciQ); }, [view.ciQ]);
    const query = view.ciQ, filter = view.filterOutcome;

    const matches = useMemo(() => {
        const tokens = searchTokens(query);
        const out = index.filter(s => matchesTokens(s.searchText, tokens) && (!filter || outcomeGroup(s) === filter));
        const value = s => s[sort.col] != null ? s[sort.col] : -Infinity;
        return out.sort((a, b) => sort.dir === 'asc' ? value(a) - value(b) : value(b) - value(a));
    }, [index, query, filter, sort]);
    // A search with no results may name an original that this snapshot left out.
    const leftOut = useMemo(() => query.trim() && !matches.length ? excluded.filter(e => matchesTokens(e.searchText, searchTokens(query))) : [], [excluded, query, matches.length]);
    const emptyMessage = !query.trim() ? 'No originals match the current outcome selection.'
        : !leftOut.length ? `No originals match “${query.trim()}” with the current outcome selection.`
        : leftOut.length === 1 ? `${excludedOriginalLabel(leftOut[0])} is in FLoRA but not in this citation snapshot: ${exclusionReason(leftOut[0].reason)}. It is left out, not counted as zero, and will be retried next refresh.`
        : `${leftOut.length} originals matching “${query.trim()}” are in FLoRA but not in this citation snapshot. They are left out, not counted as zero, and will be retried next refresh.`;
    const pages = Math.max(1, Math.ceil(matches.length / PER_PAGE));
    const current = page > pages ? 1 : page;
    const slice = matches.slice((current - 1) * PER_PAGE, current * PER_PAGE);

    const search = text => { clearTimeout(debounce.current); setInput(text); debounce.current = setTimeout(() => { setPage(1); setView({ciQ: text}); }, 200); };
    const sortBy = col => { setSort(prev => ({col, dir: prev.col === col && prev.dir === 'desc' ? 'asc' : 'desc'})); setPage(1); };
    const ariaSort = col => sort.col === col ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined;
    const goTo = p => { refocus.current = true; setPage(p); };
    // A Previous/Next button that disappears at the ends hands focus to the current page.
    useLayoutEffect(() => {
        if (!refocus.current) return;
        refocus.current = false;
        if (!pagination.current?.contains(document.activeElement)) pagination.current?.querySelector('[aria-current]')?.focus({preventScroll: true});
    }, [current]);

    const first = Math.max(1, current - 2), lastPage = Math.min(pages, first + 4);
    const sortButton = (col, label, extra = '') => <th className={'sortable' + (sort.col === col ? ` sort-${sort.dir}` : '') + (extra ? ' ' + extra : '')} data-sort={col} scope="col" aria-sort={ariaSort(col)}><button type="button" className="table-sort" data-sort={col} onClick={() => sortBy(col)}>{label}</button></th>;
    const cocitSort = ['n_cocitations', 'cocit_prop'].includes(sort.col);
    return (
        <>
            <label htmlFor="search-input" className="search-label">Search originals</label>
            <div className="search-row">
                <input id="search-input" ref={inputRef} type="search" placeholder="Title, author, year, journal, DOI or DOI URL" value={input} onChange={e => search(e.target.value)} />
                <select id="filter-outcome" aria-label="Filter originals by the outcomes of all their replications" value={filter} onChange={e => { setPage(1); setView({filterOutcome: e.target.value}); }}>
                    <option value="">All outcomes</option>
                    <option value="successful">Only successful replications</option>
                    <option value="failed">Only failed replications</option>
                    <option value="mixed">Only mixed replications</option>
                    <option value="multiple">Multiple replication outcomes</option>
                </select>
            </div>
            <Callout tone="empty" id="ci-search-empty" role="status" hidden={matches.length > 0 || status !== 'ready'}>
                <p id="ci-search-empty-message">{emptyMessage}</p>
                <ul id="ci-search-excluded" className="excluded-list" hidden={!leftOut.length}><ExcludedRows list={leftOut.slice(0, 5)} /></ul>
                <Button id="ci-clear-search" hidden={!query.trim()} onClick={() => { clearTimeout(debounce.current); setInput(''); setPage(1); setView({ciQ: ''}); inputRef.current.focus(); }}>Clear search</Button>
            </Callout>
            {/* A key for the replication bars; each bar also names its counts to screen readers and on hover. */}
            <div className="rep-key" aria-hidden="true"><span>Replications bar:</span>{MIX_ORDER.map(o => <span key={o}><i className={o} />{FloraVocabulary.label(o)}</span>)}</div>
            <TableScroll label="Originals with citation data">
                <table id="originals-table" tabIndex={-1} className="table" data-query={status === 'ready' ? query : undefined}>
                    <thead>
                        <tr>
                            <th scope="col">Original</th>
                            {sortButton('year', 'Year', 'num')}
                            {sortButton('n_replications', 'Replications')}
                            {sortButton('n_citations', 'Citations, all years', 'num')}
                            <th className="cocit-th num" scope="col" aria-sort={cocitSort ? ariaSort(sort.col) : undefined}>Co-citations since first recorded replication <span className="cocit-sort-toggle" role="group" aria-label="Sort co-citations by">
                                <button type="button" className={'cocit-sort-btn' + (sort.col === 'n_cocitations' ? ` sort-${sort.dir}` : '')} data-sort="n_cocitations" title="Sort by co-citation count" aria-label="Sort by co-citation count" aria-pressed={sort.col === 'n_cocitations'} onClick={() => sortBy('n_cocitations')}>Count</button>
                                <button type="button" className={'cocit-sort-btn' + (sort.col === 'cocit_prop' ? ` sort-${sort.dir}` : '')} data-sort="cocit_prop" title="Sort by co-citation share" aria-label="Sort by co-citation percentage" aria-pressed={sort.col === 'cocit_prop'} onClick={() => sortBy('cocit_prop')}>Share</button>
                            </span></th>
                        </tr>
                    </thead>
                    <tbody>
                        {status !== 'ready' && <tr><td colSpan={5} className="table-empty">{status === 'error' ? 'No data yet.' : 'Loading…'}</td></tr>}
                        {slice.map(s => (
                            <tr key={s.doi} data-doi={s.doi} onClick={() => onOpen(s.doi)}>
                                {/* The timeline action sits with the title it opens, so it stays in view on narrow screens. */}
                                <td className="orig-cell"><div className="title-cell">{s.title || '(untitled)'}</div><div className="author-cell">{citationAuthors(s.author)}{venueText(s.venue)}</div>
                                    <button type="button" className="btn timeline-open" aria-label={`Open citation timeline for ${s.title || s.doi}`}><Icon.chart />Timeline</button></td>
                                {/* data-label names each value when phones lay the row out as a card. */}
                                <td className="num" data-label="Year">{s.year || '—'}</td>
                                <td data-label="Replications"><OutcomeMixBar mix={s.outcome_mix} total={s.n_replications} /></td>
                                <td className="num" data-label="Citations">{number(s.n_citations || 0)}</td>
                                <td className="num" data-label="Co-citations"><CocitCell s={s} /></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </TableScroll>
            {/* The same count line and Previous / Next wording as the Browse table. */}
            <div className="table-footer">
                <div className="table-info" id="originals-info" role="status">{status === 'ready' && matches.length > 0 && `Showing ${number((current - 1) * PER_PAGE + 1)} to ${number(Math.min(matches.length, current * PER_PAGE))} of ${number(matches.length)} originals`}</div>
                <nav className="pagination" id="pagination" aria-label="Pagination" ref={pagination}>
                    {matches.length > 0 && pages > 1 && <>
                        {current > 1 && <button type="button" key="previous" data-action="previous" data-p={current - 1} aria-label="Previous page" onClick={() => goTo(current - 1)}><Icon.prev /> Previous</button>}
                        {first > 1 && <><button type="button" key="first" data-p={1} aria-label="Page 1" onClick={() => goTo(1)}>1</button>{first > 2 && <span className="pagination-gap">…</span>}</>}
                        {Array.from({length: lastPage - first + 1}, (_, i) => first + i).map(p => (
                            <button type="button" key={p} data-p={p} aria-current={p === current ? 'page' : undefined} className={p === current ? 'active' : undefined} aria-label={`Page ${p}`} onClick={() => goTo(p)}>{p}</button>
                        ))}
                        {lastPage < pages && <>{lastPage < pages - 1 && <span className="pagination-gap">…</span>}<button type="button" key="last" data-p={pages} aria-label={`Page ${pages}`} onClick={() => goTo(pages)}>{pages}</button></>}
                        {current < pages && <button type="button" key="next" data-action="next" data-p={current + 1} aria-label="Next page" onClick={() => goTo(current + 1)}>Next <Icon.next /></button>}
                    </>}
                </nav>
            </div>
        </>
    );
}

// Sorted copy for display; stored order still defines ties in the aggregate model.
const chronological = s => [...(s.replications || [])].sort((a, b) => (Number(a.year) || Infinity) - (Number(b.year) || Infinity));

// A hex colour at the given opacity; other colour forms pass through unchanged.
const withAlpha = (color, alpha) => {
    const hex = /^#([0-9a-f]{6})$/i.exec(String(color).trim());
    return hex ? `rgba(${[0, 2, 4].map(i => parseInt(hex[1].slice(i, i + 2), 16)).join(',')},${alpha})` : color;
};
// Bars shade from full colour at the top to a lighter foot, so tall columns read as shapes rather than slabs.
const barFill = color => ({type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{offset: 0, color: withAlpha(color, 1)}, {offset: 1, color: withAlpha(color, .62)}]});

// Replication markers: a numbered circle above the plot for each dated replication, in its outcome colour,
// matching the numbered list under the chart. Same-year or adjacent events go in separate lanes so circles never overlap.
function replicationMarks(s, years, width) {
    const lanes = [], scale = textScale();
    const first = years[0], span = years.length, usable = width - 70;
    return chronological(s).map((r, i) => [r, i]).filter(([r]) => r.year).map(([r, i]) => {
        const label = String(i + 1);
        const x = (r.year - first + .5) * usable / span, half = (label.length * 3.5 + 9) * scale;
        let lane = lanes.findIndex(end => end + 4 < x - half);
        if (lane < 0) lane = lanes.length;
        lanes[lane] = x + half;
        return {year: r.year, index: i + 1, outcome: r.outcome, label, lane, color: r.outcome ? outcomeColor(r.outcome) || token('--color-primary') : token('--color-primary')};
    });
}

function timelineSpec(s, meta) {
    const t = chartTheme(), tl = s.timeline || [];
    if (!tl.length) return {message: 'No citation data available'};
    const recorded = tl.map(p => p.year);
    // One column per year from the first citing year or replication to the last, gaps included.
    const repYears = (s.replications || []).map(r => Number(r.year)).filter(Boolean);
    const lo = Math.min(...recorded, ...repYears), hi = Math.max(...recorded, ...repYears);
    const years = Array.from({length: hi - lo + 1}, (_, i) => lo + i);
    const byYear = new Map(tl.map(p => [p.year, p]));
    // The coverage year stays partial even if this snapshot is viewed in a later year.
    const partialYear = Number((meta?.last_updated || '').slice(0, 4)) || new Date().getFullYear();
    // Plain citations are the neutral baseline; co-citations take the outcome colour of the replication they cite,
    // and works citing replications with different outcomes take the "multiple outcomes" colour.
    const kinds = [['only', 'Cites original only', token('--color-chart-neutral')], ['with_failed', 'Also cites Failed replication', outcomeColor('failed')], ['with_mixed', 'Also cites Mixed replication', outcomeColor('mixed')],
        ['with_successful', 'Also cites Successful replication', outcomeColor('successful')], ['with_multiple', 'Also cites replications with multiple outcomes', token('--color-chart-qualified')]];
    const series = kinds.map(([key, name, color]) => ({name, color, values: years.map(year => byYear.get(year)?.[key] || 0)}));
    const plotted = series.reduce((n, x) => n + x.values.reduce((a, v) => a + v, 0), 0);
    const coverage = coverageText(plotted, s.n_citations || 0, [[(s.n_citations || 0) - plotted, 'without a recorded citing year']], 'citing works of this original');
    const table = pointTable(kinds.map(([key, name]) => ({name, x: recorded, y: tl.map(p => p[key] || 0)})), 'Citing works');
    const corners = stackCorners(series.map(x => x.values), false, 4);
    // A wide, flat ratio suits a year-by-year timeline and keeps the replication list close below it.
    return {coverage, table, aspect: .3, option: ({width}) => {
        const scale = textScale();
        const marks = replicationMarks(s, years, width);
        const lanes = Math.max(0, ...marks.map(m => m.lane + 1));
        const partial = years.includes(partialYear);
        // The partial coverage year is faded and hatched, so it reads as incomplete at a glance.
        const hatch = {symbol: 'rect', symbolSize: 1, dashArrayX: [1, 0], dashArrayY: [2, 3], rotation: Math.PI / 4, color: withAlpha(t.paper, .55)};
        const bars = series.map((x, si) => ({
            name: x.name, type: 'bar', stack: 'year', barMaxWidth: 30, barCategoryGap: '22%', emphasis: {focus: 'series'},
            // Co-citations are often a sliver of a year's citations; a minimum height keeps every non-zero one visible.
            ...(si ? {barMinHeight: 3} : {}),
            itemStyle: {color: barFill(x.color), borderColor: t.paper, borderWidth: 1},
            data: x.values.map((v, i) => ({value: v, itemStyle: {borderRadius: corners(si, i), opacity: years[i] === partialYear ? 0.45 : 1, ...(years[i] === partialYear ? {decal: hatch} : {})}})),
        }));
        // Light dotted rules mark each replication behind the bars; the numbered circle carries the outcome colour.
        bars[0].markLine = {silent: true, symbol: 'none', z: 1, data: marks.map(m => ({xAxis: String(m.year), name: m.label,
            lineStyle: {color: m.color, width: 1, type: [2, 3], opacity: .7},
            label: {position: 'end', formatter: m.label, color: labelColor(m.color), backgroundColor: m.color, fontSize: 11, fontWeight: 700,
                width: 12, align: 'center', padding: [3, 4], borderRadius: 10, distance: (5 + m.lane * 22) * scale}}))};
        // The partial-year note gets its own line above the legend, which can wrap to any width.
        const ownLine = partial;
        // The hover names the year and its total, then only the categories that year has, and any replication published in it.
        const tooltip = {formatter: ps => {
            const i = ps[0].dataIndex, total = ps.reduce((n, p) => n + (Number(p.value) || 0), 0);
            const events = marks.filter(m => m.year === years[i]).map(m => tipRow(m.color, `Replication ${m.index} published (${FloraVocabulary.label(m.outcome)})`));
            return tipLines([`<strong>${years[i]}</strong> · ${number(total)} citing works${years[i] === partialYear ? ' (partial year)' : ''}`,
                ...ps.filter(p => p.value > 0).map(p => tipRow(series[p.seriesIndex].color, `${p.seriesName}: ${number(p.value)}`)), ...events]);
        }};
        return finishOption({series: bars, tooltip, legend: {top: ownLine ? 18 * scale : 0},
            graphic: partial ? [{type: 'text', right: 12, top: 0, silent: true, style: {text: `${partialYear}: partial year`, fill: t.muted, fontSize: 11, fontStyle: 'italic', fontFamily: t.fontFamily}}] : [],
            xAxis: categoryAxis({name: 'Year', data: years.map(String), axisLabel: {hideOverlap: true}, axisLine: {show: true, lineStyle: {color: t.grid}}}),
            yAxis: valueAxis({name: 'Citing works', ...countAxis(), splitLine: {lineStyle: {color: t.grid, type: [3, 4]}}}),
        }, {width, top: 12 + lanes * 22 + (ownLine ? 18 : 0)});
    }};
}

function StudyHeader({entry}) {
    return <>
        <h2>{entry.title || '(untitled)'}</h2>
        <p className="note">{citationAuthors(entry.author)} · {entry.year || '?'}{venueText(entry.venue)}<br /><a href={`https://doi.org/${entry.doi}`} target="_blank" rel="noreferrer">{entry.doi}</a></p>
    </>;
}

// First author's family name, with "et al." when there are more.
const leadAuthor = author => {
    const names = String(author || '').split(';').map(a => a.trim()).filter(Boolean);
    return names.length ? names[0].split(',')[0] + (names.length > 1 ? ' et al.' : '') : 'Unknown author';
};

// The chart's numbered markers, spelled out beside it: one chip per replication, in the list's order.
// A chip jumps to that replication's full entry below the chart and briefly highlights it.
function ReplicationChips({reps}) {
    const jump = n => {
        const item = document.getElementById(`rep-${n}`);
        if (!item) return;
        item.scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center'});
        item.focus({preventScroll: true});
        item.classList.remove('is-target'); void item.offsetWidth; item.classList.add('is-target');
    };
    return (
        <div id="study-plot-key" className="rep-chips">
            <span className="rep-chips-label">Replications{reps.some(r => !r.year) ? ' (undated ones have no marker)' : ''}:</span>
            {reps.map((r, i) => (
                <button type="button" key={i} className="rep-chip" onClick={() => jump(i + 1)}
                    aria-label={`Replication ${i + 1}: ${FloraVocabulary.label(r.outcome)}, ${leadAuthor(r.author)} ${r.year || 'undated'}. Show details below.`}>
                    <span className="rep-marker" style={{color: r.outcome ? `var(--color-chart-${r.outcome})` : 'inherit'}} aria-hidden="true">{i + 1}</span>
                    <span>{FloraVocabulary.label(r.outcome)} · {leadAuthor(r.author)} {r.year || '(undated)'}</span>
                </button>
            ))}
        </div>
    );
}

function Timeline({study, meta}) {
    const {theme} = useEnv();
    const {linkFor} = useView();
    const [copied, setCopied] = useState(false);
    const spec = useMemo(() => timelineSpec(study, meta), [study, meta, theme]);
    const link = linkFor({tab: 'citation-tab', doi: study.doi});
    const share = () => navigator.clipboard.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => window.prompt('Copy this link:', link));
    const many = study.cocit_conflated > 1;
    const reps = chronological(study);
    return (
        <div className="modal-body">
            <StudyHeader entry={study} />
            {study.cocit_conflated ? <Callout tone="caution">Co-citation can't be measured for {many ? 'some replications of ' : ''}this study: OpenCitations groups the original and {many ? 'those replications' : 'its replication'} under one record, so citations of the two can't be told apart. The timeline below counts all of them as citations of the original.</Callout> : null}
            {/* The dialog is titled "Citation timeline", so the figure names what is plotted; its actions share the chart or copy its data. */}
            <div className="study-plot-wrap"><Plot id="study-plot" title="Citation timeline" heading="Citations per year" spec={spec} height={400} note={<ReplicationChips reps={reps} />}
                actions={<>
                    <button type="button" className="btn ci-share-btn" data-doi={study.doi} onClick={share} aria-label={copied ? 'Link copied' : 'Copy link to this chart'}>
                        {copied ? <Icon.check /> : <Icon.link />}<span>{copied ? 'Link copied' : 'Copy link'}</span>
                    </button>
                    <span className="visually-hidden" role="status">{copied ? 'Link to this chart copied' : ''}</span>
                </>} /></div>
            <h3>Replications ({number(study.n_replications)})</h3>
            <ul className="rep-list">
                {reps.map((r, i) => (
                    <li key={i} id={`rep-${i + 1}`} tabIndex={-1}>
                        <span className="rep-marker" role="img" style={{color: r.outcome ? `var(--color-chart-${r.outcome})` : 'inherit'}} aria-label={`Marker ${i + 1}`}>{i + 1}</span>{' '}
                        <span className={`outcome-badge ${r.outcome}`}>{FloraVocabulary.label(r.outcome)}</span>{' '}
                        <strong>{citationAuthors(r.author, 2)} ({r.year || '?'})</strong>{r.title ? ' — ' + r.title : ''}
                        {r.doi && <><br /><a href={`https://doi.org/${r.doi}`} target="_blank" rel="noreferrer" className="small">{r.doi}</a></>}
                    </li>
                ))}
            </ul>
        </div>
    );
}

const studyCache = new Map();
const DIALOG_CONTEXT = {active: true, visited: true, selection: '', kind: ''};

// The timeline dialog: traps focus, closes on Escape or backdrop click, and returns focus to its opener.
function TimelineDialog({entry, meta, onClose}) {
    const {stamps} = useData();
    const [state, setState] = useState({});
    const modal = useRef(null);
    const closeButton = useRef(null);
    useEffect(() => {
        let cancelled = false;
        setState({});
        (async () => {
            try {
                if (!studyCache.has(entry.doi)) {
                    const res = await fetch(URLS.originals + encodeURIComponent(entry.file));
                    if (!res.ok) throw new Error('HTTP ' + res.status);
                    studyCache.set(entry.doi, await res.json());
                }
                if (!cancelled) setState({study: studyCache.get(entry.doi)});
            } catch (e) {
                console.error('Citation timeline load failed:', e);
                if (!cancelled) setState({failed: true});
            }
        })();
        return () => { cancelled = true; };
    }, [entry]);
    useEffect(() => {
        const opener = document.activeElement;
        const background = document.querySelectorAll('.top-bar, main, .footer-bar');
        background.forEach(el => { el.inert = true; });
        closeButton.current.focus();
        const onKey = e => {
            if (e.key === 'Escape') { onClose(); return; }
            if (e.key !== 'Tab') return;
            const items = [...modal.current.querySelectorAll('button, a[href], input, select, summary, [tabindex="0"]')].filter(el => el.getClientRects().length);
            const firstItem = items[0], lastItem = items[items.length - 1], inside = modal.current.contains(document.activeElement);
            if (e.shiftKey && (document.activeElement === firstItem || !inside)) { e.preventDefault(); lastItem?.focus(); }
            else if (!e.shiftKey && (document.activeElement === lastItem || !inside)) { e.preventDefault(); firstItem?.focus(); }
        };
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('keydown', onKey);
            background.forEach(el => { el.inert = false; });
            // After back/forward the destination pane takes focus instead of a control in a hidden pane.
            if (opener?.isConnected && opener.getClientRects().length) opener.focus();
            else document.querySelector('.tab-pane.active')?.focus({preventScroll: true});
        };
    }, []);
    const context = useMemo(() => ({...DIALOG_CONTEXT, stamps: stamps ? stampInfo('citations', stamps.citations).text : ''}), [stamps]);
    return (
        <div className="modal-backdrop" id="ci-modal" ref={modal} role="dialog" aria-modal="true" aria-label="Citation timeline and replication evidence" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="modal-card">
                <div className="modal-toolbar"><span>Citation timeline</span><button className="modal-close" id="ci-modal-close" ref={closeButton} type="button" aria-label="Close citation timeline" onClick={onClose}><Icon.close /></button></div>
                <div id="ci-modal-body">
                    <PaneContext.Provider value={context}>
                        {state.study ? <Timeline study={state.study} meta={meta} />
                            : <div className="modal-body"><StudyHeader entry={entry} /><p className="note modal-wait">{state.failed ? 'Could not load the citation timeline for this study.' : 'Loading citation timeline…'}</p></div>}
                    </PaneContext.Provider>
                </div>
            </div>
        </div>
    );
}

export function CitationDialog({data}) {
    const {view, setView} = useView();
    const entry = useMemo(() => {
        const target = normalizeDoi(view.doi);
        return target && data.index ? data.index.find(s => normalizeDoi(s.doi) === target) : null;
    }, [view.doi, data.index]);
    // The hidden shell keeps #ci-modal addressable while no timeline is open.
    if (!entry || view.tab !== 'citation-tab') return <div className="modal-backdrop" id="ci-modal" role="dialog" aria-modal="true" aria-label="Citation timeline and replication evidence" hidden />;
    return <TimelineDialog entry={entry} meta={data.meta} onClose={() => setView({doi: ''})} />;
}

export function useCitations() {
    const {view} = useView();
    const {rows} = useData();
    const [wanted, setWanted] = useState(false);
    useEffect(() => { if (view.tab === 'citation-tab' || view.doi) setWanted(true); }, [view.tab, view.doi]);
    const data = useCitationData(wanted);
    // The snapshot's display names stop after six authors; the loaded pairs keep every name.
    const index = useMemo(() => {
        if (!data.index) return null;
        const authors = new Map();
        for (const row of rows) {
            const doi = normalizeDoi(row.doi_o), names = searchAuthorNames(row.author_o);
            if (!doi || !names) continue;
            if (!authors.has(doi)) authors.set(doi, new Set());
            authors.get(doi).add(names);
        }
        const searchText = s => normalizedQuery([s.title, searchAuthorNames(s.author), ...(authors.get(normalizeDoi(s.doi)) || []), s.year, s.venue, s.doi].filter(Boolean).join(' | '));
        return {
            // Share of citations since the first replication: earlier citing works could never have co-cited one.
            index: data.index.map(s => ({...s, cocit_prop: s.n_citations_post_first_rep > 0 ? s.n_cocitations / s.n_citations_post_first_rep : 0, searchText: searchText(s)})),
            excluded: (Array.isArray(data.meta?.excluded_originals) ? data.meta.excluded_originals : []).map(e => ({...e, searchText: searchText(e)})),
        };
    }, [data.index, data.meta, rows]);
    return useMemo(() => ({...data, index: index?.index ?? null, excluded: index?.excluded ?? []}), [data, index]);
}

export default function CitationImpact({data}) {
    const {view, setView, pushEntry} = useView();
    const kind = view.ciKind, outcome = view.ciOutcome;
    const ready = data.status === 'ready';
    const counts = data.meta?.outcome_counts || {};
    const kpi = n => n == null ? '—' : number(n);
    const repro = data.repro?.[kind];
    const buckets = ready && kind !== 'replication' ? outcomeBuckets(kind) : [];
    const reproTotal = buckets.reduce((sum, b) => sum + (repro?.[b.key]?.n_originals || 0), 0);
    const open = doi => { pushEntry(); setView({doi}); };
    const outcomeLabels = ready ? Object.fromEntries(MIX_ORDER.map(key => [key, FloraVocabulary.label(key)])) : {};

    return (
        <Pane id="citation-impact" tabId="citation-tab" sources={['citations']} selection={[kindLabel(kind), ...(kind === 'replication' ? [OUTCOME_OPTIONS.find(o => o[0] === outcome)[1]] : [])]} kind={kind}
            title={{heading: 'Citation Impact', lede: 'What happens to citations of an original study once a replication of it is published.'}}>
            <div className="pane-meta">
                <DataStamp source="citations" />
                <CiteBlock>
                    <p className="reuse-text">This is a simplified preview of the methods pre-registered for our ongoing confirmatory study:</p>
                    <div className="cite-ref">Weinerova, J., Wallrich, L., Röseler, L., Feuerriegel, S., &amp; Azevedo, F. (2026, April 30). (When) Do Replications Influence the Impact of Original Claims? A Bibliometric Investigation. <ExternalLink href="https://doi.org/10.17605/OSF.IO/WJGM3">https://doi.org/10.17605/OSF.IO/WJGM3</ExternalLink></div>
                </CiteBlock>
            </div>
            <div className="ci-intro">
                <h2 className="ci-h2">{byKind(kind, ['Citation patterns around the first replication', 'Citation counts for numerical reproductions', 'Citation counts for robustness reproductions'])}</h2>
                <Chips id="ci-study-type" label="Citation Impact study type" value={kind} onChange={k => setView({ciKind: k})} />
                <Note>Numerical and robustness reproductions show descriptive citation counts. No reproduction event-study model is fitted.</Note>
                <p className="ci-lede">This tab combines the FLoRA dataset with citation data from <ExternalLink href="https://opencitations.net" className="">OpenCitations</ExternalLink> to {byKind(kind, ['describe citations to the original around the first recorded replication', 'count citations to originals and their numerical reproductions', 'count citations to originals and their robustness reproductions'])}, and how often the two are "co-cited" (cited together by the same later work).</p>
            </div>


            {ready && kind !== 'replication' && (reproTotal < REPRO_MIN_N
                ? <Placeholder id="ci-placeholder">Not enough reproductions with citation data yet (n={reproTotal}; need at least {REPRO_MIN_N}).</Placeholder>
                : <Section id="ci-repro-content" title="Reproduction citation counts" notes={<><DataStamp source="reproduction_citations" /><p>Per-original summaries by assessed dimension, so groups of different sizes can be compared. Citations are all-time counts; medians limit the pull of a few highly cited originals. The co-citation rate is each original's share of citations that also cite its reproduction, counted from the year of its first reproduction and averaged across originals. A report can appear in several outcome groups.</p></>}>
                    <Figure><TableScroll label="Reproduction citation counts"><table className="table" id="ci-repro-table">
                                <thead><tr><th scope="col"><span className="visually-hidden">Outcome</span></th><th className="num"><i>N</i> originals</th><th className="num">Median citations per original</th><th className="num">Mean citations per reproduction</th><th className="num">Mean co-citation rate</th></tr></thead>
                                <tbody>{buckets.map(b => { const r = repro[b.key] || {}; return <tr key={b.key}><td>{b.label}</td><td className="num">{number(r.n_originals || 0)}</td><td className="num">{r.median_citations_per_original == null ? '—' : number(r.median_citations_per_original, 1)}</td><td className="num">{r.mean_citations_per_reproduction == null ? '—' : number(r.mean_citations_per_reproduction, 2)}</td><td className="num">{r.mean_cocitation_rate == null ? '—' : percent(r.mean_cocitation_rate, 1, 1) + '%'}</td></tr>; })}</tbody>
                            </table></TableScroll></Figure>
                </Section>)}

            <div id="ci-content" style={kind === 'replication' ? undefined : {display: 'none'}}>
                <div className="stat-band kpi-row" id="kpis">
                    {data.status === 'error' && <LoadError className="kpi-note" id="ci-error" label="Could not load the citation data." reason={data.reason} onRetry={data.retry} />}
                    {!ready && data.status !== 'error' && <Callout tone="empty" className="kpi-note">Loading citation data…</Callout>}
                    {ready && <>
                    <div className="stat kpi"><div className="stat-value kpi-value">{kpi(data.meta?.n_originals)}</div><div className="stat-label kpi-label">Originals with complete citation data</div></div>
                    <div className="stat kpi"><div className="stat-value kpi-value">{kpi(data.meta?.n_replications)}</div><div className="stat-label kpi-label">Eligible replication reference pairs</div></div>
                    <div className="stat kpi"><div className="stat-value kpi-value">{kpi(counts.successful)}</div><div className="stat-label kpi-label">of which Successful</div></div>
                    <div className="stat kpi"><div className="stat-value kpi-value">{kpi(counts.failed)}</div><div className="stat-label kpi-label">of which Failed</div></div>
                    <Note className="kpi-note">{counts.mixed != null && <>The other {number(counts.mixed)} eligible pairs are Mixed. </>}Eligible pair counts are measured before citation lookup, so they include pairs whose originals lack complete citation data.</Note>
                    </>}
                </div>

                <Section title="Citation counts after replications are published" notes={<><p>There is no apparent association between a replication’s outcome and how often the original study is cited afterwards: original studies keep gaining citations after both failed and successful replications. However, citation counts increase in time and replication targets are usually not selected at random. Therefore, the before and after change visualised here is only descriptive, and cannot by itself be interpreted as an effect of replication.</p><div className="filters">
                            <span className="filter-label">Replication outcome</span>
                            <Chips id="outcome-chips" className="" heading="" label="Replication outcome" value={outcome} options={OUTCOME_OPTIONS} onChange={o => setView({ciOutcome: o})} />
                        </div></>}>
                        {ready && kind === 'replication' && <AggregatePlots data={data} outcome={outcome} />}
                </Section>

                <Section title="Co-citation rate by replication report size &amp; outcome" notes={<p>The co-citation rate is the share of an original's citations that also cite one of its replications, counted from the year of its first replication. Originals with multiple replications appear in every row that applies. Rates vary widely across originals, so three summaries are shown: <strong>per-paper mean</strong> (each original weighted equally), <strong>median</strong> (robust to outliers), and <strong>weighted mean</strong> (pooled co-citations ÷ pooled citations, effectively weighted by citation volume).</p>}>
                    <Figure>
                        <div className="cocit-breakdown-grid" id="cocit-breakdown">
                            {!ready ? null : data.breakdown ? <>
                                <BreakdownTable title="By replication report size" dim={data.breakdown.pub_status} labels={{individual: 'Up to 3 targets', large_project: 'Multiple-target report (>3 targets)'}} />
                                <BreakdownTable title="By outcome of the replication" dim={data.breakdown.outcome} labels={outcomeLabels} />
                            </> : <Note>Not available yet — this analysis is included from the next scheduled data refresh.</Note>}
                        </div>
                    </Figure>
                </Section>

                <Section wide title="Browse all originals" notes={<p>Choose Timeline to see a report’s citation timeline with replication events marked.</p>}>
                    <Figure>
                        <OriginalsTable index={data.index || EMPTY} excluded={data.excluded || EMPTY} onOpen={open} status={data.status} />
                    </Figure>
                </Section>

                <Section title="About this analysis">
                    <div className="prose">
                        <p>Data are refreshed weekly. The pipeline filters FLoRA to <strong>conceptual and direct replications</strong> with outcomes labelled <em>successful</em>, <em>failed</em>, or <em>mixed</em> (reproductions are excluded). For each included original and replication, we retrieve all citing works from OpenCitations COCI. A "co-citation" is any work that cites both the original and at least one of its replications.</p>
                        <p>The outcome filters group originals by the outcome of their earliest recorded replication year; same-year ties follow the stored record order. Later replications can have different outcomes. The table’s outcome filter instead groups originals by the outcomes of all their replications. Qualified success, descriptive-only, uninformative, and missing outcomes are excluded from the citation cohort.</p>
                        <p>Each timeline bar counts distinct citing works. Works that cite replications with more than one outcome appear once in the “multiple outcome categories” segment. The outcome-specific co-citation rate tables are overlapping summaries and should not be added.</p>
                        <p>The aggregate plots are descriptive: they show the mean yearly citation count of originals, aligned to the year of their first recorded replication. Each panel is a balanced panel, so the same originals contribute to every year shown: the citation panel uses originals observed from 5 years before to 5 years after the first replication, and the co-citation panel uses originals observed for 5 years after it. No regression model is fitted, and the plots do not estimate a causal effect of replication. The preregistered confirmatory analysis will use a <Gloss term="counterfactual estimator">The Fixed Effects Counterfactual estimator (FECT), the causal-inference method specified in our preregistered protocol. It is not used for the charts on this page.</Gloss>. See the <ExternalLink href="https://github.com/forrtproject/FReD-data" className="">FReD-data repository</ExternalLink> for the underlying FLoRA dataset.</p>
                    </div>
                </Section>
            </div>
        </Pane>
    );
}
