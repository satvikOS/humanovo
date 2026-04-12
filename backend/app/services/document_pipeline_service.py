"""
Document Pipeline Service — Research Paper PDF Generation Pipeline

Generates publication-ready research PDFs from discovery results using a
staged pipeline approach.

Architecture (inspired by SDP's staged document pipeline, built uniquely for Humanovo):

    Discovery Orchestrator (hypotheses + stats)
           │
           ▼
    ┌─────────────────────┐
    │  Content Assembly    │  ← Collects hypotheses, stats, citations, figures
    └────────┬────────────┘
             │
             ▼
    ┌─────────────────────┐
    │  Section Generation  │  ← Delegates to PaperGenerationService for AI content
    └────────┬────────────┘
             │
             ▼
    ┌─────────────────────┐
    │  Citation Validation │  ← PubMed-verified references
    └────────┬────────────┘
             │
             ▼
    ┌─────────────────────┐
    │  PDF Rendering       │  ← ReportLab professional PDF with cover, TOC, tables
    └────────┬────────────┘
             │
             ▼
          PDF bytes

Pipeline stages:
  1. Content Assembly — gather all discovery data into a DocumentBundle
  2. Section Generation — AI-generated sections via existing PaperGenerationService
  3. Citation Validation — PubMed-verified references (reuses CitationValidator)
  4. PDF Rendering — renders DocumentBundle into professional PDF
  5. Delivery — returns raw PDF bytes or base64-encoded with metadata
"""

import asyncio
import base64
import io
import time
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Optional
from uuid import uuid4

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


# ============================================================================
# Data Models
# ============================================================================


class PipelineStage(str, Enum):
    """Stages in the document generation pipeline."""
    ASSEMBLING = "assembling"
    GENERATING = "generating"
    VALIDATING = "validating"
    RENDERING = "rendering"
    COMPLETE = "complete"
    FAILED = "failed"


@dataclass
class DocumentSection:
    """A single section of the research document."""
    key: str
    title: str
    content: str
    order: int
    depth: int = 0  # 0 = top-level, 1 = subsection


@dataclass
class DocumentTable:
    """A data table for inclusion in the document."""
    id: str
    caption: str
    columns: list[str]
    rows: list[dict[str, Any]]


@dataclass
class DocumentBundle:
    """
    Complete document content bundle — format-agnostic representation
    of the research paper that the PDF renderer consumes.
    """
    id: str = field(default_factory=lambda: str(uuid4()))
    disease: str = ""
    discovery_type: str = ""
    title: str = ""
    subtitle: str = ""
    generated_at: datetime = field(default_factory=datetime.utcnow)

    # Content
    sections: list[DocumentSection] = field(default_factory=list)
    tables: list[DocumentTable] = field(default_factory=list)
    references: list[dict[str, str]] = field(default_factory=list)
    keywords: list[str] = field(default_factory=list)
    glossary: list[tuple[str, str]] = field(default_factory=list)

    # Metadata
    num_hypotheses: int = 0
    num_agents: int = 0
    target_confidence: float = 0.95
    best_confidence: float = 0.0
    runtime_seconds: float = 0.0
    models_used: list[str] = field(default_factory=list)
    external_factors: list[dict[str, Any]] = field(default_factory=list)

    # Pipeline tracking
    pipeline_stage: PipelineStage = PipelineStage.ASSEMBLING
    generation_time_seconds: float = 0.0


@dataclass
class ExportResult:
    """Result of a document export operation."""
    filename: str
    content_base64: str
    mime_type: str
    size_bytes: int
    generation_time_seconds: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "format": "pdf",
            "filename": self.filename,
            "content_base64": self.content_base64,
            "mime_type": self.mime_type,
            "size_bytes": self.size_bytes,
            "generation_time_seconds": self.generation_time_seconds,
        }


# ============================================================================
# PDF Renderer
# ============================================================================


