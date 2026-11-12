import {useMemo} from 'react';
import {ANALYSIS_MIN_N, URLS} from '../lib/config.js';
import {percent} from '../lib/format.js';
import {outcomeBuckets, studyTypeLabel} from '../lib/outcomes.js';
import {setHook} from '../lib/hooks.js';
import {useJson} from '../state/data.jsx';
import {useEnv} from '../state/env.jsx';
import {useView} from '../state/view.jsx';
import {Plot, comparisonSpec} from '../components/charts.jsx';
import {Caveat, Chips, CiteBlock, DataStamp, ExternalLink, OutcomeBadge, OutcomeDefinitions, Pane, Placeholder, StatTiles, WebsiteCitation, byKind, kindLabel, repWord} from '../components/common.jsx';
import {ReportLink} from './Browse.jsx';

const VENUES = {journal: 'Other named venue', preprint: 'Repository / preprint', conference: 'Conference output', thesis: 'Thesis / dissertation', unknown: 'Unknown venue'};
const RR_GROUPS = {rr: 'Registered Report', non_rr: 'Not found in RR database'};
const SIZE_GROUPS = {individual: 'Up to 3 targets / unknown', large_scale: 'Multiple-target report (>3 targets)'};

// One comparison: summary tiles, grouped outcome chart, caveat and the evidence list behind it.
function Comparison({prefix, state, d, kind, shortage, tiles, groups, chartTitle, caveat, studies, loadingHidden}) {
    const {theme} = useEnv();
    const enough = d?.overview && d.overview.n_total >= ANALYSIS_MIN_N;
    const spec = useMemo(() => enough ? comparisonSpec(outcomeBuckets(kind), Object.keys(groups), groups, d.by_outcome) : null, [enough, d, kind, groups, theme]);
    return (
        <div id={`${prefix}-content`}>
            {!state.data && !state.error && !loadingHidden && <div id={`${prefix}-loading`} className="note note-loading">Loading analysis…</div>}
            {state.error && <div id={`${prefix}-error`} className="note">{state.errorLabel} <code id={`${prefix}-error-detail`} className="note-detail">{state.error}</code></div>}
            {state.data && !enough && <Placeholder id={`${prefix}-placeholder`}>Not enough {studyTypeLabel(kind)} {shortage} yet (n={d?.overview?.n_total || 0}; need at least {ANALYSIS_MIN_N}).</Placeholder>}
            {enough && <>
                <StatTiles id={`${prefix}-overview`} tiles={tiles(d.overview)} />
                <div id={`${prefix}-chart-card`} className="mc-chart-card">
                    <h3 className="mc-chart-title">{chartTitle}</h3>
                    <div className="mc-chart-wrap"><Plot id={`${prefix}-chart`} title={chartTitle} spec={spec} /></div>
                </div>
                <Caveat id={`${prefix}-caveat`}>{caveat}</Caveat>
                {studies}
            </>}
        </div>
    );
}

function StudyList({prefix, summary, count, head, children}) {
    if (!count) return null;
    return (
        <details id={`${prefix}-studies-card`} className="mc-chart-card rr-studies-details">
            <summary className="mc-chart-title">{summary} <span id={`${prefix}-studies-count`} className="rr-studies-count">({count.toLocaleString()})</span></summary>
            <div className="table-wrap" tabIndex={0} role="region" aria-label={typeof summary === 'string' ? summary : 'Evidence list'}>
                <table className="data-table" id={`${prefix}-studies-table`}>
                    <thead><tr>{head.map((h, i) => <th key={i} scope="col">{h}</th>)}</tr></thead>
                    <tbody>{children}</tbody>
                </table>
            </div>
        </details>
    );
}
const OutcomeCell = ({study, kind}) => <td><OutcomeBadge row={{...study, type: kind === 'replication' ? 'replication' : 'reproduction'}} /><div className="small">Source outcome: {study.outcome}</div></td>;

