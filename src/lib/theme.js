// Chart colours resolve from CSS tokens at render time, so every chart follows the theme.
export const token = (name, fallback = '') => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

export function chartTheme() {
    return {
        paper: token('--color-surface-raised', '#fff'), plot: token('--color-surface-raised', '#fff'),
        grid: token('--color-border-light', '#e0e1e1'), font: token('--color-text', '#2c2c2c'),
        tick: token('--color-text-secondary', '#4a4a4a'), muted: token('--color-muted-fg', '#6b7280'),
        primary: token('--color-primary', '#853953'), band: token('--color-plot-band'),
        point: token('--color-plot-point'), rule: token('--color-plot-rule'), ruleLabel: token('--color-plot-rule-label'),
        fontFamily: token('--font-body', 'sans-serif'),
    };
}

export function initialTheme() {
    let stored = null;
    try { stored = localStorage.getItem('flora-theme'); } catch { /* storage can be blocked */ }
    return stored || (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}
