"""
Backward/Synthesis Pipeline — 5-stage evidence synthesis per Project Jamison v2 Spec Section 3.

Stages:
  1. DECOMPOSE (Claude Opus) — Break hypothesis into component claims
  2. RETRIEVE  (Cohere Command A) — Search literature for each claim
  3. SYNTHESIZE (Claude Opus) — Synthesize findings into coherent narrative
  4. GAP_ANALYZE (GPT-4.1) — Identify knowledge gaps
  5. FORMAT (Claude Sonnet) — Format output per requested format/verbosity

Grant-aware formatting: nih_r01, nih_r21, nsf, dod, private_foundation
"""

import asyncio
import json
import time
from datetime import datetime
from typing import Any, Callable, Optional
from uuid import uuid4

import httpx
from pydantic import BaseModel

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


# ============== Data Types ==============


class CitedFinding(BaseModel):
    claim: str
    source_pmid: str | None = None
    source_doi: str | None = None
    source_title: str = ""
    confidence: float = 0.0


class GapItem(BaseModel):
    description: str
    severity: str = "moderate"  # critical, moderate, minor
    suggested_experiments: list[str] = []


class SynthesisResult(BaseModel):
    run_id: str
    project_id: str
    hypothesis: str
    findings: list[CitedFinding] = []
    gaps: list[GapItem] = []
    narrative: str = ""
    formatted_output: str = ""
    output_format: str = "narrative"
    verbosity: str = "standard"
    grant_type: str | None = None
    visualization_data: dict = {}
    total_cost_cents: int = 0
    duration_seconds: float = 0.0
    status: str = "completed"


# ============== Stage Prompts ==============

DECOMPOSE_PROMPT = """You are a scientific claim decomposition specialist.

Break the following hypothesis into its individual component claims. Each claim should be:
1. A single, verifiable scientific assertion
2. Specific enough to search for evidence
3. Clear about what entities/mechanisms/pathways are involved

Hypothesis:
{hypothesis}

{field_scope_text}

Return as JSON:
```json
{{
    "claims": [
        {{"claim": "Individual scientific claim", "search_terms": ["term1", "term2"], "claim_type": "mechanism|evidence|prediction"}}
    ],
    "total_claims": N,
    "hypothesis_domain": "e.g. oncology, neuroscience, immunology"
}}
```"""

SYNTHESIZE_PROMPT = """You are a scientific evidence synthesizer.

Given the following claims and their supporting evidence from the literature, synthesize them into a coherent {output_format} with {verbosity} verbosity ({word_limit} words).

CLAIMS AND EVIDENCE:
{claims_evidence}

HYPOTHESIS:
{hypothesis}

{grant_sections}

Requirements:
1. Cite every finding with [N] references
2. Distinguish between established facts, preliminary findings, and speculation
3. Note conflicting evidence when it exists
4. {verbosity_instruction}

Return as JSON:
```json
{{
    "narrative": "The synthesized text with [N] citations...",
    "key_findings": [{{"finding": "...", "strength": "strong|moderate|weak", "pmid": "..."}}],
    "reference_list": ["[1] Author et al. (Year). Title. Journal."],
    "confidence_in_synthesis": 0.0-1.0
}}
```"""

GAP_ANALYZE_PROMPT = """You are a knowledge gap analyst for biomedical research.

Given the synthesized evidence below, identify gaps in the scientific knowledge:

SYNTHESIS:
{synthesis}

HYPOTHESIS:
{hypothesis}

For each gap, specify:
1. What is unknown or insufficiently evidenced
2. Severity: critical (blocks hypothesis), moderate (weakens it), minor (nice to know)
3. Suggested experiments or studies to fill the gap

Return as JSON:
```json
{{
    "gaps": [
        {{
            "description": "What is not known",
            "severity": "critical|moderate|minor",
            "suggested_experiments": ["Experiment 1", "Experiment 2"],
            "affected_claims": ["Which claims are affected"],
            "estimated_effort": "e.g. 6-12 months, $200K"
        }}
    ],
    "overall_evidence_strength": "strong|moderate|weak",
    "readiness_for_translation": "ready|needs_work|premature"
}}
```"""

FORMAT_PROMPT = """You are a scientific document formatter.

Format the following synthesis and gap analysis into the requested output format.

SYNTHESIS:
{synthesis}

GAP ANALYSIS:
{gap_analysis}

HYPOTHESIS:
{hypothesis}

Output Format: {output_format}
Verbosity: {verbosity} ({word_limit} words)
{grant_format_instructions}

{format_specific_instructions}

Return as JSON:
```json
{{
    "formatted_output": "The complete formatted document...",
    "visualization_data": {{
        "evidence_landscape": [{{"source": "...", "count": N, "avg_confidence": 0.0}}],
        "method_frequency": [{{"method": "...", "count": N}}],
        "gap_heatmap": [{{"area": "...", "severity": "...", "count": N}}],
        "confidence_meters": [{{"dimension": "...", "score": 0.0}}],
        "cost_breakdown": []
    }}
}}
```"""


