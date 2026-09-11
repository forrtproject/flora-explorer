"""Split the per-original citation data into a slim index plus one file per study.

The Citation Impact tab needs only the index to draw its table; a study's
citation timeline and replication list are fetched when its row is clicked.
Writes:

    data/originals_index.json   one row per original, with a `file` field
    data/originals/<key>.json   the full record for that original

`write_split` is called by scripts/refresh_data.py at the end of a pipeline run.
Running this module directly rebuilds both outputs from an existing
data/originals.json without touching the OpenCitations API.
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
UNSAFE = re.compile(r"[^a-z0-9._-]")
SAFE_NAME = re.compile(r"^[a-z0-9][a-z0-9._-]*\.json$")
MAX_STEM = 200


def doi_to_filename(doi: str) -> str:
    """Map a DOI to a stable, filesystem- and GitHub-Pages-safe file name.

    Lowercased because macOS checkouts are case-insensitive, so two DOIs that
    differ only in case would otherwise overwrite each other locally. Names
    must not start with `_` or `.` — GitHub Pages' Jekyll step drops those.
    """
    stem = UNSAFE.sub("_", (doi or "").strip().lower())
    stem = stem.lstrip("._-")
    if not stem:
        stem = "doi"
    if len(stem) > MAX_STEM:
        stem = stem[:60] + "-" + hashlib.sha1(doi.encode("utf-8")).hexdigest()[:10]
    return stem + ".json"


def assign_filenames(dois) -> dict[str, str]:
    """Filename per DOI, disambiguating any collision with a hash suffix."""
    names: dict[str, str] = {}
    taken: set[str] = set()
    for doi in dois:
        name = doi_to_filename(doi)
        if name in taken:
            digest = hashlib.sha1(doi.encode("utf-8")).hexdigest()[:10]
            name = name[:-5][:60] + "-" + digest + ".json"
        taken.add(name)
        names[doi] = name
    return names


def write_split(studies: dict, index: list, data_dir: Path) -> None:
    """Write originals_index.json and data/originals/<key>.json.

    Rerunnable: files whose content is unchanged are left alone, and files for
    originals that are no longer in `studies` are removed, so the split always
    mirrors the current run exactly.
    """
    out_dir = Path(data_dir) / "originals"
    out_dir.mkdir(parents=True, exist_ok=True)

    names = assign_filenames(studies.keys())
    bad = [n for n in names.values() if not SAFE_NAME.match(n)]
    if bad:
        raise ValueError(f"unsafe generated file names: {bad[:5]}")
    if len(set(names.values())) != len(names):
        raise ValueError("duplicate file names after disambiguation")

    for doi, study in studies.items():
        path = out_dir / names[doi]
        payload = json.dumps(study, allow_nan=False)
        if path.exists() and path.read_text() == payload:
            continue
        path.write_text(payload)

    keep = set(names.values())
    for stale in out_dir.glob("*.json"):
        if stale.name not in keep:
            stale.unlink()

    slim = [{**row, "file": names[row["doi"]]} for row in index if row["doi"] in names]
    (Path(data_dir) / "originals_index.json").write_text(
        json.dumps(slim, allow_nan=False))
    print(f"✔ wrote originals_index.json ({len(slim)} rows) "
          f"and {len(names)} files in data/originals/")


def main() -> None:
    src = ROOT / "data" / "originals.json"
    if not src.exists():
        sys.exit(f"{src} not found — run scripts/refresh_data.py first")
    data = json.loads(src.read_text())
    write_split(data["studies"], data["index"], ROOT / "data")


if __name__ == "__main__":
    main()
