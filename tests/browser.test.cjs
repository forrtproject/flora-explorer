const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const {spawn} = require('node:child_process');
const fs = require('node:fs');
let browser, server;
const port = process.env.TEST_PORT || '8897';
const base = `http://127.0.0.1:${port}/`;
before(async()=>{
  server=spawn(process.env.PYTHON || 'python3',['-m','http.server',port,'--bind','127.0.0.1'],{stdio:'ignore'});
  // A server that exits early usually means the port is taken; fail rather than test another server's files.
  let exited=false;server.on('exit',()=>{exited=true;});
  // Consume the readiness response so its open stream does not outlive the hook.
  for(let i=0;i<50;i++){try{await (await fetch(base)).arrayBuffer();break;}catch{await new Promise(r=>setTimeout(r,100));}}
  await new Promise(r=>setTimeout(r,200));
  if(exited) throw new Error(`Test server could not start on port ${port}; set TEST_PORT to a free port.`);
  browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL || 'chrome',headless:true});
});
after(async()=>{await browser?.close();server?.kill();});
async function page(query, width=1280, setup){
  const p=await browser.newPage({viewport:{width,height:900}});p.errors=[];
  p.on('pageerror',e=>p.errors.push(e.message));
  if(setup) await setup(p);
  await p.goto(base+query);await p.waitForFunction(()=>document.querySelector('#floraTabsContent').style.display==='block');
  await p.waitForFunction(()=>typeof Chart!=='undefined'&&typeof Plotly!=='undefined');
  return p;
}
async function browseRows(p){return p.evaluate(()=>getChartData().map(r=>[r.title_o,r.title_r,r.outcome]));}
async function citationSearch(p,q){
  await p.evaluate(()=>{
    window.citationRenderFinished=false;
    const observer=new MutationObserver(()=>{observer.disconnect();window.citationRenderFinished=true;});
    observer.observe(document.querySelector('#originals-table tbody'),{childList:true});
    // The message is updated even when both the previous and next result sets are empty.
    observer.observe(document.getElementById('ci-search-empty-message'),{childList:true});
  });
  await p.fill('#search-input',q);
  await p.waitForFunction(()=>window.citationRenderFinished);
  return p.locator('#originals-table tbody tr[data-doi]').evaluateAll(rows=>rows.map(r=>r.dataset.doi));
}
test('desktop/mobile search, DOI URLs, empty results, shared view and evidence agree',async()=>{
  const p=await page('?tab=browse&kind=replication&q=power+posing',1280,p=>p.route('**/data/flora.csv',route=>route.fulfill({path:'tests/fixtures/browse.csv',contentType:'text/csv'})));
  await p.waitForFunction(()=>getChartData().length===4);
  const expected=await browseRows(p);assert.deepEqual(expected.map(r=>r[2]).sort(),['failed','failed','failed','mixed']);
  const values=await p.evaluate(()=>Chart.getChart('browse-outcome-chart').data.datasets.map(d=>[d.label,d.data[0]]));
  assert.equal(values.find(v=>v[0]==='Failed')[1],3);assert.equal(values.find(v=>v[0]==='Mixed')[1],1);
  assert.equal(await p.locator('#flora-table tbody tr').count(),4);
  await p.locator('.study-details').first().focus();await p.keyboard.press('Enter');
  assert.equal(await p.locator('.study-details').first().getAttribute('aria-expanded'),'true');
  assert.ok(await p.locator('.detail-row').first().isVisible());
  await p.setViewportSize({width:390,height:844});assert.equal(await p.locator('.bm-card').count(),4);
  assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await p.locator('.bm-evidence summary').first().click();assert.ok(await p.locator('.bm-evidence[open] .detail-row').isVisible());
  assert.deepEqual(await browseRows(p),expected);
  await p.reload();await p.waitForFunction(()=>getChartData().length===4);assert.deepEqual(await browseRows(p),expected);
  for(const q of ['10.1177/0956797610383437','https://doi.org/10.1177/0956797610383437','Carney 2010']){
    await p.fill('#browse-mobile-input',q);await p.waitForFunction(()=>getChartData().length===3);
    assert.equal(await p.locator('.bm-card').count(),3);
  }
  const downloadEvent=p.waitForEvent('download');await p.click('#export-browse');const download=await downloadEvent;
  assert.equal(download.suggestedFilename(),'flora-filtered-reference-pairs.csv');
  const exported=fs.readFileSync(await download.path(),'utf8');
  const exportedRows=await p.evaluate(text=>Papa.parse(text,{header:true}).data,exported);
  assert.equal(exportedRows.length,3);assert.match(exportedRows[0]['Export context'],/Unit: reference pair/);
  await p.fill('#browse-mobile-input','no-matching-flora-reference-zzzz');await p.waitForFunction(()=>getChartData().length===0);
  assert.equal(await p.locator('.bm-card').count(),0);
  assert.equal(await p.evaluate(()=>Chart.getChart('browse-outcome-chart').data.datasets.reduce((n,d)=>n+d.data[0],0)),0);
  assert.match(await p.locator('#browse-outcome-chart-data').textContent(),/No matching assessed outcomes/);
  await p.fill('#browse-mobile-input','');await p.click('.browse-kind-btn[data-kind="all"]');
  await p.waitForFunction(()=>getChartData().length===fullRowData.length);
  assert.equal(await p.locator('#export-browse').innerText(),'Download full CSV');
  const fullDownloadEvent=p.waitForEvent('download');await p.click('#export-browse');
  assert.equal((await fullDownloadEvent).suggestedFilename(),'flora-reference-pairs.csv');
  assert.deepEqual(p.errors,[]);await p.close();
});
test('chart data and the current browse link copy to the clipboard',async()=>{
  const p=await page('?tab=overview');
  await p.context().grantPermissions(['clipboard-read','clipboard-write'],{origin:base});
  assert.equal(await p.locator('.wip-ribbon,.badge-wip').count(),0);
  assert.equal(await p.locator('.chart-export').count(),0);
  assert.equal(await p.locator('#overview-computational-chart-data-copy').isVisible(),true);
  await p.click('#overview-computational-chart-data-copy');
  const csv=await p.evaluate(()=>navigator.clipboard.readText());
  assert.match(csv,/Category,|"Category"/);
  assert.match(csv,/Included in the plot:/);
  assert.doesNotMatch(csv,/Included: \d+ reference pairs/);
  await p.evaluate(()=>{window.originalClipboardWrite=navigator.clipboard.writeText.bind(navigator.clipboard);navigator.clipboard.writeText=()=>Promise.reject(new Error('Clipboard unavailable'));});
  await p.click('#overview-computational-chart-data-copy');
  assert.equal(await p.locator('#overview-computational-chart-data-copy-status').textContent(),'Could not copy chart CSV');
  await p.evaluate(()=>{navigator.clipboard.writeText=window.originalClipboardWrite;delete window.originalClipboardWrite;});
  await p.click('#browse-tab');
  await p.fill('#browse-mobile-input','power posing');
  await p.waitForFunction(()=>location.search.includes('q=power'));
  await p.click('#share-view');
  assert.match(await p.evaluate(()=>navigator.clipboard.readText()),/tab=browse.*q=power/);
  assert.deepEqual(p.errors,[]);await p.close();
});
test('Mean Citedness clears stale models and all distribution outcomes reconcile',async()=>{
  const p=await page('?tab=mean-citedness');await p.waitForFunction(()=>document.querySelector('#mc-gam-stats').textContent.includes('N'));
  await p.context().grantPermissions(['clipboard-read','clipboard-write'],{origin:base});
  for(const kind of ['reproduction-numerical','reproduction-robustness']){
    await p.click(`#mc-study-type [data-value="${kind}"]`);
    assert.equal((await p.locator('#mc-gam-stats').textContent()).trim(),'');
    // No model: the card, its table, copy action, status and ARIA reference all leave together.
    assert.ok(await p.locator('#mc-gam-card').isHidden());
    for(const id of ['mc-gam-chart-data','mc-gam-chart-data-copy','mc-gam-chart-data-copy-status']) assert.equal(await p.locator('#'+id).count(),0,id);
    assert.equal(await p.locator('#mc-gam-chart').getAttribute('aria-describedby'),null);
    assert.match(await p.locator('#mc-repro-note').innerText(),/No reproduction model has been fitted/);
    assert.equal(await p.locator('#mean-citedness .chart-copy:visible').count(),1);
  }
  await p.click('#mc-study-type [data-value="replication"]');
  assert.ok(await p.locator('#mc-repro-note').isHidden());
  // The restored model exports only its own quantities, labelled with the active selection.
  await p.click('#mc-gam-chart-data-copy');
  const exported=await p.evaluate(async()=>Papa.parse(await navigator.clipboard.readText(),{header:true,skipEmptyLines:true}).data);
  assert.ok(exported.every(r=>/Selection: Replications\./.test(r['Export context'])));
  const curve=exported.filter(r=>r['Row type']==='Fitted curve'), points=exported.filter(r=>r['Row type']==='Displayed pair');
  const model=JSON.parse(fs.readFileSync('data/impact_factor_data.json'));
  assert.equal(curve.length,model.gam_curve.length);assert.equal(points.length,model.jitter.length);
  assert.ok(curve.every(r=>r['95% CI lower']!==''&&r['95% CI upper']!==''&&+r['95% CI lower']<=+r['Estimated P(success)']&&+r['Estimated P(success)']<=+r['95% CI upper']));
  assert.ok(points.every(r=>['0','1'].includes(r['Observed outcome (1 = successful, 0 = failed)'])));
  assert.equal(exported.filter(r=>/^_(lo|hi)$/.test(r['Row type'])).length,0);
  assert.match(await p.locator('#mc-gam-chart-data caption').textContent(),/Success probability among successful \/ failed replications/);
  const result=await p.evaluate(()=>({total:window._mcData.replication.overview.n_total, plotted:document.getElementById('mc-dist-chart').data.reduce((n,t)=>n+t.y.reduce((a,b)=>a+b,0),0)}));
  assert.equal(result.total,result.plotted);
  assert.match(await p.locator('#mc-gam-chart').textContent(),/50% reference/);
  assert.deepEqual(p.errors,[]);await p.close();
});
test('citation deep links, exclusive counts, model intervals and modal keyboard focus',async()=>{
  const p=await page('?tab=citations&doi=10.1177%2F0956797610383437');
  await p.waitForFunction(()=>document.getElementById('study-plot')?.data?.length>0);
  assert.equal(await p.locator('#ci-modal').getAttribute('role'),'dialog');
  assert.equal(await p.evaluate(()=>document.activeElement.id),'ci-modal-close');
  const total=await p.evaluate(()=>document.getElementById('study-plot').data.reduce((n,t)=>n+t.y.reduce((a,b)=>a+b,0),0));assert.equal(total,JSON.parse(fs.readFileSync('data/originals.json')).studies['10.1177/0956797610383437'].n_citations);
  assert.ok(await p.evaluate(()=>document.getElementById('plot-cit-model').data[0].error_y.array.some(n=>n>0)));
  await p.keyboard.press('Shift+Tab');assert.ok(await p.evaluate(()=>document.getElementById('ci-modal').contains(document.activeElement)));
  await p.keyboard.press('Tab');assert.equal(await p.evaluate(()=>document.activeElement.id),'ci-modal-close');
  await p.keyboard.press('Escape');assert.ok(await p.locator('#ci-modal').isHidden());
  await p.locator('.timeline-open').first().focus();await p.keyboard.press('Enter');await p.waitForFunction(()=>!document.getElementById('ci-modal').hidden);
  await p.keyboard.press('Escape');assert.ok(await p.evaluate(()=>document.activeElement.classList.contains('timeline-open')));
  assert.deepEqual(p.errors,[]);await p.close();
});
test('shared citation outcome filters restore before asynchronous loading finishes',async()=>{
  const p=await page('?tab=citations&ci-outcome=failed');
  await p.waitForFunction(()=>document.getElementById('plot-cit-model')?.data?.length>0);
  const expected=JSON.parse(fs.readFileSync('data/aggregate.json')).failed.citations_model.att.toFixed(3);
  assert.ok((await p.locator('#att-callout').innerText()).includes(expected));
  assert.equal(await p.locator('#outcome-chips [data-value="failed"]').getAttribute('aria-pressed'),'true');
  assert.deepEqual(p.errors,[]);await p.close();
});
test('all seven tabs, percentages, venue evidence, responsive redraws and chart alternatives',async()=>{
  const p=await page('?tab=overview');assert.equal(await p.locator('.tab-pane').count(),7);
  for(const tab of ['browse-tab','trends-tab','mc-tab','overlap-tab','pub-tab','citation-tab']){
    await p.click('#'+tab);await p.waitForTimeout(650);
  }
  await p.click('#pub-tab');await p.waitForFunction(()=>document.getElementById('pub-chart')?.data?.length>0);
  assert.ok(await p.evaluate(()=>['overview-outcome-chart','trend-orig-year','trend-field'].every(id=>{
    const c=Chart.getChart(id);return JSON.stringify(c.legend.legendItems.map(d=>d.text))===JSON.stringify(c.getSortedVisibleDatasetMetas().map(d=>c.data.datasets[d.index].label));
  })));
  const sums=await p.evaluate(()=>{const t=document.getElementById('pub-chart').data;return t[0].x.map((_,i)=>t.reduce((n,s)=>n+s.y[i],0));});
  assert.ok(sums.every(s=>Math.abs(s-100)<1e-8));
  const unknown=await p.evaluate(csv=>Papa.parse(csv,{header:true,skipEmptyLines:true}).data.filter(r=>r.type.toLowerCase().includes('replication')&&!r.type.toLowerCase().includes('reproduc')&&['','na','nan','none','null'].includes((r.journal_r||'').trim().toLowerCase())).length,fs.readFileSync('data/flora.csv','utf8'));
  assert.equal(Number(await p.locator('#pub-overview .mc-stat').filter({hasText:'Unknown venue'}).locator('.mc-stat-value').textContent()),unknown);
  await p.locator('#pub-studies-card summary').click();
  const thesis=p.locator('#pub-studies-table tbody tr').filter({hasText:'Digital Library of Theses'});
  assert.ok(await thesis.count());assert.match(await thesis.first().innerText(),/Thesis \/ dissertation/);
  assert.ok(await p.locator('#ls-loading').isHidden());
  for(const width of [390,320]){
    await p.setViewportSize({width,height:844});
    await p.selectOption('#mobile-navigation','trends-tab');
    await p.selectOption('#journal-top-n','50');await p.waitForTimeout(350);
    await p.selectOption('#mobile-navigation','pub-tab');
    await p.click('#pubtype-study-type [data-value="reproduction-numerical"]');await p.waitForTimeout(350);
    assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const overflowingPlots=await p.evaluate(()=>[...document.querySelectorAll('.js-plotly-plot')].filter(el=>el.getClientRects().length).filter(el=>el.querySelector('.svg-container')?.getBoundingClientRect().width > el.clientWidth+2).map(el=>el.id));
    assert.deepEqual(overflowingPlots,[]);
    assert.ok(await p.evaluate(()=>document.getElementById('pub-chart').data.every(t=>t.orientation==='h')));
    await p.click('#pub-chart-mode');
    assert.ok(await p.evaluate(()=>{const el=document.getElementById('pub-chart');return el._fullLayout.xaxis.type==='linear'&&el.data.every(t=>t.x.every((v,i)=>v===t.customdata[i][0]));}));
    await p.click('#pub-chart-mode');
    assert.ok(await p.evaluate(()=>{const t=document.getElementById('pub-chart').data;return t[0].y.every((_,i)=>Math.abs(t.reduce((n,s)=>n+s.x[i],0)-(t[0].customdata[i][1] ? 100 : 0))<1e-8);}));
    await p.click('#theme-toggle');await p.waitForTimeout(350);
    const missing=await p.evaluate(()=>[...document.querySelectorAll('canvas')].filter(c=>Chart.getChart(c)).filter(c=>!c.getAttribute('aria-label')||!document.getElementById(c.id+'-data')).map(c=>c.id));
    assert.deepEqual(missing,[]);
  }
  assert.deepEqual(p.errors,[]);await p.close();
});
test('every generated timeline, outcome summary and venue grouping preserves counts',()=>{
  const read=f=>JSON.parse(fs.readFileSync('data/'+f));
  for(const s of Object.values(read('originals.json').studies)){
    let total=0,co=0;
    for(const t of s.timeline){const c=t.with_successful+t.with_failed+t.with_mixed+t.with_multiple;assert.equal(c,t.with_any);total+=t.only+c;co+=c;}
    assert.equal(total,s.n_citations,s.doi);assert.equal(co,s.n_cocitations,s.doi);
  }
  for(const f of ['author_overlap_data.json','pub_status_data.json','rr_status_data.json']){
    for(const d of Object.values(read(f))){
      const n=Object.values(d.by_outcome).reduce((sum,g)=>sum+Object.values(g).reduce((a,b)=>a+b,0),0);
      assert.equal(n,d.overview.n_total,f);
    }
  }
  for(const d of Object.values(read('impact_factor_reproductions.json'))) assert.equal(d.histogram.reduce((sum,b)=>sum+Object.entries(b).filter(([k])=>!k.startsWith('bin_')).reduce((n,[k,v])=>n+v,0),0),d.overview.n_total);
  const d=read('impact_factor_data.json');assert.equal(d.histogram.reduce((sum,b)=>sum+Object.entries(b).filter(([k])=>!k.startsWith('bin_')).reduce((n,[k,v])=>n+v,0),0),d.overview.n_total);
});

