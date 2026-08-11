# Replication Atlas Design System

## Context
This design system covers **FORRT's Replication Atlas**. It started from one explicit spec — a themed **section card** for the "Explore" section — then absorbed the product's real token sheet (colors, type, shape, motion, layout, component patterns) supplied directly by the user. No codebase or Figma file is attached; tokens below are transcribed from that sheet, not inferred.

The Explore section's palette is the primary/active reference (shown in the component card below), and is **fixed/frozen** per spec:
- `--primary-dark` (`--explore-dark`): `#612D53`
- `--primary` (`--explore-base`): `#853953`
- `--primary-light` (`--explore-light`): `#A04D6B`
- `--primary-faint` (`--explore-faint`): `#F9F0F4`

The `SectionCard` component takes palette + status as props, so other Atlas sections reuse it with their own four-stop palette.

## Content fundamentals
Too little product copy was provided to derive a voice/tone guide. Labels seen so far are short, lowercase-by-default UI words ("Open", "Active", "View all") with uppercase status/type badges (10px, 700 weight, tracked). Treat these as the only confirmed conventions; ask before inventing more copy style.

## Visual foundations
- **Color**: `--primary` ramp (dark/base/light/faint) drives brand + CTAs; `--neutral` (#2c2c2c) is the topbar/footer; `--surface`/`--surface-alt` are page/raised backgrounds; semantic success/warning/error/info each carry fg+bg+border triples. Study-type colors (original = blue, replication = violet) are a separate hardcoded pair in the source, not part of the token ramp — tokenized here for reuse but flagged as a deviation.
- **Text/border ramps**: `--text` → `--text-secondary` → `--text-muted` → `--text-faint`; `--border` / `--border-light`.
- **Type**: `--font-display` (Domine, serif) for headings/brand mark/citations/pull-quotes, often italic; `--font-body` (Source Sans 3) for everything else at 1.6 line-height. Scale is px-based and dense: 10px tracked-uppercase labels up to 14px, plus 1.15–1.2rem for detail headings. These are the brand's real fonts (Google Fonts import), not a substitution.
- **Shape**: `--radius` 6px / `--radius-lg` 10px default controls; pills 100px; modals 14px.
- **Elevation**: `--shadow-sm/md/lg` at 1px/4px/8px blur, 5–10% opacity.
- **Motion**: `--transition-fast` .12s (hover/color), `--transition` .2s (layout/bg); named keyframes slideUp, toast-in/out (spring), alertFadeIn/PopIn (ease-out), spin/rim-spin.
- **Layout**: fixed-height app shell (100dvh, no scroll) — 52px topbar → 360px/1fr main grid → footer; panels scroll independently on thin custom scrollbars. Breakpoints are all max-width: 960px → single column, 700px → modal stacks, 640px → detail title shrinks, 400px → minimal padding.
- **Component patterns**: pill chips (100px radius, active = primary-faint bg + tinted border); three button tiers (filled/outline/ghost); active list rows get a 3px primary left rail; a 14px dot↔checkbox morph on hover; uppercase 10px semantic status badges; overlays use dark backdrop ± blur on alert/citation modals; toasts are 380px right-stacked cards with a 4px semantic left border.
- **Known gaps in source**: `--radius-sm`, `--radius-md`, `--text-primary` are referenced but never defined upstream (silently drop) — mapped to `--radius`/`--text` here instead. A `dark` variant is declared but unused (light-only today). `css/style.css` is dead legacy (green/gray theme) — not used as a design reference.

## Iconography
None provided or used — the card is text/color driven only.

## Components
- **SectionCard** (`components/cards/SectionCard.jsx`) — the themed section card described above. Props: `title`, `subtitle`, `status`, `palette{dark,base,light,faint}`, `primaryLabel`, `secondaryLabel`, `linkLabel`, click handlers. Starting point (`Components` group).

## Index
- `styles.css` — global entry, imports `tokens/colors.css`, `tokens/typography.css`, `tokens/spacing.css`
- `components/cards/SectionCard.{jsx,d.ts,prompt.md}` + `section-card.card.html` (Design System tab card)
- `thumbnail.html` — project tile
- `SKILL.md` — Claude Code–portable version of this guide

## Caveats / ask
This system currently covers exactly one component family (`SectionCard`) because that's all that was specified — no other UI, product screens, or assets exist yet. **Please attach a codebase, Figma file, or more brand materials** if you'd like a fuller design system (more components, real fonts/logo, product UI kits). Also flag if the Inter/Source Serif 4 substitution needs to change.
