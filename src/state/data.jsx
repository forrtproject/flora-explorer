import {createContext, useCallback, useContext, useEffect, useMemo, useState} from 'react';
import Papa from 'papaparse';
import {STAMPS, URLS} from '../lib/config.js';
import {FloraVocabulary} from '../lib/vocabulary.js';

const DataContext = createContext(null);
export const useData = () => useContext(DataContext);

const OUTCOME_CODE_COLUMNS = new Set(['outcome', 'outcome_replication', 'outcome_computation', 'outcome_robustness']);
const REPLICATION_FALLBACK = {outcome_replication: 'outcome', outcome_replication_quote: 'outcome_quote', out_quote_replication_source: 'outcome_quote_source'};

// A load failure in words a reader can act on. Network failures reach here as a TypeError from fetch or,
// from Papa Parse, as an Error wrapping the browser's ProgressEvent ("[object ProgressEvent]").
export function describeLoadError(e) {
    const text = String(e?.message ?? e ?? '');
    const status = /HTTP (\d{3})/.exec(text)?.[1];
    if (status === '404') return 'the data file was not found on the server (HTTP 404)';
    if (status) return `the server could not provide the data (HTTP ${status})`;
    if (e instanceof SyntaxError) return 'the data file could not be read';
    if (!text || e instanceof TypeError || /ProgressEvent|NetworkError|Failed to fetch|Load failed/i.test(text)) return 'the network request failed; check your connection';
    return text;
}

const parseCsv = url => new Promise((resolve, reject) => {
    Papa.parse(url, {download: true, header: true, skipEmptyLines: true, complete: resolve, error: reject});
});

async function loadRows() {
    let results;
    try {
        results = await parseCsv(URLS.csv);
        if (!results.data?.length) throw new Error('empty');
    } catch {
        console.info('Local flora.csv not available, falling back to upstream raw URL');
        results = await parseCsv(URLS.remoteCsv);
    }
    if (results.errors?.length) console.warn('CSV parsing warnings:', results.errors);
    return results.data.map(row => {
        // Verdict columns keep "NA" as recorded, so downloads show the coder's value.
        for (const key of Object.keys(row)) if (!OUTCOME_CODE_COLUMNS.has(key) && row[key] === 'NA') row[key] = '';
        // Until a FLoRA release ships the replication columns they are copied from the combined
        // fields, which hold identical values for replications.
        for (const [column, combined] of Object.entries(REPLICATION_FALLBACK)) {
            if (!(column in row) && combined in row) row[column] = (row.type || '').toLowerCase().includes('reproduc') ? '' : row[combined];
        }
        return row;
    });
}

async function loadDisciplines() {
    const byJournal = {};
    try {
        const res = await fetch(URLS.disciplines);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        for (const [discipline, journals] of Object.entries(await res.json())) {
            for (const journal of journals) byJournal[journal.toLowerCase().trim()] = discipline;
        }
    } catch (e) {
        console.warn('Could not load disciplines.json; field aggregation will use Uncategorized only.', e);
    }
    return byJournal;
}

async function loadStamps() {
    const entries = await Promise.all(Object.entries(STAMPS).map(async ([source, {url}]) => {
        try {
            const res = await fetch(url, {cache: 'no-cache'});
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return [source, await res.json()];
        } catch { return [source, null]; }
    }));
    return Object.fromEntries(entries);
}

export function DataProvider({children}) {
    const [state, setState] = useState({status: 'loading', rows: [], disciplines: {}, error: ''});
    // undefined while loading, so stamps do not flash "no snapshot yet".
    const [stamps, setStamps] = useState();

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try { await FloraVocabulary.ready; if (!cancelled) setState(s => ({...s, vocabulary: true})); }
            catch (e) { if (!cancelled) setState(s => ({...s, status: 'error', error: `Could not load the outcome definitions: ${describeLoadError(e)}.`})); return; }
            try {
                const [rows, disciplines] = await Promise.all([loadRows(), loadDisciplines()]);
                if (!cancelled) setState({status: 'ready', rows, disciplines, error: '', vocabulary: true});
            } catch (e) {
                if (!cancelled) setState(s => ({...s, status: 'error', error: `Could not load FLoRA data: ${describeLoadError(e)}.`}));
            }
        })();
        loadStamps().then(loaded => { if (!cancelled) setStamps(loaded); });
        return () => { cancelled = true; };
    }, []);

    const value = useMemo(() => ({
        ...state, stamps,
        disciplineFor: journal => journal && state.disciplines[journal.toLowerCase().trim()] || 'Uncategorized',
    }), [state, stamps]);
    return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

// Fetches one JSON resource the first time its tab is opened. A failure gives a readable `error`
// and `retry()`, which clears it so the next render fetches again.
export function useJson(url, enabled, optional = false) {
    const [state, setState] = useState({data: null, error: '', loading: false});
    useEffect(() => {
        if (!enabled || state.data || state.loading || state.error) return;
        setState(s => ({...s, loading: true}));
        fetch(url, {cache: 'no-cache'}).then(res => {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json();
        }).then(data => setState({data, error: '', loading: false}),
            err => setState({data: optional ? {} : null, error: optional ? '' : describeLoadError(err), loading: false}));
    }, [url, enabled, optional, state.data, state.loading, state.error]);
    const retry = useCallback(() => setState({data: null, error: '', loading: false}), []);
    return {...state, retry};
}
