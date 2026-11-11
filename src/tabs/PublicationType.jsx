import {useEffect, useMemo} from 'react';
import {setLive} from '../testHooks.js';
import {useApp, PaneContext} from '../state/context.jsx';
import {STUDY_TYPE_CHIPS, kindText, studyTypeLabel, studyTypeOutcomeBuckets} from '../lib/outcomes.js';
import {RR_DATA_URL, PUB_STATUS_DATA_URL, ANALYSIS_MIN_N} from '../lib/config.js';
import {percent} from '../lib/chartUtils.js';
import {CiteBlock, DataStamp, ExternalLink, KindText, StudyTypeChips, WebsiteCitation} from '../components/Common.jsx';
import {UrlOrDoi} from '../components/Links.jsx';
import {useAnalysisData, fetchJson, Loading, LoadError, Stat, ComparisonChart, kindPairsLabel} from '../components/Analysis.jsx';

const VENUES = [['journal', 'Other named venue'], ['preprint', 'Repository / preprint'], ['conference', 'Conference output'], ['thesis', 'Thesis / dissertation'], ['unknown', 'Unknown venue']];
const VENUE_LABELS = Object.fromEntries(VENUES);
const RR_GROUPS = [['rr', 'Registered Report'], ['non_rr', 'Not found in RR database']];
const LS_GROUPS = [['individual', 'Up to 3 targets / unknown'], ['large_scale', 'Multiple-target report (>3 targets)']];

const settle = promise => promise.then(data => ({data}), error => ({error}));
const load = async () => {
    const [rr, pub] = await Promise.all([settle(fetchJson(RR_DATA_URL)), settle(fetchJson(PUB_STATUS_DATA_URL))]);
    return {rr, pub};
};

const shown = (visible, style = {}) => visible ? style : {...style, display: 'none'};

