/* FLoRA Explorer: main application logic
   Overview · Browse Studies · Years & Disciplines tabs */

// ----- Theme (light/dark) -----
(function() {
    const stored = localStorage.getItem('flora-theme');
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = stored || (prefersDark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
})();

function currentTheme() { return document.documentElement.getAttribute('data-theme') || 'light'; }

document.getElementById('theme-toggle').addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('flora-theme', next);
    if (window._rerenderAllCharts) window._rerenderAllCharts();
});

// ----- Config -----
// Prefer local snapshot (daily-refreshed by GitHub Action); fall back to upstream live CSV.
const LOCAL_CSV_URL = 'data/flora.csv';
const REMOTE_CSV_URL = 'https://raw.githubusercontent.com/forrtproject/fred-data/refs/heads/main/output/flora.csv';
const FLORA_META_URL = 'data/flora_meta.json';
const CITATIONS_META_URL = 'data/meta.json';
const IMPACT_META_URL = 'data/impact_factor_meta.json';
const IMPACT_DATA_URL = 'data/impact_factor_data.json';
const IMPACT_REPRODUCTIONS_URL = 'data/impact_factor_reproductions.json';
const DISCIPLINES_URL = 'data/disciplines.json';
const CITATION_URL = 'https://raw.githubusercontent.com/forrtproject/fred-data/refs/heads/main/CITATION.cff';
const FAQ_URL = 'https://raw.githubusercontent.com/forrtproject/fred-data/refs/heads/main/output/flora_faq.md';

// Getters read --color-chart-* tokens at render time so charts follow the theme.
const chartToken = key => FloraCharts.token('--color-chart-' + key);
const OUTCOME_COLORS = {
    get successful()   { return chartToken('successful'); },
    get failed()       { return chartToken('failed'); },
    get mixed()        { return chartToken('mixed'); },
    get inconclusive() { return chartToken('inconclusive'); },
    get qualified()    { return chartToken('qualified'); },
    get other()        { return chartToken('other'); },
};

// Filled at runtime from data/disciplines.json
let DISCIPLINES = {};
let JOURNAL_TO_DISCIPLINE = {};

function disciplineForJournal(journalName) {
    if (!journalName) return 'Uncategorized';
    return JOURNAL_TO_DISCIPLINE[journalName.toLowerCase().trim()] || 'Uncategorized';
}

function themeAxisColors() {
    const t = FloraCharts.theme();
    return { grid: t.grid, tick: t.tick, legend: t.font };
}

// ----- State -----
let fullRowData = [];
let dataTable = null;
let overviewChart = null;
let overviewComputationalChart = null;
let overviewRobustnessChart = null;
let trendOrigYearChart = null;
let trendRepYearChart = null;
let trendJournalChart = null;
let trendRepJournalChart = null;
let trendFieldChart = null;
let trendsInitialized = false;

// ===== Utilities =====
function classifyOutcome(raw) {
    return ({ successful: 'successful', replicated: 'successful', failed: 'failed',
        'not replicated': 'failed', mixed: 'mixed', partial: 'mixed', inconclusive: 'inconclusive',
        'statistically successful but flawed': 'qualified' })[String(raw || '').trim().toLowerCase()] || 'other';
}

function hasMatchedOutcome(row) {
    const c = classifyOutcome(row.outcome);
    return c === 'successful' || c === 'failed' || c === 'mixed' || c === 'inconclusive' || c === 'qualified';
}

function classifyKind(row) {
    const t = (row.type || '').toLowerCase();
    if (t.includes('reproduc')) return 'reproduction';
    if (t.includes('replic')) return 'replication';
    const o = (row.outcome || '').toLowerCase();
    if (o.includes('computational') || o.includes('robust')) return 'reproduction';
    if (o) return 'replication';
    return 'unknown';
}
function reportKindLabel(row) {
    return { replication: 'Replication', reproduction: 'Reproduction' }[classifyKind(row)] || 'Linked';
}

// Splits a reproduction row's compound outcome string (e.g. "computationally successful,
// robustness challenges") into its two independent dimensions. Either field is null when
// that dimension hasn't been coded yet (including plain "NA").
// Reproduction outcome is a comma-joined "computational, robustness" string, always in
// that fixed order - both the legacy vocabulary ("computationally successful, robust")
// and the current one sourced from FReD-data's two-axis reproductions spreadsheet
// ("computationally reproducible"/"computational issues"/"technical failure"/"failed"/
// "not checked" for computational; "robust"/"robustness challenges"/"not checked" for
// robustness) use this same two-part shape. Parsing positionally - part[0] only tested
// against computational keywords, part[1] only against robustness keywords - avoids any
// cross-contamination between the two dimensions' text.
function parseReproductionOutcome(raw) {
    const parts = String(raw || '').toLowerCase().split(',').map(s=>s.trim());
    const computational = {'computationally reproducible':'successful', 'computationally successful':'successful',
        'computational issues':'issues', 'technical failure':'technical_failure', failed:'technical_failure', 'not checked':'not_checked'};
    const robustness = {robust:'robust', 'robustness challenges':'challenges', 'not checked':'not_checked', 'robustness not checked':'not_checked'};
    return {computational:computational[parts[0]] || null, robustness:robustness[parts[1]] || null};
}

// Computational and robustness are two independently-assessed dimensions (see
// parseReproductionOutcome), and a reproduction can be assessed on one but not the other.
// A row only counts toward a dimension when it carries an actual verdict there;
// "not checked"/uncoded rows are excluded from that dimension's charts, since they say
// nothing about it and would otherwise dominate every bar. The exclusion is per-dimension,
// so a reproduction whose robustness was never checked still appears under computational.
function isComputationalAssessed(row) {
    if (classifyKind(row) !== 'reproduction') return false;
    const { computational } = parseReproductionOutcome(row.outcome);
    return computational === 'successful' || computational === 'issues' || computational === 'technical_failure';
}

function isRobustnessAssessed(row) {
    if (classifyKind(row) !== 'reproduction') return false;
    const { robustness } = parseReproductionOutcome(row.outcome);
    return robustness === 'robust' || robustness === 'challenges';
}

function filterByKind(data, kind) {
    if (!kind || kind === 'all') return data;
    if (kind === 'replication') return data.filter(r => classifyKind(r) === 'replication');
    if (kind === 'reproduction') return data.filter(r => classifyKind(r) === 'reproduction');
    if (kind === 'reproduction-numerical') {
        return data.filter(r => isComputationalAssessed(r));
    }
    if (kind === 'reproduction-robustness') {
        return data.filter(r => isRobustnessAssessed(r));
    }
    return data;
}

// Shared single-select chip-group control used by the study-type selector on Citation
// Impact, Mean Citedness, Authorship Overlap, and Registered Reports. Unlike browseKind/
// trendsKind there's no "all" option here - one of the 3 chips is always active.
function setupStudyTypeSelect(containerId, onChange) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.querySelectorAll('.chip').forEach(btn => {
        btn.addEventListener('click', () => {
            container.querySelectorAll('.chip').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            onChange(btn.dataset.value);
        });
    });
}

// Minimum n below which a per-bucket breakdown (grouped bar / histogram / GAM-adjacent
// stats) isn't meaningful enough to show - an explicit low-N message is shown instead.
// Reproduction coverage is currently well under this for every dimension, so this is what
// visitors will see there until the dataset grows; that's an honest reflection of the data,
// not a bug.
const ANALYSIS_MIN_N = 5;

// Outcome-bucket definitions shared by Authorship Overlap and Registered Reports, whose
// by_outcome/by_rr breakdowns use the same bucket vocabulary as the Overview/Browse charts:
// replications keep the canonical 4-outcome vocabulary; reproductions are split into their
// two independently-coded dimensions (see parseReproductionOutcome).
function studyTypeOutcomeBuckets(kind) {
    if (kind === 'reproduction-numerical') {
        return [
            { key: 'successful', label: 'Successful', color: REPRODUCTION_COLORS.successful },
            { key: 'issues', label: 'Computational issues', color: REPRODUCTION_COLORS.issues },
            { key: 'technical_failure', label: 'Technical failure', color: REPRODUCTION_COLORS.technical_failure },
        ];
    }
    if (kind === 'reproduction-robustness') {
        return [
            { key: 'robust', label: 'Robust', color: REPRODUCTION_COLORS.robust },
            { key: 'challenges', label: 'Robustness challenges', color: REPRODUCTION_COLORS.challenges },
        ];
    }
    return [
        { key: 'successful', label: 'Successful', color: OUTCOME_COLORS.successful },
        { key: 'failed', label: 'Failed', color: OUTCOME_COLORS.failed },
        { key: 'mixed', label: 'Mixed', color: OUTCOME_COLORS.mixed },
        { key: 'inconclusive', label: 'Inconclusive', color: OUTCOME_COLORS.inconclusive },
        { key: 'qualified', label: 'Successful but flawed', color: OUTCOME_COLORS.qualified },
        { key: 'other', label: 'Other / not coded', color: OUTCOME_COLORS.other },
    ];
}

// Static copy that depends on the selected study type carries its three variants in
// data-kind-text="replication|numerical|robustness"; the markup is authored, not data.
const KIND_TEXT_INDEX = {replication: 0, 'reproduction-numerical': 1, 'reproduction-robustness': 2};
function applyKindText(root, kind) {
    const i = KIND_TEXT_INDEX[kind]; if (i === undefined || !root) return;
    root.querySelectorAll('[data-kind-text]').forEach(el => {
        const variants = el.dataset.kindText.split('|');
        el.innerHTML = variants[i] ?? variants[0];
    });
}

function studyTypeLabel(kind) {
    if (kind === 'reproduction-numerical') return 'numerical reproductions';
    if (kind === 'reproduction-robustness') return 'robustness reproductions';
    return 'replications';
}

let mcKind = 'replication';
let aoKind = 'replication';
// Registered Reports (Publication Format), Publication Status, and the large-scale-
// project plot live together on the merged "Publication Type" tab and share one filter.
let pubTypeKind = 'replication';

setupStudyTypeSelect('mc-study-type', kind => { mcKind = kind; applyKindText(document.getElementById('mean-citedness'), kind); renderMcCharts(); });
setupStudyTypeSelect('ao-study-type', kind => { aoKind = kind; applyKindText(document.getElementById('authorship-overlap'), kind); renderOverlapCharts(); });
setupStudyTypeSelect('pubtype-study-type', kind => {
    pubTypeKind = kind;
    applyKindText(document.getElementById('publication-type'), kind);
    renderPubStatusCharts();
    renderRRCharts();
    renderLargeScaleCharts();
});

function getOutcomeBadge(outcome) {
    const raw = String(outcome || 'Not coded');
    if (raw.includes(',') || /computational|robustness/i.test(raw)) {
        const d = parseReproductionOutcome(raw);
        const labels = {successful: 'Reproducible', issues: 'Computational issues', technical_failure: 'Technical failure',
            robust: 'Robust', challenges: 'Robustness challenges', not_checked: 'Not checked'};
        return [['Computational', d.computational], ['Robustness', d.robustness]].map(([label, key]) =>
            `<span class="badge badge-${key === 'successful' || key === 'robust' ? 'successful' : key === 'issues' || key === 'challenges' || key === 'technical_failure' ? 'failed' : 'unknown'}">${label}: ${labels[key] || 'Not coded'}</span>`).join(' ');
    }
    return `<span class="badge badge-${classifyOutcome(raw)}">${escapeHtml(raw)}</span>`;
}

function getOutcomeBadgeShort(outcome) { return getOutcomeBadge(outcome); }

function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function truncateText(text, maxLength = 60) {
    if (!text) return '-';
    return text.length > maxLength ? text.substring(0, maxLength) + '…' : text;
}

function safeHref(value) {
    try { const u = new URL(String(value || '')); return ['http:', 'https:'].includes(u.protocol) ? u.href : ''; }
    catch { return ''; }
}
function formatDOI(doi, full = false) {
    if (!doi) return '-';
    const clean = String(doi).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '');
    const href = /^10\.\d{4,9}\//.test(clean) ? 'https://doi.org/' + encodeURI(clean) : safeHref(doi);
    const label = full ? clean : truncateText(clean,25);
    return href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" class="doi-link" title="${escapeHtml(clean)}">${escapeHtml(label)}</a>` : escapeHtml(label);
}
function formatUrlOrDoi(url, doi) {
    const href = safeHref(url);
    if (href) return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" class="doi-link">${escapeHtml(truncateText(url,40))}</a>`;
    return formatDOI(doi,true);
}
function formatUrlOrDoiShort(url, doi) {
    const href = safeHref(url);
    if (href) return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" class="doi-link" title="${escapeHtml(url)}">${escapeHtml(url.replace(/^https?:\/\/(www\.)?/i, ''))}</a>`;
    return formatDOI(doi, true);
}

function formatAuthors(authorData) {
    if (!authorData) return '-';
    try {
        const authors = JSON.parse(authorData);
        if (Array.isArray(authors)) {
            const names = authors.map(a => {
                if (typeof a === 'string') return a;
                if (a.family && a.given) return `${a.given} ${a.family}`;
                if (a.name) return a.name;
                if (a.family) return a.family;
                return JSON.stringify(a);
            });
            return escapeHtml(names.join(', '));
        }
        return escapeHtml(authorData);
    } catch (e) {
        return escapeHtml(authorData);
    }
}

function shortAuthors(authorData) {
    if (!authorData) return '';
    try {
        const authors = JSON.parse(authorData);
        if (Array.isArray(authors) && authors.length > 0) {
            const first = authors[0];
            const firstName = typeof first === 'string' ? first : (first.family || first.name || '');
            if (authors.length === 1) return firstName;
            if (authors.length === 2) {
                const second = authors[1];
                const secondName = typeof second === 'string' ? second : (second.family || second.name || '');
                return `${firstName} & ${secondName}`;
            }
            return `${firstName} et al.`;
        }
    } catch (e) {
        const short = authorData.split(/[,;]/)[0].trim();
        return short.length > 40 ? short.substring(0, 40) + '…' : short;
    }
    return '';
}