# ============== Grant Format Templates ==============

GRANT_FORMATS = {
    "nih_r01": """Format as NIH R01 grant sections:
- Significance: Why this research matters
- Innovation: What is new about this approach
- Approach: Detailed methodology and timeline
- Environment: Required resources and expertise""",
    "nih_r21": """Format as NIH R21 Exploratory/Developmental grant:
- Rationale: Why this exploratory research is needed
- Preliminary Data: What evidence supports feasibility
- Research Design: Focused methodology for pilot study""",
    "nsf": """Format as NSF grant sections:
- Intellectual Merit: Scientific contribution
- Broader Impacts: Societal and educational benefits
- Research Plan: Methodology with milestones""",
    "dod": """Format for DoD/DARPA:
- Military Health Relevance: Connection to warfighter health
- Technical Approach: Engineering-focused methodology
- Transition Plan: Path to deployment""",
    "private_foundation": """Format for private foundation:
- Lay Summary: Plain language explanation
- Scientific Rationale: Evidence base
- Impact Statement: Patient/community benefit
- Budget Justification: Cost efficiency""",
}

FORMAT_INSTRUCTIONS = {
    "narrative": "Write flowing prose with inline [N] citations. Use clear topic sentences and logical transitions.",
    "structured_table": "Create a markdown table with columns: Claim | Evidence | Source | Confidence | Gap",
    "knowledge_gap_map": "Structure as a gap analysis map: Known -> Unknown -> Required Studies",
    "grant_sections": "Use the grant-specific section format provided.",
    "comprehensive": "Include ALL formats: narrative section, evidence table, gap map, and key findings summary.",
}

VERBOSITY_LIMITS = {"brief": 300, "standard": 1000, "comprehensive": 3000}

VERBOSITY_INSTRUCTIONS = {
    "brief": "Be extremely concise. Only include the most important findings and critical gaps.",
    "standard": "Provide balanced coverage of findings, evidence, and gaps.",
    "comprehensive": "Be thorough and detailed. Include all evidence, nuances, and secondary findings.",
}


