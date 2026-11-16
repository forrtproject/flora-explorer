import * as echarts from 'echarts/core';
import {BarChart, CustomChart, LineChart, ScatterChart} from 'echarts/charts';
import {GraphicComponent, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent} from 'echarts/components';
import {SVGRenderer} from 'echarts/renderers';
import {chartTheme, textScale} from './theme.js';
import {number, percent} from './format.js';

// Only what the explorer draws is registered, so the bundle carries no unused chart types.
// SVG keeps text crisp at any zoom and leaves labels in the DOM for the acceptance tests.
echarts.use([BarChart, CustomChart, LineChart, ScatterChart, GraphicComponent, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent, SVGRenderer]);
export {echarts};

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

const escapeHtml = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// A tooltip row: the series swatch, then text. Values are escaped because tooltips render as HTML.
export const tipRow = (color, text) => `<span class="chart-tip-swatch" style="background:${escapeHtml(color)}"></span>${escapeHtml(text)}`;
export const tipLines = lines => lines.filter(Boolean).join('<br>');
export {escapeHtml};

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Styled axes. Labels and titles sit in the secondary text colour; only value axes draw a grid.
export function valueAxis(extra = {}) {
    const t = chartTheme();
    return merge({type: 'value', splitNumber: 4, axisLine: {show: false}, axisTick: {show: false}, splitLine: {lineStyle: {color: t.grid}},
        axisLabel: {color: t.tick, fontSize: 11}, nameLocation: 'middle', nameGap: 14, nameTextStyle: {color: t.tick, fontSize: 12}}, extra);
}
export function categoryAxis(extra = {}) {
    const t = chartTheme();
    return merge({type: 'category', axisLine: {show: false}, axisTick: {show: false}, splitLine: {show: false},
        axisLabel: {color: t.tick, fontSize: 11}, nameLocation: 'middle', nameGap: 14, nameTextStyle: {color: t.tick, fontSize: 12}}, extra);
}
// Counts are whole numbers, so their axis never shows fractional ticks.
export const countAxis = () => ({minInterval: 1, axisLabel: {formatter: v => number(v)}});

function merge(base, over) {
    const out = {...base};
    for (const [key, value] of Object.entries(over || {})) {
        out[key] = value && typeof value === 'object' && !Array.isArray(value) && typeof value !== 'function' && base[key] && typeof base[key] === 'object' && !Array.isArray(base[key]) ? merge(base[key], value) : value;
    }
    return out;
}

const valueOf = v => Number(v && typeof v === 'object' && !Array.isArray(v) ? v.value : v) || 0;
// Bar series that plot nothing stay in the data table and export but leave the legend.
const hasData = s => s.type !== 'bar' || (s.data || []).some(v => valueOf(v) > 0);

// Rows of legend items at this width, so the plot starts below them instead of under them.
function legendRows(names, width, scale = 1) {
    if (!names.length) return 0;
    let rows = 1, used = 0;
    for (const item of names) {
        const w = ((typeof item === 'string' ? item : item.name).length * 6.4 + 30) * scale;
        if (used && used + w > width) { rows += 1; used = 0; }
        used += w;
    }
    return rows;
}

// The look every chart shares, the legend above the plot and the space it needs.
// A chart's own option only adds what differs; `top` is extra room it needs above the plot.
export function finishOption(option, {width = 600, top = 0} = {}) {
    const t = chartTheme(), scale = textScale();
    const series = option.series || [];
    const names = option.legend?.data || series.filter(s => s.name && !s.name.startsWith('_') && hasData(s)).map(s => s.name);
    const showLegend = option.legend?.show !== false && names.length > 0;
    const legendHeight = showLegend ? legendRows(names, width, scale) * 20 * scale + 6 : 0;
    top *= scale;
    // Bar charts hover the whole category (every segment of a year, journal or venue at once) under a
    // faint plum shadow; lines, points and histogram bins hover the item under the pointer.
    const bars = series.length > 0 && series.every(s => s.type === 'bar');
    const base = {
        animation: !reducedMotion(), animationDuration: 500,
        backgroundColor: t.paper, aria: {enabled: false},
        textStyle: {fontFamily: t.fontFamily, fontSize: 12, color: t.font},
        tooltip: {trigger: bars ? 'axis' : 'item', ...(bars ? {axisPointer: {type: 'shadow', shadowStyle: {color: 'rgba(133,57,83,.07)'}}} : {}),
            confine: true, className: 'chart-tooltip', backgroundColor: '#2c2c2c', borderWidth: 0, textStyle: {color: '#fff', fontFamily: t.fontFamily, fontSize: 12}},
        // Clicking a legend entry hides or shows that series.
        legend: {show: showLegend, data: names, top: 0, left: 0, icon: 'circle', itemWidth: 8, itemHeight: 8, itemGap: 16,
            textStyle: {color: t.tick, fontSize: 12, fontFamily: t.fontFamily}},
        grid: {left: 4, right: 12, bottom: 4, top: legendHeight + top + 8, outerBoundsMode: 'same', outerBoundsContain: 'all'},
    };
    const own = {...option, legend: {...option.legend, data: names, show: showLegend}};
    if (option.grid) own.grid = {...option.grid, top: (option.grid.top ?? 8) + legendHeight + top};
    return scaleText(merge(base, own), scale);
}

