import {FloraVocabulary} from './vocabulary.js';
import {token} from './theme.js';

export const classifyOutcome = raw => FloraVocabulary.classify(raw);
export const parseReproductionOutcome = raw => FloraVocabulary.reproduction(raw);

export function classifyKind(row) {
    const t = (row.type || '').toLowerCase();
    if (t.includes('reproduc')) return 'reproduction';
    if (t.includes('replic')) return 'replication';
    const o = (row.outcome || '').toLowerCase();
    if (o.includes('computational') || o.includes('robust')) return 'reproduction';
    if (o && !FloraVocabulary.isMissing(o)) return 'replication';
    return 'unknown';
}
export const reportKindLabel = row => ({replication: 'Replication', reproduction: 'Reproduction'}[classifyKind(row)] || 'Linked');

// A reproduction counts toward a dimension only when it carries a verdict there.
export function isComputationalAssessed(row) {
    if (classifyKind(row) !== 'reproduction') return false;
    return ['successful', 'issues', 'technical_failure'].includes(parseReproductionOutcome(row.outcome).computational);
}
export function isRobustnessAssessed(row) {
    if (classifyKind(row) !== 'reproduction') return false;
    return ['robust', 'challenges'].includes(parseReproductionOutcome(row.outcome).robustness);
}

export function filterByKind(data, kind) {
    if (!kind || kind === 'all') return data;
    if (kind === 'replication' || kind === 'reproduction') return data.filter(r => classifyKind(r) === kind);
    if (kind === 'reproduction-numerical') return data.filter(isComputationalAssessed);
    if (kind === 'reproduction-robustness') return data.filter(isRobustnessAssessed);
    return data;
}

export const kindDimension = kind => kind === 'reproduction-numerical' ? 'computational' : kind === 'reproduction-robustness' ? 'robustness' : 'replication';

// Replications keep every category; reproduction dimensions keep assessed verdicts only.
export function outcomeBuckets(kind) {
    const dimension = kindDimension(kind);
    return FloraVocabulary.entries(dimension).filter(entry => dimension === 'replication' || entry.assessed)
        .map(entry => ({key: entry.key, label: entry.label, color: token('--color-chart-' + entry.color)}));
}

export function bucketKeyForRow(row, kind) {
    if (kind === 'reproduction-numerical') return parseReproductionOutcome(row.outcome).computational || 'not_coded';
    if (kind === 'reproduction-robustness') return parseReproductionOutcome(row.outcome).robustness || 'not_coded';
    return classifyOutcome(row.outcome);
}

export function outcomeLabel(row) {
    if (classifyKind(row) !== 'reproduction') return FloraVocabulary.label(classifyOutcome(row.outcome));
    const d = parseReproductionOutcome(row.outcome);
    return `Computational: ${FloraVocabulary.label(d.computational, 'computational')}; Robustness: ${FloraVocabulary.label(d.robustness, 'robustness')}`;
}

export const studyTypeLabel = kind => FloraVocabulary.studyType(kind).toLowerCase();
