#!/usr/bin/env python3
"""List journals in flora.csv that are absent from the discipline mapping.
"""
import argparse
import csv
import json
from collections import Counter
from pathlib import Path


def normalize(value: str) -> str:
    return " ".join(value.split()).lower()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--flora", type=Path, default=Path("flora.csv"))
    parser.add_argument("--disciplines", type=Path, default=Path("disciplines.json"))
    parser.add_argument("--csv-output", type=Path, default=Path("missing_journals.csv"))
    parser.add_argument("--txt-output", type=Path, default=Path("missing_journals.txt"))
    args = parser.parse_args()

    with args.disciplines.open(encoding="utf-8-sig") as handle:
        mapping = json.load(handle)
    if not isinstance(mapping, dict) or any(not isinstance(v, list) for v in mapping.values()):
        parser.error("Discipline mapping must be a JSON object of arrays of journal names")
    known = {normalize(name) for journals in mapping.values() for name in journals if isinstance(name, str)}

    counts = Counter()
    with args.flora.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        required = {"journal_o", "journal_r"}
        if not required.issubset(reader.fieldnames or []):
            parser.error("flora.csv must contain journal_o and journal_r columns")
        for row in reader:
            for column in ("journal_o", "journal_r"):
                original = row[column]
                if original is None or not original.strip() or original.strip().upper() == "NA":
                    continue
                if normalize(original) not in known:
                    counts[original] += 1

    results = sorted(counts.items(), key=lambda item: (-item[1], item[0].casefold(), item[0]))
    print("count\tjournal")
    for journal, count in results:
        print(f"{count}\t{journal}")
    print(f"\nNumber of unmapped original journal names: {len(results)}")
    print(f"Total unmapped occurrences: {sum(counts.values())}")

    with args.csv_output.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["journal", "count"])
        writer.writerows((journal, count) for journal, count in results)
    with args.txt_output.open("w", encoding="utf-8") as handle:
        for journal, count in results:
            handle.write(f"{count}\t{journal}\n")


if __name__ == "__main__":
    main()
