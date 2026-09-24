/* Every chart exposes the same plotted values as a keyboard-accessible table and CSV. */
window.FloraCharts = (() => {
    const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const plain = s => String(s ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const fmt = v => typeof v === 'number' ? (Number.isInteger(v) ? String(v) : Number(v.toFixed(5)).toString()) : plain(v);
    const comparisonIds = new Set(['ao-chart', 'rr-chart', 'pub-chart', 'ls-chart']);
    const modes = new Map();
    const originals = new Map();
    function csvText(headers, rows, notes = '') {
        // Prefix formula-like text so spreadsheet programs treat it as data.
        const cell = v => '"' + (typeof v === 'number' ? String(v) : String(v ?? '').replace(/^[=+@-]/, m => "'" + m)).replace(/"/g, '""') + '"';
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
    function table(el, rows, headers, summary) {
        const id = el.id + '-data';
        let details = document.getElementById(id);
        if (!details) {
            details = document.createElement('details'); details.id = id; details.className = 'chart-data';
            const anchor = el.tagName === 'CANVAS' ? el.parentElement : el;
            anchor.insertAdjacentElement('afterend', details);
        }
        const wasOpen = details.open;
        details.innerHTML = `<summary>View chart data</summary><p class="chart-summary">${escape(summary)}</p><p class="chart-context">${escape(context(el))}</p><div class="table-scroll" tabindex="0" role="region" aria-label="Chart values"><table><caption>${escape(el.getAttribute('aria-label') || 'Chart data')}</caption><thead><tr>${headers.map(h=>`<th scope="col">${escape(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map((v,i)=>i ? `<td>${escape(fmt(v))}</td>` : `<th scope="row">${escape(fmt(v))}</th>`).join('')}</tr>`).join('')}</tbody></table></div>`;
        details.open = wasOpen;
        const label = el.closest('.outcome-chart-row')?.querySelector('.outcome-chart-label') || el.closest('.trend-block')?.querySelector('.trend-desc h5');
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
        action.setAttribute('aria-label', 'Copy chart CSV for ' + (el.getAttribute('aria-label') || el.id));
        action.title = 'Copy chart CSV';
        action.onclick = async () => {
            status.textContent = '';
            try {
                await navigator.clipboard.writeText(csvText(headers, rows, summary + '\n' + context(el)));
                action.title = 'Chart CSV copied';
                action.setAttribute('aria-label', 'Chart CSV copied');
                status.textContent = 'Chart CSV copied';
                setTimeout(() => { action.title = 'Copy chart CSV'; action.setAttribute('aria-label', 'Copy chart CSV for ' + (el.getAttribute('aria-label') || el.id)); }, 2000);
            } catch {
                action.title = 'Could not copy chart CSV';
                status.textContent = 'Could not copy chart CSV';
            }
        };
        el.setAttribute('aria-describedby', id);
    }
    function chart(ctx, config) {
        const el = ctx.canvas || ctx;
        const datasets = config.data.datasets || [], labels = config.data.labels || [];
        const title = el.id.replace(/-/g, ' ');
        el.setAttribute('role','img'); el.setAttribute('aria-label',title + '. Values in the following data table.');
        const rows = labels.map((label,i) => [label,...datasets.map(d=>d.data[i] ?? 0)]);
        const total = datasets.reduce((n,d)=>n+d.data.reduce((sum,v)=>sum+(Number(v)||0),0),0);
        const isOutcome = /outcome|computational|robustness/.test(el.id);
        const eligible = el.id.startsWith("trend-") ? trendsFilteredData().length : el.id.startsWith("browse-") ? getChartData().length : fullRowData.filter(r => classifyKind(r) === (/computational|robustness/.test(el.id) ? "reproduction" : "replication")).length;
        const sample = `Included in the plot: ${total}; excluded from this selection: ${Math.max(0,eligible-total)} reference pairs. ` + (isOutcome ? `${total ? '' : 'No matching assessed outcomes. '}${/computational|robustness/.test(el.id) ? 'Unchecked or uncoded values for this dimension are excluded; the two reproduction subsets overlap.' : 'All replication outcomes are included; qualified success and other/uncoded outcomes are separate.'}` : 'Counts are reference pairs in the displayed categories; journal charts show only the selected top N.');
        table(el,rows,['Category',...datasets.map(d=>d.label)],sample);
        if (config.options.scales) for (const axis of Object.values(config.options.scales)) if (axis.ticks) axis.ticks.autoSkip = !config.options.indexAxis || config.options.indexAxis !== 'y';
        return new Chart(ctx, config);
    }
    function plot(target, traces, layout = {}, config = {}) {
        const el = typeof target === 'string' ? document.getElementById(target) : target;
        if (!el) return Promise.resolve();
        const id = el.id;
        // Size a plot only after its analysis card is visible. Hidden cards otherwise
        // give Plotly a zero-width container and trigger its 700px fallback.
        const card = el.closest('.mc-chart-card');
        if (card) card.style.display = '';
        if (typeof Plotly === 'undefined') {
            if (document.readyState !== 'complete') window.addEventListener('load', () => plot(target,traces,layout,config), {once:true});
            else el.textContent = 'Chart library unavailable. Reload to retry.';
            return Promise.resolve();
        }
        let display = traces.map(t=>({...t}));
        layout = {...layout, autosize:true, xaxis:{...layout.xaxis,automargin:true}, yaxis:{...layout.yaxis,automargin:true}};
        let summary = 'Values below include every plotted series; interval limits are shown where available.';
        if (comparisonIds.has(id)) {
            originals.set(id, [traces,{...layout,xaxis:{...layout.xaxis},yaxis:{...layout.yaxis}},config]);
            const nGroups = traces[0]?.x?.length || 0;
            const totals = Array.from({length:nGroups}, (_,i)=>traces.reduce((sum,t)=>sum+(Number(t.y?.[i])||0),0));
            const counts = modes.get(id) === 'count';
            display = display.map(t=>({...t, x:t.x.map((v,i)=>plain(v).replace(/(.{1,18})(?:\s|$)/g, '$1<br>')+`<br>N=${totals[i]}`),
                y:t.y.map((v,i)=>counts ? v : totals[i] ? 100*v/totals[i] : 0),
                customdata:t.y.map((v,i)=>[v,totals[i]]),
                hovertemplate:counts ? '%{x}<br>%{y} reference pairs<extra>%{fullData.name}</extra>' : '%{x}<br>%{y:.1f}% (%{customdata[0]} pairs)<extra>%{fullData.name}</extra>'}));
            layout.barmode = counts ? 'group' : 'stack';
            layout.yaxis = {...layout.yaxis,title:counts ? 'Reference pairs' : 'Within-group percentage', range:counts ? undefined : [0,100]};
            summary = 'Denominator: all reference pairs in each group with the metadata required by this analysis. Other and qualified outcomes are retained. Missing author/RR metadata are reported in the summary above. Repeated reports and targets mean these observations are not independent.';
            let toggle = document.getElementById(id+'-mode');
            if (!toggle) {
                toggle=document.createElement('button');toggle.id=id+'-mode';toggle.type='button';toggle.className='chart-mode';el.before(toggle);
                toggle.onclick=()=>{modes.set(id,modes.get(id)==='count'?'percent':'count');const args=originals.get(id);plot(el,...args);};
            }
            toggle.textContent=counts?'Show percentages':'Show counts';
        }
        if (window.innerWidth < 600) {
            layout.margin={...layout.margin,l:55,r:20,b:100};
            layout.legend={...layout.legend,orientation:'h',y:-0.32,font:{...layout.legend?.font,size:10}};
            layout.height=Math.max(layout.height || 380,420);
            layout.font={...layout.font,size:11};
            if (comparisonIds.has(id)) {
                // Horizontal bars leave room for venue and report-category labels.
                display=display.map(t=>({...t,orientation:'h',x:t.y,y:t.x,
                    hovertemplate:t.hovertemplate.replace(/%\{x\}/g,'%{category}').replace(/%\{y/g,'%{x').replace(/%\{category\}/g,'%{y}')}));
                layout.xaxis={...layout.yaxis,automargin:true};
                layout.yaxis={title:'',automargin:true,autorange:'reversed',type:'category',tickangle:0};
                layout.margin={...layout.margin,l:110,b:140};
                layout.legend={...layout.legend,y:-0.25};
                layout.height=Math.max(440,(display[0]?.y.length || 0)*65+200);
            }
        }
        const title = plain(layout.title?.text || layout.title || id.replace(/-/g,' '));
        el.setAttribute('role','img');el.setAttribute('aria-label',title+'. Values in the following data table.');
        const rows=[];
        display.forEach(t => (t.x || []).forEach((x,i)=>{
            const horizontal=t.orientation==='h';
            const category=horizontal ? t.y?.[i] : x;
            const value=horizontal ? x : t.y?.[i]; const err=horizontal ? t.error_x : t.error_y;
            rows.push([t.name || 'Series',category,value, err ? value-(err.arrayminus?.[i] ?? err.array?.[i] ?? 0) : '', err ? value+(err.array?.[i]??0) : '',t.customdata?.[i]?.[0] ?? '']);
        }));
        table(el,rows,['Series','X / category','Value','95% CI lower','95% CI upper','Reference-pair count'],summary);
        return Plotly.react(el, display, layout, config);
    }
    function updateContexts() {
        document.querySelectorAll('.chart-data').forEach(d=>{
            const el=document.getElementById(d.id.replace(/-data$/,''));
            if(el)d.querySelector('.chart-context').textContent=context(el);
        });
    }
    return {chart,plot,download,updateContexts};
})();
