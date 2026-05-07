"""
Strict Journal-Grade Paper Formatter

Per product directive: "research papers don't follow strict formatting
which needs to be corrected."

Emits a structured `StructuredPaper` that enforces a strict journal-grade
template. Every section has:
  - a deterministic numeric anchor (1, 1.1, 1.2, 2, ...),
  - a defined slot for figures/diagrams/tables/equations,
  - word-count targets matching the selected journal style,
  - required-content guards that validate the LLM output before acceptance.

Supported target styles (the user chooses from the UI; default: Humanovo):
  - "humanovo"   : full discovery-paper template (default, most rigorous)
  - "nature"     : Nature Medicine word caps (5000 body + 150 abstract)
  - "nejm"       : NEJM (2500 body + 250 abstract)
  - "lancet"     : The Lancet (4500 body + 300 abstract)
  - "jama"       : JAMA (3000 body + 350 abstract)
  - "cell"       : Cell Press (7000 body + 150 abstract)
  - "plos_one"   : PLOS ONE (no word cap + 300 abstract)

The formatter does NOT generate prose itself — that stays in
paper_generation_service. It defines the *structure* and *validation*,
so the generator fills in sections that fit the template.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Iterable
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

logger = logging.getLogger(__name__)


class JournalStyle(str, Enum):
    HUMANOVO = "humanovo"
    NATURE = "nature"
    NEJM = "nejm"
    LANCET = "lancet"
    JAMA = "jama"
    CELL = "cell"
    PLOS_ONE = "plos_one"
    SCIENCE = "science"


@dataclass
class SectionSpec:
    """A required section in the strict template."""
    number: str                 # "1", "1.1", "2.3.1", etc.
    key: str                    # machine key ("introduction", "methods", ...)
    heading: str                # display name
    min_words: int
    max_words: int
    required: bool = True
    allowed_figures: tuple[str, ...] = ()   # figure types permitted in this section
    requires_figure: bool = False
    requires_mermaid: bool = False
    requires_equation: bool = False
    requires_table: bool = False
    required_phrases: tuple[str, ...] = ()  # strings that MUST appear
    forbidden_phrases: tuple[str, ...] = ()


@dataclass
class SectionValidation:
    key: str
    word_count: int
    passes: bool
    failures: list[str] = field(default_factory=list)


@dataclass
class StructuredPaper:
    style: JournalStyle
    title: str
    authors: list[str] = field(default_factory=list)
    abstract: str = ""
    sections: dict[str, str] = field(default_factory=dict)
    figures: list[dict[str, Any]] = field(default_factory=list)
    mermaid_diagrams: list[dict[str, Any]] = field(default_factory=list)
    tables: list[dict[str, Any]] = field(default_factory=list)
    references: list[dict[str, Any]] = field(default_factory=list)
    toc: list[dict[str, Any]] = field(default_factory=list)
    validation: list[SectionValidation] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def is_valid(self) -> bool:
        return all(v.passes for v in self.validation)

    def to_dict(self) -> dict[str, Any]:
        return {
            "style": self.style.value,
            "title": self.title,
            "authors": self.authors,
            "abstract": self.abstract,
            "sections": self.sections,
            "figures": self.figures,
            "mermaid_diagrams": self.mermaid_diagrams,
            "tables": self.tables,
            "references": self.references,
            "toc": self.toc,
            "validation": [
                {"key": v.key, "word_count": v.word_count,
                 "passes": v.passes, "failures": v.failures}
                for v in self.validation
            ],
            "metadata": self.metadata,
            "is_valid": self.is_valid,
        }


# ---------------------------------------------------------------------------
# Templates per journal style
# ---------------------------------------------------------------------------


def _humanovo_template() -> list[SectionSpec]:
    """Humanovo default: rigorous multi-section discovery paper."""
    return [
        SectionSpec("0", "title", "Title", 4, 30),
        SectionSpec("0.1", "abstract", "Abstract", 220, 380,
                    required_phrases=("hypothesis", "evidence", "method"),
                    required=True),
        SectionSpec("0.2", "keywords", "Keywords", 5, 30),
        SectionSpec("1", "introduction", "Introduction", 600, 1400,
                    allowed_figures=("flowchart",),
                    requires_mermaid=True),
        SectionSpec("2", "disease_background", "Disease Background", 500, 900),
        SectionSpec("3", "literature_review", "Literature Review", 700, 1400),
        SectionSpec("4", "methods", "Methods: Multi-Agent Discovery Pipeline", 600, 1400,
                    requires_mermaid=True, required_phrases=("grounding", "citation verification")),
        SectionSpec("5", "results_overview", "Results: Hypothesis Overview", 500, 1100,
                    allowed_figures=("confidence_meter", "radar", "lollipop"),
                    requires_figure=True, requires_table=True),
        SectionSpec("5.1", "hypothesis_analyses", "Per-Hypothesis Deep Analysis", 900, 3500,
                    allowed_figures=("heatmap", "forest_plot", "violin", "bar"),
                    requires_figure=True),
        SectionSpec("6", "molecular_mechanisms", "Molecular Mechanisms", 700, 1800,
                    requires_mermaid=True,
                    allowed_figures=("heatmap", "bar", "scatter")),
        SectionSpec("7", "external_factors_analysis", "External Factors Analysis", 400, 900,
                    allowed_figures=("bubble", "stacked_bar")),
        SectionSpec("8", "evidence_landscape", "Evidence Landscape", 300, 700,
                    allowed_figures=("evidence_landscape",), requires_figure=True),
        SectionSpec("9", "translational_roadmap", "Translational Roadmap (T0–T5)", 700, 1600,
                    allowed_figures=("translational_timeline", "survival"),
                    requires_figure=True, requires_mermaid=True),
        SectionSpec("10", "discussion", "Discussion", 700, 1600),
        SectionSpec("11", "limitations_future", "Limitations and Future Work", 400, 900),
        SectionSpec("12", "conclusion", "Conclusion", 200, 500),
        SectionSpec("13", "citations_declaration", "Citations & Source Declaration",
                    150, 600, required_phrases=("verified", "DOI")),
        SectionSpec("14", "cost_breakdown", "Appendix A: Cost Breakdown", 80, 400,
                    allowed_figures=("cost_breakdown",), requires_figure=True),
        SectionSpec("15", "pipeline_trace", "Appendix B: Pipeline Trace", 80, 400),
        SectionSpec("16", "grounding_report", "Appendix C: Grounding Report", 80, 400),
    ]


def _nature_template() -> list[SectionSpec]:
    return [
        SectionSpec("0", "title", "Title", 4, 25),
        SectionSpec("0.1", "abstract", "Abstract", 120, 160),
        SectionSpec("1", "introduction", "Introduction", 400, 800),
        SectionSpec("2", "results", "Results", 1500, 3000, requires_figure=True,
                    allowed_figures=("bar", "scatter", "heatmap", "line")),
        SectionSpec("3", "discussion", "Discussion", 500, 1000),
        SectionSpec("4", "methods", "Methods", 600, 1200),
        SectionSpec("5", "references", "References", 50, 400),
    ]


def _nejm_template() -> list[SectionSpec]:
    return [
        SectionSpec("0", "title", "Title", 4, 20),
        SectionSpec("0.1", "abstract", "Abstract — Structured", 200, 270,
                    required_phrases=("Background", "Methods", "Results", "Conclusions")),
        SectionSpec("1", "introduction", "Introduction", 200, 400),
        SectionSpec("2", "methods", "Methods", 400, 700),
        SectionSpec("3", "results", "Results", 500, 1000, requires_figure=True),
        SectionSpec("4", "discussion", "Discussion", 300, 600),
    ]


def _lancet_template() -> list[SectionSpec]:
    return [
        SectionSpec("0", "title", "Title", 4, 20),
        SectionSpec("0.1", "summary", "Summary", 220, 310,
                    required_phrases=("Background", "Methods", "Findings", "Interpretation")),
        SectionSpec("1", "introduction", "Introduction", 300, 500),
        SectionSpec("2", "methods", "Methods", 500, 1000),
        SectionSpec("3", "results", "Results", 900, 1800, requires_figure=True),
        SectionSpec("4", "discussion", "Discussion", 500, 1100),
    ]


def _jama_template() -> list[SectionSpec]:
    return [
        SectionSpec("0", "title", "Title", 4, 20),
        SectionSpec("0.1", "abstract", "Abstract", 300, 370),
        SectionSpec("1", "introduction", "Introduction", 250, 400),
        SectionSpec("2", "methods", "Methods", 400, 800),
        SectionSpec("3", "results", "Results", 600, 1200, requires_figure=True),
        SectionSpec("4", "discussion", "Discussion", 400, 800),
    ]


def _cell_template() -> list[SectionSpec]:
    return [
        SectionSpec("0", "title", "Title", 4, 25),
        SectionSpec("0.1", "summary", "Summary", 120, 160),
        SectionSpec("0.2", "highlights", "Highlights", 30, 120),
        SectionSpec("1", "introduction", "Introduction", 500, 1000),
        SectionSpec("2", "results", "Results", 2500, 4500, requires_figure=True),
        SectionSpec("3", "discussion", "Discussion", 800, 1500),
        SectionSpec("4", "methods", "Star Methods", 1000, 2000),
    ]


def _plos_one_template() -> list[SectionSpec]:
    return [
        SectionSpec("0", "title", "Title", 4, 25),
        SectionSpec("0.1", "abstract", "Abstract", 200, 320),
        SectionSpec("1", "introduction", "Introduction", 400, 900),
        SectionSpec("2", "methods", "Materials and Methods", 500, 1500),
        SectionSpec("3", "results", "Results", 800, 2000, requires_figure=True),
        SectionSpec("4", "discussion", "Discussion", 400, 1200),
        SectionSpec("5", "conclusion", "Conclusion", 150, 400),
    ]


def _science_template() -> list[SectionSpec]:
    return [
        SectionSpec("0", "title", "Title", 4, 20),
        SectionSpec("0.1", "abstract", "Abstract", 100, 130),
        SectionSpec("1", "body", "Body (continuous)", 2500, 4500, requires_figure=True),
        SectionSpec("2", "methods", "Methods (Supplementary)", 500, 1500),
    ]


_TEMPLATES: dict[JournalStyle, list[SectionSpec]] = {
    JournalStyle.HUMANOVO: _humanovo_template(),
    JournalStyle.NATURE: _nature_template(),
    JournalStyle.NEJM: _nejm_template(),
    JournalStyle.LANCET: _lancet_template(),
    JournalStyle.JAMA: _jama_template(),
    JournalStyle.CELL: _cell_template(),
    JournalStyle.PLOS_ONE: _plos_one_template(),
    JournalStyle.SCIENCE: _science_template(),
}


# ---------------------------------------------------------------------------
# Formatter
# ---------------------------------------------------------------------------


class PaperFormatter:
    """Take raw section content + assets and produce a StructuredPaper.

    Usage:
        fmt = PaperFormatter(JournalStyle.HUMANOVO)
        paper = fmt.format(
            title="...", authors=["Humanovo"],
            abstract="...", sections={...},
            figures=[...], mermaid=[...], tables=[...], references=[...],
        )
        if not paper.is_valid:
            # Ask the generator to regenerate the failing sections.
            bad = [v for v in paper.validation if not v.passes]
            ...
    """

    def __init__(self, style: JournalStyle = JournalStyle.HUMANOVO):
        self.style = style
        self.template = _TEMPLATES[style]

    # ------------------------------------------------------------------

    def format(
        self,
        *,
        title: str,
        authors: list[str] | None = None,
        abstract: str = "",
        sections: dict[str, str] | None = None,
        figures: list[dict[str, Any]] | None = None,
        mermaid_diagrams: list[dict[str, Any]] | None = None,
        tables: list[dict[str, Any]] | None = None,
        references: list[dict[str, Any]] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> StructuredPaper:
        sections = sections or {}
        paper = StructuredPaper(
            style=self.style,
            title=title,
            authors=authors or [],
            abstract=abstract,
            sections=sections,
            figures=figures or [],
            mermaid_diagrams=mermaid_diagrams or [],
            tables=tables or [],
            references=references or [],
            metadata=metadata or {},
        )
        paper.toc = self._build_toc(paper)
        paper.validation = self._validate_all(paper)
        return paper

    # ------------------------------------------------------------------

    def _validate_all(self, paper: StructuredPaper) -> list[SectionValidation]:
        results: list[SectionValidation] = []
        for spec in self.template:
            results.append(self._validate_section(spec, paper))
        return results

    def _validate_section(
        self, spec: SectionSpec, paper: StructuredPaper,
    ) -> SectionValidation:
        content = ""
        if spec.key == "title":
            content = paper.title
        elif spec.key == "abstract" or spec.key == "summary":
            content = paper.abstract
        else:
            content = paper.sections.get(spec.key, "")

        wc = _word_count(content)
        failures: list[str] = []

        if spec.required and not content.strip():
            failures.append(f"Required section '{spec.key}' is missing")

        if content.strip():
            if wc < spec.min_words:
                failures.append(
                    f"Section '{spec.key}' too short: {wc} words < min {spec.min_words}"
                )
            if wc > spec.max_words:
                failures.append(
                    f"Section '{spec.key}' too long: {wc} words > max {spec.max_words}"
                )

            lower = content.lower()
            for phrase in spec.required_phrases:
                if phrase.lower() not in lower:
                    failures.append(
                        f"Section '{spec.key}' missing required phrase: {phrase!r}"
                    )
            for phrase in spec.forbidden_phrases:
                if phrase.lower() in lower:
                    failures.append(
                        f"Section '{spec.key}' contains forbidden phrase: {phrase!r}"
                    )

        if spec.requires_figure:
            if not _section_has_figure(paper, spec):
                failures.append(
                    f"Section '{spec.key}' requires at least one figure "
                    f"(allowed: {spec.allowed_figures or 'any'})"
                )

        if spec.requires_mermaid:
            if not _section_has_mermaid(paper, spec):
                failures.append(
                    f"Section '{spec.key}' requires a Mermaid diagram"
                )

        if spec.requires_table:
            if not _section_has_table(paper, spec):
                failures.append(f"Section '{spec.key}' requires a table")

        return SectionValidation(
            key=spec.key, word_count=wc,
            passes=len(failures) == 0, failures=failures,
        )

    # ------------------------------------------------------------------

    def _build_toc(self, paper: StructuredPaper) -> list[dict[str, Any]]:
        entries: list[dict[str, Any]] = []
        for spec in self.template:
            if spec.key in ("title",):
                continue
            entries.append({
                "number": spec.number,
                "key": spec.key,
                "heading": spec.heading,
                "anchor": f"sec-{spec.key}",
                "word_count_target": [spec.min_words, spec.max_words],
                "required": spec.required,
            })
        return entries


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _word_count(text: str) -> int:
    return len(re.findall(r"\S+", text or ""))


def _section_has_figure(paper: StructuredPaper, spec: SectionSpec) -> bool:
    for fig in paper.figures:
        if fig.get("section") == spec.key:
            if not spec.allowed_figures:
                return True
            if fig.get("figure_type") in spec.allowed_figures:
                return True
    return False


def _section_has_mermaid(paper: StructuredPaper, spec: SectionSpec) -> bool:
    return any(d.get("section") == spec.key for d in paper.mermaid_diagrams)


def _section_has_table(paper: StructuredPaper, spec: SectionSpec) -> bool:
    return any(t.get("section") == spec.key for t in paper.tables)


# ---------------------------------------------------------------------------
# Helper: given a prose body, split it into the required sections by heading
# ---------------------------------------------------------------------------


_HEADING_PATTERN = re.compile(r"^\s*#{1,3}\s+(.+?)\s*$", re.MULTILINE)


def split_by_headings(body: str, template: Iterable[SectionSpec]) -> dict[str, str]:
    """Best-effort split of a body into section-keyed content.

    Uses markdown-style headings (`# `, `## `, `### `) as section separators.
    Any text before the first heading is discarded.
    """
    matches = list(_HEADING_PATTERN.finditer(body))
    if not matches:
        return {}
    sections: dict[str, str] = {}
    for i, m in enumerate(matches):
        heading = m.group(1).strip()
        key = _match_key(heading, template)
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(body)
        sections[key or _slugify(heading)] = body[start:end].strip()
    return sections


def _match_key(heading: str, template: Iterable[SectionSpec]) -> str | None:
    heading_lower = heading.lower()
    for spec in template:
        if spec.heading.lower() in heading_lower or spec.key in heading_lower:
            return spec.key
    return None


def _slugify(s: str) -> str:
    return re.sub(r"[^a-z0-9_]+", "_", s.lower()).strip("_")[:48]
