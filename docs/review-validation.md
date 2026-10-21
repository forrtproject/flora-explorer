# Validation of the consolidated FLoRA Explorer

The explorer includes all seven development views, the expanded journal-to-discipline map, shared FORRT design tokens, the audit fixes and on-demand citation loading. Reference-pair classifications and displayed counts are consistent across desktop and mobile layouts.

Verified against the committed snapshots on 13 September 2026:

- Power Posing topic search returns four pairs: three failed and one mixed. Desktop rows, mobile cards and the outcome chart agree. DOI URLs and author/year searches work across layouts; shared searches survive reloads.
- Switching from replications to either reproduction dimension removes all replication-model statistics and the old model's data table. The replacement states that no reproduction model was fitted.
- All 2,146 citation timelines reconcile with their unique citing-work totals. Power Posing totals 655, including 35 works that co-cite replications from multiple outcome categories, counted once.
- Citation coefficients have visible 95% intervals on the log(1 + count) scale. Raw count trajectories are separate.
- The seven qualified-success pairs remain visibly qualified. The replication Mean Citedness histogram includes all 2,376 matched pairs, including seven qualified and 11 other/uncoded outcomes.
- Publication metadata yield 257 unknown-venue replication pairs, 50 conference-output pairs and three thesis/dissertation pairs. These are not labelled peer-reviewed journal articles.
- Keyboard users can open study evidence and timelines, dismiss the timeline with Escape, and return focus to the originating control. Focus remains within the open dialog.
- All chart renderers expose readable data tables and CSV exports. Group comparisons default to percentages and show denominators. Charts and controls were exercised at desktop, 390-pixel and 320-pixel widths, including dark-theme redraws.

## Review coverage

| Findings in the 13 September user-testing review | Current behaviour |
|---|---|
| 1, 9: search and chart disagreement | One query and filtered population drive rows, cards, counts and charts; DOI-prefix normalisation and token-based search are shared. |
| 2: stale model results | Model statistics and data tables are cleared before selecting the new dataset. |
| 3: citation double-counting | Mutually exclusive timeline segments and unique citing-work IDs; regenerated data reconcile at year and original levels. |
| 4: missing confidence intervals | Separate coefficient plots display 95% intervals. |
| 5: simplified outcomes | Explicit outcome mappings; qualified success remains separate; reproduction dimensions receive separate badges. |
| 6: publication-status overclaims | Unknown, thesis, conference and repository categories; remaining names are labelled other named venue. |
| 7: keyboard barriers | Named details/timeline buttons, modal semantics, focus containment, Escape and focus restoration. |
| 8: charts and selected-state accessibility | Adjacent data tables, CSV exports and programmatic pressed states. |
| 10: mobile clipping and navigation | Explicit mobile tab selector, wrapped chart labels, dynamic journal-chart heights, horizontal mobile group comparisons and responsive plot margins. |
| 11: badge contrast | Darkened green with white text; dark text on amber; labelled outcomes in both themes. |
| 12: counting unit and exclusions | Reference-pair definition near the total, filtered match counts, chart sample notes and explicit other/qualified categories. |
| 13: group comparisons | Within-group percentages by default, count toggle and displayed group denominators; dependence caveats retained. |
| 14: inconsistent project size | More than three recorded original targets defines multiple-target reports; labels describe target count rather than collaboration size. |
| 15: model interpretation | Adjusted-association language, coefficient-scale intervals and explicit outcome/cohort selection. |
| 16: Mean Citedness interpretation | Journal-level measure and enrichment vintage explained; conditional model population and 50% reference labelled. |
| 17: finding and inspecting studies | Search at the top of Browse, compact citation disclosures, opening routes and mobile evidence quotations. |
| 18: sharing and exporting | URL state for query, kind, sorting and analytical selections; filtered-pair and chart CSV exports carry context. |
| 19: stale and unfinished states | Multiple-target loading clears, missing venue strings are normalised, reproduction model text is specific, trends start with replications. |

## Checks

- Eight browser/data acceptance suites passed, including CSV export and asynchronous restoration of shared citation filters. Browser scenarios: desktop/mobile search, DOI and author/year input, zero matches, reloads, evidence controls, model switching, timeline deep links, interval traces, all seven tabs, percentages, venue evidence and responsive redraws.
- Generated-data invariants: each timeline reconciles with citation and co-citation totals; all group outcome counts and Mean Citedness histogram bins reconcile with their displayed populations.
- Fifteen Python regression tests passed: qualified and two-dimensional outcomes, venue evidence, mutually exclusive citation counts, failed reproduction lookups, shared reproduction reports and preservation of outputs after an empty run.
- Additional regressions cover delayed Chart.js loading and chart ownership, FAQ attribute escaping, strict journal-name matching and cached hits, safe enrichment timeouts, canonical report keys, invalid RRDB responses, preserved report-size labels, citation request budgets, invalid reproduction outcome sheets, and merged-DOI reproduction records.
- Exact search totals use a fixed, documented four-pair fixture. Current Mean Citedness totals are independently reconciled with the enriched CSV; venue counts are checked against the current FLoRA CSV.
- JavaScript/Python syntax checks and R parsing/rendering.

