import {authorList, cleanDoi, doiHref, safeHref, truncateText} from '../lib/format.js';
import {reportKindLabel} from '../lib/outcomes.js';
import {OutcomeBadge} from './Common.jsx';

export function DoiLink({doi, full = true}) {
    if (!doi) return '-';
    const clean = cleanDoi(doi);
    const href = doiHref(doi);
    const label = full ? clean : truncateText(clean, 25);
    return href ? <a href={href} target="_blank" rel="noopener noreferrer" className="doi-link" title={clean}>{label}</a> : label;
}

export function UrlOrDoi({url, doi, short = false}) {
    const href = safeHref(url);
    if (!href) return <DoiLink doi={doi} />;
    return short
        ? <a href={href} target="_blank" rel="noopener noreferrer" className="doi-link" title={url}>{url.replace(/^https?:\/\/(www\.)?/i, '')}</a>
        : <a href={href} target="_blank" rel="noopener noreferrer" className="doi-link">{truncateText(url, 40)}</a>;
}

const Field = ({label, children}) => <div><span className="detail-label">{label}:</span> <span className="detail-value">{children}</span></div>;

export function DetailRow({row}) {
    return <div className="detail-row">
        <div className="detail-grid">
            <div className="detail-card">
                <h6>Original Study</h6>
                <div className="detail-section">
                    <Field label="Title">{row.title_o || '-'}</Field>
                    <Field label="Authors">{authorList(row.author_o)}</Field>
                    <Field label="Year">{row.year_o || '-'}</Field>
                    <Field label="DOI"><DoiLink doi={row.doi_o} /></Field>
                    {row.journal_o && <Field label="Journal">{row.journal_o}</Field>}
                </div>
            </div>
            <div className="detail-card">
                <h6>{reportKindLabel(row)} report</h6>
                <div className="detail-section">
                    <Field label="Title">{row.title_r || '-'}</Field>
                    <Field label="Authors">{authorList(row.author_r)}</Field>
                    <Field label="Year">{row.year_r || '-'}</Field>
                    <Field label="Report"><UrlOrDoi url={row.url_r} doi={row.doi_r} /></Field>
                    {row.journal_r && <Field label="Journal">{row.journal_r}</Field>}
                </div>
            </div>
        </div>
        <div className="detail-card mt-3">
            <h6>Recorded evidence</h6>
            <div className="detail-section">
                <Field label="Outcome"><OutcomeBadge outcome={row.outcome} /></Field>
                {row.outcome_quote
                    ? <><div><span className="detail-label">Outcome quotation:</span> <span className="detail-value" style={{fontStyle: 'italic'}}>"{row.outcome_quote}"</span></div>
                        <p className="small">{row.outcome_quote_source ? `Source: ${row.outcome_quote_source}. ` : ''}This excerpt may cover only part of the findings and may not fully explain the recorded outcome.</p></>
                    : <p className="small">No supporting quotation is recorded for this pair.</p>}
                <Field label="Type">{row.type || '-'}</Field>
            </div>
        </div>
    </div>;
}
