# Contributing to FLoRA Explorer

We welcome bug reports, documentation, accessible visualisations, tests, and new views of the [FORRT Library of Reproduction and Replication Attempts (FLoRA)](https://forrt.org/replication-hub/flora/). Follow the [FORRT Code of Conduct](https://forrt.org/coc/).

## Choose a contribution

Search [existing issues](https://github.com/forrtproject/flora-explorer/issues) and [pull requests](https://github.com/forrtproject/flora-explorer/pulls) before starting. Report the affected view, steps to reproduce, browser and screen size, expected behaviour, and actual behaviour. Share a public view URL or a small synthetic example where possible. Discuss new tabs, data sources, outcome mappings, and analysis changes in an issue before implementing them.

The [README view table and source layout](README.md) describe the current dashboard. UI and documentation fixes usually need no data refresh. Data corrections and ingestion/validation suggestions belong in [flora-validation](https://github.com/forrtproject/flora-validation).

## Set up locally

Fork this repository, then replace `YOUR-USERNAME` below:

```sh
git clone https://github.com/YOUR-USERNAME/flora-explorer.git
cd flora-explorer
git remote add upstream https://github.com/forrtproject/flora-explorer.git
git switch -c describe-your-change
python3 -m http.server 8876 --bind 127.0.0.1
```

Open <http://127.0.0.1:8876/>. There is no frontend build step. Serve the committed `data/` snapshots; opening `index.html` as a file will not reliably support its fetch requests. Browser libraries load from CDNs, so the page and browser tests need network access to those libraries.

## UI and documentation changes

Edit `index.html` and the relevant files under `assets/`. Keep chart data tables, CSV exports, URL state, keyboard navigation, and mobile behaviour consistent with the visual view. Check both desktop and narrow-screen layouts and provide screenshots for visible changes.

Install Node.js 22 (as in CI) and npm and either Chrome or Playwright's Chromium to run browser acceptance tests:

```sh
npm ci
npm test
```

The tests start their own Python HTTP server on port 8897 and use installed Chrome by default. To use bundled Chromium instead:

```sh
npx playwright install chromium
BROWSER_CHANNEL=chromium npm test
```

`tests/fixtures/browse.csv` is a small browse fixture; other scenarios read committed dashboard data. CI runs both the Python regression suite and browser suite for changes to source, scripts, tests, or package files. The suite does not run a live data refresh, but it is not completely offline because the page uses CDNs. See [fixture notes](tests/fixtures/README.md) and [validation notes](docs/review-validation.md). Add regression coverage for changed behaviour; do not replace expected results solely to make a failing check pass.

## Pipeline and analysis changes

Use Python in a virtual environment and run the pipeline regression suite:

```sh
python3 -m venv .venv
. .venv/bin/activate
pip install -r scripts/requirements.txt
python -m unittest discover -s tests -p 'test_*.py'
```

The README's **Refresh data** section lists the entry points and R dependencies. Start with small synthetic test cases (see `tests/test_pipeline.py`) or existing caches. The full citation refresh can take hours and call external APIs; it is unnecessary for UI work. `python scripts/rebuild_cached_citations.py` recalculates the existing cohort without network calls but writes generated outputs. It keeps the original coverage date and records a separate recalculation date; inspect its diff.

Keep credentials in environment variables or Actions secrets, never in code, fixtures, logs, or commits. Discuss any paid or high-volume API refresh with maintainers first. Include only intended output changes in your PR and explain how they were generated.

### Preserve scientific meaning

- Database rows are **reference pairs**. Distinguish pair counts from unique reports, original targets, and citation works, and state each denominator.
- Preserve qualified replication outcomes and unknown/not-coded values. Do not silently turn unknown values into failures or zeros, or include them in a binary model.
- Computational reproducibility and robustness are separate assessed dimensions. Their subsets may overlap; do not add them as if they were disjoint.
- Citation models describe adjusted associations. Preserve scale, comparison group, uncertainty, cohort rules, coverage dates, and limits on causal interpretation.
- Missing venue information remains unknown. An RRDB non-match is recorded as non-RR when a DOI or title is available, but does not establish absence of registration or peer review. Reports with neither a DOI nor a title remain unknown.

Use the README's **Data and interpretation** section and `scripts/classification.py` as the starting points. Explain any proposed change to these rules explicitly and include small synthetic tests for category and denominator behaviour.

### Add a view or data source

Reuse an existing snapshot or cache when possible. A new view over existing data needs frontend code and relevant tests, not necessarily another workflow. For new data, add scripts under `scripts/`, a scheduled workflow under `.github/workflows/`, static JSON/CSV outputs, and metadata with coverage and refresh timestamps. Use the existing shared concurrency group and commit-and-push pattern. Choose daily refreshes for inexpensive work and weekly/monthly refreshes for heavier API calls or models; preserve cache timestamps and distinguish lookup failure from a genuine zero. Update the README's view table and **Source layout**.

## Open a pull request

Keep the PR focused and target `main`. Describe the reader-facing improvement, link the issue, explain data or interpretation changes, and list test results. For changed chart counts or models, show how outputs reconcile with source records and denominators. State any checks you could not run and why. Documentation-only edits do not require refreshing datasets or rerunning the full analysis pipeline.
