import {useMemo} from 'react';
import {ANALYSIS_MIN_N, URLS} from '../lib/config.js';
import {percent} from '../lib/format.js';
import {kindNoun, kindPairCount, outcomeBuckets, studyTypeLabel} from '../lib/outcomes.js';
import {coverageText, nPairs, reportKey} from '../lib/coverage.js';
import {setHook} from '../lib/hooks.js';
import {useData, useJson} from '../state/data.jsx';
import {useEnv} from '../state/env.jsx';
import {useView} from '../state/view.jsx';
import {Plot, comparisonSpec} from '../components/charts.jsx';
import {Callout, Disclosure, Note, Section, TableScroll} from '../components/ui.jsx';
import {Caveat, Chips, CiteBlock, DataStamp, ExternalLink, OutcomeBadge, Pane, Placeholder, StatTiles, WebsiteCitation, byKind, kindLabel, repWord} from '../components/common.jsx';
import {ReportLink} from './Browse.jsx';

const VENUES = {journal: 'Other named venue', preprint: 'Repository / preprint', conference: 'Conference output', thesis: 'Thesis / dissertation', unknown: 'Unknown venue'};
const RR_GROUPS = {rr: 'Registered Report', non_rr: 'Not found in RR database'};
const SIZE_GROUPS = {individual: 'Up to 3 targets / unknown', large_scale: 'Multiple-target report (>3 targets)'};

// One comparison: summary tiles, grouped outcome chart, caveat and the evidence list behind it.
function Comparison({prefix, state, d, kind, shortage, tiles, groups, chartTitle, caveat, studies, excluded = []}) {
    const {theme} = useEnv();
    const {rows} = useData();
    const enough = d?.overview && d.overview.n_total >= ANALYSIS_MIN_N;
    const coverage = enough ? coverageText(d.overview.n_total || 0, kindPairCount(rows, kind), excluded.map(([key, why]) => [d.overview[key] || 0, why]), kindNoun(kind), kind) : '';
    const spec = useMemo(() => enough ? {...comparisonSpec(outcomeBuckets(kind), Object.keys(groups), groups, d.by_outcome), coverage} : null, [enough, d, kind, groups, theme, coverage]);
    return (
        <div id={`${prefix}-content`} className="stack">
            {!state.data && !state.error && <Callout tone="empty" id={`${prefix}-loading`}>Loading analysis…</Callout>}
            {state.error && <Callout tone="caution" id={`${prefix}-error`}>{state.errorLabel} <code id={`${prefix}-error-detail`}>{state.error}</code></Callout>}
            {state.data && !enough && <Placeholder id={`${prefix}-placeholder`}>Not enough {studyTypeLabel(kind)} {shortage} yet (n={d?.overview?.n_total || 0}; need at least {ANALYSIS_MIN_N}).</Placeholder>}
            {enough && <>
                <StatTiles id={`${prefix}-overview`} tiles={tiles(d.overview)} />
                <Plot id={`${prefix}-chart`} frameId={`${prefix}-chart-card`} heading={chartTitle} title={chartTitle} spec={spec} note={<Note id={`${prefix}-chart-n`}>{coverage}</Note>} />
                <Caveat id={`${prefix}-caveat`}>{caveat}</Caveat>
                {studies}
            </>}
        </div>
    );
}

function StudyList({prefix, summary, count, countText, head, children}) {
    if (!count) return null;
    return (
        <Disclosure id={`${prefix}-studies-card`} className="disclosure--panel" summary={<>{summary} <span id={`${prefix}-studies-count`} className="note">{countText || `(${count.toLocaleString()})`}</span></>}>
            <TableScroll label={typeof summary === 'string' ? summary : 'Evidence list'}>
                <table className="table" id={`${prefix}-studies-table`}>
                    <thead><tr>{head.map((h, i) => <th key={i} scope="col">{h}</th>)}</tr></thead>
                    <tbody>{children}</tbody>
                </table>
            </TableScroll>
        </Disclosure>
    );
}
const typed = (study, kind) => ({...study, type: kind === 'replication' ? 'replication' : 'reproduction'});
const OutcomeCell = ({study, kind}) => <td><OutcomeBadge row={typed(study, kind)} /></td>;
const fromReports = n => n === undefined ? undefined : `pairs from ${n.toLocaleString('en-GB')} distinct ${n === 1 ? 'report' : 'reports'}`;

