import {Fragment, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {flushSync} from 'react-dom';
import {useApp, PaneContext, stampText} from '../state/context.jsx';
import {filterByKind, classifyKind, BROWSE_KIND_LABELS, BROWSE_KIND_NOUNS, KIND_FILTER_BUTTONS} from '../lib/outcomes.js';
import {matchesBrowseQuery} from '../lib/search.js';
import {truncateText, shortAuthors, safeHref} from '../lib/format.js';
import {download, prefersReducedMotion} from '../lib/chartUtils.js';
import {setLive} from '../testHooks.js';
import {PAGE_LENGTHS} from '../state/url.js';
import {OutcomeChartRow} from '../components/OutcomeChartRow.jsx';
import {CiteBlock, DataStamp, DatasetCitation, KindFilter, OutcomeBadge, REUSE_TEXT, WebsiteCitation} from '../components/Common.jsx';
import {DetailRow, DoiLink, UrlOrDoi} from '../components/Links.jsx';

const MOBILE_PAGE_SIZE = 20;
const SORT_FIELDS = {1: 'title_o', 2: 'year_o', 3: 'title_r', 4: 'year_r', 5: 'outcome', 6: 'type', 7: 'doi_o', 8: 'doi_r'};
const collator = new Intl.Collator(undefined, {numeric: true});
const DIMENSIONS = {replication: 'replicability', 'reproduction-numerical': 'computational', 'reproduction-robustness': 'robustness'};
const MOBILE_SORTS = [['4:desc', 'Newest repetition first'], ['4:asc', 'Oldest repetition first'], ['2:desc', 'Newest original first'], ['2:asc', 'Oldest original first'], ['1:asc', 'Original title, A–Z']];
const COLUMNS = [null, 'Original Study', 'Year', 'study', 'Year', 'Outcome', 'Type', 'Original DOI', 'report'];
const COL_WIDTHS = ['3%', '22%', '5%', '22%', '5%', '9%', '8%', '13%', '13%'];

const reportKindHeading = kind => kind === 'all' ? 'Replication or reproduction' : kind === 'replication' ? 'Replication' : 'Reproduction';

export default function Browse({active}) {
    const {rows, ready, view, updateBrowse, stamps} = useApp();
    const {q, kind, sort, page, pageLength, mobilePage} = view.browse;
    const inputRef = useRef(null);
    const headingRef = useRef(null);
    const [feedback, setFeedback] = useState('');
    const [expanded, setExpanded] = useState(() => new Set());

    const rowIndex = useMemo(() => new Map(rows.map((r, i) => [r, i])), [rows]);
    const filtered = useMemo(() => filterByKind(rows, kind).filter(r => matchesBrowseQuery(r, q)), [rows, kind, q]);
    const sorted = useMemo(() => {
        const field = SORT_FIELDS[sort[0]] || 'year_r';
        const dir = sort[1] === 'desc' ? -1 : 1;
        return [...filtered].sort((a, b) => collator.compare(String(a[field] || ''), String(b[field] || '')) * dir);
    }, [filtered, sort]);

    const pages = pageLength === -1 ? 1 : Math.max(1, Math.ceil(sorted.length / pageLength));
    const mobilePages = Math.max(1, Math.ceil(sorted.length / MOBILE_PAGE_SIZE));
    useEffect(() => {
        if (!ready) return;
        if (page > pages - 1) updateBrowse({page: pages - 1});
        if (mobilePage > mobilePages - 1) updateBrowse({mobilePage: mobilePages - 1});
    }, [ready, page, pages, mobilePage, mobilePages, updateBrowse]);
    const pageIndex = Math.min(page, pages - 1);
    const visible = useMemo(() => pageLength === -1 ? sorted : sorted.slice(pageIndex * pageLength, (pageIndex + 1) * pageLength), [sorted, pageIndex, pageLength]);

    // Search, kind and history changes keep the desktop page (clamped); the mobile list restarts.
    const applyQuery = useCallback(value => updateBrowse(b => b.q === value ? {} : {q: value, mobilePage: 0}), [updateBrowse]);
    const setKind = k => updateBrowse(b => b.kind === k ? {} : {kind: k, mobilePage: 0});
    const setSort = s => updateBrowse({sort: s, page: 0, mobilePage: 0});

    // A native listener also sees programmatic value changes followed by an input event.
    useEffect(() => {
        const input = inputRef.current;
        let timer;
        const onInput = () => { clearTimeout(timer); timer = setTimeout(() => applyQuery(input.value), 200); };
        input.addEventListener('input', onInput);
        return () => { input.removeEventListener('input', onInput); clearTimeout(timer); };
    }, [applyQuery]);
    useEffect(() => { if (inputRef.current.value !== q) inputRef.current.value = q; }, [q]);

    const live = useRef({});
    live.current = {filtered, q, kind, page: pageIndex, pageLength, sort, visible};
    const drawListeners = useRef(new Set());
    useEffect(() => {
        setLive('browseRows', () => live.current.filtered);
        setLive('browseTable', {
            page: () => live.current.page,
            setPage: n => updateBrowse(b => ({page: n === 'next' ? live.current.page + 1 : n === 'previous' ? Math.max(0, live.current.page - 1) : n})),
            pageLength: () => live.current.pageLength,
            setPageLength: n => updateBrowse({pageLength: n}),
            order: () => live.current.sort,
            renderedRowCount: () => live.current.visible.length,
            onDraw: fn => { drawListeners.current.add(fn); return () => drawListeners.current.delete(fn); },
        });
    }, [updateBrowse]);
    useEffect(() => { setLive('browseQuery', q); setLive('browseKind', kind); }, [q, kind]);
    useEffect(() => { drawListeners.current.forEach(fn => fn()); }, [visible]);

    const activeDimension = DIMENSIONS[kind];
    const n = filtered.length;
    const filteredView = q.trim() || kind !== 'all';

    const share = async () => {
        try { await navigator.clipboard.writeText(location.href); setFeedback('Link copied'); }
        catch { setFeedback('Copy the current address from your browser.'); }
    };
    const exportCsv = () => {
        const keys = Object.keys(rows[0] || {});
        download(filteredView ? 'flora-filtered-reference-pairs.csv' : 'flora-reference-pairs.csv', keys, filtered.map(row => keys.map(k => row[k])),
            `Unit: reference pair\n${stampText('flora', stamps.flora)}\nStudy kind: ${kind}\nQuery: ${q}\nIncluded: ${n.toLocaleString('en-GB')}; excluded by filters: ${(rows.length - n).toLocaleString('en-GB')}\nQualified success is separate from unqualified success; reproduction dimensions overlap.`);
    };
    const clearSearch = () => { inputRef.current.value = ''; applyQuery(''); inputRef.current.focus(); };
    const showMobilePage = delta => {
        flushSync(() => updateBrowse({mobilePage: mobilePage + delta}));
        headingRef.current.focus({preventScroll: true});
        headingRef.current.scrollIntoView({block: 'start', behavior: prefersReducedMotion() ? 'instant' : 'smooth'});
    };
    const toggleRow = row => setExpanded(s => { const next = new Set(s); next.has(row) ? next.delete(row) : next.add(row); return next; });

    const selectionLabel = KIND_FILTER_BUTTONS.find(b => b.kind === kind)?.label;
    const pane = useMemo(() => ({sources: ['flora'], selection: [selectionLabel]}), [selectionLabel]);
    const countText = kind === 'all' ? `${n.toLocaleString()} reference ${n === 1 ? 'pair' : 'pairs'}` : `${n.toLocaleString()} of ${rows.length.toLocaleString()} reference ${rows.length === 1 ? 'pair' : 'pairs'}`;
    const sortValue = sort.join(':');
    const mobileIndex = Math.min(mobilePage, mobilePages - 1);
    const mobileStart = mobileIndex * MOBILE_PAGE_SIZE, mobileEnd = Math.min(n, mobileStart + MOBILE_PAGE_SIZE);

    return <PaneContext.Provider value={pane}>
        <h1 className="visually-hidden">Browse Studies</h1>
        <DataStamp source="flora" />
        <div className="browse-filter-panel">
            <div className="browse-search"><label htmlFor="browse-mobile-input">Find a reference pair</label>
                <div className="browse-search-row">
                    <input ref={inputRef} type="search" id="browse-mobile-input" className="form-control" placeholder="Title, author, year, DOI or DOI URL" autoComplete="off" defaultValue={q} />
                    <button type="button" id="share-view" className="icon-action" aria-label="Copy current view link" title="Copy current view link" onClick={share}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></button>
                    <button type="button" id="export-browse" className="browse-download" onClick={exportCsv}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M4 17v3h16v-3"/></svg><span>{filteredView ? 'Download filtered CSV' : 'Download full CSV'}</span></button>
                </div>
                <span id="view-feedback" role="status">{feedback}</span>
            </div>
            <KindFilter className="browse-kind-filter" buttonClass="browse-kind-btn" value={kind} onChange={setKind} countId="browse-kind-count" count={countText} />
            <p id="browse-chart-hint" className="study-type-note" style={activeDimension ? {display: 'none'} : undefined}>Choose a study type to see its outcome breakdown.</p>
        </div>
        <BrowseEmpty n={n} q={q} kind={kind} onClearSearch={clearSearch} onAllKinds={() => setKind('all')} />

        <CiteBlock label={<>How to cite &amp; re-use guidelines</>}>
            <p className="reuse-text">{REUSE_TEXT}</p>
            <div className="cite-ref" id="citation-text-browse"><DatasetCitation /></div>
            <div className="cite-ref"><WebsiteCitation /></div>
        </CiteBlock>

        <div className="card" id="browse-outcome-card" style={activeDimension && n ? undefined : {display: 'none'}}>
            <h2 className="card-header">Outcome Breakdown</h2>
            <div className="card-body">
                <OutcomeChartRow rowId="browse-computational-row" canvasId="browse-computational-chart" captionId="browse-computational-caption" kind="computational"
                    data={filtered} eligible={n} titlePrefix="Browse results: " hidden={activeDimension !== 'computational'}
                    tip="Reflects the reproductions in the table below: were the original results obtained?" />
                <OutcomeChartRow rowId="browse-robustness-row" canvasId="browse-robustness-chart" captionId="browse-robustness-caption" kind="robustness"
                    data={filtered} eligible={n} titlePrefix="Browse results: " hidden={activeDimension !== 'robustness'}
                    tip="Reflects the reproductions in the table below: do results hold under alternative analysis choices?" />
                <OutcomeChartRow rowId="browse-replicability-row" canvasId="browse-outcome-chart" captionId="browse-outcome-caption" kind="replicability"
                    data={filtered} eligible={n} titlePrefix="Browse results: " hidden={activeDimension !== 'replicability'}
                    tip={<>Reflects the studies in the table below. Currently this breakdown covers <strong>replications only</strong>; reproductions are shown separately when their filter is selected.</>} />
            </div>
        </div>

        <div className="card">
            <h2 className="card-header" id="browse-results-heading" tabIndex={-1} ref={headingRef}>Studies Database</h2>
            <div className="card-body">
                <div className="browse-desktop">
                    <div className="dataTables_wrapper dt-bootstrap5">
                        <div className="row"><div className="col-sm-12 col-md-6"><div className="dataTables_length">
                            <label>Show <select className="form-select form-select-sm" aria-label="Reference pairs per page" value={pageLength}
                                onChange={e => { const len = Number(e.target.value); updateBrowse({pageLength: len, page: len === -1 ? 0 : Math.floor(pageIndex * pageLength / len)}); }}>
                                {PAGE_LENGTHS.map(len => <option key={len} value={len}>{len === -1 ? 'All' : len}</option>)}
                            </select> entries</label>
                        </div></div></div>
                        <table id="flora-table" className="table table-striped table-hover" style={{width: '100%'}}>
                            <thead>
                                <tr>{COLUMNS.map((label, col) => col === 0
                                    ? <th key={col} scope="col" style={{width: COL_WIDTHS[col]}}><span className="visually-hidden">Study evidence</span></th>
                                    : <SortHeader key={col} col={col} sort={sort} onSort={setSort} width={COL_WIDTHS[col]}>
                                        {col === 3 ? <><span data-browse-report-kind="">{reportKindHeading(kind)}</span> study</>
                                            : col === 8 ? <><span data-browse-report-kind="">{reportKindHeading(kind)}</span> report</> : label}
                                    </SortHeader>)}</tr>
                            </thead>
                            <tbody>
                                {visible.length === 0 && <tr><td colSpan={9} className="dataTables_empty">No matching reference pairs</td></tr>}
                                {visible.map((row, i) => <Fragment key={rowIndex.get(row)}>
                                    <tr className={expanded.has(row) ? 'shown' : undefined}>
                                        <td className="details-control"><button type="button" className="study-details" aria-label={'Show evidence for ' + (row.title_o || 'original report')} aria-expanded={expanded.has(row)} onClick={() => toggleRow(row)}></button></td>
                                        <td>{truncateText(row.title_o || row.author_o, 50)}</td>
                                        <td>{row.year_o || '-'}</td>
                                        <td>{truncateText(row.title_r || row.author_r, 50)}</td>
                                        <td>{row.year_r || '-'}</td>
                                        <td><OutcomeBadge outcome={row.outcome} /></td>
                                        <td className="type-cell">{truncateText(row.type, 15) || '-'}</td>
                                        <td className="link-cell"><DoiLink doi={row.doi_o} /></td>
                                        <td className="link-cell"><UrlOrDoi url={row.url_r} doi={row.doi_r} short /></td>
                                    </tr>
                                    {expanded.has(row) && <tr><td colSpan={9}><DetailRow row={row} /></td></tr>}
                                </Fragment>)}
                            </tbody>
                        </table>
                        <div className="row">
                            <div className="col-sm-12 col-md-5"><div className="dataTables_info" role="status" aria-live="polite">
                                {n ? `Showing ${(pageLength === -1 ? 1 : pageIndex * pageLength + 1).toLocaleString()} to ${(pageLength === -1 ? n : Math.min(n, (pageIndex + 1) * pageLength)).toLocaleString()} of ${n.toLocaleString()} entries` : 'Showing 0 to 0 of 0 entries'}
                            </div></div>
                            <div className="col-sm-12 col-md-7"><Pagination page={pageIndex} pages={pages} onPage={p => updateBrowse({page: p})} /></div>
                        </div>
                    </div>
                </div>

                <div className="browse-mobile">
                    <label className="bm-sort" htmlFor="bm-sort">Sort by <select id="bm-sort" className="form-select"
                        value={MOBILE_SORTS.some(([v]) => v === sortValue) ? sortValue : 'custom'}
                        onChange={e => { const [col, dir] = e.target.value.split(':'); if (dir) setSort([Number(col), dir]); }}>
                        {MOBILE_SORTS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                        <option value="custom" disabled hidden>Order set in desktop table</option>
                    </select></label>
                    <div id="browse-mobile-meta" className="browse-mobile-meta" role="status">
                        {n === 0 ? `${BROWSE_KIND_LABELS[kind]}: 0 reference pairs`
                            : <><span className="visually-hidden">{BROWSE_KIND_LABELS[kind]}: </span>Showing <strong>{(mobileStart + 1).toLocaleString('en-GB')}–{mobileEnd.toLocaleString('en-GB')}</strong> of <strong>{n.toLocaleString()}</strong> reference {n === 1 ? 'pair' : 'pairs'}</>}
                    </div>
                    <div id="browse-mobile-list" className="browse-mobile-list">
                        {n === 0 ? <div className="bm-empty">No matching reference pairs.</div>
                            : sorted.slice(mobileStart, mobileEnd).map((row, i) => <MobileCard key={rowIndex.get(row)} row={row} />)}
                    </div>
                    <div className="browse-mobile-pager" id="browse-mobile-pager" style={{display: n && mobilePages > 1 ? 'flex' : 'none'}}>
                        <button className="bm-page-btn" id="bm-prev" type="button" aria-label="Previous page" disabled={mobileIndex === 0} onClick={() => showMobilePage(-1)}>‹ Prev</button>
                        <span className="bm-page-info" id="bm-page-info" aria-current="page">{n ? `Page ${mobileIndex + 1} of ${mobilePages}` : ''}</span>
                        <button className="bm-page-btn" id="bm-next" type="button" aria-label="Next page" disabled={mobileIndex >= mobilePages - 1} onClick={() => showMobilePage(1)}>Next ›</button>
                    </div>
                </div>
            </div>
        </div>
    </PaneContext.Provider>;
}

function SortHeader({col, sort, onSort, width, children}) {
    const activeDir = sort[0] === col ? sort[1] : null;
    const next = activeDir === 'asc' ? 'desc' : 'asc';
    return <th scope="col" style={{width}} className={activeDir ? 'sorting sorting_' + activeDir : 'sorting'}
        aria-sort={activeDir ? (activeDir === 'asc' ? 'ascending' : 'descending') : undefined}>
        <button type="button" className="table-sort" onClick={() => onSort([col, next])}>{children}</button>
    </th>;
}

// DataTables "simple_numbers" paging: up to seven buttons with ellipses.
function pageNumbers(page, pages) {
    if (pages <= 7) return Array.from({length: pages}, (_, i) => i);
    if (page <= 3) return [0, 1, 2, 3, 4, '…', pages - 1];
    if (page >= pages - 4) return [0, '…', pages - 5, pages - 4, pages - 3, pages - 2, pages - 1];
    return [0, '…', page - 1, page, page + 1, '…', pages - 1];
}

function Pagination({page, pages, onPage}) {
    const item = (key, label, target, {disabled = false, current = false, ariaLabel} = {}) =>
        <li key={key} className={'page-item' + (disabled ? ' disabled' : '') + (current ? ' active' : '')}>
            <button type="button" className="page-link" disabled={disabled} aria-current={current ? 'page' : undefined} aria-label={ariaLabel} onClick={() => onPage(target)}>{label}</button>
        </li>;
    return <div className="dataTables_paginate paging_simple_numbers"><ul className="pagination">
        {item('prev', 'Previous', page - 1, {disabled: page === 0})}
        {pageNumbers(page, pages).map((p, i) => p === '…'
            ? <li key={'gap' + i} className="page-item disabled"><span className="page-link">…</span></li>
            : item(p, p + 1, p, {current: p === page, ariaLabel: `Page ${p + 1}`}))}
        {item('next', 'Next', page + 1, {disabled: page >= pages - 1})}
    </ul></div>;
}

function TitleLine({title, fallback, doi, url}) {
    const text = title || fallback || '—';
    const href = doi ? safeHref(String(doi).startsWith('http') ? doi : 'https://doi.org/' + encodeURI(doi)) : safeHref(url);
    return href ? <a href={href} target="_blank" rel="noopener">{text}</a> : text;
}

function MobileCard({row}) {
    const authorYear = (a, y) => [shortAuthors(a), y ? `(${y})` : ''].filter(Boolean).join(' ');
    const meta = (a, y, j) => [authorYear(a, y), j].filter(Boolean).join(' · ');
    const oMeta = meta(row.author_o, row.year_o, row.journal_o), rMeta = meta(row.author_r, row.year_r, row.journal_r);
    return <div className="bm-card">
        <div className="bm-row"><div className="bm-row-label">Original</div><div className="bm-row-title"><TitleLine title={row.title_o} fallback={shortAuthors(row.author_o)} doi={row.doi_o} /></div>{oMeta && <div className="bm-row-meta">{oMeta}</div>}</div>
        <div className="bm-divider"></div>
        <div className="bm-row"><div className="bm-row-label">{({replication: 'Replication', reproduction: 'Reproduction'})[classifyKind(row)] || 'Linked'}</div><div className="bm-row-title"><TitleLine title={row.title_r} fallback={shortAuthors(row.author_r)} doi={safeHref(row.url_r) ? null : row.doi_r} url={row.url_r} /></div>{rMeta && <div className="bm-row-meta">{rMeta}</div>}</div>
        <div className="bm-tags"><OutcomeBadge outcome={row.outcome} />{row.type && <span className="bm-tag-type">{row.type}</span>}</div>
        <details className="bm-evidence"><summary>Study evidence and outcome quotation</summary><DetailRow row={row} /></details>
    </div>;
}

// FLoRA is incomplete, so an empty selection is explained rather than shown as absence of evidence.
function BrowseEmpty({n, q, kind, onClearSearch, onAllKinds}) {
    const query = q.trim();
    const noun = BROWSE_KIND_NOUNS[kind] || BROWSE_KIND_NOUNS.all;
    const none = {'reproduction-numerical': 'No reference pairs have a recorded computational verdict', 'reproduction-robustness': 'No reference pairs have a recorded robustness verdict'}[kind] || `No ${noun} are recorded yet`;
    return <div id="browse-empty" className="browse-empty" role="status" hidden={n > 0}>
        {n === 0 && <>
            <p><strong>{query ? `No ${noun} match “${query}”` : none}.</strong> FLoRA is not comprehensive, so this does not show that a study has never been replicated or reproduced.</p>
            <div className="browse-empty-actions">
                {query && <button type="button" className="browse-download" data-browse-action="clear-search" onClick={onClearSearch}>Clear search</button>}
                {kind !== 'all' && <button type="button" className="browse-download" data-browse-action="all-kinds" onClick={onAllKinds}>Show all study types</button>}
                <a href="https://forrt.org/flora-replication-atlas/" target="_blank" rel="noopener noreferrer">Look up an original in the Replication Atlas</a>
                <a href="https://forrt.org/replication-hub/submit/" target="_blank" rel="noopener noreferrer">Submit a missing study</a>
            </div>
        </>}
    </div>;
}
