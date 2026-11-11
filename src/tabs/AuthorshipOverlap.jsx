import {useMemo} from 'react';
import {useApp, PaneContext} from '../state/context.jsx';
import {STUDY_TYPE_CHIPS, kindText, studyTypeLabel} from '../lib/outcomes.js';
import {OVERLAP_DATA_URL, ANALYSIS_MIN_N} from '../lib/config.js';
import {percent} from '../lib/chartUtils.js';
import {CiteBlock, DataStamp, KindText, StudyTypeChips, WebsiteCitation} from '../components/Common.jsx';
import {useAnalysisData, fetchJson, Loading, LoadError, Stat, ComparisonChart, kindPairsLabel} from '../components/Analysis.jsx';

const GROUPS = [['overlap', 'Author overlap'], ['no_overlap', 'No author overlap']];
const load = () => fetchJson(OVERLAP_DATA_URL);

export default function AuthorshipOverlap({visited}) {
    const {view, updateView} = useApp();
    const kind = view.aoKind;
    const {status, data, error, version} = useAnalysisData('overlap', 'aoData', visited, load);
    const d = data?.[kind];
    const loaded = status === 'ready';
    const enough = d?.overview && d.overview.n_total >= ANALYSIS_MIN_N;
    const ready = loaded && enough;
    const ov = d?.overview || {};
    const k = (...v) => kindText(kind, ...v);
    const kt = (...v) => <KindText>{k(...v)}</KindText>;
    const rep = k('replication', 'reproduction', 'reproduction');
    const selection = STUDY_TYPE_CHIPS.find(c => c.value === kind).label;
    const pane = useMemo(() => ({sources: ['author_overlap'], selection: [selection]}), [selection]);

    return <PaneContext.Provider value={pane}>
        <h1 className="visually-hidden">Authorship Overlap</h1>
        <DataStamp source="author_overlap" />
        <CiteBlock><div className="cite-ref"><WebsiteCitation /></div></CiteBlock>
        <div className="card">
            <h2 className="card-header">Authorship Overlap and Outcomes</h2>
            <div className="card-body">
                <p style={{marginBottom: '0.75rem'}}>
                    This analysis looks for matching family names between the authors of the <strong>original study</strong>{' '}
                    and of the <strong>{kt('replication', 'reproduction', 'reproduction')} report</strong>. A match may indicate{' '}
                    {kt(<>a <em>same-author replication</em> or <em>self-replication</em></>, <>a <em>same-author reproduction</em></>, <>a <em>same-author reproduction</em></>)}, but does not confirm author identity.
                    Author names are matched by family name (normalised: lowercase, diacritics removed).
                    This may produce <strong>false positives</strong> for common family names when two
                    unrelated researchers share a surname.
                </p>
                <StudyTypeChips id="ao-study-type" label="Authorship Overlap study type" value={kind} onChange={v => updateView({aoKind: v})} />
                <div className="study-type-note">Each reproduction dimension includes only assessed outcomes. Unchecked dimensions are excluded; the numerical and robustness subsets can overlap.</div>
                <div id="ao-placeholder" className="coming-soon-placeholder" style={loaded && !enough ? undefined : {display: 'none'}}>
                    {`Not enough ${studyTypeLabel(kind)} with known authorship yet (n=${d?.overview ? d.overview.n_total : 0}; need at least ${ANALYSIS_MIN_N}).`}
                </div>
                <div id="ao-content">
                    <Loading id="ao-loading" show={status === 'loading' || status === 'idle'} />
                    <div id="ao-overview" className="mc-overview-grid" style={ready ? undefined : {display: 'none'}}>
                        {ready && <>
                            <Stat box value={(ov.n_total || 0).toLocaleString()} label={`${kindPairsLabel(kind)} pairs included`} />
                            <Stat box value={(ov.n_overlap || 0).toLocaleString()} label={`With author overlap (${percent(ov.n_overlap, ov.n_total)}%)`} />
                            <Stat box value={(ov.n_no_overlap || 0).toLocaleString()} label={`Without author overlap (${percent(ov.n_no_overlap, ov.n_total)}%)`} />
                            <Stat box value={(ov.n_unknown || 0).toLocaleString()} label="Overlap unknown" />
                        </>}
                    </div>
                    <div id="ao-chart-card" className="mc-chart-card" style={ready ? {marginTop: '1.25rem'} : {display: 'none', marginTop: '1.25rem'}}>
                        <h3 className="mc-chart-title">{k('Replication outcomes', 'Computational verdicts', 'Robustness verdicts')} by authorship overlap</h3>
                        {ready && <ComparisonChart id="ao-chart" title={`${k('Replication outcomes', 'Computational verdicts', 'Robustness verdicts')} by authorship overlap`}
                            kind={kind} groups={GROUPS} by={d.by_outcome} deps={[d, kind, version]} />}
                    </div>
                    <div id="ao-caveat" style={ready ? {marginTop: '1rem'} : {display: 'none', marginTop: '1rem'}}>
                        <div className="key-distinction">
                            <strong>Interpretation caveat:</strong> {k('Authors replicating their own work may bring unique methodological knowledge and access to original materials, which could improve replication success. At the same time, they may have a conflict of interest in publicly reporting inconsistent results. Both effects can operate simultaneously, making the direction of bias difficult to predict.',
                                'Author involvement may affect access to materials, analytical choices and reporting. These comparisons do not establish that author overlap affects the recorded verdict.',
                                'Author involvement may affect access to materials, analytical choices and reporting. These comparisons do not establish that author overlap affects the recorded verdict.')}
                        </div>
                    </div>
                    <LoadError id="ao-error" error={error}>Failed to load authorship overlap data.</LoadError>
                </div>
            </div>
        </div>
    </PaneContext.Provider>;
}
