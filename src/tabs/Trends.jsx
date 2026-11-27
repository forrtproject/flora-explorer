import {useMemo} from 'react';
import {POOL_BEFORE, REPORT_POOL_BEFORE, byField, byJournal, byYear, journalKey, trendCoverage, yearKey} from '../lib/aggregate.js';
import {nPairs} from '../lib/coverage.js';
import {BROWSE_KIND_LABELS} from '../lib/config.js';
import {filterByKind, outcomeBuckets} from '../lib/outcomes.js';
import {setHook} from '../lib/hooks.js';
import {useData} from '../state/data.jsx';
import {useEnv, usePane} from '../state/env.jsx';
import {useView} from '../state/view.jsx';
import {GROUP_MIN_N, barTable, horizontalBarHeight, stackedBarOption} from '../lib/charts.js';
import {ChartCopy, ChartData, EChart} from '../components/charts.jsx';
import {Figure, ModeToggle, Note, Section} from '../components/ui.jsx';
import {CiteBlock, DataStamp, KindFilter, Pane, byKind4, kindLabel, repWord} from '../components/common.jsx';

// sharesToggle: the chart can show each category's outcomes as within-category percentages (the default) or counts.
function TrendBlock({id, title, agg, kind, eligible, horizontal, minHeight, coverage, sharesToggle, children}) {
    const pane = usePane();
    const {view, setView} = useView();
    // tick re-renders on resize, so the wrapped-label height below follows the window.
    const {theme} = useEnv();
    const shares = Boolean(sharesToggle) && !view.fieldCounts;
    const buckets = useMemo(() => outcomeBuckets(kind), [kind, theme]);
    const series = useMemo(() => buckets.map(b => ({name: b.label, color: b.color, values: agg.map(r => r.counts[b.key] || 0)})), [agg, buckets]);
    // Percentages hide group size, so each category's N sits on its own line beneath the name and stays visible on phones.
    const categories = useMemo(() => agg.map((r, i) => shares ? `${r.key}\n(N=${series.reduce((n, s) => n + s.values[i], 0).toLocaleString('en-GB')})` : r.key), [agg, series, shares]);
    // Long field and journal names break down the side; a pooled first column gets a dashed rule after it.
    const option = useMemo(() => ({width}) => stackedBarOption({categories,
        series, horizontal, pooledFirst: Boolean(agg[0]?.pooled), width, shares}), [agg, categories, series, horizontal, shares]);
    const table = useMemo(() => barTable(agg.map(r => r.key), series, eligible, 'counts'), [agg, series, eligible]);
    // Name charts size themselves from the width they get: every row needs room for the longest name.
    const heightFor = useMemo(() => horizontal ? width => Math.max(minHeight || 0, horizontalBarHeight(categories, series.filter(s => s.values.some(v => v > 0)).map(s => s.name), width)) : undefined,
        [horizontal, categories, series, minHeight]);
    return (
        <Section className="trend-block" notesClass="trend-desc" level={3} title={title} notes={children}>
            <Figure note={<Note id={id + '-n'}>{coverage}</Note>} actions={<>
                {sharesToggle && <ModeToggle id={id + '-mode'} on={!shares} label={`Show counts instead of percentages for ${title}`} onToggle={() => setView(prev => ({fieldCounts: !prev.fieldCounts}))} />}
                <ChartCopy id={id} title={title} table={table} />
            </>}>
                {/* Year charts keep their proportions as they widen; name charts grow with their row count. */}
                <div className="chart-box" id={id + '-container'} style={{height: 'auto'}}>
                    {pane.visited && (horizontal ? <EChart id={id} title={title} option={option} height={minHeight} heightFor={heightFor} /> : <EChart id={id} title={title} option={option} height={360} aspect={0.38} />)}
                </div>
                <ChartData id={id} title={title} table={table} />
            </Figure>
        </Section>
    );
}

function TopN({id, value, onChange, noun}) {
    return (
        <div className="top-n">
            <label htmlFor={id} className="note">Show top:</label>
            <select id={id} className="form-select" value={value} onChange={e => onChange(e.target.value)}>
                {[10, 15, 25, 50].map(n => <option key={n} value={n}>{n} {noun}</option>)}
            </select>
        </div>
    );
}

