# FLoRA Explorer

A static React dashboard for the [FORRT Library of Reproduction and Replication Attempts (FLoRA)](https://forrt.org/replication-hub/flora). Each database row is a **reference pair**, linking an original report to a replication or reproduction report. Reports can occur in multiple pairs.

| View | Purpose | Data refresh |
|---|---|---|
| Overview | Reference-pair counts and separate replication, computational and robustness outcomes | Daily |
| Browse reference pairs | Shared desktop/mobile search, full evidence, outcome quotes with their source, links and filtered CSV export | Daily |
| Years & Disciplines | Outcome counts by year, venue and discipline | Daily |
| Citation Impact | Citation trajectories, adjusted associations, co-citation rates and individual timelines | Weekly |
| Mean Citedness | Journal-level citation metric distributions and a conditional replication-success model | Weekly |
| Authorship Overlap | Within-group outcome percentages based on surname overlap | Daily |
| Publication Type | Recorded venue categories, Registered Reports matching and reports with multiple original targets | Daily / weekly |

Every chart has a nearby data table and a compact button to copy its CSV data. Browse reference pairs also offers a CSV download of the current selection. Group comparisons default to within-group percentages, with a count toggle and group denominators. Search, study-type selections and key controls are recorded in the URL. Citation timelines have independently shareable links.

## Run locally

The explorer is a React app built with Vite. With Node.js 22:

```sh
npm ci
npm run dev
```

Open the address Vite prints (by default <http://localhost:5173/>). The dev server serves the committed `data/` snapshots directly. `npm run build` writes the static site, including a copy of `data/`, to `dist/`; `npm run preview` serves that build. Libraries and fonts are bundled, so the built site needs no CDN.

`.github/workflows/deploy.yml` builds and publishes `dist/` to GitHub Pages on each push to `main` and after each data refresh. The repository's Pages source must be set to **GitHub Actions**.

## Data and interpretation

- **Replication outcomes:** explicit mappings retain “statistically successful but flawed” as a separate qualified category. Descriptive only, Uninformative, Missing outcome and Unrecognised outcome remain separate. Unsupported values, including a future “inconclusive” code, remain unrecognised. Labels, definitions and aliases are shared in `data/outcome_vocabulary.json`. Only unqualified successful and failed outcomes enter the binary Mean Citedness model; the citation cohort uses successful, failed and mixed outcomes.
- **Reproduction outcomes:** computational reproducibility and robustness are independent dimensions. Each includes only assessed outcomes. The same pair can appear in both subsets. Reproduction models are not fitted; their summaries are descriptive.
- **Publication venues:** recognisable repositories/preprints, conference outputs and theses are separated. Missing venues remain unknown. “Other named venue” does not verify journal publication or peer review.
- **Registered Reports:** matching uses the [RRDB CSV](https://github.com/LukasRoeseler/RRDB/blob/main/zotero_registered_reports.csv). A non-match is not evidence that a report was not registered.
- **Report size:** more than three distinct original targets defines a multiple-target report. This does not establish the number of laboratories or membership of a coordinated project. Charts count pairs; evidence lists count reports. Different snapshots/cohorts can have different coverage.
- **Citation timelines:** stacked categories are mutually exclusive. A work citing replications from multiple outcome categories appears once in a separate segment. Outcome-specific rate tables overlap and must not be summed.
- **Citation trajectories:** descriptive only; no regression model is fitted. Each original is aligned at its first recorded replication (t = 0). Citation means use a balanced panel of originals observed from t = −5 to +5; co-citation means use originals observed from t = 0 to +5, since co-citation is impossible before a replication exists. Counts stop at the last complete calendar year. Outcome groups use the earliest recorded replication year; same-year ties follow stored record order.
- **Mean Citedness:** a journal's lifetime OpenAlex citations divided by its papers, retrieved at enrichment time, not matched to the original publication year. Journals with fewer than 20 papers, or where a single journal-level placeholder record accounts for at least 10% of all their citations, are set aside. The logistic smooth conditions on unqualified successful/failed outcomes, on log(OMC + 1). The histogram retains other outcomes. The 50% line is a reference, not a chance baseline.

The data are not representative of all research. Shared reports, repeated targets, journals and projects create dependence. Read the coverage and matching caveats alongside each view.

## Source layout

- `index.html`, `src/main.jsx`, `src/App.jsx`: page shell, top bar and the seven tab panes.
- `src/tabs/`: one component per view; `CitationImpact.jsx` also holds the timeline dialog.
- `src/components/`: shared pieces — charts with their data tables and CSV copy, outcome badges, filters, definitions and update stamps.
- `src/state/`: data loading, URL-backed view state (shareable links, back/forward) and theme.
- `src/lib/`: framework-free logic — outcome vocabulary and classification, search, aggregation, chart preparation, FAQ and citation parsing. `hooks.js` exposes read-only state on `window` for the console and the browser tests.
- `src/styles/`: `tokens.css` (FORRT design tokens, light and dark) and `app.css` (components in the Replication Atlas visual language); fonts are self-hosted under `src/assets/fonts/`.
- `vite.config.js`: build settings; serves `data/` in development and copies it into `dist/`.
- `data/`: committed snapshots, chart summaries and a curated journal-to-discipline map.
- `data/originals_index.json`: compact citation table index; full records are fetched from `data/originals/` only when opened. `originals.json` remains available for bulk download and reproducible recalculation.
- `scripts/classification.py`: explicit outcome, venue and reproduction-dimension categories.
- `scripts/`: data preparation and analysis pipelines.
- `cache/`: committed OpenCitations and OpenAlex responses. Cache timestamps are preserved independently of filesystem checkout dates.
- `archive/`: superseded R Markdown analysis and rendered artifacts.
- `tests/`: browser acceptance scenarios and pipeline regression checks.

## Refresh data

```sh
python3 -m venv .venv
. .venv/bin/activate
pip install -r scripts/requirements.txt
python scripts/refresh_flora.py
python scripts/compute_author_overlap.py
python scripts/compute_pub_status.py
python scripts/compute_rr_status.py
```

OpenAlex enrichment uses `MY_EMAIL`. The citation pipeline also accepts an optional `OC_API_KEY`. Keep credentials in environment variables or GitHub Actions secrets.

```sh
python scripts/compute_omc.py
Rscript scripts/render_impact_factor.R
python scripts/refresh_data.py
```

R requires `jsonlite` and `mgcv`. The citation refresh can run for several hours; do not use it just to test the UI. All data workflows share a concurrency group and stagger their schedules. A failed lookup is not treated as evidence of zero citations. Empty citation runs preserve previous outputs; partial runs are labelled.

To recalculate the existing citation cohort from its committed cache, without network requests:

```sh
python scripts/rebuild_cached_citations.py
```

This validates cache availability, recomputes the timelines and models, and writes the compact index and individual records. The original coverage date stays unchanged; a separate recalculation date records the computation. It does not expand the citation cohort. `scripts/run_fect.R` is retained as an optional research analysis and is not part of the deployed OLS figures or scheduled workflows.

For vocabulary-only RR summaries, `python scripts/compute_rr_status.py --cached-matches` reuses the committed positive matches, checks that coverage is unchanged and retains its coverage date.

## Validate changes

```sh
pip install -r scripts/requirements.txt
python -m unittest discover -s tests -p 'test_*.py'
npm ci
npm test
```

`npm test` builds the site first. Browser tests then serve `dist/` from their own local server and use installed Chrome by default. For Playwright's bundled Chromium, run `npx playwright install chromium` and set `BROWSER_CHANNEL=chromium`. Tests cover desktop/mobile search, shared views, stale model state, keyboard evidence access, model intervals, responsive redraws, accessible tables and reconciliation of generated counts.

[Validation notes](docs/review-validation.md) record the current acceptance results and data coverage. Contributions of additional views are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).

## Suggested citation

Wallrich, L., & Röseler, L. (2026). *FLoRA Explorer* [Website]. <https://forrt.org/flora-explorer/>
