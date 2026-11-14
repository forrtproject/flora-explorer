import {Fragment, useEffect, useMemo, useRef, useState} from 'react';
import {BROWSE_KIND_LABELS, BROWSE_KIND_NOUNS, URLS} from '../lib/config.js';
import {download} from '../lib/charts.js';
import {cleanDoi, doiHref, fullAuthors, authorYear, pairHref, pairs, reportLinkText, safeHref, shortAuthors, truncate} from '../lib/format.js';
import {filterByKind, outcomeLabel, reportKindLabel, sourceOutcome} from '../lib/outcomes.js';
import {codingNoteBasis, isCodingNote, outcomeEvidenceParts, sourcePieces} from '../lib/evidence.js';
import {matchesBrowseQuery} from '../lib/search.js';
import {FloraVocabulary} from '../lib/vocabulary.js';
import {setHook, setMarkupHooks} from '../lib/hooks.js';
import {useData} from '../state/data.jsx';
import {useView} from '../state/view.jsx';
import {CiteBlock, DataStamp, ExternalLink, Icon, KindFilter, OutcomeBadge, Pane, WebsiteCitation, kindLabel, stampInfo} from '../components/common.jsx';
import {OutcomeChartRow} from '../components/OutcomeChartRow.jsx';
import {DatasetCitation, REUSE_TEXT} from './Overview.jsx';

const MOBILE_PAGE_SIZE = 20;
const PAGE_SIZES = [10, 25, 50, 100, -1];
const collator = new Intl.Collator(undefined, {numeric: true});
const SORT_FIELDS = {1: 'title_o', 2: 'year_o', 3: 'title_r', 4: 'year_r', 5: 'outcome', 6: 'type', 7: 'doi_o'};
const sortKey = column => column === 8 ? r => reportLinkText(r.url_r, r.doi_r) : column === 5 ? sourceOutcome : r => String(r[SORT_FIELDS[column] || 'year_r'] || '');
const MOBILE_SORTS = [['4:desc', 'Newest repetition first'], ['4:asc', 'Oldest repetition first'], ['2:desc', 'Newest original first'], ['2:asc', 'Oldest original first'], ['1:asc', 'Original title, A–Z']];
const DIMENSION_FOR_KIND = {replication: 'replicability', 'reproduction-numerical': 'computational', 'reproduction-robustness': 'robustness'};

function DoiLink({doi}) {
    if (!doi) return '-';
    const clean = cleanDoi(doi), href = doiHref(doi);
    return href ? <a href={href} target="_blank" rel="noopener noreferrer" className="doi-link" title={clean}>{clean}</a> : clean;
}
function ReportLink({url, doi, max}) {
    const href = safeHref(url);
    if (!href) return <DoiLink doi={doi} />;
    return <a href={href} target="_blank" rel="noopener noreferrer" className="doi-link" title={url}>{max ? truncate(url, max) : reportLinkText(url)}</a>;
}
export {ReportLink};

const LinkedSource = ({text}) => sourcePieces(text).map((piece, i) => i % 2 ? <a key={i} href={piece} target="_blank" rel="noopener noreferrer">{piece}</a> : piece);
// "coding note: <basis>" keeps its basis; a bare "coding note" records none.
function SourceNote({source}) {
    if (!isCodingNote(source)) return <>source: <LinkedSource text={source} /></>;
    const basis = codingNoteBasis(source);
    return basis ? <>coding note: <LinkedSource text={basis} /></> : 'coding note';
}
export function OutcomeEvidence({row}) {
    const {parts, unpaired} = outcomeEvidenceParts(row);
    if (!parts.length) return <p className="small">No outcome evidence is recorded for this pair.</p>;
    const sources = [...parts.map(p => p.source).filter(Boolean), ...unpaired];
    const allQuotes = parts.every(p => p.source) || (unpaired.length > 0 && !parts.some(p => p.source));
    return (
        <>
            <div className="detail-label">{allQuotes && !sources.some(isCodingNote) ? 'Outcome quote' : 'Outcome evidence'}:</div>
            <ul className="outcome-evidence">
                {parts.map((p, i) => <li key={i}>{p.label && <><span className="evidence-part-label">{p.label}:</span>{' '}</>}{p.text}{p.source && <> <span className="small">(<SourceNote source={p.source} />)</span></>}</li>)}
            </ul>
            {unpaired.length > 0 && <p className="small">Source: {unpaired.map((s, i) => <Fragment key={i}>{i > 0 && '; '}{isCodingNote(s) ? <SourceNote source={s} /> : <LinkedSource text={s} />}</Fragment>)}</p>}
        </>
    );
}
export function TitleCell({title, author, year}) {
    const text = title || shortAuthors(author) || '-', byline = authorYear(author, year);
    return <><span className="title-clamp" title={text}>{text}</span>{byline && <span className="title-byline">{byline}</span>}</>;
}

