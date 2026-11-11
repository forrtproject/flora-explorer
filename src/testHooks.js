// Console and browser-test API. Tests read live state and pure helpers through these
// globals, and some mutate the loaded data in place and ask a view to redraw synchronously.
import {flushSync} from 'react-dom';
import Papa from 'papaparse';
import {Chart} from 'chart.js/auto';
import {FloraCharts} from './lib/floraCharts.js';
import {classifyKind, classifyOutcome, filterByKind, isComputationalAssessed, isRobustnessAssessed, parseReproductionOutcome, reportKindLabel} from './lib/outcomes.js';
import {matchesBrowseQuery} from './lib/search.js';
import {renderInlineMd, parseFaqMarkdown} from './lib/faq.js';

const live = {};
const renderers = {};

export function setLive(key, value) { live[key] = value; }
export function registerRenderer(name, fn) {
    renderers[name] = fn;
    return () => { if (renderers[name] === fn) delete renderers[name]; };
}
const render = name => (...args) => flushSync(() => renderers[name]?.(...args));

export function installTestHooks() {
    Object.assign(window, {
        Chart, Papa, FloraCharts,
        classifyKind, classifyOutcome, filterByKind, isComputationalAssessed, isRobustnessAssessed, parseReproductionOutcome, reportKindLabel,
        matchesBrowseQuery, renderInlineMd, parseFaqMarkdown,
        currentTheme: () => document.documentElement.getAttribute('data-theme') || 'light',
        getChartData: () => live.browseRows?.() ?? [],
        trendsFilteredData: () => live.trendsRows?.() ?? [],
        renderRandomExamples: render('randomExamples'),
        renderTrendOrigYear: render('trends'),
        renderOverlapCharts: render('overlap'),
        renderMcCharts: render('meanCitedness'),
        renderPubTypeCharts: render('publicationType'),
    });
    for (const [name, key] of [['fullRowData', 'rows'], ['browseQuery', 'browseQuery'], ['browseKind', 'browseKind'],
        ['floraBrowse', 'browseTable'], ['_mcData', 'mcData'], ['_aoData', 'aoData'], ['_rrData', 'rrData'], ['_pubData', 'pubData']]) {
        Object.defineProperty(window, name, {configurable: true, get: () => live[key]});
    }
}