// ===== Chart-library guards =====
// Charts depend on Chart.js / Plotly loaded from a CDN. If a CDN is blocked
// (ad-blocker/offline), the library is undefined; show an inline message in the
// chart container instead of throwing an uncaught error that aborts everything
// else on the page (tables, FAQ, data stamps, …).
// The chart libraries load from CDNs *after* app.js, and a fast (cached,
// same-origin) data fetch can resolve while they are still downloading. So
// before the window load event, an undefined library means "not loaded yet",
// not "failed": defer one retry to the load event instead of declaring
// failure. After load, a missing library really is a failed CDN.
function chartLibUnavailable(elId, lib, retry) {
    if (document.readyState !== 'complete') {
        // Dedupe by retry-function identity so several guards sharing one
        // retry (the five trend charts all retry via renderAllTrends) queue
        // it only once.
        const q = (chartLibUnavailable._queued ||= new Set());
        if (!q.has(retry)) {
            q.add(retry);
            window.addEventListener('load', retry, { once: true });
        }
        return;
    }
    chartLibMissing(elId, lib);
}

const retryAllTrends = () => { if (trendsInitialized) renderAllTrends(); };

function chartLibMissing(elId, lib) {
    const el = document.getElementById(elId);
    if (!el) return;
    const msg = `<div class="chart-unavailable" style="padding:24px;text-align:center;color:var(--color-muted-fg);font-size:0.85rem;">Chart unavailable — ${lib} could not be loaded.</div>`;
    if (el.tagName === 'CANVAS') { if (el.parentElement) el.parentElement.innerHTML = msg; }
    else el.innerHTML = msg;
}

// ===== Overview =====
function updateOverviewStats(data) {
    const total = data.length;
    const replications = data.filter(r => classifyKind(r) === 'replication').length;
    const reproductions = data.filter(r => classifyKind(r) === 'reproduction').length;
    document.getElementById('ov-total').textContent = total.toLocaleString();
    document.getElementById('ov-replications').textContent = replications.toLocaleString();
    document.getElementById('ov-reproductions').textContent = reproductions.toLocaleString();
}

// Muted grays for "not yet coded"/"not checked" - distinct from the successful/failed/
// mixed palette so an unassessed reproduction never reads as an outcome.
const REPRODUCTION_COLORS = {
    get successful()        { return chartToken('successful'); },
    get issues()            { return chartToken('failed'); },
    get technical_failure() { return chartToken('technical-failure'); },
    get robust()            { return chartToken('successful'); },
    get challenges()        { return chartToken('failed'); },
    get not_checked()       { return chartToken('not-checked'); },
    get not_coded()         { return chartToken('not-coded'); },
};

// Builds the {datasets, total} for one of the three outcome dimensions shown on the
// Overview and Browse Studies tabs. 'replicability' mirrors the original single-chart
// logic (replications only); 'computational'/'robustness' bucket reproduction rows by
// the two independent dimensions parsed out of their compound outcome string.
function computeKindChartData(data, kind) {
    if (kind === 'replicability') {
        const eligible = data.filter(r => classifyKind(r) === 'replication');
        const buckets = studyTypeOutcomeBuckets('replication');
        const counts = Object.fromEntries(buckets.map(b => [b.key, 0]));
        eligible.forEach(row => counts[classifyOutcome(row.outcome)]++);
        return { total: eligible.length, datasets: buckets.map(b => ({label: b.label, data: [counts[b.key]], backgroundColor: b.color})) };
    }
    const repro = data.filter(r => classifyKind(r) === 'reproduction');
    if (kind === 'computational') {
        const counts = { successful: 0, issues: 0, technical_failure: 0 };
        repro.forEach(r => { const c = parseReproductionOutcome(r.outcome).computational; if (counts[c] !== undefined) counts[c]++; });
        return {
            total: counts.successful + counts.issues + counts.technical_failure,
            datasets: [
                { label: 'Successful',           data: [counts.successful],        backgroundColor: REPRODUCTION_COLORS.successful },
                { label: 'Computational issues', data: [counts.issues],            backgroundColor: REPRODUCTION_COLORS.issues },
                { label: 'Technical failure',    data: [counts.technical_failure], backgroundColor: REPRODUCTION_COLORS.technical_failure }
            ]
        };
    }
    // robustness
    const counts = { robust: 0, challenges: 0 };
    repro.forEach(r => { const rb = parseReproductionOutcome(r.outcome).robustness; if (counts[rb] !== undefined) counts[rb]++; });
    return {
        total: counts.robust + counts.challenges,
        datasets: [
            { label: 'Robust',                data: [counts.robust],     backgroundColor: REPRODUCTION_COLORS.robust },
            { label: 'Robustness challenges', data: [counts.challenges], backgroundColor: REPRODUCTION_COLORS.challenges }
        ]
    };
}

// Visible caption giving each outcome chart's denominator, exclusions and counts, so
// readers need not open the data table to see what the bar is a share of.
function kindChartCaption(data, kind) {
    const { datasets, total } = computeKindChartData(data, kind);
    const pct = n => FloraCharts.percent(n, total);
    const counts = datasets.map(d => `${d.label} ${d.data[0].toLocaleString()} (${pct(d.data[0])}%)`).join(' · ');
    if (kind === 'replicability') return `${total.toLocaleString()} replication ${total === 1 ? 'pair' : 'pairs'}: ${counts}.`;
    const eligible = data.filter(r => classifyKind(r) === 'reproduction').length;
    const dimension = kind === 'computational' ? 'a computational verdict' : 'a robustness verdict';
    const scope = total === eligible
        ? `${total.toLocaleString()} reproduction ${total === 1 ? 'pair has' : 'pairs have'} ${dimension}`
        : `${total.toLocaleString()} of ${eligible.toLocaleString()} reproduction pairs have ${dimension}; ${(eligible - total).toLocaleString()} not checked or not coded`;
    return `${scope}. ${total ? counts + '. ' : ''}A reference pair can contribute to both dimensions.`;
}
function setCaption(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }

// Shared horizontal-stacked-bar renderer for all 6 outcome-dimension charts (3 on
// Overview, 3 on Browse Studies). Returns the new Chart.js instance so callers can keep
// tracking their own module-level "existing chart" variable for destroy/rebuild.
function renderKindStackedBar(canvasId, existingChart, data, kind, categoryLabel, retry) {
    if (typeof Chart === "undefined") { chartLibUnavailable(canvasId, "Chart.js", retry); return null; }
    const canvas = document.getElementById(canvasId);
    if (!canvas) return existingChart || null;
    const { datasets, total } = computeKindChartData(data, kind);
    const ctx = canvas.getContext('2d');
    if (existingChart) existingChart.destroy();
    const ac = themeAxisColors();
    return FloraCharts.chart(ctx, {
        type: 'bar',
        data: { labels: [categoryLabel], datasets },
        options: {
            responsive: true, maintainAspectRatio: false, indexAxis: 'y',
            plugins: {
                legend: { position: 'bottom', labels: { color: ac.legend, boxWidth: 14, padding: 14, font: { size: 12 } } },
                tooltip: { callbacks: { label: ctx => {
                    const v = ctx.parsed.x; const pct = FloraCharts.percent(v, total, 1);
                    return `${ctx.dataset.label}: ${v.toLocaleString()} (${pct}%)`;
                }}}
            },
            scales: {
                x: { stacked: true, min: 0, max: Math.max(total, 1), grid: { color: ac.grid }, ticks: { color: ac.tick } },
                y: { stacked: true, display: false }
            }
        }
    });
}

const retryOverviewCharts = () => renderOverviewChart(fullRowData);

function renderOverviewChart(data) {
    overviewComputationalChart = renderKindStackedBar('overview-computational-chart', overviewComputationalChart, data, 'computational', 'Reproductions', retryOverviewCharts);
    overviewRobustnessChart = renderKindStackedBar('overview-robustness-chart', overviewRobustnessChart, data, 'robustness', 'Reproductions', retryOverviewCharts);
    overviewChart = renderKindStackedBar('overview-outcome-chart', overviewChart, data, 'replicability', 'Replications', retryOverviewCharts);
    setCaption('overview-computational-caption', kindChartCaption(data, 'computational'));
    setCaption('overview-robustness-caption', kindChartCaption(data, 'robustness'));
    setCaption('overview-outcome-caption', kindChartCaption(data, 'replicability'));
}

function studyLink(doi, url, innerHtml, extraClass = '') {
    let href = '';
    if (doi) href = doi.startsWith('http') ? doi : `https://doi.org/${doi}`;
    else if (url) href = url;
    if (href) return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener" class="ex-link ${extraClass}" title="Open ${escapeHtml(href)}">${innerHtml}</a>`;
    return `<span class="ex-link ex-link-disabled ${extraClass}">${innerHtml}</span>`;
}

function renderRandomExamples(data) {
    const container = document.getElementById('random-examples');
    const usable = data.filter(r => (r.title_o || r.author_o) && r.outcome);
    if (usable.length === 0) { container.innerHTML = '<p class="text-muted">No examples available.</p>'; return; }
    // Fisher–Yates shuffle (unbiased, unlike sort with a random comparator).
    const pool = [...usable];
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const shuffled = pool.slice(0, 4);
    container.innerHTML = shuffled.map(r => {
        const cls = classifyOutcome(r.outcome);
        const origTitle = r.title_o || `${shortAuthors(r.author_o)} (${r.year_o || 'n.d.'})`;
        const origMeta = [shortAuthors(r.author_o), r.year_o].filter(Boolean).join(' · ');
        const repTitle = r.title_r || `${shortAuthors(r.author_r)} (${r.year_r || 'n.d.'})`;
        const repMeta = [shortAuthors(r.author_r), r.year_r].filter(Boolean).join(' · ');
        const origInner = `
            <span class="ex-line-label">Original</span>
            <span class="ex-line-title">${escapeHtml(truncateText(origTitle, 110))}</span>
            ${origMeta ? `<span class="ex-line-meta">${escapeHtml(origMeta)}</span>` : ''}
        `;
        const repInner = `
            <span class="ex-line-label">${reportKindLabel(r)}</span>
            <span class="ex-line-title">${escapeHtml(truncateText(repTitle, 110))}</span>
            ${repMeta ? `<span class="ex-line-meta">${escapeHtml(repMeta)}</span>` : ''}
        `;
        const hasRep = !!(r.title_r || r.author_r || r.doi_r || r.url_r);
        return `
            <div class="example-card outcome-${cls}">
                ${studyLink(r.doi_o, null, origInner)}
                ${hasRep ? studyLink(r.doi_r, r.url_r, repInner) : ''}
                <div class="ex-outcome">${getOutcomeBadge(r.outcome)}${r.type ? '<span class="badge bg-light text-dark">' + escapeHtml(r.type) + '</span>' : ''}</div>
            </div>
        `;
    }).join('');
}

document.getElementById('reshuffle-btn').addEventListener('click', () => {
    if (fullRowData.length) renderRandomExamples(fullRowData);
});

// ===== Citation (CFF) =====
async function loadCitation() {
    const box = document.getElementById('citation-text');
    try {
        const res = await fetch(CITATION_URL);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const text = await res.text();
        const cff = jsyaml.load(text);
        if (!cff || !Array.isArray(cff.authors)) throw new Error('Could not parse authors from CITATION.cff');

        const authors = cff.authors.map(a => {
            const family = a['family-names'] || a.family || '';
            const given = a['given-names'] || a.given || '';
            const nameOnly = a.name || '';
            if (family) {
                if (given) {
                    const initials = given.split(/[\s\-]+/).filter(Boolean)
                        .map(part => { const m = part.match(/\p{L}/u); return m ? m[0].toUpperCase() + '.' : ''; })
                        .filter(Boolean).join(' ');
                    return initials ? `${family}, ${initials}` : family;
                }
                return family;
            }
            return nameOnly;
        }).filter(Boolean);

        let authorsStr;
        if (authors.length === 0) authorsStr = '';
        else if (authors.length === 1) authorsStr = authors[0];
        else if (authors.length === 2) authorsStr = `${authors[0]}, & ${authors[1]}`;
        else if (authors.length <= 20) authorsStr = authors.slice(0, -1).join(', ') + ', & ' + authors[authors.length - 1];
        else authorsStr = authors.slice(0, 19).join(', ') + ', … ' + authors[authors.length - 1];

        const year = cff['date-released'] ? String(cff['date-released']).substring(0, 4) : '';
        const title = cff.title || '';
        const version = cff.version ? ` (Version ${cff.version})` : '';
        const doi = cff.doi || '';
        const doiLink = doi ? `<a href="https://doi.org/${doi}" target="_blank" class="doi-link">https://doi.org/${doi}</a>` : '';

        const htmlParts = [];
        if (authorsStr) htmlParts.push(escapeHtml(authorsStr));
        htmlParts.push(`(${escapeHtml(year)}).`);
        htmlParts.push(`<em>${escapeHtml(title)}</em>${escapeHtml(version)} [Dataset].`);
        if (doiLink) htmlParts.push(doiLink);
        box.innerHTML = htmlParts.join(' ');
        ['citation-text-top', 'citation-text-browse'].forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.innerHTML = htmlParts.join(' ');
        });

        const plainParts = [];
        if (authorsStr) plainParts.push(authorsStr);
        plainParts.push(`(${year}).`);
        plainParts.push(`${title}${version} [Dataset].`);
        if (doi) plainParts.push(`https://doi.org/${doi}`);
        box.dataset.plain = plainParts.join(' ');
    } catch (err) {
        console.error('Citation load failed:', err);
        const errHtml = '<span style="color: var(--color-muted-fg);">Could not load live citation. Please see the <a href="' + CITATION_URL + '" target="_blank" class="doi-link">CITATION.cff file</a>.</span>';
        box.innerHTML = errHtml;
        ['citation-text-top', 'citation-text-browse'].forEach(function(id) {
            var el = document.getElementById(id); if (el) el.innerHTML = errHtml;
        });
    }
}

document.getElementById('citation-copy-btn').addEventListener('click', () => {
    const box = document.getElementById('citation-text');
    const text = box.dataset.plain || box.textContent;
    navigator.clipboard.writeText(text).then(() => {
        const btn = document.getElementById('citation-copy-btn');
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = orig; }, 1500);
    });
});