// Static markup of the evidence pieces, for the console and the acceptance tests.
setMarkupHooks({
    formatOutcomeEvidence: row => <OutcomeEvidence row={row} />,
    getOutcomeBadge: row => <OutcomeBadge row={row} />,
    tableTitleCell: (title, author, year) => <TitleCell title={title} author={author} year={year} />,
});

const Field = ({label, children}) => <div><span className="detail-label">{label}:</span> <span className="detail-value">{children}</span></div>;

export function Evidence({row}) {
    return (
        <div className="detail-row">
            <div className="detail-grid">
                <div className="detail-card">
                    <h6>Original report</h6>
                    <div className="detail-section">
                        <Field label="Title">{row.title_o || '-'}</Field>
                        <Field label="Authors">{fullAuthors(row.author_o)}</Field>
                        <Field label="Year">{row.year_o || '-'}</Field>
                        <Field label="DOI"><DoiLink doi={row.doi_o} /></Field>
                        {row.journal_o && <Field label="Journal">{row.journal_o}</Field>}
                    </div>
                </div>
                <div className="detail-card">
                    <h6>{reportKindLabel(row)} report</h6>
                    <div className="detail-section">
                        <Field label="Title">{row.title_r || '-'}</Field>
                        <Field label="Authors">{fullAuthors(row.author_r)}</Field>
                        <Field label="Year">{row.year_r || '-'}</Field>
                        <Field label="Report"><ReportLink url={row.url_r} doi={row.doi_r} max={40} /></Field>
                        {row.journal_r && <Field label="Journal">{row.journal_r}</Field>}
                    </div>
                </div>
            </div>
            <div className="detail-card detail-card--evidence">
                <h6>Recorded evidence</h6>
                <div className="detail-section">
                    <Field label="Outcome"><OutcomeBadge row={row} /></Field>
                    <OutcomeEvidence row={row} />
                    <Field label="Type">{row.type || '-'}</Field>
                </div>
            </div>
        </div>
    );
}

function MobileCard({row}) {
    const line = (title, fallback, href) => href ? <a href={href} target="_blank" rel="noopener">{title || fallback || '—'}</a> : title || fallback || '—';
    return (
        <div className="bm-card">
            <div className="bm-row">
                <div className="bm-row-label">Original report</div>
                <div className="bm-row-title">{line(row.title_o, shortAuthors(row.author_o), pairHref(row.doi_o, null))}</div>
                <div className="bm-row-meta">{[authorYear(row.author_o, row.year_o), row.journal_o].filter(Boolean).join(' · ')}</div>
            </div>
            <div className="bm-divider" />
            <div className="bm-row">
                <div className="bm-row-label">{reportKindLabel(row)} report</div>
                <div className="bm-row-title">{line(row.title_r, shortAuthors(row.author_r), pairHref(safeHref(row.url_r) ? null : row.doi_r, row.url_r))}</div>
                <div className="bm-row-meta">{[authorYear(row.author_r, row.year_r), row.journal_r].filter(Boolean).join(' · ')}</div>
            </div>
            <div className="bm-tags"><OutcomeBadge row={row} />{row.type && <span className="bm-tag-type">{row.type}</span>}</div>
            <details className="bm-evidence"><summary>Study and outcome evidence</summary><Evidence row={row} /></details>
        </div>
    );
}

