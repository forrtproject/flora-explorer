// Outcome evidence shown in Browse: quote parts, their sources, and claim IDs hidden from display.
const CLAIM_ID_SEP = String.raw`(?:\s*,\s*(?:and\s+|\.\.\.\s*|…\s*)?|\s+and\s+)`;
const CLAIM_ID_RUN = new RegExp(String.raw`(?<![\w/.@:-])[a-z0-9]{6}(?:'s)?(?:${CLAIM_ID_SEP}[a-z0-9]{6}(?:'s)?)*(?![\w/-])`, 'g');
const ONE_CLAIM_ID = '\u0001', MANY_CLAIM_IDS = '\u0002';
const isCodedClaimId = t => /\d/.test(t) && /[a-z]/.test(t);
// Letter-only IDs (e.g. "gdyrdr") look like words; at most one vowel keeps six-letter words such as "claims" out.
const looksLikeLetterClaimId = t => /^[a-z]{6}$/.test(t) && (t.match(/[aeiou]/g) || []).length <= 1;

function markClaimIds(text) {
    return text.replace(/"([a-z0-9]{6})"/g, (m, id) => isCodedClaimId(id) ? id : m).replace(CLAIM_ID_RUN, (run, offset, whole) => {
        const parts = run.split(new RegExp(`(${CLAIM_ID_SEP})`));
        const raw = parts.filter((_, i) => i % 2 === 0);
        const seps = parts.filter((_, i) => i % 2 === 1);
        const ids = raw.map(t => t.replace(/'s$/, ''));
        const followedByVerdict = /^\s+"did/.test(whole.slice(offset + run.length));
        const isId = ids.map((t, i) => isCodedClaimId(t) || (looksLikeLetterClaimId(t) &&
            ([ids[i - 1], ids[i + 1]].some(n => n && isCodedClaimId(n)) || (i === ids.length - 1 && followedByVerdict))));
        if (!isId.some(Boolean)) return run;
        let out = '';
        for (let i = 0; i < raw.length;) {
            if (!isId[i]) { out += (i ? seps[i - 1] : '') + raw[i]; i++; continue; }
            let j = i; while (j + 1 < raw.length && isId[j + 1]) j++;
            out += (i ? seps[i - 1] : '') + (j > i ? MANY_CLAIM_IDS : ONE_CLAIM_ID) + (raw[j].endsWith("'s") ? "'s" : '');
            i = j + 1;
        }
        return out;
    });
}

// Display only: exports and search keep the raw text. IDs that name a claim become "one claim"/"some claims".
export function stripClaimIds(text) {
    if (!text || !/claim/i.test(text)) return text;
    const marked = markClaimIds(text);
    if (!/[\u0001\u0002]/.test(marked)) return text;
    const X = '[\u0001\u0002]';
    const label = id => id === MANY_CLAIM_IDS ? 'some claims' : 'one claim';
    return marked
        .replace(new RegExp(String.raw`\s*\(\s*${X}\s*\)`, 'g'), '')
        .replace(new RegExp(String.raw`([(;])\s*${X}\s*[,/]\s*`, 'g'), (m, p) => p === ';' ? '; ' : p)
        .replace(new RegExp(String.raw`${X}\s*/\s*`, 'g'), '')
        .replace(new RegExp(String.raw`:\s*${X}(?=\s*[)\];,.]|"|$)`, 'g'), '')
        .replace(new RegExp(String.raw`\b(claims?)\s+${X}\s*:`, 'gi'), '$1:')
        .replace(new RegExp(String.raw`\bclaim\s+(${X})'s`, 'gi'), (m, id) => `${label(id)}'s`)
        .replace(new RegExp(String.raw`(${X})'s`, 'g'), (m, id) => `${label(id)}'s`)
        .replace(new RegExp(String.raw`\bclaims\s+${X}(?=\s+[a-z])`, 'g'), 'some claims')
        .replace(new RegExp(String.raw`(^|[;,(]\s*|\b(?:while|but|and|for)\s+)claim\s+(${X})`, 'g'), (m, p, id) => p + label(id))
        .replace(new RegExp(String.raw`\b(for|of|but|while)\s+(${X})`, 'g'), (m, w, id) => `${w} ${label(id)}`)
        .replace(new RegExp(String.raw`(${X})(?=\s+")`, 'g'), (m, id) => label(id))
        .replace(new RegExp(String.raw`${X}\s*:\s*`, 'g'), '')
        .replace(new RegExp(String.raw`\s*,\s*${X}`, 'g'), '')
        .replace(new RegExp(X, 'g'), '')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\s+([,;:)])/g, '$1')
        .replace(/\(\s+/g, '(')
        .trim();
}

const hasValue = v => { const t = String(v ?? '').trim(); return t !== '' && t.toUpperCase() !== 'NA'; };
const splitParts = v => String(v || '').split('||').map(p => p.trim());

// Reproductions record each axis in its own columns; the combined quote fields are not used for them.
const REPRODUCTION_QUOTE_AXES = [
    ['Computational', 'outcome_computational_quote', 'out_quote_computational_source'],
    ['Robustness', 'outcome_robustness_quote', 'out_quote_robust_source'],
];

// The quote parts, each with its source where one can be paired, plus any sources left unpaired.
export function outcomeEvidenceParts(row) {
    if (row.type === 'reproduction') {
        return {unpaired: [], parts: REPRODUCTION_QUOTE_AXES.filter(([, q]) => hasValue(row[q]))
            .map(([label, q, src]) => ({label, text: stripClaimIds(row[q].trim()), source: hasValue(row[src]) ? row[src].trim() : ''}))};
    }
    const quotes = splitParts(row.outcome_replication_quote);
    const sources = splitParts(row.out_quote_replication_source);
    // Paired by position when the counts match, before missing parts are dropped so positions hold.
    const paired = sources.length === quotes.length;
    const present = sources.filter(hasValue);
    return {
        parts: quotes.map((text, i) => ({label: '', text, source: paired && hasValue(sources[i]) ? sources[i] : ''})).filter(p => hasValue(p.text)),
        unpaired: paired ? [] : present.filter((s, i) => present.findIndex(o => o.toLowerCase() === s.toLowerCase()) === i),
    };
}

// Sources that record a coder's note rather than a location in the report. flora-validation marks
// each with a "coding note" prefix; the other markers cover rows coded before that.
const CODING_NOTE_SOURCE = /^coding note\b|project rule|^data file\b|github\.com\/forrtproject\/fred-data\/issues/i;
export const isCodingNote = source => CODING_NOTE_SOURCE.test(source);
export const codingNoteBasis = source => source.replace(/^coding note:?\s*/i, '');
// Text and URL pieces alternate, so each URL inside a source can be linked.
export const sourcePieces = text => String(text).split(/(https?:\/\/[^\s;,)]+)/);