document.getElementById('website-citation-copy-btn').addEventListener('click', () => {
    const text = 'Wallrich, L., & Röseler, L. (2026). FLoRA Explorer [Website]. https://forrt.org/flora-explorer/';
    navigator.clipboard.writeText(text).then(() => {
        const btn = document.getElementById('website-citation-copy-btn');
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = orig; }, 1500);
    });
});

// ===== FAQ =====
function renderInlineMd(text) {
    let s = escapeHtml(text.replace(/\\([#_\-])/g, '$1'));
    s = s.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => {
        // Strict allow-list: the whole trimmed URL must start with an allowed
        // scheme. Anything else — including relative, protocol-relative, or
        // control-character-prefixed URLs that browsers would normalize into
        // javascript: — renders as plain text.
        const clean = u.trim();
        const safe = /^(https?:|mailto:)/i.test(clean);
        const label = /^here$/i.test(t) && clean.includes('forrt-replications.shinyapps.io/fred_explorer/') ? 'FORRT Replication Database explorer' : t;
        return safe ? `<a href="${clean}" target="_blank" rel="noopener">${label}</a>` : `${t} (${u})`;
    });
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    return s;
}

// The live FAQ is shared with other tools. Correct reader-facing copy here without
// changing the upstream coding guidance or exposing its spreadsheet column names.
function readerFaqCopy(md) {
    return md.replace(/\\([#_\-])/g, '$1')
        .replace(/computational reproducible/g, 'computationally reproducible')
        .replace(/This we would code as/g, 'We would code this as')
        .replace(/versionising/g, 'versioning').replace(/Pubmed/g, 'PubMed').replace(/Google docs/g, 'Google Docs')
        .replace(/regularly-updated/g, 'regularly updated')
        .replace('click [here](https://forrt-replications.shinyapps.io/fred_explorer/)', 'visit the [FORRT Replication Database explorer](https://forrt-replications.shinyapps.io/fred_explorer/)')
        .replace('in alt_id_o and alt_id_r columns', 'as alternative identifiers for the original and repetition reports')
        .replace('will have the specific published version in doi_r and the other alt_id_r', 'use the specific published version as the main repetition reference and keep the other version as an alternative identifier')
        .replace('and the individual reports or preprints as doi_r', 'and the individual reports or preprints as alternative identifiers')
        .replace(/\bjournal_r\b/g, 'the repetition report’s venue')
        .replace(/\bdoi_r\b/g, 'the repetition report’s main DOI')
        .replace(/\bdoi_o\b/g, 'the original report’s main DOI')
        .replace(/\balt_id_r\b/g, 'the repetition report’s alternative identifiers')
        .replace(/\balt_id_o\b/g, 'the original report’s alternative identifiers')
        .replace('The plugin tags replication outcomes as Successful, Failed, or Mixed,', 'Most replication outcomes are coded as Successful, Failed, or Mixed,');
}

function renderFaqAnswer(lines) {
    const out = []; let i = 0;
    while (i < lines.length) {
        const ln = lines[i];
        if (/^\s*[-*]\s+/.test(ln)) {
            const items = [];
            while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*]\s+/, '')); i++; }
            out.push('<ul>' + items.map(it => `<li>${renderInlineMd(it)}</li>`).join('') + '</ul>');
            continue;
        }
        if (/^\s*\d+\.\s+/.test(ln)) {
            const items = [];
            while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+\.\s+/, '')); i++; }
            out.push('<ol>' + items.map(it => `<li>${renderInlineMd(it)}</li>`).join('') + '</ol>');
            continue;
        }
        if (ln.trim() === '') { i++; continue; }
        const para = [];
        while (i < lines.length && lines[i].trim() !== '' && !/^\s*[-*]\s+/.test(lines[i]) && !/^\s*\d+\.\s+/.test(lines[i])) { para.push(lines[i]); i++; }
        out.push('<p>' + renderInlineMd(para.join(' ')) + '</p>');
    }
    return out.join('');
}

function parseFaqMarkdown(md) {
    const lines = readerFaqCopy(md).replace(/\r\n/g, '\n').split('\n');
    const items = []; let currentQA = null; let currentSection = null;
    const venueQuestion = 'How is the peer review status determined?';
    let venueAnswerCorrected = false;
    const flushQA = () => { if (currentQA) {
        if (currentQA.question === venueQuestion) {
            currentQA.body = [
                'The Publication Type tab groups reports by their recorded venue: repository or preprint, conference output, thesis or dissertation, other named venue, or unknown venue. A named venue does not confirm peer review. Missing venue information remains unknown.'
            ];
            venueAnswerCorrected = true;
        }
        items.push(currentQA); currentQA = null;
    } };
    const flushSection = () => { if (currentSection) { items.push(currentSection); currentSection = null; } };
    for (const ln of lines) {
        const h1 = /^#\s+(.+)$/.exec(ln);
        const h2 = /^##\s+(.+)$/.exec(ln);
        const h3 = /^#{3,4}\s+(.+)$/.exec(ln);
        if (h2 || h1) { flushQA(); flushSection(); currentSection = { type: 'section', text: (h2 || h1)[1].trim(), body: [] }; continue; }
        if (h3) { flushQA(); flushSection(); currentQA = { type: 'qa', question: h3[1].trim(), body: [] }; continue; }
        if (currentQA) currentQA.body.push(ln);
        else if (currentSection) currentSection.body.push(ln);
    }
    flushQA(); flushSection();
    if (!venueAnswerCorrected) console.warn(`FAQ venue-status correction was not applied: expected heading "${venueQuestion}" was not found. Review the upstream FAQ.`);
    return items;
}

async function loadFaqs() {
    const loadingEl = document.getElementById('faq-loading');
    const contentEl = document.getElementById('faq-content');
    const errorEl = document.getElementById('faq-error');
    try {
        const res = await fetch(FAQ_URL);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const md = await res.text();
        const items = parseFaqMarkdown(md);
        if (items.length === 0) throw new Error('No FAQ items found');

        contentEl.innerHTML = items.map(it => {
            if (it.type === 'section') {
                const intro = (it.body && it.body.some(l => l.trim())) ? `<div class="faq-section-intro">${renderFaqAnswer(it.body)}</div>` : '';
                return `<div class="faq-section"><h3 class="faq-section-title">${renderInlineMd(it.text)}</h3>${intro}</div>`;
            }
            return `
                <div class="faq-item">
                    <button type="button" class="faq-question" aria-expanded="false">
                        <svg class="faq-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>
                        <span>${renderInlineMd(it.question).replace(/<a [^>]*>|<\/a>/g, '')}</span>
                    </button>
                    <div class="faq-answer">${renderFaqAnswer(it.body)}</div>
                </div>`;
        }).join('');
        contentEl.querySelectorAll('.faq-question').forEach(btn => {
            btn.addEventListener('click', () => {
                const item = btn.closest('.faq-item');
                const open = item.classList.toggle('open');
                btn.setAttribute('aria-expanded', open ? 'true' : 'false');
            });
        });
        loadingEl.style.display = 'none';
        contentEl.style.display = 'block';
    } catch (err) {
        console.error('FAQ load failed:', err);
        loadingEl.style.display = 'none';
        errorEl.style.display = 'block';
    }
}

// ===== Browse: detail row =====
function formatDetailRow(rowData) {
    return `
        <div class="detail-row">
            <div class="detail-grid">
                <div class="detail-card">
                    <h6>Original Study</h6>
                    <div class="detail-section">
                        <div><span class="detail-label">Title:</span> <span class="detail-value">${escapeHtml(rowData.title_o) || '-'}</span></div>
                        <div><span class="detail-label">Authors:</span> <span class="detail-value">${formatAuthors(rowData.author_o)}</span></div>
                        <div><span class="detail-label">Year:</span> <span class="detail-value">${escapeHtml(rowData.year_o) || '-'}</span></div>
                        <div><span class="detail-label">DOI:</span> <span class="detail-value">${formatDOI(rowData.doi_o, true)}</span></div>
                        ${rowData.journal_o ? `<div><span class="detail-label">Journal:</span> <span class="detail-value">${escapeHtml(rowData.journal_o)}</span></div>` : ''}
                    </div>
                </div>
                <div class="detail-card">
                    <h6>${reportKindLabel(rowData)} report</h6>
                    <div class="detail-section">
                        <div><span class="detail-label">Title:</span> <span class="detail-value">${escapeHtml(rowData.title_r) || '-'}</span></div>
                        <div><span class="detail-label">Authors:</span> <span class="detail-value">${formatAuthors(rowData.author_r)}</span></div>
                        <div><span class="detail-label">Year:</span> <span class="detail-value">${escapeHtml(rowData.year_r) || '-'}</span></div>
                        <div><span class="detail-label">Report:</span> <span class="detail-value">${formatUrlOrDoi(rowData.url_r, rowData.doi_r)}</span></div>
                        ${rowData.journal_r ? `<div><span class="detail-label">Journal:</span> <span class="detail-value">${escapeHtml(rowData.journal_r)}</span></div>` : ''}
                    </div>
                </div>
            </div>
            <div class="detail-card mt-3">
                <h6>Recorded evidence</h6>
                <div class="detail-section">
                    <div><span class="detail-label">Outcome:</span> <span class="detail-value">${getOutcomeBadge(rowData.outcome)}</span></div>
                    ${rowData.outcome_quote ? `<div><span class="detail-label">Outcome quotation:</span> <span class="detail-value" style="font-style: italic;">"${escapeHtml(rowData.outcome_quote)}"</span></div><p class="small">${rowData.outcome_quote_source ? `Source: ${escapeHtml(rowData.outcome_quote_source)}. ` : ""}This excerpt may cover only part of the findings and may not fully explain the recorded outcome.</p>` : '<p class="small">No supporting quotation is recorded for this pair.</p>'}
                    <div><span class="detail-label">Type:</span> <span class="detail-value">${escapeHtml(rowData.type) || '-'}</span></div>
                </div>
            </div>
        </div>`;
}

function initDataTable(data) {
    const tableData = data.map(row => [
        null,
        { display: truncateText(row.title_o || row.author_o, 50), search: `${row.title_o || ''} ${searchAuthorNames(row.author_o)} ${row.journal_o || ''}` },
        row.year_o || '-',
        { display: truncateText(row.title_r || row.author_r, 50), search: `${row.title_r || ''} ${searchAuthorNames(row.author_r)} ${row.journal_r || ''}` },
        row.year_r || '-',
        { display: getOutcomeBadgeShort(row.outcome), search: row.outcome_quote || '' },
        truncateText(row.type, 15) || '-',
        { display: formatDOI(row.doi_o, true), search: row.doi_o || '' },
        { display: formatUrlOrDoiShort(row.url_r, row.doi_r), search: row.doi_r || '' }
    ]);

    dataTable = $('#flora-table').DataTable({
        data: tableData, responsive: false, autoWidth: false, deferRender: true, pageLength: 25, dom: 'lrtip',
        lengthMenu: [[10, 25, 50, 100, -1], [10, 25, 50, 100, "All"]],
        order: [[4, 'desc']],
        language: { search: "Search:", searchPlaceholder: "Filter studies (searches full references)...", zeroRecords: "No matching reference pairs", emptyTable: "No matching reference pairs" },
        columnDefs: [
            { targets: 0, className: 'details-control', orderable: false, data: null, defaultContent: '<button type="button" class="study-details" aria-label="Show study evidence" aria-expanded="false"></button>', width: '3%' },
            { targets: [1, 3], width: '22%', render: (d, t) => t === 'display' ? (typeof d === 'object' ? d.display : d) : (typeof d === 'object' ? d.search : d) },
            { targets: [2, 4], width: '5%' },
            { targets: 5, width: '9%', render: (d, t) => t === 'display' ? (typeof d === 'object' ? d.display : d) : (typeof d === 'object' ? d.search : d) },
            { targets: 6, width: '8%', className: 'type-cell' },
            { targets: [7, 8], width: '13%', className: 'link-cell', render: (d, t) => t === 'display' ? (typeof d === 'object' ? d.display : d) : (typeof d === 'object' ? d.search : d) }
        ],
        createdRow: (row, d, dataIndex) => { $(row).attr('data-index', dataIndex); row.querySelector('.study-details').setAttribute('aria-label', 'Show evidence for ' + (data[dataIndex].title_o || 'original report')); }
    });

    dataTable.on('draw.dt', syncBrowseUrl);
    dataTable.on('order.dt', () => { if (bmInitialized) updateBrowseResults(false); syncBrowseUrl(); });

    $('#flora-table tbody').on('click', 'button.study-details', function() {
        const tr = $(this).closest('tr');
        const row = dataTable.row(tr);
        const dataIndex = tr.attr('data-index');
        this.setAttribute('aria-expanded', String(!row.child.isShown()));
        if (row.child.isShown()) { row.child.hide(); tr.removeClass('shown'); }
        else { row.child(formatDetailRow(fullRowData[dataIndex])).show(); tr.addClass('shown'); }
    });
}

// ===== Browse mobile =====
const BM_PAGE_SIZE = 20;
const bmSortCollator = new Intl.Collator(undefined, {numeric:true});
let bmFiltered = []; let bmPage = 0; let bmInitialized = false;
const bmSearchText = new WeakMap();

