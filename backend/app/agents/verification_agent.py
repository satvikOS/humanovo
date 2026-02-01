"""
Verification Agent Module

Verifies hypotheses and claims against the knowledge graph,
identifies contradictions, and checks factual accuracy.
"""

from typing import Any
from uuid import UUID

from app.agents.base import (
    AgentContext,
    AgentResult,
    AgentType,
    BaseAgent,
    Tool,
)
from app.core.logging import get_logger

logger = get_logger(__name__)


class VerificationResult:
    """Result of verifying a single claim."""

    def __init__(
        self,
        claim: str,
        verified: bool,
        confidence: float,
        supporting_evidence: list[dict[str, Any]] = None,
        contradicting_evidence: list[dict[str, Any]] = None,
        explanation: str = "",
    ):
        self.claim = claim
        self.verified = verified
        self.confidence = confidence
        self.supporting_evidence = supporting_evidence or []
        self.contradicting_evidence = contradicting_evidence or []
        self.explanation = explanation

    def to_dict(self) -> dict[str, Any]:
        return {
            "claim": self.claim,
            "verified": self.verified,
            "confidence": self.confidence,
            "supporting_evidence": self.supporting_evidence,
            "contradicting_evidence": self.contradicting_evidence,
            "explanation": self.explanation,
        }


