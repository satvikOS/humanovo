"""
Humanovo Scientific Visualization Pipeline

Per product directive: "each hypothesis and research paper should be full
of visualizations ... scientific figures, diagrams, matplotlib/seaborn
visualizations instead of dynamic plotly, mermaid diagrams and flowcharts."

This module generates:
  1. Matplotlib / Seaborn scientific figures (bar, scatter, violin, heatmap,
     forest plot, survival curve, box+strip, radar, lollipop, volcano, ROC,
     pathway bar, confidence interval plot).
  2. Mermaid diagrams (flowchart, sequence, class, state, journey, gantt).
  3. Mechanism flowcharts rendered from structured causal chains.
  4. Tables (already supported in paper gen; we integrate the formatting).

All figures are rendered to PNG (for PDF embedding) AND SVG (for web doc
viewer). Mermaid diagrams are emitted as `.mmd` source + pre-rendered PNG
via `mermaid-cli` when available, with graceful fallback to the mermaid
source embedded in a markdown code block.

Matplotlib is used with a Humanovo house style: CMYK-safe palette (paper
printability), LaTeX-like math via mathtext (no LaTeX dep), tight layout,
and consistent font sizing.
"""

from app.visualization.figures import (
    FigureSpec,
    FigureType,
    RenderedFigure,
    generate_figure,
)
from app.visualization.mermaid import (
    MermaidDiagram,
    MermaidKind,
    render_mermaid,
)
from app.visualization.flowchart import (
    CausalFlowchart,
    render_causal_flowchart,
)

__all__ = [
    "FigureSpec",
    "FigureType",
    "RenderedFigure",
    "generate_figure",
    "MermaidDiagram",
    "MermaidKind",
    "render_mermaid",
    "CausalFlowchart",
    "render_causal_flowchart",
]
