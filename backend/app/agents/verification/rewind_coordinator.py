"""
Rewind Coordinator — Pipeline Rollback on Citation/Claim Failure

When the citation verifier returns a FABRICATED / MISATTRIBUTED / IRRELEVANT
verdict, the orchestrator must:

  1. Identify the stage that emitted the bad citation.
  2. Walk backward through `StageCheckpoint` history to the most recent
     successful cached stage.
  3. Mark the claim that cited the bad reference as invalidated.
  4. Walk forward through claims that were downstream-dependent on the
     invalidated claim; mark those as `related_invalidated`.
  5. Re-queue the rewind stage for re-execution with:
       - the full accumulated_context from the cached checkpoint,
       - the bad citation's DOI/PMID + title in a blacklist,
       - the invalidated claim text as an explicit exclusion instruction.

The cost saving comes from reusing every stage that executed BEFORE the
problem; we don't re-run the whole pipeline. For the 9-stage discovery
pipeline, a single-citation failure at stage 7 costs ~2 stages of re-work,
not 7.

The coordinator is in-memory per-run; it uses the existing
`learning_memory_service` to persist rewind events for later analysis.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from app.agents.verification.citation_verifier import (
    VerificationFailure,
    VerifiedCitation,
)

logger = logging.getLogger(__name__)


@dataclass
class StageCheckpoint:
    """Snapshot of pipeline state at the end of a successful stage."""
    stage_number: int
    stage_name: str
    model_used: str
    accumulated_context: dict[str, Any]
    emitted_claims: list[str] = field(default_factory=list)
    emitted_citations: list[dict[str, Any]] = field(default_factory=list)
    taken_at: datetime = field(default_factory=datetime.utcnow)


@dataclass
class RewindEvent:
    """A rewind that occurred; logged for learning / cost analysis."""
    hypothesis_id: str
    triggered_at_stage: int
    rewound_to_stage: int
    failure: VerificationFailure
    stages_discarded: list[str] = field(default_factory=list)
    blacklisted_dois: list[str] = field(default_factory=list)
    blacklisted_pmids: list[str] = field(default_factory=list)
    invalidated_claim: str = ""
    related_invalidated_claims: list[str] = field(default_factory=list)


class RewindCoordinator:
    """Tracks checkpoints and orchestrates rewinds on citation failure.

    Usage:
        coord = RewindCoordinator(hypothesis_id=hid)
        coord.checkpoint(StageCheckpoint(...))
        verdict = await verify(citation)
        if verdict.requires_rewind:
            rewind = coord.plan_rewind(stage_that_emitted=7, failure=...)
            # orchestrator re-runs from rewind.target_stage with
            # rewind.blacklist applied to the stage prompt
    """

    def __init__(self, hypothesis_id: str, max_rewinds: int = 3):
        self.hypothesis_id = hypothesis_id
        self._checkpoints: list[StageCheckpoint] = []
        self._max_rewinds = max_rewinds
        self._rewind_count = 0
        self._global_blacklist_dois: set[str] = set()
        self._global_blacklist_pmids: set[str] = set()
        self._global_blacklist_titles: set[str] = set()
        self.history: list[RewindEvent] = []

    # ------------------------------------------------------------------
    # Checkpointing
    # ------------------------------------------------------------------

    def checkpoint(self, ckpt: StageCheckpoint) -> None:
        """Record a successful stage completion."""
        # Keep only the latest checkpoint per stage_number
        self._checkpoints = [c for c in self._checkpoints if c.stage_number != ckpt.stage_number]
        self._checkpoints.append(ckpt)
        self._checkpoints.sort(key=lambda c: c.stage_number)

    def latest_checkpoint_before(self, stage_number: int) -> StageCheckpoint | None:
        """Return the most recent checkpoint strictly before `stage_number`."""
        for c in reversed(self._checkpoints):
            if c.stage_number < stage_number:
                return c
        return None

    # ------------------------------------------------------------------
    # Rewind planning
    # ------------------------------------------------------------------

    @property
    def rewinds_exhausted(self) -> bool:
        return self._rewind_count >= self._max_rewinds

    def plan_rewind(
        self,
        *,
        stage_that_emitted: int,
        stage_name: str,
        failed_citation: VerifiedCitation,
        invalidated_claim: str,
        all_claims_in_stage: list[str] | None = None,
    ) -> RewindEvent | None:
        """Compute the rewind plan. Returns None if no more rewinds permitted."""
        if self.rewinds_exhausted:
            logger.warning(
                f"[rewind] max_rewinds={self._max_rewinds} exhausted for "
                f"hypothesis {self.hypothesis_id}; accepting degraded result"
            )
            return None

        target = self.latest_checkpoint_before(stage_that_emitted)
        if target is None:
            logger.warning(
                f"[rewind] No checkpoint before stage {stage_that_emitted}; "
                "cannot rewind further. Accepting degraded result."
            )
            return None

        # Blacklist the offending identifiers globally for this hypothesis
        if failed_citation.raw_doi:
            self._global_blacklist_dois.add(failed_citation.raw_doi.lower())
        if failed_citation.raw_pmid:
            self._global_blacklist_pmids.add(str(failed_citation.raw_pmid))
        if failed_citation.raw_title:
            self._global_blacklist_titles.add(failed_citation.raw_title.lower()[:160])

        # Downstream-dependent claim identification:
        # any claim mentioning the invalidated claim's key nouns gets flagged too.
        related = self._find_related_claims(invalidated_claim, all_claims_in_stage or [])

        stages_discarded = [
            f"stage_{c.stage_number}_{c.stage_name}"
            for c in self._checkpoints
            if c.stage_number >= target.stage_number
        ]

        failure = VerificationFailure(
            stage_that_emitted=stage_name,
            citation=failed_citation,
            claim_invalidated=invalidated_claim,
            related_claims_to_strip=related,
        )

        event = RewindEvent(
            hypothesis_id=self.hypothesis_id,
            triggered_at_stage=stage_that_emitted,
            rewound_to_stage=target.stage_number,
            failure=failure,
            stages_discarded=stages_discarded,
            blacklisted_dois=list(self._global_blacklist_dois),
            blacklisted_pmids=list(self._global_blacklist_pmids),
            invalidated_claim=invalidated_claim,
            related_invalidated_claims=related,
        )

        # Trim checkpoints; the orchestrator will replay from target+1 onward
        self._checkpoints = [c for c in self._checkpoints if c.stage_number <= target.stage_number]
        self._rewind_count += 1
        self.history.append(event)

        logger.info(
            f"[rewind] hypothesis={self.hypothesis_id} "
            f"stage_{stage_that_emitted} → stage_{target.stage_number+1} "
            f"(discarded: {stages_discarded}, "
            f"verdict={failed_citation.verdict.value}, "
            f"reason={failed_citation.failure_reason})"
        )
        return event

    # ------------------------------------------------------------------
    # Prompt augmentation
    # ------------------------------------------------------------------

    def blacklist_clause(self) -> str:
        """Text to prepend to the next stage's prompt so the model avoids
        re-citing the bad references."""
        if not (self._global_blacklist_dois
                or self._global_blacklist_pmids
                or self._global_blacklist_titles):
            return ""
        parts = [
            "## BLACKLISTED REFERENCES — DO NOT CITE",
            "A prior round of this pipeline emitted citations that failed "
            "multi-round verification. The following identifiers/titles "
            "MUST NOT appear in your output:",
        ]
        if self._global_blacklist_dois:
            parts.append("  Forbidden DOIs: " + ", ".join(sorted(self._global_blacklist_dois)))
        if self._global_blacklist_pmids:
            parts.append("  Forbidden PMIDs: " + ", ".join(sorted(self._global_blacklist_pmids)))
        if self._global_blacklist_titles:
            sample = sorted(list(self._global_blacklist_titles))[:6]
            parts.append("  Forbidden titles (partial): " + " | ".join(t[:80] for t in sample))
        parts.append(
            "If your reasoning concludes these references are the only support "
            "for a claim, DROP the claim and any claims derived from it rather "
            "than fabricate alternatives. Users require 100% accurate citations."
        )
        return "\n".join(parts)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _find_related_claims(invalidated: str, universe: list[str]) -> list[str]:
        """Heuristic: claims that share >= 4 key nouns with the invalidated
        claim are likely derived from it and should also be stripped."""
        import re
        stop = set([
            "the", "a", "an", "is", "are", "was", "were", "be", "been", "by",
            "in", "on", "at", "for", "of", "with", "to", "and", "or", "that",
            "this", "these", "those", "it", "its", "as", "from",
        ])
        def key_nouns(s: str) -> set[str]:
            return {w for w in re.findall(r"[A-Za-z][A-Za-z0-9\-]+", s.lower())
                    if w not in stop and len(w) > 3}
        inv_nouns = key_nouns(invalidated)
        related = []
        for c in universe:
            if c == invalidated:
                continue
            if len(inv_nouns & key_nouns(c)) >= 4:
                related.append(c)
        return related