export default function Trends() {
    const {rows, disciplineFor} = useData();
    const {view, setView} = useView();
    const {rev} = useEnv();
    const kind = view.trendsKind;
    const data = useMemo(() => filterByKind(rows, kind), [rows, kind, rev]);
    const origYear = useMemo(() => byYear(data, 'year_o', kind, POOL_BEFORE), [data, kind]);
    const repYear = useMemo(() => byYear(data, 'year_r', kind, REPORT_POOL_BEFORE), [data, kind]);
    const journals = useMemo(() => byJournal(data, 'journal_o', Number(view.journalTopN), kind), [data, kind, view.journalTopN]);
    const venues = useMemo(() => byJournal(data, 'journal_r', Number(view.repJournalTopN), kind), [data, kind, view.repJournalTopN]);
    const fields = useMemo(() => byField(data, kind, disciplineFor), [data, kind, disciplineFor]);
    const notes = useMemo(() => {
        const top = (agg, noun) => ({keys: new Set(agg.map(g => g.key)), noun});
        return {
            origYear: trendCoverage(data, yearKey('year_o'), kind, 'original publication year'),
            repYear: trendCoverage(data, yearKey('year_r'), kind, 'report year'),
            journals: trendCoverage(data, journalKey('journal_o'), kind, 'original journal', top(journals, 'journals')),
            venues: trendCoverage(data, journalKey('journal_r'), kind, 'report venue', top(venues, 'venues')),
            fields: trendCoverage(data, row => disciplineFor(row.journal_o), kind, 'field'),
        };
    }, [data, kind, journals, venues, disciplineFor]);
    setHook('trendsFilteredData', () => data);

    const all = kind === 'all';
    const subject = all ? 'Reference pairs' : 'Outcomes';
    const word = all ? 'replication or reproduction' : repWord(kind);
    const attempt = byKind4(kind, ['replication', 'numerical reproduction', 'robustness reproduction', 'replication or reproduction']);
    const count = all ? nPairs(data.length) : `${data.length.toLocaleString('en-GB')} of ${nPairs(rows.length)}`;
    const common = {kind, eligible: data.length};
    return (
        <Pane id="trends" tabId="trends-tab" sources={['flora']} selection={[kindLabel(kind)]} kind={kind}
            title={{heading: 'Years & Disciplines', lede: 'How recorded outcomes are spread across publication years, journals, venues and research fields.'}}>
            <h2 className="visually-hidden">Outcome summaries</h2>
            <div className="pane-meta">
                <DataStamp source="flora" />
                <CiteBlock><div className="cite-ref">Röseler, L. et al. (in preparation). <em>The FORRT Library of Reproduction and Replication Attempts: Documenting the Reproducibility and Replicability of the Sciences and Humanities.</em></div></CiteBlock>
            </div>
            <KindFilter value={kind} onChange={k => setView({trendsKind: k})} countId="trend-filter-count" live
                count={<><span className="visually-hidden">{BROWSE_KIND_LABELS[kind]}: </span>{count}</>} />
            <p id="trends-all-note" hidden={!all}>Replications and reproductions record outcomes in different categories, so with All selected each bar is split by study type instead of by outcome. Choose a single study type to see outcome breakdowns.</p>

            <div id="trends-charts">
                <TrendBlock id="trend-orig-year" coverage={notes.origYear} title={`${subject} by original study year`} agg={origYear} {...common}>
                    <p>{byKind4(kind, [
                        <>How have findings from different eras fared when researchers tried to replicate them? Each bar groups replication reference pairs by the year the <strong>original</strong> study was published, split by recorded replication outcome.</>,
                        <>How have findings from different eras fared when researchers tried to reproduce them by re-analysing the original data? Each bar groups numerical-reproduction reference pairs by the year the <strong>original</strong> study was published, split by computational verdict.</>,
                        <>How have findings from different eras held up under alternative analysis choices? Each bar groups robustness-reproduction reference pairs by the year the <strong>original</strong> study was published, split by robustness verdict.</>,
                        <>How has research from different eras been checked? Each bar groups all reference pairs by the year the <strong>original</strong> study was published, split by whether the attempt was a replication or a reproduction.</>,
                    ])}</p>
                    <p id="trend-orig-year-axis-note">{origYear[0]?.pooled
                        ? `Pairs with original studies published before ${POOL_BEFORE} are sparse and are pooled into the first column, set apart by a dashed line. From ${POOL_BEFORE} the axis runs year by year, so years without any recorded pair appear as gaps.`
                        : 'The axis runs year by year, so years without any recorded pair appear as gaps and elapsed time keeps its scale.'}</p>
                </TrendBlock>

                <TrendBlock id="trend-rep-year" coverage={notes.repYear} title={`${subject} by ${word} report year`} agg={repYear} {...common}>
                    <p>Grouped by the year of the <strong>{word}</strong> report itself, this view shows the growth of FLoRA's coverage and how {all ? 'the mix of study types has' : 'outcome profiles have'} shifted over time.</p>
                    <p>The rightmost years may reflect ongoing data entry rather than a genuine decline in activity.</p>
                    <p id="trend-rep-year-axis-note">{repYear[0]?.pooled
                        ? `Reports published before ${REPORT_POOL_BEFORE} are sparse and are pooled into the first column, set apart by a dashed line. From ${REPORT_POOL_BEFORE} the axis runs year by year.`
                        : 'The axis runs year by year, so years without any recorded pair appear as gaps and elapsed time keeps its scale.'}</p>
                </TrendBlock>

                <TrendBlock id="trend-journal" coverage={notes.journals} title={`${subject} by original journal`} agg={journals} horizontal minHeight={Math.max(400, journals.length * 36)} {...common}>
                    <p>The journals whose articles have most frequently been the target of {attempt} attempts. {all ? 'For each journal, the bar shows how many of those attempts were replications and how many were reproductions.' : 'For each journal, the bar shows the outcome breakdown of those attempts.'}</p>
                    <p>{byKind4(kind, [
                        "Frequency shows where replication effort has gone, not how replicable a journal's research is.",
                        "Frequency shows where reproduction effort has gone, not how reproducible a journal's research is.",
                        "Frequency shows where reproduction effort has gone, not how robust a journal's research is.",
                        "Frequency shows where replication and reproduction effort has gone, not how replicable or reproducible a journal's research is.",
                    ])}</p>
                    <TopN id="journal-top-n" value={view.journalTopN} onChange={v => setView({journalTopN: v})} noun="journals" />
                </TrendBlock>

                <TrendBlock id="trend-rep-journal" coverage={notes.venues} title={`${subject} by recorded ${word} venue`} agg={venues} horizontal minHeight={Math.max(400, venues.length * 36)} {...common}>
                    <p>Each bar groups reference pairs by the venue recorded for the {word} report, which can be a journal or a repository such as OSF, split by {all ? 'study type' : 'recorded outcome'}.</p>
                    <p>Counts reflect FLoRA’s coverage, and one report may contribute several pairs, so bars do not rank how actively venues publish {word} research.</p>
                    <p className="note">Annotation of {word}-journal data is a work in progress; some journals may be missing or under-represented at the moment.</p>
                    <TopN id="rep-journal-top-n" value={view.repJournalTopN} onChange={v => setView({repJournalTopN: v})} noun="venues" />
                </TrendBlock>

                <TrendBlock id="trend-field" coverage={notes.fields} title={`${subject} by field`} agg={fields} horizontal minHeight={Math.max(360, fields.length * 44)} sharesToggle={!all} {...common}>
                    <p>A bird's-eye view grouping reference pairs by research discipline. Each bar shows the {all ? 'study-type breakdown' : 'outcome breakdown'} of {all ? 'replication and reproduction' : attempt} attempts targeting work originally published in journals from that field.</p>
                    {!all && (view.fieldCounts
                        ? <p>Bars show reference-pair counts within each field, so fields with more recorded pairs appear longer. Switch to <em>Percentages</em> to compare within-field outcome shares across fields of different sizes.</p>
                        : <p>Bars show percentages within each field, so fields of different sizes can be compared; N is the number of reference pairs in the field. Fields with fewer than {GROUP_MIN_N} pairs are faded, because their shares are unstable. Switch to <em>Counts</em> to see how many pairs each field has.</p>)}
                    <p>Disciplines are inferred from the original study's journal name using a hand-curated dictionary (<a href="data/disciplines.json" target="_blank" rel="noopener noreferrer" className="doi-link">journal-to-discipline mapping</a>). Journals that have not been mapped yet are collected under <em>Uncategorized</em>.</p>
                    <p className="note">Coverage is still growing. Journals that are not yet classified may leave some fields under-represented.</p>
                </TrendBlock>
            </div>
        </Pane>
    );
}
