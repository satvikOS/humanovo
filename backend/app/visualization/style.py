"""
Humanovo Matplotlib / Seaborn House Style

All scientific figures use this style for publication-quality output:
  - CMYK-safe qualitative palette (prints well on paper)
  - Serif title/axes + sans-serif tick labels (journal convention)
  - 300 DPI for PDF embedding
  - Math rendered via mathtext (no LaTeX binary dependency)
  - Tight layout + explicit spine pruning
  - Colorblind-accessible (Okabe-Ito + Humanovo brand accents)

Usage:
    from app.visualization.style import apply_humanovo_style
    apply_humanovo_style()   # idempotent
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

# Okabe-Ito 8-color palette, colorblind-safe and CMYK-printable, with
# Humanovo deep-teal as the primary accent.
HUMANOVO_PALETTE: tuple[str, ...] = (
    "#006C75",  # Humanovo teal primary
    "#E69F00",  # orange
    "#56B4E9",  # sky blue
    "#009E73",  # bluish green
    "#F0E442",  # yellow
    "#0072B2",  # blue
    "#D55E00",  # vermillion
    "#CC79A7",  # reddish purple
)

HUMANOVO_GRADIENT: tuple[str, ...] = (
    "#003540", "#00525E", "#006C75", "#008894", "#00A6B5", "#2EC3D1", "#70DBE5", "#B4EDF2",
)


def apply_humanovo_style() -> None:
    """Apply the Humanovo figure style to matplotlib globally. Safe to call many times."""
    try:
        import matplotlib
        import matplotlib.pyplot as plt
    except ImportError:
        logger.warning(
            "matplotlib not installed; figures will not render. "
            "Install with: pip install matplotlib seaborn"
        )
        return

    # Use a non-interactive backend so rendering works headless (e.g. in tests).
    matplotlib.use("Agg", force=True)

    plt.rcParams.update({
        # Fonts (mathtext = no LaTeX binary required)
        "font.family": "DejaVu Sans",
        "font.size": 10,
        "axes.titlesize": 12,
        "axes.labelsize": 10,
        "xtick.labelsize": 9,
        "ytick.labelsize": 9,
        "legend.fontsize": 9,
        "figure.titlesize": 13,
        "mathtext.default": "regular",

        # Layout
        "figure.figsize": (6.4, 4.4),
        "figure.dpi": 120,
        "savefig.dpi": 300,
        "savefig.bbox": "tight",
        "savefig.pad_inches": 0.12,
        "figure.constrained_layout.use": True,

        # Spines
        "axes.spines.top": False,
        "axes.spines.right": False,
        "axes.linewidth": 1.0,
        "axes.edgecolor": "#2c3e50",

        # Grid
        "axes.grid": True,
        "grid.linestyle": ":",
        "grid.linewidth": 0.5,
        "grid.color": "#b5c0c9",

        # Colors
        "axes.prop_cycle": matplotlib.cycler(color=list(HUMANOVO_PALETTE)),

        # Error bars
        "errorbar.capsize": 3,

        # PDF-friendly
        "pdf.fonttype": 42,  # TrueType (embedded, editable)
        "ps.fonttype": 42,
    })

    # Seaborn context + style if available
    try:
        import seaborn as sns
        sns.set_context("paper", font_scale=1.0)
        sns.set_style(
            "whitegrid",
            rc={
                "axes.edgecolor": "#2c3e50",
                "axes.linewidth": 1.0,
                "grid.color": "#b5c0c9",
                "grid.linestyle": ":",
            },
        )
    except ImportError:
        pass


def humanovo_colors(n: int = 8) -> list[str]:
    """Return the first n colors from the Humanovo palette (cycling if n > 8)."""
    return [HUMANOVO_PALETTE[i % len(HUMANOVO_PALETTE)] for i in range(n)]


def humanovo_gradient(n: int = 8) -> list[str]:
    """Return n colors sampled from the Humanovo teal gradient."""
    if n <= 1:
        return [HUMANOVO_GRADIENT[len(HUMANOVO_GRADIENT) // 2]]
    step = (len(HUMANOVO_GRADIENT) - 1) / (n - 1)
    return [HUMANOVO_GRADIENT[round(i * step)] for i in range(n)]
