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
export const matchesTokens = (text, tokens) => tokens.every(t => text.includes(t));

const pairText = new WeakMap();
function pairSearchText(row) {
    if (!pairText.has(row)) {
        // Quotations stay searchable; raw outcome codes and non-DOI URLs do not.
        const urlDoi = /^https?:\/\/(?:dx\.)?doi\.org\//i.test(row.url_r || '') ? row.url_r : '';
        pairText.set(row, normalizedQuery([row.title_o, searchAuthorNames(row.author_o), row.journal_o, row.year_o, row.doi_o,
            row.title_r, searchAuthorNames(row.author_r), row.journal_r, row.year_r, row.doi_r, urlDoi,
            row.outcome_replication_quote, row.outcome_computational_quote, row.outcome_robustness_quote, row.type].filter(Boolean).join(' | ')));
    }
    return pairText.get(row);
}
export function matchesBrowseQuery(row, query) {
    const tokens = searchTokens(query);
    return !tokens.length || matchesTokens(pairSearchText(row), tokens);
}

export const normalizeDoi = doi => (doi || '').trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '').replace(/^doi:/, '');
