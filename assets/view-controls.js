/* Shareable filters, exports, and keyboard-visible navigation. */
(() => {
    let restoring = false;
    function pressed() {
        document.querySelectorAll('.chip, .trend-filter-btn').forEach(b => b.setAttribute('aria-pressed',String(b.classList.contains('active'))));
    }
    const initial = new URL(location.href);
    const selectGroups = {'mc-study-type':'mc-kind','ao-study-type':'ao-kind','pubtype-study-type':'pub-kind','ci-study-type':'ci-kind','outcome-chips':'ci-outcome'};
    function recordState() {
        if (restoring) return;
        const url = new URL(location.href);
        for (const [id,key] of Object.entries(selectGroups)) {
            const value = document.querySelector('#'+id+' .active')?.dataset.value;
            if (value) url.searchParams.set(key,value);
        }
        url.searchParams.set('trends-kind',trendsKind);
        for (const id of ['journal-top-n','rep-journal-top-n','filter-outcome','search-input']) {
            const el=document.getElementById(id);if(el?.value) url.searchParams.set(id,el.value);else url.searchParams.delete(id);
        }
        history.replaceState(null,'',url);
        pressed();
    }
    function restore(url) {
        restoring = true;
        const kinds=['all','replication','reproduction-numerical','reproduction-robustness'];
        const kind=url.searchParams.get('kind') || 'all';browseKind=kinds.includes(kind)?kind:'all';
        browseQuery=url.searchParams.get('q') || '';document.getElementById('browse-mobile-input').value=browseQuery;
        document.querySelectorAll('.browse-kind-btn').forEach(b=>b.classList.toggle('active',b.dataset.kind===browseKind));
        const sort=url.searchParams.get('sort')?.split(':');
        if (sort && /^[1-8]$/.test(sort[0]) && ['asc','desc'].includes(sort[1])) dataTable.order([[Number(sort[0]),sort[1]]]);
        updateBrowseResults();
        for (const [id,key] of Object.entries(selectGroups)) {
            const value=url.searchParams.get(key);
            const btn=[...document.querySelectorAll('#'+id+' .chip')].find(b=>b.dataset.value===value);
            if(btn && !btn.classList.contains('active'))btn.click();
        }
        const trend=url.searchParams.get('trends-kind') || 'replication';
        document.querySelectorAll('#trends .trend-filter-btn').forEach(b=>{
            if(b.dataset.kind===trend)b.click();
        });
        for (const id of ['journal-top-n','rep-journal-top-n','filter-outcome','search-input']) {
            const el=document.getElementById(id);const value=url.searchParams.get(id);
            if(el && value!==null){el.value=value;el.dispatchEvent(new Event(id==='search-input'?'input':'change'));}
        }
        history.replaceState(null,'',url);
        applyTabFromUrl();pressed();restoring=false;
    }
    document.addEventListener('flora-ready',()=>restore(initial),{once:true});
    document.addEventListener('click',e=>{
        if(e.target.closest('.chip, .trend-filter-btn')) {pressed();recordState();}
    });
    document.addEventListener('change',e=>{if(['journal-top-n','rep-journal-top-n','filter-outcome'].includes(e.target.id))recordState();});
    document.getElementById('search-input')?.addEventListener('input',recordState);
    document.getElementById('mobile-navigation').addEventListener('change',e=>bootstrap.Tab.getOrCreateInstance(document.getElementById(e.target.value)).show());
    document.querySelectorAll('#floraTabs button').forEach(btn=>{
        btn.addEventListener('show.bs.tab',()=>{
            if(!restoring && document.querySelector('#floraTabs .active')!==btn) history.pushState(null,'',location.href);
        });
        btn.addEventListener('shown.bs.tab',()=>{
            document.getElementById('mobile-navigation').value=btn.id;
            requestAnimationFrame(()=>window.dispatchEvent(new Event('resize')));
        });
    });
    window.addEventListener('popstate',()=>restore(new URL(location.href)));
    document.getElementById('share-view').onclick=async()=>{
        syncBrowseUrl();recordState();
        try { await navigator.clipboard.writeText(location.href);document.getElementById('view-feedback').textContent='Link copied'; }
        catch { document.getElementById('view-feedback').textContent='Copy the current address from your browser.'; }
    };
    document.getElementById('export-browse').onclick=()=>{
        const rows=getChartData(); const keys=Object.keys(fullRowData[0] || {});
        const stamp=document.querySelector('#browse .data-stamp')?.textContent || '';
        FloraCharts.download('flora-filtered-reference-pairs.csv',keys,rows.map(row=>keys.map(k=>row[k])),
            `Unit: reference pair\n${stamp}\nStudy kind: ${browseKind}\nQuery: ${browseQuery}\nIncluded: ${rows.length}; excluded by filters: ${fullRowData.length-rows.length}\nQualified success is separate from unqualified success; reproduction dimensions overlap.`);
    };
    pressed();
})();