function bmSearchableText(row) {
    if (!bmSearchText.has(row)) {
        // Keep quotations searchable, but omit raw outcome values and non-DOI URLs.
        const urlDoi = /^https?:\/\/(?:dx\.)?doi\.org\//i.test(row.url_r || '') ? row.url_r : '';
        bmSearchText.set(row, normalizedQuery([row.title_o, searchAuthorNames(row.author_o), row.journal_o, row.year_o, row.doi_o,
            row.title_r, searchAuthorNames(row.author_r), row.journal_r, row.year_r, row.doi_r, urlDoi,
            row.outcome_quote, row.type].filter(Boolean).join(' | ')));
    }
    return bmSearchText.get(row);
}
function bmHref(doi, url) { return doi ? safeHref(String(doi).startsWith('http') ? doi : 'https://doi.org/' + encodeURI(doi)) : safeHref(url); }
function bmAuthorYear(authorData, year) { const a = shortAuthors(authorData); const y = year ? `(${year})` : ''; return [a, y].filter(Boolean).join(' '); }
function bmRenderTitleLine(title, fallback, doi, url) {
    const text = escapeHtml(title || fallback || '—');
    const href = bmHref(doi, url);
    if (href) return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">${text}</a>`;
    return text;
}
function bmCardHtml(row) {
    const oTitle = bmRenderTitleLine(row.title_o, shortAuthors(row.author_o), row.doi_o, null);
    const oMeta = [bmAuthorYear(row.author_o, row.year_o), row.journal_o].filter(Boolean).map(escapeHtml).join(' · ');
    const rTitle = bmRenderTitleLine(row.title_r, shortAuthors(row.author_r), safeHref(row.url_r) ? null : row.doi_r, row.url_r);
    const rMeta = [bmAuthorYear(row.author_r, row.year_r), row.journal_r].filter(Boolean).map(escapeHtml).join(' · ');
    const tagsParts = [getOutcomeBadge(row.outcome)];
    if (row.type) tagsParts.push(`<span class="bm-tag-type">${escapeHtml(row.type)}</span>`);
    return `
        <div class="bm-card">
            <div class="bm-row"><div class="bm-row-label">Original</div><div class="bm-row-title">${oTitle}</div>${oMeta ? `<div class="bm-row-meta">${oMeta}</div>` : ''}</div>
            <div class="bm-divider"></div>
            <div class="bm-row"><div class="bm-row-label">${reportKindLabel(row)}</div><div class="bm-row-title">${rTitle}</div>${rMeta ? `<div class="bm-row-meta">${rMeta}</div>` : ''}</div>
            <div class="bm-tags">${tagsParts.join('')}</div><details class="bm-evidence"><summary>Study evidence and outcome quotation</summary>${formatDetailRow(row)}</details>
        </div>`;
}
function bmApplySearch(query) {
    browseQuery = query || '';
    updateBrowseResults();
    syncBrowseUrl();
}
function bmRender() {
    const list = document.getElementById('browse-mobile-list');
    const meta = document.getElementById('browse-mobile-meta');
    const info = document.getElementById('bm-page-info');
    const prev = document.getElementById('bm-prev');
    const next = document.getElementById('bm-next');
    const pager = document.getElementById('browse-mobile-pager');
    if (!list) return;
    const total = bmFiltered.length;
    if (total === 0) {
        list.innerHTML = '<div class="bm-empty">No matching reference pairs.</div>';
        meta.textContent = '0 reference pairs'; pager.style.display = 'none'; return;
    }
    const totalPages = Math.max(1, Math.ceil(total / BM_PAGE_SIZE));
    if (bmPage >= totalPages) bmPage = totalPages - 1;
    const start = bmPage * BM_PAGE_SIZE; const end = Math.min(total, start + BM_PAGE_SIZE);
    list.innerHTML = bmFiltered.slice(start, end).map(bmCardHtml).join('');
    meta.innerHTML = `Showing <strong>${(start + 1).toLocaleString('en-GB')}–${end.toLocaleString('en-GB')}</strong> of <strong>${total.toLocaleString()}</strong> reference ${total === 1 ? "pair" : "pairs"}`;
    info.textContent = `Page ${bmPage + 1} of ${totalPages}`;
    prev.disabled = bmPage === 0; next.disabled = bmPage >= totalPages - 1;
    pager.style.display = totalPages > 1 ? 'flex' : 'none';
}
function setupBrowseMobile(data) {
    if (bmInitialized) return;
    bmInitialized = true;
    const input = document.getElementById('browse-mobile-input');
    const prev = document.getElementById('bm-prev');
    const next = document.getElementById('bm-next');
    let debounceTimer;
    input.addEventListener('input', () => { clearTimeout(debounceTimer); debounceTimer = setTimeout(() => bmApplySearch(input.value), 200); });
    prev.addEventListener('click', () => { if (bmPage > 0) { bmPage--; bmRender(); syncBrowseUrl(); document.querySelector('.app-main').scrollTo({ top: 0, behavior: 'smooth' }); } });
    next.addEventListener('click', () => { bmPage++; bmRender(); syncBrowseUrl(); document.querySelector('.app-main').scrollTo({ top: 0, behavior: 'smooth' }); });
    input.value = browseQuery; bmApplySearch(browseQuery);
}

function normalizedQuery(query) {
    return String(query || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
        .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
        .replace(/https?:\/\/(?:dx\.)?doi\.org\//g, '').replace(/\bdoi:\s*/g, '').replace(/\s+/g, ' ').trim();
}
// Search all names, without indexing Crossref keys, ORCIDs or affiliations.
function searchAuthorNames(raw) {
    if (!raw) return '';
    try {
        const authors = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const name = a => typeof a === 'string' ? a : a && (a.name || [a.given, a.family].filter(Boolean).join(' ')) || '';
        return (Array.isArray(authors) ? authors : [authors]).map(name).join(', ');
    } catch { return String(raw); }
}
let lastSearchQuery, lastSearchTokens = [];
function searchTokens(query) {
    if (query !== lastSearchQuery) {
        lastSearchQuery = query;
        lastSearchTokens = (normalizedQuery(query).match(/"[^"\n]+"|\S+/g) || []).map(token => token.replace(/^"|"$/g, ''));
    }
    return lastSearchTokens;
}
function matchesSearchTokens(text, tokens) {
    return tokens.every(token => text.includes(token));
}
function matchesBrowseQuery(row, query) {
    const tokens = searchTokens(query);
    return !tokens.length || matchesSearchTokens(bmSearchableText(row), tokens);
}
let updatingBrowse = false;
function updateBrowseResults(redraw = true) {
    if (updatingBrowse) return;
    updatingBrowse = true;
    bmFiltered = getChartData();
    if (dataTable) {
        const [column, direction] = dataTable.order()[0] || [4, 'desc'];
        const field = {1:'title_o',2:'year_o',3:'title_r',4:'year_r',5:'outcome',6:'type',7:'doi_o',8:'doi_r'}[column] || 'year_r';
        bmFiltered.sort((a,b) => bmSortCollator.compare(String(a[field] || ''), String(b[field] || '')) * (direction === 'desc' ? -1 : 1));
        // order.dt also fires during a draw: refresh cards/charts without a second draw.
        if (redraw) dataTable.draw(false);
    }
    bmPage = 0;
    if (bmInitialized) bmRender();
    updateBrowseKindCount();
    renderBrowseOutcomeCharts();
    renderBrowseEmpty(bmFiltered.length);
    syncMobileSort();
    updatingBrowse = false;
}
// Mobile cards have no table headers to click, so a select drives the same DataTables order.
function syncMobileSort() {
    const select = document.getElementById('bm-sort'); if (!select || !dataTable) return;
    const value = dataTable.order()[0]?.join(':');
    select.value = [...select.options].some(o => o.value === value) ? value : 'custom';
}
document.getElementById('bm-sort')?.addEventListener('change', e => {
    const [column, direction] = e.target.value.split(':');
    if (dataTable && direction) dataTable.order([[Number(column), direction]]).draw();
});
function syncBrowseUrl() {
    window.FloraView?.recordState();
}

// ===== Browse kind filter =====
let browseKind = new URLSearchParams(location.search).get('kind') || 'all';
let browseQuery = new URLSearchParams(location.search).get('q') || '';
let browseOutcomeChart = null;
let browseComputationalChart = null;
let browseRobustnessChart = null;

function browseFilteredData() { return filterByKind(fullRowData, browseKind); }
function bmDataSource() { return browseFilteredData(); }

// Returns rows that pass both the kind filter AND the current DataTables search.
function getChartData() {
    return browseFilteredData().filter(row => matchesBrowseQuery(row, browseQuery));
}

function renderBrowseOutcomeCharts() {
    const data = getChartData();
    browseComputationalChart = renderKindStackedBar('browse-computational-chart', browseComputationalChart, data, 'computational', 'Reproductions', renderBrowseOutcomeCharts);
    browseRobustnessChart = renderKindStackedBar('browse-robustness-chart', browseRobustnessChart, data, 'robustness', 'Reproductions', renderBrowseOutcomeCharts);
    browseOutcomeChart = renderKindStackedBar('browse-outcome-chart', browseOutcomeChart, data, 'replicability', 'Replications', renderBrowseOutcomeCharts);

    // Only the chart matching the active kind filter is shown. "All studies" shows none,
    // since mixing the replication and reproduction outcome vocabularies in one box reads
    // as noise rather than signal; the card is then hidden so results follow the filters.
    // An empty selection shows no axes or legend: the empty-state message explains it.
    const dimensions = {replication: 'replicability', 'reproduction-numerical': 'computational', 'reproduction-robustness': 'robustness'};
    const rows = {
        computational: document.getElementById('browse-computational-row'),
        robustness: document.getElementById('browse-robustness-row'),
        replicability: document.getElementById('browse-replicability-row')
    };
    const active = dimensions[browseKind];
    const card = document.getElementById('browse-outcome-card');
    if (card) card.style.display = active && data.length ? '' : 'none';
    const hint = document.getElementById('browse-chart-hint');
    if (hint) hint.style.display = active ? 'none' : '';
    Object.entries(rows).forEach(([dimension, el]) => { if (el) el.style.display = active === dimension ? '' : 'none'; });
    if (active) setCaption(`browse-${active === 'replicability' ? 'outcome' : active}-caption`, kindChartCaption(data, active));
}

// Zero matches get a visible explanation and recovery actions instead of an empty table and
// chart. FLoRA is incomplete, so absence here is not evidence that no repetition exists.
const BROWSE_KIND_NOUNS = {all: 'reference pairs', replication: 'replications', 'reproduction-numerical': 'numerical reproductions', 'reproduction-robustness': 'robustness reproductions'};
function renderBrowseEmpty(n) {
    const el = document.getElementById('browse-empty'); if (!el) return;
    el.hidden = n > 0;
    if (n > 0) { el.innerHTML = ''; return; }
    const query = browseQuery.trim();
    const noun = BROWSE_KIND_NOUNS[browseKind] || BROWSE_KIND_NOUNS.all;
    const none = {'reproduction-numerical': 'No reference pairs have a recorded computational verdict', 'reproduction-robustness': 'No reference pairs have a recorded robustness verdict'}[browseKind] || `No ${noun} are recorded yet`;
    el.innerHTML = `<p><strong>${query ? `No ${noun} match “${escapeHtml(query)}”` : none}.</strong> FLoRA is not comprehensive, so this does not show that a study has never been replicated or reproduced.</p>
        <div class="browse-empty-actions">${query ? '<button type="button" class="browse-download" data-browse-action="clear-search">Clear search</button>' : ''}${browseKind !== 'all' ? '<button type="button" class="browse-download" data-browse-action="all-kinds">Show all study types</button>' : ''}<a href="https://forrt.org/flora-replication-atlas/" target="_blank" rel="noopener noreferrer">Look up an original in the Replication Atlas</a><a href="https://forrt.org/replication-hub/submit/" target="_blank" rel="noopener noreferrer">Submit a missing study</a></div>`;
}
document.getElementById('browse-empty')?.addEventListener('click', e => {
    const action = e.target.closest('[data-browse-action]')?.dataset.browseAction;
    if (action === 'clear-search') { document.getElementById('browse-mobile-input').value = ''; bmApplySearch(''); document.getElementById('browse-mobile-input').focus(); }
    if (action === 'all-kinds') document.querySelector('.browse-kind-btn[data-kind="all"]')?.click();
});

function updateBrowseKindCount() {
    const el = document.getElementById('browse-kind-count'); if (!el) return;
    const n = getChartData().length; const total = fullRowData.length;
    el.textContent = browseKind === 'all' ? `${n.toLocaleString()} reference ${n === 1 ? "pair" : "pairs"}` : `${n.toLocaleString()} of ${total.toLocaleString()} reference ${total === 1 ? "pair" : "pairs"}`;
    document.querySelectorAll('[data-browse-report-kind]').forEach(el => { el.textContent = browseKind === 'all' ? 'Replication or reproduction' : browseKind === 'replication' ? 'Replication' : 'Reproduction'; });
    document.querySelector('#export-browse span').textContent = browseQuery.trim() || browseKind !== 'all' ? 'Download filtered CSV' : 'Download full CSV';
}

function applyBrowseKind() {
    updateBrowseResults();
    syncBrowseUrl();
}

function setupBrowseKindFilter() {
    document.querySelectorAll('.browse-kind-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.browse-kind-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            browseKind = btn.dataset.kind || 'all';
            applyBrowseKind();
        });
    });
    $.fn.dataTable.ext.search.push(function(settings, searchData, dataIndex) {
        if (settings.nTable.id !== 'flora-table') return true;
        const row = fullRowData[dataIndex]; if (!row) return true;
        return filterByKind([row], browseKind).length > 0 && matchesBrowseQuery(row, browseQuery);
    });
    document.querySelectorAll('.browse-kind-btn').forEach(b => b.classList.toggle('active', b.dataset.kind === browseKind));
    applyBrowseKind();
}

// ===== Trends =====
let trendsKind = 'replication';
function trendsFilteredData() { return filterByKind(fullRowData, trendsKind); }
function updateTrendsCount() {
    const el = document.getElementById('trend-filter-count'); if (!el) return;
    const n = trendsFilteredData().length; const total = fullRowData.length;
    el.textContent = trendsKind === 'all' ? `${n.toLocaleString()} reference ${n === 1 ? "pair" : "pairs"}` : `${n.toLocaleString()} of ${total.toLocaleString()} reference ${total === 1 ? "pair" : "pairs"}`;
}

// Plain per-category counts (year/journal/field) - no outcome breakdown. A prior version
// stacked these by outcome, but for 'reproduction-numerical'/'reproduction-robustness' kinds
// the label fell back to the row's full raw (compound) outcome string regardless of which
// dimension was selected, so both dimensions showed up under either kind. Simple counts sidestep
// that entirely and are also the more legible default for a "how many, by category" view.
// Which outcome bucket (per studyTypeOutcomeBuckets/trendOutcomeBuckets) a row falls
// into, for whichever study type is currently selected in the trend filter.
function outcomeBucketKeyForRow(row, kind) {
    if (kind === 'reproduction-numerical') return parseReproductionOutcome(row.outcome).computational || 'not_coded';
    if (kind === 'reproduction-robustness') return parseReproductionOutcome(row.outcome).robustness || 'not_coded';
    return classifyOutcome(row.outcome);
}

