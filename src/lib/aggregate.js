import {bucketKeyForRow, classifyKind, classifyOutcome, outcomeBuckets, parseReproductionOutcome} from './outcomes.js';
import {percent} from './format.js';

const KIND_FOR_DIMENSION = {replicability: 'replication', computational: 'reproduction-numerical', robustness: 'reproduction-robustness'};

// Datasets for one outcome dimension: replications only, or one of the two reproduction dimensions.
export function dimensionChartData(data, dimension) {
    const replication = dimension === 'replicability';
    const eligible = data.filter(row => classifyKind(row) === (replication ? 'replication' : 'reproduction'));
    const buckets = outcomeBuckets(KIND_FOR_DIMENSION[dimension]);
    const counts = Object.fromEntries(buckets.map(b => [b.key, 0]));
    for (const row of eligible) {
        const key = replication ? classifyOutcome(row.outcome) : parseReproductionOutcome(row.outcome)[dimension];
        if (counts[key] !== undefined) counts[key]++;
    }
    return {
        eligible: eligible.length,
        total: Object.values(counts).reduce((sum, n) => sum + n, 0),
        datasets: buckets.map(b => ({label: b.label, data: [counts[b.key]], backgroundColor: b.color})),
    };
}

// States the denominator, exclusions and counts so readers need not open the data table.
export function dimensionCaption(data, dimension) {
    const {datasets, total, eligible} = dimensionChartData(data, dimension);
    const counts = datasets.map(d => `${d.label} ${d.data[0].toLocaleString()} (${percent(d.data[0], total)}%)`).join(' · ');
    if (dimension === 'replicability') return `${total.toLocaleString()} replication reference ${total === 1 ? 'pair' : 'pairs'}: ${counts}.`;
    const verdict = dimension === 'computational' ? 'a computational verdict' : 'a robustness verdict';
    const scope = total === eligible
        ? `${total.toLocaleString()} reproduction reference ${total === 1 ? 'pair has' : 'pairs have'} ${verdict}`
        : `${total.toLocaleString()} of ${eligible.toLocaleString()} reproduction reference pairs have ${verdict}; ${(eligible - total).toLocaleString()} not checked or not coded`;
    return `${scope}. ${total ? counts + '. ' : ''}A reference pair can contribute to both dimensions.`;
}

function stackedCounts(data, keyFn, kind) {
    const buckets = outcomeBuckets(kind);
    const groups = new Map();
    for (const row of data) {
        const key = keyFn(row);
        if (key === null || key === undefined || key === '') continue;
        if (!groups.has(key)) groups.set(key, {key, counts: Object.fromEntries(buckets.map(b => [b.key, 0])), total: 0});
        const group = groups.get(key);
        const bucket = bucketKeyForRow(row, kind);
        if (group.counts[bucket] !== undefined) group.counts[bucket]++;
        group.total++;
    }
    return [...groups.values()];
}

export const yearOf = raw => {
    const match = String(raw || '').match(/\d{4}/);
    const y = match ? parseInt(match[0], 10) : 0;
    return y >= 1800 && y <= 2100 ? y : null;
};

// Records before this year are sparse, so they pool into one leading column.
export const POOL_BEFORE = 1960;

// Every calendar year between the first and last observation gets a slot, so gaps keep their scale.
export function byYear(data, field, kind, poolBefore = null) {
    const out = stackedCounts(data, row => { const y = yearOf(row[field]); return y ? String(y) : null; }, kind);
    if (!out.length) return out;
    const buckets = outcomeBuckets(kind);
    const empty = key => ({key, counts: Object.fromEntries(buckets.map(b => [b.key, 0])), total: 0});
    const years = new Map(out.map(g => [parseInt(g.key, 10), g]));
    let start = Math.min(...years.keys());
    const filled = [];
    if (poolBefore && start < poolBefore) {
        const pooled = {...empty(`Before ${poolBefore}`), pooled: true};
        for (const [y, g] of years) if (y < poolBefore) {
            for (const b of buckets) pooled.counts[b.key] += g.counts[b.key];
            pooled.total += g.total;
        }
        filled.push(pooled);
        start = poolBefore;
    }
    for (let y = start; y <= Math.max(...years.keys()); y++) filled.push(years.get(y) || empty(String(y)));
    return filled;
}

export function byJournal(data, field, topN, kind) {
    return stackedCounts(data, row => (row[field] || '').trim() || null, kind).sort((a, b) => b.total - a.total).slice(0, topN);
}

export function byField(data, kind, disciplineFor) {
    const out = stackedCounts(data, row => disciplineFor(row.journal_o), kind);
    return [...out.filter(e => e.key !== 'Uncategorized').sort((a, b) => b.total - a.total), ...out.filter(e => e.key === 'Uncategorized')];
}
