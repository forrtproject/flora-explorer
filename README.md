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

The interface follows the **FORRT design system**, transcribed from its
living style guide. `assets/ds-tokens.css` holds the system's tokens —
the frozen `#853953` brand ramp, semantic fg/bg/border triples, the
study-type blue/violet pair, the replication-outcome ramp, Domine +
Source Sans 3, the 10→36px type scale, the 4px spacing grid, the
2→14px radius ladder, elevation and focus rings, and the motion
durations — plus a `[data-theme="dark"]` block that extends the system,
which is light-only upstream.

Upstream carries two naming layers (the generated `--color-*` scale and
a short legacy alias layer). Only `--color-*` is kept here, so there is
one name per value. Add new UI by reaching for a token, not a literal
hex — including in charts, where `token('--color-…')` in `app.js`
resolves the current theme's value at render time.

The type scale in use, top to bottom: hero `--text-5xl` (48px) → tab page
title `--text-3xl` (30px) → card header `--text-2xl` (24px) → sub-heading
`--text-xl` (18px) → body `--text-lg` (16px) → metadata and controls
`--text-md` (14px) → dense metadata `--text-sm` (12px) → uppercase
micro-labels and badges `--text-xs` (11px). Headline figures (overview
stat cards, KPI band, Mean Citedness stat boxes) all sit at `--text-4xl`
so the same kind of number is the same size wherever it appears.

`assets/styles.css` follows the system's component conventions:

- the display serif marks scholarly content only — never navigation or buttons
- filled controls darken on hover; ghost and outline controls take on the brand colour instead of gaining a fill
- badges state a fact: uppercase, bold, tracked, `--text-2xs`
- chips are stateful: active is a maroon tint plus a maroon border, never a fill
- focus is replaced with `--shadow-focus-primary`, never removed

Four deliberate deviations:

1. The system specifies a fixed-height `100dvh` app shell with
   independently scrolling panels. FLoRA Explorer is a scrolling
   multi-tab dashboard and keeps normal page flow.
2. The WIP corner ribbon stays on the error ramp. On brand plum it
   reads as decoration rather than caution.
3. The dark extension moves `--color-primary` itself up the ramp. At
   `#853953` the maroon fails contrast on a dark surface, so a single
   brand token can serve both themes rather than every rule carrying a
   dark-mode override.
4. The system sets body copy at 14px and interface text at 13px, and its
   ramp stops at 36px. That density suits its three-pane explorer, read
   close up. This is a wide scrolling dashboard, so body copy moved to
   16px and the ramp gained `--text-3xl` (30px) and `--text-5xl` (48px).
   Legibility beat fidelity here.

## Acknowledgements

- Data: [FORRT FReD project](https://github.com/forrtproject/FReD-data)
- Citation backend: [OpenCitations COCI](https://opencitations.net)
- Journal Mean Citedness: [OpenAlex Sources API](https://docs.openalex.org/api-entities/sources)

## Suggested citation

> Wallrich, L., & Röseler, L. (2026). *FLoRA Explorer* [Website].
> <https://forrt.org/flora-explorer/>