// Reproduction bucket lists already cover every row (not_checked/not_coded catch-all);
// replications need an explicit "other" bucket added so unmatched outcomes still count
// toward the bar's total height instead of silently vanishing from the stack.
function trendOutcomeBuckets(kind) {
    if (kind === 'reproduction-numerical' || kind === 'reproduction-robustness') return studyTypeOutcomeBuckets(kind);
    return studyTypeOutcomeBuckets(kind);
}

function aggregateStackedCounts(data, keyFn, kind) {
    const buckets = trendOutcomeBuckets(kind);
    const groups = new Map();
    data.forEach(row => {
        const k = keyFn(row);
        if (k === null || k === undefined || k === '') return;
        if (!groups.has(k)) {
            const counts = {};
            buckets.forEach(b => { counts[b.key] = 0; });
            groups.set(k, { key: k, counts, total: 0 });
        }
        const g = groups.get(k);
        const bucketKey = outcomeBucketKeyForRow(row, kind);
        if (g.counts[bucketKey] !== undefined) g.counts[bucketKey]++;
        g.total++;
    });
    return Array.from(groups.values());
}

// Records before this year are sparse (16 replication pairs across 1880–1959), so the
// original-year chart pools them into one leading column instead of 80 mostly empty years.
const TREND_POOL_BEFORE = 1960;
function aggregateByYear(data, yearField, kind, poolBefore = null) {
    const yearKey = row => {
        const yRaw = row[yearField]; if (!yRaw) return null;
        const match = String(yRaw).match(/\d{4}/); if (!match) return null;
        const y = parseInt(match[0], 10);
        if (!y || y < 1800 || y > 2100) return null;
        return String(y);
    };
    // Fill every calendar year between the first and last observation with zero counts, so a
    // 55-year gap takes 55 slots on the category axis rather than one.
    const out = aggregateStackedCounts(data, yearKey, kind);
    if (!out.length) return out;
    const buckets = trendOutcomeBuckets(kind);
    const empty = key => ({ key, counts: Object.fromEntries(buckets.map(b => [b.key, 0])), total: 0 });
    const byYear = new Map(out.map(g => [parseInt(g.key, 10), g]));
    const years = [...byYear.keys()];
    let start = Math.min(...years);
    const filled = [];
    if (poolBefore && start < poolBefore) {
        const pooled = empty(`Before ${poolBefore}`);
        pooled.pooled = true;
        for (const [y, g] of byYear) if (y < poolBefore) {
            buckets.forEach(b => { pooled.counts[b.key] += g.counts[b.key]; });
            pooled.total += g.total;
        }
        filled.push(pooled);
        start = poolBefore;
    }
    for (let y = start; y <= Math.max(...years); y++) filled.push(byYear.get(y) || empty(String(y)));
    return filled;
}

function aggregateByJournal(data, field, topN, kind) {
    const out = aggregateStackedCounts(data, row => (row[field] || '').trim() || null, kind);
    out.sort((a, b) => b.total - a.total);
    return out.slice(0, topN);
}

function aggregateByField(data, kind) {
    const out = aggregateStackedCounts(data, row => disciplineForJournal(row.journal_o), kind);
    const mapped = out.filter(e => e.key !== 'Uncategorized').sort((a, b) => b.total - a.total);
    const uncat = out.filter(e => e.key === 'Uncategorized');
    return [...mapped, ...uncat];
}

function wrapLabel(str, maxChars = 36) {
    if (!str) return '';
    if (str.length <= maxChars) return str;
    const words = String(str).split(/\s+/);
    const lines = []; let line = '';
    for (const w of words) {
        if (!line) { line = w; continue; }
        if ((line + ' ' + w).length <= maxChars) line += ' ' + w;
        else { lines.push(line); line = w; }
    }
    if (line) lines.push(line);

    return lines;
}

function renderStackedCountChart(canvasId, agg, orientation, existing, buckets, opts = {}) {
    if (existing) existing.destroy();
    if (typeof Chart === 'undefined') { chartLibUnavailable(canvasId, 'Chart.js', retryAllTrends); return null; }
    const ctx = document.getElementById(canvasId).getContext('2d');
    const isHorizontal = orientation === 'horizontal';
    const ac = themeAxisColors();
    const wrapLabels = !!opts.wrapLabels;
    const labels = agg.map(r => wrapLabels ? wrapLabel(r.key, window.innerWidth < 600 ? 18 : 38) : r.key);
    // A dashed rule sets a pooled leading column apart from the year-by-year axis.
    const pooledSeparator = {
        id: 'pooledSeparator',
        afterDatasetsDraw(chart) {
            if (!agg[0]?.pooled || agg.length < 2) return;
            const x = chart.scales.x, area = chart.chartArea, c = chart.ctx;
            const between = (x.getPixelForValue(0) + x.getPixelForValue(1)) / 2;
            c.save(); c.strokeStyle = ac.tick; c.setLineDash([4, 3]); c.lineWidth = 1;
            c.beginPath(); c.moveTo(between, area.top); c.lineTo(between, area.bottom); c.stroke(); c.restore();
        },
    };
    if (isHorizontal) ctx.canvas.parentElement.style.height = Math.max(400, labels.reduce((n,l)=>n+(Array.isArray(l)?l.length:1)*15+15,70)) + 'px';
    const datasets = buckets.map(b => ({
        label: b.label,
        data: agg.map(r => r.counts[b.key] || 0),
        backgroundColor: b.color,
    }));

    return FloraCharts.chart(ctx, {
        type: 'bar',
        data: { labels, datasets },
        options: {
            responsive: true, maintainAspectRatio: false, indexAxis: isHorizontal ? 'y' : 'x',
            plugins: {
                legend: { display: true, position: 'bottom', labels: { color: ac.legend, boxWidth: 14, font: { size: 11 } } },
                tooltip: { callbacks: {
                    title: items => { const label = items[0].label; return Array.isArray(label) ? label.join(' ') : label; }
                }}
            },
            scales: {
                x: { stacked: true, grid: { color: ac.grid }, ticks: { color: ac.tick, autoSkip: !isHorizontal } },
                y: { stacked: true, grid: { color: ac.grid, display: !isHorizontal }, ticks: { color: ac.tick, autoSkip: false, font: { size: isHorizontal ? 11 : 12 } } }
            },
            layout: isHorizontal ? { padding: { left: 6 } } : {}
        },
        plugins: [pooledSeparator],
    });
}

function renderTrendOrigYear() {
    const agg = aggregateByYear(trendsFilteredData(), 'year_o', trendsKind, TREND_POOL_BEFORE);
    const note = document.getElementById('trend-orig-year-axis-note');
    if (note) note.textContent = agg[0]?.pooled
        ? `Pairs with original studies published before ${TREND_POOL_BEFORE} are sparse and are pooled into the first column, set apart by a dashed line. From ${TREND_POOL_BEFORE} the axis runs year by year, so years without any recorded pair appear as gaps.`
        : 'The axis runs year by year, so years without any recorded pair appear as gaps and elapsed time keeps its scale.';
    trendOrigYearChart = renderStackedCountChart('trend-orig-year', agg, 'vertical', trendOrigYearChart, trendOutcomeBuckets(trendsKind));
}
function renderTrendRepYear() {
    trendRepYearChart = renderStackedCountChart('trend-rep-year', aggregateByYear(trendsFilteredData(), 'year_r', trendsKind), 'vertical', trendRepYearChart, trendOutcomeBuckets(trendsKind));
}
function renderTrendJournal() {
    const topN = parseInt(document.getElementById('journal-top-n').value, 10) || 15;
    const agg = aggregateByJournal(trendsFilteredData(), 'journal_o', topN, trendsKind);
    document.getElementById('trend-journal-container').style.height = Math.max(400, agg.length * 36) + 'px';
    trendJournalChart = renderStackedCountChart('trend-journal', agg, 'horizontal', trendJournalChart, trendOutcomeBuckets(trendsKind), { wrapLabels: true });
}
function renderTrendRepJournal() {
    const topN = parseInt(document.getElementById('rep-journal-top-n').value, 10) || 15;
    const agg = aggregateByJournal(trendsFilteredData(), 'journal_r', topN, trendsKind);
    document.getElementById('trend-rep-journal-container').style.height = Math.max(400, agg.length * 36) + 'px';
    trendRepJournalChart = renderStackedCountChart('trend-rep-journal', agg, 'horizontal', trendRepJournalChart, trendOutcomeBuckets(trendsKind), { wrapLabels: true });
}
function renderTrendField() {
    const agg = aggregateByField(trendsFilteredData(), trendsKind);
    document.getElementById('trend-field-container').style.height = Math.max(360, agg.length * 44) + 'px';
    trendFieldChart = renderStackedCountChart('trend-field', agg, 'horizontal', trendFieldChart, trendOutcomeBuckets(trendsKind), { wrapLabels: true });
}
function renderAllTrends() {
    updateTrendsCount();
    const chartsEl = document.getElementById('trends-charts');
    const placeholderEl = document.getElementById('trends-placeholder');
    const show = trendsKind !== 'all';
    if (chartsEl) chartsEl.style.display = show ? '' : 'none';
    if (placeholderEl) placeholderEl.style.display = show ? 'none' : '';
    if (!show) return;
    applyKindText(document.getElementById('trends-charts'), trendsKind);
    renderTrendOrigYear(); renderTrendRepYear();
    renderTrendJournal(); renderTrendRepJournal();
    renderTrendField();
}

document.getElementById('journal-top-n').addEventListener('change', renderTrendJournal);
document.getElementById('rep-journal-top-n').addEventListener('change', renderTrendRepJournal);
document.querySelectorAll('#trends .trend-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('#trends .trend-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        trendsKind = btn.dataset.kind || 'all';
        if (trendsInitialized && fullRowData.length) renderAllTrends();
    });
});

document.getElementById('trends-tab').addEventListener('shown.bs.tab', () => {
    if (!trendsInitialized && fullRowData.length) { trendsInitialized = true; renderAllTrends(); }
});

window._rerenderAllCharts = function() {
    if (fullRowData.length) {
        renderOverviewChart(fullRowData);
        if (trendsInitialized) renderAllTrends();
    }
    renderBrowseOutcomeCharts();
    if (window._mcData) renderMcCharts();
    if (window._aoData) renderOverlapCharts();
    if (window._rrData) renderRRCharts();
    if (window._pubData) { renderPubStatusCharts(); renderLargeScaleCharts(); }
};

// ===== Mean Citedness tab =====
window._mcData = null;

// Overview-stat key and histogram-bucket key for a Mean Citedness dimension. The
// replication path's overview keys are R's original naming (n_success, not
// n_successful) while its histogram keys are "successful" - inconsistent with each
// other, but real, so both are tracked explicitly rather than assumed to match.
function mcBucketConfig(kind) {
    if (kind === 'reproduction-numerical') {
        return [
            { histKey: 'successful', overviewKey: 'n_successful', label: 'Successful', color: REPRODUCTION_COLORS.successful },
            { histKey: 'issues', overviewKey: 'n_issues', label: 'Computational issues', color: REPRODUCTION_COLORS.issues },
            { histKey: 'technical_failure', overviewKey: 'n_technical_failure', label: 'Technical failure', color: REPRODUCTION_COLORS.technical_failure },
        ];
    }
    if (kind === 'reproduction-robustness') {
        return [
            { histKey: 'robust', overviewKey: 'n_robust', label: 'Robust', color: REPRODUCTION_COLORS.robust },
            { histKey: 'challenges', overviewKey: 'n_challenges', label: 'Robustness challenges', color: REPRODUCTION_COLORS.challenges },
        ];
    }
    return [
        { histKey: 'successful', overviewKey: 'n_success', label: 'Successful', color: OUTCOME_COLORS.successful },
        { histKey: 'failed', overviewKey: 'n_failed', label: 'Failed', color: OUTCOME_COLORS.failed },
        { histKey: 'mixed', overviewKey: 'n_mixed', label: 'Mixed', color: OUTCOME_COLORS.mixed },
        { histKey: 'inconclusive', overviewKey: 'n_inconclusive', label: 'Inconclusive', color: OUTCOME_COLORS.inconclusive },
        { histKey: 'qualified', overviewKey: 'n_qualified', label: 'Successful but flawed', color: OUTCOME_COLORS.qualified },
        { histKey: 'other', overviewKey: 'n_other', label: 'Other / not coded', color: OUTCOME_COLORS.other },
    ];
}

