"""
Figure-Designer Agent — "what figure serves this section?"

Current paper generation builds a fixed menu of figures (confidence
meter, evidence landscape, radar, cost breakdown, translational
timeline) regardless of whether they suit the content. This agent
reads the draft of each paper section and decides whether any of our
21 figure types would strengthen it — and if so, produces the concrete
FigureSpec that the renderer then converts to PNG + SVG.

Design constraints:
  * The LLM never invents data. It picks a figure_type and describes
    what data it needs; the concrete data MUST come from:
      - hypothesis fields (dimension_scores, evidence_summary, ...)
      - the compute_figure_bridge (power, PK, survival, dose-response)
      - the existing visualization_service's programmatic table/chart
        builders
  * A section can receive 0, 1, or multiple figures depending on
    content density. A "Conclusion" section rarely needs a figure; a
    "Per-Hypothesis Deep Analysis" often needs 2-3.

Usage:
    from app.agents.figure_designer import design_figures_for_paper

    figures = await design_figures_for_paper(paper, llm=llm_client)
    # Each figure is a FigureSpec-shaped dict with a 'section' tag

The agent makes ONE LLM call per paper (not per section) via a compact
JSON-only prompt — ~500 input tokens, ~400 output tokens. On a Haiku
budget that's ~$0.002 / paper.

When no LLM is available (e.g. cold local dev), the agent falls back
to the fixed-menu behaviour so the paper generator still produces
figures.
"""

from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger(__name__)


FIGURE_DESIGNER_PROMPT = """You are a scientific figure designer for a biomedical
research paper. Given the paper outline (sections with first 300 words of
prose) and the available concrete data sources, return a JSON list of
figures to include. Each figure entry is one object with:

  {
    "figure_type": "<one of: bar, grouped_bar, stacked_bar, scatter, "
                   "bubble, line, multi_line, violin, box_strip, heatmap, "
                   "forest_plot, survival, volcano, roc, radar, lollipop, "
                   "confidence_meter, dimension_breakdown, cost_breakdown, "
                   "evidence_landscape, translational_timeline>",
    "title": "<human-readable title>",
    "caption": "<one-sentence caption explaining what the figure shows>",
    "section": "<section_key>",                 # from available_sections
    "data_source": "<one of: compute_engine, hypothesis_fields, evidence, "
                   "translational_roadmap>",
    "required_hypothesis_field": "<optional: name of field to pull>"
  }

Rules:
  - Never invent numeric values. `data_source` tells the render pipeline
    where to pull them from at build time.
  - Only pick figure types that match the section's narrative purpose.
    Don't add a figure just to add one.
  - Maximum 6 figures across the whole paper.
  - 'Introduction' and 'Conclusion' sections typically get 0 figures.
  - 'Results' / 'Per-Hypothesis Deep Analysis' sections warrant 2-3.

Return ONLY the JSON array, no commentary. If no figures are warranted
anywhere, return [].
"""


# ---------------------------------------------------------------------------
# Public entrypoint
# ---------------------------------------------------------------------------


