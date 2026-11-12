import {createContext, useContext, useEffect, useMemo, useState} from 'react';
import Papa from 'papaparse';
import {STAMPS, URLS} from '../lib/config.js';
import {FloraVocabulary} from '../lib/vocabulary.js';

const DataContext = createContext(null);
export const useData = () => useContext(DataContext);

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
        // "NA" is a real outcome code only in the outcome column.
        for (const key of Object.keys(row)) if (key !== 'outcome' && row[key] === 'NA') row[key] = '';
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
            catch (e) { if (!cancelled) setState(s => ({...s, status: 'error', error: 'Error loading the outcome definitions: ' + (e.message || e)})); return; }
            try {
                const [rows, disciplines] = await Promise.all([loadRows(), loadDisciplines()]);
                if (!cancelled) setState({status: 'ready', rows, disciplines, error: '', vocabulary: true});
            } catch (e) {
                if (!cancelled) setState(s => ({...s, status: 'error', error: 'Error loading FLoRA data: ' + (e.message || e)}));
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

// Fetches one JSON resource the first time its tab is opened.
export function useJson(url, enabled, optional = false) {
    const [state, setState] = useState({data: null, error: '', loading: false});
    useEffect(() => {
        if (!enabled || state.data || state.loading || state.error) return;
        setState(s => ({...s, loading: true}));
        fetch(url, {cache: 'no-cache'}).then(res => {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json();
        }).then(data => setState({data, error: '', loading: false}),
            err => setState({data: optional ? {} : null, error: optional ? '' : String(err), loading: false}));
    }, [url, enabled, optional, state.data, state.loading, state.error]);
    return state;
}
