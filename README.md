# FLoRA Explorer

A static, GitHub-Pages-friendly dashboard for the [FORRT Library of
Replication Attempts (FLoRA)](https://forrt.org/replication-hub/flora).

Five tabs:

| Tab                      | What it shows                                                   | Refreshed |
|--------------------------|-----------------------------------------------------------------|-----------|
| **Overview**             | Headline counts, outcome distribution, About, FAQ, citations    | Daily     |
| **Browse Studies**       | Full searchable DataTable + mobile card list                    | Daily     |
| **Years & Disciplines**  | Year/journal/discipline breakdowns of outcomes                  | Daily     |
| **Citation Impact**      | OpenCitations event-study of citation changes after replication | Weekly    |
| **Mean Citedness**       | Journal-level OMC vs replication success (R analysis)           | Weekly    |

Every tab shows a "Last updated" stamp pulled from the relevant
`*_meta.json` next to the data.

Contributions of new dashboards/tabs are welcome — see
[CONTRIBUTING.md](CONTRIBUTING.md).

## Layout

```
.
├── index.html
├── assets/
│   ├── ds-tokens.css          # Replication Atlas design tokens (+ dark extension)
│   ├── styles.css             # Component styles, built on those tokens
│   ├── app.js                 # Overview / Browse / Years & Disciplines / Mean Citedness loader
│   ├── citation-impact.js     # Citation Impact tab (lazy-loaded)
│   └── logo.svg
├── data/                      # All written by GitHub Actions, except disciplines.json
│   ├── disciplines.json       # Hand-curated journal → discipline map (commit-controlled)
│   ├── flora.csv              # Daily snapshot of upstream flora.csv
│   ├── flora_meta.json
│   ├── flora_with_omc.csv     # FLoRA + OpenAlex OMC per journal_o (weekly)
│   ├── flora_with_omc_meta.json
│   ├── impact_factor_data.json # Chart-ready Mean Citedness data (weekly)
│   ├── impact_factor_meta.json
│   ├── author_overlap_data.json # Authorship Overlap tab data (daily)
│   ├── author_overlap_meta.json
│   ├── meta.json              # Citation pipeline (weekly)
│   ├── aggregate.json
│   └── originals.json
├── scripts/
│   ├── refresh_flora.py       # Daily flora.csv snapshot
│   ├── refresh_data.py        # Weekly OpenCitations citation pipeline
│   ├── compute_omc.py         # Weekly OpenAlex OMC enrichment
│   ├── compute_author_overlap.py # Daily authorship-overlap computation
│   ├── render_impact_factor.R # Computes Mean Citedness stats, writes JSON directly
│   ├── run_fect.R             # ETWFE overlay for Citation Impact (not yet wired into a workflow)
│   └── requirements.txt
├── archive/                   # Superseded scripts/outputs, kept for reference only
│   ├── scripts/                #   compute_impact_json.py, impact_factor.Rmd
│   └── data/                   #   impact_factor.html + impact_factor_figs/
├── cache/                     # API caches committed between runs
│   ├── oc/                    # OpenCitations
│   └── openalex_venues.json   # OpenAlex sources
└── .github/workflows/
    ├── refresh-flora.yml          # Daily   03:00 UTC (flora.csv + author overlap)
    ├── refresh-data.yml           # Weekly Mon 04:00 UTC (citation pipeline)
    ├── refresh-impact-factor.yml  # Weekly Mon 05:00 UTC (OMC + R render)
    └── clean-json.yml             # Manual maintenance helper
```

## Deploying on GitHub Pages

1. Push this repository to GitHub.
2. **Settings → Pages → Build and deployment → Source: *Deploy from a branch*.**
   Pick `main` and `/ (root)`.
3. **Settings → Secrets and variables → Actions** — add the secrets used by
   the data-refresh workflows:
   - `MY_EMAIL` — your email. Used in the polite User-Agent header for
     OpenAlex and OpenCitations. Required.
   - `OC_API_KEY` — *optional* OpenCitations API key (raises rate limits).
4. **Settings → Actions → General → Workflow permissions:** select
   *Read and write permissions* so the bot can commit refreshed data
   back to the repo.
5. Trigger the workflows manually the first time
   (`Actions → Refresh FLoRA snapshot → Run workflow`, etc.) so the data
   files appear. Subsequent runs follow the cron schedule.

That is the entire deploy — no build step, no server.

Until the first refresh has run, the Explorer falls back to fetching
`flora.csv` directly from the FReD-data repository so the Overview /
Browse / Years tabs still work.

## Running data refreshes locally

```bash
pip install -r scripts/requirements.txt

# Daily snapshot (just pulls flora.csv)
python scripts/refresh_flora.py

# Mean Citedness pipeline (needs R)
MY_EMAIL=you@example.org python scripts/compute_omc.py
Rscript scripts/render_impact_factor.R

# Citation Impact pipeline (long-running; uses OpenCitations)
MY_EMAIL=you@example.org python scripts/refresh_data.py

# Authorship Overlap (needs flora.csv already downloaded)
python scripts/compute_author_overlap.py
```

R packages required: `jsonlite`, `mgcv`.

## Editing the disciplines map

`data/disciplines.json` is the **single source of truth** for the
journal → discipline mapping used both by the JS frontend (Years &
Disciplines tab) and by the R Mean Citedness analysis. Edit it once and
both views update on the next deploy / refresh.

## Styling

The interface follows the **Replication Atlas design system**
(FORRT's Explore palette). `assets/ds-tokens.css` holds the system's
tokens verbatim — the frozen `#853953` brand ramp, semantic
fg/bg/border triples, the study-type blue/violet pair, Domine +
Source Sans 3, the 6/10/100/14px shape scale, three elevation levels
and the `.12s`/`.2s` motion pair — plus a `[data-theme="dark"]` block
that extends the system, which is light-only upstream.

`assets/styles.css` consumes those tokens; component rules follow the
system's conventions (10px tracked-uppercase micro-labels, pill chips
that go faint-tinted rather than solid when active, 3px brand left
rails on notable rows, dark topbar paired with a dark footer). Chart
palettes in `app.js` / `citation-impact.js` use the same semantic
colours. Add new UI by reaching for a token, not a literal hex.

One deliberate deviation: the system specifies a fixed-height
`100dvh` app shell with independently scrolling panels. FLoRA Explorer
is a scrolling multi-tab dashboard and keeps normal page flow.

## Acknowledgements

- Data: [FORRT FReD project](https://github.com/forrtproject/FReD-data)
- Citation backend: [OpenCitations COCI](https://opencitations.net)
- Journal Mean Citedness: [OpenAlex Sources API](https://docs.openalex.org/api-entities/sources)

## Suggested citation

> Wallrich, L., & Röseler, L. (2026). *FLoRA Explorer* [Website].
> <https://forrt.org/flora-explorer/>
