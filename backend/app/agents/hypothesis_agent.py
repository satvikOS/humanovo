"""
Hypothesis Generation Agent Module

Generates and ranks hypotheses using RAG and LLM reasoning.
"""

from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from app.agents.base import (
    AgentContext,
    AgentResult,
    AgentType,
    BaseAgent,
    Tool,
)
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class GeneratedHypothesis:
    """A generated hypothesis with metadata and translational roadmap."""

    def __init__(
        self,
        statement: str,
        mechanism: str = "",
        rationale: str = "",
        confidence_score: float = 0.5,
        novelty_score: float = 0.5,
        supporting_evidence: list[dict[str, Any]] = None,
        entities: list[str] = None,
        translational_roadmap: dict[str, Any] = None,
    ):
        self.id = uuid4()
        self.statement = statement
        self.mechanism = mechanism
        self.rationale = rationale
        self.confidence_score = confidence_score
        self.novelty_score = novelty_score
        self.supporting_evidence = supporting_evidence or []
        self.entities = entities or []
        self.translational_roadmap = translational_roadmap
        self.created_at = datetime.utcnow()

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": str(self.id),
            "statement": self.statement,
            "mechanism": self.mechanism,
            "rationale": self.rationale,
            "confidence_score": self.confidence_score,
            "novelty_score": self.novelty_score,
            "supporting_evidence": self.supporting_evidence,
            "entities": self.entities,
            "translational_roadmap": self.translational_roadmap,
            "created_at": self.created_at.isoformat(),
        }


