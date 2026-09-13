const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const {spawn} = require('node:child_process');
const fs = require('node:fs');
let browser, server;
const base = 'http://127.0.0.1:8897/';
before(async()=>{
  server=spawn(process.env.PYTHON || 'python3',['-m','http.server','8897','--bind','127.0.0.1'],{stdio:'ignore'});
  for(let i=0;i<50;i++){try{await fetch(base);break;}catch{await new Promise(r=>setTimeout(r,100));}}
  browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL || 'chrome',headless:true});
});
after(async()=>{await browser?.close();server?.kill();});
async function page(query, width=1280){
  const p=await browser.newPage({viewport:{width,height:900}});p.errors=[];
  p.on('pageerror',e=>p.errors.push(e.message));
  await p.goto(base+query);await p.waitForFunction(()=>document.querySelector('#floraTabsContent').style.display==='block');
  await p.waitForFunction(()=>typeof Chart!=='undefined'&&typeof Plotly!=='undefined');
  return p;
}
async function browseRows(p){return p.evaluate(()=>getChartData().map(r=>[r.title_o,r.title_r,r.outcome]));}
test('desktop/mobile search, DOI URLs, empty results, shared view and evidence agree',async()=>{
  const p=await page('?tab=browse&kind=replication&q=power+posing');
  await p.waitForFunction(()=>getChartData().length===4);
  const expected=await browseRows(p);assert.deepEqual(expected.map(r=>r[2]).sort(),['failed','failed','failed','mixed']);
  const values=await p.evaluate(()=>Chart.getChart('browse-outcome-chart').data.datasets.map(d=>[d.label,d.data[0]]));
  assert.equal(values.find(v=>v[0]==='Failed')[1],3);assert.equal(values.find(v=>v[0]==='Mixed')[1],1);
  assert.equal(await p.locator('#flora-table tbody tr').count(),4);
  await p.locator('.study-details').first().focus();await p.keyboard.press('Enter');
  assert.equal(await p.locator('.study-details').first().getAttribute('aria-expanded'),'true');
  assert.ok(await p.locator('.detail-row').first().isVisible());
  await p.setViewportSize({width:390,height:844});assert.equal(await p.locator('.bm-card').count(),4);
  await p.locator('.bm-evidence summary').first().click();assert.ok(await p.locator('.bm-evidence[open] .detail-row').isVisible());
  assert.deepEqual(await browseRows(p),expected);
  await p.reload();await p.waitForFunction(()=>getChartData().length===4);assert.deepEqual(await browseRows(p),expected);
  for(const q of ['10.1177/0956797610383437','https://doi.org/10.1177/0956797610383437','Carney 2010']){
    await p.fill('#browse-mobile-input',q);await p.waitForFunction(()=>getChartData().length===3);
    assert.equal(await p.locator('.bm-card').count(),3);
  }
  const downloadEvent=p.waitForEvent('download');await p.click('#export-browse');const download=await downloadEvent;
  const exported=fs.readFileSync(await download.path(),'utf8');
  const exportedRows=await p.evaluate(text=>Papa.parse(text,{header:true}).data,exported);
  assert.equal(exportedRows.length,3);assert.match(exportedRows[0]['Export context'],/Unit: reference pair/);
  await p.fill('#browse-mobile-input','no-matching-flora-reference-zzzz');await p.waitForFunction(()=>getChartData().length===0);
  assert.equal(await p.locator('.bm-card').count(),0);
  assert.equal(await p.evaluate(()=>Chart.getChart('browse-outcome-chart').data.datasets.reduce((n,d)=>n+d.data[0],0)),0);
  assert.match(await p.locator('#browse-outcome-chart-data').textContent(),/No matching assessed outcomes/);
  assert.deepEqual(p.errors,[]);await p.close();
});
test('Mean Citedness clears stale models and all distribution outcomes reconcile',async()=>{
  const p=await page('?tab=mean-citedness');await p.waitForFunction(()=>document.querySelector('#mc-gam-stats').textContent.includes('N'));
  for(const kind of ['reproduction-numerical','reproduction-robustness']){
    await p.click(`#mc-study-type [data-value="${kind}"]`);
    assert.equal((await p.locator('#mc-gam-stats').textContent()).trim(),'');
    assert.match(await p.locator('#mc-gam-chart').innerText(),/No model has been fitted/);
    assert.equal(await p.locator('#mc-gam-chart-data').count(),0);
  }
  await p.click('#mc-study-type [data-value="replication"]');
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
  const sums=await p.evaluate(()=>{const t=document.getElementById('pub-chart').data;return t[0].x.map((_,i)=>t.reduce((n,s)=>n+s.y[i],0));});
  assert.ok(sums.every(s=>Math.abs(s-100)<1e-8));
  assert.match(await p.locator('#pub-overview').textContent(),/257/);
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
