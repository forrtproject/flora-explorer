import {createContext, useContext} from 'react';
import {STAMP_LABELS} from '../lib/config.js';

export const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

// Data-stamp sources and active filter labels of the enclosing tab, for export context.
export const PaneContext = createContext({sources: [], selection: []});
export const usePane = () => useContext(PaneContext);

export function stampParts(src, meta) {
    const label = STAMP_LABELS[src] || 'Data';
    if (!meta || !meta.last_updated) return {label, missing: true};
    const dt = new Date(meta.last_updated);
    const formatted = dt.toLocaleString('en-GB', {year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short'});
    let snapshot = null;
    if (meta.input_snapshot) {
        const snap = new Date(meta.input_snapshot);
        snapshot = {raw: String(meta.input_snapshot), text: isNaN(snap) ? String(meta.input_snapshot) : snap.toLocaleDateString(undefined, {year: 'numeric', month: 'short', day: 'numeric'})};
    }
    return {label, formatted, dt, snapshot,
        recalculated: meta.recalculated_at ? new Date(meta.recalculated_at).toLocaleDateString() : null,
        partial: !!meta.partial_run, sourceUrl: meta.source_url || null};
}

export function stampText(src, meta) {
    const p = stampParts(src, meta);
    if (p.missing) return meta === undefined ? '' : `${p.label}: no snapshot yet`;
    let text = `${p.label} last updated: ${p.formatted}`;
    if (p.snapshot) text += ` · input snapshot: ${p.snapshot.text}`;
    if (p.recalculated) text += ` · recalculated: ${p.recalculated}`;
    if (p.partial) text += ' · Partial refresh: some records are unavailable';
    if (p.sourceUrl) text += ` · ${p.label} source`;
    return text;
}

export function exportContext(stamps, pane) {
    const stamp = pane.sources.map(src => stampText(src, stamps[src])).filter(Boolean).join('; ') || 'Snapshot date: see tab update stamp';
    const filters = pane.selection.filter(Boolean).join('; ');
    return `${stamp}. ${filters ? 'Selection: ' + filters + '. ' : ''}Values and units correspond to the labelled series. Reference pairs can share reports; reproduction dimensions can overlap.`;
}
