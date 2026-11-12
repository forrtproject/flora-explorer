import Papa from 'papaparse';
import {Chart, download, loadPlotly} from './charts.js';
import {renderInlineMd, parseFaqMarkdown} from './faq.js';
import {number, percent, reportLinkText} from './format.js';
import {classifyKind, classifyOutcome, filterByKind, isComputationalAssessed, isRobustnessAssessed, outcomeLabel, parseReproductionOutcome, reportKindLabel} from './outcomes.js';
import {matchesBrowseQuery} from './search.js';
import {token} from './theme.js';
import {FloraVocabulary} from './vocabulary.js';

// Read-only window on live state, for the browser console and the acceptance tests.
const getters = {};
const CALLED = new Set(['getChartData', 'trendsFilteredData']);
export function setHook(name, getter) {
    if (!(name in getters)) Object.defineProperty(window, name, {configurable: true, get: () => CALLED.has(name) ? getters[name] : getters[name]()});
    getters[name] = getter;
}

export function installHooks() {
    Object.assign(window, {
        currentTheme: () => document.documentElement.getAttribute('data-theme') || 'light',
        Chart, Papa, loadPlotly, renderInlineMd, parseFaqMarkdown, matchesBrowseQuery,
        classifyKind, classifyOutcome, filterByKind, isComputationalAssessed, isRobustnessAssessed, parseReproductionOutcome, reportKindLabel,
        FloraCharts: {number, percent, token, download, reportLinkText},
        FloraVocabulary: {...FloraVocabulary, outcomeLabel},
    });
    // Defined before any view mounts, so early readers poll instead of throwing.
    for (const name of CALLED) setHook(name, () => []);
    for (const name of ['fullRowData', 'bmFiltered']) setHook(name, () => []);
    for (const name of ['floraBrowse', 'browseQuery', 'browseKind', '_mcData', '_aoData', '_rrData', '_pubData']) setHook(name, () => undefined);
}
