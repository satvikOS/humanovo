"""
Unit tests for citation parsers (BibTeX / RIS / CSL-JSON / EndNote).

Pure-function tests — no DB, no HTTP — so these run fast and can
catch parser regressions without the Postgres setup cost.
"""
from __future__ import annotations

import pytest

from app.citations_io import (
    parse_bibtex,
    parse_csl_json,
    parse_endnote,
    parse_ris,
    serialize_bibtex,
    serialize_csl_json,
    serialize_ris,
)


# ─── BibTeX ──────────────────────────────────────────────────────


BIBTEX_ARTICLE = """
@article{smith2024alpha,
  title = {A novel mechanism for {IL-6} signalling},
  author = {Smith, J. A. and Doe, Jane and Chen, Wei-Long},
  journal = {Nature Immunology},
  volume = {25},
  number = {3},
  pages = {145--152},
  year = {2024},
  doi = {10.1038/s41590-024-0001-x},
  keywords = {IL-6, JAK-STAT, inflammation}
}
"""


def test_parse_bibtex_article_recovers_fields() -> None:
    cites = parse_bibtex(BIBTEX_ARTICLE)
    assert len(cites) == 1
    c = cites[0]
    assert c["type"] == "journal"
    assert c["cite_key"] == "smith2024alpha"
    assert c["title"] == "A novel mechanism for IL-6 signalling"
    # "Smith, J. A." → "J. A. Smith" via name flipping.
    assert c["authors"] == ["J. A. Smith", "Jane Doe", "Wei-Long Chen"]
    assert c["journal"] == "Nature Immunology"
    assert c["volume"] == "25"
    assert c["issue"] == "3"
    assert c["pages"] == "145--152"
    assert c["year"] == 2024
    assert c["doi"] == "10.1038/s41590-024-0001-x"
    assert "IL-6" in c["tags"] and "JAK-STAT" in c["tags"]


def test_parse_bibtex_handles_multiple_entries() -> None:
    multi = BIBTEX_ARTICLE + "\n@book{ref2, title = {Book Title}, author = {Author, A.}, year = {2020}}"
    cites = parse_bibtex(multi)
    assert len(cites) == 2
    assert cites[1]["type"] == "book"
    assert cites[1]["title"] == "Book Title"


def test_parse_bibtex_skips_comments_and_preamble() -> None:
    text = """@comment{this is ignored}
@preamble{"\\\\newcommand{\\\\foo}{bar}"}

@article{real2023,
  title = {Real entry},
  author = {Only, Author},
  year = {2023}
}
"""
    cites = parse_bibtex(text)
    assert len(cites) == 1
    assert cites[0]["cite_key"] == "real2023"


def test_serialize_bibtex_roundtrip() -> None:
    cites = parse_bibtex(BIBTEX_ARTICLE)
    out = serialize_bibtex(cites)
    reparsed = parse_bibtex(out)
    assert reparsed[0]["title"] == cites[0]["title"]
    assert reparsed[0]["authors"] == cites[0]["authors"]
    assert reparsed[0]["year"] == cites[0]["year"]
    assert reparsed[0]["doi"] == cites[0]["doi"]
    assert set(reparsed[0]["tags"]) == set(cites[0]["tags"])


def test_bibtex_fallback_cite_key_when_missing() -> None:
    text = "@article{,\n  title = {Untitled Research},\n  author = {Garcia, M.},\n  year = {2022}\n}"
    cites = parse_bibtex(text)
    out = serialize_bibtex(cites)
    # Serializer must manufacture a cite_key (surname+year+word).
    assert "@article{garcia2022" in out.lower()


# ─── RIS ─────────────────────────────────────────────────────────


RIS_SAMPLE = """TY  - JOUR
AU  - Smith, J. A.
AU  - Doe, Jane
TI  - RIS round trip test
JO  - Journal of Testing
VL  - 7
IS  - 2
SP  - 100
EP  - 110
PY  - 2023
DO  - 10.1234/rt.2023.7.2.100
KW  - testing
KW  - citations
AB  - Abstract text here.
ER  -
"""


