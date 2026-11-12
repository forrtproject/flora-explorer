"""Venue classification tests (unittest, so CI's `python -m unittest discover -s tests` runs them).

Repository identifiers are learned from a small fixture of rows with a recorded venue,
exactly as compute_pub_status.py learns them from flora.csv.
"""
import sys
import unittest
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from classification import classify_venue, learn_repositories  # noqa: E402


class VenueClassificationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        rows = [
            ("OSF",            "10.17605/osf.io/abcde", None),
            ("OSF",            "10.17605/osf.io/fghij", None),
            ("OSF Registries", "10.17605/osf.io/klmno", None),
            ("OSF Preprints",  "10.31234/osf.io/pqrst", None),
            ("Journal of Experimental Psychology", "10.1037/xge0001234", None),
            ("Psychological Science",              "10.1177/09567976211001", None),
        ]
        cls.repos = learn_repositories(pd.DataFrame(rows, columns=["journal_r", "doi_r", "url_r"]))

    def test_pnas_is_a_journal_not_a_conference(self):
        self.assertEqual(
            classify_venue("Proceedings of the National Academy of Sciences", repos=self.repos), "journal")

    def test_acm_proceedings_volume_is_a_conference_output(self):
        name = "Proceedings of the 57th ACM Technical Symposium on Computer Science Education V.1"
        self.assertEqual(classify_venue(name, repos=self.repos), "conference")

    def test_osf_preprint_without_venue_name_is_repository(self):
        self.assertEqual(classify_venue(None, doi="10.31234/osf.io/xyz12", repos=self.repos), "preprint")

    # Guards: the identifier fallback must not over-reach.
    def test_blank_venue_without_repository_identifier_stays_unknown(self):
        self.assertEqual(classify_venue(None, doi="10.1177/0956797626146077", repos=self.repos), "unknown")
        self.assertEqual(
            classify_venue(None, url="https://docs.google.com/document/d/abc", repos=self.repos), "unknown")

    def test_recorded_venue_is_never_overridden_by_identifier(self):
        self.assertEqual(
            classify_venue("Psychological Science", doi="10.17605/osf.io/abcde", repos=self.repos), "journal")


if __name__ == "__main__":
    unittest.main()