The stricter journal-name check removed 47 unverified cached matches affecting 111 enriched reference pairs. These entries are eligible for lookup again during the next enrichment run. The current summaries exclude their Mean Citedness values: 2,376 replication pairs, 208 numerical-reproduction pairs and 148 robustness-reproduction pairs remain in the respective analyses. The original enrichment coverage date is retained separately from the recalculation date. Recalculating report-size keys found no changed classifications in the current data.

These checks do not independently validate primary-study coding, establish the causal identification of the models, or certify compatibility with every screen reader/browser. Venue and surname classifications remain labelled heuristics. Citation and Mean Citedness snapshots have different coverage dates from the daily pair-level dataset.

<details>
<summary>Integration provenance</summary>

The source histories combined were `forrtproject/flora-explorer` at `7fa9750` and `LukasRoeseler/flora-explorer` at `84905bd`. Relevant changes from the pipeline, workflow, frontend, Mean Citedness and documentation audit branches and `perf/split-originals-json` were integrated with the development features. The 13 September user-testing review supplied the acceptance scenarios above.

</details>

## 21 October 2026 usability review: technical fixes

The agent-led review (simulated newcomer, researcher and accessibility perspectives; no recruited participants) recorded findings F01–F20 against the 3,059-pair snapshot. Each was checked against the source and, for interactive claims, in a rendered browser. This section covers behaviour and accessibility fixes. Its only copy changes are the zero-result messages, the citation search label and chart captions taken from visible titles; analytical wording, outcome labels and axis changes are reviewed separately.

- F01: after switching Mean Citedness to a reproduction dimension, the orphaned copy button still copied all 1,250 replication-model rows, labelled with the reproduction selection. Removing a chart now removes its table, copy action, status region and `aria-describedby` together; reproductions show the existing descriptive note in place of an empty model card.
- F13: the model table lists one row per curve point with its estimate and 95% interval, then the 800-pair display sample with raw OMC and 0/1 outcomes. Jittered positions and the internal `_lo`/`_hi` traces are no longer exported. The sample has no pair identifiers.
- F02: Trends columns use `minmax(0, 1fr)`, so charts and text reflow after a desktop-to-narrow resize without changing tabs.
- F03: placeholders use `--color-muted-fg`: at least 4.5:1 against the input background (`--color-surface-raised`) in both themes.
- F05, F06, F16: Browse explains zero results, does not claim absence of evidence, and offers clear-search, all-types, Atlas and submission actions. With All studies selected, the empty outcome card is hidden, so a four-result search shows its first row in a 1633×830 viewport.
- F04: narrow citation timelines number each replication event to match the numbered list.
- F14, F15, F20: the citation search has a visible label; FAQ Markdown renders in questions; captions and accessible names use the visible title where the chart has one (otherwise its ID); tab-level headings are sequential (Browse detail rows still use `<h6>`) and copy actions sit outside headings; mobile cards have a sort control.

The browser suite's readiness check now consumes its HTTP response; previously an unconsumed stream intermittently raised an uncaught `assert(!this.paused)` after the `before` hook.

## 21 October 2026 usability review: wording, labels and axes

These changes alter analytical wording and labels, so they were reviewed separately. An independent model review (GPT 6.1 Sol) checked every study-type-specific sentence against the pipeline scripts before publication.

- F07, F08: row counts are labelled reference pairs. Each Overview and Browse outcome chart states its denominator and outcome counts above the bar; the computational and robustness captions also give the unassessed count and note that dimensions overlap, and a coverage caution precedes the first chart. Citation KPIs state that eligible pair counts are measured before citation lookup.
- F10: the original-year chart pools the sparse years before 1960 (16 replication pairs across 1880–1959) into one column, set apart by a dashed line. From 1960, and on the report-year chart, every calendar year has a slot, so gaps keep their scale. Plotted totals still equal the pairs with a valid year.
- F11: headings and prose in Trends, Mean Citedness, Authorship Overlap, Publication Type and Citation Impact follow the selected study type. Reproduction variants describe descriptive comparisons, pair-level units and RRDB matching without replication-specific reasoning; replication-report venues are described as recorded venues, which include repositories.
- F15, F17: the duplicated About aim is merged, Browse and the Replication Atlas are described by purpose, and missing entries link directly to the submission form. About text no longer implies FLoRA estimates replication rates.
