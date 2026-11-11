import {Chart} from 'chart.js/auto';
import {plain, escapeHtml, number, percent, countAxis, theme, token, csvText, download, prefersReducedMotion} from './chartUtils.js';
import {loadPlotly} from './plotly.js';

export const COMPARISON_IDS = new Set(['ao-chart', 'rr-chart', 'pub-chart', 'ls-chart']);

// Accessible table for a Chart.js bar config; `eligible` is the selection's reference-pair count.
export function chartJsTable(id, config, eligible) {
    const datasets = config.data.datasets || [], labels = config.data.labels || [];
    const rows = labels.map((label, i) => [label, ...datasets.map(d => d.data[i] ?? 0)]);
    const total = datasets.reduce((n, d) => n + d.data.reduce((sum, v) => sum + (Number(v) || 0), 0), 0);
    const isOutcome = /outcome|computational|robustness/.test(id);
    const isReproduction = /computational|robustness/.test(id);
    const summary = `Included in the plot: ${number(total)}; excluded from this selection: ${number(Math.max(0, eligible - total))} reference ${eligible - total === 1 ? 'pair' : 'pairs'}. `
        + (isOutcome
            ? `${total ? '' : 'No matching assessed outcomes. '}${isReproduction ? 'Unchecked or uncoded values for this dimension are excluded; the two reproduction subsets overlap.' : 'All replication outcomes are included; qualified success and other/uncoded outcomes are separate.'}`
            : 'Counts are reference pairs in the displayed categories; journal charts show only the selected top N.');
    return {headers: ['Category', ...datasets.map(d => d.label)], rows, summary};
}

export function createChart(canvas, config) {
    if (config.options.scales) for (const axis of Object.values(config.options.scales)) if (axis.ticks) axis.ticks.autoSkip = config.options.indexAxis !== 'y';
    if (config.options.plugins?.legend) config.options.plugins.legend.reverse = false;
    Chart.defaults.font.family = theme().fontFamily;
    if (prefersReducedMotion()) config.options.animation = false;
    return new Chart(canvas, config);
}

