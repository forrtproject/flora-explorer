import {FloraVocabulary} from './vocabulary.js';
import {token} from './theme.js';

export const classifyOutcome = raw => FloraVocabulary.classify(raw);
// Each study type has its own verdict columns; the combined `outcome` is not classified.
export const replicationOutcome = row => FloraVocabulary.classify(row.outcome_replication);
export const parseReproductionOutcome = row => ({
    computational: FloraVocabulary.classify(row.outcome_computation, 'computational'),
    robustness: FloraVocabulary.classify(row.outcome_robustness, 'robustness'),
});

export function classifyKind(row) {
    const t = (row.type || '').toLowerCase();
    if (t.includes('reproduc')) return 'reproduction';
    if (t.includes('replic')) return 'replication';
    const recorded = value => value && !FloraVocabulary.isMissing(value);
    if (recorded(row.outcome_computation) || recorded(row.outcome_robustness)) return 'reproduction';
    if (recorded(row.outcome_replication)) return 'replication';
    return 'unknown';
}
export const reportKindLabel = row => ({replication: 'Replication', reproduction: 'Reproduction'}[classifyKind(row)] || 'Linked');

// The verdicts as recorded, for search and sorting.
export const sourceOutcome = row => classifyKind(row) === 'reproduction'
    ? [row.outcome_computation, row.outcome_robustness].map(v => String(v ?? '').trim()).filter(Boolean).join(', ')
    : String(row.outcome_replication ?? '').trim();

// A reproduction counts toward a dimension only when it carries a verdict there.
export function isComputationalAssessed(row) {
    if (classifyKind(row) !== 'reproduction') return false;
    return ['successful', 'issues', 'technical_failure'].includes(parseReproductionOutcome(row).computational);
}
export function isRobustnessAssessed(row) {
    if (classifyKind(row) !== 'reproduction') return false;
    return ['robust', 'challenges'].includes(parseReproductionOutcome(row).robustness);
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
// "All" stacks by study type: the two outcome vocabularies cannot share a bar.
export function outcomeBuckets(kind) {
    if (kind === 'all') return [
        {key: 'replication', label: 'Replication', color: token('--color-primary')},
        {key: 'reproduction', label: 'Reproduction', color: token('--color-link')},
        {key: 'unknown', label: 'Study type not recorded', color: token('--color-chart-not-coded')},
    ];
    const dimension = kindDimension(kind);
    return FloraVocabulary.entries(dimension).filter(entry => dimension === 'replication' || entry.assessed)
        .map(entry => ({key: entry.key, label: entry.label, color: token('--color-chart-' + entry.color)}));
}

export function bucketKeyForRow(row, kind) {
    if (kind === 'all') return classifyKind(row);
    if (kind === 'reproduction-numerical') return parseReproductionOutcome(row).computational || 'not_coded';
    if (kind === 'reproduction-robustness') return parseReproductionOutcome(row).robustness || 'not_coded';
    return replicationOutcome(row);
}

export function outcomeLabel(row) {
    if (classifyKind(row) !== 'reproduction') return FloraVocabulary.label(replicationOutcome(row));
    const d = parseReproductionOutcome(row);
    return `Computational: ${FloraVocabulary.label(d.computational, 'computational')}; Robustness: ${FloraVocabulary.label(d.robustness, 'robustness')}`;
}

export const studyTypeLabel = kind => FloraVocabulary.studyType(kind).toLowerCase();
export const kindNoun = kind => (kind === 'replication' ? 'replication' : 'reproduction') + ' reference pairs';
export const kindPairCount = (rows, kind) => rows.filter(r => classifyKind(r) === (kind === 'replication' ? 'replication' : 'reproduction')).length;
