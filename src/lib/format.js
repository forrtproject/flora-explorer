export function truncateText(text, maxLength = 60) {
    if (!text) return '-';
    return text.length > maxLength ? text.substring(0, maxLength) + '…' : text;
}

export function safeHref(value) {
    try { const u = new URL(String(value || '')); return ['http:', 'https:'].includes(u.protocol) ? u.href : ''; }
    catch { return ''; }
}

export const cleanDoi = doi => String(doi).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '');
export function doiHref(doi) {
    const clean = cleanDoi(doi);
    return /^10\.\d{4,9}\//.test(clean) ? 'https://doi.org/' + encodeURI(clean) : safeHref(doi);
}

export function authorList(authorData) {
    if (!authorData) return '-';
    try {
        const authors = JSON.parse(authorData);
        if (Array.isArray(authors)) return authors.map(a => {
            if (typeof a === 'string') return a;
            if (a.family && a.given) return `${a.given} ${a.family}`;
            if (a.name) return a.name;
            if (a.family) return a.family;
            return JSON.stringify(a);
        }).join(', ');
        return authorData;
    } catch { return authorData; }
}

export function shortAuthors(authorData) {
    if (!authorData) return '';
    try {
        const authors = JSON.parse(authorData);
        if (Array.isArray(authors) && authors.length > 0) {
            const nameOf = a => typeof a === 'string' ? a : (a.family || a.name || '');
            if (authors.length === 1) return nameOf(authors[0]);
            if (authors.length === 2) return `${nameOf(authors[0])} & ${nameOf(authors[1])}`;
            return `${nameOf(authors[0])} et al.`;
        }
    } catch {
        const short = authorData.split(/[,;]/)[0].trim();
        return short.length > 40 ? short.substring(0, 40) + '…' : short;
    }
    return '';
}

// Citation snapshot authors: "Family, I." joined by semicolons, truncated after max.
export function citationAuthors(raw, max = 3) {
    if (!raw) return '';
    if (typeof raw !== 'string') { try { raw = JSON.stringify(raw); } catch { return ''; } }
    const s = raw.trim(); if (!s) return '';
    if (!s.startsWith('[') && !s.includes('"family"') && !s.includes("'family'")) return s.slice(0, 200);
    let parsed = null;
    try { parsed = JSON.parse(s.replace(/'/g, '"')); } catch { /* fall through to regex extraction */ }
    let names = [];
    if (Array.isArray(parsed)) names = parsed.map(a => a && typeof a === 'object' ? formatOne(a.family || a.last || '', a.given || a.first || '') : '').filter(Boolean);
    else {
        const re = /"given"\s*:\s*"([^"]*)"[^}]*?"family"\s*:\s*"([^"]*)"|"family"\s*:\s*"([^"]*)"[^}]*?"given"\s*:\s*"([^"]*)"|"family"\s*:\s*"([^"]*)"/g;
        let m;
        while ((m = re.exec(s)) !== null) {
            const name = formatOne(m[2] || m[3] || m[5] || '', m[1] || m[4] || '');
            if (name) names.push(name);
        }
    }
    if (names.length === 0) return s.slice(0, 200);
    if (names.length <= max) return names.join('; ');
    return names.slice(0, max).join('; ') + `, … (+${names.length - max})`;
}
function formatOne(family, given) {
    family = (family || '').trim(); given = (given || '').trim();
    if (!family) return '';
    const initials = given.split(/\s+/).map(p => (p && p[0] ? p[0].toUpperCase() + '.' : '')).join(' ').trim();
    return initials ? `${family}, ${initials}` : family;
}

export function wrapLabel(str, maxChars = 36) {
    if (!str) return '';
    if (str.length <= maxChars) return str;
    const lines = []; let line = '';
    for (const w of String(str).split(/\s+/)) {
        if (!line) { line = w; continue; }
        if ((line + ' ' + w).length <= maxChars) line += ' ' + w;
        else { lines.push(line); line = w; }
    }
    if (line) lines.push(line);
    return lines;
}
