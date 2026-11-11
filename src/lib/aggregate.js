import {classifyKind, classifyOutcome, parseReproductionOutcome, studyTypeOutcomeBuckets, outcomeBucketKeyForRow, REPRODUCTION_COLORS} from './outcomes.js';
import {percent} from './chartUtils.js';

// {datasets, total} for one outcome dimension: replicability, computational or robustness.
export function computeKindChartData(data, kind) {
    if (kind === 'replicability') {
        const eligible = data.filter(r => classifyKind(r) === 'replication');
        const buckets = studyTypeOutcomeBuckets('replication');
        const counts = Object.fromEntries(buckets.map(b => [b.key, 0]));
        eligible.forEach(row => counts[classifyOutcome(row.outcome)]++);
        return {total: eligible.length, datasets: buckets.map(b => ({label: b.label, data: [counts[b.key]], backgroundColor: b.color}))};
    }
    const repro = data.filter(r => classifyKind(r) === 'reproduction');
    if (kind === 'computational') {
        const counts = {successful: 0, issues: 0, technical_failure: 0};
        repro.forEach(r => { const c = parseReproductionOutcome(r.outcome).computational; if (counts[c] !== undefined) counts[c]++; });
        return {
            total: counts.successful + counts.issues + counts.technical_failure,
            datasets: [
                {label: 'Successful', data: [counts.successful], backgroundColor: REPRODUCTION_COLORS.successful},
                {label: 'Computational issues', data: [counts.issues], backgroundColor: REPRODUCTION_COLORS.issues},
                {label: 'Technical failure', data: [counts.technical_failure], backgroundColor: REPRODUCTION_COLORS.technical_failure},
            ],
        };
    }
    const counts = {robust: 0, challenges: 0};
    repro.forEach(r => { const rb = parseReproductionOutcome(r.outcome).robustness; if (counts[rb] !== undefined) counts[rb]++; });
    return {
        total: counts.robust + counts.challenges,
        datasets: [
            {label: 'Robust', data: [counts.robust], backgroundColor: REPRODUCTION_COLORS.robust},
            {label: 'Robustness challenges', data: [counts.challenges], backgroundColor: REPRODUCTION_COLORS.challenges},
        ],
    };
}

export function kindChartCaption(data, kind) {
    const {datasets, total} = computeKindChartData(data, kind);
    const counts = datasets.map(d => `${d.label} ${d.data[0].toLocaleString()} (${percent(d.data[0], total)}%)`).join(' · ');
    if (kind === 'replicability') return `${total.toLocaleString()} replication ${total === 1 ? 'pair' : 'pairs'}: ${counts}.`;
    const eligible = data.filter(r => classifyKind(r) === 'reproduction').length;
    const dimension = kind === 'computational' ? 'a computational verdict' : 'a robustness verdict';
    const scope = total === eligible
        ? `${total.toLocaleString()} reproduction ${total === 1 ? 'pair has' : 'pairs have'} ${dimension}`
        : `${total.toLocaleString()} of ${eligible.toLocaleString()} reproduction pairs have ${dimension}; ${(eligible - total).toLocaleString()} not checked or not coded`;
    return `${scope}. ${total ? counts + '. ' : ''}A reference pair can contribute to both dimensions.`;
}

function aggregateStackedCounts(data, keyFn, kind) {
    const buckets = studyTypeOutcomeBuckets(kind);
    const groups = new Map();
    data.forEach(row => {
        const k = keyFn(row);
        if (k === null || k === undefined || k === '') return;
        if (!groups.has(k)) groups.set(k, {key: k, counts: Object.fromEntries(buckets.map(b => [b.key, 0])), total: 0});
        const g = groups.get(k);
        const bucketKey = outcomeBucketKeyForRow(row, kind);
        if (g.counts[bucketKey] !== undefined) g.counts[bucketKey]++;
        g.total++;
    });
    return Array.from(groups.values());
}

// Sparse early years (16 replication pairs across 1880–1959) pool into one leading column.
export const TREND_POOL_BEFORE = 1960;

// Every calendar year between the first and last observation gets a slot, so gaps keep their scale.
export function aggregateByYear(data, yearField, kind, poolBefore = null) {
    const yearKey = row => {
        const match = String(row[yearField] || '').match(/\d{4}/); if (!match) return null;
        const y = parseInt(match[0], 10);
        return !y || y < 1800 || y > 2100 ? null : String(y);
    };
    const out = aggregateStackedCounts(data, yearKey, kind);
    if (!out.length) return out;
    const buckets = studyTypeOutcomeBuckets(kind);
    const empty = key => ({key, counts: Object.fromEntries(buckets.map(b => [b.key, 0])), total: 0});
    const byYear = new Map(out.map(g => [parseInt(g.key, 10), g]));
    const years = [...byYear.keys()];
    let start = Math.min(...years);
    const filled = [];
    if (poolBefore && start < poolBefore) {
        const pooled = {...empty(`Before ${poolBefore}`), pooled: true};
        for (const [y, g] of byYear) if (y < poolBefore) {
            buckets.forEach(b => { pooled.counts[b.key] += g.counts[b.key]; });
            pooled.total += g.total;
        }
        filled.push(pooled);
        start = poolBefore;
    }
    for (let y = start; y <= Math.max(...years); y++) filled.push(byYear.get(y) || empty(String(y)));
    return filled;
}

export function aggregateByJournal(data, field, topN, kind) {
    const out = aggregateStackedCounts(data, row => (row[field] || '').trim() || null, kind);
    out.sort((a, b) => b.total - a.total);
    return out.slice(0, topN);
}

export function aggregateByField(data, kind, disciplineForJournal) {
    const out = aggregateStackedCounts(data, row => disciplineForJournal(row.journal_o), kind);
    const mapped = out.filter(e => e.key !== 'Uncategorized').sort((a, b) => b.total - a.total);
    return [...mapped, ...out.filter(e => e.key === 'Uncategorized')];
}