class SynthesisPipeline:
    """5-stage backward/synthesis pipeline for evidence review."""

    def __init__(self, llm):
        """Initialize with a MultiModelLLM instance."""
        self._llm = llm
        self._constitutional_constraints = self._load_constraints()

    @staticmethod
    def _load_constraints() -> str:
        """Load constitutional constraints for all pipeline prompts."""
        import os
        path = os.path.join(os.path.dirname(__file__), "../config/constitutional_constraints.txt")
        try:
            # Try relative to services directory
            if not os.path.exists(path):
                path = os.path.join(os.path.dirname(__file__), "../../config/constitutional_constraints.txt")
            with open(path) as f:
                return f.read().strip()
        except FileNotFoundError:
            return ""

    def _prepend_constraints(self, system_prompt: str) -> str:
        """Prepend constitutional constraints to a system prompt."""
        if self._constitutional_constraints:
            return f"{self._constitutional_constraints}\n\n---\n\n{system_prompt}"
        return system_prompt

    async def run(
        self,
        project_id: str,
        hypothesis: str,
        output_format: str = "narrative",
        verbosity: str = "standard",
        grant_type: str | None = None,
        citation_style: str = "numbered",
        field_scope: str | None = None,
        on_stage_complete: Optional[Callable] = None,
    ) -> SynthesisResult:
        """Run the full 5-stage synthesis pipeline."""
        from app.agents.discovery_orchestrator import ModelType

        run_id = str(uuid4())
        start_time = time.time()
        word_limit = VERBOSITY_LIMITS.get(verbosity, 1000)

        # Stage 1: DECOMPOSE
        logger.info(f"Synthesis {run_id}: Stage 1/5 DECOMPOSE")
        field_scope_text = f"Field scope: {field_scope}" if field_scope else ""
        decompose_prompt = DECOMPOSE_PROMPT.format(
            hypothesis=hypothesis,
            field_scope_text=field_scope_text,
        )
        decompose_response = await self._llm.generate(
            ModelType.CLAUDE_OPUS,
            decompose_prompt,
            system_prompt=self._prepend_constraints("You are a biomedical research decomposition specialist. Return valid JSON only."),
            max_tokens=4096,
            temperature=0.2,
        )
        claims_data = self._parse_json(decompose_response)
        claims = claims_data.get("claims", [])
        if on_stage_complete:
            await on_stage_complete(1, "DECOMPOSE", "claude_opus", claims_data)

        # Stage 2: RETRIEVE — search PubMed + pgvector RAG for each claim
        logger.info(f"Synthesis {run_id}: Stage 2/5 RETRIEVE ({len(claims)} claims)")
        findings = await self._retrieve_evidence(claims)
        # Augment with pgvector RAG grounding
        rag_findings = await self._retrieve_from_vector_store(claims)
        findings.extend(rag_findings)
        claims_evidence = self._format_claims_evidence(claims, findings)
        if on_stage_complete:
            await on_stage_complete(2, "RETRIEVE", "cohere_command_a", {"findings_count": len(findings)})

        # Stage 3: SYNTHESIZE
        logger.info(f"Synthesis {run_id}: Stage 3/5 SYNTHESIZE")
        grant_sections = GRANT_FORMATS.get(grant_type, "") if grant_type else ""
        synthesize_prompt = SYNTHESIZE_PROMPT.format(
            output_format=output_format,
            verbosity=verbosity,
            word_limit=word_limit,
            claims_evidence=claims_evidence,
            hypothesis=hypothesis,
            grant_sections=grant_sections,
            verbosity_instruction=VERBOSITY_INSTRUCTIONS.get(verbosity, ""),
        )
        synthesize_response = await self._llm.generate(
            ModelType.CLAUDE_OPUS,
            synthesize_prompt,
            system_prompt=self._prepend_constraints("You are a scientific evidence synthesizer. Return valid JSON only."),
            max_tokens=8192,
            temperature=0.3,
        )
        synthesis_data = self._parse_json(synthesize_response)
        narrative = synthesis_data.get("narrative", "")
        if on_stage_complete:
            await on_stage_complete(3, "SYNTHESIZE", "claude_opus", synthesis_data)

        # Stage 4: GAP_ANALYZE
        logger.info(f"Synthesis {run_id}: Stage 4/5 GAP_ANALYZE")
        gap_prompt = GAP_ANALYZE_PROMPT.format(
            synthesis=narrative[:4000],
            hypothesis=hypothesis,
        )
        gap_response = await self._llm.generate(
            ModelType.GPT_41,
            gap_prompt,
            system_prompt=self._prepend_constraints("You are a knowledge gap analyst. Return valid JSON only."),
            max_tokens=4096,
            temperature=0.2,
        )
        gap_data = self._parse_json(gap_response)
        gaps = [
            GapItem(
                description=g.get("description", ""),
                severity=g.get("severity", "moderate"),
                suggested_experiments=g.get("suggested_experiments", []),
            )
            for g in gap_data.get("gaps", [])
        ]
        if on_stage_complete:
            await on_stage_complete(4, "GAP_ANALYZE", "gpt_41", gap_data)

        # Stage 5: FORMAT
        logger.info(f"Synthesis {run_id}: Stage 5/5 FORMAT")
        grant_format_instructions = GRANT_FORMATS.get(grant_type, "") if grant_type else ""
        format_specific = FORMAT_INSTRUCTIONS.get(output_format, FORMAT_INSTRUCTIONS["narrative"])
        format_prompt = FORMAT_PROMPT.format(
            synthesis=narrative[:6000],
            gap_analysis=json.dumps(gap_data.get("gaps", []))[:3000],
            hypothesis=hypothesis,
            output_format=output_format,
            verbosity=verbosity,
            word_limit=word_limit,
            grant_format_instructions=grant_format_instructions,
            format_specific_instructions=format_specific,
        )
        format_response = await self._llm.generate(
            ModelType.CLAUDE_SONNET,
            format_prompt,
            system_prompt=self._prepend_constraints("You are a scientific document formatter. Return valid JSON only."),
            max_tokens=8192,
            temperature=0.3,
        )
        format_data = self._parse_json(format_response)
        if on_stage_complete:
            await on_stage_complete(5, "FORMAT", "claude_sonnet", format_data)

        duration = time.time() - start_time

        # Build cited findings
        cited_findings = []
        for f in findings:
            cited_findings.append(CitedFinding(
                claim=f.get("claim", ""),
                source_pmid=f.get("pmid"),
                source_doi=f.get("doi"),
                source_title=f.get("title", ""),
                confidence=f.get("confidence", 0.0),
            ))

        return SynthesisResult(
            run_id=run_id,
            project_id=project_id,
            hypothesis=hypothesis,
            findings=cited_findings,
            gaps=gaps,
            narrative=narrative,
            formatted_output=format_data.get("formatted_output", narrative),
            output_format=output_format,
            verbosity=verbosity,
            grant_type=grant_type,
            visualization_data=format_data.get("visualization_data", {}),
            total_cost_cents=0,  # Will be filled by cost tracker
            duration_seconds=duration,
            status="completed",
        )

    async def _retrieve_evidence(self, claims: list[dict]) -> list[dict]:
        """Stage 2: Retrieve evidence from PubMed for each claim."""
        findings = []

        async with httpx.AsyncClient(timeout=15.0) as client:
            for claim_info in claims[:20]:  # Limit to 20 claims
                claim_text = claim_info.get("claim", "")
                search_terms = claim_info.get("search_terms", [])
                query = " ".join(search_terms) if search_terms else claim_text[:100]

                try:
                    # Search PubMed
                    params = {
                        "db": "pubmed",
                        "term": query,
                        "retmode": "json",
                        "retmax": 3,
                        "sort": "relevance",
                    }
                    if settings.PUBMED_API_KEY:
                        api_key = settings.PUBMED_API_KEY
                        if hasattr(api_key, "get_secret_value"):
                            api_key = api_key.get_secret_value()
                        if api_key:
                            params["api_key"] = api_key

                    resp = await client.get(
                        "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi",
                        params=params,
                    )
                    if resp.status_code == 200:
                        data = resp.json()
                        pmids = data.get("esearchresult", {}).get("idlist", [])

                        for pmid in pmids[:3]:
                            findings.append({
                                "claim": claim_text,
                                "pmid": pmid,
                                "title": f"PubMed article {pmid}",
                                "confidence": 0.7,
                            })

                        # Fetch article details
                        if pmids:
                            detail_resp = await client.get(
                                "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi",
                                params={
                                    "db": "pubmed",
                                    "id": ",".join(pmids[:3]),
                                    "retmode": "json",
                                },
                            )
                            if detail_resp.status_code == 200:
                                detail_data = detail_resp.json()
                                result_set = detail_data.get("result", {})
                                for f in findings:
                                    pmid = f.get("pmid", "")
                                    article = result_set.get(pmid, {})
                                    if isinstance(article, dict):
                                        f["title"] = article.get("title", f["title"])
                                        f["doi"] = article.get("elocationid", "")
                                        authors = article.get("authors", [])
                                        if authors:
                                            f["first_author"] = authors[0].get("name", "")

                except Exception as e:
                    logger.warning(f"PubMed search failed for claim: {e}")
                    findings.append({
                        "claim": claim_text,
                        "pmid": None,
                        "title": "Search failed",
                        "confidence": 0.0,
                    })

        return findings

    async def _retrieve_from_vector_store(self, claims: list[dict]) -> list[dict]:
        """Retrieve grounding evidence from pgvector RAG store."""
        findings = []
        try:
            from app.knowledge.vector_store import get_vector_store
            store = get_vector_store()
            for claim_info in claims[:20]:
                claim_text = claim_info.get("claim", "")
                try:
                    results = await store.search(claim_text, limit=3)
                    for r in results:
                        content = r.content if hasattr(r, "content") else str(r)
                        metadata = r.metadata_ if hasattr(r, "metadata_") else {}
                        if isinstance(metadata, dict):
                            source_id = metadata.get("pmid") or metadata.get("source_id", "")
                        else:
                            source_id = ""
                        similarity = r.similarity if hasattr(r, "similarity") else 0.0
                        if similarity >= 0.7:
                            findings.append({
                                "claim": claim_text,
                                "pmid": source_id if source_id else None,
                                "title": content[:200] if content else "RAG result",
                                "confidence": round(similarity, 3),
                                "source": "pgvector_rag",
                            })
                except Exception as e:
                    logger.debug(f"pgvector search failed for claim: {e}")
        except Exception as e:
            logger.warning(f"Vector store unavailable for RAG grounding: {e}")
        return findings

    def _format_claims_evidence(self, claims: list[dict], findings: list[dict]) -> str:
        """Format claims and findings for the synthesis prompt."""
        parts = []
        for i, claim_info in enumerate(claims, 1):
            claim_text = claim_info.get("claim", "")
            parts.append(f"\n### Claim {i}: {claim_text}")
            matching = [f for f in findings if f.get("claim") == claim_text]
            if matching:
                for f in matching:
                    pmid = f.get("pmid", "N/A")
                    title = f.get("title", "Unknown")
                    parts.append(f"  - [{pmid}] {title}")
            else:
                parts.append("  - No evidence found")
        return "\n".join(parts)

    def _parse_json(self, response: str) -> dict:
        """Parse JSON from LLM response."""
        text = response.strip()
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0].strip()
        elif "```" in text:
            text = text.split("```")[1].split("```")[0].strip()
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            import re
            match = re.search(r'\{[\s\S]*\}', text)
            if match:
                try:
                    return json.loads(match.group())
                except json.JSONDecodeError:
                    pass
            return {}