async def design_figures_for_paper(
    paper: Any,
    llm: Any = None,
    *,
    max_figures: int = 6,
) -> list[dict[str, Any]]:
    """Return a list of FigureSpec-shaped dicts, each tagged with `section`.

    Always returns a non-empty list when the paper has content (falls back
    to the fixed menu), but when an LLM is available the list is tuned to
    what the prose actually needs.
    """
    default_menu = _fixed_fallback_menu(paper)
    if llm is None:
        return default_menu[:max_figures]

    # Build compact prompt
    section_excerpts: list[dict[str, Any]] = []
    for key, content in (paper.sections or {}).items():
        if key in ("toc", "citations", "references"):
            continue
        if not content:
            continue
        section_excerpts.append({
            "section_key": key,
            "first_300_words": " ".join(str(content).split()[:300]),
        })

    if not section_excerpts:
        return default_menu[:max_figures]

    # Build the payload the LLM sees
    n_hyp = len(paper.hypotheses or [])
    has_power = any(
        isinstance((h.get("pipeline_trace") or {}).get("protocol"), dict)
        for h in (paper.hypotheses or [])[:3]
    )
    has_pharmacokinetics = any(
        "pharmacokinetics" in str(h.get("required_methods") or "").lower()
        or "PK" in str(h.get("title") or "")
        for h in (paper.hypotheses or [])[:3]
    )
    user_payload = {
        "available_sections": [s["section_key"] for s in section_excerpts],
        "section_excerpts": section_excerpts,
        "available_data_sources": {
            "hypothesis_fields": [
                "dimension_scores", "confidence", "evidence_summary",
                "translational_roadmap", "novelty_score", "feasibility_score",
                "causal_chain", "counter_arguments",
            ],
            "compute_engine": [
                "power_curve" if has_power else None,
                "dose_response",
                "pk_curve" if has_pharmacokinetics else None,
                "survival_curve" if has_power else None,
            ],
        },
        "n_hypotheses_in_paper": n_hyp,
        "max_figures": max_figures,
    }

    prompt = (
        FIGURE_DESIGNER_PROMPT
        + "\n\nPaper context (JSON):\n"
        + json.dumps(user_payload, default=str, indent=2)[:6000]
    )

    try:
        from app.agents.discovery_orchestrator import ModelType
        raw = await llm.generate(
            model_type=ModelType.CLAUDE_SONNET,
            prompt=prompt,
            system_prompt="You are a precise scientific figure-designer.",
            max_tokens=1500,
            temperature=0.25,
        )
    except Exception as e:
        logger.debug(f"[figure_designer] LLM call failed, falling back: {e}")
        return default_menu[:max_figures]

    try:
        # Extract the JSON array; tolerate markdown fencing
        text = raw.strip()
        if "```" in text:
            text = text.split("```", 2)[1]
            if text.lower().startswith("json"):
                text = text[4:].lstrip("\n")
            text = text.split("```", 1)[0]
        specs = json.loads(text)
        if not isinstance(specs, list):
            raise ValueError("not a JSON array")
    except Exception as e:
        logger.debug(f"[figure_designer] JSON parse failed: {e}")
        return default_menu[:max_figures]

    # Hydrate each spec with real data based on data_source
    hydrated: list[dict[str, Any]] = []
    for spec in specs[:max_figures]:
        if not isinstance(spec, dict):
            continue
        ds = spec.get("data_source") or "hypothesis_fields"
        fig = await _hydrate(spec, ds, paper)
        if fig:
            hydrated.append(fig)

    if not hydrated:
        return default_menu[:max_figures]
    return hydrated


# ---------------------------------------------------------------------------
# Hydration helpers
# ---------------------------------------------------------------------------


