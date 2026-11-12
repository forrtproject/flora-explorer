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
            ("Example Preprint Server", "10.9999/a1", "https://r1.rp2.org/1"),
            ("Example Preprint Server", "10.9998/a2", "https://r1.rp2.org/2"),
            ("Example Preprint Server", "10.9997/a3", "https://r1.u1a.ac.uk/1"),
            ("Example Preprint Server", "10.9996/a4", "https://r1.u1a.ac.uk/2"),
            ("arXiv", "10.48550/arXiv.1", "https://arxiv.org/abs/1"),
            ("arXiv", "10.48550/arXiv.2", "https://arxiv.org/abs/2"),
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

    def test_aom_proceedings_is_a_journal(self):
        self.assertEqual(
            classify_venue("Academy of Management Proceedings", repos=self.repos), "journal")

    def test_international_alone_is_not_an_event_marker(self):
        self.assertEqual(
            classify_venue("Proceedings of the International Society for Example", repos=self.repos), "journal")

    def test_learned_doi_prefix_alone_is_enough(self):
        # 10.17605 is learned from three rows; "zzz123" has no repository token
        self.assertEqual(classify_venue(None, doi="10.17605/zzz123", repos=self.repos), "preprint")

    def test_learned_url_host_alone_is_enough(self):
        # host rp2.org is learned; labels contain digits, so no token can match
        self.assertEqual(classify_venue(None, url="https://x9.rp2.org/5", repos=self.repos), "preprint")

    def test_host_signal_respects_multipart_suffix(self):
        self.assertEqual(classify_venue(None, url="https://x9.u1a.ac.uk/5", repos=self.repos), "preprint")
        self.assertEqual(classify_venue(None, url="https://r1.u1b.ac.uk/9", repos=self.repos), "unknown")

    def test_tld_is_not_a_repository_token(self):
        self.assertEqual(classify_venue(None, url="https://publisher.org/9", repos=self.repos), "unknown")


if __name__ == "__main__":
    unittest.main()