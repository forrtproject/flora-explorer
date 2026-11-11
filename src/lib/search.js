export function normalizedQuery(query) {
    return String(query || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
        .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
        .replace(/https?:\/\/(?:dx\.)?doi\.org\//g, '').replace(/\bdoi:\s*/g, '').replace(/\s+/g, ' ').trim();
}

// Search all names, without indexing Crossref keys, ORCIDs or affiliations.
export function searchAuthorNames(raw) {
    if (!raw) return '';
    try {
        const authors = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const name = a => typeof a === 'string' ? a : a && (a.name || [a.given, a.family].filter(Boolean).join(' ')) || '';
        return (Array.isArray(authors) ? authors : [authors]).map(name).join(', ');
    } catch { return String(raw); }
}

let lastQuery, lastTokens = [];
export function searchTokens(query) {
    if (query !== lastQuery) {
        lastQuery = query;
        lastTokens = (normalizedQuery(query).match(/"[^"\n]+"|\S+/g) || []).map(t => t.replace(/^"|"$/g, ''));
    }
    return lastTokens;
}

export const matchesSearchTokens = (text, tokens) => tokens.every(t => text.includes(t));

const browseText = new WeakMap();
// Quotations stay searchable; raw outcome values and non-DOI URLs are omitted.
export function browseSearchableText(row) {
    if (!browseText.has(row)) {
        const urlDoi = /^https?:\/\/(?:dx\.)?doi\.org\//i.test(row.url_r || '') ? row.url_r : '';
        browseText.set(row, normalizedQuery([row.title_o, searchAuthorNames(row.author_o), row.journal_o, row.year_o, row.doi_o,
            row.title_r, searchAuthorNames(row.author_r), row.journal_r, row.year_r, row.doi_r, urlDoi,
            row.outcome_quote, row.type].filter(Boolean).join(' | ')));
    }
    return browseText.get(row);
}

export function matchesBrowseQuery(row, query) {
    const tokens = searchTokens(query);
    return !tokens.length || matchesSearchTokens(browseSearchableText(row), tokens);
}

export const normalizeDoi = doi => (doi || '').trim().toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, '').replace(/^doi:/, '');
