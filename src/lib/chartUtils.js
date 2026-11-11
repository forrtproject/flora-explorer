export const plain = s => (Array.isArray(s) ? s.join(' ') : String(s ?? '')).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
export const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

export const number = (v, digits = 0) => Number(v).toLocaleString('en-GB', {minimumFractionDigits: digits, maximumFractionDigits: digits}).replace(/-/g, '−');

// Integer formatting alone rounds fractional auto-ticks into repeated labels.
export const countAxis = max => ({tickformat: ',d', dtick: max <= 10 ? 1 : undefined});

export const percent = (n, total, digits = 0) => {
    const share = total > 0 ? 100 * (n || 0) / total : 0;
    return share > 0 && share < 1 ? '<1' : number(share, digits);
};

export const formatCell = (v, header = '') => typeof v === 'number'
    ? v.toLocaleString('en-GB', {useGrouping: !/year|X \/ category/i.test(header), maximumFractionDigits: 5}).replace(/-/g, '−')
    : plain(v);

export const token = (name, fallback = '') => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

export function theme() {
    return {
        paper: token('--color-surface-raised', '#fff'), plot: token('--color-surface-raised', '#fff'),
        grid: token('--color-border-light', '#e0e1e1'), font: token('--color-text', '#2c2c2c'),
        tick: token('--color-text-secondary', '#4a4a4a'), muted: token('--color-muted-fg', '#6b7280'),
        primary: token('--color-primary', '#853953'), band: token('--color-plot-band'),
        point: token('--color-plot-point'), rule: token('--color-plot-rule'), ruleLabel: token('--color-plot-rule-label'),
        fontFamily: token('--font-body', 'sans-serif'),
    };
}

export function csvText(headers, rows, notes = '') {
    // Prefix formula-like text so spreadsheet programs treat it as data.
    const cell = v => '"' + (typeof v === 'number' ? String(Number(v.toFixed(5))) : (Array.isArray(v) ? plain(v) : String(v ?? '')).replace(/^[=+@-]/, m => "'" + m)).replace(/"/g, '""') + '"';
    return [notes ? ['Export context', ...headers] : headers, ...rows.map(row => notes ? [notes, ...row] : row)]
        .map(row => row.map(cell).join(',')).join('\r\n');
}

export function download(name, headers, rows, notes = '') {
    const link = document.createElement('a');
    const url = URL.createObjectURL(new Blob(['﻿' + csvText(headers, rows, notes)], {type: 'text/csv;charset=utf-8'}));
    link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
