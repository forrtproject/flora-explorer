import {URLS} from './config.js';

// Labels, definitions and aliases come from the same vocabulary file as the pipeline.
let vocabulary;
const normalise = raw => String(raw ?? '').trim().toLowerCase();

const ready = fetch(URLS.vocabulary).then(response => {
    if (!response.ok) throw new Error('Outcome vocabulary could not be loaded');
    return response.json();
}).then(data => { vocabulary = data; });
// The data loader reports the failure; this only stops an early unhandled-rejection warning.
ready.catch(() => {});

const entries = dimension => vocabulary[dimension];
function classify(raw, dimension = 'replication') {
    const value = normalise(raw);
    if (vocabulary.missing_markers.includes(value)) return 'missing';
    return entries(dimension).find(item => item.aliases.includes(value))?.key || 'unrecognised';
}
const item = (dimension, key) => entries(dimension).find(entry => entry.key === key);
const label = (key, dimension = 'replication') => item(dimension, key)?.label || item(dimension, 'unrecognised').label;
const studyType = kind => vocabulary.study_types[kind] || kind;
const units = () => vocabulary?.units || {};
// A ?doi= deep link can draw charts before the vocabulary has loaded.
const unitDefinition = name => vocabulary?.units[name] || '';
const isMissing = raw => Boolean(vocabulary?.missing_markers.includes(normalise(raw)));
const loaded = () => Boolean(vocabulary);

export const FloraVocabulary = {ready, loaded, entries, classify, item, label, studyType, units, unitDefinition, isMissing};
