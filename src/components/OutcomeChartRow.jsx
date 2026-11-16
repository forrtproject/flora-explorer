import {useMemo} from 'react';
import {dimensionCaption, dimensionChartData} from '../lib/aggregate.js';
import {FloraVocabulary} from '../lib/vocabulary.js';
import {useEnv} from '../state/env.jsx';
import {barTable, stackedBarOption} from '../lib/charts.js';
import {ChartCopy, ChartData, EChart} from './charts.jsx';
import {InfoTip} from './common.jsx';

const DIMENSIONS = {
    computational: {title: 'Computational reproducibility', slug: 'computational', vocabulary: 'computational', category: 'Reproductions', info: 'Info about computational reproducibility'},
    robustness: {title: 'Robustness', slug: 'robustness', vocabulary: 'robustness', category: 'Reproductions', info: 'Info about robustness'},
    replicability: {title: 'Replication outcomes', slug: 'outcome', vocabulary: 'replication', category: 'Replications', info: 'Info about replicability'},
};

export function OutcomeChartRow({prefix, dimension, rows, scope, rowId, hidden}) {
    const d = DIMENSIONS[dimension];
    const {theme} = useEnv();
    const id = `${prefix}-${d.slug}-chart`;
    const title = (prefix === 'browse' ? 'Browse results: ' : '') + d.title;
    const data = useMemo(() => dimensionChartData(rows, dimension), [rows, dimension, theme]);
    const reproduction = dimension !== 'replicability';
    // One horizontal stacked bar: the share of each outcome within the dimension.
    const series = useMemo(() => data.datasets.map(s => ({name: s.label, color: s.backgroundColor, values: s.data})), [data]);
    const option = useMemo(() => ({width}) => stackedBarOption({categories: [d.category], series, proportion: true, total: data.total, width}), [series, data.total, d.category]);
    const table = useMemo(() => barTable([d.category], series, data.eligible, reproduction ? 'reproduction' : 'replication'), [series, data.eligible, reproduction, d.category]);
    const entries = FloraVocabulary.entries(d.vocabulary);
    return (
        <div className="outcome-chart-row" id={rowId} style={hidden ? {display: 'none'} : undefined}>
            <div className="outcome-chart-label">
                <span>{d.title}</span>
                <InfoTip label={d.info} wide>
                    <p className="tip-scope">{scope}</p>
                    <ul className="tip-definitions">
                        {entries.filter(e => e.assessed).map(e => (
                            <li key={e.key}><span className="tip-swatch" style={{background: `var(--color-chart-${e.color})`}} /><span><strong>{e.label}</strong> {e.definition}</span></li>
                        ))}
                    </ul>
                    <p className="tip-subhead">No verdict</p>
                    <p className="tip-note">{entries.filter(e => !e.assessed).map(e => e.label).join(' · ')}. See the <em>Outcome key</em> on the Overview tab for each.</p>
                </InfoTip>
                <ChartCopy id={id} title={title} table={table} />
            </div>
            <p className="note chart-caption" id={`${prefix}-${d.slug}-caption`}>{dimensionCaption(rows, dimension)}</p>
            <EChart id={id} title={title} option={option} className="chart-box chart-container-stack" />
            <ChartData id={id} title={title} table={table} />
        </div>
    );
}
