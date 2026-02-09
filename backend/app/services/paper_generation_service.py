"""
Research Paper Generation Service

Generates fully formatted research papers from discovery results with:
- Structured sections (Abstract, Introduction, Methods, Results, Discussion, Conclusion)
- Citations and references in standard academic format
- Tables summarizing hypotheses, confidence scores, and evidence
- Flowcharts describing discovery pathways (as Mermaid diagrams)
- Diagrams of mechanism of action
- Statistical summaries
- External factor interaction maps

Triggered when target confidence is reached or discovery is manually stopped.
"""

import json
from datetime import datetime
from typing import Any, Optional
from uuid import uuid4

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class ResearchPaper:
    """A generated research paper from discovery results."""

    def __init__(
        self,
        disease: str,
        discovery_type: str,
        hypotheses: list[dict[str, Any]],
        stats: dict[str, Any],
        external_factors: list[dict[str, Any]] = None,
    ):
        self.id = str(uuid4())
        self.disease = disease
        self.discovery_type = discovery_type
        self.hypotheses = hypotheses
        self.stats = stats
        self.external_factors = external_factors or []
        self.created_at = datetime.utcnow()
        self.sections: dict[str, str] = {}
        self.references: list[dict[str, str]] = []
        self.tables: list[dict[str, Any]] = []
        self.figures: list[dict[str, Any]] = []

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "disease": self.disease,
            "discovery_type": self.discovery_type,
            "created_at": self.created_at.isoformat(),
            "sections": self.sections,
            "references": self.references,
            "tables": self.tables,
            "figures": self.figures,
            "metadata": {
                "total_hypotheses": len(self.hypotheses),
                "total_agents": self.stats.get("total_agents", 0),
                "runtime_seconds": self.stats.get("runtime_seconds", 0),
                "best_confidence": self.stats.get("current_best_confidence", 0),
                "models_used": self.stats.get("models_active", []),
                "external_factors_count": len(self.external_factors),
            },
        }


