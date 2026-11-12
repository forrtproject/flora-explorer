import {useMemo} from 'react';
import {dimensionCaption, dimensionChartData} from '../lib/aggregate.js';
import {FloraVocabulary} from '../lib/vocabulary.js';
import {useEnv} from '../state/env.jsx';
import {ChartCopy, ChartData, outcomeBarConfig, useBarChart} from './charts.jsx';
import {InfoTip} from './common.jsx';

const DIMENSIONS = {
    computational: {title: 'Computational reproducibility', slug: 'computational', vocabulary: 'computational', category: 'Reproductions', info: 'Info about computational reproducibility'},
    robustness: {title: 'Robustness', slug: 'robustness', vocabulary: 'robustness', category: 'Reproductions', info: 'Info about robustness'},
    replicability: {title: 'Replication outcomes', slug: 'outcome', vocabulary: 'replication', category: 'Replications', info: 'Info about replicability'},
};

export function OutcomeChartRow({prefix, dimension, rows, eligible, scope, rowId, hidden}) {
    const d = DIMENSIONS[dimension];
    const {theme} = useEnv();
    const id = `${prefix}-${d.slug}-chart`;
    const title = (prefix === 'browse' ? 'Browse results: ' : '') + d.title;
    const data = useMemo(() => dimensionChartData(rows, dimension), [rows, dimension, theme]);
    const reproduction = dimension !== 'replicability';
    const {canvasProps, table} = useBarChart(id, title, () => outcomeBarConfig(data.datasets, data.total, d.category), [data],
        {eligible: eligible ?? data.eligible, scope: reproduction ? 'reproduction' : 'replication'});
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
                    <p className="tip-note">{entries.filter(e => !e.assessed).map(e => e.label).join(' · ')}. See <em>Outcome definitions</em> for each.</p>
                </InfoTip>
                <ChartCopy id={id} title={title} table={table} />
            </div>
            <p className="chart-caption" id={`${prefix}-${d.slug}-caption`}>{dimensionCaption(rows, dimension)}</p>
            <div className="chart-container-stack"><canvas {...canvasProps} /></div>
            <ChartData id={id} title={title} table={table} />
        </div>
    );
}