test('late Chart.js loading preserves chart ownership through repeated redraws',async()=>{
  const p=await browser.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  await p.route('**/chart.umd.min.js',async route=>{await gate;await route.continue();});
  try {
    await p.goto(base+'?tab=browse',{waitUntil:'commit'});
    await p.waitForFunction(()=>typeof fullRowData!=='undefined'&&fullRowData.length>0);
    await p.evaluate(()=>{renderOverviewChart(fullRowData);renderOverviewChart(fullRowData);renderBrowseOutcomeCharts();renderBrowseOutcomeCharts();});
    release();await p.waitForLoadState('load');
    await p.waitForFunction(()=>typeof Chart!=='undefined'&&Chart.getChart('overview-outcome-chart'));
    assert.ok(await p.evaluate(()=>overviewChart===Chart.getChart('overview-outcome-chart')&&browseOutcomeChart===Chart.getChart('browse-outcome-chart')));
    await p.click('#theme-toggle');await p.click('.browse-kind-btn[data-kind="replication"]');
    assert.ok(await p.evaluate(()=>overviewChart===Chart.getChart('overview-outcome-chart')&&browseOutcomeChart===Chart.getChart('browse-outcome-chart')));
    assert.deepEqual(errors,[]);
  } finally {release();await p.close();}
});

