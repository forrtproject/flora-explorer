// The explorer's building blocks. Every tab is assembled from these; styles live under the same names in app.css.

const cx = (...names) => names.filter(Boolean).join(' ');

// A page section: heading and explanation in the left column, figures and tables on the right.
// `wide` stacks them for content that needs the full width, such as a results table.
export function Section({title, level = 2, id, titleId, action, notes, wide, className, notesClass, children, ...rest}) {
    const Heading = 'h' + level;
    return (
        <section className={cx('section', wide && 'section--wide', className)} id={id} {...rest}>
            <div className={cx('section-notes', notesClass)}>
                {title && <div className="section-heading"><Heading className="section-title" id={titleId} tabIndex={titleId ? -1 : undefined}>{title}</Heading>{action}</div>}
                {notes}
            </div>
            <div className="section-body">{children}</div>
        </section>
    );
}

// The white panel that holds one chart or table: titles and an "N of M" line on the left, actions on the right.
export function Figure({title, note, actions, id, className, children, ...rest}) {
    const head = title || note || actions;
    return (
        <div className={cx('figure', className)} id={id} {...rest}>
            {head && (
                <div className="figure-head">
                    <div className="figure-titles">{title && <h3 className="figure-title">{title}</h3>}{note}</div>
                    {actions && <div className="figure-actions">{actions}</div>}
                </div>
            )}
            {children}
        </div>
    );
}

// tone: note (plum), caution (amber), empty (dashed, for missing or insufficient data).
export function Callout({tone = 'note', label, className, children, ...rest}) {
    return <div className={cx('callout', `callout--${tone}`, className)} {...rest}>{label && <strong>{label} </strong>}{children}</div>;
}

// Small secondary text: coverage lines, method notes, captions.
export function Note({as: Tag = 'p', className, children, ...rest}) {
    return <Tag className={cx('note', className)} {...rest}>{children}</Tag>;
}

export function Button({variant, className, children, ...rest}) {
    return <button type="button" className={cx('btn', variant && `btn--${variant}`, className)} {...rest}>{children}</button>;
}
export function IconButton({label, className, children, ...rest}) {
    return <button type="button" className={cx('icon-btn', className)} aria-label={label} title={label} {...rest}>{children}</button>;
}

export function Disclosure({summary, className, children, ...rest}) {
    return <details className={cx('disclosure', className)} {...rest}><summary>{summary}</summary>{children}</details>;
}

// A horizontally scrollable table region that keyboard users can reach.
export function TableScroll({label, className, children}) {
    return <div className={cx('table-wrap', className)} tabIndex={0} role="region" aria-label={label}>{children}</div>;
}
