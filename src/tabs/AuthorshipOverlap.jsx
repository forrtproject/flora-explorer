import {useMemo} from 'react';
import {ANALYSIS_MIN_N, URLS} from '../lib/config.js';
import {percent} from '../lib/format.js';
import {kindNoun, kindPairCount, outcomeBuckets, studyTypeLabel} from '../lib/outcomes.js';
import {coverageText} from '../lib/coverage.js';
import {setHook} from '../lib/hooks.js';
import {useData, useJson} from '../state/data.jsx';
import {useEnv} from '../state/env.jsx';
import {useView} from '../state/view.jsx';
import {Plot, comparisonSpec} from '../components/charts.jsx';
import {Callout, Note, Section} from '../components/ui.jsx';
import {Caveat, Chips, CiteBlock, DataStamp, Pane, Placeholder, StatTiles, WebsiteCitation, byKind, kindLabel, repWord} from '../components/common.jsx';

const GROUPS = {overlap: 'Author overlap', no_overlap: 'No author overlap'};

export default function AuthorshipOverlap() {
    const {view, setView} = useView();
    const {theme, rev} = useEnv();
    const {rows} = useData();
    const kind = view.aoKind;
    const {data, error} = useJson(URLS.overlap, view.tab === 'overlap-tab');
    setHook('_aoData', () => data);
    const d = data?.[kind], ov = d?.overview;
    const enough = ov && ov.n_total >= ANALYSIS_MIN_N;
    const coverage = enough ? coverageText(ov.n_total || 0, kindPairCount(rows, kind), [[ov.n_unknown || 0, 'with authorship overlap unknown']], kindNoun(kind), kind) : '';
    const spec = useMemo(() => enough ? {...comparisonSpec(outcomeBuckets(kind), Object.keys(GROUPS), GROUPS, d.by_outcome), coverage} : null, [enough, d, kind, theme, rev, coverage]);
    const word = repWord(kind);
    const chartTitle = `${byKind(kind, ['Replication outcomes', 'Computational reproducibility', 'Robustness'])} by authorship overlap`;
    return (
        <Pane id="authorship-overlap" tabId="overlap-tab" sources={['author_overlap']} selection={[kindLabel(kind)]} kind={kind}
            title={{heading: 'Authorship Overlap', lede: 'Whether outcomes differ when a repetition shares a family name with the authors of the original study.'}}>
            <div className="pane-meta">
                <DataStamp source="author_overlap" />
                <CiteBlock><div className="cite-ref"><WebsiteCitation /></div></CiteBlock>
            </div>
            <Section title="Authorship overlap and outcomes" notes={<>
                <p>
                    This analysis looks for matching family names between the authors of the <strong>original study</strong> and of the <strong>{word} report</strong>. A match may indicate {kind === 'replication' ? <>a <em>same-author replication</em> or <em>self-replication</em></> : <>a <em>same-author reproduction</em></>}, but does not confirm author identity.
                    Author names are matched by family name (normalised: lowercase, diacritics removed). This may produce <strong>false positives</strong> for common family names when two unrelated researchers share a surname.
                </p>
                <Note>Numerical reproductions include reference pairs with a computational verdict. Robustness reproductions include reference pairs with a robustness verdict. The selections can overlap. Pairs without a verdict on the selected dimension are excluded.</Note>
            </>}>
                <Chips id="ao-study-type" label="Authorship Overlap study type" value={kind} onChange={k => setView({aoKind: k})} />
                <div id="ao-content" className="stack">
                    {!data && !error && <Callout tone="empty" id="ao-loading">Loading analysis…</Callout>}
                    {error && <Callout tone="caution" id="ao-error">Failed to load authorship overlap data. <code id="ao-error-detail">{error}</code></Callout>}
                    {data && !enough && <Placeholder id="ao-placeholder">Not enough {studyTypeLabel(kind)} with known authorship yet (n={ov?.n_total || 0}; need at least {ANALYSIS_MIN_N}).</Placeholder>}
                    {enough && <>
                        <StatTiles id="ao-overview" box tiles={[
                            {value: ov.n_total || 0, label: `${kind === 'replication' ? 'Replication' : 'Reproduction'} reference pairs included`},
                            {value: ov.n_overlap || 0, label: `With author overlap (${percent(ov.n_overlap, ov.n_total)}%)`},
                            {value: ov.n_no_overlap || 0, label: `Without author overlap (${percent(ov.n_no_overlap, ov.n_total)}%)`},
                            {value: ov.n_unknown || 0, label: 'Overlap unknown'},
                        ]} />
                        <Plot id="ao-chart" frameId="ao-chart-card" heading={chartTitle} title={chartTitle} spec={spec} note={<Note id="ao-chart-n">{coverage}</Note>} />
                        <Caveat id="ao-caveat">{kind === 'replication'
                            ? 'Authors replicating their own work may bring unique methodological knowledge and access to original materials, which could improve replication success. At the same time, they may have a conflict of interest in publicly reporting inconsistent results. Both effects can operate simultaneously, making the direction of bias difficult to predict.'
                            : 'Author involvement may affect access to materials, analytical choices and reporting. These comparisons do not establish that author overlap affects the recorded verdict.'}</Caveat>
                    </>}
                </div>
            </Section>
        </Pane>
    );
}
