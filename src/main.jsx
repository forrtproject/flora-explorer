import {createRoot} from 'react-dom/client';
import 'bootstrap/dist/css/bootstrap.min.css';
import '../assets/styles.css';
import App from './App.jsx';
import {installTestHooks} from './testHooks.js';
import {startDataLoad} from './state/data.js';
import {loadPlotly} from './lib/plotly.js';

const stored = (() => { try { return localStorage.getItem('flora-theme'); } catch { return null; } })();
document.documentElement.setAttribute('data-theme', stored || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

installTestHooks();
// The CSV request starts before React mounts; Plotly follows so it never delays the data.
const dataPromise = startDataLoad();
loadPlotly();
createRoot(document.getElementById('root')).render(<App dataPromise={dataPromise} />);
