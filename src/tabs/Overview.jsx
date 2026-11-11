import {useCallback, useEffect, useMemo, useState} from 'react';
import {useApp, PaneContext} from '../state/context.jsx';
import {classifyKind, classifyOutcome, reportKindLabel} from '../lib/outcomes.js';
import {truncateText, shortAuthors} from '../lib/format.js';
import {renderFaqAnswer, renderInlineMd} from '../lib/faq.js';
import {loadFaqs} from '../state/data.js';
import {FAQ_PAGE_URL, WEBSITE_CITATION_PLAIN} from '../lib/config.js';
import {registerRenderer} from '../testHooks.js';
import {OutcomeChartRow} from '../components/OutcomeChartRow.jsx';
import {CiteBlock, DataStamp, DatasetCitation, ExternalLink, OutcomeBadge, REUSE_TEXT, WebsiteCitation} from '../components/Common.jsx';

const PANE = {sources: ['flora'], selection: []};

export default function Overview() {
    const {rows, tabLink} = useApp();
    const counts = useMemo(() => ({
        replication: rows.filter(r => classifyKind(r) === 'replication').length,
        reproduction: rows.filter(r => classifyKind(r) === 'reproduction').length,
    }), [rows]);
    return <PaneContext.Provider value={PANE}>
        <section className="explorer-intro"><h1>Explore replication and reproduction evidence</h1>
            <p>The <strong>FORRT Library of Reproduction and Replication Attempts (FLoRA)</strong> is a project of the Framework for Open and Reproducible Research Training (FORRT).</p>
            <p>Find original reports, attempts to repeat them, and the evidence behind each recorded outcome. Each row is a <strong>reference pair</strong>: one original report and one repetition report. A report can occur in several pairs. Use <a href="?tab=browse" data-tab-link="browse-tab" onClick={tabLink('browse-tab')}>Browse Studies</a> to search and filter reference pairs here, or the <a href="https://forrt.org/flora-replication-atlas/" target="_blank" rel="noopener noreferrer">Replication Atlas</a> to see the replication history of one original study.</p>
        </section>
        <DataStamp source="flora" />

        <div className="row mb-3">
            {[['ov-total', rows.length, 'Reference pairs'], ['ov-replications', counts.replication, 'Replications'], ['ov-reproductions', counts.reproduction, 'Reproductions']].map(([id, n, label]) =>
                <div className="col-6 col-md-4" key={id}><div className="stats-card"><div className="number" id={id}>{n.toLocaleString()}</div><div className="label">{label}</div></div></div>)}
        </div>

        <CiteBlock label={<>How to cite &amp; re-use guidelines</>}>
            <p className="reuse-text">{REUSE_TEXT}</p>
            <div className="cite-ref" id="citation-text-top"><DatasetCitation /></div>
            <div className="cite-ref"><WebsiteCitation /></div>
        </CiteBlock>

        <div className="card">
            <h2 className="card-header">Outcome Breakdown</h2>
            <div className="card-body">
                <p className="coverage-caution">FLoRA’s coverage is incomplete and uneven across fields, languages and venues. These shares describe recorded entries; they do not estimate how often research in general replicates or reproduces. <a href="#flora-coverage">Coverage limits</a></p>
                <OutcomeChartRow canvasId="overview-computational-chart" captionId="overview-computational-caption" kind="computational" data={rows} eligible={counts.reproduction}
                    tip={<>Covers <strong>reproductions only</strong>: were the original results obtained? Reproduction coverage is still small, so this chart will fill in as more are added.</>} />
                <OutcomeChartRow canvasId="overview-robustness-chart" captionId="overview-robustness-caption" kind="robustness" data={rows} eligible={counts.reproduction}
                    tip={<>Covers <strong>reproductions only</strong>: do results hold under alternative analysis choices? Not every reproduction has a robustness check yet.</>} />
                <OutcomeChartRow canvasId="overview-outcome-chart" captionId="overview-outcome-caption" kind="replicability" data={rows} eligible={counts.replication}
                    tip={<>Currently, this distribution covers <strong>replications only</strong>. Reproductions are shown separately above, since they're coded along different dimensions.</>} />
            </div>
        </div>

        <div className="row">
            <div className="col-lg-7">
                <AboutCard />
                <div className="card">
                    <h2 className="card-header">FAQs</h2>
                    <div className="card-body">
                        <p style={{color: 'var(--color-text-secondary)', marginBottom: '1rem'}}>
                            If anything is unclear, here is where we collect frequently asked questions. The list is loaded live from the{' '}
                            <ExternalLink href={FAQ_PAGE_URL}>FLoRA FAQ document</ExternalLink> and grows as new questions come in.
                        </p>
                        <Faqs />
                    </div>
                </div>
            </div>
            <div className="col-lg-5">
                <ToolsCard />
                <RandomExamples rows={rows} />
            </div>
        </div>

        <div className="card">
            <h2 className="card-header">Recommended Citation</h2>
            <div className="card-body">
                <p className="mb-2 note">If you use the underlying dataset, please cite it as:</p>
                <div className="citation-box" id="citation-box">
                    <CopyButton id="citation-copy-btn" label="Copy dataset citation" text={() => document.getElementById('citation-text').dataset.plain || document.getElementById('citation-text').textContent} />
                    <CitationText />
                </div>
                <p className="mt-4 mb-2 note">If you report results based on this website, please cite it as:</p>
                <div className="citation-box" id="website-citation-box">
                    <CopyButton id="website-citation-copy-btn" label="Copy website citation" text={() => WEBSITE_CITATION_PLAIN} />
                    <div id="website-citation-text"><WebsiteCitation /></div>
                </div>
            </div>
        </div>
    </PaneContext.Provider>;
}

function CitationText() {
    const {citation} = useApp();
    return <div id="citation-text" data-plain={citation && !citation.error ? citation.plain : undefined}><DatasetCitation /></div>;
}

function CopyButton({id, label, text}) {
    const [copied, setCopied] = useState(false);
    const copy = () => navigator.clipboard.writeText(text()).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
    return <button className="copy-btn" id={id} aria-label={label} onClick={copy}>{copied ? 'Copied!' : 'Copy'}</button>;
}

function Faqs() {
    const [state, setState] = useState({status: 'loading'});
    const [open, setOpen] = useState(() => new Set());
    useEffect(() => {
        loadFaqs().then(items => setState({status: 'ready', items}), err => { console.error('FAQ load failed:', err); setState({status: 'error'}); });
    }, []);
    if (state.status === 'loading') return <div id="faq-loading" className="note">Loading FAQs…</div>;
    if (state.status === 'error') return <div id="faq-error" className="note">Could not load FAQs at the moment. You can read them directly on <ExternalLink href={FAQ_PAGE_URL}>GitHub</ExternalLink>.</div>;
    const toggle = i => setOpen(s => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });
    return <div id="faq-content">{state.items.map((it, i) => it.type === 'section'
        ? <div className="faq-section" key={i}>
            <h3 className="faq-section-title" dangerouslySetInnerHTML={{__html: renderInlineMd(it.text)}} />
            {it.body?.some(l => l.trim()) && <div className="faq-section-intro" dangerouslySetInnerHTML={{__html: renderFaqAnswer(it.body)}} />}
        </div>
        : <div className={'faq-item' + (open.has(i) ? ' open' : '')} key={i}>
            <button type="button" className="faq-question" aria-expanded={open.has(i)} onClick={() => toggle(i)}>
                <svg className="faq-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 6 15 12 9 18"/></svg>
                <span dangerouslySetInnerHTML={{__html: renderInlineMd(it.question).replace(/<a [^>]*>|<\/a>/g, '')}} />
            </button>
            <div className="faq-answer" dangerouslySetInnerHTML={{__html: renderFaqAnswer(it.body)}} />
        </div>)}</div>;
}

