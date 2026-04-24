"""
Multi-round Section Critic — Goodman-style self-critique for each
paper section.

After the paper generator drafts a section, this agent reads it with
a rubric ('clarity', 'precision', 'journal-voice', 'citation-density',
'novelty-signal'), scores each dimension, and returns both:
  * The revised prose (if any rubric item scores < 0.7)
  * A diff-ready rationale entry per dimension

Uses a different model for critique than was used for generation — this
is the classic technique from the Goodman et al. self-critique work:
the critic must not have write access to the output it's reviewing.

Budget note: at Haiku prices, critiquing a 900-word section costs
~$0.005. A full paper (12 sections × 1 round) = ~$0.06. Use aggressively.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)


CRITIC_SYSTEM = """You are a senior peer-reviewer at Nature Medicine. You
review a single paper section against a 5-axis rubric. You score every
axis 0-1, identify concrete issues, and rewrite ONLY the passages that
need fixing. You do NOT add new claims, new citations, or new numbers.

Rubric:
  1. clarity           — Unambiguous, well-structured prose.
  2. precision         — Every quantitative claim is exact + sourced.
  3. journal_voice     — Matches the target journal's register.
  4. citation_density  — Every non-trivial claim is supported.
  5. novelty_signal    — The section's contribution is clearly stated.

Output STRICT JSON:
  {
    "scores": {"clarity":0.85, "precision":0.7, ...},
    "issues": [{"axis":"precision","excerpt":"...","fix":"..."}],
    "revised_text": "<full revised section text, OR null if no revision needed>"
  }
"""


@dataclass
class CritiqueResult:
    section_key: str
    scores: dict[str, float] = field(default_factory=dict)
    issues: list[dict[str, Any]] = field(default_factory=list)
    revised_text: str | None = None
    original_text: str = ""
    mean_score: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "section_key": self.section_key,
            "scores": self.scores,
            "issues": self.issues,
            "revised_text": self.revised_text,
            "mean_score": round(self.mean_score, 4),
            "changed": bool(self.revised_text and self.revised_text != self.original_text),
        }


async def critique_section(
    section_key: str,
    section_text: str,
    llm: Any,
    *,
    journal_style: str = "humanovo",
    min_acceptable: float = 0.75,
) -> CritiqueResult:
    """Run one round of critique on a section. Returns the verdict and
    revised text (when any axis < 0.75)."""
    if not section_text or not llm:
        return CritiqueResult(section_key=section_key,
                              original_text=section_text or "")

    prompt = (
        f"Journal: {journal_style}\n"
        f"Section key: {section_key}\n\n"
        "--- BEGIN SECTION ---\n"
        f"{section_text[:6000]}\n"
        "--- END SECTION ---"
    )
    try:
        from app.agents.discovery_orchestrator import ModelType
        raw = await llm.generate(
            model_type=ModelType.CLAUDE_SONNET,   # critic uses a different
                                                   # family than the drafter
                                                   # (which is often Haiku)
            prompt=prompt,
            system_prompt=CRITIC_SYSTEM,
            max_tokens=3000,
            temperature=0.15,
        )
    except Exception as e:
        logger.debug(f"[critic] LLM call failed: {e}")
        return CritiqueResult(section_key=section_key,
                              original_text=section_text)

    parsed: dict[str, Any] = {}
    try:
        text = raw.strip()
        if "```" in text:
            text = text.split("```", 2)[1]
            if text.lower().startswith("json"):
                text = text[4:].lstrip("\n")
            text = text.split("```", 1)[0]
        parsed = json.loads(text)
    except Exception as e:
        logger.debug(f"[critic] JSON parse failed: {e}")
        return CritiqueResult(section_key=section_key,
                              original_text=section_text)

    scores = parsed.get("scores") or {}
    scores = {k: float(v) for k, v in scores.items() if isinstance(v, (int, float))}
    mean = sum(scores.values()) / max(1, len(scores))
    issues = parsed.get("issues") or []
    revised = parsed.get("revised_text")
    if revised in ("", "null", None):
        revised = None

    # If any axis is below the floor AND the critic produced revised
    # text, use the revised version. Otherwise keep original.
    use_revised = mean < min_acceptable or any(
        v < min_acceptable for v in scores.values()
    )
    if not use_revised:
        revised = None

    return CritiqueResult(
        section_key=section_key,
        scores=scores,
        issues=issues if isinstance(issues, list) else [],
        revised_text=revised if isinstance(revised, str) else None,
        original_text=section_text,
        mean_score=mean,
    )


async def critique_paper(
    paper: Any,
    llm: Any,
    *,
    max_sections: int = 16,
    journal_style: str = "humanovo",
) -> dict[str, CritiqueResult]:
    """Run critique on every major section of a paper. Returns a dict
    keyed by section. The caller decides whether to apply revised_text
    back into the paper or merely surface the issues to the reader."""
    import asyncio
    sections = list((paper.sections or {}).items())[:max_sections]
    tasks = [critique_section(k, v, llm, journal_style=journal_style)
             for k, v in sections]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    out: dict[str, CritiqueResult] = {}
    for (k, _), r in zip(sections, results):
        if isinstance(r, Exception):
            logger.debug(f"[critic] section {k} failed: {r}")
            continue
        out[k] = r
    return out