class VerificationAgent(BaseAgent):
    """Verification agent that checks claims against knowledge graph.

    Responsibilities:
    - Extract claims from hypotheses
    - Query knowledge graph for supporting/contradicting evidence
    - Identify factual inconsistencies
    - Compute confidence scores
    """

    agent_type = AgentType.VERIFICATION
    description = "Verifies claims against knowledge graph and identifies contradictions"

    def _setup_tools(self) -> None:
        """Set up verification-specific tools."""
        self.register_tool(
            Tool(
                name="extract_claims",
                description="Extract verifiable claims from text",
                handler=self._extract_claims,
            )
        )
        self.register_tool(
            Tool(
                name="query_knowledge_graph",
                description="Query knowledge graph for related facts",
                handler=self._query_knowledge_graph,
            )
        )
        self.register_tool(
            Tool(
                name="check_contradiction",
                description="Check if claim contradicts known facts",
                handler=self._check_contradiction,
            )
        )

    async def execute(
        self,
        context: AgentContext = None,
        **kwargs,
    ) -> AgentResult:
        """Execute verification on hypotheses in context.

        Args:
            context: Shared context containing hypotheses to verify
            **kwargs: Additional parameters

        Returns:
            AgentResult with verification results
        """
        import time

        start_time = time.time()

        if not context:
            return AgentResult(success=False, error="No context provided")

        # Get hypotheses to verify
        hypotheses = kwargs.get("hypotheses", context.hypotheses)
        if not hypotheses:
            return AgentResult(
                success=True,
                data={"message": "No hypotheses to verify"},
            )

        self.logger.info(
            "Verification agent starting",
            hypothesis_count=len(hypotheses),
        )

        verification_results = []

        for hypothesis in hypotheses:
            h_text = hypothesis.get("statement", hypothesis.get("text", ""))
            if not h_text:
                continue

            # Step 1: Extract claims from hypothesis
            claims = await self._extract_claims(h_text)

            # Step 2: Verify each claim
            claim_results = []
            for claim in claims:
                result = await self._verify_claim(claim)
                claim_results.append(result)

            # Step 3: Aggregate results for this hypothesis
            verified_count = sum(1 for r in claim_results if r.verified)
            total_claims = len(claim_results)
            confidence = verified_count / total_claims if total_claims > 0 else 0

            contradictions = []
            for r in claim_results:
                if r.contradicting_evidence:
                    contradictions.extend(r.contradicting_evidence)

            verification_results.append(
                {
                    "hypothesis": h_text,
                    "verified": confidence > 0.5,
                    "confidence": confidence,
                    "claims_verified": verified_count,
                    "total_claims": total_claims,
                    "claim_details": [r.to_dict() for r in claim_results],
                    "contradictions": contradictions,
                }
            )

        duration_ms = int((time.time() - start_time) * 1000)

        self.record_step(
            action="verify_hypotheses",
            input_data={"hypothesis_count": len(hypotheses)},
            output_data={
                "verified_count": sum(1 for v in verification_results if v["verified"]),
                "total_contradictions": sum(len(v["contradictions"]) for v in verification_results),
            },
            duration_ms=duration_ms,
        )

        return AgentResult(
            success=True,
            data={
                "verification_results": verification_results,
                "summary": self._generate_summary(verification_results),
            },
        )

    async def verify(self, hypothesis_id: UUID) -> dict[str, Any]:
        """Verify a specific hypothesis by ID.

        Args:
            hypothesis_id: UUID of hypothesis to verify

        Returns:
            Verification results
        """
        # Import here to avoid circular imports
        from app.api.v1.endpoints.hypotheses import _hypotheses

        if hypothesis_id not in _hypotheses:
            return {"error": "Hypothesis not found"}

        hypothesis = _hypotheses[hypothesis_id]

        context = AgentContext(hypotheses=[{"statement": hypothesis.statement}])

        result = await self.execute(context=context)
        return result.data

    async def _extract_claims(self, text: str) -> list[str]:
        """Extract verifiable claims from text.

        Uses simple heuristics and patterns to identify claims.
        In production, would use NLP or LLM.
        """
        claims = []

        # Split into sentences
        sentences = text.replace(".", ". ").split(". ")

        # Identify sentences that look like claims
        claim_indicators = [
            "causes",
            "leads to",
            "results in",
            "inhibits",
            "activates",
            "regulates",
            "increases",
            "decreases",
            "reduces",
            "associated with",
            "linked to",
            "related to",
            "treats",
            "prevents",
            "cures",
            "is a",
            "are",
            "has",
            "have",
        ]

        for sentence in sentences:
            sentence = sentence.strip()
            if not sentence:
                continue

            # Check if sentence contains claim indicators
            sentence_lower = sentence.lower()
            if any(indicator in sentence_lower for indicator in claim_indicators):
                claims.append(sentence)

        # If no specific claims found, treat whole text as one claim
        if not claims and text.strip():
            claims = [text.strip()]

        self.logger.debug("Claims extracted", count=len(claims))
        return claims

    async def _verify_claim(self, claim: str) -> VerificationResult:
        """Verify a single claim against the knowledge graph."""
        # Query knowledge graph for related facts
        related_facts = await self._query_knowledge_graph(claim)

        # Check for contradictions
        contradictions = await self._check_contradiction(claim, related_facts)

        # Find supporting evidence
        supporting = [
            f for f in related_facts if not any(c["fact_id"] == f.get("id") for c in contradictions)
        ]

        # Compute confidence
        if contradictions:
            confidence = max(0.1, 0.5 - 0.1 * len(contradictions))
            verified = False
        elif supporting:
            confidence = min(0.9, 0.5 + 0.1 * len(supporting))
            verified = True
        else:
            # No evidence either way
            confidence = 0.5
            verified = True  # Assume true if no contradictions

        explanation = self._generate_explanation(claim, supporting, contradictions)

        return VerificationResult(
            claim=claim,
            verified=verified,
            confidence=confidence,
            supporting_evidence=supporting,
            contradicting_evidence=contradictions,
            explanation=explanation,
        )

    async def _query_knowledge_graph(
        self,
        claim: str,
    ) -> list[dict[str, Any]]:
        """Query knowledge graph for facts related to the claim."""
        from app.knowledge.graph_store import get_graph_store

        try:
            store = get_graph_store()
        except RuntimeError:
            # Graph store not initialized
            return []

        # Extract potential entities from claim
        entities = self._extract_entities(claim)

        related_facts = []

        for entity in entities:
            # Search for entity in graph
            results = await store.search_entities(entity, limit=5)

            for result in results:
                # Get neighborhood
                neighborhood = await store.get_neighborhood(result.id, depth=1, limit=10)
                if neighborhood:
                    for relation in neighborhood.relations:
                        related_facts.append(
                            {
                                "id": relation.id,
                                "source": relation.source_name,
                                "relation": relation.relation_type,
                                "target": relation.target_name,
                                "confidence": relation.confidence,
                            }
                        )

        return related_facts

    def _extract_entities(self, text: str) -> list[str]:
        """Extract potential entity names from text.

        Simple extraction using capitalized words and known patterns.
        """
        import re

        entities = []

        # Find capitalized words/phrases
        capitalized = re.findall(r"\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b", text)
        entities.extend(capitalized)

        # Find gene-like patterns (uppercase with numbers)
        gene_patterns = re.findall(r"\b[A-Z]+\d*\b", text)
        entities.extend([g for g in gene_patterns if len(g) >= 2])

        # Find drug-like patterns (lowercase ending in -ib, -ab, -mab)
        drug_patterns = re.findall(r"\b\w+(?:mab|nib|lib|zumab|ximab)\b", text, re.IGNORECASE)
        entities.extend(drug_patterns)

        # Deduplicate
        entities = list(set(entities))

        return entities[:10]  # Limit to avoid too many queries

    async def _check_contradiction(
        self,
        claim: str,
        related_facts: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """Check if claim contradicts known facts."""
        contradictions = []

        claim_lower = claim.lower()

        # Simple contradiction detection based on opposing relations
        opposing_pairs = [
            ("activates", "inhibits"),
            ("increases", "decreases"),
            ("causes", "prevents"),
            ("promotes", "suppresses"),
        ]

        for fact in related_facts:
            relation = fact.get("relation", "").lower()

            for pos, neg in opposing_pairs:
                # If claim says X activates Y but fact says X inhibits Y
                if pos in claim_lower and relation == neg:
                    contradictions.append(
                        {
                            "fact_id": fact.get("id"),
                            "fact": f"{fact['source']} {fact['relation']} {fact['target']}",
                            "reason": f"Claim suggests '{pos}' but evidence shows '{neg}'",
                        }
                    )
                elif neg in claim_lower and relation == pos:
                    contradictions.append(
                        {
                            "fact_id": fact.get("id"),
                            "fact": f"{fact['source']} {fact['relation']} {fact['target']}",
                            "reason": f"Claim suggests '{neg}' but evidence shows '{pos}'",
                        }
                    )

        return contradictions

    def _generate_explanation(
        self,
        claim: str,
        supporting: list[dict[str, Any]],
        contradictions: list[dict[str, Any]],
    ) -> str:
        """Generate human-readable explanation of verification."""
        parts = []

        if supporting:
            parts.append(f"Found {len(supporting)} supporting facts in knowledge graph.")

        if contradictions:
            parts.append(
                f"Found {len(contradictions)} contradicting facts: "
                + "; ".join(c["reason"] for c in contradictions[:3])
            )

        if not supporting and not contradictions:
            parts.append("No direct evidence found in knowledge graph.")

        return " ".join(parts)

    def _generate_summary(
        self,
        verification_results: list[dict[str, Any]],
    ) -> str:
        """Generate summary of all verification results."""
        total = len(verification_results)
        verified = sum(1 for v in verification_results if v["verified"])
        contradictions = sum(len(v["contradictions"]) for v in verification_results)

        return (
            f"Verified {verified}/{total} hypotheses. Found {contradictions} total contradictions."
        )
