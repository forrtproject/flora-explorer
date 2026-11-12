export const number = (v, digits = 0) => Number(v).toLocaleString('en-GB', {minimumFractionDigits: digits, maximumFractionDigits: digits}).replace(/-/g, '−');
export const percent = (n, total, digits = 0) => {
    const share = total > 0 ? 100 * (n || 0) / total : 0;
    return share > 0 && share < 1 ? '<1' : number(share, digits);
};
// Integer formatting alone rounds fractional auto-ticks into repeated labels.
export const countAxis = max => ({tickformat: ',d', dtick: max <= 10 ? 1 : undefined});
export const pairs = n => `reference ${n === 1 ? 'pair' : 'pairs'}`;

export const truncate = (text, max = 60) => !text ? '-' : text.length > max ? text.substring(0, max) + '…' : text;

export function safeHref(value) {
    try { const u = new URL(String(value || '')); return ['http:', 'https:'].includes(u.protocol) ? u.href : ''; }
    catch { return ''; }
}
export const cleanDoi = doi => String(doi || '').replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '');
export function doiHref(doi) {
    const clean = cleanDoi(doi);
    return /^10\.\d{4,9}\//.test(clean) ? 'https://doi.org/' + encodeURI(clean) : safeHref(doi);
}
export const stripScheme = url => String(url).replace(/^https?:\/\/(www\.)?/i, '');
export const reportLinkText = (url, doi) => safeHref(url) ? stripScheme(url) : doi ? cleanDoi(doi) : '';
export const pairHref = (doi, url) => doi ? safeHref(String(doi).startsWith('http') ? doi : 'https://doi.org/' + encodeURI(doi)) : safeHref(url);

function parseAuthors(raw) {
    try { const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw; return Array.isArray(parsed) ? parsed : null; }
    catch { return null; }
}
export function fullAuthors(raw) {
    if (!raw) return '-';
    const authors = parseAuthors(raw);
    if (!authors) return String(raw);
    return authors.map(a => typeof a === 'string' ? a : a.family && a.given ? `${a.given} ${a.family}` : a.name || a.family || JSON.stringify(a)).join(', ');
}
export function shortAuthors(raw) {
    if (!raw) return '';
    const authors = parseAuthors(raw);
    if (!authors) { const short = String(raw).split(/[,;]/)[0].trim(); return short.length > 40 ? short.substring(0, 40) + '…' : short; }
    if (!authors.length) return '';
    const name = a => typeof a === 'string' ? a : a.family || a.name || '';
    if (authors.length === 1) return name(authors[0]);
    if (authors.length === 2) return `${name(authors[0])} & ${name(authors[1])}`;
    return `${name(authors[0])} et al.`;
}
export const authorYear = (raw, year) => [shortAuthors(raw), year ? `(${year})` : ''].filter(Boolean).join(' ');

// Citation snapshot authors arrive as "Family, G.; …" strings or as serialised name objects.
export function citationAuthors(raw, max = 3) {
    if (!raw) return '';
    if (typeof raw !== 'string') { try { raw = JSON.stringify(raw); } catch { return ''; } }
    const s = raw.trim(); if (!s) return '';
    if (!s.startsWith('[') && !s.includes('"family"') && !s.includes("'family'")) return s.slice(0, 200);
    const one = (family, given) => {
        family = (family || '').trim(); given = (given || '').trim();
        if (!family) return '';
        const initials = given.split(/\s+/).map(p => p && p[0] ? p[0].toUpperCase() + '.' : '').join(' ').trim();
        return initials ? `${family}, ${initials}` : family;
    };
    let parsed = null;
    try { parsed = JSON.parse(s.replace(/'/g, '"')); } catch { /* fall through to the pattern scan */ }
    let names = [];
    if (Array.isArray(parsed)) names = parsed.map(a => a && typeof a === 'object' ? one(a.family || a.last, a.given || a.first) : '').filter(Boolean);
    else {
        const re = /"given"\s*:\s*"([^"]*)"[^}]*?"family"\s*:\s*"([^"]*)"|"family"\s*:\s*"([^"]*)"[^}]*?"given"\s*:\s*"([^"]*)"|"family"\s*:\s*"([^"]*)"/g;
        let m;
        while ((m = re.exec(s)) !== null) { const name = one(m[2] || m[3] || m[5], m[1] || m[4]); if (name) names.push(name); }
    }
    if (!names.length) return s.slice(0, 200);
    return names.length <= max ? names.join('; ') : names.slice(0, max).join('; ') + `, … (+${names.length - max})`;
}

export function wrapLabel(str, maxChars = 36) {
    if (!str) return '';
    if (str.length <= maxChars) return str;
    const lines = []; let line = '';
    for (const w of String(str).split(/\s+/)) {
        if (!line) line = w;
        else if ((line + ' ' + w).length <= maxChars) line += ' ' + w;
        else { lines.push(line); line = w; }
    }
    if (line) lines.push(line);
    return lines;
}
