"""
Document Export Service — Publication-Ready Research Document Generation

Generates professional PDF and DOCX research documents from hypotheses,
evidence, and discovery results. Supports multiple document types:

  1. Research Paper      — Full scientific paper (abstract, intro, methods, results, discussion, refs)
  2. Hypothesis Report   — Detailed report on a single hypothesis with evidence summary
  3. Discovery Summary   — Overview of all hypotheses from a discovery run
  4. Evidence Compilation— Compiled evidence from all sources with scoring tables
  5. Translational Roadmap — T0-T5 bench-to-bedside translational plan

Output formats: PDF (reportlab) and DOCX (python-docx).
"""

import io
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.platypus.tableofcontents import TableOfContents

from docx import Document as DocxDocument
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT

from app.core.logging import get_logger

logger = get_logger(__name__)

# ---------------------------------------------------------------------------
# Brand colours
# ---------------------------------------------------------------------------
HUMANOVO_PRIMARY = colors.HexColor("#1A3C6E")
HUMANOVO_SECONDARY = colors.HexColor("#2E86C1")
HUMANOVO_ACCENT = colors.HexColor("#27AE60")
HUMANOVO_LIGHT_BG = colors.HexColor("#F0F4F8")
HUMANOVO_TEXT = colors.HexColor("#2C3E50")

HUMANOVO_PRIMARY_RGB = RGBColor(0x1A, 0x3C, 0x6E)
HUMANOVO_SECONDARY_RGB = RGBColor(0x2E, 0x86, 0xC1)
HUMANOVO_ACCENT_RGB = RGBColor(0x27, 0xAE, 0x60)
HUMANOVO_TEXT_RGB = RGBColor(0x2C, 0x3E, 0x50)


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------
@dataclass
class DocumentSection:
    """A single logical section within a generated document."""

    section_type: str  # title, abstract, heading, paragraph, table, figure, reference, page_break
    title: str = ""
    content: str = ""
    level: int = 1  # heading level (1–3)
    table_data: list[list[str]] | None = None
    table_headers: list[str] | None = None
    metadata: dict = field(default_factory=dict)


# ---------------------------------------------------------------------------
# PDF page templates (header / footer)
# ---------------------------------------------------------------------------
_HEADER_TEXT = "HUMANOVO  |  Biomedical Discovery Platform"


def _pdf_header_footer(canvas, doc):
    """Draw branded header and footer on every page."""
    canvas.saveState()

    # --- header line ---
    canvas.setStrokeColor(HUMANOVO_PRIMARY)
    canvas.setLineWidth(1.5)
    canvas.line(
        doc.leftMargin,
        doc.pagesize[1] - 0.6 * inch,
        doc.pagesize[0] - doc.rightMargin,
        doc.pagesize[1] - 0.6 * inch,
    )
    canvas.setFont("Helvetica-Bold", 8)
    canvas.setFillColor(HUMANOVO_PRIMARY)
    canvas.drawString(doc.leftMargin, doc.pagesize[1] - 0.5 * inch, _HEADER_TEXT)

    # --- footer ---
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.grey)
    page_num_text = f"Page {doc.page}"
    canvas.drawCentredString(doc.pagesize[0] / 2, 0.4 * inch, page_num_text)

    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    canvas.drawRightString(
        doc.pagesize[0] - doc.rightMargin, 0.4 * inch, f"Generated {timestamp}"
    )
    canvas.restoreState()


def _pdf_title_page_template(canvas, doc):
    """Minimal header/footer for the title page (no page number)."""
    canvas.saveState()
    canvas.setStrokeColor(HUMANOVO_PRIMARY)
    canvas.setLineWidth(2)
    canvas.line(
        doc.leftMargin,
        doc.pagesize[1] - 0.6 * inch,
        doc.pagesize[0] - doc.rightMargin,
        doc.pagesize[1] - 0.6 * inch,
    )
    canvas.restoreState()


# ---------------------------------------------------------------------------
# Custom TOC-aware doc template
# ---------------------------------------------------------------------------
class _HumanovoDocTemplate(BaseDocTemplate):
    """BaseDocTemplate subclass that tracks headings for a Table of Contents."""

    def __init__(self, filename_or_buffer, **kwargs):
        super().__init__(filename_or_buffer, **kwargs)
        self.toc_entries: list[tuple[int, str, int]] = []

    def afterFlowable(self, flowable):
        """Register heading bookmarks for the TOC."""
        if isinstance(flowable, Paragraph):
            style_name = flowable.style.name
            if style_name == "Heading1":
                self.notify("TOCEntry", (0, flowable.getPlainText(), self.page))
            elif style_name == "Heading2":
                self.notify("TOCEntry", (1, flowable.getPlainText(), self.page))
            elif style_name == "Heading3":
                self.notify("TOCEntry", (2, flowable.getPlainText(), self.page))