class PaperGenerationService:
    """
    Generates research papers from discovery results.
    Can use LLM for narrative sections or generate structured output directly.
    """

    def __init__(self):
        self._llm = None

    async def _get_llm(self):
        if self._llm is None:
            try:
                from app.agents.discovery_orchestrator import MultiModelLLM, TokenPool, ModelType
                pool = TokenPool()
                self._llm = MultiModelLLM(pool)
                await self._llm.initialize()
            except Exception as e:
                logger.warning(f"LLM not available for paper generation: {e}")
        return self._llm

    async def generate_paper(
        self,
        disease: str,
        discovery_type: str,
        hypotheses: list[dict[str, Any]],
        stats: dict[str, Any],
        external_factors: list[dict[str, Any]] = None,
    ) -> ResearchPaper:
        """Generate a full research paper from discovery results."""
        paper = ResearchPaper(
            disease=disease,
            discovery_type=discovery_type,
            hypotheses=hypotheses,
            stats=stats,
            external_factors=external_factors,
        )

        # Generate all paper sections
        paper.sections["title"] = self._generate_title(disease, discovery_type, hypotheses)
        paper.sections["abstract"] = await self._generate_abstract(paper)
        paper.sections["introduction"] = await self._generate_introduction(paper)
        paper.sections["methods"] = self._generate_methods(paper)
        paper.sections["results"] = await self._generate_results(paper)
        paper.sections["discussion"] = await self._generate_discussion(paper)
        paper.sections["conclusion"] = await self._generate_conclusion(paper)
        paper.sections["external_factors_analysis"] = self._generate_external_factors_section(paper)

        # Generate tables
        paper.tables = self._generate_tables(paper)

        # Generate figures (as Mermaid diagrams for flowcharts)
        paper.figures = self._generate_figures(paper)

        # Generate references
        paper.references = self._generate_references(paper)

        logger.info(
            f"Generated research paper '{paper.sections['title']}' "
            f"with {len(paper.tables)} tables, {len(paper.figures)} figures, "
            f"{len(paper.references)} references"
        )

        return paper

    def _generate_title(
        self, disease: str, discovery_type: str, hypotheses: list[dict[str, Any]],
    ) -> str:
        top = hypotheses[0] if hypotheses else {}
        type_label = {
            "cure": "Curative Strategies",
            "prevention": "Prevention Strategies",
            "treatment": "Treatment Approaches",
            "biomarker": "Biomarker Discovery",
            "drug_repurposing": "Drug Repurposing Candidates",
        }.get(discovery_type, "Therapeutic Strategies")

        if top.get("title"):
            return (
                f"Multi-Model AI Discovery of {type_label} for {disease}: "
                f"{top['title']}"
            )
        return f"Multi-Model AI Discovery of {type_label} for {disease}"

    async def _generate_abstract(self, paper: ResearchPaper) -> str:
        llm = await self._get_llm()

        top_hypotheses = paper.hypotheses[:5]
        hyp_summaries = "\n".join(
            f"- {h.get('title', 'N/A')} (confidence: {h.get('confidence', 0):.1%})"
            for h in top_hypotheses
        )

        if llm:
            try:
                from app.agents.discovery_orchestrator import ModelType
                prompt = f"""Write a concise scientific abstract (200-300 words) for a research paper with:

Disease: {paper.disease}
Discovery Type: {paper.discovery_type}
Total Hypotheses Found: {len(paper.hypotheses)}
Top Hypotheses:
{hyp_summaries}

Agents Used: {paper.stats.get('total_agents', 0)}
Models: {', '.join(paper.stats.get('models_active', []))}
Runtime: {paper.stats.get('runtime_seconds', 0):.0f} seconds
External Factors Analyzed: {len(paper.external_factors)}

Write in formal academic style. Include background, methods, key findings, and significance."""

                return await llm.generate(ModelType.KIMI_25, prompt, temperature=0.3, max_tokens=1000)
            except Exception as e:
                logger.warning(f"LLM abstract generation failed, using template: {e}")

        # Template fallback
        best_conf = paper.stats.get("current_best_confidence", 0)
        return (
            f"**Background**: {paper.disease} remains a significant challenge in biomedical research. "
            f"This study employed a multi-model AI discovery platform (Humanovo) to systematically explore "
            f"novel {paper.discovery_type} strategies.\n\n"
            f"**Methods**: We deployed {paper.stats.get('total_agents', 0)} parallel discovery agents "
            f"across four large language models (Llama Maverick, DeepSeek R1, Kimi 2.5, GPT OSS 120B) "
            f"to explore biological pathways, molecular interactions, and external factor relationships "
            f"associated with {paper.disease}. Token pool management enabled sustained parallel inference "
            f"without resource exhaustion.\n\n"
            f"**Results**: The system identified {len(paper.hypotheses)} candidate hypotheses, "
            f"with the highest-confidence discovery achieving {best_conf:.1%} confidence. "
            f"Top findings include:\n{hyp_summaries}\n\n"
            f"**Conclusion**: Multi-model parallel AI discovery shows promise for accelerating "
            f"identification of therapeutic strategies for {paper.disease}. "
            f"The integration of {len(paper.external_factors)} external factors (nutrients, chemicals, "
            f"drugs, compounds, elements) provided a more comprehensive analysis of potential interventions."
        )

    async def _generate_introduction(self, paper: ResearchPaper) -> str:
        llm = await self._get_llm()
        if llm:
            try:
                from app.agents.discovery_orchestrator import ModelType
                prompt = f"""Write the Introduction section (400-600 words) for a research paper about AI-driven discovery of {paper.discovery_type} strategies for {paper.disease}.

Cover:
1. Background on {paper.disease} and current treatment landscape
2. Limitations of current approaches
3. The potential of multi-model AI systems for drug discovery
4. The role of external factors (nutrients, chemicals, compounds) in disease modulation
5. Study objectives

Write in formal academic style with paragraph structure."""

                return await llm.generate(ModelType.DEEPSEEK_R1, prompt, temperature=0.3, max_tokens=1500)
            except Exception:
                pass

        return (
            f"## Introduction\n\n"
            f"{paper.disease} represents a major area of unmet medical need. Despite advances in "
            f"understanding its molecular pathology, current therapeutic options remain limited. "
            f"Traditional drug discovery approaches are time-consuming, expensive, and have high "
            f"attrition rates.\n\n"
            f"Recent advances in artificial intelligence, particularly large language models (LLMs), "
            f"have opened new avenues for biomedical discovery. Multi-model systems that leverage "
            f"diverse architectures can provide complementary analytical perspectives, reducing blind "
            f"spots inherent in single-model approaches.\n\n"
            f"This study introduces a novel approach using four parallel LLMs — Llama Maverick for "
            f"fast broad exploration, DeepSeek R1 for deep logical reasoning, Kimi 2.5 for long-context "
            f"analysis, and GPT OSS 120B for large-parameter nuanced reasoning — orchestrated by the "
            f"Humanovo platform to systematically discover {paper.discovery_type} strategies for "
            f"{paper.disease}.\n\n"
            f"Critically, our approach integrates external factor simulation, analyzing how nutrients, "
            f"chemicals, drugs, natural compounds, and trace elements interact with identified biological "
            f"pathways. This holistic approach captures the complexity of real-world disease environments "
            f"beyond isolated molecular interactions."
        )

    def _generate_methods(self, paper: ResearchPaper) -> str:
        models = paper.stats.get("models_active", ["llama_maverick", "deepseek_r1", "kimi_25", "gpt_oss_120b"])
        agents_by_role = paper.stats.get("agents_by_role", {})
        token_stats = paper.stats.get("token_pool_stats", {})

        ext_factors_desc = ""
        if paper.external_factors:
            categories = set(f.get("category", "unknown") for f in paper.external_factors)
            ext_factors_desc = (
                f"\n\n### External Factor Simulation\n\n"
                f"{len(paper.external_factors)} external factors were included across "
                f"{len(categories)} categories ({', '.join(categories)}). Each agent evaluated "
                f"how these factors interact with discovered pathways, considering synergistic, "
                f"antagonistic, and modulatory effects on therapeutic targets."
            )

        return (
            f"## Methods\n\n"
            f"### Multi-Model Discovery Platform\n\n"
            f"Discovery was conducted on the Humanovo platform using {paper.stats.get('total_agents', 0)} "
            f"parallel agents distributed across {len(models)} LLMs:\n\n"
            f"| Model | Role | Architecture |\n"
            f"|-------|------|-------------|\n"
            f"| Llama Maverick | Fast exploration | Meta Llama 4 Maverick 17B via AWS Bedrock |\n"
            f"| DeepSeek R1 | Deep reasoning | DeepSeek R1 Distill 70B via AWS Bedrock |\n"
            f"| Kimi 2.5 | Long-context analysis | Moonshot Kimi 2.5 |\n"
            f"| GPT OSS 120B | Large-parameter reasoning | Open-source 120B via Together API |\n\n"
            f"### Agent Architecture\n\n"
            f"Agents were organized by role:\n\n"
            + "\n".join(f"- **{role.title()}**: {count} agents" for role, count in agents_by_role.items())
            + f"\n\n### Token Pool Management\n\n"
            f"A token pool system managed concurrent access across all four models, enforcing "
            f"per-model concurrency limits ({settings.TOKEN_POOL_MAX_CONCURRENT_REQUESTS} concurrent "
            f"requests per model) and global rate limits ({settings.TOKEN_POOL_MAX_TOKENS_PER_MINUTE:,} "
            f"tokens/minute) to prevent resource exhaustion at scale."
            + ext_factors_desc
            + f"\n\n### Confidence Scoring\n\n"
            f"Hypotheses were scored using a weighted composite:\n"
            f"- Direct clinical evidence: 0.4\n"
            f"- Mechanistic plausibility: 0.25\n"
            f"- Preclinical evidence: 0.2\n"
            f"- Computational predictions: 0.1\n"
            f"- Expert consensus: 0.05\n\n"
            f"Discovery continued until target confidence ({paper.stats.get('current_best_confidence', 0):.1%}) "
            f"was reached or manually stopped."
        )

    async def _generate_results(self, paper: ResearchPaper) -> str:
        top_hyps = paper.hypotheses[:10]
        hyp_details = []
        for i, h in enumerate(top_hyps, 1):
            hyp_details.append(
                f"### {i}. {h.get('title', 'Untitled')}\n\n"
                f"**Confidence**: {h.get('confidence', 0):.1%}\n"
                f"**Model**: {h.get('model_used', 'unknown')}\n"
                f"**Mechanism**: {h.get('mechanism', 'Not specified')}\n\n"
                f"{h.get('description', 'No description available.')}\n"
            )

        ext_results = ""
        if paper.external_factors:
            ext_results = (
                f"\n### External Factor Interactions\n\n"
                f"{len(paper.external_factors)} external factors were analyzed for their interaction "
                f"with the top hypotheses. Key interactions are detailed in Table 3.\n"
            )

        return (
            f"## Results\n\n"
            f"### Discovery Overview\n\n"
            f"The multi-model discovery system explored {paper.stats.get('paths_explored', 0):,} "
            f"biological pathways over {paper.stats.get('runtime_seconds', 0):.0f} seconds, "
            f"generating {len(paper.hypotheses)} candidate hypotheses. "
            f"Of these, {paper.stats.get('high_confidence_discoveries', 0)} achieved high confidence "
            f"(>=70%).\n\n"
            f"### Top Hypotheses\n\n"
            + "\n".join(hyp_details)
            + ext_results
        )

    async def _generate_discussion(self, paper: ResearchPaper) -> str:
        llm = await self._get_llm()
        if llm:
            try:
                from app.agents.discovery_orchestrator import ModelType
                top_titles = [h.get("title", "N/A") for h in paper.hypotheses[:5]]
                prompt = f"""Write a Discussion section (300-500 words) for a research paper about AI-driven discovery for {paper.disease}.

Key findings: {', '.join(top_titles)}
Best confidence: {paper.stats.get('current_best_confidence', 0):.1%}
Models used: Llama Maverick, DeepSeek R1, Kimi 2.5, GPT OSS 120B
External factors analyzed: {len(paper.external_factors)}

Discuss significance, limitations, comparison to existing approaches, and future directions.
Write in formal academic style."""

                return await llm.generate(ModelType.DEEPSEEK_R1, prompt, temperature=0.3, max_tokens=1500)
            except Exception:
                pass

        return (
            f"## Discussion\n\n"
            f"This study demonstrates the feasibility of multi-model parallel AI systems for "
            f"systematic biomedical discovery. The Humanovo platform's integration of four distinct "
            f"LLM architectures provided complementary analytical perspectives that a single model "
            f"could not achieve.\n\n"
            f"The top hypothesis achieved {paper.stats.get('current_best_confidence', 0):.1%} confidence, "
            f"suggesting promising avenues for experimental validation. The incorporation of external "
            f"factors — nutrients, chemicals, drugs, compounds, and elements — provided a more realistic "
            f"simulation of therapeutic environments.\n\n"
            f"**Limitations**: AI-generated hypotheses require experimental validation. The confidence "
            f"scoring system, while comprehensive, relies on the quality of training data within each model. "
            f"Token pool constraints may limit exploration depth at maximum agent counts.\n\n"
            f"**Future Directions**: Integration with wet-lab automation for hypothesis validation, "
            f"expansion of the external factor database, and real-time literature monitoring for "
            f"continuous discovery refinement."
        )

    async def _generate_conclusion(self, paper: ResearchPaper) -> str:
        return (
            f"## Conclusion\n\n"
            f"Using {paper.stats.get('total_agents', 0)} parallel AI agents across four large language "
            f"models, Humanovo identified {len(paper.hypotheses)} candidate {paper.discovery_type} "
            f"strategies for {paper.disease}, with the best achieving "
            f"{paper.stats.get('current_best_confidence', 0):.1%} confidence. "
            f"The multi-model approach, combined with external factor simulation and token pool "
            f"management for sustained parallel inference, represents a scalable framework for "
            f"AI-accelerated biomedical discovery."
        )

    def _generate_external_factors_section(self, paper: ResearchPaper) -> str:
        if not paper.external_factors:
            return ""

        by_category: dict[str, list] = {}
        for f in paper.external_factors:
            cat = f.get("category", "other")
            by_category.setdefault(cat, []).append(f)

        sections = ["## External Factors Analysis\n"]
        for category, factors in by_category.items():
            sections.append(f"\n### {category.title()}\n")
            for f in factors:
                sections.append(
                    f"- **{f.get('name', 'Unknown')}**: {f.get('interaction', 'Interaction to be determined')}"
                )

        return "\n".join(sections)

    def _generate_tables(self, paper: ResearchPaper) -> list[dict[str, Any]]:
        tables = []

        # Table 1: Top hypotheses summary
        hyp_rows = []
        for i, h in enumerate(paper.hypotheses[:20], 1):
            hyp_rows.append({
                "rank": i,
                "title": h.get("title", "Untitled"),
                "confidence": f"{h.get('confidence', 0):.1%}",
                "model": h.get("model_used", "unknown"),
                "validated": "Yes" if h.get("validated") else "No",
            })

        tables.append({
            "id": "table_1",
            "caption": f"Table 1. Top {len(hyp_rows)} Discovery Hypotheses for {paper.disease}",
            "columns": ["Rank", "Hypothesis", "Confidence", "Model", "Validated"],
            "rows": hyp_rows,
        })

        # Table 2: Model performance comparison
        token_stats = paper.stats.get("token_pool_stats", {})
        model_rows = []
        requests_per_model = token_stats.get("requests_per_model", {})
        tokens_per_model = token_stats.get("tokens_per_model", {})
        errors_per_model = token_stats.get("errors_per_model", {})

        for model_name in ["llama_maverick", "deepseek_r1", "kimi_25", "gpt_oss_120b"]:
            model_rows.append({
                "model": model_name,
                "requests": requests_per_model.get(model_name, 0),
                "tokens_used": f"{tokens_per_model.get(model_name, 0):,}",
                "errors": errors_per_model.get(model_name, 0),
            })

        tables.append({
            "id": "table_2",
            "caption": "Table 2. Model Performance Comparison",
            "columns": ["Model", "Requests", "Tokens Used", "Errors"],
            "rows": model_rows,
        })

        # Table 3: External factors (if any)
        if paper.external_factors:
            factor_rows = []
            for f in paper.external_factors[:30]:
                factor_rows.append({
                    "name": f.get("name", "Unknown"),
                    "category": f.get("category", "unknown"),
                    "interaction": f.get("interaction", "TBD"),
                })
            tables.append({
                "id": "table_3",
                "caption": "Table 3. External Factors Analyzed",
                "columns": ["Factor", "Category", "Interaction"],
                "rows": factor_rows,
            })

        return tables

    def _generate_figures(self, paper: ResearchPaper) -> list[dict[str, Any]]:
        figures = []

        # Figure 1: Discovery pipeline flowchart (Mermaid)
        figures.append({
            "id": "figure_1",
            "caption": "Figure 1. Humanovo Multi-Model Discovery Pipeline",
            "type": "mermaid_flowchart",
            "content": (
                "graph TD\n"
                f"    A[Disease Input: {paper.disease}] --> B[Knowledge Graph Exploration]\n"
                "    B --> C{Agent Distribution}\n"
                "    C --> D[Llama Maverick<br/>Fast Exploration]\n"
                "    C --> E[DeepSeek R1<br/>Deep Reasoning]\n"
                "    C --> F[Kimi 2.5<br/>Long Context]\n"
                "    C --> G[GPT OSS 120B<br/>Large Parameter]\n"
                "    D --> H[Hypothesis Generation]\n"
                "    E --> H\n"
                "    F --> H\n"
                "    G --> H\n"
                "    H --> I{Confidence >= Target?}\n"
                "    I -->|Yes| J[Research Paper Generation]\n"
                "    I -->|No| K[Continue Exploration]\n"
                "    K --> C\n"
                "    L[External Factors<br/>Nutrients, Chemicals,<br/>Drugs, Compounds] --> H"
            ),
        })

        # Figure 2: Confidence distribution
        confidence_buckets = {"<30%": 0, "30-50%": 0, "50-70%": 0, "70-90%": 0, ">=90%": 0}
        for h in paper.hypotheses:
            conf = h.get("confidence", 0)
            if conf < 0.3:
                confidence_buckets["<30%"] += 1
            elif conf < 0.5:
                confidence_buckets["30-50%"] += 1
            elif conf < 0.7:
                confidence_buckets["50-70%"] += 1
            elif conf < 0.9:
                confidence_buckets["70-90%"] += 1
            else:
                confidence_buckets[">=90%"] += 1

        figures.append({
            "id": "figure_2",
            "caption": "Figure 2. Distribution of Hypothesis Confidence Scores",
            "type": "bar_chart_data",
            "content": confidence_buckets,
        })

        # Figure 3: Top hypothesis mechanism flowchart
        if paper.hypotheses:
            top = paper.hypotheses[0]
            mechanism = top.get("mechanism", "Unknown mechanism")
            figures.append({
                "id": "figure_3",
                "caption": f"Figure 3. Mechanism of Action: {top.get('title', 'Top Hypothesis')}",
                "type": "mermaid_flowchart",
                "content": (
                    "graph LR\n"
                    f"    A[{paper.disease}] --> B[Target Pathway]\n"
                    f"    B --> C[{top.get('title', 'Intervention')}]\n"
                    "    C --> D[Mechanism of Action]\n"
                    "    D --> E[Therapeutic Outcome]\n"
                    f"    F[External Factors] --> C"
                ),
            })

        # Figure 4: Agent role distribution (Mermaid pie)
        agents_by_role = paper.stats.get("agents_by_role", {})
        if agents_by_role:
            pie_lines = ["pie title Agent Role Distribution"]
            for role, count in agents_by_role.items():
                pie_lines.append(f'    "{role.title()}" : {count}')
            figures.append({
                "id": "figure_4",
                "caption": "Figure 4. Agent Distribution by Role",
                "type": "mermaid_pie",
                "content": "\n".join(pie_lines),
            })

        return figures

    def _generate_references(self, paper: ResearchPaper) -> list[dict[str, str]]:
        """Generate references list. In production, these would come from actual citations found by agents."""
        refs = [
            {
                "id": "1",
                "text": (
                    "Vaswani, A. et al. (2017). Attention Is All You Need. "
                    "Advances in Neural Information Processing Systems, 30."
                ),
            },
            {
                "id": "2",
                "text": (
                    "Brown, T.B. et al. (2020). Language Models are Few-Shot Learners. "
                    "Advances in Neural Information Processing Systems, 33."
                ),
            },
            {
                "id": "3",
                "text": (
                    "Jumper, J. et al. (2021). Highly accurate protein structure prediction "
                    "with AlphaFold. Nature, 596, 583-589."
                ),
            },
            {
                "id": "4",
                "text": (
                    "Stokes, J.M. et al. (2020). A deep learning approach to antibiotic "
                    "discovery. Cell, 180(4), 688-702."
                ),
            },
            {
                "id": "5",
                "text": (
                    f"Humanovo Discovery Platform. (2026). Multi-Model Parallel AI Discovery "
                    f"for {paper.disease}. Humanovo Internal Report."
                ),
            },
        ]

        # Add references from hypotheses that have evidence
        for i, h in enumerate(paper.hypotheses[:10], len(refs) + 1):
            if h.get("description"):
                refs.append({
                    "id": str(i),
                    "text": (
                        f"AI Discovery Agent ({h.get('model_used', 'multi-model')}). "
                        f"{h.get('title', 'Hypothesis')}. "
                        f"Confidence: {h.get('confidence', 0):.1%}. "
                        f"Humanovo Discovery ID: {h.get('id', 'N/A')}."
                    ),
                })

        return refs

    def paper_to_markdown(self, paper: ResearchPaper) -> str:
        """Convert a research paper to Markdown format."""
        md = []

        # Title
        md.append(f"# {paper.sections.get('title', 'Untitled Research Paper')}\n")
        md.append(f"*Generated by Humanovo Discovery Platform — {paper.created_at.strftime('%Y-%m-%d %H:%M UTC')}*\n")
        md.append("---\n")

        # Abstract
        md.append("## Abstract\n")
        md.append(paper.sections.get("abstract", "") + "\n")

        # Introduction
        intro = paper.sections.get("introduction", "")
        if not intro.startswith("##"):
            md.append("## Introduction\n")
        md.append(intro + "\n")

        # Methods
        methods = paper.sections.get("methods", "")
        if not methods.startswith("##"):
            md.append("## Methods\n")
        md.append(methods + "\n")

        # Results
        results = paper.sections.get("results", "")
        if not results.startswith("##"):
            md.append("## Results\n")
        md.append(results + "\n")

        # Tables
        for table in paper.tables:
            md.append(f"\n### {table['caption']}\n")
            cols = table["columns"]
            md.append("| " + " | ".join(cols) + " |")
            md.append("| " + " | ".join(["---"] * len(cols)) + " |")
            for row in table["rows"]:
                values = [str(row.get(c.lower().replace(" ", "_"), row.get(c.lower(), ""))) for c in cols]
                # Fallback: use row values in order
                if all(v == "" for v in values):
                    values = [str(v) for v in row.values()]
                md.append("| " + " | ".join(values) + " |")
            md.append("")

        # Figures (Mermaid diagrams)
        for fig in paper.figures:
            md.append(f"\n### {fig['caption']}\n")
            if fig["type"].startswith("mermaid"):
                md.append(f"```mermaid\n{fig['content']}\n```\n")
            elif fig["type"] == "bar_chart_data":
                md.append("```mermaid")
                md.append("xychart-beta")
                md.append(f'    title "Confidence Distribution"')
                data = fig["content"]
                md.append(f'    x-axis [{", ".join(f\'"{k}"\' for k in data.keys())}]')
                md.append(f'    bar [{", ".join(str(v) for v in data.values())}]')
                md.append("```\n")

        # External Factors
        ext = paper.sections.get("external_factors_analysis", "")
        if ext:
            md.append(ext + "\n")

        # Discussion
        discussion = paper.sections.get("discussion", "")
        if not discussion.startswith("##"):
            md.append("## Discussion\n")
        md.append(discussion + "\n")

        # Conclusion
        conclusion = paper.sections.get("conclusion", "")
        if not conclusion.startswith("##"):
            md.append("## Conclusion\n")
        md.append(conclusion + "\n")

        # References
        md.append("## References\n")
        for ref in paper.references:
            md.append(f"[{ref['id']}] {ref['text']}\n")

        return "\n".join(md)


# Singleton
_paper_service: Optional[PaperGenerationService] = None


def get_paper_service() -> PaperGenerationService:
    global _paper_service
    if _paper_service is None:
        _paper_service = PaperGenerationService()
    return _paper_service
