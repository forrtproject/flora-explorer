const escapeHtml = text => String(text ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

export function renderInlineMd(text) {
    let s = escapeHtml(text.replace(/\\([#_\-])/g, '$1'));
    s = s.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => {
        // Allow-list: anything not starting with an allowed scheme renders as plain text,
        // including URLs a browser would normalise into javascript:.
        const clean = u.trim();
        const label = /^here$/i.test(t) && clean.includes('forrt-replications.shinyapps.io/fred_explorer/') ? 'FORRT Replication Database explorer' : t;
        return /^(https?:|mailto:)/i.test(clean) ? `<a href="${clean}" target="_blank" rel="noopener">${label}</a>` : `${t} (${u})`;
    });
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    return s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
}

// The live FAQ is shared with other tools. Reader-facing copy is corrected here without
// changing the upstream coding guidance or exposing its spreadsheet column names.
function readerFaqCopy(md) {
    return md.replace(/\\([#_\-])/g, '$1')
        .replace(/computational reproducible/g, 'computationally reproducible')
        .replace(/This we would code as/g, 'We would code this as')
        .replace(/versionising/g, 'versioning').replace(/Pubmed/g, 'PubMed').replace(/Google docs/g, 'Google Docs')
        .replace(/regularly-updated/g, 'regularly updated')
        .replace('click [here](https://forrt-replications.shinyapps.io/fred_explorer/)', 'visit the [FORRT Replication Database explorer](https://forrt-replications.shinyapps.io/fred_explorer/)')
        .replace('in alt_id_o and alt_id_r columns', 'as alternative identifiers for the original and repetition reports')
        .replace('will have the specific published version in doi_r and the other alt_id_r', 'use the specific published version as the main repetition reference and keep the other version as an alternative identifier')
        .replace('and the individual reports or preprints as doi_r', 'and the individual reports or preprints as alternative identifiers')
        .replace(/\bjournal_r\b/g, 'the repetition report’s venue')
        .replace(/\bdoi_r\b/g, 'the repetition report’s main DOI')
        .replace(/\bdoi_o\b/g, 'the original report’s main DOI')
        .replace(/\balt_id_r\b/g, 'the repetition report’s alternative identifiers')
        .replace(/\balt_id_o\b/g, 'the original report’s alternative identifiers')
        .replace('The plugin tags replication outcomes as Successful, Failed, or Mixed,', 'Most replication outcomes are coded as Successful, Failed, or Mixed,');
}

export function renderFaqAnswer(lines) {
    const out = []; let i = 0;
    const bullet = /^\s*[-*]\s+/, ordered = /^\s*\d+\.\s+/;
    const list = (pattern, tag) => {
        const items = [];
        while (i < lines.length && pattern.test(lines[i])) items.push(lines[i++].replace(pattern, ''));
        out.push(`<${tag}>` + items.map(it => `<li>${renderInlineMd(it)}</li>`).join('') + `</${tag}>`);
    };
    while (i < lines.length) {
        if (bullet.test(lines[i])) list(bullet, 'ul');
        else if (ordered.test(lines[i])) list(ordered, 'ol');
        else if (lines[i].trim() === '') i++;
        else {
            const para = [];
            while (i < lines.length && lines[i].trim() !== '' && !bullet.test(lines[i]) && !ordered.test(lines[i])) para.push(lines[i++]);
            out.push('<p>' + renderInlineMd(para.join(' ')) + '</p>');
        }
    }
    return out.join('');
}

const VENUE_QUESTION = 'How is the peer review status determined?';
const VENUE_ANSWER = 'The Publication Type tab groups reports by their recorded venue: repository or preprint, conference output, thesis or dissertation, other named venue, or unknown venue. A named venue does not confirm peer review. Missing venue information remains unknown.';

export function parseFaqMarkdown(md) {
    const items = []; let qa = null, section = null, corrected = false;
    const flushQa = () => {
        if (!qa) return;
        if (qa.question === VENUE_QUESTION) { qa.body = [VENUE_ANSWER]; corrected = true; }
        items.push(qa); qa = null;
    };
    const flushSection = () => { if (section) { items.push(section); section = null; } };
    for (const line of readerFaqCopy(md).replace(/\r\n/g, '\n').split('\n')) {
        const heading = /^#{1,2}\s+(.+)$/.exec(line), question = /^#{3,4}\s+(.+)$/.exec(line);
        if (heading) { flushQa(); flushSection(); section = {type: 'section', text: heading[1].trim(), body: []}; }
        else if (question) { flushQa(); flushSection(); qa = {type: 'qa', question: question[1].trim(), body: []}; }
        else if (qa) qa.body.push(line);
        else if (section) section.body.push(line);
    }
    flushQa(); flushSection();
    if (!corrected) console.warn(`FAQ venue-status correction was not applied: expected heading "${VENUE_QUESTION}" was not found. Review the upstream FAQ.`);
    return items;
}