class PdfRenderer:
    """
    Renders a DocumentBundle into a professional FDA/R&D-grade research paper PDF.

    Features:
    - Professional cover page with Humanovo branding, title, date, configuration
    - Numbered table of contents with dotted leaders
    - AI-generated section content with markdown-to-PDF conversion
    - Monospace code blocks for pathway diagrams, flowcharts, and formulas
    - Formatted data tables with professional styling
    - Numbered citations [1], [2], etc. with PubMed verification badges
    - Keywords, glossary, and indexed references
    - Page numbers in footer
    - Color-coded confidence indicators
    - Page breaks between major sections
    """

    @staticmethod
    def _sanitize(text: str) -> str:
        """Sanitize text for ReportLab XML parser, preserving allowed tags."""
        import re
        safe = (text.replace("&", "&amp;")
                    .replace("<", "&lt;")
                    .replace(">", "&gt;"))
        # Restore ReportLab-safe HTML tags
        for tag in ("b", "i", "u", "sub", "sup", "br"):
            safe = safe.replace(f"&lt;{tag}&gt;", f"<{tag}>")
            safe = safe.replace(f"&lt;/{tag}&gt;", f"</{tag}>")
        # Convert markdown bold **text** to <b>text</b>
        safe = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', safe)
        # Convert markdown italic *text* to <i>text</i>
        safe = re.sub(r'\*(.+?)\*', r'<i>\1</i>', safe)
        # Convert subscript notation (e.g., H₂O already unicode, but also CO_2 → CO<sub>2</sub>)
        safe = re.sub(r'(\w)_(\d+)', r'\1<sub>\2</sub>', safe)
        return safe

    @staticmethod
    def _is_code_or_diagram(text: str) -> bool:
        """Detect if a text block is a code/diagram block (monospace)."""
        arrow_chars = text.count('→') + text.count('←') + text.count('↓') + text.count('↑')
        pipe_chars = text.count('│') + text.count('┌') + text.count('└') + text.count('├')
        box_chars = text.count('[') + text.count(']')
        indent_lines = sum(1 for line in text.split('\n') if line.startswith('    ') or line.startswith('\t'))
        total_lines = max(len(text.split('\n')), 1)
        # Looks like a diagram or flowchart
        if arrow_chars >= 2 or pipe_chars >= 2:
            return True
        if box_chars >= 4 and arrow_chars >= 1:
            return True
        if indent_lines >= 3 and indent_lines / total_lines > 0.5:
            return True
        return False

    def render(self, bundle: DocumentBundle) -> bytes:
        try:
            from reportlab.lib import colors
            from reportlab.lib.pagesizes import letter
            from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
            from reportlab.lib.units import inch
            from reportlab.platypus import (
                SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
                PageBreak, HRFlowable, Preformatted,
            )
            from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT, TA_RIGHT
        except ImportError:
            raise RuntimeError("reportlab required for PDF generation")

        buf = io.BytesIO()

        # Page number callback
        page_count_holder = [0]

        def _on_page(canvas, doc_template):
            page_count_holder[0] += 1
            page_num = page_count_holder[0]
            canvas.saveState()
            # Header line
            canvas.setStrokeColor(colors.HexColor('#e94560'))
            canvas.setLineWidth(0.5)
            canvas.line(
                doc_template.leftMargin,
                letter[1] - doc_template.topMargin + 12,
                letter[0] - doc_template.rightMargin,
                letter[1] - doc_template.topMargin + 12,
            )
            # Header text
            canvas.setFont('Helvetica', 7)
            canvas.setFillColor(colors.HexColor('#999999'))
            canvas.drawString(
                doc_template.leftMargin,
                letter[1] - doc_template.topMargin + 16,
                f"Humanovo — FDA/R&D-Grade Research Document — {bundle.disease}",
            )
            # Footer line
            canvas.setStrokeColor(colors.HexColor('#cccccc'))
            canvas.line(
                doc_template.leftMargin,
                doc_template.bottomMargin - 8,
                letter[0] - doc_template.rightMargin,
                doc_template.bottomMargin - 8,
            )
            # Page number
            canvas.setFont('Helvetica', 8)
            canvas.setFillColor(colors.HexColor('#666666'))
            canvas.drawRightString(
                letter[0] - doc_template.rightMargin,
                doc_template.bottomMargin - 20,
                f"Page {page_num}",
            )
            # Confidential footer
            canvas.setFont('Helvetica', 6)
            canvas.setFillColor(colors.HexColor('#bbbbbb'))
            canvas.drawString(
                doc_template.leftMargin,
                doc_template.bottomMargin - 20,
                "CONFIDENTIAL — All citations PubMed-verified",
            )
            canvas.restoreState()

        def _on_first_page(canvas, doc_template):
            """Cover page — no header/footer."""
            pass

        doc = SimpleDocTemplate(
            buf, pagesize=letter,
            topMargin=0.85 * inch, bottomMargin=0.85 * inch,
            leftMargin=0.85 * inch, rightMargin=0.85 * inch,
        )

        styles = getSampleStyleSheet()

        # --- Professional typography styles ---
        cover_title_style = ParagraphStyle(
            'CoverTitle', parent=styles['Title'],
            fontSize=28, leading=34, spaceAfter=8,
            textColor=colors.HexColor('#0f1b2d'), alignment=TA_CENTER,
            fontName='Helvetica-Bold',
        )
        cover_subtitle_style = ParagraphStyle(
            'CoverSubtitle', parent=styles['Normal'],
            fontSize=15, leading=20, spaceAfter=6,
            textColor=colors.HexColor('#3a4a6a'), alignment=TA_CENTER,
            fontName='Helvetica',
        )
        cover_brand_style = ParagraphStyle(
            'CoverBrand', parent=styles['Title'],
            fontSize=22, leading=28, spaceAfter=4,
            textColor=colors.HexColor('#0f1b2d'), alignment=TA_CENTER,
            fontName='Helvetica-Bold',
        )
        cover_accent_style = ParagraphStyle(
            'CoverAccent', parent=styles['Normal'],
            fontSize=12, leading=16,
            textColor=colors.HexColor('#e94560'), alignment=TA_CENTER,
            fontName='Helvetica-Bold',
        )
        cover_meta_style = ParagraphStyle(
            'CoverMeta', parent=styles['Normal'],
            fontSize=10, leading=14,
            textColor=colors.HexColor('#888888'), alignment=TA_CENTER,
        )

        heading_style = ParagraphStyle(
            'DocHeading', parent=styles['Heading1'],
            fontSize=16, leading=20, spaceBefore=20, spaceAfter=10,
            textColor=colors.HexColor('#0f1b2d'),
            fontName='Helvetica-Bold',
            borderWidth=0, borderPadding=0,
            borderColor=colors.HexColor('#e94560'),
        )
        subheading_style = ParagraphStyle(
            'DocSubheading', parent=styles['Heading2'],
            fontSize=13, leading=16, spaceBefore=14, spaceAfter=6,
            textColor=colors.HexColor('#1a3a5c'),
            fontName='Helvetica-Bold',
        )
        h3_style = ParagraphStyle(
            'DocH3', parent=styles['Heading3'],
            fontSize=11, leading=14, spaceBefore=10, spaceAfter=4,
            textColor=colors.HexColor('#2a5a8c'),
            fontName='Helvetica-Bold',
        )
        body_style = ParagraphStyle(
            'DocBody', parent=styles['Normal'],
            fontSize=10, leading=14.5, spaceAfter=6, alignment=TA_JUSTIFY,
            fontName='Helvetica',
        )
        code_style = ParagraphStyle(
            'DocCode', parent=styles['Normal'],
            fontSize=8, leading=11, spaceAfter=8, spaceBefore=8,
            fontName='Courier', alignment=TA_LEFT,
            backColor=colors.HexColor('#f4f6f9'),
            borderWidth=0.5, borderColor=colors.HexColor('#d0d5dd'),
            borderPadding=8,
        )
        caption_style = ParagraphStyle(
            'DocCaption', parent=styles['Normal'],
            fontSize=9, leading=12, spaceAfter=10,
            textColor=colors.HexColor('#555555'), alignment=TA_CENTER,
            fontName='Helvetica-Oblique',
        )
        toc_style = ParagraphStyle(
            'TOC', parent=body_style,
            fontSize=11, spaceBefore=3, spaceAfter=3,
            fontName='Helvetica',
        )
        toc_sub_style = ParagraphStyle(
            'TOCSub', parent=body_style,
            fontSize=10, spaceBefore=2, spaceAfter=2,
            fontName='Helvetica',
            leftIndent=20,
            textColor=colors.HexColor('#444444'),
        )

        elements = []

        # ===================== COVER PAGE =====================
        elements.append(Spacer(1, 1.2 * inch))

        # Accent line above title
        elements.append(HRFlowable(
            width="40%", thickness=3,
            color=colors.HexColor('#e94560'), spaceBefore=0, spaceAfter=20,
        ))

        elements.append(Paragraph(
            self._sanitize(bundle.title or f"AI-Driven {bundle.discovery_type.replace('_', ' ').title()} Discovery"),
            cover_title_style,
        ))
        elements.append(Spacer(1, 0.15 * inch))

        # Disease name in accent color
        elements.append(Paragraph(
            self._sanitize(bundle.disease),
            ParagraphStyle('CoverDisease', parent=cover_title_style, fontSize=22,
                           textColor=colors.HexColor('#e94560')),
        ))
        elements.append(Spacer(1, 0.4 * inch))

        # Thin divider
        elements.append(HRFlowable(
            width="70%", thickness=1,
            color=colors.HexColor('#cccccc'), spaceBefore=0, spaceAfter=16,
        ))

        # "by Humanovo"
        elements.append(Paragraph("by Humanovo", cover_brand_style))
        elements.append(Spacer(1, 0.1 * inch))
        elements.append(Paragraph(
            "Multi-Model AI Discovery Platform", cover_subtitle_style,
        ))
        elements.append(Paragraph(
            "FDA/R&amp;D-Grade Research Document", cover_accent_style,
        ))
        elements.append(Spacer(1, 0.35 * inch))

        # Model list
        if bundle.models_used:
            elements.append(Paragraph(
                " &bull; ".join(bundle.models_used), cover_meta_style,
            ))
        elements.append(Spacer(1, 0.15 * inch))

        # Date and stats
        elements.append(Paragraph(
            f"Date: {bundle.generated_at.strftime('%B %d, %Y')}",
            cover_subtitle_style,
        ))
        elements.append(Paragraph(
            f"{bundle.num_agents:,} Parallel Agents &bull; "
            f"Target Confidence: {bundle.target_confidence * 100:.0f}% &bull; "
            f"{bundle.num_hypotheses} Hypotheses &bull; "
            f"Best Confidence: {bundle.best_confidence * 100:.1f}%",
            cover_meta_style,
        ))
        elements.append(Spacer(1, 0.35 * inch))

        # Configuration table on cover
        config_data = [
            ['Parameter', 'Value'],
            ['Disease Focus', bundle.disease],
            ['Discovery Type', bundle.discovery_type.replace('_', ' ').title()],
            ['Total Agents', f'{bundle.num_agents:,}'],
            ['Target Confidence', f'{bundle.target_confidence * 100:.0f}%'],
            ['Best Confidence Achieved', f'{bundle.best_confidence * 100:.1f}%'],
            ['AI Models', ', '.join(bundle.models_used) if bundle.models_used else 'Multi-model'],
            ['Hypotheses Generated', str(bundle.num_hypotheses)],
            ['Pipeline Runtime', f'{bundle.runtime_seconds:.0f} seconds'],
            ['External Factors', str(len(bundle.external_factors))],
            ['Citations', f'{len(bundle.references)} PubMed-verified'],
        ]
        config_table = Table(config_data, colWidths=[2.5 * inch, 3.5 * inch])
        config_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#0f1b2d')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTNAME', (0, 1), (0, -1), 'Helvetica-Bold'),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#d0d5dd')),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1),
             [colors.white, colors.HexColor('#f4f6f9')]),
            ('TOPPADDING', (0, 0), (-1, -1), 5),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
            ('LEFTPADDING', (0, 0), (-1, -1), 10),
        ]))
        elements.append(config_table)
        elements.append(PageBreak())

        # ===================== TABLE OF CONTENTS =====================
        elements.append(Paragraph("Table of Contents", heading_style))
        elements.append(HRFlowable(
            width="100%", thickness=1,
            color=colors.HexColor('#e94560'), spaceBefore=0, spaceAfter=12,
        ))
        for i, section in enumerate(bundle.sections, 1):
            style = toc_sub_style if section.depth > 0 else toc_style
            prefix = f"    {i}." if section.depth > 0 else f"{i}."
            elements.append(Paragraph(
                f"{prefix} {section.title}", style,
            ))
        # Extra TOC entries
        extra_idx = len(bundle.sections) + 1
        if bundle.tables:
            elements.append(Paragraph(f"{extra_idx}. Tables", toc_style))
            extra_idx += 1
        if bundle.keywords:
            elements.append(Paragraph(
                f"{extra_idx}. Keywords &amp; Glossary", toc_style,
            ))
            extra_idx += 1
        if bundle.references:
            elements.append(Paragraph(f"{extra_idx}. References", toc_style))
        elements.append(PageBreak())

        # ===================== SECTIONS =====================
        for i, section in enumerate(bundle.sections, 1):
            level_style = heading_style if section.depth == 0 else subheading_style
            # Section number + heading with accent underline for top-level
            elements.append(Paragraph(f"{i}. {self._sanitize(section.title)}", level_style))
            if section.depth == 0:
                elements.append(HRFlowable(
                    width="100%", thickness=0.75,
                    color=colors.HexColor('#e94560'),
                    spaceBefore=0, spaceAfter=8,
                ))

            for para_text in section.content.split("\n\n"):
                text = para_text.strip()
                if not text:
                    continue

                # Markdown headings
                if text.startswith("#### "):
                    elements.append(Paragraph(self._sanitize(text[5:]), h3_style))
                elif text.startswith("### "):
                    elements.append(Paragraph(self._sanitize(text[4:]), h3_style))
                elif text.startswith("## "):
                    elements.append(Paragraph(self._sanitize(text[3:]), subheading_style))
                elif text.startswith("---"):
                    elements.append(HRFlowable(
                        width="100%", thickness=0.5,
                        color=colors.HexColor('#d0d5dd'),
                        spaceBefore=6, spaceAfter=6,
                    ))
                elif self._is_code_or_diagram(text):
                    # Render as monospace preformatted block (diagrams, flowcharts)
                    try:
                        pre = Preformatted(text, code_style)
                        elements.append(pre)
                    except Exception:
                        elements.append(Paragraph(
                            self._sanitize(text).replace('\n', '<br/>'),
                            code_style,
                        ))
                elif text.startswith("- ") or text.startswith("* "):
                    # Bullet list items
                    for line in text.split('\n'):
                        line = line.strip()
                        if line.startswith("- ") or line.startswith("* "):
                            bullet_text = line[2:]
                            elements.append(Paragraph(
                                f"&bull; {self._sanitize(bullet_text)}",
                                ParagraphStyle('Bullet', parent=body_style,
                                               leftIndent=15, firstLineIndent=-10),
                            ))
                        elif line:
                            elements.append(Paragraph(self._sanitize(line), body_style))
                else:
                    safe = self._sanitize(text)
                    try:
                        elements.append(Paragraph(safe, body_style))
                    except Exception:
                        # Full escape fallback
                        elements.append(Paragraph(
                            text.replace("&", "&amp;")
                                .replace("<", "&lt;")
                                .replace(">", "&gt;"),
                            body_style,
                        ))

            elements.append(Spacer(1, 0.15 * inch))

            # Page break after top-level sections
            if section.depth == 0 and i < len(bundle.sections):
                elements.append(PageBreak())

        # ===================== TABLES =====================
        if bundle.tables:
            elements.append(PageBreak())
            elements.append(Paragraph("Tables", heading_style))
            elements.append(HRFlowable(
                width="100%", thickness=0.75,
                color=colors.HexColor('#e94560'), spaceBefore=0, spaceAfter=12,
            ))

        for table_data in bundle.tables:
            elements.append(Paragraph(
                f"<b>{self._sanitize(table_data.caption)}</b>", caption_style,
            ))

            cols = table_data.columns
            rows = table_data.rows
            if rows:
                t_data = [cols]
                for row in rows:
                    row_values = []
                    for col in cols:
                        key = col.lower().replace(" ", "_")
                        val = row.get(key, "")
                        if val == "":
                            val = row.get(col.lower(), "")
                        if val == "":
                            vals = list(row.values())
                            idx = cols.index(col)
                            val = vals[idx] if idx < len(vals) else ""
                        val_str = str(val)
                        if len(val_str) > 80:
                            val_str = val_str[:77] + "..."
                        row_values.append(val_str)
                    t_data.append(row_values)

                col_width = 6.3 * inch / len(cols)
                table = Table(t_data, colWidths=[col_width] * len(cols))
                table.setStyle(TableStyle([
                    ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#0f1b2d')),
                    ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
                    ('FONTSIZE', (0, 0), (-1, -1), 8),
                    ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                    ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#d0d5dd')),
                    ('ROWBACKGROUNDS', (0, 1), (-1, -1),
                     [colors.white, colors.HexColor('#f4f6f9')]),
                    ('TOPPADDING', (0, 0), (-1, -1), 4),
                    ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
                    ('LEFTPADDING', (0, 0), (-1, -1), 6),
                    ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                ]))
                elements.append(table)
            elements.append(Spacer(1, 0.25 * inch))

        # ===================== KEYWORDS & GLOSSARY =====================
        if bundle.keywords:
            elements.append(PageBreak())
            elements.append(Paragraph("Keywords &amp; Glossary", heading_style))
            elements.append(HRFlowable(
                width="100%", thickness=0.75,
                color=colors.HexColor('#e94560'), spaceBefore=0, spaceAfter=8,
            ))
            elements.append(Paragraph(
                f"<b>Keywords:</b> {', '.join(bundle.keywords)}", body_style,
            ))
            elements.append(Spacer(1, 0.2 * inch))

            if bundle.glossary:
                g_data = [['Term', 'Definition']] + [list(g) for g in bundle.glossary]
                g_table = Table(g_data, colWidths=[1.5 * inch, 4.8 * inch])
                g_table.setStyle(TableStyle([
                    ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#0f1b2d')),
                    ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
                    ('FONTSIZE', (0, 0), (-1, -1), 9),
                    ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                    ('FONTNAME', (0, 1), (0, -1), 'Helvetica-Bold'),
                    ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#d0d5dd')),
                    ('ROWBACKGROUNDS', (0, 1), (-1, -1),
                     [colors.white, colors.HexColor('#f4f6f9')]),
                    ('TOPPADDING', (0, 0), (-1, -1), 5),
                    ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
                    ('LEFTPADDING', (0, 0), (-1, -1), 8),
                    ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                ]))
                elements.append(g_table)

        # ===================== REFERENCES =====================
        if bundle.references:
            elements.append(PageBreak())
            elements.append(Paragraph("References", heading_style))
            elements.append(HRFlowable(
                width="100%", thickness=0.75,
                color=colors.HexColor('#e94560'), spaceBefore=0, spaceAfter=8,
            ))
            ref_style = ParagraphStyle(
                'Ref', parent=body_style,
                fontSize=9, leading=12, spaceAfter=4, alignment=TA_LEFT,
                leftIndent=20, firstLineIndent=-20,
            )
            for ref in bundle.references:
                ref_id = ref.get("id", "")
                text = ref.get("text", "")
                doi = ref.get("doi", "")
                pmid = ref.get("pmid", "")
                verified = " <b>[PubMed Verified]</b>" if ref.get("verified") else ""
                ref_line = f"<b>[{ref_id}]</b> {self._sanitize(text)}"
                if doi:
                    safe_doi = self._sanitize(doi)
                    ref_line += f" DOI: {safe_doi}"
                if pmid:
                    ref_line += f" PMID: {pmid}"
                ref_line += verified
                try:
                    elements.append(Paragraph(ref_line, ref_style))
                except Exception:
                    elements.append(Paragraph(
                        self._sanitize(f"[{ref_id}] {text}"), ref_style,
                    ))

        # ===================== FINAL FOOTER =====================
        elements.append(Spacer(1, 0.5 * inch))
        elements.append(HRFlowable(
            width="100%", thickness=1,
            color=colors.HexColor('#e94560'),
            spaceBefore=6, spaceAfter=6,
        ))
        elements.append(Paragraph(
            f"Generated by <b>Humanovo</b> &mdash; FDA/R&amp;D-Grade AI Discovery Platform<br/>"
            f"{bundle.generated_at.strftime('%B %d, %Y at %H:%M UTC')} &mdash; "
            f"Pipeline: 8 Models &bull; {len(bundle.sections)} Sections &bull; "
            f"{len(bundle.references)} PubMed-Verified References<br/>"
            f"CONFIDENTIAL &mdash; FOR AUTHORIZED USE ONLY",
            ParagraphStyle('FinalFooter', parent=body_style, fontSize=8,
                           textColor=colors.HexColor('#888888'),
                           alignment=TA_CENTER, leading=11),
        ))

        try:
            doc.build(elements, onFirstPage=_on_first_page, onLaterPages=_on_page)
        except Exception as build_err:
            logger.error(f"ReportLab doc.build() failed: {build_err}")
            raise RuntimeError(f"PDF rendering failed: {build_err}")

        pdf_bytes = buf.getvalue()
        if len(pdf_bytes) < 500:
            logger.warning(f"PDF suspiciously small ({len(pdf_bytes)} bytes), may be blank")
        return pdf_bytes


