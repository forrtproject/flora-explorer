# Browser search fixture

`browse.csv` is a fixed four-pair extract from the FLoRA snapshot of 13 September 2026. It exercises topic, DOI and author/year search, mixed outcomes, and desktop/mobile evidence views. Only the search interaction test intercepts the CSV request with this fixture. The other browser and generated-data tests use the current committed data and compare values rather than asserting historical totals.
