import React from 'react';

function contrastText(hex) {
  const c = hex.replace('#', '');
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6;
}

export function SectionCard(props) {
  const {
    title,
    subtitle,
    status,
    palette,
    primaryLabel,
    secondaryLabel,
    linkLabel,
    onPrimaryClick,
    onSecondaryClick,
    onLinkClick,
  } = props;

  const rows = [
    { key: 'dark', color: palette.dark },
    { key: 'base', color: palette.base },
    { key: 'light', color: palette.light },
    { key: 'faint', color: palette.faint },
  ];

  return (
    <div style={{
      width: 340,
      border: `2px solid ${palette.dark}`,
      borderRadius: 'var(--radius-card)',
      overflow: 'hidden',
      background: 'var(--surface-white)',
      fontFamily: 'var(--font-sans)',
      boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
    }}>
      <div style={{ padding: '18px 20px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{
            fontFamily: 'var(--font-serif-display)',
            fontSize: 'var(--text-title)',
            fontWeight: 600,
            color: 'var(--text-primary)',
            lineHeight: 1.1,
          }}>{title}</div>
          <div style={{
            flexShrink: 0,
            marginTop: 4,
            padding: '4px 12px',
            borderRadius: 'var(--radius-pill)',
            background: status === 'FIXED' ? palette.dark : 'var(--surface-alt)',
            color: status === 'FIXED' ? '#fff' : 'var(--text-secondary)',
            fontSize: 'var(--text-badge)',
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}>{status}</div>
        </div>
        <div style={{
          marginTop: 6,
          fontSize: 'var(--text-subtitle)',
          color: 'var(--text-muted)',
        }}>{subtitle}</div>
      </div>

      <div>
        {rows.map(row => {
          const light = contrastText(row.color);
          return (
            <div key={row.key} style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 20px',
              background: row.color,
              color: light ? 'var(--text-primary)' : '#fff',
            }}>
              <span style={{ fontSize: 'var(--text-swatch-label)', fontWeight: 500 }}>{row.key}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-swatch-hex)' }}>{row.color}</span>
            </div>
          );
        })}
      </div>

      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '14px 20px',
        background: 'var(--surface-white)',
        borderTop: '1px solid var(--border-subtle)',
      }}>
        <button onClick={onPrimaryClick} style={{
          border: 'none',
          borderRadius: 'var(--radius-button)',
          background: palette.dark,
          color: '#fff',
          fontSize: 'var(--text-button)',
          fontWeight: 600,
          padding: '9px 16px',
          cursor: 'pointer',
        }}>{primaryLabel}</button>
        <button onClick={onSecondaryClick} style={{
          border: 'none',
          borderRadius: 'var(--radius-pill)',
          background: palette.faint,
          color: palette.dark,
          fontSize: 'var(--text-button)',
          fontWeight: 600,
          padding: '9px 16px',
          cursor: 'pointer',
        }}>{secondaryLabel}</button>
        <a onClick={onLinkClick} style={{
          marginLeft: 'auto',
          fontSize: 'var(--text-button)',
          fontWeight: 600,
          color: palette.dark,
          textDecoration: 'underline',
          cursor: 'pointer',
        }}>{linkLabel}</a>
      </div>
    </div>
  );
}