test('FAQ URLs stay inside href attributes and default filter states agree',async()=>{
  const p=await page('?tab=overview');
  const links=await p.evaluate(()=>{
    const node=document.createElement('div');
    node.innerHTML=renderInlineMd('[quoted](https://example.org/"onmouseover="alert) [mail](mailto:a@example.org) [unsafe](javascript:alert)');
    return [...node.querySelectorAll('a')].map(a=>({href:a.getAttribute('href'),attributes:[...a.attributes].map(x=>x.name)}));
  });
  assert.equal(links.length,2);assert.equal(links[0].href,'https://example.org/"onmouseover="alert');
  assert.ok(links.every(a=>!a.attributes.some(n=>n.startsWith('on'))));
  assert.equal(links[1].href,'mailto:a@example.org');
  assert.deepEqual(await p.locator('#trends .trend-filter-btn').evaluateAll(nodes=>nodes.map(n=>n.classList.contains('active')=== (n.getAttribute('aria-pressed')==='true'))),[true,true,true,true]);
  assert.deepEqual(p.errors,[]);await p.close();
});


test('tab changes reset the content scroll; definitions are described and dismissible', async()=>{
  const p=await page('?tab=overview');
  const tip=p.locator('.info-icon').first();
  assert.ok(await tip.getAttribute('aria-describedby'));
  await tip.focus();
  assert.equal(await tip.locator('.info-tip').getAttribute('role'),'tooltip');
  await p.keyboard.press('Escape');
  assert.equal(await tip.locator('.info-tip').evaluate(el=>getComputedStyle(el).pointerEvents),'none');
  await p.evaluate(()=>document.querySelector('.app-main').scrollTop=1000);
  await p.click('#browse-tab');
  await p.waitForFunction(()=>document.querySelector('.app-main').scrollTop===0);
  assert.deepEqual(p.errors,[]);await p.close();
});
test('citation content reflows at 320px after loading on desktop', async()=>{
  const p=await page('?tab=citations');
  await p.waitForFunction(()=>document.querySelector('#citation-impact .js-plotly-plot'));
  await p.setViewportSize({width:320,height:844});
  await p.waitForTimeout(500);
  assert.ok(await p.locator('#mobile-navigation').evaluate(el=>el.clientWidth>=140));
  const widths=await p.locator('.app-main').evaluate(el=>[el.scrollWidth,el.clientWidth]);
  await p.close();
  assert.ok(widths[0]<=widths[1]+1,`main overflow: ${widths}`);
  assert.deepEqual(p.errors,[]);
});
test('comparison tables identify counts, denominators and percentage units', async()=>{
  const p=await page('?tab=authorship-overlap');
  await p.waitForSelector('#ao-chart-data');
  assert.deepEqual(await p.locator('#ao-chart-data thead th').allTextContents(),['Group','Outcome','Reference pairs','Group denominator','Percentage (%)']);
  assert.deepEqual(p.errors,[]);await p.close();
});

