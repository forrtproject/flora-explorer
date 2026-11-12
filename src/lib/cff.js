import yaml from 'js-yaml';
import {URLS} from './config.js';

// APA-style dataset citation built from the live CITATION.cff.
export async function loadDatasetCitation() {
    const res = await fetch(URLS.cff);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const cff = yaml.load(await res.text());
    if (!cff || !Array.isArray(cff.authors)) throw new Error('Could not parse authors from CITATION.cff');
    const authors = cff.authors.map(a => {
        const family = a['family-names'] || a.family || '', given = a['given-names'] || a.given || '';
        if (!family) return a.name || '';
        const initials = given.split(/[\s-]+/).filter(Boolean).map(part => { const m = part.match(/\p{L}/u); return m ? m[0].toUpperCase() + '.' : ''; }).filter(Boolean).join(' ');
        return initials ? `${family}, ${initials}` : family;
    }).filter(Boolean);
    const n = authors.length;
    const names = n <= 1 ? authors[0] || '' : n === 2 ? `${authors[0]}, & ${authors[1]}`
        : n <= 20 ? authors.slice(0, -1).join(', ') + ', & ' + authors[n - 1]
        : authors.slice(0, 19).join(', ') + ', … ' + authors[n - 1];
    const released = cff['date-released'];
    // YAML parses an unquoted date into a Date.
    const year = released instanceof Date ? String(released.getUTCFullYear()) : released ? String(released).substring(0, 4) : '';
    const title = cff.title || '', version = cff.version ? ` (Version ${cff.version})` : '', doi = cff.doi || '';
    return {names, year, title, version, doi,
        plain: [names, `(${year}).`, `${title}${version} [Dataset].`, doi && `https://doi.org/${doi}`].filter(Boolean).join(' ')};
}