// One row per report: its pairs, and each distinct outcome with how often it occurs.
function groupByReport(studies, kind) {
    const reports = new Map();
    studies.forEach((s, i) => {
        const key = reportKey(s) || 'pair:' + i;
        if (!reports.has(key)) reports.set(key, []);
        reports.get(key).push(s);
    });
    return [...reports.values()].map(pairs => {
        const outcomes = new Map();
        for (const p of pairs) {
            const key = [p.outcome_replication, p.outcome_computation, p.outcome_robustness].join('|');
            if (!outcomes.has(key)) outcomes.set(key, {row: typed(p, kind), n: 0});
            outcomes.get(key).n++;
        }
        return {first: pairs[0], n: pairs.length, outcomes: [...outcomes.values()]};
    });
}

export default function PublicationType() {
    const {view, setView} = useView();
    const kind = view.pubKind;
    useEnv();
    const active = view.tab === 'pub-tab';
    const pub = useJson(URLS.pubStatus, active);
    const rr = useJson(URLS.rr, active);
    setHook('_pubData', () => pub.data);
    setHook('_rrData', () => rr.data);
    const pubD = pub.data?.[kind], rrD = rr.data?.[kind], sizeD = pubD?.large_scale;
    const word = repWord(kind), Word = kind === 'replication' ? 'Replication' : 'Reproduction';
    const bucketLabels = useMemo(() => pub.data ? Object.fromEntries(outcomeBuckets(kind).map(b => [b.key, b.label])) : {}, [pub.data, kind]);
    const pubStudies = pubD?.pub_studies || [], rrStudies = rrD?.rr_studies || [], projects = sizeD?.large_scale_studies || [];
    const rrReports = useMemo(() => groupByReport(rrStudies, kind), [rrStudies, kind]);
    // The two sections come from separately refreshed files, so their totals can drift apart.
    const rrTotal = rrD?.overview ? (rrD.overview.n_total || 0) + (rrD.overview.n_unknown || 0) : null;
    const snapshotsDiffer = rrTotal !== null && pubD?.overview && rrTotal !== pubD.overview.n_total;
    const rrTitle = `${byKind(kind, ['Replication outcomes', 'Computational reproducibility', 'Robustness'])} by Registered Report status`;

    return (
        <Pane id="publication-type" tabId="pub-tab" sources={['pub_status', 'rr_status']} selection={[kindLabel(kind)]} kind={kind}
            title={{heading: 'Publication Type', lede: 'Outcomes by where and how the repetition was published: venue, Registered Report status and report size.'}}>
            <div className="pane-meta">
                <CiteBlock><div className="cite-ref"><WebsiteCitation /></div></CiteBlock>
            </div>
            <div className="filter-bar">
                <Chips id="pubtype-study-type" label="Publication Type study type (all three comparisons)" value={kind} onChange={k => setView({pubKind: k})} />
                <Note>This filter applies to all three analyses below. It is computed for all three study types; reproduction results may show a low-data message given how few reproductions exist so far.</Note>
            </div>

            <Section title="Recorded publication venue" notes={<>
                <DataStamp source="pub_status" />
                    <p>Venues are grouped mainly from the recorded venue name: repositories/preprints, conference outputs, and theses where recognisable. Where no venue name is recorded, the report’s DOI or URL is used instead: a pair whose identifier points to a repository (for example OSF, PsyArXiv or bioRxiv) is grouped as repository / preprint, and all other pairs without a venue name remain unknown. A name containing “proceedings” counts as a conference output only when it refers to a specific event (for example a numbered edition or a symposium); journals such as PNAS do not. All other names are labelled “other named venue”; this does not verify a journal article or peer review. Chart percentages use all selected reference pairs within each venue group; summary-card percentages use all selected reference pairs.</p>
            </>}>
                    <Comparison prefix="pub" state={{...pub, errorLabel: 'Failed to load Publication Status data.'}} d={pubD} kind={kind} shortage="with publication-status data" groups={VENUES} chartTitle="Outcomes by publication venue"
                        tiles={ov => [{value: ov.n_total, label: 'Reference pairs', always: true}, ...Object.entries(VENUES).map(([key, label]) => ({value: ov['n_' + key] || 0, label: `${label} (${percent(ov['n_' + key] || 0, ov.n_total)}%)`}))]}
                        caveat="Publication-venue status is derived from the report venue recorded in FLoRA, classified as above. Some studies currently classified as preprints may since have been formally published in a different venue without FLoRA yet reflecting that update. Any outcome differences between these groups should also not be read as caused by publication venue alone: constructive peer review, a tendency for more selective journals to accept more polished work, and publication-pressure effects — for example a bias toward reporting positive or successful results in order to get published, or conversely extra editorial scrutiny catching more issues before publication — could all plausibly produce real differences independent of, or entangled with, venue itself."
                        studies={<StudyList prefix="pub" summary="Reference pairs with publication-status data" count={pubStudies.length} head={['Study', 'Journal', 'Status', 'Year', 'Outcome', 'DOI']}>
                            {pubStudies.map((s, i) => (
                                <tr key={i}><td>{s.title_r}</td><td>{s.journal_r}</td><td><span className="badge badge-unknown">{VENUES[s.pub_status] || 'Unknown venue'}</span></td><td>{s.year_r}</td><OutcomeCell study={s} kind={kind} /><td><ReportLink url={s.url_r} doi={s.doi_r} max={40} /></td></tr>
                            ))}
                        </StudyList>} />
            </Section>

            <Section title={<>Publication Format: Registered Reports vs. Other {kind === 'replication' ? 'Replications' : 'Reproductions'}</>} notes={<>
                <DataStamp source="rr_status" />
                    <p>This analysis checks whether each {word} in FLoRA was itself published as a <strong>Registered Report</strong> (RR): a format in which the study design and analysis plan are peer-reviewed and provisionally accepted <em>before</em> results are known. Matching is done by DOI/title against the <ExternalLink href="https://github.com/LukasRoeseler/RRDB">Registered Reports database</ExternalLink>, a regularly updated export of the FORRT Zotero "Registered Reports" group library. Pairs whose {word} report matches the Registered Reports database form the <strong>Registered Report</strong> group; identifiable non-matches form the <strong>Not found in RR database</strong> group. Pairs without a report DOI or title remain unknown and are excluded from the comparison.</p>
                    <p>Because the Registered Reports database is itself a work in progress, “Not found in RR database” means <em>not (yet) found</em> in the database, rather than confirmed non-RR.</p>
                    <CiteBlock label="Registered Reports data source"><div className="cite-ref">Montoya, A. K., Krenzer, W. L. D., Buchanan, E. M., Pronizius, E., Wang, Y. A., Morillo, D., … Armstrong, C. (2026, May 14). <em>Database of Published Registered Reports</em>. <ExternalLink href="https://doi.org/10.17605/OSF.IO/VUR72">https://doi.org/10.17605/OSF.IO/VUR72</ExternalLink></div></CiteBlock>
                    {snapshotsDiffer && <Note id="rr-snapshot-note">This section uses {nPairs(rrTotal)}, while the venue section above uses {nPairs(pubD.overview.n_total)}. The two sections were refreshed from different FLoRA snapshots; see each section’s update stamp.</Note>}
            </>}>
                    <Comparison prefix="rr" excluded={[['n_unknown', 'without a report DOI or title to check']]} state={{...rr, errorLabel: 'Failed to load Registered Reports data.'}} d={rrD} kind={kind} shortage="checked against the Registered Reports database" groups={RR_GROUPS} chartTitle={rrTitle}
                        tiles={ov => [
                            {value: ov.n_total || 0, label: `${Word} reference pairs checked`},
                            {value: ov.n_rr || 0, label: `Registered Reports (${percent(ov.n_rr, ov.n_total)}%)`, sub: fromReports(ov.n_rr_reports)},
                            {value: ov.n_non_rr || 0, label: `Not found in RR database (${percent(ov.n_non_rr, ov.n_total)}%)`, sub: fromReports(ov.n_non_rr_reports)},
                            {value: ov.n_unknown || 0, label: 'Not checkable'},
                        ]}
                        caveat={kind === 'replication'
                            ? 'Which studies get accepted as Registered Reports is not random — journals and reviewers may favour proposals with designs they expect to be highly powered, well-specified, or otherwise likely to replicate cleanly, regardless of format. Any difference in outcomes between RR and non-RR replications could therefore reflect the RR process itself, selection into that process, discipline/topic composition, or some mixture of all three. Coverage of the RR library is also incomplete, so the ‘Not found in RR database’ group likely still contains some unlabelled Registered Reports.'
                            : 'Selection into the Registered Report format is not random. Differences between database-matched and unmatched pairs may reflect selection, discipline or topic as well as the review process. These descriptive comparisons do not establish an effect of the format.'}
                        studies={<StudyList prefix="rr" summary={`${Word} reports that match the Registered Reports database`} count={rrStudies.length}
                            countText={`(${nPairs(rrStudies.length)} from ${rrReports.length.toLocaleString('en-GB')} ${rrReports.length === 1 ? 'report' : 'reports'})`} head={[`${Word} report`, 'Journal', 'Year', 'Reference pairs', 'Outcomes', 'DOI']}>
                            {rrReports.map(({first: s, n, outcomes}, i) => (
                                <tr key={i}><td>{s.title_r}</td><td>{s.journal_r}</td><td>{s.year_r}</td><td>{n.toLocaleString('en-GB')}</td>
                                    <td>{outcomes.map((o, k) => <span key={k}>{k > 0 && ' '}<OutcomeBadge row={o.row} />{o.n > 1 && ` ×${o.n}`}</span>)}</td>
                                    <td><ReportLink url={s.url_r} doi={s.doi_r} max={40} /></td></tr>
                            ))}
                        </StudyList>} />
            </Section>

            <Section title="Reports by number of original targets" notes={<>
                    <p>This analysis groups replication and reproduction reports by their number of recorded original targets. <strong>Multiple-target reports</strong> contain more than three distinct original targets in the recorded data. The remaining group contains reports with up to three targets and records with missing report identifiers. Target count does not establish the number of laboratories or membership of a coordinated project. Chart percentages count reference pairs; the evidence list counts reports.</p>
            </>}>
                    <Comparison prefix="ls" state={{...pub, errorLabel: 'Failed to load project-scale data.'}} d={sizeD} kind={kind} shortage="with report-size data" groups={SIZE_GROUPS} chartTitle="Outcomes by report size"
                        tiles={ov => [
                            {value: ov.n_total || 0, label: `${Word} reference pairs checked`},
                            {value: ov.n_individual || 0, label: `Up to 3 targets / unknown (${percent(ov.n_individual, ov.n_total)}%)`},
                            {value: ov.n_large_scale || 0, label: `Multiple-target report (${percent(ov.n_large_scale, ov.n_total)}%)`},
                        ]}
                        caveat="Outcomes reported within the same multiple-target report are not independent data points — they typically share authors, protocol, and incentives, so pooling many results from one report alongside results from reports with fewer targets can understate how clustered those outcomes really are. Multiple-target reports may also differ systematically in rigour, pre-registration, or topic selection from reports with fewer targets, which could itself explain any outcome difference, independent of target count itself."
                        studies={<StudyList prefix="ls" summary="Multiple-target reports" count={projects.length} head={['Replication or reproduction report', 'Journal', 'Year', 'Distinct originals', 'Outcome mix', 'DOI']}>
                            {projects.map((s, i) => (
                                <tr key={i}><td>{s.title_r}</td><td>{s.journal_r}</td><td>{s.year_r}</td><td>{s.n_originals}</td>
                                    <td>{Object.entries(s.outcome_mix || {}).map(([k, n]) => `${bucketLabels[k] || k}: ${n}`).join(', ')}</td>
                                    <td><ReportLink url={s.url_r} doi={s.doi_r} max={40} /></td></tr>
                            ))}
                        </StudyList>} />
            </Section>
        </Pane>
    );
}
