import {token} from './chartUtils.js';

const chartToken = key => token('--color-chart-' + key);

// Getters resolve CSS tokens at render time so charts follow the theme.
export const OUTCOME_COLORS = {
    get successful() { return chartToken('successful'); },
    get failed() { return chartToken('failed'); },
    get mixed() { return chartToken('mixed'); },
    get inconclusive() { return chartToken('inconclusive'); },
    get qualified() { return chartToken('qualified'); },
    get other() { return chartToken('other'); },
};

export const REPRODUCTION_COLORS = {
    get successful() { return chartToken('successful'); },
    get issues() { return chartToken('failed'); },
    get technical_failure() { return chartToken('technical-failure'); },
    get robust() { return chartToken('successful'); },
    get challenges() { return chartToken('failed'); },
    get not_checked() { return chartToken('not-checked'); },
    get not_coded() { return chartToken('not-coded'); },
};

export function classifyOutcome(raw) {
    return ({successful: 'successful', replicated: 'successful', failed: 'failed',
        'not replicated': 'failed', mixed: 'mixed', partial: 'mixed', inconclusive: 'inconclusive',
        'statistically successful but flawed': 'qualified'})[String(raw || '').trim().toLowerCase()] || 'other';
}

export function classifyKind(row) {
    const t = (row.type || '').toLowerCase();
    if (t.includes('reproduc')) return 'reproduction';
    if (t.includes('replic')) return 'replication';
    const o = (row.outcome || '').toLowerCase();
    if (o.includes('computational') || o.includes('robust')) return 'reproduction';
    if (o) return 'replication';
    return 'unknown';
}

export const reportKindLabel = row => ({replication: 'Replication', reproduction: 'Reproduction'}[classifyKind(row)] || 'Linked');

// The compound "computational, robustness" string is parsed positionally so neither
// dimension's keywords can match the other's text. Uncoded dimensions are null.
export function parseReproductionOutcome(raw) {
    const parts = String(raw || '').toLowerCase().split(',').map(s => s.trim());
    const computational = {'computationally reproducible': 'successful', 'computationally successful': 'successful',
        'computational issues': 'issues', 'technical failure': 'technical_failure', failed: 'technical_failure', 'not checked': 'not_checked'};
    const robustness = {robust: 'robust', 'robustness challenges': 'challenges', 'not checked': 'not_checked', 'robustness not checked': 'not_checked'};
    return {computational: computational[parts[0]] || null, robustness: robustness[parts[1]] || null};
}

export function isComputationalAssessed(row) {
    if (classifyKind(row) !== 'reproduction') return false;
    const {computational} = parseReproductionOutcome(row.outcome);
    return computational === 'successful' || computational === 'issues' || computational === 'technical_failure';
}

export function isRobustnessAssessed(row) {
    if (classifyKind(row) !== 'reproduction') return false;
    const {robustness} = parseReproductionOutcome(row.outcome);
    return robustness === 'robust' || robustness === 'challenges';
}

export function filterByKind(data, kind) {
    if (!kind || kind === 'all') return data;
    if (kind === 'replication') return data.filter(r => classifyKind(r) === 'replication');
    if (kind === 'reproduction') return data.filter(r => classifyKind(r) === 'reproduction');
    if (kind === 'reproduction-numerical') return data.filter(isComputationalAssessed);
    if (kind === 'reproduction-robustness') return data.filter(isRobustnessAssessed);
    return data;
}

export function studyTypeOutcomeBuckets(kind) {
    if (kind === 'reproduction-numerical') return [
        {key: 'successful', label: 'Successful', color: REPRODUCTION_COLORS.successful},
        {key: 'issues', label: 'Computational issues', color: REPRODUCTION_COLORS.issues},
        {key: 'technical_failure', label: 'Technical failure', color: REPRODUCTION_COLORS.technical_failure},
    ];
    if (kind === 'reproduction-robustness') return [
        {key: 'robust', label: 'Robust', color: REPRODUCTION_COLORS.robust},
        {key: 'challenges', label: 'Robustness challenges', color: REPRODUCTION_COLORS.challenges},
    ];
    return [
        {key: 'successful', label: 'Successful', color: OUTCOME_COLORS.successful},
        {key: 'failed', label: 'Failed', color: OUTCOME_COLORS.failed},
        {key: 'mixed', label: 'Mixed', color: OUTCOME_COLORS.mixed},
        {key: 'inconclusive', label: 'Inconclusive', color: OUTCOME_COLORS.inconclusive},
        {key: 'qualified', label: 'Successful but flawed', color: OUTCOME_COLORS.qualified},
        {key: 'other', label: 'Other / not coded', color: OUTCOME_COLORS.other},
    ];
}

export function outcomeBucketKeyForRow(row, kind) {
    if (kind === 'reproduction-numerical') return parseReproductionOutcome(row.outcome).computational || 'not_coded';
    if (kind === 'reproduction-robustness') return parseReproductionOutcome(row.outcome).robustness || 'not_coded';
    return classifyOutcome(row.outcome);
}

export const STUDY_TYPES = ['replication', 'reproduction-numerical', 'reproduction-robustness'];
export const STUDY_TYPE_CHIPS = [
    {value: 'replication', label: 'Replications'},
    {value: 'reproduction-numerical', label: 'Numerical Reproductions'},
    {value: 'reproduction-robustness', label: 'Robustness Reproductions'},
];

// Copy with replication/numerical/robustness variants, indexed by study type.
const KIND_TEXT_INDEX = {replication: 0, 'reproduction-numerical': 1, 'reproduction-robustness': 2};
export const kindText = (kind, ...variants) => variants[KIND_TEXT_INDEX[kind] ?? 0] ?? variants[0];

export function studyTypeLabel(kind) {
    if (kind === 'reproduction-numerical') return 'numerical reproductions';
    if (kind === 'reproduction-robustness') return 'robustness reproductions';
    return 'replications';
}

export const BROWSE_KIND_LABELS = {all: 'All studies', replication: 'Replications', reproduction: 'Reproductions', 'reproduction-numerical': 'Numerical Reproductions', 'reproduction-robustness': 'Robustness Reproductions'};
export const BROWSE_KIND_NOUNS = {all: 'reference pairs', replication: 'replications', reproduction: 'reproductions', 'reproduction-numerical': 'numerical reproductions', 'reproduction-robustness': 'robustness reproductions'};
export const normalizeBrowseKind = kind => Object.hasOwn(BROWSE_KIND_LABELS, kind) ? kind : 'all';
export const KIND_FILTER_BUTTONS = [
    {kind: 'all', label: 'All studies'},
    {kind: 'replication', label: 'Replications only'},
    {kind: 'reproduction-numerical', label: 'Numerical Reproductions'},
    {kind: 'reproduction-robustness', label: 'Robustness Reproductions'},
];