function renderMcCharts() {
    if (typeof Plotly === "undefined") { chartLibUnavailable("mc-dist-chart", "Plotly", renderMcCharts); return; }
    document.getElementById('mc-gam-stats').textContent = '';
    // The model, its table, copy action and status leave together; see FloraCharts.clear.
    FloraCharts.clear('mc-gam-chart');
    const d = window._mcData && window._mcData[mcKind];
    const insufficientEl = document.getElementById('mc-placeholder');
    const overviewEl = document.getElementById('mc-overview');
    const distCard = document.getElementById('mc-dist-card');
    const gamCard = document.getElementById('mc-gam-card');
    if (!d || !d.overview || d.overview.n_total < ANALYSIS_MIN_N) {
        const n = d && d.overview ? d.overview.n_total : 0;
        if (insufficientEl) {
            insufficientEl.textContent = `Not enough ${studyTypeLabel(mcKind)} with a Mean Citedness match yet (n=${n}; need at least ${ANALYSIS_MIN_N}).`;
            insufficientEl.style.display = '';
        }
        if (overviewEl) overviewEl.style.display = 'none';
        if (distCard) distCard.style.display = 'none';
        if (gamCard) gamCard.style.display = 'none';
        return;
    }
    if (insufficientEl) insufficientEl.style.display = 'none';
    if (overviewEl) overviewEl.style.display = '';
    if (distCard) distCard.style.display = '';
    // Reproductions have no fitted model: show one descriptive note instead of an empty card.
    if (gamCard) gamCard.style.display = mcKind === 'replication' ? '' : 'none';
    const reproNote = document.getElementById('mc-repro-note');
    if (reproNote) reproNote.style.display = mcKind === 'replication' ? 'none' : '';

    const t = FloraCharts.theme();
    const buckets = mcBucketConfig(mcKind);

    // ── Overview grid ─────────────────────────────────────────────────────
    const ov = d.overview;
    const statCards = buckets.filter(b => ov[b.overviewKey] > 0).map(b => {
        const n = ov[b.overviewKey] || 0;
        const pct = FloraCharts.percent(n, ov.n_total);
        return `<div class="mc-stat"><span class="mc-stat-value" style="color:${b.color}">${n.toLocaleString()}</span><span class="mc-stat-label">${b.label} (${escapeHtml(pct)}%)</span></div>`;
    }).join('');
    document.getElementById('mc-overview').innerHTML = `
        <div class="mc-stat"><span class="mc-stat-value">${ov.n_total.toLocaleString()}</span><span class="mc-stat-label">Reference pairs with OMC</span></div>
        ${statCards}
        <div class="mc-stat"><span class="mc-stat-value">${ov.n_journals.toLocaleString()}</span><span class="mc-stat-label">Journals matched</span></div>
        <div class="mc-stat"><span class="mc-stat-value">${ov.n_disciplines.toLocaleString('en-GB')}</span><span class="mc-stat-label">Disciplines</span></div>`;

    // ── Distribution chart (Plotly stacked bar) ───────────────────────────
    const bins  = d.histogram || [];
    const xMids = bins.map(b => +((b.bin_lo + b.bin_hi) / 2).toFixed(2));
    const hTpl  = 'OMC %{x:.2f}<br>%{y:,.0f} reference pairs<extra>%{fullData.name}</extra>';
    FloraCharts.plot('mc-dist-chart', buckets.map(b => ({
        x: xMids, y: bins.map(row => row[b.histKey] || 0), name: b.label, type: 'bar',
        marker: { color: b.color }, hovertemplate: hTpl,
    })), {
        barmode: 'stack', bargap: 0.05,
        margin: { t: 10, r: 10, b: 50, l: 55 },
        xaxis: { title: 'OpenAlex Mean Citedness (OMC)', gridcolor: t.grid, color: t.font, tickfont: { color: t.font } },
        yaxis: { title: 'Reference pairs', tickformat: ',d', gridcolor: t.grid, color: t.font, tickfont: { color: t.font } },
        plot_bgcolor: t.plot, paper_bgcolor: t.paper,
        font: { family: t.fontFamily, size: 12, color: t.font },
        legend: { orientation: 'h', y: -0.2, font: { color: t.font } },
        height: 320,
    }, { displayModeBar: false, responsive: true });

    const st = d.stats || {};
    const gc = Array.isArray(d.gam_curve) ? d.gam_curve : [];

    // ── GAM chart (Plotly) ────────────────────────────────────────────────
    const gamDiv = document.getElementById('mc-gam-chart');
    if (mcKind !== 'replication') return;
    const hasGam = gc.length > 0 && st && st.n_model >= 30;
    if (!hasGam) {
        gamDiv.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;min-height:180px;color:var(--color-muted-fg);font-size:0.9rem;text-align:center;padding:2rem">No fitted model is available for this snapshot. A model requires at least 30 eligible successful/failed pairs and sufficient variation.</div>';
        return;
    }
    gamDiv.textContent = '';
    // Jitter is computed once per data load and cached so scatter points stay
    // put across re-renders (theme toggles, etc.) instead of jumping.
    if (!window._mcJitter) {
        window._mcJitter = (Array.isArray(d.jitter) ? d.jitter : []).map(pt => ({
            x: pt.omc + (Math.random() - 0.5) * 0.15,
            y: pt.outcome + (Math.random() - 0.5) * 0.06,
            lbl: pt.outcome === 1 ? 'Successful' : 'Failed',
        }));
    }
    const jitter2 = window._mcJitter;
    const gamTraces = [
        { x: gc.map(p => p.omc), y: gc.map(p => p.p_lo), type: 'scatter', mode: 'lines',
          line: { width: 0 }, showlegend: false, hoverinfo: 'skip', name: '_lo' },
        { x: gc.map(p => p.omc), y: gc.map(p => p.p_hi), type: 'scatter', mode: 'lines',
          fill: 'tonexty', fillcolor: t.band,
          line: { width: 0 }, showlegend: false, hoverinfo: 'skip', name: '_hi' },
        { x: gc.map(p => p.omc), y: gc.map(p => p.p), type: 'scatter', mode: 'lines',
          line: { color: t.primary, width: 2.5 }, name: 'Smooth fit',
          hovertemplate: 'OMC = %{x:.2f}<br>P(success) = %{y:.1%}<extra>Smooth fit</extra>' },
        { x: jitter2.map(p => p.x), y: jitter2.map(p => p.y), type: 'scatter', mode: 'markers',
          marker: { color: t.point, size: 5, line: { width: 0 } },
          name: 'Studies', text: jitter2.map(p => p.lbl),
          hovertemplate: 'OMC = %{x:.2f}<br>%{text}<extra></extra>' },
    ];
    const gamLayout = {
        height: 640,
        margin: { t: 10, r: 10, b: 50, l: 60 },
        xaxis: { title: 'OpenAlex Mean Citedness (OMC)', gridcolor: t.grid, color: t.font, tickfont: { color: t.font } },
        yaxis: { title: 'P(success | successful or failed)', range: [-0.08, 1.08],
                 tickformat: '.0%', gridcolor: t.grid, color: t.font, tickfont: { color: t.font } },
        plot_bgcolor: t.plot, paper_bgcolor: t.paper,
        font: { family: t.fontFamily, size: 12, color: t.font },
        legend: { orientation: 'h', y: -0.2, font: { color: t.font } },
        shapes: [{
            type: 'line', xref: 'paper', x0: 0, x1: 1,
            yref: 'y', y0: 0.5, y1: 0.5,
            line: { color: t.rule, width: 1.5, dash: 'dash' },
        }],
        annotations: [{
            xref: 'paper', x: 1, xanchor: 'right',
            yref: 'y', y: 0.5, yanchor: 'bottom',
            text: '50% reference', showarrow: false,
            font: { size: 11, color: t.ruleLabel },
        }],
    };
    // The data table lists model quantities, not plotting internals: one row per curve point
    // with its interval, then the displayed sample's raw values (not the jittered positions).
    const points = Array.isArray(d.jitter) ? d.jitter : [];
    const modelTable = {
        headers: ['Row type', 'OMC', 'Estimated P(success)', '95% CI lower', '95% CI upper', 'Observed outcome (1 = successful, 0 = failed)'],
        rows: [
            ...gc.map(p => ['Fitted curve', p.omc, p.p, p.p_lo, p.p_hi, '']),
            ...points.map(p => ['Displayed pair', p.omc, '', '', '', p.outcome]),
        ],
        summary: `Fitted curve: logistic smooth with pointwise 95% intervals, estimated from ${Number(st.n_model).toLocaleString()} successful or failed reference pairs. Displayed pairs: a random sample of ${points.length.toLocaleString()} of these pairs, with their raw OMC and outcome; the chart jitters their positions for legibility. The sample has no pair identifiers.`,
    };
    FloraCharts.plot('mc-gam-chart', gamTraces, gamLayout, { displayModeBar: false, responsive: true }, { table: modelTable });
    const pNote = (st.p_val !== null && st.p_val !== undefined)
        ? (st.p_val < 0.001 ? 'p < .001' : 'p = ' + st.p_val.toFixed(3))
        : '';
    const glossEdf = '<span class="gloss" tabindex="0">edf<span class="gloss-tip">Effective degrees of freedom: how flexible the fitted curve is. edf ≈ 1 is close to a straight line; higher values mean a more flexible, wigglier fit.</span></span>';
    const glossR2 = '<span class="gloss" tabindex="0">McFadden R²<span class="gloss-tip">McFadden’s pseudo-R²: a goodness-of-fit measure for logistic models. It compares the fitted logistic model with an intercept-only model; it is not the fraction of variance explained.</span></span>';
    document.getElementById('mc-gam-stats').innerHTML =
        'Logistic smooth: ' + glossEdf + ' = ' + st.edf +
        ', χ² = ' + st.chi_sq +
        (pNote ? ', ' + pNote : '') +
        '; ' + glossR2 + ' = ' + st.r2 +
        '; N = ' + st.n_model.toLocaleString('en-GB') + ' (successful vs. failed)';
}

async function loadMeanCitedness() {
    // Fetch + render once. On later tab visits the charts are already in the
    // DOM (theme toggles re-render via _rerenderAllCharts), so just return;
    // the in-flight flag stops duplicate fetches from rapid tab switching.
    if (window._mcData || window._mcLoading) return;
    window._mcLoading = true;
    const loadingEl  = document.getElementById('mc-loading');
    const errorEl    = document.getElementById('mc-error');
    try {
        const [repRes, reproRes] = await Promise.all([
            fetch(IMPACT_DATA_URL, { cache: 'no-cache' }),
            fetch(IMPACT_REPRODUCTIONS_URL, { cache: 'no-cache' }),
        ]);
        if (!repRes.ok) throw new Error('HTTP ' + repRes.status);
        const replicationData = await repRes.json();
        let reproData = {};
        if (reproRes.ok) { try { reproData = await reproRes.json(); } catch (_) {} }
        window._mcData = {
            replication: replicationData,
            'reproduction-numerical': reproData['reproduction-numerical'] || null,
            'reproduction-robustness': reproData['reproduction-robustness'] || null,
        };
        loadingEl.style.display = 'none';
        renderMcCharts();
    } catch (err) {
        console.warn('Mean Citedness load failed:', err);
        loadingEl.style.display = 'none';
        errorEl.style.display   = 'block';
        const det = document.getElementById('mc-error-detail');
        if (det) det.textContent = String(err);
    } finally {
        window._mcLoading = false;
    }
}
document.getElementById('mc-tab').addEventListener('shown.bs.tab', loadMeanCitedness);

// ===== Authorship Overlap tab =====
window._aoData = null;

function renderOverlapCharts() {
    if (typeof Plotly === "undefined") { chartLibUnavailable("ao-chart", "Plotly", renderOverlapCharts); return; }
    const d = window._aoData && window._aoData[aoKind];
    const insufficientEl = document.getElementById('ao-placeholder');
    const overviewEl = document.getElementById('ao-overview');
    const chartCard = document.getElementById('ao-chart-card');
    const caveatEl = document.getElementById('ao-caveat');
    if (!d || !d.overview || d.overview.n_total < ANALYSIS_MIN_N) {
        const n = d && d.overview ? d.overview.n_total : 0;
        if (insufficientEl) {
            insufficientEl.textContent = `Not enough ${studyTypeLabel(aoKind)} with known authorship yet (n=${n}; need at least ${ANALYSIS_MIN_N}).`;
            insufficientEl.style.display = '';
        }
        if (overviewEl) overviewEl.style.display = 'none';
        if (chartCard) chartCard.style.display = 'none';
        if (caveatEl) caveatEl.style.display = 'none';
        return;
    }
    if (insufficientEl) insufficientEl.style.display = 'none';

    const th = FloraCharts.theme();
    const ov = d.overview;
    const by = d.by_outcome;
    const kindNoun = aoKind === 'replication' ? 'Replications' : 'Reproductions';

    // ── Overview boxes ─────────────────────────────────────────────────────────
    const ovEl = document.getElementById('ao-overview');
    if (ovEl) {
        ovEl.innerHTML =
            '<div class="mc-stat-box">' +
                '<div class="mc-stat-value">' + (ov.n_total || 0).toLocaleString() + '</div>' +
                '<div class="mc-stat-label">' + (aoKind === 'replication' ? 'Replication' : 'Reproduction') + ' pairs included</div>' +
            '</div>' +
            '<div class="mc-stat-box">' +
                '<div class="mc-stat-value">' + (ov.n_overlap || 0).toLocaleString() + '</div>' +
                '<div class="mc-stat-label">With author overlap (' + escapeHtml(FloraCharts.percent(ov.n_overlap, ov.n_total)) + '%)</div>' +
            '</div>' +
            '<div class="mc-stat-box">' +
                '<div class="mc-stat-value">' + (ov.n_no_overlap || 0).toLocaleString() + '</div>' +
                '<div class="mc-stat-label">Without author overlap (' + escapeHtml(FloraCharts.percent(ov.n_no_overlap, ov.n_total)) + '%)</div>' +
            '</div>' +
            '<div class="mc-stat-box">' +
                '<div class="mc-stat-value">' + (ov.n_unknown || 0).toLocaleString() + '</div>' +
                '<div class="mc-stat-label">Overlap unknown</div>' +
            '</div>';
        ovEl.style.display = '';
    }

    // ── Grouped bar chart ──────────────────────────────────────────────────────
    const buckets = studyTypeOutcomeBuckets(aoKind);
    const groups     = ['overlap', 'no_overlap'];
    const GROUP_LABELS = { overlap: 'Author overlap', no_overlap: 'No author overlap' };

    const traces = buckets.map(b => ({
        name: b.label,
        type: 'bar',
        x: groups.map(g => GROUP_LABELS[g]),
        y: groups.map(g => (by[g] && by[g][b.key]) || 0),
        marker: { color: b.color },
    }));

    const layout = {
        barmode: 'group',
        height: 420,
        paper_bgcolor: th.paper,
        plot_bgcolor:  th.plot,
        font: { color: th.font, size: 13 },
        legend: { orientation: 'h', y: -0.18, font: { color: th.font } },
        margin: { l: 50, r: 20, t: 20, b: 80 },
        yaxis: {
            title: 'Number of ' + kindNoun.toLowerCase(),
            gridcolor: th.grid,
            zerolinecolor: th.grid,
            tickfont: { color: th.font },
            titlefont: { color: th.font },
        },
        xaxis: {
            tickfont: { color: th.font },
        },
    };

    const config = { responsive: true, displayModeBar: false };
    const chartEl = document.getElementById('ao-chart');
    if (chartEl) FloraCharts.plot(chartEl, traces, layout, config);
    chartCard.style.display = '';

    // ── Caveat ─────────────────────────────────────────────────────────────────
    if (caveatEl) caveatEl.style.display = '';
}

