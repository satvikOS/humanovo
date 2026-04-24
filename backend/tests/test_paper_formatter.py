"""
Tests for the strict paper formatter.
"""

import pytest

from app.services.paper_formatter_service import (
    JournalStyle,
    PaperFormatter,
    split_by_headings,
)


def test_humanovo_template_is_default():
    fmt = PaperFormatter()
    assert fmt.style == JournalStyle.HUMANOVO


def test_missing_sections_flagged_as_invalid():
    fmt = PaperFormatter(JournalStyle.HUMANOVO)
    paper = fmt.format(
        title="A study",
        abstract="Short abstract.",
        sections={},  # empty — nearly everything should fail validation
    )
    assert not paper.is_valid
    # At least one failure mentions "missing"
    fails = [f for v in paper.validation for f in v.failures]
    assert any("missing" in f.lower() for f in fails)


def test_word_count_under_min_fails():
    fmt = PaperFormatter(JournalStyle.HUMANOVO)
    paper = fmt.format(
        title="A study of X in Y",
        abstract="Tiny abstract that is far too short.",  # well under 220
        sections={"introduction": "Short intro."},
    )
    abstract_val = next(v for v in paper.validation if v.key == "abstract")
    assert not abstract_val.passes
    assert any("too short" in f.lower() for f in abstract_val.failures)


def test_word_count_under_max_fails():
    fmt = PaperFormatter(JournalStyle.NEJM)
    long_abstract = " ".join(["word"] * 500)  # well over 270
    paper = fmt.format(
        title="Something",
        abstract=long_abstract,
    )
    abstract_val = next(v for v in paper.validation if v.key == "abstract")
    assert not abstract_val.passes
    assert any("too long" in f.lower() for f in abstract_val.failures)


def test_required_phrase_enforcement():
    fmt = PaperFormatter(JournalStyle.HUMANOVO)
    abstract = " ".join(["filler"] * 260)  # within word range
    paper = fmt.format(
        title="Valid title that is long enough",
        abstract=abstract,  # missing "hypothesis", "evidence", "method"
    )
    abstract_val = next(v for v in paper.validation if v.key == "abstract")
    # Should fail required_phrases
    assert not abstract_val.passes
    assert any("required phrase" in f for f in abstract_val.failures)


def test_requires_figure_flag():
    fmt = PaperFormatter(JournalStyle.HUMANOVO)
    # results_overview requires a figure
    paper = fmt.format(
        title="T", abstract="A",
        sections={"results_overview": " ".join(["word"] * 700)},
        figures=[],  # no figures at all
    )
    rov_val = next(v for v in paper.validation if v.key == "results_overview")
    assert not rov_val.passes
    assert any("requires at least one figure" in f.lower() for f in rov_val.failures)


def test_requires_mermaid_flag():
    fmt = PaperFormatter(JournalStyle.HUMANOVO)
    paper = fmt.format(
        title="T", abstract="A",
        sections={"introduction": " ".join(["word"] * 800)},
        mermaid_diagrams=[],
    )
    intro_val = next(v for v in paper.validation if v.key == "introduction")
    assert not intro_val.passes
    assert any("mermaid" in f.lower() for f in intro_val.failures)


def test_toc_built():
    fmt = PaperFormatter(JournalStyle.HUMANOVO)
    paper = fmt.format(title="T", abstract="A")
    assert paper.toc
    # numbering present
    assert any(e["number"] == "1" for e in paper.toc)
    # heading field filled
    assert all(e["heading"] for e in paper.toc)


def test_style_selection_nature():
    fmt = PaperFormatter(JournalStyle.NATURE)
    paper = fmt.format(title="T", abstract="A")
    # Nature has Results section
    assert any(v.key == "results" for v in paper.validation)


def test_split_by_headings():
    body = (
        "## Introduction\n"
        "Intro content here.\n\n"
        "## Methods\n"
        "Methods content.\n\n"
        "## Results\n"
        "Results content here.\n"
    )
    fmt = PaperFormatter(JournalStyle.NATURE)
    parts = split_by_headings(body, fmt.template)
    assert "introduction" in parts or any("intro" in k for k in parts)
    # Content correctly chunked
    for v in parts.values():
        assert len(v) > 0


def test_to_dict_round_trip_includes_validation():
    fmt = PaperFormatter(JournalStyle.HUMANOVO)
    paper = fmt.format(title="T", abstract="A")
    d = paper.to_dict()
    assert "validation" in d
    assert "is_valid" in d
    assert "style" in d
    assert d["style"] == "humanovo"
