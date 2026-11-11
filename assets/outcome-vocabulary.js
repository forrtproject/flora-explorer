/* Labels, definitions and aliases come from the same vocabulary as the pipeline. */
window.FloraVocabulary = (() => {
    let vocabulary;
    const normalise = raw => String(raw ?? '').trim().toLowerCase();
    const ready = fetch('data/outcome_vocabulary.json').then(response => {
        if (!response.ok) throw new Error('Outcome vocabulary could not be loaded');
        return response.json();
    }).then(data => { vocabulary = data; });
    const entries = dimension => vocabulary[dimension];
    function classify(raw, dimension = 'replication') {
        const value = normalise(raw);
        if (vocabulary.missing_markers.includes(value)) return 'missing';
        return entries(dimension).find(item => item.aliases.includes(value))?.key || 'unrecognised';
    }
    const item = (dimension, key) => entries(dimension).find(item => item.key === key);
    const label = (key, dimension = 'replication') => item(dimension, key)?.label || item(dimension, 'unrecognised').label;
    function reproduction(raw) {
        const parts = String(raw ?? '').split(',');
        return {computational: classify(parts[0], 'computational'), robustness: classify(parts[1], 'robustness')};
    }
    function outcomeLabel(row) {
        if (classifyKind(row) !== 'reproduction') return label(classify(row.outcome));
        const dimensions = reproduction(row.outcome);
        return `Computational: ${label(dimensions.computational, 'computational')}; Robustness: ${label(dimensions.robustness, 'robustness')}`;
    }
    const studyType = kind => vocabulary.study_types[kind] || kind;
    function definitions() {
        document.querySelectorAll('[data-outcome-definitions]').forEach(container => {
            container.innerHTML = '<summary>Outcome definitions</summary>' + ['replication', 'computational', 'robustness'].map(dimension =>
                `<h3>${{replication:'Replication outcomes', computational:'Computational reproducibility', robustness:'Robustness'}[dimension]}</h3><dl>` + entries(dimension).map(item =>
                    `<dt>${item.label}</dt><dd>${item.definition}</dd>`).join('') + '</dl>').join('') + '<h3>Units</h3><dl>' + Object.entries(vocabulary.units).map(([label, definition]) => `<dt>${label}</dt><dd>${definition}</dd>`).join('') + '</dl>';
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
                + `<p class="tip-subhead">No verdict</p><p class="tip-note">${unassessed.map(item => item.label).join(' · ')}. See <em>Outcome definitions</em> for each.</p>`;
        });
    }
    const unitDefinition = label => vocabulary.units[label];
    return {ready, entries, classify, item, label, reproduction, outcomeLabel, studyType, definitions, unitDefinition};
})();
