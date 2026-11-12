import {useEffect, useMemo, useState} from 'react';
import {URLS, WEBSITE_CITATION} from '../lib/config.js';
import {loadDatasetCitation} from '../lib/cff.js';
import {parseFaqMarkdown, renderFaqAnswer, renderInlineMd} from '../lib/faq.js';
import {shortAuthors, truncate} from '../lib/format.js';
import {classifyKind, classifyOutcome, reportKindLabel} from '../lib/outcomes.js';
import {useData} from '../state/data.jsx';
import {useView} from '../state/view.jsx';
import {CiteBlock, CopyButton, DataStamp, ExternalLink, Icon, OutcomeBadge, OutcomeDefinitions, Pane, WebsiteCitation} from '../components/common.jsx';
import {OutcomeChartRow} from '../components/OutcomeChartRow.jsx';

let citationPromise;
export function useDatasetCitation() {
    const [state, setState] = useState({status: 'loading'});
    useEffect(() => {
        citationPromise ||= loadDatasetCitation();
        citationPromise.then(citation => setState({status: 'ready', citation}), err => { console.error('Citation load failed:', err); setState({status: 'error'}); });
    }, []);
    return state;
}
export function DatasetCitation({state}) {
    if (state.status === 'loading') return 'Loading citation…';
    if (state.status === 'error') return <span className="muted">Could not load live citation. Please see the <ExternalLink href={URLS.cff}>CITATION.cff file</ExternalLink>.</span>;
    const c = state.citation;
    return <>{c.names} ({c.year}). <em>{c.title}</em>{c.version} [Dataset].{c.doi && <> <ExternalLink href={`https://doi.org/${c.doi}`}>https://doi.org/{c.doi}</ExternalLink></>}</>;
}
export const REUSE_TEXT = 'The projects embedded in this website are the work of over two hundred paid and volunteer researchers over more than four years. Please cite the respective works when (re-)using them. If you expect to profit from this work, for example through a grant application based on these data, please consider reaching out to us to involve members of the community.';

const EXAMPLE_SEARCHES = ['power posing', 'ego depletion', 'growth mindset', 'marshmallow test'];

function HeroSearch() {
    const {setView, switchTab} = useView();
    const [query, setQuery] = useState('');
    const go = q => { switchTab('browse-tab'); setView({q, kind: 'all', page: 1, mobilePage: 1}); };
    return (
        <>
            <form className="hero-search" role="search" onSubmit={e => { e.preventDefault(); go(query.trim()); }}>
                <Icon.search />
                <input type="search" aria-label="Search reference pairs" placeholder="Title, author, year or DOI" value={query} onChange={e => setQuery(e.target.value)} autoComplete="off" />
                <button type="submit" className="hero-search-btn">Search pairs</button>
            </form>
            <div className="hero-examples">
                <span className="hero-examples-label">Try</span>
                {EXAMPLE_SEARCHES.map(q => <button type="button" key={q} className="example-chip" onClick={() => go(q)}>{q}</button>)}
            </div>
        </>
    );
}

const TOOLS = [
    {title: 'Replication Atlas', href: URLS.atlas, desc: "Look up a specific study by DOI, title, or author to see if it's been replicated.", icon: <><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></>},
    {title: 'FORRT Replication Hub', href: 'https://forrt.org/replication-hub/', desc: 'The broader ecosystem of replication resources and projects at FORRT.', icon: <><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></>},
    {title: 'Replication Research', href: 'https://replicationresearch.org', desc: 'Our new Diamond Open Access journal publishing high-quality reproductions, replications, and conceptual articles.', icon: <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /><path d="M9 7h6M9 11h6" /></>},
    {title: 'FLoRA Zotero Plugin', href: 'https://forrt.org/flora_zotero', desc: 'See replication attempts for references in your Zotero library, right in your reference manager.', icon: <><path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></>},
    {title: 'Data on GitHub', href: 'https://github.com/forrtproject/FReD-data', desc: 'Raw FLoRA/FReD data, update history, and contribution guide.', icon: <><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" /></>},
    {title: 'OSF Project Page', href: 'https://osf.io/9r62x/', desc: 'Dataset DOI, versions, and supplementary materials on OSF.', icon: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M7 7h10M7 12h10M7 17h6" /></>},
    {title: 'Guess the Replication', href: 'https://lukasroeseler.github.io/GuessTheReplication/', desc: 'Can you predict replication outcomes? Play the game and find out.', icon: <><rect x="2" y="6" width="20" height="12" rx="6" /><line x1="7" y1="12" x2="9" y2="12" /><line x1="8" y1="11" x2="8" y2="13" /><circle cx="15.5" cy="11" r="0.8" fill="currentColor" /><circle cx="17.5" cy="13" r="0.8" fill="currentColor" /></>},
];

function pickExamples(rows) {
    const pool = rows.filter(r => (r.title_o || r.author_o) && r.outcome);
    // Fisher–Yates: unbiased, unlike sorting with a random comparator.
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, 4);
}
function ExampleLine({label, title, meta, doi, url}) {
    const href = doi ? (doi.startsWith('http') ? doi : `https://doi.org/${doi}`) : url || '';
    const inner = <><span className="ex-line-label">{label}</span><span className="ex-line-title">{truncate(title, 110)}</span>{meta && <span className="ex-line-meta">{meta}</span>}</>;
    return href ? <a href={href} target="_blank" rel="noopener" className="ex-link" title={`Open ${href}`}>{inner}</a> : <span className="ex-link ex-link-disabled">{inner}</span>;
}
function RandomExamples({rows}) {
    const [seed, setSeed] = useState(0);
    const examples = useMemo(() => pickExamples(rows), [rows, seed]);
    return (
        <section className="card">
            <div className="card-header card-header-split">
                <h2>Random examples</h2>
                <button id="reshuffle-btn" type="button" className="refresh-btn" title="Shuffle examples" onClick={() => setSeed(n => n + 1)}><Icon.shuffle /> Shuffle</button>
            </div>
            <div className="card-body" id="random-examples">
                {!examples.length && <p className="muted">No examples available.</p>}
                {examples.map((r, i) => (
                    <div className={`example-card outcome-${classifyOutcome(r.outcome)}`} key={i}>
                        <ExampleLine label="Original report" title={r.title_o || `${shortAuthors(r.author_o)} (${r.year_o || 'n.d.'})`} meta={[shortAuthors(r.author_o), r.year_o].filter(Boolean).join(' · ')} doi={r.doi_o} />
                        {(r.title_r || r.author_r || r.doi_r || r.url_r) && <ExampleLine label={`${reportKindLabel(r)} report`} title={r.title_r || `${shortAuthors(r.author_r)} (${r.year_r || 'n.d.'})`} meta={[shortAuthors(r.author_r), r.year_r].filter(Boolean).join(' · ')} doi={r.doi_r} url={r.url_r} />}
                        <div className="ex-outcome"><OutcomeBadge row={r} />{r.type && <span className="badge badge-type">{r.type}</span>}</div>
                    </div>
                ))}
            </div>
        </section>
    );
}

function Faq() {
    const [state, setState] = useState({status: 'loading', items: []});
    const [open, setOpen] = useState(() => new Set());
    useEffect(() => {
        fetch(URLS.faq).then(res => { if (!res.ok) throw new Error('HTTP ' + res.status); return res.text(); })
            .then(md => { const items = parseFaqMarkdown(md); if (!items.length) throw new Error('No FAQ items found'); setState({status: 'ready', items}); })
            .catch(err => { console.error('FAQ load failed:', err); setState({status: 'error', items: []}); });
    }, []);
    const toggle = i => setOpen(prev => { const next = new Set(prev); next.has(i) ? next.delete(i) : next.add(i); return next; });
    return (
        <section className="card">
            <h2 className="card-header">FAQs</h2>
            <div className="card-body">
                <p className="muted">If anything is unclear, here is where we collect frequently asked questions. The list is loaded live from the <ExternalLink href={URLS.faqPage}>FLoRA FAQ document</ExternalLink> and grows as new questions come in.</p>
                {state.status === 'loading' && <div id="faq-loading" className="note">Loading FAQs…</div>}
                {state.status === 'error' && <div id="faq-error" className="note">Could not load FAQs at the moment. You can read them directly on <ExternalLink href={URLS.faqPage}>GitHub</ExternalLink>.</div>}
                {state.status === 'ready' && (
                    <div id="faq-content">
                        {state.items.map((it, i) => it.type === 'section' ? (
                            <div className="faq-section" key={i}>
                                <h3 className="faq-section-title" dangerouslySetInnerHTML={{__html: renderInlineMd(it.text)}} />
                                {it.body.some(l => l.trim()) && <div className="faq-section-intro" dangerouslySetInnerHTML={{__html: renderFaqAnswer(it.body)}} />}
                            </div>
                        ) : (
                            <div className={'faq-item' + (open.has(i) ? ' open' : '')} key={i}>
                                <button type="button" className="faq-question" aria-expanded={open.has(i)} onClick={() => toggle(i)}>
                                    <Icon.chevron />
                                    <span dangerouslySetInnerHTML={{__html: renderInlineMd(it.question).replace(/<a [^>]*>|<\/a>/g, '')}} />
                                </button>
                                <div className="faq-answer" dangerouslySetInnerHTML={{__html: renderFaqAnswer(it.body)}} />
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </section>
    );
}

function About() {
    return (
        <section className="card">
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
                <p>Replications range from <strong>close/direct</strong> (same methods, same population) to <strong>conceptual</strong> (same hypothesis, different methods). Outcomes describe the central finding tested and follow the replication authors’ account, interpreted under FLoRA’s coding rules. They are not an independent assessment of study quality.</p>
                <h3>What is a reproduction?</h3>
                <p>Reproductions verify whether reported results can be obtained from the original study's data and methods. They are coded on two dimensions:</p>
                <ul>
                    <li><strong>Computational reproducibility</strong>: were the original results obtained? (Reproduced, Computational issues, or Technical failure)</li>
                    <li><strong>Robustness</strong>: do results hold under reasonable alternative specifications? (Robust or Robustness challenges)</li>
                </ul>
                <p>The two dimensions are assessed independently, and not every reproduction is assessed on both. Each chart counts reference pairs with a verdict on that dimension. ‘Not checked’ and uncoded values are excluded. A pair can appear in both charts.</p>
                <div className="key-distinction"><strong>Key distinction:</strong> If new data are collected (e.g. an additional decade of observations), it's a <em>replication</em>. If the same data are re-analysed to verify the original results, it's a <em>reproduction</em>.</div>
                <h3>Structure of FLoRA</h3>
                <p>FLoRA links each repetition reference to its original, and assigns a standardised outcome based on the repetition report. This simple structure lets us describe recorded replication and reproduction outcomes across time, disciplines and venues, and powers tools like the FLoRA Zotero Plugin, which lists replication and reproduction attempts for any reference you provide.</p>
                <h3 id="flora-coverage">Is FLoRA representative and comprehensive?</h3>
                <p>Honestly — neither. We are still working on a systematic literature search, and several structural factors limit coverage:</p>
                <ul>
                    <li>Some replications cannot be added because they do not self-identify as such in the metadata we can reach (e.g., the title and abstract).</li>
                    <li>In some areas of computational reproduction (for example, <ExternalLink href="https://codecheck.org.uk/">CODECHECK</ExternalLink> certificates), the artefacts are typically only issued for <em>successful</em> numerical reproductions, which makes representative estimates of computational reproducibility difficult.</li>
                    <li>Coverage by discipline, language, and publication venue is uneven and reflects where contributors have focused so far.</li>
                </ul>
                <p>Treat aggregate statistics as exploratory rather than definitive, and please <ExternalLink href={URLS.submit}>submit missing entries</ExternalLink> when you spot them.</p>
                <p>FLoRA is the product of years of work by a large community of volunteers. If you'd like to contribute or use the data for your own research, <ExternalLink href="https://forrt.org/replication-hub/">please reach out</ExternalLink>.</p>
            </div>
        </section>
    );
}

export default function Overview({citation}) {
    const {rows} = useData();
    const {switchTab, linkFor} = useView();
    const counts = useMemo(() => ({
        total: rows.length,
        replications: rows.filter(r => classifyKind(r) === 'replication').length,
        reproductions: rows.filter(r => classifyKind(r) === 'reproduction').length,
    }), [rows]);
    const toBrowse = e => {
        // Modified and non-primary clicks keep normal link behaviour.
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault(); switchTab('browse-tab'); document.getElementById('browse-tab')?.focus();
    };
    return (
        <Pane id="overview" tabId="overview-tab" sources={['flora']}>
            <section className="explorer-intro hero">
                <div className="hero-inner">
                    <p className="eyebrow">FORRT Library of Reproduction and Replication Attempts</p>
                    <h1>Explore replication and reproduction evidence</h1>
                    <p className="hero-lede">The <strong>FORRT Library of Reproduction and Replication Attempts (FLoRA)</strong> is a project of the Framework for Open and Reproducible Research Training (FORRT).</p>
                    <p className="hero-lede">Find original reports, attempts to repeat them, and the evidence behind each recorded outcome. Each row is a <strong>reference pair</strong>: one original report and one repetition report. A report can occur in several pairs. Use <a href={linkFor({tab: 'browse-tab'})} data-tab-link="browse-tab" onClick={toBrowse}>Browse reference pairs</a> to search and filter reference pairs here, or the <ExternalLink href={URLS.atlas} className="">Replication Atlas</ExternalLink> to see the replication history of one original study.</p>
                    <HeroSearch />
                </div>
                <div className="hero-figures">
                    <div className="stats-card stats-card--feature"><div className="number" id="ov-total">{counts.total.toLocaleString()}</div><div className="label">Reference pairs</div></div>
                    <div className="stats-card"><div className="number" id="ov-replications">{counts.replications.toLocaleString()}</div><div className="label">Replication reference pairs</div></div>
                    <div className="stats-card"><div className="number" id="ov-reproductions">{counts.reproductions.toLocaleString()}</div><div className="label">Reproduction reference pairs</div></div>
                </div>
            </section>
            <div className="pane-meta">
                <DataStamp source="flora" />
                <CiteBlock label="How to cite &amp; re-use guidelines">
                    <p className="reuse-text">{REUSE_TEXT}</p>
                    <div className="cite-ref" id="citation-text-top"><DatasetCitation state={citation} /></div>
                    <div className="cite-ref"><WebsiteCitation /></div>
                </CiteBlock>
            </div>

            <section className="card">
                <h2 className="card-header">Outcome Breakdown</h2>
                <div className="card-body">
                    <p className="coverage-caution">FLoRA’s coverage is incomplete and uneven across fields, languages and venues. These shares describe recorded entries; they do not estimate how often research in general replicates or reproduces. <a href="#flora-coverage">Coverage limits</a></p>
                    <OutcomeDefinitions />
                    <OutcomeChartRow prefix="overview" dimension="computational" rows={rows} scope={<>Covers <strong>reproductions only</strong>: were the original results obtained? Reproduction coverage is still small, so this chart will fill in as more are added.</>} />
                    <OutcomeChartRow prefix="overview" dimension="robustness" rows={rows} scope={<>Covers <strong>reproductions only</strong>: do results hold under alternative analysis choices? Not every reproduction has a robustness check yet.</>} />
                    <OutcomeChartRow prefix="overview" dimension="replicability" rows={rows} scope={<>Currently, this distribution covers <strong>replications only</strong>. Reproductions are shown separately above, since they're coded along different dimensions.</>} />
                </div>
            </section>

            <div className="split">
                <div className="split-main"><About /><Faq /></div>
                <aside className="split-side">
                    <section className="card">
                        <h2 className="card-header">More Replication Tools</h2>
                        <div className="card-body tool-list">
                            {TOOLS.map(tool => (
                                <a className="tool-tile" href={tool.href} target="_blank" rel="noopener noreferrer" key={tool.title}>
                                    <div className="tool-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{tool.icon}</svg></div>
                                    <div className="tool-body"><div className="tool-title">{tool.title}</div><div className="tool-desc">{tool.desc}</div></div>
                                    <span className="tool-go"><Icon.arrow /></span>
                                </a>
                            ))}
                        </div>
                    </section>
                    <RandomExamples rows={rows} />
                </aside>
            </div>

            <section className="card">
                <h2 className="card-header">Recommended Citation</h2>
                <div className="card-body">
                    <p className="note">If you use the underlying dataset, please cite it as:</p>
                    <div className="citation-box" id="citation-box">
                        <CopyButton id="citation-copy-btn" label="Copy dataset citation" getText={() => citation.citation?.plain || document.getElementById('citation-text').textContent} />
                        <div id="citation-text"><DatasetCitation state={citation} /></div>
                    </div>
                    <p className="note">If you report results based on this website, please cite it as:</p>
                    <div className="citation-box" id="website-citation-box">
                        <CopyButton id="website-citation-copy-btn" label="Copy website citation" getText={() => WEBSITE_CITATION} />
                        <div id="website-citation-text"><WebsiteCitation /></div>
                    </div>
                </div>
            </section>
        </Pane>
    );
}
