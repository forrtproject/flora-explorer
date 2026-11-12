import {createRoot} from 'react-dom/client';
import App from './App.jsx';
import {loadPlotly} from './lib/charts.js';
import {installHooks} from './lib/hooks.js';
import {DataProvider} from './state/data.jsx';
import {EnvProvider} from './state/env.jsx';
import {ViewProvider} from './state/view.jsx';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/app.css';

installHooks();
// Plotly is large and only charts on later tabs need it, so it loads beside the first paint.
loadPlotly();

createRoot(document.getElementById('root')).render(
    <EnvProvider><ViewProvider><DataProvider><App /></DataProvider></ViewProvider></EnvProvider>,
);