def test_parse_ris_recovers_fields() -> None:
    cites = parse_ris(RIS_SAMPLE)
    assert len(cites) == 1
    c = cites[0]
    assert c["type"] == "journal"
    assert c["title"] == "RIS round trip test"
    assert c["authors"] == ["Smith, J. A.", "Doe, Jane"]
    assert c["year"] == 2023
    assert c["pages"] == "100-110"
    assert c["doi"] == "10.1234/rt.2023.7.2.100"
    assert set(c["tags"]) == {"testing", "citations"}


def test_serialize_ris_roundtrip() -> None:
    cites = parse_ris(RIS_SAMPLE)
    out = serialize_ris(cites)
    reparsed = parse_ris(out)
    assert reparsed[0]["title"] == cites[0]["title"]
    assert reparsed[0]["authors"] == cites[0]["authors"]
    assert reparsed[0]["pages"] == cites[0]["pages"]
    assert reparsed[0]["doi"] == cites[0]["doi"]


def test_parse_ris_multiple_entries() -> None:
    doubled = RIS_SAMPLE + "\n" + RIS_SAMPLE.replace("7", "8").replace("RIS round trip test", "Second")
    cites = parse_ris(doubled)
    assert len(cites) == 2
    assert cites[1]["title"] == "Second"


# ─── CSL-JSON ────────────────────────────────────────────────────


CSL_SAMPLE = [
    {
        "id": "csl-001",
        "type": "article-journal",
        "title": "CSL native entry",
        "author": [{"given": "Alice", "family": "Wonderland"}],
        "issued": {"date-parts": [[2022]]},
        "container-title": "Wonderland Reviews",
        "DOI": "10.0001/csl.2022.1",
        "page": "1-10",
    }
]


def test_parse_csl_json_to_citation() -> None:
    cites = parse_csl_json(CSL_SAMPLE)
    assert len(cites) == 1
    c = cites[0]
    assert c["type"] == "journal"
    assert c["title"] == "CSL native entry"
    assert c["authors"] == ["Alice Wonderland"]
    assert c["year"] == 2022
    assert c["journal"] == "Wonderland Reviews"
    assert c["doi"] == "10.0001/csl.2022.1"


def test_serialize_csl_json_roundtrip() -> None:
    cites = parse_csl_json(CSL_SAMPLE)
    out = serialize_csl_json(cites)
    assert len(out) == 1
    assert out[0]["title"] == "CSL native entry"
    assert out[0]["DOI"] == "10.0001/csl.2022.1"
    # Author must be emitted as [{given, family}] structure.
    author = out[0]["author"][0]
    assert author["given"] == "Alice"
    assert author["family"] == "Wonderland"


# ─── EndNote (.enw) ──────────────────────────────────────────────


ENDNOTE_SAMPLE = """%A Einstein, Albert
%T On the Electrodynamics of Moving Bodies
%J Annalen der Physik
%D 1905
%V 17
%P 891-921

"""


def test_parse_endnote() -> None:
    cites = parse_endnote(ENDNOTE_SAMPLE)
    assert len(cites) == 1
    c = cites[0]
    assert c["title"] == "On the Electrodynamics of Moving Bodies"
    assert c["authors"] == ["Einstein, Albert"]
    assert c["year"] == 1905
    assert c["volume"] == "17"


# ─── Cross-format regressions ────────────────────────────────────


def test_bibtex_empty_input_returns_empty_list() -> None:
    assert parse_bibtex("") == []
    assert parse_bibtex("   \n\n") == []


def test_ris_empty_input_returns_empty_list() -> None:
    assert parse_ris("") == []


def test_bibtex_handles_latex_special_chars_in_title() -> None:
    text = "@article{foo, title = {Effects of {H$_2$}O on {K^+} channels}, author = {X, Y}, year = {2024}}"
    cites = parse_bibtex(text)
    # Braces get stripped by _debrace; LaTeX escapes pass through.
    assert "H$_2$" in cites[0]["title"]
    assert "K^+" in cites[0]["title"]
