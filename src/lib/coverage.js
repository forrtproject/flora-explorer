import {normalizeDoi} from './search.js';

const fmt = v => v.toLocaleString('en-GB');
export const nPairs = n => `${fmt(n)} reference ${n === 1 ? 'pair' : 'pairs'}`;

const normalizeTitle = title => String(title || '').normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
// Must match report_key() in scripts/compute_rr_status.py.
export function reportKey(row) {
    const doi = normalizeDoi(row.doi_r);
    if (doi) return 'doi:' + doi;
    const url = String(row.url_r || '').trim().toLowerCase();
    if (url) return 'url:' + url;
    const title = normalizeTitle(row.title_r);
    return title ? 'title:' + title : '';
}
export function distinctReportCounts(rows) {
    return {
        originals: new Set(rows.map(r => normalizeDoi(r.doi_o)).filter(Boolean)).size,
        noOriginalDoi: rows.filter(r => !normalizeDoi(r.doi_o)).length,
        reports: new Set(rows.map(reportKey).filter(Boolean)).size,
    };
}

// reasons: [[count, 'without …'], …]. M never drops below N plus the stated exclusions;
// with a kind, pairs of that type left unexplained get a generic reason.
export function coverageText(n, m, reasons = [], noun = 'reference pairs', kind = null) {
    const listed = reasons.filter(([k]) => k > 0);
    const stated = listed.reduce((sum, [k]) => sum + k, 0);
    const total = Math.max(m || 0, n + stated);
    if (kind && total - n - stated > 0) listed.push([total - n - stated, kind === 'replication' ? 'not in this analysis snapshot' : 'without a verdict on this dimension']);
    const counted = total === 1 ? noun.replace(/\b(pairs|originals|works)\b/, w => w.slice(0, -1)) : noun;
    return `Included in the plot: ${fmt(n)} of ${fmt(total)} ${counted}; ` +
        (listed.length ? `excluded: ${listed.map(([k, why]) => `${fmt(k)} ${why}`).join(', ')}.` : 'none excluded.');
}