test('Browse explains empty selections, offers recovery and keeps results near the filters',async()=>{
  const p=await page('?tab=browse&kind=reproduction-numerical&q=power+posing',1633,p=>p.route('**/data/flora.csv',route=>route.fulfill({path:'tests/fixtures/browse.csv',contentType:'text/csv'})));
  await p.waitForFunction(()=>getChartData().length===0);
  assert.match(await p.locator('#browse-empty').innerText(),/No numerical reproductions match “power posing”[\s\S]*does not show that a study has never been replicated/);
  assert.ok(await p.locator('#browse-outcome-card').isHidden());
  await p.click('[data-browse-action="all-kinds"]');
  await p.waitForFunction(()=>getChartData().length===4);
  assert.ok(await p.locator('#browse-empty').isHidden());
  // All studies has no outcome chart, so no empty card sits between filters and results.
  assert.ok(await p.locator('#browse-outcome-card').isHidden());
  await p.setViewportSize({width:1633,height:830});
  const firstRow=await p.locator('#flora-table tbody tr').first().evaluate(e=>e.getBoundingClientRect().bottom);
  assert.ok(firstRow<830,`first result ends at ${firstRow}px`);
  await p.click('.browse-kind-btn[data-kind="replication"]');
  assert.ok(await p.locator('#browse-outcome-card').isVisible());
  assert.match(await p.locator('#browse-outcome-caption').innerText(),/^4 replication pairs: .*Failed 3 \(75%\).*Mixed 1 \(25%\)/);
  await p.fill('#browse-mobile-input','unicornzzzz');await p.waitForFunction(()=>getChartData().length===0);
  assert.match(await p.locator('#browse-empty').innerText(),/No replications match “unicornzzzz”/);
  await p.click('[data-browse-action="clear-search"]');
  await p.waitForFunction(()=>getChartData().length>0);
  assert.equal(await p.inputValue('#browse-mobile-input'),'');
  assert.ok(!new URL(p.url()).searchParams.has('q'));
  // Mobile cards sort through the same DataTables order as the desktop headers.
  await p.setViewportSize({width:390,height:844});
  await p.click('.browse-kind-btn[data-kind="all"]');
  await p.selectOption('#bm-sort','2:asc');
  await p.waitForFunction(()=>new URL(location.href).searchParams.get('sort')==='2:asc');
  const years=await p.locator('.bm-card .bm-row:first-child .bm-row-meta').allInnerTexts();
  const parsed=years.map(t=>+(t.match(/\((\d{4})\)/)||[])[1]).filter(Boolean);
  assert.deepEqual(parsed,[...parsed].sort((a,b)=>a-b));
  assert.deepEqual(p.errors,[]);await p.close();
});
test('Overview charts state denominators; placeholders, labels and headings stay legible',async()=>{
  const p=await page('?tab=overview',1280,p=>p.route('**/flora_faq.md',route=>route.fulfill({contentType:'text/markdown',body:'# FAQ title\n\n## Coding\n\n### What if a paper includes reproduction *and* replication?\n\nIt is listed twice.\n'})));
  const expected=await p.evaluate(()=>{const repro=fullRowData.filter(r=>classifyKind(r)==='reproduction').length;const comp=fullRowData.filter(isComputationalAssessed).length;return {repro,comp};});
  assert.match(await p.locator('#overview-computational-caption').innerText(),new RegExp(`^${expected.comp.toLocaleString('en-US')} of ${expected.repro.toLocaleString('en-US')} reproduction pairs have a computational verdict; ${(expected.repro-expected.comp).toLocaleString('en-US')} not checked`));
  assert.ok(await p.locator('.coverage-caution').isVisible());
  assert.ok(await p.locator('.coverage-caution').evaluate(el=>el.getBoundingClientRect().top<document.getElementById('overview-computational-chart').getBoundingClientRect().top));
  await p.waitForSelector('.faq-question');
  assert.equal(await p.locator('.faq-question em').textContent(),'and');
  assert.doesNotMatch(await p.locator('.faq-question').first().innerText(),/\*/);
  assert.deepEqual(await p.locator('#overview .chart-data caption').allTextContents(),['Computational Reproducibility','Robustness','Replicability']);
  // Placeholder instructions meet 4.5:1 in both themes.
  const contrast=async()=>p.evaluate(()=>{
    const rgb=c=>c.match(/[\d.]+/g).map(Number);
    const lum=([r,g,b])=>[r,g,b].map(v=>{v/=255;return v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4;}).reduce((n,v,i)=>n+v*[0.2126,0.7152,0.0722][i],0);
    return ['browse-mobile-input','search-input'].map(id=>{const el=document.getElementById(id);const [r,g,b,a=1]=rgb(getComputedStyle(el,'::placeholder').color);const bg=rgb(getComputedStyle(el).backgroundColor);const fg=[r,g,b].map((v,i)=>v*a+bg[i]*(1-a));const [l1,l2]=[lum(fg),lum(bg)].sort((x,y)=>y-x);return (l1+0.05)/(l2+0.05);});
  });
  for(const theme of ['light','dark']){
    await p.evaluate(t=>document.documentElement.setAttribute('data-theme',t),theme);
    for(const ratio of await contrast()) assert.ok(ratio>=4.5,`${theme} placeholder contrast ${ratio.toFixed(2)}`);
  }
  assert.equal(await p.getByLabel('Search originals').getAttribute('id'),'search-input');
  // Actions stay outside headings, and Trends chart headings sit under a panel heading.
  await p.click('#trends-tab');await p.waitForFunction(()=>Chart.getChart('trend-orig-year'));
  assert.equal(await p.locator(':is(h1,h2,h3,h4,h5,h6) .chart-copy').count(),0);
  assert.deepEqual(await p.locator('#trends :is(h2,h3)').evaluateAll(hs=>hs.map(h=>h.tagName)),['H2','H3','H3','H3','H3','H3']);
  assert.deepEqual(p.errors,[]);await p.close();
});
test('Trends follow the selected study type, keep calendar spacing and reflow after narrowing',async()=>{
  const p=await page('?tab=trends',1440);await p.waitForFunction(()=>Chart.getChart('trend-orig-year'));
  const labels=await p.evaluate(()=>Chart.getChart('trend-orig-year').data.labels);
  // Sparse early years pool into one leading column; from 1960 every calendar year has a slot.
  assert.equal(labels[0],'Before 1960');assert.equal(labels[1],'1960');
  const years=labels.slice(1).map(Number);
  assert.ok(years.every((y,i)=>i===0||y===years[i-1]+1),'original-year axis skips calendar years');
  const pooled=await p.evaluate(()=>{const c=Chart.getChart('trend-orig-year');return c.data.datasets.reduce((n,d)=>n+d.data[0],0);});
  assert.equal(pooled,await p.evaluate(()=>trendsFilteredData().filter(r=>{const m=String(r.year_o||'').match(/\d{4}/);return m&&+m[0]>=1800&&+m[0]<1960;}).length));
  const plotted=await p.evaluate(()=>Chart.getChart('trend-orig-year').data.datasets.reduce((n,d)=>n+d.data.reduce((a,b)=>a+b,0),0));
  const withYear=await p.evaluate(()=>trendsFilteredData().filter(r=>{const m=String(r.year_o||'').match(/\d{4}/);return m&&+m[0]>=1800&&+m[0]<=2100;}).length);
  assert.equal(plotted,withYear);
  await p.click('#trends .trend-filter-btn[data-kind="reproduction-numerical"]');
  assert.deepEqual(await p.locator('#trends h3').allInnerTexts(),['Outcomes by original study year','Outcomes by reproduction report year','Outcomes by original journal','Outcomes by recorded reproduction venue','Outcomes by field']);
  assert.doesNotMatch(await p.locator('#trends-charts').innerText(),/\breplications?\b/i);
  await p.click('#trends .trend-filter-btn[data-kind="replication"]');
  for(const width of [390,1440,390]){
    await p.setViewportSize({width,height:844});await p.waitForTimeout(700);
    const overflow=await p.evaluate(()=>[...document.querySelectorAll('#trends .card')].flatMap(card=>{const right=card.getBoundingClientRect().right+1;return [...card.querySelectorAll('.trend-desc, canvas')].filter(el=>el.getBoundingClientRect().right>right).map(el=>el.id||el.className);}));
    assert.deepEqual(overflow,[],`clipped at ${width}px`);
  }
  await p.click('#mobile-navigation');await p.selectOption('#mobile-navigation','citation-tab');
  await p.click('#ci-study-type [data-value="reproduction-robustness"]');
  assert.equal(await p.locator('.ci-h2').innerText(),'Citation counts for robustness reproductions');
  assert.deepEqual(p.errors,[]);await p.close();
});
test('narrow citation timelines number replication events to match the list',async()=>{
  const p=await page('?tab=citations&doi=10.1126%2Fscience.7455683',390);
  await p.waitForFunction(()=>document.getElementById('study-plot')?.layout?.annotations?.length>0);
  const marks=await p.evaluate(()=>document.getElementById('study-plot').layout.annotations.filter(a=>/^\d+$/.test(a.text)).map(a=>a.text));
  const list=await p.locator('.rep-list .rep-marker').allInnerTexts();
  // Every replication of this study is dated, so each list entry has exactly one marker, in order.
  assert.ok(marks.length>=2);
  assert.deepEqual(marks,list);
  const years=await p.locator('.rep-list strong').allInnerTexts();
  assert.deepEqual(years.map(s=>+(s.match(/\((\d{4})\)/)||[])[1]),[2014,2018,2021,2022]);
  for(const width of [390,320]){
    await p.setViewportSize({width,height:844});await p.waitForTimeout(500);
    const details=await p.evaluate(()=>{
      const el=document.getElementById('study-plot');
      const boxes=[...el.querySelectorAll('.annotation')].filter(e=>/^\d+$/.test(e.textContent)).map(e=>e.getBoundingClientRect());
      return {overlap:boxes.some((a,i)=>boxes.slice(i+1).some(b=>a.left<b.right+2&&b.left<a.right+2&&a.top<b.bottom+2&&b.top<a.bottom+2)),
        empty:el.data.filter(t=>!t.y.some(v=>v>0)).map(t=>t.name),legend:el._fullLayout.legend.traceorder,
        partial:el.layout.annotations.some(a=>/2026.*partial year/i.test(a.text))&&el.data.every(t=>t.marker.opacity.every((v,i)=>v===(t.x[i]===2026 ? 0.45 : 1))),hover:el._fullLayout.hoverlabel.namelength};
    });
    assert.equal(details.overlap,false,`timeline markers touch at ${width}px`);
    assert.deepEqual(details.empty,[]);assert.equal(details.legend,'normal');assert.ok(details.partial);assert.equal(details.hover,-1);
  }
  await p.context().grantPermissions(['clipboard-read','clipboard-write'],{origin:base});
  await p.getByRole('button',{name:'Copy link to this chart',exact:true}).click();
  assert.ok(await p.getByRole('button',{name:'Link copied',exact:true}).isVisible());
  assert.deepEqual(p.errors,[]);await p.close();
});

