let pending;
// Plotly is large, so it is split out and fetched once the data request has started.
export function loadPlotly() {
    pending ||= import('plotly.js-dist-min').then(m => { window.Plotly = m.default || m; return window.Plotly; });
    return pending;
}
