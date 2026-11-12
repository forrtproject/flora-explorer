import {createContext, useCallback, useContext, useEffect, useMemo, useState} from 'react';
import {flushSync} from 'react-dom';
import {Chart} from '../lib/charts.js';
import {initialTheme} from '../lib/theme.js';

const EnvContext = createContext({theme: 'light', tick: 0});
export const useEnv = () => useContext(EnvContext);

// A pane publishes its update stamps and active selection so chart tables and exports can cite them.
export const PaneContext = createContext({active: true, visited: true, stamps: '', selection: '', kind: ''});
export const usePane = () => useContext(PaneContext);

export function EnvProvider({children}) {
    const [theme, setTheme] = useState(() => {
        const theme = initialTheme();
        document.documentElement.setAttribute('data-theme', theme);
        return theme;
    });
    const [tick, setTick] = useState(0);
    // Bumped to recompute views after loaded data is edited in place (console and tests).
    const [rev, setRev] = useState(0);
    useEffect(() => { window.floraRefresh = () => flushSync(() => setRev(n => n + 1)); }, []);

    const toggleTheme = useCallback(() => setTheme(prev => {
        const next = prev === 'dark' ? 'light' : 'dark';
        // Set before React re-renders: charts read their colours from the document.
        document.documentElement.setAttribute('data-theme', next);
        try { localStorage.setItem('flora-theme', next); } catch { /* storage can be blocked */ }
        return next;
    }), []);

    useEffect(() => {
        let timer;
        const onResize = () => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                // Chart.js can miss a container resize after a tab switch followed by narrowing.
                Object.values(Chart.instances).forEach(chart => { if (chart.canvas?.getClientRects().length) chart.resize(); });
                setTick(n => n + 1);
            }, 120);
        };
        window.addEventListener('resize', onResize);
        return () => { clearTimeout(timer); window.removeEventListener('resize', onResize); };
    }, []);

    const value = useMemo(() => ({theme, toggleTheme, tick, rev}), [theme, toggleTheme, tick, rev]);
    return <EnvContext.Provider value={value}>{children}</EnvContext.Provider>;
}
