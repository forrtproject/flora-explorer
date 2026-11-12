/* Labels, definitions and aliases come from the same vocabulary as the pipeline. */
window.FloraVocabulary = (() => {
    let vocabulary;
    const normalise = raw => String(raw ?? '').trim().toLowerCase();
    const ready = fetch('data/outcome_vocabulary.json').then(response => {
        if (!response.ok) throw new Error('Outcome vocabulary could not be loaded');
        return response.json();
    }).then(data => { vocabulary = data; });
    // loadData() reports the failure; this only stops an early unhandled-rejection warning.
    ready.catch(() => {});
    const entries = dimension => vocabulary[dimension];
    function classify(raw, dimension = 'replication') {
        const value = normalise(raw);
        if (vocabulary.missing_markers.includes(value)) return 'missing';
        return entries(dimension).find(item => item.aliases.includes(value))?.key || 'unrecognised';
    }
    const item = (dimension, key) => entries(dimension).find(item => item.key === key);
    const label = (key, dimension = 'replication') => item(dimension, key)?.label || item(dimension, 'unrecognised').label;
    // Each study type has its own verdict columns; the combined `outcome` is not classified.
    const reproduction = row => ({computational: classify(row.outcome_computation, 'computational'), robustness: classify(row.outcome_robustness, 'robustness')});
    const replication = row => classify(row.outcome_replication);
    // The verdicts as recorded, for search and sorting.
    const sourceOutcome = row => classifyKind(row) === 'reproduction'
        ? [row.outcome_computation, row.outcome_robustness].map(v => String(v ?? '').trim()).filter(Boolean).join(', ')
        : String(row.outcome_replication ?? '').trim();
    function outcomeLabel(row) {
        if (classifyKind(row) !== 'reproduction') return label(replication(row));
        const dimensions = reproduction(row);
        return `Computational: ${label(dimensions.computational, 'computational')}; Robustness: ${label(dimensions.robustness, 'robustness')}`;
    }
    const studyType = kind => vocabulary.study_types[kind] || kind;
    function definitions() {
        const term = item => `<li class="${item.assessed ? 'verdict' : 'no-verdict'}"><span class="key-swatch" style="--swatch:var(--color-chart-${item.color})"></span><span class="key-text"><strong>${item.label}</strong><span>${item.definition}</span></span></li>`;
        const panels = {replication: 'Replication', computational: 'Computational', robustness: 'Robustness', units: 'Units'};
        const column = (dimension, title) => {
            const [assessed, unassessed] = [entries(dimension).filter(item => item.assessed), entries(dimension).filter(item => !item.assessed)];
            return `<section class="key-column" data-panel="${dimension}"><h3>${title}</h3><ul>${assessed.map(term).join('')}</ul><p class="key-subhead">No verdict</p><ul>${unassessed.map(term).join('')}</ul></section>`;
        };
        const units = '<section class="key-column key-units" data-panel="units"><h3>Counting units</h3><dl>'
            + Object.entries(vocabulary.units).map(([label, definition]) => `<div><dt>${label}</dt><dd>${definition}</dd></div>`).join('') + '</dl></section>';
        const preview = entries('replication').filter(item => item.assessed).map(item =>
            `<span><span class="key-swatch" style="--swatch:var(--color-chart-${item.color})"></span>${item.label}</span>`).join('');
        document.querySelectorAll('[data-outcome-definitions]').forEach(container => {
            container.dataset.panel ||= 'replication';
            const tabs = Object.entries(panels).map(([key, name]) =>
                `<button type="button" data-panel-tab="${key}" aria-pressed="${key === container.dataset.panel}">${name}</button>`).join('');
            container.innerHTML = `<summary><span class="key-title">Outcome key</span><span class="key-preview" aria-hidden="true">${preview}</span></summary>`
                + `<div class="key-tabs" role="group" aria-label="Outcome key section">${tabs}</div>`
                + '<div class="key-grid"><div class="key-stack">' + column('replication', 'Replication') + units + '</div>'
                + '<div class="key-stack">' + column('computational', 'Reproduction · computational') + column('robustness', 'Reproduction · robustness') + '</div></div>';
            if (container.dataset.tabsBound) return;
            container.dataset.tabsBound = 'true';
            container.addEventListener('click', event => {
                const tab = event.target.closest('[data-panel-tab]');
                if (!tab) return;
                container.dataset.panel = tab.dataset.panelTab;
                container.querySelectorAll('[data-panel-tab]').forEach(button => button.setAttribute('aria-pressed', button === tab));
            });
        });
        const tipList = items => '<ul class="tip-definitions">' + items.map(item =>
            `<li><span class="tip-swatch" style="background:var(--color-chart-${item.color})"></span><span><strong>${item.label}</strong> ${item.definition}</span></li>`).join('') + '</ul>';
        document.querySelectorAll('.outcome-chart-label .info-tip').forEach(tip => {
            const id = tip.closest('.outcome-chart-row').querySelector('canvas').id;
            const dimension = id.includes('computational') ? 'computational' : id.includes('robustness') ? 'robustness' : 'replication';
            // Keep the hand-written scope note from index.html; this can run more than once.
            tip.dataset.scope ??= tip.innerHTML;
            const [assessed, unassessed] = [entries(dimension).filter(item => item.assessed), entries(dimension).filter(item => !item.assessed)];
            tip.classList.add('info-tip-wide');
            tip.innerHTML = `<p class="tip-scope">${tip.dataset.scope}</p>` + tipList(assessed)
                + `<p class="tip-subhead">No verdict</p><p class="tip-note">${unassessed.map(item => item.label).join(' · ')}. See the <em>Outcome key</em> on the Overview tab for each.</p>`;
        });
    }
    // A ?doi= deep link can draw charts before the vocabulary has loaded.
    const unitDefinition = label => vocabulary?.units[label] || '';
    const isMissing = raw => Boolean(vocabulary?.missing_markers.includes(normalise(raw)));
    return {ready, entries, classify, item, label, reproduction, replication, sourceOutcome, outcomeLabel, studyType, definitions, unitDefinition, isMissing};
})();