function shuffleExamples(data) {
    const pool = data.filter(r => (r.title_o || r.author_o) && r.outcome);
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, 4);
}

function StudyLink({doi, url, children}) {
    const href = doi ? (doi.startsWith('http') ? doi : `https://doi.org/${doi}`) : url || '';
    if (href) return <a href={href} target="_blank" rel="noopener" className="ex-link " title={`Open ${href}`}>{children}</a>;
    return <span className="ex-link ex-link-disabled ">{children}</span>;
}

function ExampleLine({label, title, meta}) {
    return <><span className="ex-line-label">{label}</span>
        <span className="ex-line-title">{truncateText(title, 110)}</span>
        {meta && <span className="ex-line-meta">{meta}</span>}</>;
}

function RandomExamples({rows}) {
    const [examples, setExamples] = useState(() => shuffleExamples(rows));
    const reshuffle = useCallback(data => setExamples(shuffleExamples(data)), []);
    useEffect(() => registerRenderer('randomExamples', reshuffle), [reshuffle]);
    useEffect(() => reshuffle(rows), [rows, reshuffle]);
    return <div className="card">
        <div className="card-header d-flex justify-content-between align-items-center">
            <span>Random Examples</span>
            <button id="reshuffle-btn" className="refresh-btn" title="Shuffle examples" onClick={() => reshuffle(rows)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>
                Shuffle
            </button>
        </div>
        <div className="card-body" id="random-examples">
            {examples.length === 0 ? <p className="text-muted">No examples available.</p> : examples.map((r, i) => {
                const meta = (a, y) => [shortAuthors(a), y].filter(Boolean).join(' · ');
                const hasRep = !!(r.title_r || r.author_r || r.doi_r || r.url_r);
                return <div className={`example-card outcome-${classifyOutcome(r.outcome)}`} key={i}>
                    <StudyLink doi={r.doi_o}><ExampleLine label="Original" title={r.title_o || `${shortAuthors(r.author_o)} (${r.year_o || 'n.d.'})`} meta={meta(r.author_o, r.year_o)} /></StudyLink>
                    {hasRep && <StudyLink doi={r.doi_r} url={r.url_r}><ExampleLine label={reportKindLabel(r)} title={r.title_r || `${shortAuthors(r.author_r)} (${r.year_r || 'n.d.'})`} meta={meta(r.author_r, r.year_r)} /></StudyLink>}
                    <div className="ex-outcome"><OutcomeBadge outcome={r.outcome} />{r.type && <span className="badge bg-light text-dark">{r.type}</span>}</div>
                </div>;
            })}
        </div>
    </div>;
}

function AboutCard() {
    return <div className="card">
        <h2 className="card-header">About FLoRA</h2>
        <div className="card-body intro-text">
            <h3>What is the aim of this project?</h3>
            <p>FLoRA tracks <strong>numerical reproductions</strong>, <strong>robustness reproductions</strong>, and <strong>replications</strong>, linking each one to the original publication it tests. The goal is to increase the findability of repetition attempts and to enable meta-research on the repeatability of scientific findings, across disciplines, journals, and time.</p>
            <p>Unlike the <ExternalLink href="https://forrt.org/FReD/">FORRT Replication Database (FReD)</ExternalLink>, FLoRA does not include statistical data. This lets it cover every field of research across the sciences and humanities and allows much faster expansion.</p>
            <h3>What is a replication?</h3>
            <p>Replications intentionally repeat prior research to test whether the original findings hold. To be included in FLoRA, a study must:</p>
            <ul>
                <li>Self-identify as a replication <em>before</em> reporting results: replication must be an aim, not just a result</li>
                <li>Identify a specific target study (or studies)</li>
                <li>Replicate a study or experiment: a central claim, not just any empirical pattern</li>
            </ul>
            <p>Replications range from <strong>close/direct</strong> (same methods, same population) to <strong>conceptual</strong> (same hypothesis, different methods). Most outcomes are tagged <strong>Successful</strong>, <strong>Failed</strong>, or <strong>Mixed</strong> based on how the replication authors characterise their results. A few are recorded as <strong>Successful but flawed</strong>, and some as other or not yet coded (for example, descriptive only); charts show these separately.</p>
            <h3>What is a reproduction?</h3>
            <p>Reproductions verify whether reported results can be obtained from the original study's data and methods. They are coded on two dimensions:</p>
            <ul>
                <li><strong>Computational success</strong>: were the original results obtained? (Computationally Successful, Computational Issues, or Technical Failure)</li>
                <li><strong>Robustness</strong>: do results hold under reasonable alternative specifications? (Robust or Robustness Challenges)</li>
            </ul>
            <p>The two dimensions are assessed independently, and not every reproduction is assessed on both. Each chart counts reference pairs with a verdict on that dimension. ‘Not checked’ and uncoded values are excluded. A pair can appear in both charts.</p>
            <div className="key-distinction">
                <strong>Key distinction:</strong> If new data are collected (e.g. an additional decade of observations), it's a <em>replication</em>. If the same data are re-analysed to verify the original results, it's a <em>reproduction</em>.
            </div>
            <h3>Structure of FLoRA</h3>
            <p>FLoRA links each repetition reference to its original, and assigns a standardised outcome based on the repetition report. This simple structure lets us describe recorded replication and reproduction outcomes across time, disciplines and venues, and powers tools like the FLoRA Zotero Plugin, which lists replication and reproduction attempts for any reference you provide.</p>
            <h3 id="flora-coverage">Is FLoRA representative and comprehensive?</h3>
            <p>Honestly — neither. We are still working on a systematic literature search, and several structural factors limit coverage:</p>
            <ul>
                <li>Some replications cannot be added because they do not self-identify as such in the metadata we can reach (e.g., the title and abstract).</li>
                <li>In some areas of computational reproduction (for example, <ExternalLink href="https://codecheck.org.uk/">CODECHECK</ExternalLink> certificates), the artefacts are typically only issued for <em>successful</em> numerical reproductions, which makes representative estimates of computational reproducibility difficult.</li>
                <li>Coverage by discipline, language, and publication venue is uneven and reflects where contributors have focused so far.</li>
            </ul>
            <p>Treat aggregate statistics as exploratory rather than definitive, and please <ExternalLink href="https://forrt.org/replication-hub/submit/">submit missing entries</ExternalLink> when you spot them.</p>
            <p>FLoRA is the product of years of work by a large community of volunteers. If you'd like to contribute or use the data for your own research, <ExternalLink href="https://forrt.org/replication-hub/">please reach out</ExternalLink>.</p>
        </div>
    </div>;
}

const TOOLS = [
    ['https://forrt.org/flora-replication-atlas/', 'Replication Atlas', "Look up a specific study by DOI, title, or author to see if it's been replicated.", <><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></>],
    ['https://forrt.org/replication-hub/', 'FORRT Replication Hub', 'The broader ecosystem of replication resources and projects at FORRT.', <><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></>],
    ['https://replicationresearch.org', 'Replication Research', 'Our new Diamond Open Access journal publishing high-quality reproductions, replications, and conceptual articles.', <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M9 7h6M9 11h6"/></>],
    ['https://forrt.org/flora_zotero', 'FLoRA Zotero Plugin', 'See replication attempts for references in your Zotero library, right in your reference manager.', <><path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></>],
    ['https://github.com/forrtproject/FReD-data', 'Data on GitHub', 'Raw FLoRA/FReD data, update history, and contribution guide.', null],
    ['https://osf.io/9r62x/', 'OSF Project Page', 'Dataset DOI, versions, and supplementary materials on OSF.', <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 7h10M7 12h10M7 17h6"/></>],
    ['https://lukasroeseler.github.io/GuessTheReplication/', 'Guess the Replication', 'Can you predict replication outcomes? Play the game and find out.', <><rect x="2" y="6" width="20" height="12" rx="6"/><line x1="7" y1="12" x2="9" y2="12"/><line x1="8" y1="11" x2="8" y2="13"/><circle cx="15.5" cy="11" r="0.8" fill="currentColor"/><circle cx="17.5" cy="13" r="0.8" fill="currentColor"/></>],
];
const GITHUB_ICON = <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 .3a12 12 0 0 0-3.8 23.38c.6.12.83-.26.83-.57v-2c-3.34.72-4.04-1.6-4.04-1.6-.55-1.39-1.34-1.76-1.34-1.76-1.08-.74.09-.73.09-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.8 1.3 3.5 1 .1-.78.42-1.3.76-1.6-2.67-.3-5.48-1.33-5.48-5.93 0-1.31.47-2.38 1.23-3.22-.12-.3-.53-1.52.12-3.17 0 0 1-.32 3.28 1.23a11.42 11.42 0 0 1 6 0c2.28-1.55 3.28-1.23 3.28-1.23.65 1.65.24 2.87.12 3.17.77.84 1.23 1.9 1.23 3.22 0 4.6-2.81 5.63-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .31.22.69.83.57A12 12 0 0 0 12 .3"/></svg>;

function ToolsCard() {
    return <div className="card">
        <h2 className="card-header">More Replication Tools</h2>
        <div className="card-body">
            {TOOLS.map(([href, title, desc, icon]) => <a className="tool-tile" href={href} target="_blank" rel="noopener noreferrer" key={href}>
                <div className="tool-icon">{icon ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{icon}</svg> : GITHUB_ICON}</div>
                <div className="tool-body"><div className="tool-title">{title}</div><div className="tool-desc">{desc}</div></div>
            </a>)}
        </div>
    </div>;
}
