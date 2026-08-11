Themed status card for a Replication Atlas section — title, status badge, four color swatches, and an action footer, driven entirely by props so every section reuses the same component.

```jsx
<SectionCard
  title="Explore"
  subtitle="Replication Atlas · frozen"
  status="FIXED"
  palette={{ dark: '#612D53', base: '#853953', light: '#A04D6B', faint: '#F9F0F4' }}
  primaryLabel="Open"
  secondaryLabel="Active"
  linkLabel="View all"
/>
```

Variants:
- **status**: any short word works ("FIXED", "DRAFT", "BETA") — badge always renders dark-bg/white-text regardless of the word.
- **palette**: swap in a different section's four-stop palette; swatch text color auto-flips (white on dark/base, dark on light/faint).
- Card border always uses `palette.dark`, marking it as the active/reference card for that section.
