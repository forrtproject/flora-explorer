/* Shareable filters, exports, and keyboard-visible navigation. */
(() => {
    let restoring = false, ready = false;
    function pressed() {
        document.querySelectorAll('.chip, .trend-filter-btn').forEach(b => b.setAttribute('aria-pressed',String(b.classList.contains('active'))));
    }
    const initial = new URL(location.href);
    // A DOI-only share link targets Citation Impact even before its data arrives.
    if (!initial.searchParams.has('tab') && initial.searchParams.get('doi')) initial.searchParams.set('tab','citations');
    const selectGroups = {'mc-study-type':['mc-kind','mc-tab','replication'],'ao-study-type':['ao-kind','overlap-tab','replication'],'pubtype-study-type':['pub-kind','pub-tab','replication'],'ci-study-type':['ci-kind','citation-tab','replication'],'outcome-chips':['ci-outcome','citation-tab','all']};
    const controls = {'journal-top-n':['journal-top-n','trends-tab','15'],'rep-journal-top-n':['rep-journal-top-n','trends-tab','15'],'filter-outcome':['filter-outcome','citation-tab',''],'search-input':['ci-q','citation-tab','']};
    function recordState() {
        if (restoring || !ready) return;
        const url = new URL(location.href), tab = document.querySelector('#floraTabs .active').id;
        const put = (key,value,fallback) => { if(String(value)!==String(fallback))url.searchParams.set(key,value); };
        // Remove known state first: a shared URL contains only the active view's choices.
        for (const key of ['tab','q','kind','sort','page','page-size','mobile-page','trends-kind','search-input',...Object.values(selectGroups).map(v=>v[0]),...Object.values(controls).map(v=>v[0])]) url.searchParams.delete(key);
        put('tab',TAB_ID_TO_PARAM[tab],'overview');
        if (tab !== 'citation-tab') url.searchParams.delete('doi');
        if (tab === 'browse-tab') {
            put('q',browseQuery,'');put('kind',browseKind,'all');
            put('sort',dataTable.order()[0].join(':'),'4:desc');
            put('page',dataTable.page()+1,1);put('page-size',dataTable.page.len(),25);
            put('mobile-page',bmPage+1,1);
        }
        if (tab === 'trends-tab') put('trends-kind',trendsKind,'replication');
        for (const [id,[key,owner,fallback]] of Object.entries(selectGroups)) {
            if(tab===owner) put(key,document.querySelector('#'+id+' .active')?.dataset.value || fallback,fallback);
        }
        for (const [id,[key,owner,fallback]] of Object.entries(controls)) {
            if(tab===owner) put(key,document.getElementById(id).value,fallback);
        }
        history.replaceState(null,'',url);
        pressed();
    }
    window.FloraView = {recordState};
    function restore(url, fromHistory = false) {
        restoring = true;
        const hadOpenTimeline = !document.getElementById('ci-modal').hidden;
        if(fromHistory) {
            document.dispatchEvent(new Event('flora-history'));
            // Back/forward always dismisses a timeline, including its shareable DOI.
            url.searchParams.delete('doi');
        }
        const kinds=['all','replication','reproduction-numerical','reproduction-robustness'];
        const kind=url.searchParams.get('kind') || 'all';browseKind=kinds.includes(kind)?kind:'all';
        browseQuery=url.searchParams.get('q') || '';document.getElementById('browse-mobile-input').value=browseQuery;
        document.querySelectorAll('.browse-kind-btn').forEach(b=>b.classList.toggle('active',b.dataset.kind===browseKind));
        const sort=url.searchParams.get('sort')?.split(':');
        dataTable.order(sort && /^[1-8]$/.test(sort[0]) && ['asc','desc'].includes(sort[1]) ? [[Number(sort[0]),sort[1]]] : [[4,'desc']]);
        const length=Number(url.searchParams.get('page-size') || 25);
        dataTable.page.len([10,25,50,100,-1].includes(length)?length:25);
        updateBrowseResults();
        const page=Number(url.searchParams.get('page') || 1);
        dataTable.page(Number.isSafeInteger(page) && page>0 ? Math.min(page-1,Math.max(0,dataTable.page.info().pages-1)) : 0).draw('page');
        const mobilePage=Number(url.searchParams.get('mobile-page') || 1);
        bmPage=Number.isSafeInteger(mobilePage) && mobilePage>0 ? mobilePage-1 : 0;bmRender();
        for (const [id,[key,,fallback]] of Object.entries(selectGroups)) {
            const value=url.searchParams.get(key) || fallback;
            const buttons=[...document.querySelectorAll('#'+id+' .chip')];
            const btn=buttons.find(b=>b.dataset.value===value) || buttons.find(b=>b.dataset.value===fallback);
            if(btn && !btn.classList.contains('active'))btn.click();
        }
        const trend=url.searchParams.get('trends-kind') || 'replication';
        const trendButtons=[...document.querySelectorAll('#trends .trend-filter-btn')];
        const trendButton=trendButtons.find(b=>b.dataset.kind===trend) || trendButtons.find(b=>b.dataset.kind==='replication');
        if(trendButton && !trendButton.classList.contains('active'))trendButton.click();
        for (const [id,[key,,fallback]] of Object.entries(controls)) {
            const el=document.getElementById(id);
            let value=url.searchParams.get(key) ?? (id==='search-input' ? url.searchParams.get('search-input') : null) ?? fallback;
            if(el.tagName==='SELECT' && ![...el.options].some(o=>o.value===value))value=fallback;
            if(el.value!==value){el.value=value;el.dispatchEvent(new Event(id==='search-input'?'input':'change'));}
        }
        history.replaceState(null,'',url);
        applyTabFromUrl();pressed();restoring=false;ready=true;recordState();
        if (fromHistory && hadOpenTimeline) {
            const pane = document.querySelector('.tab-pane.active');
            pane.setAttribute('tabindex','-1');pane.focus({preventScroll:true});
        }
        document.getElementById('mobile-navigation').value=document.querySelector('#floraTabs .active').id;
    }
    document.addEventListener('flora-ready',()=>restore(initial),{once:true});
    document.addEventListener('click',e=>{
        if(e.target.closest('.chip, .trend-filter-btn')) {pressed();recordState();}
    });
    document.addEventListener('change',e=>{if(Object.keys(controls).includes(e.target.id))recordState();});
    document.getElementById('search-input')?.addEventListener('input',recordState);
    document.getElementById('mobile-navigation').addEventListener('change',e=>bootstrap.Tab.getOrCreateInstance(document.getElementById(e.target.value)).show());
    const bar=document.querySelector('.top-bar'), tabs=document.getElementById('floraTabs'), mobile=document.querySelector('.mobile-navigation');
    function fitNavigation() {
        // Measure the full strip with the select temporarily hidden, including after
        // fonts load or the active label becomes bold. No viewport breakpoint needed.
        tabs.style.display='flex';mobile.style.display='none';
        bar.classList.toggle('navigation-collapsed',tabs.scrollWidth>tabs.clientWidth+1);
        tabs.style.display='';mobile.style.display='';
    }
    new ResizeObserver(fitNavigation).observe(document.querySelector('.top-bar-inner'));
    document.fonts.ready.then(fitNavigation);fitNavigation();
    document.querySelectorAll('#floraTabs button').forEach(btn=>{
        btn.addEventListener('show.bs.tab',()=>{
            if(ready && !restoring && document.querySelector('#floraTabs .active')!==btn) history.pushState(null,'',location.href);
        });
        btn.addEventListener('shown.bs.tab',()=>{
            document.getElementById('mobile-navigation').value=btn.id;
            document.querySelector('.app-main').scrollTop = 0;
            recordState();fitNavigation();
            requestAnimationFrame(()=>window.dispatchEvent(new Event('resize')));
        });
    });
    window.addEventListener('popstate',()=>restore(new URL(location.href),true));
    // In-page links to another tab switch tabs without reloading the data.
    // Modified or non-primary clicks keep normal link behaviour (new tab or window).
    document.addEventListener('click',e=>{
        const link=e.target.closest('[data-tab-link]');if(!link)return;
        if(e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
        e.preventDefault();
        const tab=document.getElementById(link.dataset.tabLink);
        bootstrap.Tab.getOrCreateInstance(tab).show();
        // Focus would otherwise stay on the link inside the now-hidden pane. On narrow
        // screens the tab buttons are hidden, so focus the destination panel instead.
        const pane=document.querySelector(tab.dataset.bsTarget);
        if(tab.offsetParent) tab.focus();
        else if(pane){pane.setAttribute('tabindex','-1');pane.focus({preventScroll:true});}
    });
    document.getElementById('share-view').onclick=async()=>{
        recordState();
        try { await navigator.clipboard.writeText(location.href);document.getElementById('view-feedback').textContent='Link copied'; }
        catch { document.getElementById('view-feedback').textContent='Copy the current address from your browser.'; }
    };
    document.getElementById('export-browse').onclick=()=>{
        const rows=getChartData(); const keys=Object.keys(fullRowData[0] || {});
        const stamp=document.querySelector('#browse .data-stamp')?.textContent || '';
        const filtered=browseQuery.trim() || browseKind !== 'all';
        FloraCharts.download(filtered ? 'flora-filtered-reference-pairs.csv' : 'flora-reference-pairs.csv',keys,rows.map(row=>keys.map(k=>row[k])),
            `Unit: reference pair\n${stamp}\nStudy kind: ${browseKind}\nQuery: ${browseQuery}\nIncluded: ${rows.length.toLocaleString('en-GB')}; excluded by filters: ${(fullRowData.length-rows.length).toLocaleString('en-GB')}\nQualified success is separate from unqualified success; reproduction dimensions overlap.`);
    };
    // Associate static and dynamically inserted glossary definitions with their triggers.
    let tipNumber = 0;
    function describeTips() {
        document.querySelectorAll('.info-icon, .gloss').forEach(trigger => {
            const tip = trigger.querySelector('.info-tip, .gloss-tip');
            if (!tip || trigger.hasAttribute('aria-describedby')) return;
            tip.id ||= 'flora-tip-' + (++tipNumber);
            tip.setAttribute('role', 'tooltip');
            trigger.setAttribute('aria-describedby', tip.id);
            trigger.addEventListener('mouseleave', () => trigger.classList.remove('tip-dismissed'));
            trigger.addEventListener('blur', () => trigger.classList.remove('tip-dismissed'));
        });
    }
    new MutationObserver(describeTips).observe(document.getElementById('floraTabsContent'), {childList:true, subtree:true});
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') document.querySelectorAll('.info-icon:hover, .info-icon:focus, .gloss:hover, .gloss:focus').forEach(el => el.classList.add('tip-dismissed'));
    });
    describeTips();
    pressed();
})();