// Applies the shared Plotly layout rules (comparison percentages, phone layouts, label and
// legend spacing, no drag/zoom) and returns the display traces with their accessible table.
// options: {mode: 'count'|'percent', table: {headers, rows, summary}, height}
export function preparePlot(el, traces, layout = {}, config = {}, options = {}) {
    const id = el.id;
    layout = {...layout, font: {family: theme().fontFamily, ...layout.font}};
    let display = traces.map(t => ({...t}));
    layout = {...layout, autosize: true, legend: {...layout.legend, traceorder: 'normal'}};
    for (const key of Object.keys(layout).filter(k => /^[xy]axis\d*$/.test(k))) {
        const axis = layout[key], title = typeof axis.title === 'string' ? {text: axis.title} : axis.title;
        layout[key] = {...axis, automargin: true, title: {...title, standoff: 12}};
    }
    const comparison = COMPARISON_IDS.has(id);
    const counts = options.mode === 'count';
    let summary = 'Values below include every plotted series; interval limits are shown where available.';
    if (comparison) {
        const nGroups = traces[0]?.x?.length || 0;
        const totals = Array.from({length: nGroups}, (_, i) => traces.reduce((sum, t) => sum + (Number(t.y?.[i]) || 0), 0));
        display = display.map(t => ({...t,
            x: t.x.map((v, i) => plain(v).replace(/(.{1,18})(?:\s|$)/g, '$1<br>').replace(/<br>$/, '') + `<br>N=${number(totals[i])}`),
            y: t.y.map((v, i) => counts ? v : totals[i] ? 100 * v / totals[i] : 0),
            customdata: t.y.map((v, i) => [v, totals[i], escapeHtml(percent(v, totals[i], 1))]),
            hovertemplate: counts ? '%{x}<br>%{y:,.0f} reference pairs<extra>%{fullData.name}</extra>' : '%{x}<br>%{customdata[2]}% (%{customdata[0]:,.0f} pairs)<extra>%{fullData.name}</extra>'}));
        layout.barmode = counts ? 'group' : 'stack';
        layout.xaxis = {...layout.xaxis, tickangle: 0};
        const maxCount = Math.max(0, ...traces.flatMap(t => t.y));
        layout.yaxis = {...layout.yaxis, title: {text: counts ? 'Reference pairs' : 'Within-group percentage', standoff: 12}, ...(counts ? countAxis(maxCount) : {tickformat: '.0f', dtick: undefined}), range: counts ? undefined : [0, 100]};
        summary = 'Denominator: all reference pairs in each group with the metadata required by this analysis. Other and qualified outcomes are retained. Missing authorship or Registered Report metadata are reported in the summary above. Repeated reports and targets mean these observations are not independent.';
    }
    if (window.innerWidth < 600) {
        layout.margin = {...layout.margin, l: 60, r: layout.yaxis2 ? 65 : 20, b: 100};
        layout.legend = {...layout.legend, orientation: 'h', y: -0.32, font: {...layout.legend?.font, size: 10}};
        layout.height = Math.max(layout.height || 380, 420);
        layout.font = {...layout.font, size: 11};
        if (comparison) {
            // Horizontal bars leave room for venue and report-category labels.
            display = display.map(t => ({...t, orientation: 'h', x: t.y, y: t.x,
                hovertemplate: t.hovertemplate.replace(/%\{x\}/g, '%{category}').replace(/%\{y/g, '%{x').replace(/%\{category\}/g, '%{y}')}));
            layout.xaxis = {...layout.yaxis, automargin: true};
            layout.yaxis = {title: '', automargin: true, autorange: 'reversed', type: 'category', tickangle: 0};
            layout.xaxis.title = {...layout.xaxis.title, text: counts ? 'Reference pairs' : 'Within-group<br>percentage'};
            layout.margin = {...layout.margin, l: 110, b: 140};
            layout.legend = {...layout.legend, y: -0.25};
            layout.height = Math.max(440, (display[0]?.y.length || 0) * 65 + 200);
        }
    }
    // Paper-relative legend positions otherwise sit on wrapped category labels (including N).
    const horizontal = display[0]?.orientation === 'h';
    const labelLines = comparison && !horizontal ? Math.max(...display[0].x.map(v => v.split('<br>').length)) : 1;
    const axisSpace = labelLines * 17 + (layout.xaxis?.title?.text ? 45 : 15);
    const legendItems = display.filter(t => t.showlegend !== false).length;
    const legendRows = Math.ceil(legendItems / (window.innerWidth < 600 ? 1 : 4));
    const legendSpace = legendItems > 1 ? legendRows * 20 + 15 : 0;
    layout.margin = {...layout.margin, b: Math.max(layout.margin?.b || 0, axisSpace + legendSpace)};
    const plotHeight = (layout.height || el.clientHeight || 380) - (layout.margin.t || 0) - layout.margin.b;
    layout.legend = {...layout.legend, yanchor: 'top', y: -axisSpace / Math.max(100, plotHeight)};
    // Charts keep hover details, while page swipes and drags never zoom or pan.
    layout.dragmode = false;
    for (const key of Object.keys(layout)) if (/^[xy]axis\d*$/.test(key)) layout[key] = {...layout[key], fixedrange: true};
    config = {...config, scrollZoom: false, doubleClick: false};

    let table;
    if (comparison) {
        const rows = [];
        traces.forEach(t => (t.x || []).forEach((group, i) => {
            const count = Number(t.y?.[i]) || 0;
            const denominator = traces.reduce((n, s) => n + (Number(s.y?.[i]) || 0), 0);
            rows.push([plain(group), plain(t.name), count, denominator, denominator ? count > 0 && 100 * count / denominator < 1 ? '<1' : Number((100 * count / denominator).toFixed(1)) : 'Not available']);
        }));
        table = {headers: ['Group', 'Outcome', 'Reference pairs', 'Group denominator', 'Percentage (%)'], rows, summary};
    } else if (options.table) {
        table = options.table;
    } else {
        const rows = [];
        display.forEach(t => (t.x || []).forEach((x, i) => {
            const h = t.orientation === 'h';
            const value = h ? x : t.y?.[i]; const err = h ? t.error_x : t.error_y;
            rows.push([t.name || 'Series', h ? t.y?.[i] : x, value, err ? value - (err.arrayminus?.[i] ?? err.array?.[i] ?? 0) : '', err ? value + (err.array?.[i] ?? 0) : '', t.customdata?.[i]?.[0] ?? '']);
        }));
        table = {headers: ['Series', 'X / category', 'Value', '95% CI lower', '95% CI upper', 'Reference-pair count'], rows, summary};
    }
    return {display, layout, config, table};
}

// Draws into a Plotly-owned element and returns {table}. Kept on window.FloraCharts so
// tests can observe redraws; components always call it through that object.
function plot(target, traces, layout = {}, config = {}, options = {}) {
    const el = typeof target === 'string' ? document.getElementById(target) : target;
    if (!el) return null;
    if (!window.Plotly) return loadPlotly().then(() => plot(el, traces, layout, config, options));
    const prepared = preparePlot(el, traces, layout, config, options);
    el.style.height = prepared.layout.height ? prepared.layout.height + 'px' : (options.height || '');
    const title = prepared.layout.title ? plain(prepared.layout.title.text || prepared.layout.title) : options.title || el.id.replace(/-/g, ' ');
    el.setAttribute('role', 'img'); el.setAttribute('aria-label', title + '. Values in the following data table.');
    window.Plotly.react(el, prepared.display, prepared.layout, prepared.config);
    return {table: prepared.table};
}

export function purge(el) {
    if (el && window.Plotly && el.data) window.Plotly.purge(el);
}

export const FloraCharts = {plot, download, csvText, token, theme, number, percent, countAxis};
