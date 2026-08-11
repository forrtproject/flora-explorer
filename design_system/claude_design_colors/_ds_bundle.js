/* @ds-bundle: {"format":4,"namespace":"ReplicationAtlasDesignSystem_1196b5","components":[{"name":"SectionCard","sourcePath":"components/cards/SectionCard.jsx"}],"sourceHashes":{"components/cards/SectionCard.jsx":"c3514fb28519"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.ReplicationAtlasDesignSystem_1196b5 = window.ReplicationAtlasDesignSystem_1196b5 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/cards/SectionCard.jsx
try { (() => {
function contrastText(hex) {
  const c = hex.replace('#', '');
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6;
}
function SectionCard(props) {
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
    onLinkClick
  } = props;
  const rows = [{
    key: 'dark',
    color: palette.dark
  }, {
    key: 'base',
    color: palette.base
  }, {
    key: 'light',
    color: palette.light
  }, {
    key: 'faint',
    color: palette.faint
  }];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      width: 340,
      border: `2px solid ${palette.dark}`,
      borderRadius: 'var(--radius-card)',
      overflow: 'hidden',
      background: 'var(--surface-white)',
      fontFamily: 'var(--font-sans)',
      boxShadow: '0 1px 2px rgba(0,0,0,0.04)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '18px 20px 14px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-serif-display)',
      fontSize: 'var(--text-title)',
      fontWeight: 600,
      color: 'var(--text-primary)',
      lineHeight: 1.1
    }
  }, title), /*#__PURE__*/React.createElement("div", {
    style: {
      flexShrink: 0,
      marginTop: 4,
      padding: '4px 12px',
      borderRadius: 'var(--radius-pill)',
      background: status === 'FIXED' ? palette.dark : 'var(--surface-alt)',
      color: status === 'FIXED' ? '#fff' : 'var(--text-secondary)',
      fontSize: 'var(--text-badge)',
      fontWeight: 700,
      letterSpacing: '0.06em',
      textTransform: 'uppercase'
    }
  }, status)), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 6,
      fontSize: 'var(--text-subtitle)',
      color: 'var(--text-muted)'
    }
  }, subtitle)), /*#__PURE__*/React.createElement("div", null, rows.map(row => {
    const light = contrastText(row.color);
    return /*#__PURE__*/React.createElement("div", {
      key: row.key,
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 20px',
        background: row.color,
        color: light ? 'var(--text-primary)' : '#fff'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 'var(--text-swatch-label)',
        fontWeight: 500
      }
    }, row.key), /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-swatch-hex)'
      }
    }, row.color));
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '14px 20px',
      background: 'var(--surface-white)',
      borderTop: '1px solid var(--border-subtle)'
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: onPrimaryClick,
    style: {
      border: 'none',
      borderRadius: 'var(--radius-button)',
      background: palette.dark,
      color: '#fff',
      fontSize: 'var(--text-button)',
      fontWeight: 600,
      padding: '9px 16px',
      cursor: 'pointer'
    }
  }, primaryLabel), /*#__PURE__*/React.createElement("button", {
    onClick: onSecondaryClick,
    style: {
      border: 'none',
      borderRadius: 'var(--radius-pill)',
      background: palette.faint,
      color: palette.dark,
      fontSize: 'var(--text-button)',
      fontWeight: 600,
      padding: '9px 16px',
      cursor: 'pointer'
    }
  }, secondaryLabel), /*#__PURE__*/React.createElement("a", {
    onClick: onLinkClick,
    style: {
      marginLeft: 'auto',
      fontSize: 'var(--text-button)',
      fontWeight: 600,
      color: palette.dark,
      textDecoration: 'underline',
      cursor: 'pointer'
    }
  }, linkLabel)));
}
Object.assign(__ds_scope, { SectionCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/cards/SectionCard.jsx", error: String((e && e.message) || e) }); }

__ds_ns.SectionCard = __ds_scope.SectionCard;

})();