# ---------------------------------------------------------------------------
# Main service
# ---------------------------------------------------------------------------
class DocumentExportService:
    """Service for generating PDF and DOCX research documents."""

    def __init__(self, page_size: tuple = letter, institution: str = "Humanovo Research"):
        self._page_size = page_size
        self._institution = institution
        self._styles = self._create_pdf_styles()

    # ------------------------------------------------------------------
    # PDF style sheet
    # ------------------------------------------------------------------
    def _create_pdf_styles(self) -> dict[str, ParagraphStyle]:
        base = getSampleStyleSheet()
        styles: dict[str, ParagraphStyle] = {}

        styles["Title"] = ParagraphStyle(
            "Title",
            parent=base["Title"],
            fontName="Helvetica-Bold",
            fontSize=26,
            leading=32,
            alignment=TA_CENTER,
            textColor=HUMANOVO_PRIMARY,
            spaceAfter=20,
        )
        styles["Subtitle"] = ParagraphStyle(
            "Subtitle",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=14,
            leading=18,
            alignment=TA_CENTER,
            textColor=HUMANOVO_SECONDARY,
            spaceAfter=12,
        )
        styles["Heading1"] = ParagraphStyle(
            "Heading1",
            parent=base["Heading1"],
            fontName="Helvetica-Bold",
            fontSize=16,
            leading=20,
            textColor=HUMANOVO_PRIMARY,
            spaceBefore=18,
            spaceAfter=8,
            borderWidth=0,
            borderPadding=0,
            borderColor=HUMANOVO_PRIMARY,
        )
        styles["Heading2"] = ParagraphStyle(
            "Heading2",
            parent=base["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=13,
            leading=16,
            textColor=HUMANOVO_SECONDARY,
            spaceBefore=14,
            spaceAfter=6,
        )
        styles["Heading3"] = ParagraphStyle(
            "Heading3",
            parent=base["Heading3"],
            fontName="Helvetica-BoldOblique",
            fontSize=11,
            leading=14,
            textColor=HUMANOVO_TEXT,
            spaceBefore=10,
            spaceAfter=4,
        )
        styles["BodyText"] = ParagraphStyle(
            "BodyText",
            parent=base["BodyText"],
            fontName="Times-Roman",
            fontSize=10.5,
            leading=14,
            alignment=TA_JUSTIFY,
            textColor=HUMANOVO_TEXT,
            spaceAfter=6,
        )
        styles["Abstract"] = ParagraphStyle(
            "Abstract",
            parent=base["BodyText"],
            fontName="Times-Italic",
            fontSize=10,
            leading=13,
            alignment=TA_JUSTIFY,
            textColor=HUMANOVO_TEXT,
            leftIndent=36,
            rightIndent=36,
            spaceAfter=10,
        )
        styles["Reference"] = ParagraphStyle(
            "Reference",
            parent=base["BodyText"],
            fontName="Times-Roman",
            fontSize=9,
            leading=12,
            leftIndent=24,
            firstLineIndent=-24,
            textColor=HUMANOVO_TEXT,
            spaceAfter=3,
        )
        styles["TableHeader"] = ParagraphStyle(
            "TableHeader",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=9,
            leading=11,
            alignment=TA_LEFT,
            textColor=colors.white,
        )
        styles["TableCell"] = ParagraphStyle(
            "TableCell",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=9,
            leading=11,
            alignment=TA_LEFT,
            textColor=HUMANOVO_TEXT,
        )
        styles["CenteredBody"] = ParagraphStyle(
            "CenteredBody",
            parent=styles["BodyText"],
            alignment=TA_CENTER,
        )
        return styles

    # ==================================================================
    # PUBLIC: document generation methods
    # ==================================================================

    async def generate_research_paper(
        self,
        project_id: str,
        hypotheses: list[dict],
        evidence: list[dict],
        format: str = "pdf",
        *,
        title: str | None = None,
        authors: list[str] | None = None,
        disease: str = "",
        pipeline_config: dict | None = None,
    ) -> bytes:
        """Generate a full scientific research paper."""
        logger.info(
            "Generating research paper",
            project_id=project_id,
            format=format,
            num_hypotheses=len(hypotheses),
            num_evidence=len(evidence),
        )
        title = title or f"Novel Therapeutic Hypotheses for {disease or 'Target Disease'}"
        authors = authors or ["Humanovo AI Discovery Platform"]
        date_str = datetime.now(timezone.utc).strftime("%B %d, %Y")
        context = self._summarise_disease_context(disease, hypotheses)
        analysis = self._synthesise_discussion(hypotheses, evidence)
        citations = self._extract_citations(evidence)

        sections: list[DocumentSection] = [
            self._build_title_page(title, authors, date_str, self._institution),
            DocumentSection(section_type="page_break"),
            DocumentSection(section_type="toc"),
            DocumentSection(section_type="page_break"),
            self._build_abstract(self._generate_abstract(hypotheses, evidence, disease)),
            self._build_introduction(disease, context),
            self._build_methods(pipeline_config or {}),
            self._build_results(hypotheses, evidence),
            self._build_discussion(analysis),
            self._build_references(citations),
        ]

        return self._render(sections, format)

    async def generate_hypothesis_report(
        self,
        hypothesis: dict,
        evidence: list[dict],
        format: str = "pdf",
    ) -> bytes:
        """Generate a detailed report on a single hypothesis."""
        h_title = hypothesis.get("title", hypothesis.get("name", "Untitled Hypothesis"))
        logger.info("Generating hypothesis report", hypothesis=h_title, format=format)

        date_str = datetime.now(timezone.utc).strftime("%B %d, %Y")
        confidence = hypothesis.get("confidence_score", hypothesis.get("confidence", "N/A"))
        mechanism = hypothesis.get("mechanism", hypothesis.get("description", ""))
        rationale = hypothesis.get("rationale", "")
        novelty = hypothesis.get("novelty_score", "N/A")

        sections: list[DocumentSection] = [
            self._build_title_page(
                f"Hypothesis Report: {h_title}",
                ["Humanovo AI Discovery Platform"],
                date_str,
                self._institution,
            ),
            DocumentSection(section_type="page_break"),
            # Executive summary
            DocumentSection(section_type="heading", title="Executive Summary", level=1),
            DocumentSection(
                section_type="paragraph",
                content=(
                    f"This report presents a detailed analysis of the hypothesis "
                    f'"{h_title}". The overall confidence score is '
                    f"<b>{confidence}</b> with a novelty score of <b>{novelty}</b>."
                ),
            ),
            # Hypothesis details
            DocumentSection(section_type="heading", title="Hypothesis Details", level=1),
            DocumentSection(section_type="heading", title="Proposed Mechanism", level=2),
            DocumentSection(section_type="paragraph", content=mechanism or "Not specified."),
            DocumentSection(section_type="heading", title="Scientific Rationale", level=2),
            DocumentSection(section_type="paragraph", content=rationale or "Not specified."),
            # Scoring
            DocumentSection(section_type="heading", title="Scoring Metrics", level=1),
            self._build_hypothesis_score_table(hypothesis),
            # Evidence
            DocumentSection(section_type="heading", title="Supporting Evidence", level=1),
            self._build_evidence_table(evidence),
            # References
            self._build_references(self._extract_citations(evidence)),
        ]

        return self._render(sections, format)

    async def generate_discovery_summary(
        self,
        discovery_run: dict,
        format: str = "pdf",
    ) -> bytes:
        """Generate an overview document for a complete discovery run."""
        disease = discovery_run.get("disease", "Unknown Disease")
        run_id = discovery_run.get("id", discovery_run.get("run_id", "N/A"))
        hypotheses = discovery_run.get("hypotheses", [])
        date_str = datetime.now(timezone.utc).strftime("%B %d, %Y")

        logger.info(
            "Generating discovery summary",
            run_id=run_id,
            disease=disease,
            format=format,
        )

        sections: list[DocumentSection] = [
            self._build_title_page(
                f"Discovery Summary: {disease}",
                ["Humanovo AI Discovery Platform"],
                date_str,
                self._institution,
            ),
            DocumentSection(section_type="page_break"),
            # Run overview
            DocumentSection(section_type="heading", title="Discovery Run Overview", level=1),
            DocumentSection(
                section_type="paragraph",
                content=(
                    f"<b>Run ID:</b> {run_id}<br/>"
                    f"<b>Disease Target:</b> {disease}<br/>"
                    f"<b>Total Hypotheses Generated:</b> {len(hypotheses)}<br/>"
                    f"<b>Completion Date:</b> {date_str}"
                ),
            ),
            # Configuration
            DocumentSection(section_type="heading", title="Pipeline Configuration", level=1),
            self._build_config_table(discovery_run.get("config", discovery_run.get("pipeline_config", {}))),
            # Hypotheses overview
            DocumentSection(section_type="heading", title="Hypotheses Overview", level=1),
        ]

        # Summary table of all hypotheses
        if hypotheses:
            headers = ["#", "Hypothesis", "Confidence", "Novelty", "Status"]
            rows = []
            for idx, h in enumerate(hypotheses, 1):
                rows.append([
                    str(idx),
                    str(h.get("title", h.get("name", "Untitled")))[:80],
                    str(h.get("confidence_score", h.get("confidence", "N/A"))),
                    str(h.get("novelty_score", "N/A")),
                    str(h.get("status", "generated")),
                ])
            sections.append(
                DocumentSection(
                    section_type="table",
                    title="Hypothesis Rankings",
                    table_headers=headers,
                    table_data=rows,
                )
            )

        # Individual hypothesis summaries
        for idx, h in enumerate(hypotheses, 1):
            h_title = h.get("title", h.get("name", f"Hypothesis {idx}"))
            sections.append(DocumentSection(section_type="heading", title=h_title, level=2))
            sections.append(
                DocumentSection(
                    section_type="paragraph",
                    content=h.get("mechanism", h.get("description", "No description available.")),
                )
            )

        return self._render(sections, format)

    async def generate_evidence_compilation(
        self,
        evidence: list[dict],
        format: str = "pdf",
        *,
        title: str = "Evidence Compilation Report",
    ) -> bytes:
        """Compile all evidence from various sources into a structured document."""
        logger.info("Generating evidence compilation", num_evidence=len(evidence), format=format)

        date_str = datetime.now(timezone.utc).strftime("%B %d, %Y")

        sections: list[DocumentSection] = [
            self._build_title_page(
                title,
                ["Humanovo AI Discovery Platform"],
                date_str,
                self._institution,
            ),
            DocumentSection(section_type="page_break"),
            DocumentSection(section_type="heading", title="Overview", level=1),
            DocumentSection(
                section_type="paragraph",
                content=(
                    f"This report compiles <b>{len(evidence)}</b> pieces of evidence "
                    f"gathered during the discovery process. Evidence is categorised by "
                    f"source and scored for relevance and quality."
                ),
            ),
        ]

        # Group evidence by source
        by_source: dict[str, list[dict]] = {}
        for ev in evidence:
            source = ev.get("source", ev.get("source_type", "Unknown"))
            by_source.setdefault(source, []).append(ev)

        # Source summary table
        source_rows = [
            [src, str(len(items)), f"{self._avg_score(items):.2f}"]
            for src, items in sorted(by_source.items())
        ]
        sections.append(
            DocumentSection(
                section_type="table",
                title="Evidence by Source",
                table_headers=["Source", "Count", "Avg Relevance"],
                table_data=source_rows,
            )
        )

        # Detailed evidence per source
        for source, items in sorted(by_source.items()):
            sections.append(DocumentSection(section_type="heading", title=f"Source: {source}", level=1))
            headers = ["#", "Title / Excerpt", "Relevance", "Year"]
            rows = []
            for idx, ev in enumerate(items, 1):
                excerpt = str(
                    ev.get("title", ev.get("excerpt", ev.get("content", "")))
                )[:120]
                rows.append([
                    str(idx),
                    excerpt,
                    str(ev.get("relevance_score", ev.get("score", "N/A"))),
                    str(ev.get("year", ev.get("publication_year", "N/A"))),
                ])
            sections.append(
                DocumentSection(
                    section_type="table",
                    title=f"{source} Evidence",
                    table_headers=headers,
                    table_data=rows,
                )
            )

        # Full references
        sections.append(self._build_references(self._extract_citations(evidence)))

        return self._render(sections, format)

    async def generate_translational_roadmap(
        self,
        hypothesis: dict,
        format: str = "pdf",
    ) -> bytes:
        """Generate a T0-T5 translational roadmap document."""
        h_title = hypothesis.get("title", hypothesis.get("name", "Untitled Hypothesis"))
        logger.info("Generating translational roadmap", hypothesis=h_title, format=format)

        date_str = datetime.now(timezone.utc).strftime("%B %d, %Y")

        phases = [
            (
                "T0 — Basic Discovery",
                "Target identification and initial validation. Characterisation of the "
                "proposed mechanism through in-silico modelling, literature review, and "
                "computational pathway analysis.",
                ["Literature review & meta-analysis", "In-silico target modelling",
                 "Pathway enrichment analysis", "Initial mechanistic validation"],
                "3–6 months",
            ),
            (
                "T1 — Pre-clinical Development",
                "In-vitro and in-vivo validation of the hypothesis. Cell line and animal "
                "model studies to confirm efficacy and safety profiles.",
                ["Cell line assay development", "Dose-response characterisation",
                 "Animal model validation", "ADMET profiling", "Lead compound optimisation"],
                "12–18 months",
            ),
            (
                "T2 — Clinical Translation",
                "IND-enabling studies and Phase I/II clinical trials. Regulatory strategy "
                "development and GMP manufacturing scale-up.",
                ["IND application preparation", "Phase I safety trial",
                 "Phase II efficacy trial", "Biomarker development",
                 "GMP manufacturing scale-up"],
                "24–36 months",
            ),
            (
                "T3 — Clinical Implementation",
                "Phase III pivotal trials and regulatory submission. Development of "
                "clinical protocols and treatment guidelines.",
                ["Phase III pivotal trial", "Regulatory submission (NDA/BLA)",
                 "Clinical protocol development", "Health economics analysis",
                 "Companion diagnostic development"],
                "24–48 months",
            ),
            (
                "T4 — Population Health",
                "Post-market surveillance, real-world evidence generation, and "
                "guideline integration. Expansion to broader patient populations.",
                ["Post-market surveillance", "Real-world evidence studies",
                 "Treatment guideline integration", "Patient registry establishment",
                 "Health technology assessment"],
                "Ongoing",
            ),
            (
                "T5 — Global Health Impact",
                "Scaling access, addressing health disparities, and enabling "
                "equitable global distribution of the therapeutic intervention.",
                ["Global access strategy", "Health equity programmes",
                 "Technology transfer agreements", "Pharmacovigilance at scale",
                 "Long-term outcomes tracking"],
                "Ongoing",
            ),
        ]

        sections: list[DocumentSection] = [
            self._build_title_page(
                f"Translational Roadmap: {h_title}",
                ["Humanovo AI Discovery Platform"],
                date_str,
                self._institution,
            ),
            DocumentSection(section_type="page_break"),
            DocumentSection(section_type="heading", title="Hypothesis Overview", level=1),
            DocumentSection(
                section_type="paragraph",
                content=hypothesis.get("mechanism", hypothesis.get("description", "No description available.")),
            ),
        ]

        # Roadmap timeline table
        timeline_rows = [[p[0], p[3]] for p in phases]
        sections.append(
            DocumentSection(
                section_type="table",
                title="Translational Timeline Overview",
                table_headers=["Phase", "Estimated Duration"],
                table_data=timeline_rows,
            )
        )

        # Detailed phase sections
        for phase_title, description, milestones, duration in phases:
            sections.append(DocumentSection(section_type="heading", title=phase_title, level=1))
            sections.append(DocumentSection(section_type="paragraph", content=description))
            sections.append(DocumentSection(section_type="heading", title="Key Milestones", level=2))
            milestone_text = "<br/>".join(f"&bull; {m}" for m in milestones)
            sections.append(DocumentSection(section_type="paragraph", content=milestone_text))
            sections.append(
                DocumentSection(
                    section_type="paragraph",
                    content=f"<b>Estimated Duration:</b> {duration}",
                ),
            )

        # Risk assessment
        sections.append(DocumentSection(section_type="heading", title="Risk Assessment", level=1))
        risk_headers = ["Risk Factor", "Likelihood", "Impact", "Mitigation"]
        risk_rows = [
            ["Target de-validation", "Medium", "High", "Multi-target strategy; parallel validation"],
            ["Toxicity signals", "Medium", "High", "Early ADMET screening; safety pharmacology"],
            ["Clinical endpoint failure", "Medium", "High", "Adaptive trial design; biomarker enrichment"],
            ["Regulatory delay", "Low", "Medium", "Pre-IND meetings; rolling submissions"],
            ["Manufacturing scale-up", "Low", "Medium", "Process development partnership; CMO engagement"],
            ["IP / freedom-to-operate", "Low", "High", "FTO analysis; patent landscape review"],
        ]
        sections.append(
            DocumentSection(
                section_type="table",
                title="Risk Matrix",
                table_headers=risk_headers,
                table_data=risk_rows,
            )
        )

        return self._render(sections, format)

    # ==================================================================
    # SECTION BUILDERS
    # ==================================================================

    def _build_title_page(
        self,
        title: str,
        authors: list[str],
        date: str,
        institution: str,
    ) -> DocumentSection:
        author_str = ", ".join(authors)
        content = (
            f"{title}\n\n"
            f"{author_str}\n"
            f"{institution}\n"
            f"{date}"
        )
        return DocumentSection(
            section_type="title",
            title=title,
            content=content,
            metadata={"authors": authors, "date": date, "institution": institution},
        )

    def _build_abstract(self, content: str) -> DocumentSection:
        return DocumentSection(section_type="abstract", title="Abstract", content=content)

    def _build_introduction(self, disease: str, context: str) -> DocumentSection:
        if not context:
            context = (
                f"The identification of novel therapeutic targets for {disease or 'the target disease'} "
                f"remains a critical challenge in biomedical research. This study leverages "
                f"AI-driven multi-agent discovery to systematically explore potential interventions."
            )
        return DocumentSection(section_type="heading", title="Introduction", level=1, content=context)

    def _build_methods(self, pipeline_config: dict) -> DocumentSection:
        parts = [
            "This study employed the Humanovo AI Discovery Platform, a multi-agent system "
            "that integrates literature mining, knowledge-graph reasoning, and molecular "
            "pathway analysis to generate and validate therapeutic hypotheses.",
        ]
        if pipeline_config:
            config_lines = []
            for key, value in pipeline_config.items():
                config_lines.append(f"<b>{key}:</b> {value}")
            if config_lines:
                parts.append("<br/>".join(config_lines))
        content = "<br/><br/>".join(parts)
        return DocumentSection(section_type="heading", title="Methods", level=1, content=content)

    def _build_results(self, hypotheses: list[dict], evidence: list[dict]) -> DocumentSection:
        content = (
            f"The discovery pipeline generated <b>{len(hypotheses)}</b> hypotheses "
            f"supported by <b>{len(evidence)}</b> pieces of evidence. "
            f"Hypotheses were ranked by composite confidence score integrating "
            f"mechanistic plausibility, novelty, and evidence strength."
        )
        return DocumentSection(
            section_type="heading",
            title="Results",
            level=1,
            content=content,
            metadata={"hypotheses": hypotheses, "evidence": evidence},
        )

    def _build_discussion(self, analysis: str) -> DocumentSection:
        if not analysis:
            analysis = (
                "The results demonstrate the utility of AI-driven multi-agent discovery "
                "for generating novel therapeutic hypotheses. Further experimental "
                "validation is required to confirm the proposed mechanisms."
            )
        return DocumentSection(section_type="heading", title="Discussion", level=1, content=analysis)

    def _build_references(self, citations: list[dict]) -> DocumentSection:
        return DocumentSection(
            section_type="reference",
            title="References",
            metadata={"citations": citations},
        )

    def _build_figures_tables(self, data: dict) -> DocumentSection:
        return DocumentSection(
            section_type="figure",
            title="Figures and Tables",
            metadata=data,
        )

    # ------------------------------------------------------------------
    # Composite sub-section helpers
    # ------------------------------------------------------------------

    def _build_hypothesis_score_table(self, hypothesis: dict) -> DocumentSection:
        """Build a scoring metrics table for a single hypothesis."""
        score_keys = [
            ("confidence_score", "Confidence Score"),
            ("confidence", "Confidence Score"),
            ("novelty_score", "Novelty Score"),
            ("feasibility_score", "Feasibility Score"),
            ("evidence_strength", "Evidence Strength"),
            ("mechanistic_plausibility", "Mechanistic Plausibility"),
            ("clinical_relevance", "Clinical Relevance"),
            ("safety_profile", "Safety Profile"),
        ]
        rows = []
        seen_labels: set[str] = set()
        for key, label in score_keys:
            if label in seen_labels:
                continue
            val = hypothesis.get(key)
            if val is not None:
                rows.append([label, str(val)])
                seen_labels.add(label)
        if not rows:
            rows.append(["No scores available", "N/A"])
        return DocumentSection(
            section_type="table",
            title="Scoring Metrics",
            table_headers=["Metric", "Score"],
            table_data=rows,
        )

    def _build_evidence_table(self, evidence: list[dict]) -> DocumentSection:
        """Build a summary table of evidence items."""
        headers = ["#", "Source", "Title / Excerpt", "Relevance"]
        rows = []
        for idx, ev in enumerate(evidence, 1):
            rows.append([
                str(idx),
                str(ev.get("source", ev.get("source_type", "N/A"))),
                str(ev.get("title", ev.get("excerpt", ev.get("content", ""))))[:100],
                str(ev.get("relevance_score", ev.get("score", "N/A"))),
            ])
        if not rows:
            rows.append(["—", "—", "No evidence available", "—"])
        return DocumentSection(
            section_type="table",
            title="Evidence Summary",
            table_headers=headers,
            table_data=rows,
        )

    def _build_config_table(self, config: dict) -> DocumentSection:
        """Build a config summary table."""
        rows = [[str(k), str(v)] for k, v in config.items()] if config else [["N/A", "Default configuration"]]
        return DocumentSection(
            section_type="table",
            title="Configuration Parameters",
            table_headers=["Parameter", "Value"],
            table_data=rows,
        )

    # ==================================================================
    # FORMAT DISPATCH
    # ==================================================================

    def _render(self, sections: list[DocumentSection], format: str) -> bytes:
        fmt = format.lower().strip()
        if fmt == "pdf":
            return self._build_pdf(sections)
        elif fmt in ("docx", "word"):
            return self._build_docx(sections)
        else:
            raise ValueError(f"Unsupported export format: {format!r}. Use 'pdf' or 'docx'.")

    # ==================================================================
    # PDF BUILDER
    # ==================================================================

    def _build_pdf(self, sections: list[DocumentSection]) -> bytes:
        """Render a list of DocumentSection objects into a PDF byte string."""
        buf = io.BytesIO()

        doc = _HumanovoDocTemplate(
            buf,
            pagesize=self._page_size,
            leftMargin=1 * inch,
            rightMargin=1 * inch,
            topMargin=1 * inch,
            bottomMargin=1 * inch,
        )

        # Two page templates: title page (no page number) and body
        frame = Frame(
            doc.leftMargin,
            doc.bottomMargin,
            doc.width,
            doc.height,
            id="body_frame",
        )
        title_template = PageTemplate(
            id="TitlePage",
            frames=[frame],
            onPage=_pdf_title_page_template,
        )
        body_template = PageTemplate(
            id="BodyPage",
            frames=[frame],
            onPage=_pdf_header_footer,
        )
        doc.addPageTemplates([title_template, body_template])

        story: list[Any] = []
        s = self._styles

        for section in sections:
            try:
                match section.section_type:
                    case "title":
                        story.extend(self._pdf_render_title(section))
                        story.append(NextPageTemplate("BodyPage"))

                    case "toc":
                        story.append(Paragraph("Table of Contents", s["Heading1"]))
                        story.append(Spacer(1, 12))
                        toc = TableOfContents()
                        toc.levelStyles = [
                            ParagraphStyle(
                                "TOCLevel0",
                                fontName="Helvetica-Bold",
                                fontSize=11,
                                leading=16,
                                leftIndent=0,
                                textColor=HUMANOVO_PRIMARY,
                            ),
                            ParagraphStyle(
                                "TOCLevel1",
                                fontName="Helvetica",
                                fontSize=10,
                                leading=14,
                                leftIndent=18,
                                textColor=HUMANOVO_SECONDARY,
                            ),
                            ParagraphStyle(
                                "TOCLevel2",
                                fontName="Helvetica",
                                fontSize=9,
                                leading=12,
                                leftIndent=36,
                                textColor=HUMANOVO_TEXT,
                            ),
                        ]
                        story.append(toc)

                    case "page_break":
                        story.append(PageBreak())

                    case "abstract":
                        story.append(Paragraph("Abstract", s["Heading1"]))
                        story.append(Spacer(1, 6))
                        story.append(Paragraph(section.content, s["Abstract"]))
                        story.append(Spacer(1, 12))

                    case "heading":
                        level = min(max(section.level, 1), 3)
                        style_key = f"Heading{level}"
                        story.append(Paragraph(section.title, s[style_key]))
                        if section.content:
                            story.append(Spacer(1, 4))
                            story.append(Paragraph(section.content, s["BodyText"]))

                    case "paragraph":
                        story.append(Paragraph(section.content, s["BodyText"]))

                    case "table":
                        story.extend(self._pdf_render_table(section))

                    case "reference":
                        story.extend(self._pdf_render_references(section))

                    case "figure":
                        # Placeholder — extend with image support as needed
                        if section.title:
                            story.append(Paragraph(section.title, s["Heading2"]))

                    case _:
                        logger.warning("Unknown section type in PDF builder", section_type=section.section_type)

            except Exception:
                logger.exception("Error rendering PDF section", section_type=section.section_type)
                story.append(
                    Paragraph(
                        f"[Error rendering section: {section.section_type}]",
                        s["BodyText"],
                    )
                )

        # Build with multi-pass for TOC page numbers
        doc.multiBuild(story)
        return buf.getvalue()

    # ------------------------------------------------------------------
    # PDF sub-renderers
    # ------------------------------------------------------------------

    def _pdf_render_title(self, section: DocumentSection) -> list:
        """Return story elements for a title page."""
        s = self._styles
        meta = section.metadata or {}
        elements: list[Any] = []
        elements.append(Spacer(1, 2 * inch))
        elements.append(Paragraph(section.title, s["Title"]))
        elements.append(Spacer(1, 0.3 * inch))

        authors = meta.get("authors", [])
        if authors:
            elements.append(Paragraph(", ".join(authors), s["Subtitle"]))
        institution = meta.get("institution", self._institution)
        if institution:
            elements.append(Paragraph(institution, s["CenteredBody"]))
        date_str = meta.get("date", "")
        if date_str:
            elements.append(Spacer(1, 0.2 * inch))
            elements.append(Paragraph(date_str, s["CenteredBody"]))

        # Decorative line
        elements.append(Spacer(1, 0.5 * inch))
        line_data = [["" * 1]]
        line_table = Table(line_data, colWidths=[4 * inch])
        line_table.setStyle(TableStyle([
            ("LINEBELOW", (0, 0), (-1, -1), 2, HUMANOVO_PRIMARY),
        ]))
        # Centre the line
        wrapper = Table([[line_table]], colWidths=[doc_width := self._page_size[0] - 2 * inch])
        wrapper.setStyle(TableStyle([("ALIGN", (0, 0), (-1, -1), "CENTER")]))
        elements.append(wrapper)
        return elements

    def _pdf_render_table(self, section: DocumentSection) -> list:
        """Render a table section into reportlab flowables."""
        s = self._styles
        elements: list[Any] = []

        if section.title:
            elements.append(Spacer(1, 8))
            elements.append(Paragraph(section.title, s["Heading2"]))
            elements.append(Spacer(1, 4))

        headers = section.table_headers or []
        rows = section.table_data or []

        if not headers and not rows:
            return elements

        # Wrap cell text in Paragraph for word-wrapping
        header_row = [Paragraph(h, s["TableHeader"]) for h in headers]
        data_rows = [
            [Paragraph(str(cell), s["TableCell"]) for cell in row]
            for row in rows
        ]

        table_data = [header_row] + data_rows if headers else data_rows
        num_cols = len(headers) if headers else (len(rows[0]) if rows else 0)
        if num_cols == 0:
            return elements

        # Compute proportional column widths
        avail_width = self._page_size[0] - 2 * inch
        col_width = avail_width / num_cols
        col_widths = [col_width] * num_cols

        table = Table(table_data, colWidths=col_widths, repeatRows=1)
        style_commands: list[tuple] = [
            # Header row
            ("BACKGROUND", (0, 0), (-1, 0), HUMANOVO_PRIMARY),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, 0), 9),
            ("BOTTOMPADDING", (0, 0), (-1, 0), 8),
            ("TOPPADDING", (0, 0), (-1, 0), 8),
            # Body rows
            ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
            ("FONTSIZE", (0, 1), (-1, -1), 9),
            ("TOPPADDING", (0, 1), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 1), (-1, -1), 5),
            # Grid
            ("GRID", (0, 0), (-1, -1), 0.5, colors.Color(0.8, 0.8, 0.8)),
            ("LINEBELOW", (0, 0), (-1, 0), 1.5, HUMANOVO_PRIMARY),
            # Alignment
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ]

        # Alternate row shading
        for row_idx in range(1, len(table_data)):
            if row_idx % 2 == 0:
                style_commands.append(
                    ("BACKGROUND", (0, row_idx), (-1, row_idx), HUMANOVO_LIGHT_BG)
                )

        table.setStyle(TableStyle(style_commands))
        elements.append(table)
        elements.append(Spacer(1, 10))
        return elements

    def _pdf_render_references(self, section: DocumentSection) -> list:
        """Render a references section."""
        s = self._styles
        elements: list[Any] = []
        elements.append(Spacer(1, 12))
        elements.append(Paragraph("References", s["Heading1"]))
        elements.append(Spacer(1, 6))

        citations = (section.metadata or {}).get("citations", [])
        if not citations:
            elements.append(Paragraph("No references available.", s["BodyText"]))
            return elements

        for idx, cite in enumerate(citations, 1):
            ref_text = self._format_citation(idx, cite)
            elements.append(Paragraph(ref_text, s["Reference"]))

        return elements

    # ==================================================================
    # DOCX BUILDER
    # ==================================================================

    def _build_docx(self, sections: list[DocumentSection]) -> bytes:
        """Render a list of DocumentSection objects into a DOCX byte string."""
        doc = DocxDocument()
        self._configure_docx_styles(doc)

        for section in sections:
            try:
                match section.section_type:
                    case "title":
                        self._docx_render_title(doc, section)

                    case "toc":
                        # Word TOC requires a field code — insert placeholder
                        self._docx_insert_toc(doc)

                    case "page_break":
                        doc.add_page_break()

                    case "abstract":
                        doc.add_heading("Abstract", level=1)
                        p = doc.add_paragraph()
                        p.style = doc.styles["IntenseQuote"]
                        run = p.add_run(self._strip_html(section.content))
                        run.font.size = Pt(10)
                        run.font.italic = True
                        run.font.color.rgb = HUMANOVO_TEXT_RGB

                    case "heading":
                        level = min(max(section.level, 1), 3)
                        doc.add_heading(section.title, level=level)
                        if section.content:
                            p = doc.add_paragraph(self._strip_html(section.content))
                            p.paragraph_format.space_after = Pt(6)

                    case "paragraph":
                        p = doc.add_paragraph(self._strip_html(section.content))
                        p.paragraph_format.space_after = Pt(6)

                    case "table":
                        self._docx_render_table(doc, section)

                    case "reference":
                        self._docx_render_references(doc, section)

                    case "figure":
                        if section.title:
                            doc.add_heading(section.title, level=2)

                    case _:
                        logger.warning("Unknown section type in DOCX builder", section_type=section.section_type)

            except Exception:
                logger.exception("Error rendering DOCX section", section_type=section.section_type)
                doc.add_paragraph(f"[Error rendering section: {section.section_type}]")

        # Add page numbers via footer
        self._docx_add_page_numbers(doc)

        buf = io.BytesIO()
        doc.save(buf)
        return buf.getvalue()

    # ------------------------------------------------------------------
    # DOCX configuration
    # ------------------------------------------------------------------

    def _configure_docx_styles(self, doc: DocxDocument) -> None:
        """Customise built-in styles for professional appearance."""
        style = doc.styles["Normal"]
        style.font.name = "Calibri"
        style.font.size = Pt(11)
        style.font.color.rgb = HUMANOVO_TEXT_RGB

        for level in range(1, 4):
            heading_style = doc.styles[f"Heading {level}"]
            heading_style.font.color.rgb = (
                HUMANOVO_PRIMARY_RGB if level == 1 else HUMANOVO_SECONDARY_RGB
            )
            heading_style.font.bold = True

    # ------------------------------------------------------------------
    # DOCX sub-renderers
    # ------------------------------------------------------------------

    def _docx_render_title(self, doc: DocxDocument, section: DocumentSection) -> None:
        meta = section.metadata or {}
        # Spacing before title
        for _ in range(4):
            doc.add_paragraph("")

        # Title
        title_para = doc.add_paragraph()
        title_para.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = title_para.add_run(section.title)
        run.font.size = Pt(26)
        run.font.bold = True
        run.font.color.rgb = HUMANOVO_PRIMARY_RGB

        # Authors
        authors = meta.get("authors", [])
        if authors:
            p = doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            run = p.add_run(", ".join(authors))
            run.font.size = Pt(14)
            run.font.color.rgb = HUMANOVO_SECONDARY_RGB

        # Institution
        institution = meta.get("institution", self._institution)
        if institution:
            p = doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            run = p.add_run(institution)
            run.font.size = Pt(11)

        # Date
        date_str = meta.get("date", "")
        if date_str:
            p = doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            p.paragraph_format.space_before = Pt(12)
            run = p.add_run(date_str)
            run.font.size = Pt(11)

    def _docx_insert_toc(self, doc: DocxDocument) -> None:
        """Insert a Table of Contents field that updates when the DOCX is opened in Word."""
        from docx.oxml.ns import qn
        from docx.oxml import OxmlElement

        paragraph = doc.add_paragraph()
        paragraph.alignment = WD_ALIGN_PARAGRAPH.LEFT
        run = paragraph.add_run()
        fld_char_begin = OxmlElement("w:fldChar")
        fld_char_begin.set(qn("w:fldCharType"), "begin")
        run._r.append(fld_char_begin)

        run2 = paragraph.add_run()
        instr_text = OxmlElement("w:instrText")
        instr_text.set(qn("xml:space"), "preserve")
        instr_text.text = ' TOC \\o "1-3" \\h \\z \\u '
        run2._r.append(instr_text)

        run3 = paragraph.add_run()
        fld_char_end = OxmlElement("w:fldChar")
        fld_char_end.set(qn("w:fldCharType"), "end")
        run3._r.append(fld_char_end)

    def _docx_render_table(self, doc: DocxDocument, section: DocumentSection) -> None:
        """Render a table in DOCX with header styling and borders."""
        if section.title:
            doc.add_heading(section.title, level=2)

        headers = section.table_headers or []
        rows = section.table_data or []
        if not headers and not rows:
            return

        num_cols = len(headers) if headers else (len(rows[0]) if rows else 0)
        num_rows = (1 if headers else 0) + len(rows)

        table = doc.add_table(rows=num_rows, cols=num_cols)
        table.style = "Light Grid Accent 1"
        table.alignment = WD_TABLE_ALIGNMENT.CENTER

        # Header row
        if headers:
            for col_idx, header in enumerate(headers):
                cell = table.rows[0].cells[col_idx]
                cell.text = ""
                p = cell.paragraphs[0]
                run = p.add_run(header)
                run.font.bold = True
                run.font.size = Pt(9)
                run.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
                # Shade header cells
                from docx.oxml.ns import qn as _qn
                from docx.oxml import OxmlElement as _Elem
                shading = _Elem("w:shd")
                shading.set(_qn("w:fill"), "1A3C6E")
                shading.set(_qn("w:val"), "clear")
                cell._tc.get_or_add_tcPr().append(shading)

        # Data rows
        start_row = 1 if headers else 0
        for row_idx, row_data in enumerate(rows):
            for col_idx, cell_text in enumerate(row_data):
                cell = table.rows[start_row + row_idx].cells[col_idx]
                cell.text = ""
                p = cell.paragraphs[0]
                run = p.add_run(str(cell_text))
                run.font.size = Pt(9)

        doc.add_paragraph("")  # spacing after table

    def _docx_render_references(self, doc: DocxDocument, section: DocumentSection) -> None:
        """Render the references section in DOCX."""
        doc.add_heading("References", level=1)
        citations = (section.metadata or {}).get("citations", [])
        if not citations:
            doc.add_paragraph("No references available.")
            return

        for idx, cite in enumerate(citations, 1):
            ref_text = self._format_citation_plain(idx, cite)
            p = doc.add_paragraph(ref_text)
            p.paragraph_format.left_indent = Inches(0.5)
            p.paragraph_format.first_line_indent = Inches(-0.5)
            p.paragraph_format.space_after = Pt(2)
            for run in p.runs:
                run.font.size = Pt(9)

    def _docx_add_page_numbers(self, doc: DocxDocument) -> None:
        """Add page numbers to the DOCX footer."""
        from docx.oxml.ns import qn
        from docx.oxml import OxmlElement

        for doc_section in doc.sections:
            footer = doc_section.footer
            footer.is_linked_to_previous = False
            paragraph = footer.paragraphs[0] if footer.paragraphs else footer.add_paragraph()
            paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER

            run = paragraph.add_run()
            fld_char_begin = OxmlElement("w:fldChar")
            fld_char_begin.set(qn("w:fldCharType"), "begin")
            run._r.append(fld_char_begin)

            run2 = paragraph.add_run()
            instr_text = OxmlElement("w:instrText")
            instr_text.set(qn("xml:space"), "preserve")
            instr_text.text = " PAGE "
            run2._r.append(instr_text)

            run3 = paragraph.add_run()
            fld_char_end = OxmlElement("w:fldChar")
            fld_char_end.set(qn("w:fldCharType"), "end")
            run3._r.append(fld_char_end)

    # ==================================================================
    # UTILITY HELPERS
    # ==================================================================

    @staticmethod
    def _strip_html(text: str) -> str:
        """Remove HTML tags for plain-text contexts (DOCX)."""
        import re
        text = text.replace("<br/>", "\n").replace("<br>", "\n")
        text = re.sub(r"<b>(.*?)</b>", r"\1", text)
        text = re.sub(r"<i>(.*?)</i>", r"\1", text)
        text = re.sub(r"<[^>]+>", "", text)
        text = text.replace("&bull;", "\u2022")
        text = text.replace("&amp;", "&")
        text = text.replace("&lt;", "<")
        text = text.replace("&gt;", ">")
        return text

    @staticmethod
    def _format_citation(idx: int, cite: dict) -> str:
        """Format a citation for PDF (with HTML markup)."""
        authors = cite.get("authors", cite.get("author", "Unknown"))
        if isinstance(authors, list):
            authors = ", ".join(authors)
        title = cite.get("title", "Untitled")
        journal = cite.get("journal", cite.get("source", ""))
        year = cite.get("year", cite.get("publication_year", ""))
        doi = cite.get("doi", "")
        pmid = cite.get("pmid", "")

        parts = [f"[{idx}] {authors}."]
        parts.append(f" <i>{title}</i>.")
        if journal:
            parts.append(f" {journal}.")
        if year:
            parts.append(f" ({year}).")
        if doi:
            parts.append(f" doi:{doi}")
        if pmid:
            parts.append(f" PMID:{pmid}")
        return "".join(parts)

    @staticmethod
    def _format_citation_plain(idx: int, cite: dict) -> str:
        """Format a citation for DOCX (plain text)."""
        authors = cite.get("authors", cite.get("author", "Unknown"))
        if isinstance(authors, list):
            authors = ", ".join(authors)
        title = cite.get("title", "Untitled")
        journal = cite.get("journal", cite.get("source", ""))
        year = cite.get("year", cite.get("publication_year", ""))
        doi = cite.get("doi", "")
        pmid = cite.get("pmid", "")

        parts = [f"[{idx}] {authors}. {title}."]
        if journal:
            parts.append(f" {journal}.")
        if year:
            parts.append(f" ({year}).")
        if doi:
            parts.append(f" doi:{doi}")
        if pmid:
            parts.append(f" PMID:{pmid}")
        return "".join(parts)

    @staticmethod
    def _extract_citations(evidence: list[dict]) -> list[dict]:
        """Extract unique citation records from evidence items."""
        seen: set[str] = set()
        citations: list[dict] = []
        for ev in evidence:
            # Use doi or title as dedup key
            key = ev.get("doi") or ev.get("pmid") or ev.get("title", "")
            if not key or key in seen:
                continue
            seen.add(key)
            citations.append({
                "authors": ev.get("authors", ev.get("author", "Unknown")),
                "title": ev.get("title", "Untitled"),
                "journal": ev.get("journal", ev.get("source", "")),
                "year": ev.get("year", ev.get("publication_year", "")),
                "doi": ev.get("doi", ""),
                "pmid": ev.get("pmid", ""),
            })
        return citations

    @staticmethod
    def _avg_score(items: list[dict]) -> float:
        """Calculate average relevance score across evidence items."""
        scores = []
        for item in items:
            s = item.get("relevance_score", item.get("score"))
            if s is not None:
                try:
                    scores.append(float(s))
                except (ValueError, TypeError):
                    pass
        return sum(scores) / len(scores) if scores else 0.0

    @staticmethod
    def _summarise_disease_context(disease: str, hypotheses: list[dict]) -> str:
        """Build a contextual introduction paragraph."""
        if not disease:
            return ""
        num = len(hypotheses)
        targets = []
        for h in hypotheses[:5]:
            t = h.get("target", h.get("drug_target", ""))
            if t:
                targets.append(str(t))
        target_str = ", ".join(targets) if targets else "multiple molecular targets"
        return (
            f"{disease} represents a significant unmet medical need. "
            f"This study employed AI-driven multi-agent discovery to identify "
            f"{num} novel therapeutic hypotheses targeting {target_str}. "
            f"The hypotheses were generated through systematic integration of "
            f"literature mining, knowledge-graph reasoning, and molecular pathway "
            f"analysis, followed by rigorous scoring for mechanistic plausibility, "
            f"novelty, and translational feasibility."
        )

    @staticmethod
    def _synthesise_discussion(hypotheses: list[dict], evidence: list[dict]) -> str:
        """Generate a discussion section summary."""
        if not hypotheses:
            return ""
        top = hypotheses[0] if hypotheses else {}
        top_title = top.get("title", top.get("name", "the top-ranked hypothesis"))
        top_conf = top.get("confidence_score", top.get("confidence", "N/A"))
        return (
            f"The AI-driven discovery pipeline identified {len(hypotheses)} therapeutic "
            f"hypotheses supported by {len(evidence)} pieces of evidence. "
            f"The highest-ranked hypothesis, \"{top_title}\", achieved a confidence "
            f"score of {top_conf}. "
            f"These results demonstrate the capacity of multi-agent AI systems to "
            f"systematically explore the therapeutic landscape and surface novel "
            f"intervention strategies. Further experimental validation — including "
            f"in-vitro assays, animal model studies, and ultimately clinical trials — "
            f"will be required to confirm the proposed mechanisms and assess "
            f"translational viability. The evidence compiled from diverse sources "
            f"(PubMed, clinical trials, pathway databases) provides a robust "
            f"foundation for prioritising follow-up studies."
        )

    @staticmethod
    def _generate_abstract(
        hypotheses: list[dict],
        evidence: list[dict],
        disease: str,
    ) -> str:
        """Generate a structured abstract."""
        num_h = len(hypotheses)
        num_e = len(evidence)
        disease_name = disease or "the target disease"
        top = hypotheses[0] if hypotheses else {}
        top_title = top.get("title", top.get("name", ""))

        parts = [
            f"Background: {disease_name} remains an area of significant unmet "
            f"medical need requiring novel therapeutic strategies.",
            "Methods: We employed the Humanovo AI Discovery Platform, a multi-agent "
            "system integrating literature mining, knowledge-graph reasoning, and "
            "molecular pathway analysis, to systematically generate and validate "
            "therapeutic hypotheses.",
            f"Results: The platform identified {num_h} novel hypotheses supported "
            f"by {num_e} pieces of evidence from diverse biomedical sources.",
        ]
        if top_title:
            parts.append(
                f"The top-ranked hypothesis, \"{top_title}\", demonstrated strong "
                f"mechanistic plausibility and evidence support."
            )
        parts.append(
            "Conclusions: AI-driven multi-agent discovery provides a powerful "
            "framework for identifying novel therapeutic targets. The hypotheses "
            "generated warrant further experimental and clinical validation."
        )
        return " ".join(parts)
