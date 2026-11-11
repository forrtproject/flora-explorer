import yaml from 'js-yaml';

// APA-style dataset citation parts from a CITATION.cff document.
export function parseCff(text) {
    const cff = yaml.load(text);
    if (!cff || !Array.isArray(cff.authors)) throw new Error('Could not parse authors from CITATION.cff');
    const authors = cff.authors.map(a => {
        const family = a['family-names'] || a.family || '';
        const given = a['given-names'] || a.given || '';
        if (!family) return a.name || '';
        if (!given) return family;
        const initials = given.split(/[\s-]+/).filter(Boolean)
            .map(part => { const m = part.match(/\p{L}/u); return m ? m[0].toUpperCase() + '.' : ''; })
            .filter(Boolean).join(' ');
        return initials ? `${family}, ${initials}` : family;
    }).filter(Boolean);

    let authorsStr = '';
    if (authors.length === 1) authorsStr = authors[0];
    else if (authors.length === 2) authorsStr = `${authors[0]}, & ${authors[1]}`;
    else if (authors.length > 2 && authors.length <= 20) authorsStr = authors.slice(0, -1).join(', ') + ', & ' + authors.at(-1);
    else if (authors.length > 20) authorsStr = authors.slice(0, 19).join(', ') + ', … ' + authors.at(-1);

    const year = cff['date-released'] ? String(cff['date-released']).substring(0, 4) : '';
    const title = cff.title || '';
    const version = cff.version ? ` (Version ${cff.version})` : '';
    const doi = cff.doi || '';
    const plain = [authorsStr, `(${year}).`, `${title}${version} [Dataset].`, doi ? `https://doi.org/${doi}` : ''].filter(Boolean).join(' ');
    return {authorsStr, year, title, version, doi, plain};
}