class HypothesisGenerationAgent(BaseAgent):
    """Agent that generates hypotheses using RAG and LLM.

    Combines:
    - Vector search for relevant evidence
    - Knowledge graph for structured relations
    - LLM for hypothesis synthesis
    - Scoring for ranking
    """

    agent_type = AgentType.REASONING
    description = "Generates and ranks biomedical hypotheses"

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self._llm_client = None

    def _setup_tools(self) -> None:
        """Set up hypothesis generation tools."""
        self.register_tool(
            Tool(
                name="retrieve_evidence",
                description="Retrieve relevant evidence from vector store",
                handler=self._retrieve_evidence,
            )
        )
        self.register_tool(
            Tool(
                name="query_graph",
                description="Query knowledge graph for relationships",
                handler=self._query_graph,
            )
        )
        self.register_tool(
            Tool(
                name="generate_hypothesis",
                description="Generate hypothesis using LLM",
                handler=self._generate_with_llm,
            )
        )
        self.register_tool(
            Tool(
                name="score_hypothesis",
                description="Score hypothesis for confidence and novelty",
                handler=self._score_hypothesis,
            )
        )

    async def execute(
        self,
        context: AgentContext = None,
        query: str = None,
        **kwargs,
    ) -> AgentResult:
        """Execute hypothesis generation.

        Args:
            context: Shared context
            query: Research question (uses context.query if not provided)
            **kwargs: Additional parameters (focus_entities, max_hypotheses)

        Returns:
            AgentResult with generated hypotheses
        """
        import time

        start_time = time.time()

        # Get query
        research_query = query or (context.query if context else "")
        if not research_query:
            return AgentResult(success=False, error="No query provided")

        focus_entities = kwargs.get("focus_entities", [])
        max_hypotheses = kwargs.get("max_hypotheses", 5)

        self.logger.info(
            "Hypothesis generation starting",
            query=research_query[:100],
            max_hypotheses=max_hypotheses,
        )

        # Step 1: Retrieve relevant evidence
        evidence = await self._retrieve_evidence(research_query)

        # Also use evidence from context if available
        if context and context.evidence:
            evidence.extend(context.evidence)

        self.record_step(
            action="retrieve_evidence",
            input_data={"query": research_query},
            output_data={"evidence_count": len(evidence)},
        )

        # Step 2: Query knowledge graph for relationships
        graph_facts = await self._query_graph(research_query, focus_entities)

        self.record_step(
            action="query_graph",
            input_data={"entities": focus_entities},
            output_data={"facts_count": len(graph_facts)},
        )

        # Step 3: Generate hypotheses
        hypotheses = await self._generate_hypotheses(
            query=research_query,
            evidence=evidence,
            graph_facts=graph_facts,
            max_hypotheses=max_hypotheses,
        )

        # Step 4: Score and rank hypotheses
        scored_hypotheses = []
        for h in hypotheses:
            scored = await self._score_hypothesis(h, evidence, graph_facts)
            scored_hypotheses.append(scored)

        # Sort by combined score
        scored_hypotheses.sort(
            key=lambda h: h.confidence_score * 0.6 + h.novelty_score * 0.4,
            reverse=True,
        )

        duration_ms = int((time.time() - start_time) * 1000)

        self.record_step(
            action="generate_hypotheses",
            input_data={
                "evidence_count": len(evidence),
                "graph_facts_count": len(graph_facts),
            },
            output_data={"hypothesis_count": len(scored_hypotheses)},
            duration_ms=duration_ms,
        )

        return AgentResult(
            success=True,
            data={
                "hypotheses": [h.to_dict() for h in scored_hypotheses],
                "evidence_used": len(evidence),
                "graph_facts_used": len(graph_facts),
                "summary": f"Generated {len(scored_hypotheses)} hypotheses",
            },
        )

    async def generate(
        self,
        query: str,
        project_id: UUID = None,
        focus_entities: list[str] = None,
        max_hypotheses: int = 5,
    ) -> list[GeneratedHypothesis]:
        """Generate hypotheses for a query.

        Args:
            query: Research question
            project_id: Optional project ID
            focus_entities: Optional entities to focus on
            max_hypotheses: Maximum number of hypotheses

        Returns:
            List of GeneratedHypothesis objects
        """
        context = AgentContext(
            query=query,
            project_id=project_id,
            entities=focus_entities or [],
        )

        result = await self.execute(
            context=context,
            query=query,
            focus_entities=focus_entities,
            max_hypotheses=max_hypotheses,
        )

        if not result.success:
            return []

        # Convert to GeneratedHypothesis objects
        hypotheses = []
        for h_data in result.data.get("hypotheses", []):
            hypotheses.append(
                GeneratedHypothesis(
                    statement=h_data["statement"],
                    mechanism=h_data.get("mechanism", ""),
                    rationale=h_data.get("rationale", ""),
                    confidence_score=h_data.get("confidence_score", 0.5),
                    novelty_score=h_data.get("novelty_score", 0.5),
                    supporting_evidence=h_data.get("supporting_evidence", []),
                    entities=h_data.get("entities", []),
                    translational_roadmap=h_data.get("translational_roadmap"),
                )
            )

        return hypotheses

    async def _retrieve_evidence(
        self,
        query: str,
        limit: int = 20,
    ) -> list[dict[str, Any]]:
        """Retrieve relevant evidence from vector store."""
        try:
            from app.knowledge.vector_store import get_vector_store

            store = get_vector_store()
            results = await store.search(query, limit=limit)

            return [
                {
                    "id": r.id,
                    "content": r.content,
                    "score": r.score,
                    "metadata": r.metadata,
                }
                for r in results
            ]
        except RuntimeError:
            self.logger.debug("Vector store not initialized")
            return []

    async def _query_graph(
        self,
        query: str,
        entities: list[str] = None,
    ) -> list[dict[str, Any]]:
        """Query knowledge graph for relevant relationships."""
        try:
            from app.knowledge.graph_store import get_graph_store

            store = get_graph_store()
        except RuntimeError:
            self.logger.debug("Graph store not initialized")
            return []

        facts = []

        # Search for entities mentioned in query
        search_terms = entities or self._extract_terms(query)

        for term in search_terms[:5]:
            results = await store.search_entities(term, limit=3)

            for entity in results:
                # Get neighborhood
                neighborhood = await store.get_neighborhood(entity.id, depth=1, limit=10)
                if neighborhood:
                    for relation in neighborhood.relations:
                        facts.append(
                            {
                                "source": relation.source_name,
                                "relation": relation.relation_type,
                                "target": relation.target_name,
                                "confidence": relation.confidence,
                            }
                        )

        return facts

    def _extract_terms(self, text: str) -> list[str]:
        """Extract key terms from text for graph querying."""
        import re

        # Simple extraction of potentially important terms
        terms = []

        # Capitalized words
        terms.extend(re.findall(r"\b[A-Z][a-z]+\b", text))

        # Gene-like patterns
        terms.extend(re.findall(r"\b[A-Z]{2,}[0-9]*\b", text))

        return list(set(terms))[:10]

    async def _generate_hypotheses(
        self,
        query: str,
        evidence: list[dict[str, Any]],
        graph_facts: list[dict[str, Any]],
        max_hypotheses: int = 5,
    ) -> list[GeneratedHypothesis]:
        """Generate hypotheses using available evidence and facts."""
        hypotheses = []

        # Try to use LLM if available
        llm_hypotheses = await self._generate_with_llm(query, evidence, graph_facts, max_hypotheses)
        if llm_hypotheses:
            return llm_hypotheses

        # Fallback: Generate template-based hypotheses
        hypotheses = self._generate_template_hypotheses(
            query, evidence, graph_facts, max_hypotheses
        )

        return hypotheses

    async def _generate_with_llm(
        self,
        query: str,
        evidence: list[dict[str, Any]],
        graph_facts: list[dict[str, Any]],
        max_hypotheses: int = 5,
    ) -> list[GeneratedHypothesis]:
        """Generate hypotheses using LLM."""
        if not settings.openai_api_key_value:
            return []

        try:
            from openai import AsyncOpenAI

            client = AsyncOpenAI(api_key=settings.openai_api_key_value)

            # Build context from evidence and facts
            evidence_text = "\n".join(f"- {e.get('content', '')[:200]}" for e in evidence[:10])
            facts_text = "\n".join(
                f"- {f['source']} {f['relation']} {f['target']}" for f in graph_facts[:10]
            )

            prompt = f"""Based on the following research question and available evidence, generate {max_hypotheses} novel, testable hypotheses.
Each hypothesis MUST include a complete bench-to-bedside translational roadmap (T0-T5).

Research Question: {query}

Available Evidence:
{evidence_text}

Known Facts:
{facts_text}

For each hypothesis, provide:
1. A clear statement of the hypothesis
2. The proposed mechanism
3. A brief rationale citing relevant evidence
4. A translational roadmap with phases T0 through T5

Format each hypothesis as:
HYPOTHESIS: [statement]
MECHANISM: [proposed mechanism]
RATIONALE: [why this hypothesis is plausible]
T0_BASIC_RESEARCH: [Laboratory discovery, preclinical research, animal studies needed. Include: key experiments, model systems, target validation approach, estimated timeline]
T1_TRANSLATION_TO_HUMANS: [First-in-human proof of concept. Include: Phase 0/1 trial design, IND requirements, PK/PD studies, safety monitoring plan, estimated timeline]
T2_TRANSLATION_TO_PATIENTS: [Phase 2/3 clinical trials. Include: trial design, endpoints, patient population, regulatory pathway (NDA/BLA/505(b)(2)), estimated timeline]
T3_TRANSLATION_TO_PRACTICE: [Implementation research. Include: guideline development, physician training needs, EHR integration, formulary adoption strategy, estimated timeline]
T4_TRANSLATION_TO_COMMUNITY: [Population health impact. Include: real-world evidence plan, health disparities considerations, cost-effectiveness analysis, post-marketing surveillance, estimated timeline]
T5_GLOBAL_IMPACT: [Global health policy. Include: WHO considerations, LMIC access strategy, international regulatory harmonization, health equity implications, estimated timeline]
CURRENT_PHASE: [T0, T1, T2, T3, T4, or T5 — where this hypothesis currently stands]
FEASIBILITY: [0.0-1.0 overall feasibility score]
TOTAL_TIMELINE: [estimated total timeline from T0 to T5]
---
"""

            response = await client.chat.completions.create(
                model=settings.OPENAI_MODEL,
                messages=[
                    {
                        "role": "system",
                        "content": "You are a translational biomedical research assistant that generates novel, scientifically grounded hypotheses with complete bench-to-bedside translational roadmaps (T0-T5). Each hypothesis must span from basic research through global health impact.",
                    },
                    {"role": "user", "content": prompt},
                ],
                max_tokens=2000,
                temperature=0.7,
            )

            # Parse response into hypotheses
            content = response.choices[0].message.content
            hypotheses = self._parse_llm_response(content, evidence)

            return hypotheses

        except Exception as e:
            self.logger.warning("LLM generation failed", error=str(e))
            return []

    def _parse_llm_response(
        self,
        response: str,
        evidence: list[dict[str, Any]],
    ) -> list[GeneratedHypothesis]:
        """Parse LLM response into hypothesis objects with translational roadmaps."""
        hypotheses = []

        # Split by separator
        blocks = response.split("---")

        # Field mapping for translational phases
        phase_fields = {
            "T0_BASIC_RESEARCH": "T0",
            "T1_TRANSLATION_TO_HUMANS": "T1",
            "T2_TRANSLATION_TO_PATIENTS": "T2",
            "T3_TRANSLATION_TO_PRACTICE": "T3",
            "T4_TRANSLATION_TO_COMMUNITY": "T4",
            "T5_GLOBAL_IMPACT": "T5",
        }

        phase_names = {
            "T0": ("Basic Research", "Basic / Preclinical Research"),
            "T1": ("Translation to Humans", "First-in-Human Proof of Concept"),
            "T2": ("Translation to Patients", "Clinical Efficacy & Safety"),
            "T3": ("Translation to Practice", "Implementation Research"),
            "T4": ("Translation to Community", "Population Health Impact"),
            "T5": ("Global Impact", "Global Health Policy & Systemic Change"),
        }

        for block in blocks:
            if not block.strip():
                continue

            # Extract fields
            statement = ""
            mechanism = ""
            rationale = ""
            phase_content = {}
            current_phase = "T0"
            feasibility = 0.5
            total_timeline = ""

            lines = block.strip().split("\n")
            current_field = None

            for line in lines:
                line = line.strip()
                if line.startswith("HYPOTHESIS:"):
                    current_field = "statement"
                    statement = line.replace("HYPOTHESIS:", "").strip()
                elif line.startswith("MECHANISM:"):
                    current_field = "mechanism"
                    mechanism = line.replace("MECHANISM:", "").strip()
                elif line.startswith("RATIONALE:"):
                    current_field = "rationale"
                    rationale = line.replace("RATIONALE:", "").strip()
                elif line.startswith("CURRENT_PHASE:"):
                    current_field = None
                    current_phase = line.replace("CURRENT_PHASE:", "").strip()
                elif line.startswith("FEASIBILITY:"):
                    current_field = None
                    try:
                        feasibility = float(line.replace("FEASIBILITY:", "").strip())
                    except ValueError:
                        feasibility = 0.5
                elif line.startswith("TOTAL_TIMELINE:"):
                    current_field = None
                    total_timeline = line.replace("TOTAL_TIMELINE:", "").strip()
                else:
                    # Check for phase field prefixes
                    matched_phase = False
                    for prefix, phase_id in phase_fields.items():
                        if line.startswith(f"{prefix}:"):
                            current_field = phase_id
                            phase_content[phase_id] = line.replace(f"{prefix}:", "").strip()
                            matched_phase = True
                            break

                    if not matched_phase:
                        if current_field == "statement":
                            statement += " " + line
                        elif current_field == "mechanism":
                            mechanism += " " + line
                        elif current_field == "rationale":
                            rationale += " " + line
                        elif current_field in phase_fields.values():
                            phase_content[current_field] = phase_content.get(current_field, "") + " " + line

            if statement:
                # Build translational roadmap
                roadmap_phases = []
                for phase_id in ["T0", "T1", "T2", "T3", "T4", "T5"]:
                    name, formal = phase_names[phase_id]
                    content = phase_content.get(phase_id, "")
                    roadmap_phases.append({
                        "phase": phase_id,
                        "phase_name": name,
                        "formal_name": formal,
                        "description": content.strip(),
                        "objectives": [content.strip()] if content.strip() else [],
                        "key_activities": [],
                        "milestones": [],
                        "success_criteria": [],
                        "estimated_duration": "",
                    })

                translational_roadmap = {
                    "current_phase": current_phase if current_phase in ["T0", "T1", "T2", "T3", "T4", "T5"] else "T0",
                    "phases": roadmap_phases,
                    "overall_feasibility_score": feasibility,
                    "estimated_total_timeline": total_timeline,
                    "critical_path_summary": "",
                    "key_decision_points": [],
                    "cross_phase_risks": [],
                    "regulatory_pathway_summary": "",
                    "commercialization_potential": "",
                }

                hypotheses.append(
                    GeneratedHypothesis(
                        statement=statement.strip(),
                        mechanism=mechanism.strip(),
                        rationale=rationale.strip(),
                        supporting_evidence=evidence[:5],
                        translational_roadmap=translational_roadmap,
                    )
                )

        return hypotheses

    def _generate_template_hypotheses(
        self,
        query: str,
        evidence: list[dict[str, Any]],
        graph_facts: list[dict[str, Any]],
        max_hypotheses: int = 5,
    ) -> list[GeneratedHypothesis]:
        """Generate hypotheses using templates when LLM is unavailable."""
        hypotheses = []

        # Extract entities from graph facts
        entities = set()
        for fact in graph_facts:
            entities.add(fact.get("source", ""))
            entities.add(fact.get("target", ""))
        entities = [e for e in entities if e]

        # Generate hypotheses from graph patterns
        for i, fact in enumerate(graph_facts[:max_hypotheses]):
            source = fact.get("source", "Entity A")
            relation = fact.get("relation", "affects")
            target = fact.get("target", "Entity B")

            # Template-based hypothesis
            templates = [
                f"Modulating {source} activity may affect {target} through {relation}.",
                f"The {relation} relationship between {source} and {target} suggests a potential therapeutic target.",
                f"Investigating the {source}-{target} interaction could reveal new insights about {relation}.",
            ]

            statement = templates[i % len(templates)]

            hypotheses.append(
                GeneratedHypothesis(
                    statement=statement,
                    mechanism=f"{source} {relation} {target}",
                    rationale="Based on known relationship in knowledge graph.",
                    supporting_evidence=evidence[:3],
                    entities=[source, target],
                )
            )

        # If still need more, generate from evidence
        if len(hypotheses) < max_hypotheses and evidence:
            for e in evidence[: max_hypotheses - len(hypotheses)]:
                content = e.get("content", "")[:200]
                hypotheses.append(
                    GeneratedHypothesis(
                        statement=f"Further investigation of: {content}",
                        mechanism="Requires detailed analysis",
                        rationale="Based on retrieved evidence",
                        supporting_evidence=[e],
                    )
                )

        return hypotheses[:max_hypotheses]

    async def _score_hypothesis(
        self,
        hypothesis: GeneratedHypothesis,
        evidence: list[dict[str, Any]],
        graph_facts: list[dict[str, Any]],
    ) -> GeneratedHypothesis:
        """Score a hypothesis for confidence and novelty."""
        # Confidence: Based on supporting evidence and graph alignment
        evidence_score = min(1.0, len(hypothesis.supporting_evidence) * 0.2)

        # Check if hypothesis aligns with graph facts
        graph_alignment = 0
        for fact in graph_facts:
            if (
                fact.get("source", "").lower() in hypothesis.statement.lower()
                or fact.get("target", "").lower() in hypothesis.statement.lower()
            ):
                graph_alignment += 0.1

        graph_score = min(0.5, graph_alignment)

        hypothesis.confidence_score = min(1.0, 0.3 + evidence_score + graph_score)

        # Novelty: Higher if not directly stated in evidence
        # Simple heuristic: less overlap with evidence = more novel
        overlap = 0
        statement_words = set(hypothesis.statement.lower().split())
        for e in evidence:
            content_words = set(e.get("content", "").lower().split())
            overlap += len(statement_words & content_words)

        avg_overlap = overlap / max(1, len(evidence))
        hypothesis.novelty_score = max(0.1, 1.0 - avg_overlap / max(1, len(statement_words)))

        return hypothesis