function Section({prefix, status, d, kind, insufficient, error, errorLabel, overview, chartTitle, chartId, groups, deps, caveat, studies}) {
    const loaded = status === 'ready';
    const enough = d?.overview && d.overview.n_total >= ANALYSIS_MIN_N;
    const ready = loaded && enough && !error;
    return <>
        <div id={prefix + '-placeholder'} className="coming-soon-placeholder" style={shown(loaded && !error && !enough)}>
            {`Not enough ${studyTypeLabel(kind)} ${insufficient} yet (n=${d?.overview ? d.overview.n_total : 0}; need at least ${ANALYSIS_MIN_N}).`}
        </div>
        <div id={prefix + '-content'}>
            <Loading id={prefix + '-loading'} show={!loaded} />
            <div id={prefix + '-overview'} className="mc-overview-grid" style={shown(ready)}>{ready && overview(d.overview)}</div>
            <div id={prefix + '-chart-card'} className="mc-chart-card" style={shown(ready, {marginTop: '1.25rem'})}>
                <h3 className="mc-chart-title">{chartTitle}</h3>
                {ready && <ComparisonChart id={chartId} title={typeof chartTitle === 'string' ? chartTitle : chartId} kind={kind} groups={groups} by={d.by_outcome} deps={deps} />}
            </div>
            <div id={prefix + '-caveat'} style={shown(ready, {marginTop: '1.25rem'})}><div className="key-distinction"><strong>Interpretation caveat:</strong> {caveat}</div></div>
            {studies && <details id={prefix + '-studies-card'} className="mc-chart-card rr-studies-details" style={shown(ready && studies.rows.length > 0, {marginTop: '1.25rem'})}>
                <summary className="mc-chart-title">{studies.title} <span id={prefix + '-studies-count'} className="rr-studies-count">({studies.rows.length.toLocaleString()})</span></summary>
                <div className="table-wrap" style={{marginTop: '0.75rem'}}>
                    <table className="table table-striped table-hover" id={prefix + '-studies-table'} style={{width: '100%'}}>
                        <thead><tr>{studies.headers.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
                        <tbody>{ready && studies.rows.map((s, i) => <tr key={i}>{studies.cells(s).map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
                    </table>
                </div>
            </details>}
            <LoadError id={prefix + '-error'} error={error}>{errorLabel}</LoadError>
        </div>
    </>;
}

export default function PublicationType({visited}) {
    const {view, updateView} = useApp();
    const kind = view.pubKind;
    const {status, data, version} = useAnalysisData('publicationType', null, visited, load);
    const rrData = data?.rr.data, pubData = data?.pub.data;
    useEffect(() => { setLive('rrData', rrData); setLive('pubData', pubData); }, [rrData, pubData]);
    const rr = rrData?.[kind], pub = pubData?.[kind], ls = pubData?.[kind]?.large_scale;
    const k = (...v) => kindText(kind, ...v);
    const kt = (...v) => <KindText>{k(...v)}</KindText>;
    const repText = kt('replication', 'reproduction', 'reproduction');
    const rep = k('replication', 'reproduction', 'reproduction');
    const pairs = kindPairsLabel(kind);
    const deps = [kind, version, rrData, pubData];
    const bucketLabels = Object.fromEntries(studyTypeOutcomeBuckets(kind).map(b => [b.key, b.label]));
    const selection = STUDY_TYPE_CHIPS.find(c => c.value === kind).label;
    const pane = useMemo(() => ({sources: ['pub_status', 'rr_status'], selection: [selection]}), [selection]);

    return <PaneContext.Provider value={pane}>
        <h1 className="visually-hidden">Publication Type</h1>
        <CiteBlock><div className="cite-ref"><WebsiteCitation /></div></CiteBlock>
        <StudyTypeChips id="pubtype-study-type" label="Publication Type study type (all three comparisons)" value={kind} onChange={v => updateView({pubKind: v})} />
        <div className="study-type-note">This filter applies to all three analyses below. It is computed for all three study types; reproduction results may show a low-data message given how few reproductions exist so far.</div>

        <DataStamp source="pub_status" />
        <div className="card">
            <h2 className="card-header">Recorded publication venue</h2>
            <div className="card-body">
                <p style={{marginBottom: '0.75rem'}}>
                    Venue names identify repositories/preprints, conference outputs, and theses where recognisable. Missing metadata remain unknown. All other names are labelled “other named venue”; this does not verify a journal article or peer review. Chart percentages use all selected reference pairs within each venue group; summary-card percentages use all selected reference pairs.
                </p>
                <Section prefix="pub" status={status} d={pub} kind={kind} insufficient="with publication-status data" error={data?.pub.error} errorLabel="Failed to load Publication Status data."
                    overview={ov => <>
                        <Stat value={ov.n_total.toLocaleString('en-GB')} label="Reference pairs" />
                        {VENUES.map(([key, label]) => <Stat key={key} value={(ov['n_' + key] || 0).toLocaleString('en-GB')} label={`${label} (${percent(ov['n_' + key] || 0, ov.n_total)}%)`} />)}
                    </>}
                    chartTitle="Outcomes by publication venue" chartId="pub-chart" groups={VENUES} deps={deps}
                    caveat="Publication-venue status is derived from the report venue recorded in FLoRA, classified as above. Some studies currently classified as preprints may since have been formally published in a different venue without FLoRA yet reflecting that update. Any outcome differences between these groups should also not be read as caused by publication venue alone: constructive peer review, a tendency for more selective journals to accept more polished work, and publication-pressure effects — for example a bias toward reporting positive or successful results in order to get published, or conversely extra editorial scrutiny catching more issues before publication — could all plausibly produce real differences independent of, or entangled with, venue itself."
                    studies={{title: 'All studies with publication-status data', headers: ['Study', 'Journal', 'Status', 'Year', 'Outcome', 'DOI'],
                        rows: Array.isArray(pub?.pub_studies) ? pub.pub_studies : [],
                        cells: s => [s.title_r, s.journal_r, <span className="badge badge-unknown">{VENUE_LABELS[s.pub_status] || 'Unknown venue'}</span>, s.year_r, s.outcome, <UrlOrDoi url={s.url_r} doi={s.doi_r} />]}} />
            </div>
        </div>

        <DataStamp source="rr_status" />
        <div className="card">
            <h2 className="card-header">Publication Format: Registered Reports vs. Other {k('Replications', 'Reproductions', 'Reproductions')}</h2>
            <div className="card-body">
                <p style={{marginBottom: '0.75rem'}}>
                    This analysis checks whether each {repText} in FLoRA was itself published as a{' '}
                    <strong>Registered Report</strong> (RR): a format in which the study design and
                    analysis plan are peer-reviewed and provisionally accepted <em>before</em> results
                    are known. Matching is done by DOI/title against the{' '}
                    <ExternalLink href="https://github.com/LukasRoeseler/RRDB">Registered Reports database</ExternalLink>,
                    a regularly updated export of the FORRT Zotero "Registered Reports" group library.
                    Pairs whose {repText} report matches the Registered Reports database form the <strong>Registered Report</strong> group;
                    identifiable non-matches form the <strong>Not found in RR database</strong> group. Pairs without a report DOI or title remain unknown and are excluded from the comparison.
                </p>
                <p style={{marginBottom: '0.75rem'}}>
                    Because the Registered Reports database is itself a work in progress, “Not found in RR database” means{' '}
                    <em>not (yet) found</em> in the database, rather than confirmed non-RR.
                </p>
                <CiteBlock label="Registered Reports data source"><div className="cite-ref">Montoya, A. K., Krenzer, W. L. D., Buchanan, E. M., Pronizius, E., Wang, Y. A., Morillo, D., … Armstrong, C. (2026, May 14). <em>Database of Published Registered Reports</em>. <ExternalLink href="https://doi.org/10.17605/OSF.IO/VUR72">https://doi.org/10.17605/OSF.IO/VUR72</ExternalLink></div></CiteBlock>
                <Section prefix="rr" status={status} d={rr} kind={kind} insufficient="checked against the Registered Reports database" error={data?.rr.error} errorLabel="Failed to load Registered Reports data."
                    overview={ov => <>
                        <Stat value={(ov.n_total || 0).toLocaleString()} label={`${pairs} pairs checked`} />
                        <Stat value={(ov.n_rr || 0).toLocaleString()} label={`Registered Reports (${percent(ov.n_rr, ov.n_total)}%)`} />
                        <Stat value={(ov.n_non_rr || 0).toLocaleString()} label={`Not found in RR database (${percent(ov.n_non_rr, ov.n_total)}%)`} />
                        <Stat value={(ov.n_unknown || 0).toLocaleString()} label="Not checkable" />
                    </>}
                    chartTitle={`${k('Replication outcomes', 'Computational verdicts', 'Robustness verdicts')} by Registered Report status`} chartId="rr-chart" groups={RR_GROUPS} deps={deps}
                    caveat={k('Which studies get accepted as Registered Reports is not random — journals and reviewers may favour proposals with designs they expect to be highly powered, well-specified, or otherwise likely to replicate cleanly, regardless of format. Any difference in outcomes between RR and non-RR replications could therefore reflect the RR process itself, selection into that process, discipline/topic composition, or some mixture of all three. Coverage of the RR library is also incomplete, so the ‘Not found in RR database’ group likely still contains some unlabelled Registered Reports.',
                        'Selection into the Registered Report format is not random. Differences between database-matched and unmatched pairs may reflect selection, discipline or topic as well as the review process. These descriptive comparisons do not establish an effect of the format.',
                        'Selection into the Registered Report format is not random. Differences between database-matched and unmatched pairs may reflect selection, discipline or topic as well as the review process. These descriptive comparisons do not establish an effect of the format.')}
                    studies={{title: `Reference pairs whose ${rep} report matches the Registered Reports database`,
                        headers: [`${k('Replication', 'Reproduction', 'Reproduction')} report`, 'Journal', 'Year', 'Outcome', 'DOI'],
                        rows: Array.isArray(rr?.rr_studies) ? rr.rr_studies : [],
                        cells: s => [s.title_r, s.journal_r, s.year_r, s.outcome, <UrlOrDoi url={s.url_r} doi={s.doi_r} />]}} />
            </div>
        </div>

        <div className="card">
            <h2 className="card-header">Reports by number of original targets</h2>
            <div className="card-body">
                <p style={{marginBottom: '0.75rem'}}>
                    This analysis groups replication and reproduction reports by their number of recorded original targets.{' '}
                    <strong>Multiple-target reports</strong> contain more than three distinct original targets in the recorded data. The remaining group contains reports with up to three targets and records with missing report identifiers. Target count does not establish the number of laboratories or membership of a coordinated project. Chart percentages count reference pairs; the evidence list counts reports.
                </p>
                <Section prefix="ls" status={status} d={ls} kind={kind} insufficient="with report-size data" error={data?.pub.error} errorLabel="Failed to load project-scale data."
                    overview={ov => <>
                        <Stat value={(ov.n_total || 0).toLocaleString()} label={`${pairs} pairs checked`} />
                        <Stat value={(ov.n_individual || 0).toLocaleString()} label={`Up to 3 targets / unknown (${percent(ov.n_individual, ov.n_total)}%)`} />
                        <Stat value={(ov.n_large_scale || 0).toLocaleString()} label={`Multiple-target report (${percent(ov.n_large_scale, ov.n_total)}%)`} />
                    </>}
                    chartTitle="Outcomes by report size" chartId="ls-chart" groups={LS_GROUPS} deps={deps}
                    caveat="Outcomes reported within the same multiple-target report are not independent data points — they typically share authors, protocol, and incentives, so pooling many results from one report alongside results from reports with fewer targets can understate how clustered those outcomes really are. Multiple-target reports may also differ systematically in rigour, pre-registration, or topic selection from reports with fewer targets, which could itself explain any outcome difference, independent of target count itself."
                    studies={{title: 'Multiple-target reports', headers: ['Project', 'Journal', 'Year', 'Targets', 'Outcome mix', 'DOI'],
                        rows: Array.isArray(ls?.large_scale_studies) ? ls.large_scale_studies : [],
                        cells: s => [s.title_r, s.journal_r, s.year_r, s.n_originals,
                            Object.entries(s.outcome_mix || {}).map(([key, n]) => `${bucketLabels[key] || key}: ${n}`).join(', '), <UrlOrDoi url={s.url_r} doi={s.doi_r} />]}} />
            </div>
        </div>
    </PaneContext.Provider>;
}