async function loadAuthorOverlap() {
    if (window._aoData) { renderOverlapCharts(); return; }
    const loadingEl  = document.getElementById('ao-loading');
    const overviewEl = document.getElementById('ao-overview');
    const chartCard  = document.getElementById('ao-chart-card');
    const caveatEl   = document.getElementById('ao-caveat');
    const errorEl    = document.getElementById('ao-error');
    try {
        if (loadingEl)  loadingEl.style.display  = 'block';
        if (overviewEl) overviewEl.style.display = 'none';
        if (chartCard)  chartCard.style.display  = 'none';
        if (caveatEl)   caveatEl.style.display   = 'none';
        if (errorEl)    errorEl.style.display    = 'none';

        const res = await fetch(OVERLAP_DATA_URL, { cache: 'no-cache' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const d = await res.json();
        window._aoData = d;

        if (loadingEl)  loadingEl.style.display  = 'none';
        renderOverlapCharts();
    } catch (err) {
        if (loadingEl)  loadingEl.style.display  = 'none';
        if (errorEl)    errorEl.style.display    = 'block';
        const det = document.getElementById('ao-error-detail');
        if (det) det.textContent = String(err);
    }
}
document.getElementById('overlap-tab').addEventListener('shown.bs.tab', loadAuthorOverlap);

// ===== Registered Reports tab =====
window._rrData = null;

function renderRRCharts() {
    if (typeof Plotly === "undefined") { chartLibUnavailable("rr-chart", "Plotly", renderRRCharts); return; }
    const d = window._rrData && window._rrData[pubTypeKind];
    const insufficientEl = document.getElementById('rr-placeholder');
    const overviewEl = document.getElementById('rr-overview');
    const chartCard = document.getElementById('rr-chart-card');
    const studiesCard = document.getElementById('rr-studies-card');
    const caveatEl = document.getElementById('rr-caveat');
    if (!d || !d.overview || d.overview.n_total < ANALYSIS_MIN_N) {
        const n = d && d.overview ? d.overview.n_total : 0;
        if (insufficientEl) {
            insufficientEl.textContent = `Not enough ${studyTypeLabel(pubTypeKind)} checked against the Registered Reports database yet (n=${n}; need at least ${ANALYSIS_MIN_N}).`;
            insufficientEl.style.display = '';
        }
        if (overviewEl) overviewEl.style.display = 'none';
        if (chartCard) chartCard.style.display = 'none';
        if (studiesCard) studiesCard.style.display = 'none';
        if (caveatEl) caveatEl.style.display = 'none';
        return;
    }
    if (insufficientEl) insufficientEl.style.display = 'none';

    const th = FloraCharts.theme();
    const ov = d.overview;
    const by = d.by_outcome;
    const kindNoun = pubTypeKind === 'replication' ? 'Replications' : 'Reproductions';

    // ── Overview boxes ─────────────────────────────────────────────────────────
    const ovEl = document.getElementById('rr-overview');
    if (ovEl) {
        ovEl.innerHTML =
            '<div class="mc-stat">' +
                '<div class="mc-stat-value">' + (ov.n_total || 0).toLocaleString() + '</div>' +
                '<div class="mc-stat-label">' + (pubTypeKind === 'replication' ? 'Replication' : 'Reproduction') + ' pairs checked</div>' +
            '</div>' +
            '<div class="mc-stat">' +
                '<div class="mc-stat-value">' + (ov.n_rr || 0).toLocaleString() + '</div>' +
                '<div class="mc-stat-label">Registered Reports (' + escapeHtml(FloraCharts.percent(ov.n_rr, ov.n_total)) + '%)</div>' +
            '</div>' +
            '<div class="mc-stat">' +
                '<div class="mc-stat-value">' + (ov.n_non_rr || 0).toLocaleString() + '</div>' +
                '<div class="mc-stat-label">Not found in RR database (' + escapeHtml(FloraCharts.percent(ov.n_non_rr, ov.n_total)) + '%)</div>' +
            '</div>' +
            '<div class="mc-stat">' +
                '<div class="mc-stat-value">' + (ov.n_unknown || 0).toLocaleString() + '</div>' +
                '<div class="mc-stat-label">Not checkable</div>' +
            '</div>';
        ovEl.style.display = '';
    }

    // ── Grouped bar chart ──────────────────────────────────────────────────────
    const buckets = studyTypeOutcomeBuckets(pubTypeKind);
    const groups     = ['rr', 'non_rr'];
    const GROUP_LABELS = { rr: 'Registered Report', non_rr: 'Not found in RR database' };

    const traces = buckets.map(b => ({
        name: b.label,
        type: 'bar',
        x: groups.map(g => GROUP_LABELS[g]),
        y: groups.map(g => (by[g] && by[g][b.key]) || 0),
        marker: { color: b.color },
    }));

    const layout = {
        barmode: 'group',
        height: 420,
        paper_bgcolor: th.paper,
        plot_bgcolor:  th.plot,
        font: { color: th.font, size: 13 },
        legend: { orientation: 'h', y: -0.18, font: { color: th.font } },
        margin: { l: 50, r: 20, t: 20, b: 80 },
        yaxis: {
            title: 'Number of ' + kindNoun.toLowerCase(),
            gridcolor: th.grid,
            zerolinecolor: th.grid,
            tickfont: { color: th.font },
            titlefont: { color: th.font },
        },
        xaxis: {
            tickfont: { color: th.font },
        },
    };

    const config = { responsive: true, displayModeBar: false };
    const chartEl = document.getElementById('rr-chart');
    if (chartEl) FloraCharts.plot(chartEl, traces, layout, config);
    chartCard.style.display = '';

    // ── Included-studies table ───────────────────────────────────────────────────
    const studies = Array.isArray(d.rr_studies) ? d.rr_studies : [];
    const tbody = document.querySelector('#rr-studies-table tbody');
    if (tbody) {
        tbody.innerHTML = studies.map(s => {
            const doiLink = formatUrlOrDoi(s.url_r, s.doi_r);
            return '<tr>' +
                '<td>' + escapeHtml(s.title_r) + '</td>' +
                '<td>' + escapeHtml(s.journal_r) + '</td>' +
                '<td>' + escapeHtml(s.year_r) + '</td>' +
                '<td>' + escapeHtml(s.outcome) + '</td>' +
                '<td>' + doiLink + '</td>' +
            '</tr>';
        }).join('');
        if (studiesCard) studiesCard.style.display = studies.length ? '' : 'none';
        const countEl = document.getElementById('rr-studies-count');
        if (countEl) countEl.textContent = '(' + studies.length.toLocaleString() + ')';
    }

    // ── Caveat ─────────────────────────────────────────────────────────────────
    if (caveatEl) caveatEl.style.display = '';
}

async function loadRegisteredReports() {
    if (window._rrData) { renderRRCharts(); return; }
    const loadingEl  = document.getElementById('rr-loading');
    const overviewEl = document.getElementById('rr-overview');
    const chartCard  = document.getElementById('rr-chart-card');
    const studiesCard = document.getElementById('rr-studies-card');
    const caveatEl   = document.getElementById('rr-caveat');
    const errorEl    = document.getElementById('rr-error');
    try {
        if (loadingEl)   loadingEl.style.display   = 'block';
        if (overviewEl)  overviewEl.style.display  = 'none';
        if (chartCard)   chartCard.style.display   = 'none';
        if (studiesCard) studiesCard.style.display = 'none';
        if (caveatEl)    caveatEl.style.display    = 'none';
        if (errorEl)     errorEl.style.display     = 'none';

        const res = await fetch(RR_DATA_URL, { cache: 'no-cache' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const d = await res.json();
        window._rrData = d;

        if (loadingEl) loadingEl.style.display = 'none';
        renderRRCharts();
    } catch (err) {
        if (loadingEl) loadingEl.style.display = 'none';
        if (errorEl)   errorEl.style.display   = 'block';
        const det = document.getElementById('rr-error-detail');
        if (det) det.textContent = String(err);
    }
}

// ===== Publication Status tab =====
window._pubData = null;

function renderPubStatusCharts() {
    if (typeof Plotly === "undefined") { chartLibUnavailable("pub-chart", "Plotly", renderPubStatusCharts); return; }
    const d = window._pubData && window._pubData[pubTypeKind];
    const insufficientEl = document.getElementById('pub-placeholder');
    const overviewEl = document.getElementById('pub-overview');
    const chartCard = document.getElementById('pub-chart-card');
    const studiesCard = document.getElementById('pub-studies-card');
    const caveatEl = document.getElementById('pub-caveat');
    if (!d || !d.overview || d.overview.n_total < ANALYSIS_MIN_N) {
        const n = d && d.overview ? d.overview.n_total : 0;
        if (insufficientEl) {
            insufficientEl.textContent = `Not enough ${studyTypeLabel(pubTypeKind)} with publication-status data yet (n=${n}; need at least ${ANALYSIS_MIN_N}).`;
            insufficientEl.style.display = '';
        }
        if (overviewEl) overviewEl.style.display = 'none';
        if (chartCard) chartCard.style.display = 'none';
        if (studiesCard) studiesCard.style.display = 'none';
        if (caveatEl) caveatEl.style.display = 'none';
        return;
    }
    if (insufficientEl) insufficientEl.style.display = 'none';

    const th = FloraCharts.theme();
    const ov = d.overview;
    const by = d.by_outcome;
    const kindNoun = pubTypeKind === 'replication' ? 'Replications' : 'Reproductions';

    // ── Overview boxes ─────────────────────────────────────────────────────────
    const ovEl = document.getElementById('pub-overview');
    if (ovEl) {
        const venueLabels = {journal:'Other named venue', preprint:'Repository / preprint', conference:'Conference output', thesis:'Thesis / dissertation', unknown:'Unknown venue'};
        ovEl.innerHTML = `<div class="mc-stat"><div class="mc-stat-value">${ov.n_total.toLocaleString('en-GB')}</div><div class="mc-stat-label">Reference pairs</div></div>` +
            Object.entries(venueLabels).map(([key,label])=>`<div class="mc-stat"><div class="mc-stat-value">${(ov['n_'+key] || 0).toLocaleString('en-GB')}</div><div class="mc-stat-label">${label} (${escapeHtml(FloraCharts.percent(ov['n_'+key] || 0, ov.n_total))}%)</div></div>`).join('');
        ovEl.style.display = '';
    }

    // ── Grouped bar chart ──────────────────────────────────────────────────────
    const buckets = studyTypeOutcomeBuckets(pubTypeKind);
    const groups = ['journal', 'preprint', 'conference', 'thesis', 'unknown'];
    const GROUP_LABELS = { journal: 'Other named venue', preprint: 'Repository / preprint', conference: 'Conference output', thesis: 'Thesis / dissertation', unknown: 'Unknown venue' };

    const traces = buckets.map(b => ({
        name: b.label,
        type: 'bar',
        x: groups.map(g => GROUP_LABELS[g]),
        y: groups.map(g => (by[g] && by[g][b.key]) || 0),
        marker: { color: b.color },
    }));

    const layout = {
        barmode: 'group',
        height: 420,
        paper_bgcolor: th.paper,
        plot_bgcolor:  th.plot,
        font: { color: th.font, size: 13 },
        legend: { orientation: 'h', y: -0.18, font: { color: th.font } },
        margin: { l: 50, r: 20, t: 20, b: 80 },
        yaxis: {
            title: 'Number of ' + kindNoun.toLowerCase(),
            gridcolor: th.grid,
            zerolinecolor: th.grid,
            tickfont: { color: th.font },
            titlefont: { color: th.font },
        },
        xaxis: {
            tickfont: { color: th.font },
        },
    };

    const config = { responsive: true, displayModeBar: false };
    const chartEl = document.getElementById('pub-chart');
    if (chartEl) FloraCharts.plot(chartEl, traces, layout, config);
    chartCard.style.display = '';

    // ── All-studies table ─────────────────────────────────────────────────────
    const studies = Array.isArray(d.pub_studies) ? d.pub_studies : [];
    const tbody = document.querySelector('#pub-studies-table tbody');
    if (tbody) {
        tbody.innerHTML = studies.map(s => {
            const doiLink = formatUrlOrDoi(s.url_r, s.doi_r);
            const statusBadge = '<span class="badge badge-unknown">' + escapeHtml(GROUP_LABELS[s.pub_status] || 'Unknown venue') + '</span>';
            return '<tr>' +
                '<td>' + escapeHtml(s.title_r) + '</td>' +
                '<td>' + escapeHtml(s.journal_r) + '</td>' +
                '<td>' + statusBadge + '</td>' +
                '<td>' + escapeHtml(s.year_r) + '</td>' +
                '<td>' + escapeHtml(s.outcome) + '</td>' +
                '<td>' + doiLink + '</td>' +
            '</tr>';
        }).join('');
        if (studiesCard) studiesCard.style.display = studies.length ? '' : 'none';
        const countEl = document.getElementById('pub-studies-count');
        if (countEl) countEl.textContent = '(' + studies.length.toLocaleString() + ')';
    }

    // ── Caveat ─────────────────────────────────────────────────────────────────
    if (caveatEl) caveatEl.style.display = '';
}

async function loadPubStatus() {
    if (window._pubData) { renderPubStatusCharts(); return; }
    const loadingEl  = document.getElementById('pub-loading');
    const overviewEl = document.getElementById('pub-overview');
    const chartCard  = document.getElementById('pub-chart-card');
    const studiesCard = document.getElementById('pub-studies-card');
    const caveatEl   = document.getElementById('pub-caveat');
    const errorEl    = document.getElementById('pub-error');
    try {
        if (loadingEl)   loadingEl.style.display   = 'block';
        if (overviewEl)  overviewEl.style.display  = 'none';
        if (chartCard)   chartCard.style.display   = 'none';
        if (studiesCard) studiesCard.style.display = 'none';
        if (caveatEl)    caveatEl.style.display    = 'none';
        if (errorEl)     errorEl.style.display     = 'none';

        const res = await fetch(PUB_STATUS_DATA_URL, { cache: 'no-cache' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const d = await res.json();
        window._pubData = d;

        if (loadingEl) loadingEl.style.display = 'none';
        renderPubStatusCharts();
        renderLargeScaleCharts();
    } catch (err) {
        if (loadingEl) loadingEl.style.display = 'none';
        if (errorEl)   errorEl.style.display   = 'block';
        const det = document.getElementById('pub-error-detail');
        if (det) det.textContent = String(err);
    }
}

// ===== Large-scale project plot (third section of the Publication Type tab) =====
// Reuses window._pubData - compute_pub_status.py nests a "large_scale" result inside
// each kind alongside the journal/preprint breakdown, since both are pure flora.csv
// transforms with no external API - no separate fetch needed here.
function renderLargeScaleCharts() {
    if (typeof Plotly === "undefined") { chartLibUnavailable("ls-chart", "Plotly", renderLargeScaleCharts); return; }
    document.getElementById('ls-loading').style.display = 'none';
    const d = window._pubData && window._pubData[pubTypeKind] && window._pubData[pubTypeKind].large_scale;
    const insufficientEl = document.getElementById('ls-placeholder');
    const overviewEl = document.getElementById('ls-overview');
    const chartCard = document.getElementById('ls-chart-card');
    const studiesCard = document.getElementById('ls-studies-card');
    const caveatEl = document.getElementById('ls-caveat');
    if (!d || !d.overview || d.overview.n_total < ANALYSIS_MIN_N) {
        const n = d && d.overview ? d.overview.n_total : 0;
        if (insufficientEl) {
            insufficientEl.textContent = `Not enough ${studyTypeLabel(pubTypeKind)} with report-size data yet (n=${n}; need at least ${ANALYSIS_MIN_N}).`;
            insufficientEl.style.display = '';
        }
        if (overviewEl) overviewEl.style.display = 'none';
        if (chartCard) chartCard.style.display = 'none';
        if (studiesCard) studiesCard.style.display = 'none';
        if (caveatEl) caveatEl.style.display = 'none';
        return;
    }
    if (insufficientEl) insufficientEl.style.display = 'none';

    const th = FloraCharts.theme();
    const ov = d.overview;
    const by = d.by_outcome;
    const kindNoun = pubTypeKind === 'replication' ? 'Replications' : 'Reproductions';

    // ── Overview boxes ─────────────────────────────────────────────────────────
    if (overviewEl) {
        overviewEl.innerHTML =
            '<div class="mc-stat">' +
                '<div class="mc-stat-value">' + (ov.n_total || 0).toLocaleString() + '</div>' +
                '<div class="mc-stat-label">' + (pubTypeKind === 'replication' ? 'Replication' : 'Reproduction') + ' pairs checked</div>' +
            '</div>' +
            '<div class="mc-stat">' +
                '<div class="mc-stat-value">' + (ov.n_individual || 0).toLocaleString() + '</div>' +
                '<div class="mc-stat-label">Up to 3 targets / unknown (' + escapeHtml(FloraCharts.percent(ov.n_individual, ov.n_total)) + '%)</div>' +
            '</div>' +
            '<div class="mc-stat">' +
                '<div class="mc-stat-value">' + (ov.n_large_scale || 0).toLocaleString() + '</div>' +
                '<div class="mc-stat-label">Multiple-target report (' + escapeHtml(FloraCharts.percent(ov.n_large_scale, ov.n_total)) + '%)</div>' +
            '</div>';
        overviewEl.style.display = '';
    }

    // ── Grouped bar chart ──────────────────────────────────────────────────────
    const buckets = studyTypeOutcomeBuckets(pubTypeKind);
    const groups = ['individual', 'large_scale'];
    const GROUP_LABELS = { individual: 'Up to 3 targets / unknown', large_scale: 'Multiple-target report (>3 targets)' };

    const traces = buckets.map(b => ({
        name: b.label,
        type: 'bar',
        x: groups.map(g => GROUP_LABELS[g]),
        y: groups.map(g => (by[g] && by[g][b.key]) || 0),
        marker: { color: b.color },
    }));

    const layout = {
        barmode: 'group',
        height: 420,
        paper_bgcolor: th.paper,
        plot_bgcolor:  th.plot,
        font: { color: th.font, size: 13 },
        legend: { orientation: 'h', y: -0.18, font: { color: th.font } },
        margin: { l: 50, r: 20, t: 20, b: 80 },
        yaxis: {
            title: 'Number of ' + kindNoun.toLowerCase(),
            gridcolor: th.grid,
            zerolinecolor: th.grid,
            tickfont: { color: th.font },
            titlefont: { color: th.font },
        },
        xaxis: {
            tickfont: { color: th.font },
        },
    };

    const config = { responsive: true, displayModeBar: false };
    const chartEl = document.getElementById('ls-chart');
    if (chartEl) FloraCharts.plot(chartEl, traces, layout, config);
    if (chartCard) chartCard.style.display = '';

    // ── Large-scale projects table ───────────────────────────────────────────────
    // One row per project (publication), not per target study - see
    // compute_large_scale_result() in compute_pub_status.py. outcome_mix summarises
    // how that project's many individual outcomes broke down.
    const bucketLabels = {};
    buckets.forEach(b => { bucketLabels[b.key] = b.label; });
    const projects = Array.isArray(d.large_scale_studies) ? d.large_scale_studies : [];
    const tbody = document.querySelector('#ls-studies-table tbody');
    if (tbody) {
        tbody.innerHTML = projects.map(s => {
            const doiLink = formatUrlOrDoi(s.url_r, s.doi_r);
            const mix = Object.entries(s.outcome_mix || {})
                .map(([k, n]) => escapeHtml(bucketLabels[k] || k) + ': ' + n)
                .join(', ');
            return '<tr>' +
                '<td>' + escapeHtml(s.title_r) + '</td>' +
                '<td>' + escapeHtml(s.journal_r) + '</td>' +
                '<td>' + escapeHtml(s.year_r) + '</td>' +
                '<td>' + escapeHtml(s.n_originals) + '</td>' +
                '<td>' + mix + '</td>' +
                '<td>' + doiLink + '</td>' +
            '</tr>';
        }).join('');
        if (studiesCard) studiesCard.style.display = projects.length ? '' : 'none';
        const countEl = document.getElementById('ls-studies-count');
        if (countEl) countEl.textContent = '(' + projects.length.toLocaleString() + ')';
    }

    // ── Caveat ─────────────────────────────────────────────────────────────────
    if (caveatEl) caveatEl.style.display = '';
}

// One combined loader for the merged "Publication Type" tab: fetches both backing
// files (Registered Reports needs its own Zotero-derived file; Publication Status +
// the large-scale plot share pub_status_data.json) and renders all three sections.
async function loadPublicationType() {
    await Promise.all([loadRegisteredReports(), loadPubStatus()]);
    renderLargeScaleCharts();
}
document.getElementById('pub-tab').addEventListener('shown.bs.tab', loadPublicationType);

// ===== Data stamps (last updated) =====
const OVERLAP_DATA_URL = 'data/author_overlap_data.json';
const OVERLAP_META_URL = 'data/author_overlap_meta.json';
const RR_DATA_URL = 'data/rr_status_data.json';
const RR_META_URL = 'data/rr_status_meta.json';
const PUB_STATUS_DATA_URL = 'data/pub_status_data.json';
const PUB_STATUS_META_URL = 'data/pub_status_meta.json';

const STAMP_LABELS = {
    flora: 'FLoRA data',
    citations: 'Citation data',
    reproduction_citations: 'Reproduction citation coverage',
    impact_factor: 'Mean Citedness analysis',
    author_overlap: 'Authorship Overlap data',
    rr_status: 'Registered Reports data',
    pub_status: 'Publication Status data'
};
const STAMP_URLS = {
    flora: FLORA_META_URL,
    citations: CITATIONS_META_URL,
    reproduction_citations: 'data/reproduction_citations_meta.json',
    impact_factor: IMPACT_META_URL,
    author_overlap: OVERLAP_META_URL,
    rr_status: RR_META_URL,
    pub_status: PUB_STATUS_META_URL
};

async function loadDataStamps() {
    const cache = {};
    const sources = Array.from(new Set(Array.from(document.querySelectorAll('.data-stamp')).map(el => el.dataset.stampSource)));
    await Promise.all(sources.map(async src => {
        try {
            const res = await fetch(STAMP_URLS[src], { cache: 'no-cache' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            cache[src] = await res.json();
        } catch (e) {
            cache[src] = null;
        }
    }));

    document.querySelectorAll('.data-stamp').forEach(el => {
        const src = el.dataset.stampSource;
        const meta = cache[src];
        const label = STAMP_LABELS[src] || 'Data';
        if (meta && meta.last_updated) {
            const dt = new Date(meta.last_updated);
            const ageMs = Date.now() - dt.getTime();
            const ageDays = ageMs / (1000 * 60 * 60 * 24);
            const stale = (src === 'citations' || src === 'reproduction_citations' || src === 'impact_factor' || src === 'rr_status') ? ageDays > 14 : ageDays > 3;
            el.classList.toggle('stale', stale);
            const fmt = dt.toLocaleString('en-GB', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
            el.innerHTML = `${label} last updated: <strong>${fmt}</strong>`;
            // Machine timestamps are shown as a readable date; the exact identifier stays in the tooltip.
            if (meta.input_snapshot) {
                const snap = new Date(meta.input_snapshot);
                const label = isNaN(snap) ? String(meta.input_snapshot) : snap.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
                el.innerHTML += ` · <span title="${escapeHtml(String(meta.input_snapshot))}">input snapshot: ${escapeHtml(label)}</span>`;
            }
            if (meta.recalculated_at) el.innerHTML += ` · recalculated: ${new Date(meta.recalculated_at).toLocaleDateString()}`;
            if (meta.partial_run) el.innerHTML += ' · Partial refresh: some records are unavailable';
            if (meta.source_url) el.innerHTML += ` · <a class="doi-link" href="${meta.source_url}" target="_blank">${escapeHtml(label)} source</a>`;
        } else {
            el.classList.add('missing');
            el.innerHTML = `${label}: <em>no snapshot yet</em>`;
        }
    });
    FloraCharts.updateContexts();
}

// ===== Main load =====
async function loadDisciplines() {
    try {
        const res = await fetch(DISCIPLINES_URL);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        DISCIPLINES = await res.json();
    } catch (e) {
        console.warn('Could not load disciplines.json; field aggregation will use Uncategorized only.', e);
        DISCIPLINES = {};
    }
    JOURNAL_TO_DISCIPLINE = {};
    for (const [disc, journals] of Object.entries(DISCIPLINES)) {
        for (const j of journals) JOURNAL_TO_DISCIPLINE[j.toLowerCase().trim()] = disc;
    }
}

function parseCsvFromUrl(url) {
    return new Promise((resolve, reject) => {
        Papa.parse(url, {
            download: true, header: true, skipEmptyLines: true,
            complete: results => resolve(results),
            error: err => reject(err)
        });
    });
}

async function loadData() {
    // Disciplines and the CSV are independent - fetch them concurrently rather than
    // waiting on the (small) disciplines request before starting the (large) CSV one.
    const disciplinesPromise = loadDisciplines();

    let results;
    try {
        results = await parseCsvFromUrl(LOCAL_CSV_URL);
        if (!results.data || results.data.length === 0) throw new Error('empty');
    } catch (e) {
        console.info('Local flora.csv not available, falling back to upstream raw URL');
        try {
            results = await parseCsvFromUrl(REMOTE_CSV_URL);
        } catch (e2) {
            document.getElementById('global-loading').style.display = 'none';
            const err = document.getElementById('global-error');
            err.style.display = 'block';
            err.textContent = 'Error loading FLoRA data: ' + (e2.message || e2);
            return;
        }
    }
    await disciplinesPromise;

    if (results.errors && results.errors.length > 0) console.warn('CSV parsing warnings:', results.errors);
    const data = results.data.map(row => {
        Object.keys(row).forEach(key => { if (row[key] === 'NA') row[key] = ''; });
        return row;
    });
    fullRowData = data;

    document.getElementById('global-loading').style.display = 'none';
    document.getElementById('floraTabsContent').style.display = 'block';

    updateOverviewStats(data);
    renderOverviewChart(data);
    renderRandomExamples(data);
    initDataTable(data);
    setupBrowseMobile(data);
    setupBrowseKindFilter();
    loadCitation();
    loadFaqs();
    loadDataStamps();
    applyTabFromUrl();
    document.dispatchEvent(new Event('flora-ready'));
}

// Map friendly ?tab= values to the Bootstrap tab buttons.
const TAB_PARAM_MAP = {
    overview: 'overview-tab',
    browse: 'browse-tab',
    trends: 'trends-tab', years: 'trends-tab', disciplines: 'trends-tab',
    citations: 'citation-tab', 'citation-impact': 'citation-tab',
    'mean-citedness': 'mc-tab', omc: 'mc-tab',
    'authorship-overlap': 'overlap-tab', overlap: 'overlap-tab',
    // 'registered-reports'/'rr' and 'publication-status' are pre-merge aliases, kept
    // so old links/bookmarks still land on the right (now combined) tab.
    'registered-reports': 'pub-tab', rr: 'pub-tab',
    'publication-status': 'pub-tab', 'pub-status': 'pub-tab', pub: 'pub-tab',
    'publication-type': 'pub-tab'
};

// Canonical ?tab= value for each tab button (the reverse of TAB_PARAM_MAP).
const TAB_ID_TO_PARAM = {
    'overview-tab': 'overview', 'browse-tab': 'browse', 'trends-tab': 'trends',
    'citation-tab': 'citations', 'mc-tab': 'mean-citedness', 'overlap-tab': 'authorship-overlap',
    'pub-tab': 'publication-type'
};

// Select a tab from the ?tab= URL param (e.g. ?tab=citations). Activating the
// tab fires shown.bs.tab, which lazy-loads that tab's content as usual.
function applyTabFromUrl() {
    const tab = (new URLSearchParams(window.location.search).get('tab') || '').toLowerCase();
    const btn = document.getElementById(TAB_PARAM_MAP[tab] || 'overview-tab');
    if (btn && window.bootstrap) bootstrap.Tab.getOrCreateInstance(btn).show();
}

// Called directly (not via $(document).ready) so the CSV fetch starts as soon as this
// script runs, rather than waiting for the whole document - including later, lazily-used
// libraries like Plotly - to finish loading. Safe because this tag sits at the end of
// <body>, so every element loadData() touches already exists in the DOM.
loadData();
