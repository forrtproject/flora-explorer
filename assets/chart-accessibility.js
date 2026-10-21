/* Every chart exposes the same plotted values as a keyboard-accessible table and CSV. */
window.FloraCharts = (() => {
    const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const plain = s => (Array.isArray(s) ? s.join(' ') : String(s ?? '')).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const number = (v, digits = 0) => Number(v).toLocaleString('en-GB', {minimumFractionDigits:digits,maximumFractionDigits:digits}).replace(/-/g, '−');
    // Integer formatting alone rounds fractional auto-ticks into repeated labels.
    // Keep small count axes integral; let Plotly choose readable steps for larger counts.
    const countAxis = max => ({tickformat:',d', dtick:max <= 10 ? 1 : undefined});
    const percent = (n, total, digits = 0) => {
        const share = total > 0 ? 100 * (n || 0) / total : 0;
        return share > 0 && share < 1 ? '<1' : number(share, digits);
    };
    const fmt = (v, header = '') => typeof v === 'number' ? v.toLocaleString('en-GB', {useGrouping:!/year|X \/ category/i.test(header),maximumFractionDigits:/Wilson/.test(header) ? 1 : 5}).replace(/-/g, '−') : plain(v);
    const comparisonIds = new Set(['ao-chart', 'rr-chart', 'pub-chart', 'ls-chart']);
    // Chart colours resolve from CSS tokens at render time, so every chart follows the theme.
    const token = (name, fallback = '') => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
    const seriesPatterns = {"rep-successful": "", "rep-failed": "/", "rep-mixed": ".", "rep-qualified": "x", "rep-inconclusive": "|", "rep-other": "-", "comp-successful": "", "comp-issues": ".", "comp-technical-failure": "/", "rob-robust": "", "rob-challenges": "\\", "citation-multiple": "+"};
    function seriesStyle(key) {
        return {color:token('--color-series-' + key), pattern:seriesPatterns[key] || ''};
    }
    function seriesKey(label, id = '') {
        const name = plain(label).toLowerCase();
        if (name.includes('multiple outcome')) return 'citation-multiple';
        if (name.includes('technical failure')) return 'comp-technical-failure';
        if (name.includes('computational issues')) return 'comp-issues';
        if (name.includes('robustness challenges')) return 'rob-challenges';
        if (name === 'robust') return 'rob-robust';
        if (name.includes('successful but flawed')) return 'rep-qualified';
        if (name.includes('successful')) return /computational/.test(id) ? 'comp-successful' : 'rep-successful';
        for (const k of ['failed','mixed','inconclusive']) if (name.includes(k)) return 'rep-' + k;
        if (/other|not coded/.test(name)) return 'rep-other';
        return null;
    }
    function canvasFill(style) {
        if (!style.pattern) return style.color;
        const tile = document.createElement('canvas'); tile.width = tile.height = 10;
        const ctx = tile.getContext('2d'); ctx.fillStyle = style.color; ctx.fillRect(0,0,10,10);
        ctx.strokeStyle = token('--color-badge-on-outcome'); ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = 1.3;
        if (style.pattern === '.') { ctx.beginPath(); ctx.arc(5,5,1.5,0,2*Math.PI); ctx.fill(); }
        else {
            ctx.beginPath();
            if (['/','x'].includes(style.pattern)) {ctx.moveTo(0,10);ctx.lineTo(10,0);}
            if (['\\','x'].includes(style.pattern)) {ctx.moveTo(0,0);ctx.lineTo(10,10);}
            if (['|','+'].includes(style.pattern)) {ctx.moveTo(5,0);ctx.lineTo(5,10);}
            if (['-','+'].includes(style.pattern)) {ctx.moveTo(0,5);ctx.lineTo(10,5);}
            ctx.stroke();
        }
        return ctx.createPattern(tile,'repeat');
    }
    function theme() {
        return {
            paper: token('--color-surface-raised', '#fff'), plot: token('--color-surface-raised', '#fff'),
            grid: token('--color-border-light', '#e0e1e1'), font: token('--color-text', '#2c2c2c'),
            tick: token('--color-text-secondary', '#4a4a4a'), muted: token('--color-muted-fg', '#6b7280'),
            primary: token('--color-primary', '#853953'), band: token('--color-plot-band'),
            point: token('--color-plot-point'), rule: token('--color-plot-rule'), ruleLabel: token('--color-plot-rule-label'),
            fontFamily: token('--font-body', 'sans-serif'),
        };
    }
    const modes = new Map();
    const originals = new Map();
    const plots = new Map();
    const heights = new Map();
    let resizeTimer;
    window.addEventListener('resize',()=>{
        clearTimeout(resizeTimer);
        resizeTimer=setTimeout(()=>plots.forEach((args,id)=>{
            const el=document.getElementById(id);
            if (id !== 'study-plot' && el?.getClientRects().length) plot(el,...args);
        }),120);
    });
    function csvText(headers, rows, notes = '', rawNumbers = false) {
        // Prefix formula-like text so spreadsheet programs treat it as data.
        const cell = v => '"' + (typeof v === 'number' ? String(rawNumbers ? v : Number(v.toFixed(5))) : (Array.isArray(v) ? plain(v) : String(v ?? '')).replace(/^[=+@-]/, m => "'" + m)).replace(/"/g, '""') + '"';
        return [notes ? ['Export context', ...headers] : headers, ...rows.map(row => notes ? [notes,...row] : row)].map(row => row.map(cell).join(',')).join('\r\n');
    }
    function download(name, headers, rows, notes = '') {
        const text = csvText(headers, rows, notes);
        const link = document.createElement('a');
        const url = URL.createObjectURL(new Blob(['\ufeff' + text], {type:'text/csv;charset=utf-8'}));
        link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    function context(el) {
        const pane = el.closest('.tab-pane');
        const stamp = (pane ? [...pane.querySelectorAll('.data-stamp')].map(s=>s.textContent.trim()).filter(Boolean).join('; ') : document.querySelector('#citation-impact .data-stamp')?.textContent.trim()) || 'Snapshot date: see tab update stamp';
        const filters = [...(pane?.querySelectorAll('.chip.active, .trend-filter-btn.active') || [])].map(e => e.textContent.trim()).join('; ');
        return `${stamp}. ${filters ? 'Selection: ' + filters + '. ' : ''}Values and units correspond to the labelled series. Reference pairs can share reports; reproduction dimensions can overlap.`;
    }
    // Captions and accessible names come from the chart's visible heading, not its element ID.
    function visibleTitle(el) {
        const heading = el.closest('.outcome-chart-row')?.querySelector('.outcome-chart-label > span:first-child')
            || el.closest('.trend-block')?.querySelector('.trend-desc h3')
            || el.closest('.mc-chart-card, .plot-card')?.querySelector('.mc-chart-title, h3')
            || el.closest('.modal-body')?.querySelector('h3');
        const prefix = el.id.startsWith('browse-') ? 'Browse results: ' : /^plot-(cit|cocit)/.test(el.id) ? (el.id.endsWith('-model') ? 'Adjusted association: ' : 'Raw trajectory: ') : '';
        return heading ? prefix + plain(heading.textContent) : el.id.replace(/-/g, ' ');
    }
    // Removes a chart together with everything that describes or exports it, so an
    // unavailable chart never leaves a working copy action or a stale table behind.
    function clear(target) {
        const el = typeof target === 'string' ? document.getElementById(target) : target;
        if (!el) return;
        const id = el.id + '-data';
        for (const suffix of ['', '-copy', '-copy-status']) document.getElementById(id + suffix)?.remove();
        // A comparison toggle would otherwise replot the saved traces into the cleared chart.
        document.getElementById(el.id + '-mode')?.remove();
        document.getElementById(el.id + '-comparison-note')?.remove(); originals.delete(el.id);
        plots.delete(el.id);
        el.removeAttribute('aria-describedby'); el.removeAttribute('role'); el.removeAttribute('aria-label');
        if (typeof Plotly !== 'undefined' && el.data) Plotly.purge(el);
    }
    function table(el, rows, headers, summary, options = {}) {
        const id = el.id + '-data';
        let details = document.getElementById(id);
        if (!details) {
            details = document.createElement('details'); details.id = id; details.className = 'chart-data';
            const anchor = el.tagName === 'CANVAS' ? el.parentElement : el;
            anchor.insertAdjacentElement('afterend', details);
        }
        const wasOpen = details.open;
        details.innerHTML = `<summary aria-label="View chart data for ${escape(visibleTitle(el))}">View chart data</summary><p class="chart-summary">${escape(summary)}</p><p class="chart-context">${escape(context(el))}</p><div class="table-scroll" tabindex="0" role="region" aria-label="${escape(visibleTitle(el))}: chart values"><table><caption>${escape(visibleTitle(el))}</caption><thead><tr>${headers.map(h=>`<th scope="col">${escape(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map((v,i)=>i ? `<td>${escape(fmt(v, headers[i]))}</td>` : `<th scope="row">${escape(fmt(v, headers[i]))}</th>`).join('')}</tr>`).join('')}</tbody></table></div>`;
        details.open = wasOpen;
        const label = el.closest('.outcome-chart-row')?.querySelector('.outcome-chart-label') || el.closest('.trend-block')?.querySelector('.trend-title');
        let action = document.getElementById(id + '-copy');
        if (!action) {
            action = document.createElement('button');
            action.id = id + '-copy'; action.type = 'button'; action.className = 'chart-copy icon-action';
            action.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>';
            if (label) label.append(action);
            else details.before(action);
        }
        let status = document.getElementById(id + '-copy-status');
        if (!status) {
            status = document.createElement('span');
            status.id = id + '-copy-status'; status.className = 'visually-hidden'; status.setAttribute('role', 'status');
            action.after(status);
        }
        action.setAttribute('aria-label', 'Copy chart CSV for ' + visibleTitle(el));
        action.title = 'Copy chart CSV';
        action.onclick = async () => {
            status.textContent = '';
            try {
                await navigator.clipboard.writeText(csvText(headers, options.exportRows || rows, summary + '\n' + context(el), options.rawNumbers));
                action.title = 'Chart CSV copied';
                action.setAttribute('aria-label', 'Chart CSV copied for ' + visibleTitle(el));
                status.textContent = 'Chart CSV copied';
                setTimeout(() => { action.title = 'Copy chart CSV'; action.setAttribute('aria-label', 'Copy chart CSV for ' + visibleTitle(el)); }, 2000);
            } catch {
                action.title = 'Could not copy chart CSV';
                status.textContent = 'Could not copy chart CSV';
            }
        };
        el.setAttribute('aria-describedby', id);
    }
    function chart(ctx, config) {
        const el = ctx.canvas || ctx;
        for (const dataset of config.data.datasets || []) {
            const key = Object.keys(seriesPatterns).find(k => token('--color-series-' + k) === dataset.backgroundColor) || seriesKey(dataset.label, el.id);
            if (key) dataset.backgroundColor = canvasFill(seriesStyle(key));
        }
        const datasets = config.data.datasets || [], labels = config.data.labels || [];
        el.setAttribute('role','img'); el.setAttribute('aria-label',visibleTitle(el) + '. Values in the following data table.');
        const rows = labels.map((label,i) => [label,...datasets.map(d=>d.data[i] ?? 0)]);
        const total = datasets.reduce((n,d)=>n+d.data.reduce((sum,v)=>sum+(Number(v)||0),0),0);
        const isOutcome = /outcome|computational|robustness/.test(el.id);
        const eligible = el.id.startsWith("trend-") ? trendsFilteredData().length : el.id.startsWith("browse-") ? getChartData().length : fullRowData.filter(r => classifyKind(r) === (/computational|robustness/.test(el.id) ? "reproduction" : "replication")).length;
        const sample = `Included in the plot: ${number(total)}; excluded from this selection: ${number(Math.max(0,eligible-total))} reference ${eligible-total === 1 ? 'pair' : 'pairs'}. ` + (isOutcome ? `${total ? '' : 'No matching assessed outcomes. '}${/computational|robustness/.test(el.id) ? 'Unchecked or uncoded values for this dimension are excluded; the two reproduction subsets overlap.' : 'All replication outcomes are included; qualified success and other/uncoded outcomes are separate.'}` : 'Counts are reference pairs in the displayed categories; journal charts show only the selected top N.');
        table(el,rows,['Category',...datasets.map(d=>d.label)],sample);
        if (config.options.scales) for (const axis of Object.values(config.options.scales)) if (axis.ticks) axis.ticks.autoSkip = !config.options.indexAxis || config.options.indexAxis !== 'y';
        if (config.options.plugins?.legend) config.options.plugins.legend.reverse = false;
        Chart.defaults.font.family = theme().fontFamily;
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) config.options.animation = false;
        return new Chart(ctx, config);
    }
    // options.table = {headers, rows, summary} replaces the generic per-trace table, for
    // charts whose plotted traces (interval bands, jittered points) are not the data.
    function plot(target, traces, layout = {}, config = {}, options = {}) {
        const el = typeof target === 'string' ? document.getElementById(target) : target;
        if (!el) return Promise.resolve();
        const id = el.id;
        traces = traces.map(t => {
            const key = t.semanticKey || seriesKey(t.name, id);
            if (!key || t.type !== 'bar') return t;
            const style = seriesStyle(key);
            return {...t,marker:{...t.marker,color:style.color,pattern:{shape:style.pattern,bgcolor:style.color,fillmode:'overlay',fgcolor:token('--color-badge-on-outcome'),size:10,solidity:.15}}};
        });
        plots.set(id,[traces,layout,config,options]);
        if (!heights.has(id)) heights.set(id,el.style.height);
        el.style.height = heights.get(id);
        // Every Plotly chart uses the page font unless a renderer sets one.
        layout = {...layout, font: {family: theme().fontFamily, ...layout.font}};
        // Size a plot only after its analysis card is visible. Hidden cards otherwise
        // give Plotly a zero-width container and trigger its 700px fallback.
        const card = el.closest('.mc-chart-card');
        if (card) card.style.display = '';
        let display = traces.map(t=>({...t}));
        layout = {...layout, autosize:true, legend:{...layout.legend,traceorder:'normal'}};
        for (const key of Object.keys(layout).filter(k=>/^[xy]axis\d*$/.test(k))) {
            const axis = layout[key], title = typeof axis.title === 'string' ? {text:axis.title} : axis.title;
            layout[key] = {...axis,automargin:true,title:{...title,standoff:12}};
        }
        const counts = modes.get(id) === 'count';
        let summary = 'Values below include every plotted series; interval limits are shown where available.';
        if (comparisonIds.has(id)) {
            originals.set(id, [traces,{...layout,xaxis:{...layout.xaxis},yaxis:{...layout.yaxis}},config,options]);
            const nGroups = traces[0]?.x?.length || 0;
            const groups = options.comparison || [];
            const denominator = (i, n) => `N=${number(n)} pairs<br>from ${number(groups[i]?.reports || 0)} reports`;
            const totals = Array.from({length:nGroups}, (_,i)=>traces.reduce((sum,t)=>sum+(Number(t.y?.[i])||0),0));
            display = display.map(t=>({...t, x:t.x.map((v,i)=>plain(v).replace(/(.{1,18})(?:\s|$)/g, '$1<br>').replace(/<br>$/, '')+`<br>${denominator(i,totals[i])}`),
                y:t.y.map((v,i)=>counts ? v : totals[i] >= 20 ? 100*v/totals[i] : null),
                customdata:t.y.map((v,i)=>[v,totals[i], escape(percent(v,totals[i],1))]),
                hovertemplate:counts ? '%{x}<br>%{y:,.0f} reference pairs<extra>%{fullData.name}</extra>' : '%{x}<br>%{customdata[2]}% (%{customdata[0]:,.0f} pairs)<extra>%{fullData.name}</extra>'}));
            // Whiskers describe only the first (headline) outcome, at its stack boundary.
            // Other categories retain the full composition and exact table counts.
            layout.shapes = [];
            if (!counts && display[0]) {
                const bounds = groups.map(g => g?.outcomes?.[options.outcomeKeys?.[0]]?.wilson || [null,null]);
                // Draw above every stack segment: trace error bars would be covered
                // by the next outcome's bar at the headline-share boundary.
                totals.forEach((n,i) => {
                    const [lo,hi] = bounds[i];
                    if (n < 20 || lo == null || hi == null) return;
                    const line = {color:token('--color-badge-on-outcome'),width:2};
                    layout.shapes.push(
                        {type:'line',x0:i,x1:i,y0:lo,y1:hi,line,layer:'above'},
                        {type:'line',x0:i-.05,x1:i+.05,y0:lo,y1:lo,line,layer:'above'},
                        {type:'line',x0:i-.05,x1:i+.05,y0:hi,y1:hi,line,layer:'above'});
                });
                display[0].text = display[0].y.map(v => v == null ? '' : number(v,1) + '%');
                display[0].textposition = 'inside';
                display[0].insidetextanchor = 'middle'; display[0].textangle = 0;
                display[0].insidetextfont = {color:token('--color-badge-on-outcome')};
            }
            layout.annotations = counts ? [] : totals.flatMap((n,i) => n < 20 ? [{
                x:display[0].x[i], y:50, text:`Too few to show<br>(N = ${number(n)})`, showarrow:false,
                font:{color:theme().font,size:11}, bgcolor:theme().paper,
            }] : []);
            let note = document.getElementById(id + '-comparison-note');
            if (!note) {
                note = document.createElement('div'); note.id = id + '-comparison-note'; note.className = 'comparison-note'; el.before(note);
            }
            note.innerHTML = '<p>Display minimum: 20 reference pairs per group. Smaller groups remain in counts and chart data.</p>' +
                `<p>Whiskers show Wilson 95% intervals for ${escape(plain(traces[0]?.name).toLowerCase())}. These intervals treat pairs as independent and are therefore too narrow when pairs share reports. They do not account for uneven database coverage. Reports can occur in several groups; do not add report counts across groups.</p>` +
                '<ul>' + totals.map((n,i) => `<li>${escape(plain(traces[0].x[i]))}: N = ${number(n)} pairs from ${number(groups[i]?.reports || 0)} reports.` +
                    (n === 0 ? ' No reference pairs in this snapshot.' : '') +
                    (n && groups[i]?.reports < 20 ? ' Fewer than 20 reports: pairs are highly clustered.' : '') +
                    (id === 'ls-chart' && i === 1 && groups[i]?.reports >= 2 ? ` Two reports contribute ${number(groups[i].top_two_report_pairs)} pairs.` : '') +
                    (groups[i]?.pairs_without_report_identifiers ? ` ${number(groups[i].pairs_without_report_identifiers)} pairs lack report identifiers.` : '') + '</li>').join('') + '</ul>';
            layout.barmode = counts ? 'group' : 'stack';
            layout.xaxis = {...layout.xaxis,tickangle:0};
            const maxCount = Math.max(0,...traces.flatMap(t=>t.y));
            layout.yaxis = {...layout.yaxis,title:{text:counts ? 'Reference pairs' : 'Within-group percentage',standoff:12}, ...(counts ? countAxis(maxCount) : {tickformat:'.0f',dtick:undefined}), range:counts ? undefined : [0,100]};
            summary = 'Denominator: all reference pairs in each group with the metadata required by this analysis. Other and qualified outcomes are retained. Missing authorship or Registered Report metadata are reported in the summary above. Repeated reports and targets mean these observations are not independent. Display minimum: 20 reference pairs per group. Wilson 95% intervals assume independent pairs and are too narrow when pairs share reports. Report counts can overlap across groups.';
            let toggle = document.getElementById(id+'-mode');
            if (!toggle) {
                toggle=document.createElement('button');toggle.id=id+'-mode';toggle.type='button';toggle.className='chart-mode';el.before(toggle);
                toggle.onclick=()=>{modes.set(id,modes.get(id)==='count'?'percent':'count');const args=originals.get(id);plot(el,...args);};
            }
            toggle.textContent=counts?'Show percentages':'Show counts';
            toggle.setAttribute('aria-label', toggle.textContent + ' for ' + visibleTitle(el));
        }
        if (window.innerWidth < 600) {
            layout.margin={...layout.margin,l:60,r:layout.yaxis2 ? 65 : 20,b:100};
            layout.legend={...layout.legend,orientation:'h',y:-0.32,font:{...layout.legend?.font,size:10}};
            layout.height=Math.max(layout.height || 380,420);
            layout.font={...layout.font,size:11};
            if (comparisonIds.has(id)) {
                // Horizontal bars leave room for venue and report-category labels.
                display=display.map(t=>({...t,orientation:'h',x:t.y,y:t.x,
                    hovertemplate:t.hovertemplate.replace(/%\{x\}/g,'%{category}').replace(/%\{y/g,'%{x').replace(/%\{category\}/g,'%{y}')}));
                layout.shapes=(layout.shapes || []).map(s=>({...s,x0:s.y0,x1:s.y1,y0:s.x0,y1:s.x1}));
                layout.annotations=(layout.annotations || []).map(a=>({...a,x:a.y,y:a.x}));
                layout.xaxis={...layout.yaxis,automargin:true};
                layout.yaxis={title:'',automargin:true,autorange:'reversed',type:'category',tickangle:0};
                layout.xaxis.title={...layout.xaxis.title,text:counts ? 'Reference pairs' : 'Within-group<br>percentage'};
                layout.margin={...layout.margin,l:125,b:140};
                layout.legend={...layout.legend,y:-0.25};
                layout.height=Math.max(440,(display[0]?.y.length || 0)*100+200);
            }
        }
        // Reserve separate space for category labels, axis titles and the legend.
        // Paper-relative legend positions otherwise sit on wrapped labels (including N).
        const horizontal = display[0]?.orientation === 'h';
        const labelLines = comparisonIds.has(id) && !horizontal ? Math.max(...display[0].x.map(v=>v.split('<br>').length)) : 1;
        const axisSpace = labelLines * 17 + (layout.xaxis?.title?.text ? 45 : 15);
        const legendItems = display.filter(t=>t.showlegend !== false).length;
        const legendRows = Math.ceil(legendItems / (window.innerWidth < 600 ? 1 : 4));
        const legendSpace = legendItems > 1 ? legendRows * 20 + 15 : 0;
        layout.margin={...layout.margin,b:Math.max(layout.margin?.b || 0,axisSpace + legendSpace)};
        const plotHeight = (layout.height || el.clientHeight || 380) - (layout.margin.t || 0) - layout.margin.b;
        layout.legend={...layout.legend,yanchor:'top',y:-axisSpace/Math.max(100,plotHeight)};
        el.style.height = layout.height ? layout.height+'px' : heights.get(id);
        // Charts keep hover details, while page swipes and drags never zoom or pan.
        layout.dragmode = false;
        for (const key of Object.keys(layout)) if (/^[xy]axis\d*$/.test(key)) layout[key] = {...layout[key],fixedrange:true};
        config = {...config,scrollZoom:false,doubleClick:false};
        // Initial loading messages are not Plotly-owned nodes and otherwise survive react().
        if (!el.data) el.replaceChildren();
        const title = layout.title ? plain(layout.title.text || layout.title) : visibleTitle(el);
        el.setAttribute('role','img');el.setAttribute('aria-label',title+'. Values in the following data table.');
        function renderPlot() {
            if (typeof Plotly === 'undefined') {
                el.textContent = 'Chart library unavailable. Values remain in the chart data table.';
                return Promise.resolve();
            }
            return Plotly.react(el, display, layout, config);
        }
        if (comparisonIds.has(id)) {
            const rows = [];
            traces.forEach(t => (t.x || []).forEach((group, i) => {
                const count = Number(t.y?.[i]) || 0;
                const denominator = traces.reduce((n, series) => n + (Number(series.y?.[i]) || 0), 0);
                const g = options.comparison?.[i];
                const bounds = g?.outcomes?.[options.outcomeKeys?.[traces.indexOf(t)]]?.wilson || [null,null];
                rows.push([plain(group), plain(t.name), count, denominator,
                    denominator ? count > 0 && 100 * count / denominator < 1 ? '<1' : Number((100 * count / denominator).toFixed(1)) : 'Not available',
                    g?.reports ?? 'Not available', g?.pairs_without_report_identifiers ?? 'Not available',
                    ...bounds.map(v => v == null ? 'Not available' : v),
                    'Wilson 95%; assumes independent pairs', denominator >= 20 ? 'Share shown' : `Too few to show (N = ${denominator})`]);
            }));
            const exportRows = rows.map(row => row.map((v,i) => i === 4 ? row[3] ? 100 * row[2] / row[3] : null : [7,8].includes(i) && typeof v !== 'number' ? null : v));
            table(el, rows, ['Group', 'Outcome', 'Reference pairs', 'Group denominator', 'Percentage (%)', 'Distinct repetition reports', 'Pairs without report identifiers', 'Wilson 95% lower (%)', 'Wilson 95% upper (%)', 'Interval method', 'Share display status'], summary, {exportRows,rawNumbers:true});

            return renderPlot();
        }
        if (options.table) {
            table(el, options.table.rows, options.table.headers, options.table.summary);
            return renderPlot();
        }
        const rows=[];
        display.forEach(t => (t.x || []).forEach((x,i)=>{
            const horizontal=t.orientation==='h';
            const category=horizontal ? t.y?.[i] : x;
            const value=horizontal ? x : t.y?.[i]; const err=horizontal ? t.error_x : t.error_y;
            rows.push([t.name || 'Series',category,value, err ? value-(err.arrayminus?.[i] ?? err.array?.[i] ?? 0) : '', err ? value+(err.array?.[i]??0) : '',t.customdata?.[i]?.[0] ?? '']);
        }));
        table(el,rows,['Series','X / category','Value','95% CI lower','95% CI upper','Reference-pair count'],summary);
        return renderPlot();
    }
    function updateContexts() {
        document.querySelectorAll('.chart-data').forEach(d=>{
            const el=document.getElementById(d.id.replace(/-data$/,''));
            if(el)d.querySelector('.chart-context').textContent=context(el);
        });
    }
    return {chart,plot,clear,download,seriesStyle,seriesKey,updateContexts, token, theme, number, percent, countAxis};
})();