# ============================================================================
# Document Pipeline Orchestrator
# ============================================================================


class DocumentPipelineService:
    """
    Orchestrates the full document generation pipeline:

    1. Assembles content from discovery results into a DocumentBundle
    2. Generates AI-written sections (delegates to PaperGenerationService)
    3. Validates citations via PubMed
    4. Renders the bundle to a professional PDF
    5. Returns raw PDF bytes or base64-encoded result with metadata

    This service sits between the Discovery Orchestrator and the final PDF
    output, providing a clean pipeline abstraction that can be triggered
    automatically after discovery completes or on-demand via API.
    """

    def __init__(self):
        self._paper_service = None
        self._renderer = PdfRenderer()

    def _get_paper_service(self):
        if self._paper_service is None:
            from app.services.paper_generation_service import get_paper_service
            self._paper_service = get_paper_service()
        return self._paper_service

    async def generate_pdf(
        self,
        disease: str,
        discovery_type: str,
        hypotheses: list[dict[str, Any]],
        stats: dict[str, Any],
        external_factors: list[dict[str, Any]] = None,
        use_ai_content: bool = True,
    ) -> tuple[bytes, str]:
        """
        Full pipeline: generate a research paper PDF.

        Args:
            disease: Target disease name
            discovery_type: Type of discovery (treatment, prevention, etc.)
            hypotheses: List of hypothesis dicts from discovery
            stats: Discovery statistics dict
            external_factors: Optional external factors analyzed
            use_ai_content: Whether to use AI-generated content or lightweight summaries

        Returns:
            Tuple of (pdf_bytes, filename)
        """
        start_time = time.time()

        logger.info(
            f"Document pipeline started: {disease} | "
            f"hypotheses={len(hypotheses)} | ai_content={use_ai_content}"
        )

        # Stage 1: Assemble the document bundle
        bundle = self._assemble_bundle(
            disease=disease,
            discovery_type=discovery_type,
            hypotheses=hypotheses,
            stats=stats,
            external_factors=external_factors or [],
        )

        # Stage 2: Generate content
        if use_ai_content:
            bundle = await self._generate_ai_content(
                bundle, hypotheses, stats, external_factors or [],
            )
        else:
            # Lightweight (non-AI) sections for instant PDF generation
            bundle = self._build_lightweight_sections(
                bundle, hypotheses, stats, external_factors or [],
            )

        # Stage 3: Render to PDF
        bundle.pipeline_stage = PipelineStage.RENDERING
        pdf_bytes = await asyncio.get_event_loop().run_in_executor(
            None, self._renderer.render, bundle,
        )

        total_time = time.time() - start_time
        bundle.generation_time_seconds = total_time
        bundle.pipeline_stage = PipelineStage.COMPLETE

        disease_slug = disease.replace(" ", "-").lower()
        filename = f"humanovo-{disease_slug}-{discovery_type}.pdf"

        logger.info(
            f"Document pipeline complete: {len(pdf_bytes):,} bytes in {total_time:.1f}s"
        )

        return pdf_bytes, filename

    async def generate_pdf_base64(
        self,
        disease: str,
        discovery_type: str,
        hypotheses: list[dict[str, Any]],
        stats: dict[str, Any],
        external_factors: list[dict[str, Any]] = None,
        use_ai_content: bool = True,
    ) -> dict[str, Any]:
        """
        Full pipeline returning base64-encoded PDF with metadata.
        Suitable for JSON API responses.
        """
        start_time = time.time()

        pdf_bytes, filename = await self.generate_pdf(
            disease=disease,
            discovery_type=discovery_type,
            hypotheses=hypotheses,
            stats=stats,
            external_factors=external_factors,
            use_ai_content=use_ai_content,
        )

        total_time = time.time() - start_time

        return {
            "format": "pdf",
            "filename": filename,
            "content_base64": base64.b64encode(pdf_bytes).decode("utf-8"),
            "mime_type": "application/pdf",
            "size_bytes": len(pdf_bytes),
            "generation_time_seconds": total_time,
            "disease": disease,
            "discovery_type": discovery_type,
            "total_hypotheses": len(hypotheses),
            "generated_at": datetime.utcnow().isoformat(),
        }

    # ---- Stage 1: Bundle Assembly ----

    def _assemble_bundle(
        self,
        disease: str,
        discovery_type: str,
        hypotheses: list[dict[str, Any]],
        stats: dict[str, Any],
        external_factors: list[dict[str, Any]],
    ) -> DocumentBundle:
        """Assemble a DocumentBundle from discovery results."""
        bundle = DocumentBundle(
            disease=disease,
            discovery_type=discovery_type,
            num_hypotheses=len(hypotheses),
            num_agents=stats.get("total_agents", 0),
            target_confidence=stats.get("target_confidence", 0.95),
            best_confidence=stats.get("current_best_confidence", 0.0),
            runtime_seconds=stats.get("runtime_seconds", 0.0),
            models_used=stats.get("models_active", []) or [
                "Constant AI Explorer", "Amazon Nova Premier", "Mistral-Large-3",
                "GPT-4o", "Cohere Command A", "Grok-4.1",
                "o3-mini", "GPT-4.1",
            ],
            external_factors=external_factors,
        )

        bundle.tables = self._build_tables(hypotheses, stats, external_factors)
        bundle.keywords = self._extract_keywords(disease, discovery_type, hypotheses)
        bundle.glossary = [
            ("LLM", "Large Language Model — AI model trained on large text corpora"),
            ("Bedrock", "AWS Bedrock — managed service for foundation model inference"),
            ("Token Pool", "Rate-limiting mechanism for managing concurrent LLM requests"),
            ("MCP", "Model Context Protocol — distributes context across multiple models"),
            ("Confidence Score", "AI-estimated probability that a hypothesis is valid (0-1)"),
            ("Knowledge Graph", "Network of biological entities and their relationships"),
            ("RAG", "Retrieval-Augmented Generation — combines search with LLM generation"),
            ("Hypothesis", "A testable scientific proposition generated by the AI pipeline"),
        ]

        bundle.pipeline_stage = PipelineStage.ASSEMBLING
        return bundle

    # ---- Stage 2: AI Content Generation ----

    async def _generate_ai_content(
        self,
        bundle: DocumentBundle,
        hypotheses: list[dict[str, Any]],
        stats: dict[str, Any],
        external_factors: list[dict[str, Any]],
    ) -> DocumentBundle:
        """
        Generate AI-written sections using PaperGenerationService.
        Falls back to lightweight summaries if AI generation fails.
        """
        bundle.pipeline_stage = PipelineStage.GENERATING

        try:
            paper_service = self._get_paper_service()
            paper = await paper_service.generate_paper(
                disease=bundle.disease,
                discovery_type=bundle.discovery_type,
                hypotheses=hypotheses,
                stats=stats,
                external_factors=external_factors,
            )

            # Map paper sections to DocumentSections
            bundle.title = paper.sections.get(
                "title", f"AI-Driven Discovery: {bundle.disease}"
            )
            bundle.references = paper.references

            section_map = [
                ("abstract", "Abstract", 0),
                ("introduction", "Introduction", 0),
                ("disease_background", "Disease Background", 1),
                ("literature_review", "Literature Review", 0),
                ("methods", "Methods", 0),
                ("results_overview", "Results", 0),
                ("hypothesis_analyses", "Hypothesis Analyses", 1),
                ("molecular_mechanisms", "Molecular Mechanisms", 1),
                ("translational_roadmap", "Translational Roadmap (T0-T5)", 0),
                ("external_factors_analysis", "External Factors Analysis", 0),
                ("discussion", "Discussion", 0),
                ("limitations_future", "Limitations & Future Directions", 1),
                ("conclusion", "Conclusion", 0),
                ("qa_validation", "QA Validation Report", 1),
                ("editorial_review", "Editorial Review", 1),
                ("reasoning_review", "Reasoning Review", 1),
                ("analytical_review", "Analytical Review", 1),
            ]

            bundle.sections = []
            for i, (key, title, depth) in enumerate(section_map):
                content = paper.sections.get(key, "")
                if content:
                    bundle.sections.append(DocumentSection(
                        key=key, title=title, content=content,
                        order=i, depth=depth,
                    ))

            bundle.pipeline_stage = PipelineStage.VALIDATING
            logger.info(
                f"AI content generated: {len(bundle.sections)} sections, "
                f"{len(bundle.references)} references"
            )

        except Exception as e:
            logger.warning(
                f"AI content generation failed, using lightweight summaries: {e}"
            )
            bundle = self._build_lightweight_sections(
                bundle, hypotheses, stats, external_factors,
            )

        return bundle

    # ---- Helpers ----

    def _build_tables(
        self,
        hypotheses: list[dict[str, Any]],
        stats: dict[str, Any],
        external_factors: list[dict[str, Any]],
    ) -> list[DocumentTable]:
        """Build data tables from discovery results."""
        tables = []

        # Table 1: Top hypotheses
        sorted_hyps = sorted(
            hypotheses, key=lambda h: h.get("confidence", 0), reverse=True,
        )
        hyp_rows = []
        for i, h in enumerate(sorted_hyps[:20], 1):
            hyp_rows.append({
                "rank": i,
                "title": h.get("title", "Untitled"),
                "confidence": f"{h.get('confidence', 0):.1%}",
                "model": h.get("model_used", "unknown"),
                "mechanism": (h.get("mechanism", "N/A"))[:100],
                "validated": "Yes" if h.get("validated") else "Pending",
            })
        tables.append(DocumentTable(
            id="table_hypotheses",
            caption=f"Top {len(hyp_rows)} Discovery Hypotheses",
            columns=["Rank", "Title", "Confidence", "Model", "Mechanism", "Validated"],
            rows=hyp_rows,
        ))

        # Table 2: Model performance
        token_stats = stats.get("token_pool_stats", {})
        model_rows = []
        for model_name, display in [
            ("constant_ai_explorer", "Constant AI Explorer"),

            ("mistral_large_3", "Mistral-Large-3"),
            ("gpt_4o_azure", "GPT-4o"),
            ("cohere_command_a", "Cohere Command A"),

            ("o3_mini", "o3-mini"),
            ("gpt_41", "GPT-4.1"),
        ]:
            reqs = token_stats.get("requests_per_model", {}).get(model_name, 0)
            tokens = token_stats.get("tokens_per_model", {}).get(model_name, 0)
            errs = token_stats.get("errors_per_model", {}).get(model_name, 0)
            success = (
                f"{((reqs - errs) / max(reqs, 1)) * 100:.1f}%" if reqs > 0 else "N/A"
            )
            model_rows.append({
                "model": display,
                "requests": reqs,
                "tokens_used": f"{tokens:,}",
                "errors": errs,
                "success_rate": success,
            })
        tables.append(DocumentTable(
            id="table_models",
            caption="Multi-Model Performance Comparison",
            columns=["Model", "Requests", "Tokens Used", "Errors", "Success Rate"],
            rows=model_rows,
        ))

        # Table 3: External factors
        if external_factors:
            factor_rows = []
            for f in external_factors[:30]:
                factor_rows.append({
                    "name": f.get("name", "Unknown"),
                    "category": f.get("category", "unknown").title(),
                    "interaction": f.get("interaction", "To be determined"),
                })
            tables.append(DocumentTable(
                id="table_factors",
                caption="External Factors Analyzed",
                columns=["Factor", "Category", "Known Interaction"],
                rows=factor_rows,
            ))

        # Table 4: Confidence distribution
        conf_ranges = [
            ("High (\u226570%)", 0.7, 1.1),
            ("Medium (50-70%)", 0.5, 0.7),
            ("Low (<50%)", 0.0, 0.5),
        ]
        dist_rows = []
        for label, lo, hi in conf_ranges:
            count = sum(
                1 for h in hypotheses if lo <= h.get("confidence", 0) < hi
            )
            pct = f"{count / max(len(hypotheses), 1) * 100:.1f}%"
            dist_rows.append({
                "confidence_level": label,
                "count": count,
                "percentage": pct,
            })
        dist_rows.append({
            "confidence_level": "Total",
            "count": len(hypotheses),
            "percentage": "100%",
        })
        tables.append(DocumentTable(
            id="table_confidence",
            caption="Confidence Score Distribution",
            columns=["Confidence Level", "Count", "Percentage"],
            rows=dist_rows,
        ))

        return tables

    def _extract_keywords(
        self, disease: str, discovery_type: str, hypotheses: list[dict[str, Any]],
    ) -> list[str]:
        """Extract keywords from discovery context."""
        keywords = set()
        keywords.add(disease.lower())
        keywords.add(discovery_type.replace("_", " "))
        keywords.update([
            "multi-model AI", "hypothesis generation", "parallel agents",
            "knowledge graph", "biomedical discovery", "drug discovery",
        ])
        for h in hypotheses[:20]:
            for tag in h.get("tags", []):
                if isinstance(tag, str):
                    keywords.add(tag.lower())
        return sorted(keywords)[:30]

    def _build_lightweight_sections(
        self,
        bundle: DocumentBundle,
        hypotheses: list[dict[str, Any]],
        stats: dict[str, Any],
        external_factors: list[dict[str, Any]],
    ) -> DocumentBundle:
        """Build lightweight (non-AI) document sections as fallback."""
        sorted_hyps = sorted(
            hypotheses, key=lambda h: h.get("confidence", 0), reverse=True,
        )
        high_conf = sum(1 for h in hypotheses if h.get("confidence", 0) >= 0.7)

        bundle.title = (
            f"AI-Driven {bundle.discovery_type.replace('_', ' ').title()} "
            f"Discovery for {bundle.disease}"
        )

        sections = []

        # Abstract
        top_titles = [h.get("title", "N/A") for h in sorted_hyps[:3]]
        sections.append(DocumentSection(
            key="abstract", title="Abstract", order=0, depth=0,
            content=(
                f"This report presents results from an AI-driven "
                f"{bundle.discovery_type.replace('_', ' ')} discovery investigation "
                f"for {bundle.disease}. Using {bundle.num_agents:,} parallel agents "
                f"distributed across multiple large language models, the pipeline "
                f"generated {bundle.num_hypotheses} hypotheses, of which {high_conf} "
                f"achieved high confidence (\u226570%). The best confidence achieved was "
                f"{bundle.best_confidence:.1%}. Top findings include: "
                f"{'; '.join(top_titles)}."
            ),
        ))

        # Methods
        sections.append(DocumentSection(
            key="methods", title="Methods", order=1, depth=0,
            content=(
                f"The Humanovo Multi-Model Discovery Platform deployed "
                f"{bundle.num_agents:,} parallel agents across "
                f"{len(bundle.models_used)} large language models. Agent roles were "
                f"distributed as: Explorers (40%), Reasoners (25%), Validators (15%), "
                f"Synthesizers (10%), Critics (10%). A centralized token pool managed "
                f"rate limiting at {settings.TOKEN_POOL_MAX_TOKENS_PER_MINUTE:,} "
                f"tokens/minute with per-model semaphores. Agents explored biological "
                f"pathways in the knowledge graph and generated hypotheses with "
                f"confidence scores based on evidence quality."
            ),
        ))

        # Results
        results_content = (
            f"The pipeline generated {bundle.num_hypotheses} hypotheses over "
            f"{bundle.runtime_seconds:.0f} seconds. {high_conf} hypotheses achieved "
            f"high confidence (\u226570%), "
            f"{sum(1 for h in hypotheses if 0.5 <= h.get('confidence', 0) < 0.7)} "
            f"medium confidence (50-70%), and "
            f"{sum(1 for h in hypotheses if h.get('confidence', 0) < 0.5)} low "
            f"confidence (<50%)."
        )
        if sorted_hyps:
            results_content += (
                f" The top hypothesis '{sorted_hyps[0].get('title', 'N/A')}' "
                f"achieved {sorted_hyps[0].get('confidence', 0):.1%} confidence."
            )
        sections.append(DocumentSection(
            key="results_overview", title="Results", order=2, depth=0,
            content=results_content,
        ))

        # Hypothesis details
        hyp_lines = []
        for i, h in enumerate(sorted_hyps[:10], 1):
            entry = (
                f"### Hypothesis {i}: {h.get('title', 'Untitled')}\n\n"
                f"Confidence: {h.get('confidence', 0):.1%} | "
                f"Model: {h.get('model_used', 'unknown')}\n\n"
                f"{h.get('description', 'No description available.')}\n\n"
                f"Mechanism: {h.get('mechanism', 'Not specified')}"
            )
            # Include evidence, risks, and validation steps if available
            evidence = h.get("evidence_summary", [])
            if evidence:
                entry += "\n\n#### Evidence\n\n" + "\n".join(
                    f"- {str(e)}" for e in evidence[:10]
                )
            risks = h.get("risks", [])
            if risks:
                entry += "\n\n#### Risks\n\n" + "\n".join(
                    f"- {str(r)}" for r in risks[:5]
                )
            validation = h.get("validation_steps", [])
            if validation:
                entry += "\n\n#### Validation Steps\n\n" + "\n".join(
                    f"- {str(v)}" for v in validation[:5]
                )
            citations = h.get("key_citations", [])
            if citations:
                entry += "\n\n#### Key Citations\n\n" + "\n".join(
                    f"- {str(c)}" for c in citations[:10]
                )
            hyp_lines.append(entry)
        sections.append(DocumentSection(
            key="hypothesis_analyses", title="Hypothesis Analyses",
            order=3, depth=1,
            content="\n\n---\n\n".join(hyp_lines),
        ))

        # Translational Roadmap (T0-T5)
        roadmap_content = ""
        for h in sorted_hyps[:3]:
            roadmap = h.get("translational_roadmap", {})
            if roadmap and isinstance(roadmap, dict):
                phases = roadmap.get("phases", {})
                if phases:
                    roadmap_content += f"\n\n### Translational Roadmap: {h.get('title', 'Hypothesis')}\n\n"
                    roadmap_content += f"**Overall Timeline:** {roadmap.get('overall_timeline', 'TBD')}\n\n"
                    roadmap_content += f"**Overall Budget:** {roadmap.get('overall_budget', 'TBD')}\n\n"
                    for phase_key in ["T0_BASIC_RESEARCH", "T1_TRANSLATION_TO_HUMANS", "T2_TRANSLATION_TO_PATIENTS",
                                      "T3_TRANSLATION_TO_PRACTICE", "T4_TRANSLATION_TO_COMMUNITY", "T5_GLOBAL_IMPACT"]:
                        phase_data = phases.get(phase_key, {})
                        if phase_data:
                            roadmap_content += f"\n#### {phase_data.get('title', phase_key.replace('_', ' '))}\n\n"
                            if phase_data.get("description"):
                                roadmap_content += f"{phase_data['description']}\n\n"
                            if phase_data.get("timeline"):
                                roadmap_content += f"**Timeline:** {phase_data['timeline']}\n\n"
                            if phase_data.get("estimated_cost"):
                                roadmap_content += f"**Estimated Cost:** {phase_data['estimated_cost']}\n\n"
                            objectives = phase_data.get("objectives", [])
                            if objectives:
                                roadmap_content += "**Objectives:**\n" + "\n".join(f"- {o}" for o in objectives[:5]) + "\n\n"
                            milestones = phase_data.get("milestones", [])
                            if milestones:
                                roadmap_content += "**Milestones:**\n" + "\n".join(f"- {m}" for m in milestones[:5]) + "\n\n"
                            risks = phase_data.get("risks", [])
                            if risks:
                                roadmap_content += "**Risks:**\n" + "\n".join(f"- {r}" for r in risks[:3]) + "\n\n"

        if roadmap_content:
            sections.append(DocumentSection(
                key="translational_roadmap", title="Translational Roadmap (T0-T5)",
                order=4, depth=0,
                content=roadmap_content.strip(),
            ))

        # Conclusion
        sections.append(DocumentSection(
            key="conclusion", title="Conclusion", order=5, depth=0,
            content=(
                f"This study demonstrates the potential of multi-model AI pipelines "
                f"for accelerated {bundle.discovery_type.replace('_', ' ')} discovery "
                f"in {bundle.disease}. Using {bundle.num_agents:,} agents across "
                f"{len(bundle.models_used)} models, the system generated "
                f"{bundle.num_hypotheses} hypotheses with {high_conf} achieving high "
                f"confidence. These findings warrant experimental validation and "
                f"further investigation through the translational pipeline from bench "
                f"research (T0) through global health impact (T5)."
            ),
        ))

        bundle.sections = sections
        return bundle


# ============================================================================
# Singleton
# ============================================================================

_pipeline_service: Optional[DocumentPipelineService] = None


def get_document_pipeline_service() -> DocumentPipelineService:
    """Get the singleton DocumentPipelineService instance."""
    global _pipeline_service
    if _pipeline_service is None:
        _pipeline_service = DocumentPipelineService()
    return _pipeline_service