// Every font size in an option, multiplied by the page's text scale so chart text grows with the page's.
function scaleText(node, scale) {
    if (scale === 1 || !node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(n => scaleText(n, scale));
    const out = {};
    for (const [key, value] of Object.entries(node)) out[key] = key === 'fontSize' && typeof value === 'number' ? Math.round(value * scale) : typeof value === 'function' ? value : scaleText(value, scale);
    return out;
}

// Only the outer ends of a stack are rounded, so a stacked bar reads as one shape.
export function stackCorners(values, horizontal, radius) {
    const filled = i => values.map((col, s) => Number(col[i]) > 0 ? s : -1).filter(s => s >= 0);
    return (s, i) => {
        const on = filled(i), first = s === on[0], last = s === on[on.length - 1];
        if (horizontal) return [first ? radius : 0, last ? radius : 0, last ? radius : 0, first ? radius : 0];
        return [last ? radius : 0, last ? radius : 0, 0, 0];
    };
}

// A stacked bar chart of counts per category. `series` is [{name, color, values}].
// horizontal: categories run down the side; pooledFirst: a dashed rule sets a pooled first column apart.
export function stackedBarOption({categories, series, horizontal = false, pooledFirst = false, proportion = false, total = 0, width}) {
    const t = chartTheme();
    const corners = stackCorners(series.map(s => s.values), horizontal, horizontal ? 5 : 3);
    const bars = series.map((s, si) => ({
        name: s.name, type: 'bar', stack: 'total', ...(horizontal || proportion ? {barWidth: proportion ? 18 : 14} : {barMaxWidth: 26}),
        itemStyle: {color: s.color, borderColor: t.paper, borderWidth: 1},
        emphasis: {focus: 'series'},
        data: s.values.map((v, i) => ({value: v, itemStyle: {borderRadius: corners(si, i)}})),
    }));
    if (proportion) {
        // A proportion bar: its caption states the counts, so it carries no axis; hovers add each share.
        return finishOption({series: bars, tooltip: {valueFormatter: v => `${number(v)} (${percent(v, total, 1)}%)`},
            xAxis: {type: 'value', show: false, min: 0, max: Math.max(total, 1)}, yAxis: {type: 'category', show: false, data: categories},
            grid: {left: 0, right: 0, top: 4, height: 24}}, {width});
    }
    // Long field and journal names break onto further lines within 150px.
    const cats = categoryAxis({data: categories, inverse: horizontal,
        axisLabel: horizontal ? {interval: 0, width: 150 * textScale(), overflow: 'break'} : {hideOverlap: true},
        // Category split line i falls at the start of column i; only the one after the pooled column is drawn.
        splitLine: pooledFirst && categories.length > 1 ? {show: true, showMinLine: false, showMaxLine: false, interval: i => i === 1, lineStyle: {color: t.tick, type: [4, 3], width: 1}} : {show: false}});
    const values = valueAxis(countAxis());
    return finishOption({series: bars, tooltip: {valueFormatter: v => number(v)}, xAxis: horizontal ? values : cats, yAxis: horizontal ? cats : values}, {width});
}
export function barTable(categories, series, eligible, scope) {
    const total = series.reduce((n, s) => n + s.values.reduce((sum, v) => sum + (Number(v) || 0), 0), 0);
    return {headers: ['Category', ...series.map(s => s.name)], rows: categories.map((label, i) => [plain(label), ...series.map(s => s.values[i] ?? 0)]), summary: barSummary(total, eligible, scope)};
}
export function barSummary(total, eligible, scope) {
    const excluded = Math.max(0, eligible - total);
    const sample = `Included in the plot: ${number(total)} of ${number(eligible)} reference ${eligible === 1 ? 'pair' : 'pairs'}; excluded from this selection: ${number(excluded)} reference ${eligible - total === 1 ? 'pair' : 'pairs'}. `;
    if (scope === 'reproduction') return sample + `${total ? '' : 'No matching assessed outcomes. '}Unchecked or uncoded values for this dimension are excluded; the two reproduction subsets overlap.`;
    if (scope === 'replication') return sample + `${total ? '' : 'No matching assessed outcomes. '}All replication outcomes are included; qualified success, descriptive, uninformative, missing and unrecognised outcomes are separate.`;
    return sample + 'Counts are reference pairs in the displayed categories; journal charts show only the selected top N.';
}

// Dark text on light fills and white on dark ones, for labels drawn inside a bar.
export function labelColor(fill) {
    const hex = /^#([0-9a-f]{6})$/i.exec(String(fill).trim());
    if (!hex) return '#fff';
    const [r, g, b] = [0, 2, 4].map(i => parseInt(hex[1].slice(i, i + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
    return .2126 * r + .7152 * g + .0722 * b > .32 ? '#1f1a1d' : '#fff';
}

const COMPARISON_SUMMARY = 'Denominator: all reference pairs in each group with the metadata required by this analysis. All recorded outcome categories and missing outcomes are retained. Missing authorship or Registered Report metadata are reported in the summary above. Repeated reports and targets mean these observations are not independent.';

// Grouped outcome comparisons (authorship, Registered Reports, venue, report size): each group's
// outcomes as within-group percentages (stacked) or as counts (grouped). Narrow screens lay the
// groups down the side so long venue and category names stay readable.
export function comparisonOption({groups, series}, {counts = false, width = 600} = {}) {
    const t = chartTheme(), narrow = width < 600;
    const totals = groups.map((_, i) => series.reduce((sum, s) => sum + (Number(s.values[i]) || 0), 0));
    const share = (v, i) => totals[i] ? 100 * v / totals[i] : 0;
    // Group names break onto further lines within 80px; the group's N sits on its own last line.
    const labels = groups.map((g, i) => `${plain(g)}\nN=${number(totals[i])}`);
    const shares = series.map(s => s.values.map((v, i) => counts ? v : share(v, i)));
    const corners = stackCorners(shares, narrow, 4);
    const bars = series.map((s, si) => ({
        name: s.name, type: 'bar', stack: counts ? undefined : 'share', ...(counts ? {barMaxWidth: 28} : {barWidth: '52%'}),
        itemStyle: {color: s.color, borderColor: t.paper, borderWidth: 1}, emphasis: {focus: 'series'},
        // Shares large enough to hold a label are written on the segment itself, in a colour that reads on its fill.
        label: {show: !counts, position: 'inside', color: labelColor(s.color), fontSize: 11, fontFamily: t.fontFamily, formatter: p => p.value >= 7 ? Math.round(p.value) + '%' : ''},
        data: shares[si].map((v, i) => ({value: v, itemStyle: {borderRadius: counts ? (narrow ? [0, 3, 3, 0] : [3, 3, 0, 0]) : corners(si, i)}})),
    }));
    const tooltip = {valueFormatter: counts ? v => `${number(v)} reference pairs` : v => v.toFixed(1) + '%'};
    const values = valueAxis(counts ? {...countAxis(), name: 'Reference pairs'}
        : {name: narrow ? 'Within-group\npercentage' : 'Within-group percentage', min: 0, max: 100, interval: 25, axisLabel: {formatter: '{value}%'}});
    const cats = categoryAxis({data: labels, inverse: narrow, axisLabel: {interval: 0, width: 80 * textScale(), overflow: 'break'}});
    return finishOption({series: bars, tooltip, xAxis: narrow ? values : cats, yAxis: narrow ? cats : values}, {width});
}
export function comparisonTable({groups, series}) {
    const totals = groups.map((_, i) => series.reduce((sum, s) => sum + (Number(s.values[i]) || 0), 0));
    const rows = [];
    series.forEach(s => groups.forEach((group, i) => {
        const count = Number(s.values[i]) || 0;
        rows.push([plain(group), plain(s.name), count, totals[i], totals[i] ? count > 0 && 100 * count / totals[i] < 1 ? '<1' : Number((100 * count / totals[i]).toFixed(1)) : 'Not available']);
    }));
    return {headers: ['Group', 'Outcome', 'Reference pairs', 'Group denominator', 'Percentage (%)'], rows, summary: COMPARISON_SUMMARY};
}

// Rows for a chart whose table is simply each plotted point: series, x, value and unit.
export function pointTable(series, unit, summary = 'Values below include every plotted series.') {
    return {headers: ['Series', 'X / category', 'Value', 'Unit'], rows: series.flatMap(s => s.x.map((x, i) => [s.name, x, s.y[i], unit])), summary};
}