export default function PublicationType() {
    const {view, setView} = useView();
    const kind = view.pubKind;
    const active = view.tab === 'pub-tab';
    const pub = useJson(URLS.pubStatus, active);
    const rr = useJson(URLS.rr, active);
    setHook('_pubData', () => pub.data);
    setHook('_rrData', () => rr.data);
    const pubD = pub.data?.[kind], rrD = rr.data?.[kind], sizeD = pubD?.large_scale;
    const word = repWord(kind), Word = kind === 'replication' ? 'Replication' : 'Reproduction';
    const bucketLabels = useMemo(() => pub.data ? Object.fromEntries(outcomeBuckets(kind).map(b => [b.key, b.label])) : {}, [pub.data, kind]);
    const pubStudies = pubD?.pub_studies || [], rrStudies = rrD?.rr_studies || [], projects = sizeD?.large_scale_studies || [];
    const rrTitle = `${byKind(kind, ['Replication outcomes', 'Computational reproducibility', 'Robustness'])} by Registered Report status`;

    return (
        <Pane id="publication-type" tabId="pub-tab" sources={['pub_status', 'rr_status']} selection={[kindLabel(kind)]} kind={kind}
            title={{heading: 'Publication Type', lede: 'Outcomes by where and how the repetition was published: venue, Registered Report status and report size.'}}>
            <div className="pane-meta">
                <OutcomeDefinitions />
                <CiteBlock><div className="cite-ref"><WebsiteCitation /></div></CiteBlock>
            </div>
            <div className="sticky-filter">
                <Chips id="pubtype-study-type" label="Publication Type study type (all three comparisons)" value={kind} onChange={k => setView({pubKind: k})} />
                <div className="study-type-note">This filter applies to all three analyses below. It is computed for all three study types; reproduction results may show a low-data message given how few reproductions exist so far.</div>
            </div>

            <DataStamp source="pub_status" />
            <section className="card">
                <h2 className="card-header">Recorded publication venue</h2>
                <div className="card-body">
                    <p>Venue names identify repositories/preprints, conference outputs, and theses where recognisable. Missing metadata remain unknown. All other names are labelled “other named venue”; this does not verify a journal article or peer review. Chart percentages use all selected reference pairs within each venue group; summary-card percentages use all selected reference pairs.</p>
                    <Comparison prefix="pub" state={{...pub, errorLabel: 'Failed to load Publication Status data.'}} d={pubD} kind={kind} shortage="with publication-status data" groups={VENUES} chartTitle="Outcomes by publication venue"
                        tiles={ov => [{value: ov.n_total, label: 'Reference pairs', always: true}, ...Object.entries(VENUES).map(([key, label]) => ({value: ov['n_' + key] || 0, label: `${label} (${percent(ov['n_' + key] || 0, ov.n_total)}%)`}))]}
                        caveat="Publication-venue status is derived from the report venue recorded in FLoRA, classified as above. Some studies currently classified as preprints may since have been formally published in a different venue without FLoRA yet reflecting that update. Any outcome differences between these groups should also not be read as caused by publication venue alone: constructive peer review, a tendency for more selective journals to accept more polished work, and publication-pressure effects — for example a bias toward reporting positive or successful results in order to get published, or conversely extra editorial scrutiny catching more issues before publication — could all plausibly produce real differences independent of, or entangled with, venue itself."
                        studies={<StudyList prefix="pub" summary="Reference pairs with publication-status data" count={pubStudies.length} head={['Study', 'Journal', 'Status', 'Year', 'Outcome', 'DOI']}>
                            {pubStudies.map((s, i) => (
                                <tr key={i}><td>{s.title_r}</td><td>{s.journal_r}</td><td><span className="badge badge-unknown">{VENUES[s.pub_status] || 'Unknown venue'}</span></td><td>{s.year_r}</td><OutcomeCell study={s} kind={kind} /><td><ReportLink url={s.url_r} doi={s.doi_r} max={40} /></td></tr>
                            ))}
                        </StudyList>} />
                </div>
            </section>

            <DataStamp source="rr_status" />
            <section className="card">
                <h2 className="card-header">Publication Format: Registered Reports vs. Other {kind === 'replication' ? 'Replications' : 'Reproductions'}</h2>
                <div className="card-body">
                    <p>This analysis checks whether each {word} in FLoRA was itself published as a <strong>Registered Report</strong> (RR): a format in which the study design and analysis plan are peer-reviewed and provisionally accepted <em>before</em> results are known. Matching is done by DOI/title against the <ExternalLink href="https://github.com/LukasRoeseler/RRDB">Registered Reports database</ExternalLink>, a regularly updated export of the FORRT Zotero "Registered Reports" group library. Pairs whose {word} report matches the Registered Reports database form the <strong>Registered Report</strong> group; identifiable non-matches form the <strong>Not found in RR database</strong> group. Pairs without a report DOI or title remain unknown and are excluded from the comparison.</p>
                    <p>Because the Registered Reports database is itself a work in progress, “Not found in RR database” means <em>not (yet) found</em> in the database, rather than confirmed non-RR.</p>
                    <CiteBlock label="Registered Reports data source"><div className="cite-ref">Montoya, A. K., Krenzer, W. L. D., Buchanan, E. M., Pronizius, E., Wang, Y. A., Morillo, D., … Armstrong, C. (2026, May 14). <em>Database of Published Registered Reports</em>. <ExternalLink href="https://doi.org/10.17605/OSF.IO/VUR72">https://doi.org/10.17605/OSF.IO/VUR72</ExternalLink></div></CiteBlock>
                    <Comparison prefix="rr" state={{...rr, errorLabel: 'Failed to load Registered Reports data.'}} d={rrD} kind={kind} shortage="checked against the Registered Reports database" groups={RR_GROUPS} chartTitle={rrTitle}
                        tiles={ov => [
                            {value: ov.n_total || 0, label: `${Word} reference pairs checked`},
                            {value: ov.n_rr || 0, label: `Registered Reports (${percent(ov.n_rr, ov.n_total)}%)`},
                            {value: ov.n_non_rr || 0, label: `Not found in RR database (${percent(ov.n_non_rr, ov.n_total)}%)`},
                            {value: ov.n_unknown || 0, label: 'Not checkable'},
                        ]}
                        caveat={kind === 'replication'
                            ? 'Which studies get accepted as Registered Reports is not random — journals and reviewers may favour proposals with designs they expect to be highly powered, well-specified, or otherwise likely to replicate cleanly, regardless of format. Any difference in outcomes between RR and non-RR replications could therefore reflect the RR process itself, selection into that process, discipline/topic composition, or some mixture of all three. Coverage of the RR library is also incomplete, so the ‘Not found in RR database’ group likely still contains some unlabelled Registered Reports.'
                            : 'Selection into the Registered Report format is not random. Differences between database-matched and unmatched pairs may reflect selection, discipline or topic as well as the review process. These descriptive comparisons do not establish an effect of the format.'}
                        studies={<StudyList prefix="rr" summary={`Reference pairs whose ${word} report matches the Registered Reports database`} count={rrStudies.length} head={[`${Word} report`, 'Journal', 'Year', 'Outcome', 'DOI']}>
                            {rrStudies.map((s, i) => <tr key={i}><td>{s.title_r}</td><td>{s.journal_r}</td><td>{s.year_r}</td><OutcomeCell study={s} kind={kind} /><td><ReportLink url={s.url_r} doi={s.doi_r} max={40} /></td></tr>)}
                        </StudyList>} />
                </div>
            </section>

            <section className="card">
                <h2 className="card-header">Reports by number of original targets</h2>
                <div className="card-body">
                    <p>This analysis groups replication and reproduction reports by their number of recorded original targets. <strong>Multiple-target reports</strong> contain more than three distinct original targets in the recorded data. The remaining group contains reports with up to three targets and records with missing report identifiers. Target count does not establish the number of laboratories or membership of a coordinated project. Chart percentages count reference pairs; the evidence list counts reports.</p>
                    <Comparison prefix="ls" loadingHidden={Boolean(rr.data || rr.error)} state={{...pub, errorLabel: 'Failed to load project-scale data.'}} d={sizeD} kind={kind} shortage="with report-size data" groups={SIZE_GROUPS} chartTitle="Outcomes by report size"
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
                </div>
            </section>
        </Pane>
    );
}