async def _hydrate(
    spec: dict[str, Any],
    data_source: str,
    paper: Any,
) -> dict[str, Any] | None:
    """Fill in `data` on a spec based on the declared data_source."""
    fig_type = spec.get("figure_type")
    title = spec.get("title", "")
    caption = spec.get("caption", "")
    section = spec.get("section", "results_overview")

    if data_source == "compute_engine":
        try:
            from app.services.compute_figure_bridge import build_compute_figures
        except Exception:
            return None
        # Ask each hypothesis for what the compute engine can produce
        for h in (paper.hypotheses or [])[:3]:
            compute_figs = await build_compute_figures(h)
            for cf in compute_figs:
                if cf.get("figure_type") == fig_type:
                    return {
                        "figure_type": fig_type,
                        "title": title or cf.get("title"),
                        "caption": caption or cf.get("caption"),
                        "x_label": cf.get("x_label", ""),
                        "y_label": cf.get("y_label", ""),
                        "data": cf.get("data", {}),
                        "section": section,
                        "source": "compute_engine",
                    }
        return None

    if data_source == "hypothesis_fields":
        field = spec.get("required_hypothesis_field")
        if field == "dimension_scores":
            top = (paper.hypotheses or [{}])[0]
            ds = top.get("dimension_scores") or {}
            if not ds:
                return None
            values = [(k, (v.get("score") if isinstance(v, dict) else float(v)))
                      for k, v in ds.items()]
            if fig_type == "radar":
                return {
                    "figure_type": "radar",
                    "title": title, "caption": caption,
                    "data": {
                        "axes": [k for k, _ in values],
                        "series": {"Score": [v for _, v in values]},
                    },
                    "section": section,
                }
            if fig_type == "bar":
                return {
                    "figure_type": "bar",
                    "title": title, "caption": caption,
                    "x_label": "Dimension",
                    "y_label": "Score",
                    "data": {
                        "categories": [k for k, _ in values],
                        "values": [v for _, v in values],
                    },
                    "section": section,
                }
        if field == "confidence" or fig_type == "confidence_meter":
            dims = {
                (h.get("title") or f"H{i+1}")[:40]:
                    float(h.get("confidence") or 0.5)
                for i, h in enumerate((paper.hypotheses or [])[:9])
            }
            if not dims:
                return None
            return {
                "figure_type": "confidence_meter",
                "title": title or "Hypothesis confidence",
                "caption": caption or "Weighted confidence per hypothesis.",
                "data": {"dimensions": dims},
                "section": section,
            }
        return None

    if data_source == "evidence":
        # Evidence landscape from references
        years, rel, pmids = [], [], []
        for r in (paper.references or [])[:120]:
            y = r.get("year") or ""
            try:
                years.append(int(str(y)[:4]))
            except Exception:
                continue
            rel.append(float(r.get("relevance_score") or 0.6))
            pmids.append(r.get("pmid") or "")
        if not years:
            return None
        return {
            "figure_type": "evidence_landscape",
            "title": title or "Evidence landscape",
            "caption": caption,
            "x_label": "Publication year",
            "y_label": "Relevance",
            "data": {"year": years, "relevance": rel, "pmid": pmids},
            "section": section,
        }

    if data_source == "translational_roadmap":
        top = (paper.hypotheses or [{}])[0]
        roadmap = top.get("translational_roadmap") or {}
        phases = []
        for i, (name, info) in enumerate(roadmap.items()):
            if isinstance(info, dict):
                phases.append({
                    "name": name.upper(),
                    "start": i * 12,
                    "end": (i + 1) * 12,
                    "status": info.get("status", "planned"),
                })
        if not phases:
            return None
        return {
            "figure_type": "translational_timeline",
            "title": title or "Translational roadmap (T0-T5)",
            "caption": caption,
            "data": {"phases": phases},
            "section": section,
        }

    return None


# ---------------------------------------------------------------------------
# Fixed-menu fallback (for when no LLM / parse failure)
# ---------------------------------------------------------------------------


def _fixed_fallback_menu(paper: Any) -> list[dict[str, Any]]:
    """The previous fixed figure menu. Used when the LLM is unavailable."""
    menu: list[dict[str, Any]] = []
    if paper.hypotheses:
        dims = {
            (h.get("title") or f"H{i+1}")[:40]:
                float(h.get("confidence") or 0.5)
            for i, h in enumerate(paper.hypotheses[:9])
        }
        menu.append({
            "figure_type": "confidence_meter",
            "title": "Hypothesis confidence across discovery round",
            "caption": "Weighted confidence per hypothesis from the pipeline.",
            "data": {"dimensions": dims},
            "section": "results_overview",
        })
    if paper.references:
        years, rel, pmids = [], [], []
        for r in paper.references[:120]:
            try:
                years.append(int(str(r.get("year") or "")[:4]))
                rel.append(float(r.get("relevance_score") or 0.6))
                pmids.append(r.get("pmid") or "")
            except Exception:
                continue
        if years:
            menu.append({
                "figure_type": "evidence_landscape",
                "title": "Evidence landscape",
                "caption": "Relevance vs publication year for the reference set.",
                "x_label": "Publication year",
                "y_label": "Relevance",
                "data": {"year": years, "relevance": rel, "pmid": pmids},
                "section": "evidence_landscape",
            })
    return menu
