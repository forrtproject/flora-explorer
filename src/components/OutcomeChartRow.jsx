import {useMemo} from 'react';
import {useApp} from '../state/context.jsx';
import {computeKindChartData, kindChartCaption} from '../lib/aggregate.js';
import {percent, theme as chartTheme} from '../lib/chartUtils.js';
import {ChartCanvas, ChartCopy, ChartData, useChartJsTable} from './Charts.jsx';
import {InfoTip} from './Common.jsx';

const TIP_LABELS = {computational: 'computational reproducibility', robustness: 'robustness', replicability: 'replicability'};
export const DIMENSION_TITLES = {computational: 'Computational Reproducibility', robustness: 'Robustness', replicability: 'Replicability'};

function stackedBarConfig(data, kind, categoryLabel) {
    const {datasets, total} = computeKindChartData(data, kind);
    const t = chartTheme();
    return {
        type: 'bar',
        data: {labels: [categoryLabel], datasets},
        options: {
            responsive: true, maintainAspectRatio: false, indexAxis: 'y',
            plugins: {
                legend: {position: 'bottom', labels: {color: t.font, boxWidth: 14, padding: 14, font: {size: 12}}},
                tooltip: {callbacks: {label: ctx => `${ctx.dataset.label}: ${ctx.parsed.x.toLocaleString()} (${percent(ctx.parsed.x, total, 1)}%)`}},
            },
            scales: {
                x: {stacked: true, min: 0, max: Math.max(total, 1), grid: {color: t.grid}, ticks: {color: t.tick}},
                y: {stacked: true, display: false},
            },
        },
    };
}

// One horizontal stacked outcome bar with its caption, data table and copy action.
export function OutcomeChartRow({canvasId, captionId, rowId, kind, data, eligible, tip, titlePrefix = '', hidden = false}) {
    const {theme} = useApp();
    const categoryLabel = kind === 'replicability' ? 'Replications' : 'Reproductions';
    const config = useMemo(() => stackedBarConfig(data, kind, categoryLabel), [data, kind, categoryLabel, theme]);
    const table = useChartJsTable(canvasId, config, eligible);
    const title = titlePrefix + DIMENSION_TITLES[kind];
    return <div className="outcome-chart-row" id={rowId} style={hidden ? {display: 'none'} : undefined}>
        <div className="outcome-chart-label">
            <span>{DIMENSION_TITLES[kind]}</span>
            <InfoTip label={`Info about ${TIP_LABELS[kind]}`}>{tip}</InfoTip>
            <ChartCopy id={canvasId} title={title} table={table} />
        </div>
        <p className="chart-caption" id={captionId}>{kindChartCaption(data, kind)}</p>
        <div className="chart-container-stack">
            <ChartCanvas id={canvasId} config={config} title={title} />
        </div>
        <ChartData id={canvasId} title={title} table={table} />
    </div>;
}