test('Mean Citedness omits empty KPI tiles and balances its rows',async()=>{
  const p=await page('?tab=mean-citedness');await p.waitForSelector('#mc-overview .mc-stat');
  for(const kind of ['replication','reproduction-numerical','reproduction-robustness']){
    await p.click(`#mc-study-type [data-value="${kind}"]`);
    assert.ok((await p.locator('#mc-overview .mc-stat-value').allTextContents()).every(s=>Number(s.replaceAll(',',''))>0));
    for(const width of [1280,1024,768,390]){
      await p.setViewportSize({width,height:900});
      const rows=await p.locator('#mc-overview .mc-stat').evaluateAll(els=>Object.values(els.reduce((rows,el)=>{const y=el.getBoundingClientRect().top;rows[y]=(rows[y]||0)+1;return rows;},{})));
      assert.ok(rows.length===1||rows.at(-1)>1,`${kind} orphan at ${width}px: ${rows}`);
    }
  }
  assert.deepEqual(p.errors,[]);await p.close();
});
test('comparison N labels and Plotly axis titles stay clear of legends and ticks',async()=>{
  const p=await page('?tab=publication-type',1366);await p.waitForFunction(()=>document.getElementById('pub-chart')?.data?.length);
  for(const width of [1366,1280,390,320,1280]){
    await p.setViewportSize({width,height:900});await p.waitForTimeout(700);
    const issues=await p.evaluate(()=>['pub-chart','rr-chart','ls-chart'].flatMap(id=>{
      const el=document.getElementById(id), svg=el.getBoundingClientRect(), legend=el.querySelector('.legend')?.getBoundingClientRect();
      const ticks=[...el.querySelectorAll(innerWidth<600?'.ytick':'.xtick')];
      if (legend && legend.bottom>svg.bottom+1) return [[id,'Legend below chart container']];
      return ticks.filter(t=>{const r=t.getBoundingClientRect();return !/N=\d+/.test(t.textContent)||r.bottom>svg.bottom||r.left<svg.left||(legend&&r.left<legend.right&&r.right>legend.left&&r.top<legend.bottom&&r.bottom>legend.top);}).map(t=>[id,t.textContent]);
    }));
    assert.deepEqual(issues,[],`N labels clipped/overlapped at ${width}px`);
    assert.ok(await p.evaluate(()=>['pub-chart','rr-chart','ls-chart'].every(id=>{
      const el=document.getElementById(id);return JSON.stringify([...el.querySelectorAll('.legendtext')].map(e=>e.textContent))===JSON.stringify(el.data.map(t=>t.name));
    })));
    const clippedTitles=await p.evaluate(()=>['pub-chart','rr-chart','ls-chart'].filter(id=>{
      const el=document.getElementById(id), r=el.getBoundingClientRect(), title=el.querySelector('.g-xtitle')?.getBoundingClientRect();
      return title&&(title.left<r.left||title.right>r.right);
    }));
    assert.deepEqual(clippedTitles,[],`comparison axis titles clipped at ${width}px`);
  }
  await p.setViewportSize({width:390,height:900});
  await p.selectOption('#mobile-navigation','citation-tab');await p.waitForFunction(()=>document.getElementById('plot-cit')?.data?.length);
  for(const width of [390,320]){
    await p.setViewportSize({width,height:900});await p.waitForTimeout(700);
    const issues=await p.evaluate(()=>['plot-cit','plot-cocit'].flatMap(id=>{
      const el=document.getElementById(id), r=el.getBoundingClientRect();
      const titles=[...el.querySelectorAll('.g-ytitle,.g-y2title')];
      return titles.filter(t=>{const b=t.getBoundingClientRect();return b.left<r.left||b.right>r.right||[...el.querySelectorAll('.ytick,.y2tick')].some(tick=>{const a=tick.getBoundingClientRect();return a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;});}).map(t=>[id,t.textContent]);
    }));
    assert.deepEqual(issues,[],`axis titles clipped/overlapped at ${width}px`);
  }
  assert.deepEqual(p.errors,[]);await p.close();
});