function pageWindow(page, pages) {
    if (pages <= 7) return Array.from({length: pages}, (_, i) => i + 1);
    const middle = page <= 4 ? [2, 3, 4, 5] : page >= pages - 3 ? [pages - 4, pages - 3, pages - 2, pages - 1] : [page - 1, page, page + 1];
    return [1, ...(middle[0] > 2 ? ['…'] : []), ...middle, ...(middle[middle.length - 1] < pages - 1 ? ['… '] : []), pages];
}

const COLUMNS = [null, 'Original report', 'Original year', null, 'Report year', 'Outcome', 'Study type', 'Original DOI', 'Report link'];

export default function Browse({citation}) {
    const {rows, stamps} = useData();
    const {view, setView, linkFor} = useView();
    const {q, kind} = view;
    const [input, setInput] = useState(q);
    const [expanded, setExpanded] = useState(() => new Set());
    const [feedback, setFeedback] = useState('');
    const debounce = useRef();
    const inputRef = useRef(null);
    const headingRef = useRef(null);
    useEffect(() => { setInput(q); }, [q]);

    const [column, direction] = useMemo(() => { const [c, d] = view.sort.split(':'); return [Number(c), d]; }, [view.sort]);
    const indexOf = useMemo(() => new Map(rows.map((r, i) => [r, i])), [rows]);
    const filtered = useMemo(() => {
        const key = sortKey(column), sign = direction === 'desc' ? -1 : 1;
        return filterByKind(rows, kind).filter(r => matchesBrowseQuery(r, q)).sort((a, b) => collator.compare(key(a), key(b)) * sign);
    }, [rows, kind, q, column, direction]);

    const total = filtered.length;
    const size = view.pageSize === -1 ? Math.max(total, 1) : view.pageSize;
    const pages = Math.max(1, Math.ceil(total / size));
    const page = Math.min(view.page, pages);
    const shown = filtered.slice((page - 1) * size, page * size);
    const mobilePages = Math.max(1, Math.ceil(total / MOBILE_PAGE_SIZE));
    const mobilePage = Math.min(view.mobilePage, mobilePages);
    const mobileStart = (mobilePage - 1) * MOBILE_PAGE_SIZE;
    const mobileShown = filtered.slice(mobileStart, mobileStart + MOBILE_PAGE_SIZE);

    const refilter = patch => setView({...patch, page: 1, mobilePage: 1});
    const search = text => { clearTimeout(debounce.current); setInput(text); debounce.current = setTimeout(() => refilter({q: text}), 200); };
    const searchNow = text => { clearTimeout(debounce.current); setInput(text); refilter({q: text}); };
    const sortBy = c => refilter({sort: `${c}:${column === c && direction === 'asc' ? 'desc' : 'asc'}`});

    setHook('fullRowData', () => rows);
    setHook('getChartData', () => filtered);
    setHook('bmFiltered', () => filtered);
    setHook('browseQuery', () => q);
    setHook('browseKind', () => kind);
    setHook('floraBrowse', () => ({page: page - 1, pageSize: view.pageSize, order: [column, direction], rendered: shown.length, rows: filtered,
        setOrder: (c, d) => refilter({sort: `${c}:${d}`}), setPage: n => setView({page: n + 1}), setPageSize: n => refilter({pageSize: n})}));

    const dimension = DIMENSION_FOR_KIND[kind];
    const filteredView = Boolean(q.trim()) || kind !== 'all';
    const noun = BROWSE_KIND_NOUNS[kind] || BROWSE_KIND_NOUNS.all;
    const reportWord = kind === 'all' ? 'Replication or reproduction' : kind === 'replication' ? 'Replication' : 'Reproduction';
    const countText = kind === 'all' ? `${total.toLocaleString()} ${pairs(total)}` : `${total.toLocaleString()} of ${rows.length.toLocaleString()} ${pairs(rows.length)}`;

    const share = async () => {
        clearTimeout(debounce.current);
        if (input !== q) refilter({q: input});
        try { await navigator.clipboard.writeText(linkFor(input !== q ? {q: input, page: 1, mobilePage: 1} : {})); setFeedback('Link copied'); }
        catch { setFeedback('Copy the current address from your browser.'); }
    };
    const exportCsv = () => {
        const keys = Object.keys(rows[0] || {}).flatMap(key => key === 'outcome' ? [key, 'outcome_label'] : [key]);
        const stamp = stamps ? stampInfo('flora', stamps.flora).text : '';
        download(filteredView ? 'flora-filtered-reference-pairs.csv' : 'flora-reference-pairs.csv', keys,
            filtered.map(row => keys.map(k => k === 'outcome_label' ? outcomeLabel(row) : row[k])),
            `Unit: reference pair\n${stamp}\nStudy type: ${FloraVocabulary.studyType(kind)}\nQuery: ${q}\nIncluded: ${total.toLocaleString('en-GB')}; excluded by filters: ${(rows.length - total).toLocaleString('en-GB')}\nQualified success is separate from unqualified success; reproduction dimensions overlap.`);
    };
    const toggle = index => setExpanded(prev => { const next = new Set(prev); next.has(index) ? next.delete(index) : next.add(index); return next; });
    const paged = useRef(false);
    const showMobilePage = delta => { paged.current = true; setView({mobilePage: mobilePage + delta}); };
    // Runs after the new cards are in place, so the list changing height cannot cancel the scroll.
    useEffect(() => {
        if (!paged.current) return;
        paged.current = false;
        headingRef.current.focus({preventScroll: true});
        headingRef.current.scrollIntoView({block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
    }, [mobilePage]);
    const first = total ? (page - 1) * size + 1 : 0, last = Math.min(total, page * size);
    const info = `Showing ${total ? `${first.toLocaleString('en-GB')} to ${last.toLocaleString('en-GB')} of ` : ''}${total.toLocaleString('en-GB')} ${pairs(total)}${total !== rows.length ? ` (filtered from ${rows.length.toLocaleString('en-GB')} ${pairs(rows.length)})` : ''}`;
    const mobileSort = MOBILE_SORTS.some(o => o[0] === view.sort) ? view.sort : 'custom';
    const emptyHeadline = q.trim() ? `No ${noun} match “${q.trim()}”`
        : {'reproduction-numerical': 'No reference pairs have a recorded computational verdict', 'reproduction-robustness': 'No reference pairs have a recorded robustness verdict'}[kind] || `No ${noun} are recorded yet`;

    return (
        <Pane id="browse" tabId="browse-tab" sources={['flora']} selection={[kindLabel(kind)]} kind={kind}
            title={{heading: 'Browse reference pairs', lede: 'Search every recorded pair of an original report and its replication or reproduction, then open the evidence behind each outcome.'}}>
            <div className="browse-filter-panel">
                <div className="browse-search">
                    <label htmlFor="browse-mobile-input">Find a reference pair</label>
                    <div className="browse-search-row">
                        <div className="search-field"><Icon.search />
                            <input type="search" id="browse-mobile-input" ref={inputRef} className="form-control" placeholder="Title, author, year, DOI or DOI URL" autoComplete="off" value={input} onChange={e => search(e.target.value)} />
                        </div>
                        <button type="button" id="share-view" className="icon-action" aria-label="Copy current view link" title="Copy current view link" onClick={share}><Icon.link /></button>
                        <button type="button" id="export-browse" className="browse-download" onClick={exportCsv}><Icon.download /><span>{filteredView ? 'Download filtered CSV' : 'Download full CSV'}</span></button>
                    </div>
                    <span id="view-feedback" role="status">{feedback}</span>
                </div>
                <KindFilter className="browse-kind-filter" buttonClass="browse-kind-btn" value={kind} onChange={k => refilter({kind: k})} count={countText} countId="browse-kind-count" />
                {!dimension && <p id="browse-chart-hint" className="study-type-note">Choose a study type to see its outcome breakdown.</p>}
            </div>
            <div id="browse-empty" className="browse-empty" role="status" hidden={total > 0}>
                {total === 0 && <>
                    <p><strong>{emptyHeadline}.</strong> FLoRA is not comprehensive, so this does not show that a study has never been replicated or reproduced.</p>
                    <div className="browse-empty-actions">
                        {q.trim() && <button type="button" className="browse-download" data-browse-action="clear-search" onClick={() => { searchNow(''); inputRef.current.focus(); }}>Clear search</button>}
                        {kind !== 'all' && <button type="button" className="browse-download" data-browse-action="all-kinds" onClick={() => refilter({kind: 'all'})}>Show all study types</button>}
                        <ExternalLink href={URLS.atlas} className="">Look up an original in the Replication Atlas</ExternalLink>
                        <ExternalLink href={URLS.submit} className="">Submit a missing study</ExternalLink>
                    </div>
                </>}
            </div>
            <div className="pane-meta">
                <DataStamp source="flora" />
                <CiteBlock label="How to cite &amp; re-use guidelines">
                    <p className="reuse-text">{REUSE_TEXT}</p>
                    <div className="cite-ref" id="citation-text-browse"><DatasetCitation state={citation} /></div>
                    <div className="cite-ref"><WebsiteCitation /></div>
                </CiteBlock>
            </div>

            <section className="card" id="browse-outcome-card" style={dimension && total ? undefined : {display: 'none'}}>
                <h2 className="card-header">Outcome Breakdown</h2>
                <div className="card-body">
                    <OutcomeChartRow prefix="browse" dimension="computational" rowId="browse-computational-row" hidden={dimension !== 'computational'} rows={filtered} scope="Reflects the reproductions in the table below: were the original results obtained?" />
                    <OutcomeChartRow prefix="browse" dimension="robustness" rowId="browse-robustness-row" hidden={dimension !== 'robustness'} rows={filtered} scope="Reflects the reproductions in the table below: do results hold under alternative analysis choices?" />
                    <OutcomeChartRow prefix="browse" dimension="replicability" rowId="browse-replicability-row" hidden={dimension !== 'replicability'} rows={filtered} scope={<>Reflects the studies in the table below. Currently this breakdown covers <strong>replications only</strong>; reproductions are shown separately when their filter is selected.</>} />
                </div>
            </section>

            <section className="card">
                <h2 className="card-header" id="browse-results-heading" tabIndex={-1} ref={headingRef}>Reference pairs</h2>
                <div className="card-body">
                    <div className="browse-desktop">
                        <div className="table-controls" id="flora-table_length">
                            <label>Show <select value={view.pageSize} onChange={e => refilter({pageSize: Number(e.target.value)})}>
                                {PAGE_SIZES.map(n => <option key={n} value={n}>{n === -1 ? 'All' : n}</option>)}
                            </select> reference pairs</label>
                        </div>
                        <div className="table-wrap">
                            <table id="flora-table" className="data-table">
                                <thead>
                                    <tr>
                                        <th scope="col"><span className="visually-hidden">Study evidence</span></th>
                                        {COLUMNS.map((label, c) => c > 0 && (
                                            <th key={c} scope="col" className="sortable" aria-sort={column === c ? (direction === 'asc' ? 'ascending' : 'descending') : undefined} onClick={() => sortBy(c)}>
                                                <button type="button" className="table-sort">{c === 3 ? <><span data-browse-report-kind>{reportWord}</span> report</> : label}</button>
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {!total && <tr><td colSpan={9} className="table-empty">No matching reference pairs</td></tr>}
                                    {shown.map(row => {
                                        const index = indexOf.get(row), open = expanded.has(index);
                                        return (
                                            <Fragment key={index}>
                                                <tr data-index={index} className={open ? 'shown' : undefined}>
                                                    <td className="details-control"><button type="button" className="study-details" aria-label={'Show evidence for ' + (row.title_o || 'original report')} aria-expanded={open} onClick={() => toggle(index)} /></td>
                                                    <td><TitleCell title={row.title_o} author={row.author_o} year={row.year_o} /></td>
                                                    <td>{row.year_o || '-'}</td>
                                                    <td><TitleCell title={row.title_r} author={row.author_r} year={row.year_r} /></td>
                                                    <td>{row.year_r || '-'}</td>
                                                    <td><OutcomeBadge row={row} /></td>
                                                    <td className="type-cell">{row.type ? truncate(row.type, 15) : '-'}</td>
                                                    <td className="link-cell"><DoiLink doi={row.doi_o} /></td>
                                                    <td className="link-cell"><ReportLink url={row.url_r} doi={row.doi_r} /></td>
                                                </tr>
                                                {open && <tr className="child-row"><td colSpan={9}><Evidence row={row} /></td></tr>}
                                            </Fragment>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        <div className="table-footer">
                            <div id="flora-table_info" className="table-info" role="status">{info}</div>
                            {pages > 1 && (
                                <nav className="pagination" id="flora-table_paginate" aria-label="Reference pair pages">
                                    <button type="button" disabled={page === 1} onClick={() => setView({page: page - 1})}>Previous</button>
                                    {pageWindow(page, pages).map(p => typeof p === 'string'
                                        ? <span key={p} className="pagination-gap">…</span>
                                        : <button type="button" key={p} className={p === page ? 'active' : undefined} aria-current={p === page ? 'page' : undefined} aria-label={`Page ${p}`} onClick={() => setView({page: p})}>{p}</button>)}
                                    <button type="button" disabled={page === pages} onClick={() => setView({page: page + 1})}>Next</button>
                                </nav>
                            )}
                        </div>
                    </div>

                    <div className="browse-mobile">
                        <label className="bm-sort" htmlFor="bm-sort">Sort by <select id="bm-sort" className="form-select" value={mobileSort} onChange={e => refilter({sort: e.target.value})}>
                            {MOBILE_SORTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                            <option value="custom" disabled hidden>Order set in desktop table</option>
                        </select></label>
                        <div id="browse-mobile-meta" className="browse-mobile-meta" role="status">
                            {total
                                ? <><span className="visually-hidden">{BROWSE_KIND_LABELS[kind]}: </span>Showing <strong>{(mobileStart + 1).toLocaleString('en-GB')}–{Math.min(total, mobileStart + MOBILE_PAGE_SIZE).toLocaleString('en-GB')}</strong> of <strong>{total.toLocaleString()}</strong> {pairs(total)}</>
                                : `${BROWSE_KIND_LABELS[kind]}: 0 reference pairs`}
                        </div>
                        <div id="browse-mobile-list" className="browse-mobile-list">
                            {!total && <div className="bm-empty">No matching reference pairs.</div>}
                            {mobileShown.map(row => <MobileCard row={row} key={indexOf.get(row)} />)}
                        </div>
                        <div className="browse-mobile-pager" id="browse-mobile-pager" style={mobilePages > 1 ? undefined : {display: 'none'}}>
                            <button className="bm-page-btn" id="bm-prev" type="button" aria-label="Previous page" disabled={mobilePage === 1} onClick={() => showMobilePage(-1)}><Icon.prev /> Prev</button>
                            <span className="bm-page-info" id="bm-page-info" aria-current="page">Page {mobilePage} of {mobilePages}</span>
                            <button className="bm-page-btn" id="bm-next" type="button" aria-label="Next page" disabled={mobilePage >= mobilePages} onClick={() => showMobilePage(1)}>Next <Icon.next /></button>
                        </div>
                    </div>
                </div>
            </section>
        </Pane>
    );
}
