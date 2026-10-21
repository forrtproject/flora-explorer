/* FLoRA Explorer: Citation Impact tab
   Loads weekly-refreshed OpenCitations data and renders KPIs, event-study
   plots, and a browsable per-original table. Adapted from flora-citations. */

(function() {
    const CI = {
        meta: null, agg: null, index: null, cocitBreakdown: null,
        studyCache: {}, currentDoi: null,
        outcome: ['all','failed','mixed','successful'].includes(new URLSearchParams(location.search).get('ci-outcome')) ? new URLSearchParams(location.search).get('ci-outcome') : 'all', page: 1, perPage: 20,
        sortCol: 'n_citations', sortDir: 'desc',
        loaded: false, loading: false
    };

    // Resolved from CSS tokens at render time so plots follow the theme.
    const OUTCOME_COLORS = {
        get failed()     { return FloraCharts.token('--color-chart-failed'); },
        get successful() { return FloraCharts.token('--color-chart-successful'); },
        get mixed()      { return FloraCharts.token('--color-chart-mixed'); },
        get all()        { return FloraCharts.token('--color-primary'); },
    };

    let ciKind = 'replication';

    function escapeHtml(s) {
        if (s == null) return '';
        return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }

    function formatAuthors(raw, max = 3) {
        if (!raw) return '';
        if (typeof raw !== 'string') { try { raw = JSON.stringify(raw); } catch (e) { return ''; } }
        const s = raw.trim(); if (!s) return '';
        if (!s.startsWith('[') && !s.includes('"family"') && !s.includes("'family'")) return s.slice(0, 200);
        let parsed = null;
        try { parsed = JSON.parse(s.replace(/'/g, '"')); } catch (e) {}
        let names = [];
        if (Array.isArray(parsed)) names = parsed.map(extractName).filter(Boolean);
        else {
            const re = /"given"\s*:\s*"([^"]*)"[^}]*?"family"\s*:\s*"([^"]*)"|"family"\s*:\s*"([^"]*)"[^}]*?"given"\s*:\s*"([^"]*)"|"family"\s*:\s*"([^"]*)"/g;
            let m;
            while ((m = re.exec(s)) !== null) {
                const given = m[1] || m[4] || '';
                const family = m[2] || m[3] || m[5] || '';
                const name = formatOne(family, given);
                if (name) names.push(name);
            }
        }
        if (names.length === 0) return s.slice(0, 200);
        if (names.length <= max) return names.join('; ');
        return names.slice(0, max).join('; ') + `, … (+${names.length - max})`;
    }
    function extractName(a) { if (!a || typeof a !== 'object') return ''; return formatOne(a.family || a.last || '', a.given || a.first || ''); }
    function formatOne(family, given) {
        family = (family || '').trim(); given = (given || '').trim();
        if (!family) return '';
        const initials = given.split(/\s+/).map(p => (p && p[0] ? p[0].toUpperCase() + '.' : '')).join(' ').trim();
        return initials ? `${family}, ${initials}` : family;
    }

    const plotlyTheme = () => FloraCharts.theme();

    function plotlyReady(timeoutMs = 15000) {
        return new Promise((resolve, reject) => {
            const start = Date.now();
            (function check() {
                if (typeof Plotly !== 'undefined') return resolve();
                if (Date.now() - start > timeoutMs) return reject(new Error('Plotly failed to load'));
                setTimeout(check, 50);
            })();
        });
    }

    function buildSearchIndex(index) {
        // The citation snapshot's display names stop after six authors. The
        // already-loaded FLoRA pairs retain full names; collect all records for
        // each original and keep the snapshot names as a fallback.
        const authorsByDoi = new Map();
        for (const row of fullRowData) {
            const doi = normalizeDoi(row.doi_o);
            const names = searchAuthorNames(row.author_o);
            if (!doi || !names) continue;
            if (!authorsByDoi.has(doi)) authorsByDoi.set(doi, new Set());
            authorsByDoi.get(doi).add(names);
        }
        return index.map(s => {
            // Denominator is citations since the first replication, not lifetime
            // citations — citing works published before any replication existed
            // could never have co-cited one.
            const cocit_prop = s.n_citations_post_first_rep > 0 ? s.n_cocitations / s.n_citations_post_first_rep : 0;
            const authors = [...(authorsByDoi.get(normalizeDoi(s.doi)) || [])];
            const searchText = normalizedQuery([s.title, searchAuthorNames(s.author), ...authors, s.year, s.venue, s.doi].filter(Boolean).join(' | '));
            return { ...s, cocit_prop, searchText };
        });
    }

    async function init() {
        if (CI.loaded || CI.loading) return;
        CI.loading = true;
        showLoading();
        try {
            const [metaRes, aggRes, idxRes] = await Promise.all([
                fetch('data/meta.json'),
                fetch('data/aggregate.json'),
                fetch('data/originals_index.json')
            ]);
            if (!metaRes.ok || !aggRes.ok || !idxRes.ok) { showPlaceholder(); return; }
            CI.meta = await metaRes.json();
            CI.agg = await aggRes.json();
            CI.index = buildSearchIndex(await idxRes.json());

            // Optional: co-citation breakdown by pub status / outcome (may not exist on first run)
            try {
                const breakdownRes = await fetch('data/cocit_breakdown.json');
                if (breakdownRes.ok) CI.cocitBreakdown = await breakdownRes.json();
            } catch (_) {}

            // Optional: simple descriptive citation counts for reproductions (no event-study -
            // too few reproductions for that model to be meaningful; see refresh_data.py)
            try {
                const reproRes = await fetch('data/reproduction_citations.json');
                if (reproRes.ok) CI.repro = await reproRes.json();
            } catch (_) {}

            // The Plotly script tag near the end of <body> may still be loading when a
            // deep link opens this tab; the data fetches above are small enough to win that race.
            await plotlyReady();
            renderKPIs(); renderAggregate(); renderTable(); renderCocitBreakdown(); bindEvents();
            renderCiKindGate(ciKind);
            document.querySelectorAll('#outcome-chips .chip').forEach(b=>{b.classList.toggle('active',b.dataset.value===CI.outcome);b.setAttribute('aria-pressed',String(b.dataset.value===CI.outcome));});
            CI.loaded = true;
        } catch (e) {
            console.error('Citation Impact load failed:', e);
            showPlaceholder();
        } finally {
            CI.loading = false;
        }
    }

    // Reproduction dimension buckets for the descriptive citation-count table (mirrors
    // parseReproductionOutcome() in assets/app.js). Unlike the replication view, there's no
    // event-study model here - too few reproductions for that to be meaningful - so this
    // just shows the simple counts refresh_data.py's compute_reproduction_citations() wrote.
    const CI_REPRO_BUCKETS = {
        'reproduction-numerical': [
            { key: 'successful', label: 'Successful' },
            { key: 'issues', label: 'Computational issues' },
            { key: 'technical_failure', label: 'Technical failure' },
        ],
        'reproduction-robustness': [
            { key: 'robust', label: 'Robust' },
            { key: 'challenges', label: 'Robustness challenges' },
        ],
    };
    const CI_REPRO_MIN_N = 5;

    function renderCiKindGate(kind) {
        applyKindText(document.querySelector('#citation-impact .ci-intro'), kind);
        const contentEl = document.getElementById('ci-content');
        const reproEl = document.getElementById('ci-repro-content');
        const placeholderEl = document.getElementById('ci-placeholder');
        if (kind === 'replication') {
            if (contentEl) contentEl.style.display = '';
            if (CI.loaded) renderAggregate();
            if (reproEl) reproEl.style.display = 'none';
            if (placeholderEl) placeholderEl.style.display = 'none';
            return;
        }
        if (contentEl) contentEl.style.display = 'none';

        const buckets = CI_REPRO_BUCKETS[kind] || [];
        const data = CI.repro && CI.repro[kind];
        const totalOriginals = data
            ? buckets.reduce((sum, b) => sum + ((data[b.key] && data[b.key].n_originals) || 0), 0)
            : 0;
        if (!data || totalOriginals < CI_REPRO_MIN_N) {
            if (reproEl) reproEl.style.display = 'none';
            if (placeholderEl) {
                placeholderEl.textContent =
                    `Not enough reproductions with citation data yet (n=${totalOriginals}; need at least ${CI_REPRO_MIN_N}).`;
                placeholderEl.style.display = '';
            }
            return;
        }
        if (placeholderEl) placeholderEl.style.display = 'none';
        if (reproEl) reproEl.style.display = '';
        const tbody = document.querySelector('#ci-repro-table tbody');
        if (tbody) {
            tbody.innerHTML = buckets.map(b => {
                const row = data[b.key] || {};
                return '<tr>' +
                    '<td>' + escapeHtml(b.label) + '</td>' +
                    '<td>' + FloraCharts.number(row.n_originals || 0) + '</td>' +
                    '<td>' + FloraCharts.number(row.n_citations_to_original || 0) + '</td>' +
                    '<td>' + FloraCharts.number(row.n_citations_to_reproduction || 0) + '</td>' +
                    '<td>' + FloraCharts.number(row.n_cocitations || 0) + '</td>' +
                '</tr>';
            }).join('');
        }
    }

    // Immediate "Loading…" state shown on init, before the three fetches resolve.
    // Cleared by renderKPIs/renderAggregate/renderTable on success, or replaced by
    // showPlaceholder on failure. Mirrors the mc-loading/ao-loading patterns.
    function showLoading() {
        const kpis = document.getElementById('kpis');
        if (kpis) kpis.innerHTML = `<div style="padding:24px;text-align:center;color:var(--color-muted-fg);grid-column:1 / -1">⏳ Loading citation data…</div>`;
        ['plot-cit', 'plot-cocit'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = '<div style="padding:80px 20px;text-align:center;color:var(--color-muted-fg)">Loading…</div>';
        });
        const tbody = document.querySelector('#originals-table tbody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--color-muted-fg)">Loading…</td></tr>';
    }

    function showPlaceholder() {
        const msg = `
            <div style="padding:24px;background:var(--color-surface-raised);border:1px solid var(--color-border);
                        border-radius:8px;text-align:center;color:var(--color-muted-fg);grid-column:1 / -1">
              ⏳ <strong>Citation data not yet available.</strong><br>
              Citation data could not be loaded. Please try again later.
            </div>`;
        const kpis = document.getElementById('kpis'); if (kpis) kpis.innerHTML = msg;
        ['plot-cit', 'plot-cocit'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = '<div style="padding:80px 20px;text-align:center;color:var(--color-muted-fg)">No data yet</div>';
        });
        const tbody = document.querySelector('#originals-table tbody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--color-muted-fg)">No data yet. First refresh in progress.</td></tr>';
    }

    function renderKPIs() {
        const c = (CI.meta && CI.meta.outcome_counts) || {};
        const fmt = n => (n == null ? '—' : FloraCharts.number(n));
        document.getElementById('kpis').innerHTML = `
            <div class="kpi"><div class="kpi-value">${fmt(CI.meta && CI.meta.n_originals)}</div><div class="kpi-label">Original reports with complete citation data</div></div>
            <div class="kpi"><div class="kpi-value">${fmt(CI.meta && CI.meta.n_replications)}</div><div class="kpi-label">Eligible replication reference pairs</div></div>
            <div class="kpi"><div class="kpi-value">${fmt(c.failed)}</div><div class="kpi-label">Eligible pairs: failed</div></div>
            <div class="kpi"><div class="kpi-value">${fmt(c.successful)}</div><div class="kpi-label">Eligible pairs: successful</div></div>
            <p class="muted kpi-note">Eligible pair counts are measured before citation lookup, so they include pairs whose originals lack complete citation data.</p>`;
    }

    function renderAggregate() {
        const data = CI.agg[CI.outcome]; if (!data) return;
        drawAggregatePlot('plot-cit', data, 'mean_citations', 'citations_model', 'Mean citations per year', CI.outcome);
        drawAggregatePlot('plot-cocit', data, 'mean_cocitations', 'cocitations_model', 'Mean co-citations per year', CI.outcome);

        const model = data.citations_model || {}; const desc = data.descriptive || {};
        let html;
        const hasModel = model.att != null && Number.isFinite(model.att);
        if (hasModel) {
            const interval = model.att_ci || [];
            const ci = interval.length === 2 && interval.every(Number.isFinite) ? ` (95% CI ${FloraCharts.number(interval[0],3)} to ${FloraCharts.number(interval[1],3)})` : '';
            html = `<strong>Adjusted post-replication association:</strong> ${FloraCharts.number(model.att,3)} log(1 + citations) units${ci}, based on ${FloraCharts.number(model.n_units)} originals. This is not a percentage change in raw citations or evidence that replication caused the change.`;
        } else if (desc.n_units && desc.n_units.length) {
            const maxN = Math.max(...desc.n_units);
            html = `<strong>Descriptive trajectory shown.</strong>
                <span class="muted">${FloraCharts.number(maxN)} originals contribute at peak. Each line shows the average citation count by years relative to the first replication.</span>`;
        } else {
            html = `<strong>Insufficient data</strong> for the selected outcome group.`;
        }
        document.getElementById('att-callout').innerHTML = html;
    }

    function drawAggregatePlot(divId, data, descField, modelField, ylabel, outcome) {
        if (typeof Plotly === 'undefined') { chartLibUnavailable(divId, 'Plotly', () => drawAggregatePlot(divId, data, descField, modelField, ylabel, outcome)); return; }
        const desc = data.descriptive || {}; const model = data[modelField] || {};
        const color = OUTCOME_COLORS[outcome] || OUTCOME_COLORS.all;
        const traces = [];

        if (desc.event_time && desc.event_time.length) {
            traces.push({
                x: desc.event_time, y: desc[descField], type: 'scatter', mode: 'lines+markers',
                line: { color, width: 2.5 }, marker: { color, size: 7 },
                name: 'Mean (raw)', text:desc.event_time.map((x,i)=>`Years from first replication: ${FloraCharts.number(x)}<br>${ylabel}: ${FloraCharts.number(desc[descField][i],2)}`),
                hovertemplate: '%{text}<extra></extra>'
            });
        }
        if (desc.event_time && desc.n_units && desc.n_units.length) {
            traces.push({
                x: desc.event_time, y: desc.n_units, type: 'scatter', mode: 'lines',
                line: { color: plotlyTheme().rule, width: 1, dash: 'dot' },
                name: 'N (right axis)', yaxis: 'y2',
                text:desc.event_time.map((x,i)=>`Years from first replication: ${FloraCharts.number(x)}<br>Original reports: ${FloraCharts.number(desc.n_units[i])}`),
                hovertemplate: '%{text}<extra></extra>'
            });
        }
        const modelId = divId + '-model';
        let modelEl = document.getElementById(modelId);
        if (!modelEl) {
            modelEl = document.createElement('div'); modelEl.id = modelId; modelEl.className = 'coefficient-plot';
            document.getElementById(divId).insertAdjacentElement('afterend', modelEl);
        }
        const valid = (model.event_time || []).map((x,i) => ({x, y:model.estimate?.[i], lo:model.ci_low?.[i], hi:model.ci_high?.[i]}))
            .filter(p => [p.y,p.lo,p.hi].every(v => typeof v === 'number' && Number.isFinite(v)));
        if (valid.length) {
            const t = plotlyTheme();
            FloraCharts.plot(modelId, [{name:'OLS coefficient (95% CI)', x:valid.map(p=>p.x), y:valid.map(p=>p.y),
                type:'scatter', mode:'markers', text:valid.map(p=>`Years from first replication: ${FloraCharts.number(p.x)}<br>Coefficient: ${FloraCharts.number(p.y,3)}<br>95% CI: ${FloraCharts.number(p.lo,3)} to ${FloraCharts.number(p.hi,3)}`),
                hovertemplate:'%{text}<extra></extra>', error_y:{type:'data', symmetric:false,
                    array:valid.map(p=>p.hi-p.y), arrayminus:valid.map(p=>p.y-p.lo)}, marker:{color:t.font}}], {
                title:{text:'Adjusted association: log(1 + count)', font:{size:14}}, height:340,
                xaxis:{title:'Years from first replication', automargin:true, color:t.font},
                yaxis:{title:'Coefficient (reference: year −1)', zeroline:true, zerolinecolor:t.font, automargin:true, color:t.font},
                margin:{t:45,r:20,b:60,l:65}, plot_bgcolor:t.plot,paper_bgcolor:t.paper,font:{color:t.font},
            }, {responsive:true,displayModeBar:false});
        } else {
            if (modelEl.data) Plotly.purge(modelEl);
            modelEl.textContent = 'No fitted model for this selection.';
            document.getElementById(modelId+'-data')?.remove();
        }

        if (traces.length === 0) {
            document.getElementById(divId).innerHTML = '<div style="padding:60px;text-align:center;color:var(--color-muted-fg)">No data for this filter</div>';
            return;
        }

        const t = plotlyTheme();
        const layout = {
            margin: { t: 30, r: 50, b: 50, l: 60 },
            xaxis: { title: 'Years relative to first replication', zeroline: false, gridcolor: t.grid, color: t.font },
            yaxis: { title: ylabel, gridcolor: t.grid, color: t.font, rangemode: 'tozero' },
            yaxis2: {
                title: 'N studies', ...FloraCharts.countAxis(Math.max(0,...(desc.n_units || []))), overlaying: 'y', side: 'right', showgrid: false, rangemode: 'tozero',
                tickfont: { color: t.muted, size: 10 }, titlefont: { color: t.muted, size: 10 }
            },
            shapes: [{ type: 'line', x0: 0, x1: 0, yref: 'paper', y0: 0, y1: 1, line: { color: t.primary, width: 1.5, dash: 'dash' } }],
            annotations: [{ x: 0, yref: 'paper', y: 1.04, xref: 'x', yanchor: 'bottom', text: 'Replication published', showarrow: false, font: { size: 11, color: t.primary } }],
            plot_bgcolor: t.plot, paper_bgcolor: t.paper,
            font: { family: t.fontFamily, size: 12, color: t.font },
            legend: { orientation: 'h', y: -0.22, font: { color: t.font } }
        };
        FloraCharts.plot(divId, traces, layout, { displayModeBar: false, responsive: true });
    }

    function renderOutcomeBar(outcomeMix, nReplications) {
        if (!outcomeMix || !nReplications) return '—';
        const total = nReplications;
        const ORDERS = ['failed', 'mixed', 'successful'];
        const segments = ORDERS.map(o => {
            const count = outcomeMix[o] || 0;
            if (!count) return '';
            const pct = (count / total * 100).toFixed(1);
            const label = `${FloraCharts.number(count)} ${o}`;
            return `<div class="rep-seg ${o}" style="width:${pct}%" title="${label}"></div>`;
        }).join('');
        const tooltipParts = ORDERS.filter(o => outcomeMix[o]).map(o => `${FloraCharts.number(outcomeMix[o])} ${o}`).join(', ');
        return `<div class="rep-bar-wrap" title="${tooltipParts}">
            <div class="rep-bar">${segments}</div>
            <span class="rep-count">${FloraCharts.number(total)}</span>
        </div>`;
    }

    const PUBSTATUS_LABELS = {
        individual: 'Up to 3 targets', large_project: 'Multiple-target report (>3 targets)'
    };
    const BREAKDOWN_OUTCOME_LABELS = { successful: 'Successful', failed: 'Failed', mixed: 'Mixed' };

    function renderBreakdownTable(title, dim, labels, note) {
        const rows = Object.keys(labels).map(key => {
            const d = dim[key] || {};
            const fmt = v => v == null ? '—' : escapeHtml(FloraCharts.percent(v,1,1)) + '%';
            return `<tr>
                <td>${labels[key]}</td>
                <td>${d.n_originals != null ? FloraCharts.number(d.n_originals) : '—'}</td>
                <td>${fmt(d.mean_rate)}</td>
                <td>${fmt(d.median_rate)}</td>
                <td>${fmt(d.grand_mean_rate)}</td>
            </tr>`;
        }).join('');
        return `<div class="cocit-breakdown-table" tabindex="0" role="region" aria-label="${escapeHtml(title)}">
            <h3>${title}</h3>
            <table>
                <thead><tr><th>Group</th><th>N originals</th><th>Per-paper mean</th><th>Median</th><th>Weighted mean</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
            ${note ? `<p class="cocit-breakdown-note">${note}</p>` : ''}
        </div>`;
    }

    function renderCocitBreakdown() {
        const el = document.getElementById('cocit-breakdown');
        if (!el) return;
        const bd = CI.cocitBreakdown;
        if (!bd) { el.innerHTML = '<p class="muted">Not available yet — this analysis is included from the next scheduled data refresh.</p>'; return; }
        el.innerHTML =
            renderBreakdownTable('By replication report size', bd.pub_status || {}, PUBSTATUS_LABELS) +
            renderBreakdownTable('By outcome of the replication', bd.outcome || {}, BREAKDOWN_OUTCOME_LABELS);
    }

    function renderCocitCell(s) {
        if (!s.n_cocitations && s.n_cocitations !== 0) return '—';
        const denom = s.n_citations_post_first_rep;
        const pct = denom > 0 ? escapeHtml(FloraCharts.percent(s.cocit_prop,1,1)) + '%' : '—';
        const tooltip = denom
            ? `${FloraCharts.number(s.n_cocitations)} of ${FloraCharts.number(denom)} citations since the first replication (${s.first_replication_year}) also cite a replication`
            : `${FloraCharts.number(s.n_cocitations)} co-citations`;
        return `<span title="${escapeHtml(tooltip)}">${FloraCharts.number(s.n_cocitations)}<span class="cocit-pct"> (${pct}${denom > 0 ? ` of ${FloraCharts.number(denom)}` : ""})</span></span>`;
    }

    function renderTable() {
        const focused = document.activeElement;
        const pageAction = focused.closest('#pagination button')?.dataset.action;
        const pageNumber = focused.closest('#pagination button')?.dataset.p;
        const timelineRow = focused.closest('#originals-table tbody tr');
        const rowIndex = timelineRow ? [...timelineRow.parentElement.children].indexOf(timelineRow) : -1;
        const q = document.getElementById('search-input').value || '';
        const tokens = searchTokens(q);
        const outFilter = document.getElementById('filter-outcome').value;

        let rows = CI.index.filter(s => {
            if (!matchesSearchTokens(s.searchText, tokens)) return false;
            if (outFilter && !(s.outcome_mix && s.outcome_mix[outFilter])) return false;
            return true;
        });

        const col = CI.sortCol, dir = CI.sortDir;
        rows.sort((a, b) => {
            const av = a[col] != null ? a[col] : -Infinity;
            const bv = b[col] != null ? b[col] : -Infinity;
            return dir === 'asc' ? av - bv : bv - av;
        });

        // Update header indicators
        document.querySelectorAll('#originals-table thead th[data-sort]').forEach(th => {
            th.classList.remove('sort-asc', 'sort-desc');
            if (th.dataset.sort === col) th.classList.add(dir === 'asc' ? 'sort-asc' : 'sort-desc');
        });
        document.querySelectorAll('#originals-table th').forEach(th => {
            const active = th.querySelector(`[data-sort="${col}"]`);
            if (active) th.setAttribute('aria-sort', dir === 'asc' ? 'ascending' : 'descending');
            else th.removeAttribute('aria-sort');
        });
        document.querySelectorAll('.cocit-sort-btn').forEach(btn => {
            btn.setAttribute('aria-pressed', String(btn.dataset.sort === col));
            btn.classList.remove('sort-asc', 'sort-desc');
            if (btn.dataset.sort === col) btn.classList.add(dir === 'asc' ? 'sort-asc' : 'sort-desc');
        });

        const total = rows.length;
        const empty = document.getElementById('ci-search-empty');
        empty.hidden = total > 0;
        document.getElementById('ci-search-empty-message').textContent = q.trim() ? `No originals match “${q.trim()}” with the current outcome selection.` : 'No originals match the current outcome selection.';
        document.getElementById('ci-clear-search').hidden = !q.trim();
        const pages = Math.max(1, Math.ceil(total / CI.perPage));
        if (CI.page > pages) CI.page = 1;
        const start = (CI.page - 1) * CI.perPage;
        const slice = rows.slice(start, start + CI.perPage);

        const tbody = document.querySelector('#originals-table tbody');
        tbody.innerHTML = slice.map(s => {
            return `
                <tr data-doi="${escapeHtml(s.doi)}">
                    <td>
                        <div class="title-cell">${escapeHtml(s.title || '(untitled)')}</div>
                        <div class="author-cell">${escapeHtml(formatAuthors(s.author))} ${s.venue && s.venue !== 'nan' ? '· ' + escapeHtml(s.venue) : ''}</div>
                    </td>
                    <td>${s.year || '—'}</td>
                    <td>${renderOutcomeBar(s.outcome_mix, s.n_replications)}</td>
                    <td>${FloraCharts.number(s.n_citations || 0)}</td>
                    <td>${renderCocitCell(s)}</td>
                    <td><button type="button" class="timeline-open" aria-label="Open citation timeline for ${escapeHtml(s.title || s.doi)}">Timeline</button></td>
                </tr>`;
        }).join('');

        const pag = document.getElementById('pagination');
        if (!total) { pag.innerHTML = ''; return; }
        const winSize = 5;
        const winStart = Math.max(1, CI.page - Math.floor(winSize / 2));
        const winEnd = Math.min(pages, winStart + winSize - 1);
        let pHtml = '';
        if (CI.page > 1) pHtml += `<button type="button" data-action="previous" data-p="${CI.page - 1}" aria-label="Previous page">‹</button>`;
        for (let i = winStart; i <= winEnd; i++) pHtml += `<button type="button" data-p="${i}" ${i === CI.page ? 'aria-current="page"' : ''} class="${i === CI.page ? 'active' : ''}" aria-label="Page ${i}">${i}</button>`;
        if (CI.page < pages) pHtml += `<button type="button" data-action="next" data-p="${CI.page + 1}" aria-label="Next page">›</button>`;
        pag.innerHTML = pHtml;
        if (pageNumber) (pag.querySelector(pageAction ? `[data-action="${pageAction}"]` : `[data-p="${pageNumber}"]`) || pag.querySelector('[aria-current]'))?.focus({preventScroll:true});
        else if (rowIndex >= 0) (tbody.rows[Math.min(rowIndex, tbody.rows.length - 1)]?.querySelector('.timeline-open') || document.getElementById('originals-table')).focus();
    }

    // Fetch one original's full record (citation timeline and replication list),
    // keeping it for the rest of the session.
    async function loadStudy(entry) {
        if (CI.studyCache[entry.doi]) return CI.studyCache[entry.doi];
        const res = await fetch('data/originals/' + encodeURIComponent(entry.file));
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const s = await res.json();
        CI.studyCache[entry.doi] = s;
        return s;
    }

    function modalHeader(entry) {
        return `<h2>${escapeHtml(entry.title || '(untitled)')}</h2>
                <p class="muted">${escapeHtml(formatAuthors(entry.author))} · ${entry.year || '?'}
                    ${entry.venue && entry.venue !== 'nan' ? '· ' + escapeHtml(entry.venue) : ''}<br>
                    <a href="https://doi.org/${escapeHtml(entry.doi)}" target="_blank">${escapeHtml(entry.doi)}</a></p>`;
    }

    async function showStudy(doi, fromDeepLink = false) {
        const entry = CI.index && CI.index.find(s => s.doi === doi);
        if (!entry) return;
        CI.currentDoi = doi;
        CI.openStudy = null;
        CI.lastFocus = document.activeElement;
        const body = document.getElementById('ci-modal-body');
        body.innerHTML = `<div class="modal-body">${modalHeader(entry)}
            <p class="muted" style="padding:40px 0;text-align:center">Loading citation timeline…</p></div>`;
        document.getElementById('ci-modal').hidden = false;
        setBackgroundInert(true);
        document.getElementById('ci-modal-close').focus();
        // Add a closable history entry for user opens; keep initial share links in place.
        if (fromDeepLink) history.replaceState(null, '', citationLink(doi));
        else history.pushState(null, '', citationLink(doi));

        let s;
        try {
            s = await loadStudy(entry);
        } catch (e) {
            console.error('Citation timeline load failed:', e);
            if (CI.currentDoi === doi) {
                body.innerHTML = `<div class="modal-body">${modalHeader(entry)}
                    <p class="muted" style="padding:40px 0;text-align:center">Could not load the citation timeline for this study.</p></div>`;
            }
            return;
        }
        // A second row may have been clicked while this fetch was in flight.
        if (CI.currentDoi !== doi) return;
        renderStudy(s);
    }

    // Sort a copy for display; stored order still defines ties in the aggregate model.
    const chronologicalReplications = s => [...(s.replications || [])].sort((a,b)=>(Number(a.year) || Infinity)-(Number(b.year) || Infinity));

    function renderStudy(s) {
        // Each replication is numbered; the same number marks its event line in the timeline.
        const reps = chronologicalReplications(s).map((r, i) => `
            <li>
                <span class="rep-marker" role="img" style="color:${OUTCOME_COLORS[r.outcome] || 'inherit'}" aria-label="Marker ${i + 1}">${i + 1}</span>
                <span class="outcome-badge ${r.outcome}">${r.outcome}</span>
                <strong>${escapeHtml(formatAuthors(r.author, 2))} (${r.year || '?'})</strong>
                ${r.title ? '— ' + escapeHtml(r.title) : ''}
                ${r.doi ? `<br><a href="https://doi.org/${escapeHtml(r.doi)}" target="_blank" class="small">${escapeHtml(r.doi)}</a>` : ''}
            </li>`).join('');
        document.getElementById('ci-modal-body').innerHTML = `
            <div class="modal-body">
                ${modalHeader(s)}
                <button type="button" class="ci-share-btn" data-doi="${escapeHtml(s.doi)}">Copy link to this chart</button>
                <h3 style="margin-top:18px">Citation timeline</h3>
                ${s.cocit_conflated ? `<p class="cocit-warning">Co-citation can't be measured for ${s.cocit_conflated > 1 ? 'some replications of ' : ''}this study: OpenCitations groups the original and ${s.cocit_conflated > 1 ? 'those replications' : 'its replication'} under one record, so citations of the two can't be told apart. The timeline below counts all of them as citations of the original.</p>` : ''}
                <div id="study-plot" style="width:100%;height:380px"></div>
                <h3 style="margin-top:18px">Replications (${FloraCharts.number(s.n_replications)})</h3>
                <ul class="rep-list">${reps}</ul>
            </div>`;
        // Remember what had focus so we can restore it when the modal closes.
        document.getElementById('ci-modal').hidden = false;
        // Move focus into the modal for keyboard/screen-reader users.
        const closeBtn = document.getElementById('ci-modal-close');
        if (closeBtn) closeBtn.focus();
        // Reflect the open chart in the address bar so it's directly shareable.
        history.replaceState(null, '', citationLink(s.doi));
        CI.openStudy = s;
        drawStudyTimeline(s);
    }

    function setBackgroundInert(value) {
        document.querySelectorAll('body > .top-bar, body > main, body > .footer-bar').forEach(el => el.inert = value);
    }

    function closeModal(updateUrl = true) {
        const modal = document.getElementById('ci-modal');
        if (modal.hidden) return;
        modal.hidden = true;
        setBackgroundInert(false);
        CI.currentDoi = null;
        // Drop ?doi= but keep the user on the Citation Impact tab.
        if (updateUrl) {
            const url = new URL(location.href);url.searchParams.delete('doi');history.replaceState(null,'',url);
        }
        // History restoration focuses the destination pane after switching tabs.
        if (updateUrl && CI.lastFocus && typeof CI.lastFocus.focus === 'function') CI.lastFocus.focus();
        CI.lastFocus = null;
    }
    document.addEventListener('flora-history', () => closeModal(false));

    const TIMELINE_NARROW = 600;
    // Label style and collision spacing depend on the current chart width.
    let timelineResizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(timelineResizeTimer);
        timelineResizeTimer = setTimeout(() => {
            const shown = CI.openStudy;
            if (!shown || shown.doi !== CI.currentDoi || !document.getElementById('study-plot')) return;
            drawStudyTimeline(shown);
        }, 120);
    });

    function drawStudyTimeline(s) {
        if (typeof Plotly === 'undefined') { chartLibUnavailable('study-plot', 'Plotly', () => drawStudyTimeline(s)); return; }
        const tl = s.timeline || [];
        if (tl.length === 0) {
            document.getElementById('study-plot').innerHTML = '<div style="padding:80px;text-align:center;color:var(--color-muted-fg)">No citation data available</div>';
            return;
        }
        const years = tl.map(t => t.year);
        const traces = [
            { x: years, y: tl.map(t => t.only),            name: 'Cites original only',    type: 'bar', marker: { color: FloraCharts.token('--color-chart-neutral') } },
            { x: years, y: tl.map(t => t.with_failed),     name: 'Co-cites failed rep',    type: 'bar', marker: { color: OUTCOME_COLORS.failed } },
            { x: years, y: tl.map(t => t.with_mixed),      name: 'Co-cites mixed rep',     type: 'bar', marker: { color: OUTCOME_COLORS.mixed } },
            { x: years, y: tl.map(t => t.with_successful), name: 'Co-cites successful rep',type: 'bar', marker: { color: OUTCOME_COLORS.successful } },
            { x: years, y: tl.map(t => t.with_multiple || 0), name: 'Co-cites multiple outcome categories', type: 'bar', marker: {color: FloraCharts.token('--color-chart-qualified')} }
        ].filter(trace=>trace.y.some(v=>v>0));
        // The coverage year stays partial even if this snapshot is viewed in a later year.
        const partialYear = Number((CI.meta?.last_updated || '').slice(0,4)) || new Date().getFullYear();
        traces.forEach(trace=>{
            trace.marker.opacity = years.map(year=>year===partialYear ? 0.45 : 1);
            trace.hovertemplate = 'Year: %{x}<br>Citations: %{y:,.0f}<extra>%{fullData.name}</extra>';
        });
        const maxYearlyCount = Math.max(0,...years.map((_,i)=>traces.reduce((n,trace)=>n+trace.y[i],0)));
        const t = plotlyTheme();
        const shapes = []; const annotations = [];
        const narrow = window.innerWidth < TIMELINE_NARROW;
        // Place nearby events in separate pixel-spaced lanes, including same-year ties.
        const lanes = [];
        const width = document.getElementById('study-plot').clientWidth - (narrow ? 80 : 60);
        const minYear = Math.min(...years), span = Math.max(...years)-minYear+1;
        chronologicalReplications(s).forEach((r, i) => {
            if (!r.year) return;
            shapes.push({ type: 'line', x0: r.year, x1: r.year, yref: 'paper', y0: 0, y1: 1, line: { color: OUTCOME_COLORS[r.outcome] || t.primary, width: 2, dash: 'dash' } });
            const label = narrow ? String(i + 1) : `${i + 1} · ${r.outcome} ${r.year}`;
            const x = (r.year-minYear)*width/span, half = label.length*(narrow ? 3.5 : 3)+5;
            let row = lanes.findIndex(end=>end+6 < x-half);
            if (row < 0) row = lanes.length;
            lanes[row] = x+half;
            annotations.push({ name:'replication-event', x: r.year, yref: 'paper', y: 1.02, yshift: -row*22, text: label, showarrow: false, borderpad:2, font: { size: narrow ? 11 : 10, color: OUTCOME_COLORS[r.outcome] || t.primary }, bgcolor: t.paper });
        });
        if (years.includes(partialYear)) annotations.push({name:'partial-year',x:partialYear,xref:'x',yref:'paper',y:1.14,xanchor:'right',text:`${partialYear}: partial year`,showarrow:false,font:{size:11,color:t.muted}});
        const layout = {
            barmode: 'stack', margin: { t: 50, r: 10, b: 40, l: 50 },
            xaxis: { title: 'Year', gridcolor: t.grid, color: t.font },
            yaxis: { title: 'Citing preprints / papers', ...FloraCharts.countAxis(maxYearlyCount), gridcolor: t.grid, color: t.font },
            shapes, annotations, hoverlabel:{namelength:-1},
            plot_bgcolor: t.plot, paper_bgcolor: t.paper,
            legend: { orientation: 'h', y: -0.18, font: { color: t.font } },
            font: { family: t.fontFamily, size: 12, color: t.font }
        };
        FloraCharts.plot('study-plot', traces, layout, { displayModeBar: false, responsive: true });
    }

    function bindEvents() {
        document.querySelectorAll('#outcome-chips .chip').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('#outcome-chips .chip').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                CI.outcome = btn.dataset.value; renderAggregate();
            });
        });
        const input = document.getElementById('search-input');
        let searchTimer;
        input.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { CI.page = 1; renderTable(); }, 200); });
        document.getElementById('ci-clear-search').addEventListener('click', () => {
            clearTimeout(searchTimer); input.value = ''; input.dispatchEvent(new Event('input')); input.focus();
        });
        document.getElementById('filter-outcome').addEventListener('change', () => { CI.page = 1; renderTable(); });
        function sortBy(col) {
            if (CI.sortCol === col) {
                CI.sortDir = CI.sortDir === 'desc' ? 'asc' : 'desc';
            } else {
                CI.sortCol = col;
                CI.sortDir = 'desc';
            }
            CI.page = 1;
            renderTable();
        }
        document.querySelectorAll('#originals-table button[data-sort]').forEach(btn => {
            btn.addEventListener('click', () => sortBy(btn.dataset.sort));
        });
        document.querySelector('#originals-table tbody').addEventListener('click', e => {
            const tr = e.target.closest('tr');
            if (tr && tr.dataset.doi) showStudy(tr.dataset.doi);
        });
        document.getElementById('pagination').addEventListener('click', e => {
            if (e.target.dataset.p) { CI.page = +e.target.dataset.p; renderTable(); }
        });
        document.getElementById('ci-modal-body').addEventListener('click', e => {
            const btn = e.target.closest('.ci-share-btn');
            if (!btn) return;
            const link = citationLink(btn.dataset.doi);
            navigator.clipboard.writeText(link).then(() => {
                const orig = btn.textContent;
                btn.textContent = 'Link copied';
                setTimeout(() => { btn.textContent = orig; }, 1500);
            }).catch(() => window.prompt('Copy this link:', link));
        });
        document.getElementById('ci-modal-close').addEventListener('click', closeModal);
        document.getElementById('ci-modal').addEventListener('click', e => {
            if (e.target.id === 'ci-modal') closeModal();
        });
        // Escape closes the modal when it's open.
        document.addEventListener('keydown', e => {
            const modal = document.getElementById('ci-modal');
            if (e.key === 'Tab' && !modal.hidden) {
                const items = [...modal.querySelectorAll('button, a[href], input, select, summary, [tabindex="0"]')].filter(el => el.getClientRects().length);
                const first = items[0], last = items[items.length - 1];
                if (e.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) { e.preventDefault(); last?.focus(); }
                else if (!e.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) { e.preventDefault(); first?.focus(); }
            }
            if (e.key === 'Escape' && !document.getElementById('ci-modal').hidden) closeModal();
        });
    }

    // Memoised loader so the deep-link handler can await the same in-flight
    // load that opening the tab triggers (avoids a load race).
    let initPromise = null;
    function ensureInit() {
        if (!initPromise) initPromise = init();
        return initPromise;
    }

    // ===== Deep-linking: /citations/?doi=<doi> opens a study's chart popup =====
    function normalizeDoi(doi) {
        return (doi || '').trim().toLowerCase()
            .replace(/^https?:\/\/(dx\.)?doi\.org\//, '')
            .replace(/^doi:/, '');
    }

    // Resolve a (possibly prefixed) DOI to the matching key in the index.
    function findStudyDoi(doi) {
        const t = normalizeDoi(doi);
        if (!t || !CI.index) return null;
        const hit = CI.index.find(s => normalizeDoi(s.doi) === t);
        return hit ? hit.doi : null;
    }

    // Build the shareable ?tab=citations&doi=… URL on the main page, relative
    // so it works under the GitHub Pages project path (/flora-explorer/).
    function citationLink(doi) {
        const url = new URL(location.href); url.searchParams.set('tab','citations');url.searchParams.set('doi',doi);return url.href;
    }

    // Switch to the Citation Impact tab, ensure data is loaded, then open the
    // study's chart popup. Returns true if a matching study was found.
    async function openStudyByDoi(doi) {
        await ensureInit();
        if (normalizeDoi(new URLSearchParams(location.search).get('doi')) !== normalizeDoi(doi)) return false;
        const matchDoi = findStudyDoi(doi);
        if (!matchDoi) return false;
        const tabBtn = document.getElementById('citation-tab');
        if (tabBtn && window.bootstrap) bootstrap.Tab.getOrCreateInstance(tabBtn).show();
        await showStudy(matchDoi, true);
        return true;
    }

    // Read ?doi= from the current URL and open the matching popup, if any.
    async function handleDeepLink() {
        const doi = new URLSearchParams(window.location.search).get('doi');
        if (doi) await openStudyByDoi(doi);
    }

    // Lazy-load when the user opens the tab
    document.getElementById('citation-tab').addEventListener('shown.bs.tab', ensureInit);

    // A DOI deep link can load citation data before the main CSV finishes.
    document.addEventListener('flora-ready', () => {
        if (!CI.index) return;
        CI.index = buildSearchIndex(CI.index);
        if (CI.loaded) renderTable();
    });

    setupStudyTypeSelect('ci-study-type', kind => { ciKind = kind; renderCiKindGate(kind); });

    // Open a study popup straight away if arrived via /citations/?doi=…
    handleDeepLink();

    // Re-theme Plotly plots on dark-mode toggle
    document.getElementById('theme-toggle').addEventListener('click', () => {
        if (CI.loaded) {
            // Tiny delay to let CSS variables update
            setTimeout(() => { renderAggregate(); }, 50);
        }
        // Redraw only the rendered timeline of the study currently shown.
        const shown = CI.openStudy;
        if (shown && shown.doi === CI.currentDoi && document.getElementById('study-plot')) {
            setTimeout(() => { if (CI.openStudy === shown) drawStudyTimeline(shown); }, 50);
        }
    });
})();