test('Browse and Citation Impact share accent, quote, token and DOI search rules',async()=>{
  const p=await page('?tab=browse');
  async function browseSearch(q){
    await p.fill('#browse-mobile-input',q);
    await p.waitForFunction(q=>browseQuery===q,q);
    return p.evaluate(()=>getChartData().map(r=>r.doi_o));
  }
  for(const [q,doi] of [['Bem 2011','10.1037/a0021524'],['Strack 1988','10.1037/0022-3514.54.5.768']]){
    const rows=await browseSearch(q);assert.ok(rows.length>0,q);assert.ok(rows.includes(doi),q);
  }
  for(const [a,b] of [['Müller','Muller'],["O'Brien",'O’Brien'],['"power posing"','“power posing”']]){
    const rows=await browseSearch(a);assert.ok(rows.length>0,a);assert.deepEqual(await browseSearch(b),rows,b);
  }
  for(const q of ['family','given','sequence']) assert.ok((await browseSearch(q)).length<100,`${q} must not match author JSON keys`);
  // Search every author's name, including given-only and group names, without metadata.
  assert.deepEqual(await p.evaluate(()=>{
    const row={author_o:JSON.stringify([{given:'Zoë',family:'Müller',ORCID:'metadata-only'},{given:'Søren'},{name:'Research collective'}]),outcome:'raw_outcome_code',url_r:'https://url-only.invalid',outcome_quote:'A distinctive quotation'};
    return ['Zoe Muller','Søren','Research collective','metadata-only','raw_outcome_code','url-only.invalid','distinctive quotation'].map(q=>matchesBrowseQuery(row,q));
  }),[true,true,true,false,false,false,true]);
  await p.click('#citation-tab');await p.waitForSelector('.timeline-open');
  for(const [q,doi] of [['Bem  2011','10.1037/a0021524'],['Strack 1988','10.1037/0022-3514.54.5.768'],['"Feeling the Future"','10.1037/a0021524'],['“Feeling the Future”','10.1037/a0021524'],['https://doi.org/10.1037/a0021524','10.1037/a0021524'],['doi: 10.1037/a0021524','10.1037/a0021524']]){
    assert.ok((await citationSearch(p,q)).includes(doi),q);
  }
  for(const [a,b] of [['Müller','Muller'],["O'Brien",'O’Brien']]){
    const rows=await citationSearch(p,a);assert.ok(rows.length>0,a);assert.deepEqual(await citationSearch(p,b),rows,b);
  }
  assert.deepEqual(p.errors,[]);await p.close();
});
test('citation search waits for rendering even when the debounce fires late',async()=>{
  const p=await page('?tab=citations');await p.waitForSelector('.timeline-open');
  await p.evaluate(()=>{
    const original=window.setTimeout;
    window.setTimeout=(fn,delay,...args)=>original(fn,delay===200?800:delay,...args);
  });
  assert.deepEqual(await citationSearch(p,'Bem 2011'),['10.1037/a0021524']);
  // Both an empty render and a second empty render must finish before the helper returns.
  assert.deepEqual(await citationSearch(p,'zz-no-original'),[]);
  assert.deepEqual(await citationSearch(p,'zz-another-missing-original'),[]);
  assert.deepEqual(p.errors,[]);await p.close();
});
test('Citation Impact searches full author lists, including after an early DOI deep link',async()=>{
  const doi='10.1037/a0021524', fallbackDoi='10.1037/0022-3514.54.5.768';
  const index=JSON.parse(fs.readFileSync('data/originals_index.json'));
  const authors=['Firstauthor','Secondauthor','Thirdauthor','Fourthauthor','Fifthauthor','Sixthauthor','Lastauthor'].map((family,i)=>({family,given:i===6?'Zoë':'A',ORCID:'metadata-only'}));
  const row={doi_o:'https://doi.org/10.1037/A0021524',title_o:'Feeling the Future',author_o:JSON.stringify(authors),journal_o:'Journal of Personality and Social Psychology',year_o:2011,doi_r:'10.test/replication',title_r:'Replication',author_r:'Other researcher',year_r:2015,type:'replication',outcome:'failed'};
  const csv=[Object.keys(row),Object.values(row)].map(fields=>fields.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\n');
  const compact=[{...index.find(s=>s.doi===doi),author:authors.slice(0,6).map(a=>`${a.family}, A.`).join('; ')+', … (+1)'},{...index.find(s=>s.doi===fallbackDoi),author:'Fallbackauthor, F.'}];
  for(const early of [false,true]){
    const p=await page('?tab=citations'+(early?'&doi='+encodeURIComponent(doi):''),1280,async p=>{
      await p.route('**/data/originals_index.json',route=>route.fulfill({json:compact}));
      await p.route('**/data/flora.csv',async route=>{
        // Force the citation index to load before the full author records on a deep link.
        if(early) await p.waitForSelector('#ci-modal:not([hidden])');
        await route.fulfill({contentType:'text/csv',body:csv});
      });
    });
    await p.waitForSelector('.timeline-open');
    if(early) await p.keyboard.press('Escape');
    assert.deepEqual(await citationSearch(p,'Zoe Lastauthor'),[doi],`seventh author, early=${early}`);
    assert.deepEqual(await citationSearch(p,'Firstauthor'),[doi]);
    assert.deepEqual(await citationSearch(p,'metadata-only'),[]);
    assert.deepEqual(await citationSearch(p,'Fallbackauthor'),[fallbackDoi]);
    assert.match(await p.locator('#search-input').getAttribute('placeholder'),/journal/i);
    assert.deepEqual(p.errors,[]);await p.close();
  }
});
test('search input is debounced, Show all draws once and Citation Impact offers empty-state recovery',async()=>{
  const p=await page('?tab=browse');
  // deferRender creates only the first page until more rows are requested.
  assert.ok(await p.evaluate(()=>dataTable.rows().nodes().length<fullRowData.length));
  await p.evaluate(()=>{window.searchDraws=0;dataTable.on('draw.dt',()=>searchDraws++);dataTable.page.len(-1).draw();});
  assert.equal(await p.evaluate(()=>searchDraws),1);
  assert.equal(await p.locator('#flora-table tbody tr').count(),await p.evaluate(()=>fullRowData.length));
  const immediate=await p.evaluate(()=>{
    searchDraws=0;const el=document.getElementById('browse-mobile-input');
    for(const q of ['B','Bem','Bem 2011']){el.value=q;el.dispatchEvent(new Event('input'));}
    return searchDraws;
  });
  assert.equal(immediate,0);await p.waitForFunction(()=>browseQuery==='Bem 2011');
  assert.equal(await p.evaluate(()=>searchDraws),1);
  await p.click('#citation-tab');await p.waitForSelector('.timeline-open');
  await p.evaluate(()=>{
    window.citationRenders=0;new MutationObserver(()=>citationRenders++).observe(document.querySelector('#originals-table tbody'),{childList:true});
    const el=document.getElementById('search-input');for(const q of ['z','zz','zz-no-such-original']){el.value=q;el.dispatchEvent(new Event('input'));}
  });
  assert.ok(await p.locator('.timeline-open').count()>0);
  await p.waitForSelector('#ci-search-empty:not([hidden])');
  assert.equal(await p.evaluate(()=>citationRenders),1);
  assert.match(await p.locator('#ci-search-empty').innerText(),/No originals match/);
  assert.equal(await p.locator('#pagination button').count(),0);
  await p.locator('#ci-clear-search').focus();await p.keyboard.press('Enter');
  await p.waitForSelector('.timeline-open');assert.ok(await p.locator('#ci-search-empty').isHidden());
  assert.equal(await p.inputValue('#search-input'),'');assert.equal(await p.evaluate(()=>document.activeElement.id),'search-input');
  assert.ok(!new URL(p.url()).searchParams.has('search-input'));
  assert.deepEqual(p.errors,[]);await p.close();
});
