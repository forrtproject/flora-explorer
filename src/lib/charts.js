import {Chart} from 'chart.js/auto';
import {chartTheme} from './theme.js';
import {number, percent, countAxis} from './format.js';

export {Chart};

let plotly;
let plotlyPromise;
export function loadPlotly() {
    plotlyPromise ||= import('plotly.js-basic-dist-min').then(module => {
        plotly = module.default || module;
        window.Plotly = plotly;
        return plotly;
    });
    return plotlyPromise;
}
export const plotlyNow = () => plotly;

export const plain = s => (Array.isArray(s) ? s.join(' ') : String(s ?? '')).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
export const cellText = (v, header = '') => typeof v === 'number'
    ? v.toLocaleString('en-GB', {useGrouping: !/year|X \/ category/i.test(header), maximumFractionDigits: 5}).replace(/-/g, '−')
    : plain(v);

export function csvText(headers, rows, notes = '') {
    // Prefix formula-like text so spreadsheet programs treat it as data.
    const cell = v => '"' + (typeof v === 'number' ? String(Number(v.toFixed(5))) : (Array.isArray(v) ? plain(v) : String(v ?? '')).replace(/^[=+@-]/, m => "'" + m)).replace(/"/g, '""') + '"';
    return [notes ? ['Export context', ...headers] : headers, ...rows.map(row => notes ? [notes, ...row] : row)].map(row => row.map(cell).join(',')).join('\r\n');
}
export function download(name, headers, rows, notes = '') {
    const link = document.createElement('a');
    const url = URL.createObjectURL(new Blob(['﻿' + csvText(headers, rows, notes)], {type: 'text/csv;charset=utf-8'}));
    link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Applies the shared legend, font and motion rules, then returns the plotted values as a table.
export function barChart(canvas, config) {
    const datasets = config.data.datasets || [], labels = config.data.labels || [];
    if (config.options.scales) for (const axis of Object.values(config.options.scales)) if (axis.ticks) axis.ticks.autoSkip = config.options.indexAxis !== 'y';
    if (config.options.plugins?.legend) {
        config.options.plugins.legend.reverse = false;
        config.options.plugins.legend.labels ||= {};
        config.options.plugins.legend.labels.filter = item => datasets[item.datasetIndex].data.some(value => Number(value) > 0);
    }
    Chart.defaults.font.family = chartTheme().fontFamily;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) config.options.animation = false;
    return new Chart(canvas.getContext('2d'), config);
}
export function barTable(config) {
    const datasets = config.data.datasets || [];
    return {
        headers: ['Category', ...datasets.map(d => d.label)],
        rows: (config.data.labels || []).map((label, i) => [label, ...datasets.map(d => d.data[i] ?? 0)]),
        total: datasets.reduce((n, d) => n + d.data.reduce((sum, v) => sum + (Number(v) || 0), 0), 0),
    };
}
export function barSummary(total, eligible, scope) {
    const excluded = Math.max(0, eligible - total);
    const sample = `Included in the plot: ${number(total)}; excluded from this selection: ${number(excluded)} reference ${eligible - total === 1 ? 'pair' : 'pairs'}. `;
    if (scope === 'reproduction') return sample + `${total ? '' : 'No matching assessed outcomes. '}Unchecked or uncoded values for this dimension are excluded; the two reproduction subsets overlap.`;
    if (scope === 'replication') return sample + `${total ? '' : 'No matching assessed outcomes. '}All replication outcomes are included; qualified success, descriptive, uninformative, missing and unrecognised outcomes are separate.`;
    return sample + 'Counts are reference pairs in the displayed categories; journal charts show only the selected top N.';
}

const COMPARISON_SUMMARY = 'Denominator: all reference pairs in each group with the metadata required by this analysis. All recorded outcome categories and missing outcomes are retained. Missing authorship or Registered Report metadata are reported in the summary above. Repeated reports and targets mean these observations are not independent.';
const GENERIC_SUMMARY = 'Values below include every plotted series; interval limits are shown where available.';

// Turns a chart spec into what Plotly draws and the table that describes it, for the current width.
export function preparePlot(id, spec, {comparison = false, counts = false, fallbackHeight = 380} = {}) {
    const traces = spec.traces;
    const narrow = window.innerWidth < 600;
    let layout = {...spec.layout, font: {family: chartTheme().fontFamily, ...spec.layout?.font}};
    let config = {...spec.config};
    let display = traces.map(t => ({...t, showlegend: t.type === 'bar' && !(t.y || []).some(value => Number(value) > 0) ? false : t.showlegend}));
    layout = {...layout, autosize: true, legend: {...layout.legend, traceorder: 'normal'}};
    for (const key of Object.keys(layout).filter(k => /^[xy]axis\d*$/.test(k))) {
        const axis = layout[key], title = typeof axis.title === 'string' ? {text: axis.title} : axis.title;
        layout[key] = {...axis, automargin: true, title: {...title, standoff: 12}};
    }
    let table;
    if (comparison) {
        const nGroups = traces[0]?.x?.length || 0;
        const totals = Array.from({length: nGroups}, (_, i) => traces.reduce((sum, t) => sum + (Number(t.y?.[i]) || 0), 0));
        const escape = s => String(s).replace(/</g, '&lt;');
        display = display.map(t => ({...t,
            x: t.x.map((v, i) => plain(v).replace(/(.{1,18})(?:\s|$)/g, '$1<br>').replace(/<br>$/, '') + `<br>N=${number(totals[i])}`),
            y: t.y.map((v, i) => counts ? v : totals[i] ? 100 * v / totals[i] : 0),
            customdata: t.y.map((v, i) => [v, totals[i], escape(percent(v, totals[i], 1))]),
            hovertemplate: counts ? '%{x}<br>%{y:,.0f} reference pairs<extra>%{fullData.name}</extra>' : '%{x}<br>%{customdata[2]}% (%{customdata[0]:,.0f} pairs)<extra>%{fullData.name}</extra>'}));
        layout.barmode = counts ? 'group' : 'stack';
        layout.xaxis = {...layout.xaxis, tickangle: 0};
        const maxCount = Math.max(0, ...traces.flatMap(t => t.y));
        layout.yaxis = {...layout.yaxis, title: {text: counts ? 'Reference pairs' : 'Within-group percentage', standoff: 12}, ...(counts ? countAxis(maxCount) : {tickformat: '.0f', dtick: undefined}), range: counts ? undefined : [0, 100]};
        const rows = [];
        traces.forEach(t => (t.x || []).forEach((group, i) => {
            const count = Number(t.y?.[i]) || 0;
            rows.push([plain(group), plain(t.name), count, totals[i], totals[i] ? count > 0 && 100 * count / totals[i] < 1 ? '<1' : Number((100 * count / totals[i]).toFixed(1)) : 'Not available']);
        }));
        table = {headers: ['Group', 'Outcome', 'Reference pairs', 'Group denominator', 'Percentage (%)'], rows, summary: COMPARISON_SUMMARY};
    }
    if (narrow) {
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
    // Reserve separate space for category labels, axis titles and the legend;
    // paper-relative legend positions otherwise sit on wrapped labels.
    const horizontal = display[0]?.orientation === 'h';
    const labelLines = comparison && !horizontal && display[0] ? Math.max(1, ...display[0].x.map(v => v.split('<br>').length)) : 1;
    const axisSpace = labelLines * 17 + (layout.xaxis?.title?.text ? 45 : 15);
    const legendItems = display.filter(t => t.showlegend !== false).length;
    const legendSpace = legendItems > 1 ? Math.ceil(legendItems / (narrow ? 1 : 4)) * 20 + 15 : 0;
    layout.margin = {...layout.margin, b: Math.max(layout.margin?.b || 0, axisSpace + legendSpace)};
    const plotHeight = (layout.height || fallbackHeight) - (layout.margin.t || 0) - layout.margin.b;
    layout.legend = {...layout.legend, yanchor: 'top', y: -axisSpace / Math.max(100, plotHeight)};
    // Charts keep hover details, while page swipes and drags never zoom or pan.
    layout.dragmode = false;
    for (const key of Object.keys(layout)) if (/^[xy]axis\d*$/.test(key)) layout[key] = {...layout[key], fixedrange: true};
    config = {...config, scrollZoom: false, doubleClick: false};

    if (!table && spec.table) table = spec.table;
    if (!table) {
        const rows = [];
        const coefficient = id.endsWith('-model'), timeline = id === 'study-plot', trajectory = id === 'plot-cit' || id === 'plot-cocit';
        const hasIntervals = display.some(trace => trace.error_x || trace.error_y);
        display.forEach(t => (t.x || []).forEach((x, i) => {
            const flipped = t.orientation === 'h';
            const value = flipped ? x : t.y?.[i], err = flipped ? t.error_x : t.error_y;
            const unit = coefficient ? 'Coefficient: log(1 + count)' : timeline ? 'Citing works' : trajectory ? t.yaxis === 'y2' ? 'Distinct originals' : id === 'plot-cit' ? 'Mean citations per original per year' : 'Mean co-citations per original per year' : 'Reference pairs';
            const row = [t.name || 'Series', flipped ? t.y?.[i] : x, value, unit];
            if (hasIntervals) row.push(err ? value - (err.arrayminus?.[i] ?? err.array?.[i] ?? 0) : '', err ? value + (err.array?.[i] ?? 0) : '');
            rows.push(row);
        }));
        table = {headers: ['Series', 'X / category', 'Value', 'Unit', ...(hasIntervals ? ['95% CI lower', '95% CI upper'] : [])], rows, summary: GENERIC_SUMMARY};
    }
    return {display, layout, config, table};
}
