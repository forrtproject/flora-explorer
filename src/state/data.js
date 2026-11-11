import Papa from 'papaparse';
import {LOCAL_CSV_URL, REMOTE_CSV_URL, DISCIPLINES_URL, STAMP_URLS, CITATION_URL, FAQ_URL} from '../lib/config.js';
import {parseCff} from '../lib/citation.js';
import {parseFaqMarkdown} from '../lib/faq.js';

const parseCsv = url => new Promise((resolve, reject) => Papa.parse(url, {
    download: true, header: true, skipEmptyLines: true, complete: resolve, error: reject,
}));

async function loadDisciplines() {
    let disciplines = {};
    try {
        const res = await fetch(DISCIPLINES_URL);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        disciplines = await res.json();
    } catch (e) {
        console.warn('Could not load disciplines.json; field aggregation will use Uncategorized only.', e);
    }
    const byJournal = {};
    for (const [disc, journals] of Object.entries(disciplines)) for (const j of journals) byJournal[j.toLowerCase().trim()] = disc;
    return journal => (journal && byJournal[journal.toLowerCase().trim()]) || 'Uncategorized';
}

// Prefers the daily committed snapshot and falls back to the upstream CSV.
export async function startDataLoad() {
    const disciplines = loadDisciplines();
    let results;
    try {
        results = await parseCsv(LOCAL_CSV_URL);
        if (!results.data || results.data.length === 0) throw new Error('empty');
    } catch {
        console.info('Local flora.csv not available, falling back to upstream raw URL');
        results = await parseCsv(REMOTE_CSV_URL);
    }
    if (results.errors?.length) console.warn('CSV parsing warnings:', results.errors);
    const rows = results.data.map(row => {
        for (const key of Object.keys(row)) if (row[key] === 'NA') row[key] = '';
        return row;
    });
    return {rows, disciplineForJournal: await disciplines};
}

export async function loadStamps() {
    const entries = await Promise.all(Object.entries(STAMP_URLS).map(async ([src, url]) => {
        try {
            const res = await fetch(url, {cache: 'no-cache'});
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return [src, await res.json()];
        } catch { return [src, null]; }
    }));
    return Object.fromEntries(entries);
}

export async function loadCitation() {
    try {
        const res = await fetch(CITATION_URL);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return parseCff(await res.text());
    } catch (err) {
        console.error('Citation load failed:', err);
        return {error: true, url: CITATION_URL};
    }
}

export async function loadFaqs() {
    const res = await fetch(FAQ_URL);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const items = parseFaqMarkdown(await res.text());
    if (items.length === 0) throw new Error('No FAQ items found');
    return items;
}
