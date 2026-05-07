"""
Disease Discovery Service

Advanced LLM-powered service for discovering disease cures and prevention strategies
by connecting billions of data points across the knowledge graph.

Supports three LLM providers:
- Azure AI Foundry (Mistral-Large-3) — critic
- Constant AI — explorer + synthesizer
- Azure OpenAI (legacy)
"""

import asyncio
import json
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional
from uuid import uuid4

from pydantic import BaseModel

from app.core.config import settings
from app.core.logging import LoggerMixin, get_logger

logger = get_logger(__name__)


class DiscoveryType(str, Enum):
    """Type of discovery being sought."""
    CURE = "cure"  # Kept for backward compatibility
    PREVENTION = "prevention"
    TREATMENT = "treatment"  # Primary default
    BIOMARKER = "biomarker"
    DRUG_REPURPOSING = "drug_repurposing"
    COMBINATION_THERAPY = "combination_therapy"


class EvidenceStrength(str, Enum):
    """Strength of supporting evidence."""
    STRONG = "strong"  # Multiple clinical trials, meta-analyses
    MODERATE = "moderate"  # Some clinical evidence, strong preclinical
    WEAK = "weak"  # Preclinical only, computational predictions
    THEORETICAL = "theoretical"  # Based on pathway analysis, no direct evidence


class LLMProvider(str, Enum):
    """Supported LLM providers."""
    AZURE_AI = "azure_ai"   # Azure AI Model Catalog (non-OpenAI) — primary
    BEDROCK = "bedrock"      # AWS Bedrock — fallback
    AZURE = "azure"          # Azure OpenAI — legacy


@dataclass
class PathwayConnection:
    """A connection in the biological pathway."""
    source_entity: str
    source_type: str
    relation: str
    target_entity: str
    target_type: str
    confidence: float
    evidence_count: int
    source_references: list[str] = field(default_factory=list)


@dataclass
class DiscoveryEvidence:
    """Evidence supporting a discovery."""
    id: str
    content: str
    source: str
    source_type: str  # pubmed, clinical_trial, patent, etc.
    relevance_score: float
    publication_date: Optional[str] = None
    citations: int = 0
    metadata: dict[str, Any] = field(default_factory=dict)


class TranslationalPhase(str, Enum):
    """Translational research phase (T0-T5)."""
    T0 = "T0"  # Basic Research
    T1 = "T1"  # Translation to Humans
    T2 = "T2"  # Translation to Patients
    T3 = "T3"  # Translation to Practice
    T4 = "T4"  # Translation to Community
    T5 = "T5"  # Global Impact


TRANSLATIONAL_PHASE_META = {
    "T0": {
        "name": "Basic Research",
        "formal_name": "Basic / Preclinical Research",
        "description": "Laboratory discovery, preclinical research, and animal studies.",
    },
    "T1": {
        "name": "Translation to Humans",
        "formal_name": "First-in-Human Proof of Concept",
        "description": "Taking a lab finding and testing it in humans for the first time (Proof of Concept). Includes Phase 0/1 trials and IND filing.",
    },
    "T2": {
        "name": "Translation to Patients",
        "formal_name": "Clinical Efficacy & Safety",
        "description": "Conducting Phase 2 and 3 clinical trials to establish efficacy and safety guidelines. Includes NDA/BLA submission.",
    },
    "T3": {
        "name": "Translation to Practice",
        "formal_name": "Implementation Research",
        "description": "Moving evidence-based treatments into the general medical community. Includes guideline development, physician training, and health system integration.",
    },
    "T4": {
        "name": "Translation to Community",
        "formal_name": "Population Health Impact",
        "description": "Evaluating the real-world impact and public health outcomes at a population level. Includes health disparities research and cost-effectiveness analysis.",
    },
    "T5": {
        "name": "Global Impact",
        "formal_name": "Global Health Policy & Systemic Change",
        "description": "Transition of interventions into global health policy and systemic change. Includes WHO adoption, LMIC access strategies, and international regulatory harmonization.",
    },
}


class TranslationalPhaseDetail(BaseModel):
    """Detailed plan for a single translational phase."""
    phase: str  # T0, T1, T2, T3, T4, T5
    phase_name: str
    formal_name: str
    description: str

    # Phase-specific content
    objectives: list[str] = []
    key_activities: list[str] = []
    milestones: list[str] = []
    deliverables: list[str] = []

    # Evidence requirements
    evidence_requirements: list[str] = []
    data_sources: list[str] = []

    # Regulatory & compliance
    regulatory_considerations: list[str] = []
    regulatory_milestones: list[str] = []

    # Stakeholders
    key_stakeholders: list[str] = []
    collaborators: list[str] = []

    # Success criteria
    success_criteria: list[str] = []
    go_no_go_gates: list[str] = []

    # Risks & mitigation
    phase_risks: list[str] = []
    mitigation_strategies: list[str] = []

    # Resource estimates
    estimated_duration: str = ""
    resource_requirements: list[str] = []
    estimated_cost_range: str = ""

    # Dependencies
    prerequisites: list[str] = []
    blockers: list[str] = []


class TranslationalRoadmap(BaseModel):
    """Complete bench-to-bedside translational roadmap (T0-T5)."""
    current_phase: str = "T0"  # Where the hypothesis currently stands
    phases: list[TranslationalPhaseDetail] = []
    overall_feasibility_score: float = 0.5  # 0-1
    estimated_total_timeline: str = ""
    critical_path_summary: str = ""
    key_decision_points: list[str] = []
    cross_phase_risks: list[str] = []
    regulatory_pathway_summary: str = ""
    commercialization_potential: str = ""


class DiscoveryResult(BaseModel):
    """Result of a disease discovery analysis."""
    id: str
    disease: str
    discovery_type: DiscoveryType

    # Main discovery
    title: str
    description: str
    mechanism_of_action: str

    # Confidence scoring
    confidence_score: float  # 0-1, overall confidence
    evidence_strength: EvidenceStrength
    novelty_score: float  # 0-1, how novel is this discovery

    # Supporting data
    target_entities: list[dict[str, Any]] = []  # genes, proteins, pathways involved
    drug_candidates: list[dict[str, Any]] = []  # potential drugs/compounds
    pathway_connections: list[dict[str, Any]] = []  # biological pathway connections
    supporting_evidence: list[dict[str, Any]] = []  # research evidence

    # Risk assessment
    potential_risks: list[str] = []
    contraindications: list[str] = []

    # Actionable insights
    next_steps: list[str] = []
    validation_experiments: list[str] = []

    # Translational roadmap (T0-T5 bench-to-bedside)
    translational_roadmap: Optional[TranslationalRoadmap] = None

    # Metadata
    created_at: datetime = datetime.now(timezone.utc)
    llm_provider: str = ""
    model_used: str = ""
    processing_time_ms: float = 0.0

    model_config = {"arbitrary_types_allowed": True}


class BaseLLMClient(ABC):
    """Base class for LLM clients."""

    @abstractmethod
    async def generate(
        self,
        prompt: str,
        system_prompt: str = "",
        max_tokens: int = 4000,
        temperature: float = 0.3,
    ) -> str:
        """Generate a response from the LLM."""
        pass

    @property
    @abstractmethod
    def model_name(self) -> str:
        """Get the model name."""
        pass


def _build_bedrock_invoke_body(model_id: str, prompt: str, system_prompt: str,
                               max_tokens: int, temperature: float) -> dict:
    """Build provider-specific request body for Bedrock InvokeModel API."""
    provider = model_id.split(".")[0]
    if provider == "meta":
        full_prompt = (
            f"<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\n"
            f"{system_prompt}<|eot_id|>"
            f"<|start_header_id|>user<|end_header_id|>\n\n"
            f"{prompt}<|eot_id|>"
            f"<|start_header_id|>assistant<|end_header_id|>\n\n"
        )
        return {"prompt": full_prompt, "max_gen_len": max_tokens, "temperature": temperature, "top_p": 0.9}
    else:
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})
        return {"messages": messages, "max_tokens": max_tokens, "temperature": temperature, "top_p": 0.9}


def _parse_bedrock_invoke_response(model_id: str, response_body: dict) -> str:
    """Parse provider-specific response from Bedrock InvokeModel API."""
    provider = model_id.split(".")[0]
    if provider == "meta" and "generation" in response_body:
        return response_body["generation"]
    if "choices" in response_body:
        choices = response_body["choices"]
        if choices and isinstance(choices, list):
            msg = choices[0].get("message", {})
            if isinstance(msg, dict) and "content" in msg:
                return msg["content"]
            if "text" in choices[0]:
                return choices[0]["text"]
    if "output" in response_body:
        output = response_body["output"]
        if isinstance(output, dict):
            msg = output.get("message", {})
            if isinstance(msg, dict) and "content" in msg:
                content = msg["content"]
                if isinstance(content, list) and content:
                    return content[0].get("text", "")
                if isinstance(content, str):
                    return content
        if isinstance(output, str):
            return output
    for key in ["text", "content", "response", "completion", "generated_text", "result"]:
        if key in response_body and isinstance(response_body[key], str):
            return response_body[key]
    return json.dumps(response_body)


class BedrockLLMClient(BaseLLMClient):
    """AWS Bedrock LLM client using Converse API with InvokeModel fallback.

    Supports Humanovo discovery models via Bedrock:
    - meta.llama4-maverick-17b-instruct-v1:0  (Explorer)
    - openai.gpt-oss-safeguard-120b             (Critic)
    """

    def __init__(self, model_id: str = None):
        self._client = None
        self._model_id = model_id or settings.BEDROCK_MODEL_CLAUDE_OPUS

    async def _get_client(self):
        """Get or create Bedrock client."""
        if self._client is None:
            try:
                import boto3

                self._client = boto3.client(
                    "bedrock-runtime",
                    region_name=settings.AWS_REGION,
                    aws_access_key_id=settings.aws_access_key_value,
                    aws_secret_access_key=settings.aws_secret_key_value,
                )
            except ImportError:
                raise RuntimeError("boto3 not installed. Run: pip install boto3")
        return self._client

    async def generate(
        self,
        prompt: str,
        system_prompt: str = "",
        max_tokens: int = 4000,
        temperature: float = 0.3,
    ) -> str:
        """Generate using Bedrock. Tries Converse API first, falls back to InvokeModel."""
        client = await self._get_client()
        loop = asyncio.get_event_loop()

        # Try Converse API first
        try:
            response = await loop.run_in_executor(
                None,
                lambda: client.converse(
                    modelId=self._model_id,
                    messages=[{"role": "user", "content": [{"text": prompt}]}],
                    system=[{"text": system_prompt}] if system_prompt else [],
                    inferenceConfig={"maxTokens": max_tokens, "temperature": temperature},
                )
            )
            return response["output"]["message"]["content"][0]["text"]
        except Exception as converse_err:
            logger.warning(f"Converse failed for {self._model_id}: {converse_err}, trying InvokeModel")

        # Fallback: InvokeModel
        try:
            body = _build_bedrock_invoke_body(self._model_id, prompt, system_prompt, max_tokens, temperature)
            response = await loop.run_in_executor(
                None,
                lambda: client.invoke_model(
                    modelId=self._model_id,
                    contentType="application/json",
                    accept="application/json",
                    body=json.dumps(body),
                )
            )
            response_body = json.loads(response["body"].read())
            return _parse_bedrock_invoke_response(self._model_id, response_body)
        except Exception as invoke_err:
            raise RuntimeError(f"Both APIs failed for {self._model_id}: {invoke_err}")

    @property
    def model_name(self) -> str:
        return self._model_id


class BedrockMultiModelClient(BaseLLMClient):
    """Multi-model Bedrock client for parallel discovery.

    Uses the Constant AI explorer+synthesizer+reasoner models
    via the Converse API, then synthesizes outputs.
    """

    MODEL_ROLES = {
        "explorer": settings.BEDROCK_MODEL_CLAUDE_OPUS,
        "reasoner": settings.BEDROCK_MODEL_CLAUDE_OPUS,
        "synthesizer": settings.BEDROCK_MODEL_CLAUDE_OPUS,
    }

    def __init__(self):
        self._client = None

    async def _get_client(self):
        if self._client is None:
            try:
                import boto3
                self._client = boto3.client(
                    "bedrock-runtime",
                    region_name=settings.AWS_REGION,
                    aws_access_key_id=settings.aws_access_key_value,
                    aws_secret_access_key=settings.aws_secret_key_value,
                )
            except ImportError:
                raise RuntimeError("boto3 not installed. Run: pip install boto3")
        return self._client

    async def _invoke_single(
        self, model_id: str, prompt: str, system_prompt: str,
        max_tokens: int, temperature: float,
    ) -> str:
        client = await self._get_client()
        loop = asyncio.get_event_loop()

        # Try Converse first
        try:
            response = await loop.run_in_executor(
                None,
                lambda: client.converse(
                    modelId=model_id,
                    messages=[{"role": "user", "content": [{"text": prompt}]}],
                    system=[{"text": system_prompt}] if system_prompt else [],
                    inferenceConfig={"maxTokens": max_tokens, "temperature": temperature},
                )
            )
            return response["output"]["message"]["content"][0]["text"]
        except Exception:
            pass

        # Fallback: InvokeModel
        body = _build_bedrock_invoke_body(model_id, prompt, system_prompt, max_tokens, temperature)
        response = await loop.run_in_executor(
            None,
            lambda: client.invoke_model(
                modelId=model_id,
                contentType="application/json",
                accept="application/json",
                body=json.dumps(body),
            )
        )
        response_body = json.loads(response["body"].read())
        return _parse_bedrock_invoke_response(model_id, response_body)

    async def generate(
        self,
        prompt: str,
        system_prompt: str = "",
        max_tokens: int = 4000,
        temperature: float = 0.3,
    ) -> str:
        """Run all 4 models in parallel and synthesize outputs."""
        tasks = {}
        for role, model_id in self.MODEL_ROLES.items():
            role_system = f"{system_prompt}\n\nYour role: {role.upper()} — focus on your specialty."
            tasks[role] = self._invoke_single(
                model_id, prompt, role_system, max_tokens, temperature,
            )

        results = await asyncio.gather(
            *[asyncio.create_task(coro) for coro in tasks.values()],
            return_exceptions=True,
        )

        # Collect successful responses
        successful = {}
        for (role, _), result in zip(tasks.items(), results):
            if isinstance(result, Exception):
                logger.warning(f"Multi-model {role} failed: {result}")
            else:
                successful[role] = result

        if not successful:
            raise RuntimeError("All Bedrock models failed in multi-model invocation")

        # If only one succeeded, return it directly
        if len(successful) == 1:
            return list(successful.values())[0]

        # Synthesize via Constant AI (200K context)
        joined_outputs = "\n".join(
            f"=== {role.upper()} OUTPUT ===\n{text}" for role, text in successful.items()
        )
        synthesis_prompt = f"""Synthesize these parallel model outputs into a single unified response:

{joined_outputs}

Produce a single, integrated JSON response that combines the best insights from all models.
Resolve contradictions by favoring higher-evidence claims. Note any unresolved disagreements."""

        return await self._invoke_single(
            self.MODEL_ROLES["synthesizer"], synthesis_prompt,
            "You are a synthesis agent integrating outputs from parallel discovery models.",
            max_tokens, temperature,
        )

    @property
    def model_name(self) -> str:
        return "bedrock-multi-model"


class AzureOpenAILLMClient(BaseLLMClient):
    """Azure OpenAI LLM client."""

    def __init__(self):
        self._client = None

    async def _get_client(self):
        if self._client is None:
            if not settings.azure_openai_api_key_value or not settings.AZURE_OPENAI_ENDPOINT:
                raise RuntimeError(
                    "AZURE_OPENAI_API_KEY and AZURE_OPENAI_ENDPOINT are required. "
                    "Set them as environment variables or in .env file."
                )
            try:
                from openai import AsyncAzureOpenAI
                self._client = AsyncAzureOpenAI(
                    api_key=settings.azure_openai_api_key_value,
                    azure_endpoint=settings.AZURE_OPENAI_ENDPOINT,
                    api_version=settings.AZURE_OPENAI_API_VERSION,
                )
            except ImportError:
                raise RuntimeError("openai not installed. Run: pip install openai")
        return self._client

    async def generate(
        self,
        prompt: str,
        system_prompt: str = "",
        max_tokens: int = 4000,
        temperature: float = 0.3,
    ) -> str:
        client = await self._get_client()

        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        response = await client.chat.completions.create(
            model=settings.AZURE_OPENAI_DEPLOYMENT_O3_DEEP_RESEARCH,
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature,
        )

        return response.choices[0].message.content

    @property
    def model_name(self) -> str:
        return f"azure/{settings.AZURE_OPENAI_DEPLOYMENT_O3_DEEP_RESEARCH}"


class AzureAILLMClient(BaseLLMClient):
    """Azure AI client — model-specific endpoints for Mistral.

    Each model has its own endpoint URL + API key (direct, no Foundry layer).
    Defaults to Mistral-Large-3 for single-model calls.
    """

    def __init__(self):
        self._mistral_client = None

    async def _get_mistral_client(self):
        if self._mistral_client is None:
            endpoint = settings.AZURE_MISTRAL_ENDPOINT
            key = settings.azure_mistral_key_value
            if not endpoint or not key:
                raise RuntimeError(
                    "Azure Mistral not configured. Set AZURE_MISTRAL_ENDPOINT and AZURE_MISTRAL_KEY."
                )
            from openai import AsyncOpenAI
            self._mistral_client = AsyncOpenAI(
                base_url=endpoint.rstrip('/'),
                api_key=key,
            )
        return self._mistral_client

    async def generate(
        self,
        prompt: str,
        system_prompt: str = "",
        max_tokens: int = 4000,
        temperature: float = 0.3,
    ) -> str:
        client = await self._get_mistral_client()
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        response = await client.chat.completions.create(
            model=settings.AZURE_MISTRAL_MODEL,
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature,
        )
        return response.choices[0].message.content

    @property
    def model_name(self) -> str:
        return f"azure-model-specific/[{settings.AZURE_MISTRAL_MODEL}]"


def get_llm_client(provider: LLMProvider = None) -> BaseLLMClient:
    """Get LLM client based on provider.

    Three providers supported:
    - 'azure_ai': Azure AI Model Catalog (non-OpenAI serverless) — primary
    - 'bedrock': AWS Bedrock Converse API — fallback
    - 'azure': Azure OpenAI — legacy
    """
    provider = provider or LLMProvider(settings.DISCOVERY_LLM_PROVIDER)

    clients = {
        LLMProvider.AZURE_AI: AzureAILLMClient,
        LLMProvider.BEDROCK: BedrockLLMClient,
        LLMProvider.AZURE: AzureOpenAILLMClient,
    }

    return clients[provider]()


# System prompts for disease discovery
DISCOVERY_SYSTEM_PROMPT = """You are an advanced biomedical AI research system specialized in bench-to-bedside translational discovery.

Your capabilities:
1. Analyze biological pathways connecting genes, proteins, and diseases
2. Identify drug repurposing opportunities and novel therapeutic targets
3. Design complete translational roadmaps from basic research (T0) through global health impact (T5)
4. Assess evidence strength, regulatory pathways, and implementation feasibility
5. Propose validation experiments and clinical trial designs

You generate hypotheses that span the FULL translational spectrum:
- T0 (Basic Research): Lab discovery, preclinical models, target validation
- T1 (Translation to Humans): First-in-human, Phase 0/1, IND filing, PK/PD
- T2 (Translation to Patients): Phase 2/3 trials, NDA/BLA, pivotal studies
- T3 (Translation to Practice): Implementation research, guideline adoption, EHR integration
- T4 (Translation to Community): Real-world evidence, population health, cost-effectiveness
- T5 (Global Impact): Global health policy, WHO adoption, LMIC access, health equity

When analyzing data:
- Consider mechanism of action at molecular level
- Evaluate supporting evidence quality (clinical trials > preclinical > computational)
- Identify potential risks, contraindications, and regulatory hurdles at each phase
- Design realistic timelines and go/no-go decision gates
- Consider health equity, access, and implementation barriers
- Assess commercialization potential and payer landscape

Output format: Always provide structured JSON responses with clear confidence scores (0-1) based on:
- Evidence quantity and quality
- Pathway reliability
- Translational feasibility across all phases
- Regulatory pathway clarity
- Consistency across multiple sources"""


class DiseaseDiscoveryService(LoggerMixin):
    """
    Service for discovering disease cures and prevention strategies.

    Connects billions of data points from:
    - Knowledge graph (genes, proteins, diseases, drugs, pathways)
    - Open biomedical literature (PubMed, EuropePMC, OpenAlex, preprints)
    - Clinical trials registry, patents, drug-target databases

    Uses advanced LLM reasoning to synthesize discoveries with confidence scores.
    """

    def __init__(self, provider: LLMProvider = None):
        self._llm = get_llm_client(provider)
        self._graph_store = None
        self._rag_service = None
        self._initialized = False

    async def initialize(self) -> None:
        """Initialize the discovery service."""
        if self._initialized:
            return

        self.logger.info(
            "Initializing disease discovery service",
            llm_provider=self._llm.model_name,
        )

        # Initialize knowledge graph connection
        try:
            from app.knowledge.graph_store import get_graph_store
            self._graph_store = get_graph_store()
        except RuntimeError:
            self.logger.warning("Graph store not available")

        # Initialize RAG service
        try:
            from app.rag.service import get_rag_service
            self._rag_service = get_rag_service()
        except RuntimeError:
            self.logger.warning("RAG service not available")

        self._initialized = True
        self.logger.info("Disease discovery service initialized")

    async def discover(
        self,
        disease: str,
        discovery_type: DiscoveryType = DiscoveryType.TREATMENT,
        focus_entities: list[str] = None,
        max_results: int = 5,
    ) -> list[DiscoveryResult]:
        """
        Discover potential treatments or strategies for a disease.

        Args:
            disease: Name of the disease to analyze
            discovery_type: Type of discovery (treatment, prevention, biomarker, etc.)
            focus_entities: Optional specific genes/proteins/drugs to focus on
            max_results: Maximum number of discoveries to return

        Returns:
            List of DiscoveryResult objects ranked by confidence
        """
        import time
        start_time = time.time()

        if not self._initialized:
            await self.initialize()

        self.logger.info(
            "Starting disease discovery",
            disease=disease,
            type=discovery_type.value,
            focus_entities=focus_entities,
        )

        # Step 1: Gather evidence from multiple sources
        evidence = await self._gather_evidence(disease, focus_entities)

        # Step 2: Find pathway connections in knowledge graph
        pathways = await self._find_pathways(disease, focus_entities)

        # Step 3: Identify relevant entities (genes, proteins, drugs)
        entities = await self._identify_entities(disease, focus_entities)

        # Step 4: Use LLM to synthesize discoveries
        discoveries = await self._synthesize_discoveries(
            disease=disease,
            discovery_type=discovery_type,
            evidence=evidence,
            pathways=pathways,
            entities=entities,
            max_results=max_results,
        )

        # Step 5: Calculate confidence scores
        scored_discoveries = await self._score_discoveries(discoveries, evidence, pathways)

        # Sort by confidence
        scored_discoveries.sort(key=lambda d: d.confidence_score, reverse=True)

        processing_time = (time.time() - start_time) * 1000

        # Add metadata
        for discovery in scored_discoveries:
            discovery.processing_time_ms = processing_time
            discovery.llm_provider = settings.DISCOVERY_LLM_PROVIDER
            discovery.model_used = self._llm.model_name

        self.logger.info(
            "Discovery complete",
            disease=disease,
            discoveries_found=len(scored_discoveries),
            processing_time_ms=processing_time,
        )

        return scored_discoveries[:max_results]

    async def _gather_evidence(
        self,
        disease: str,
        focus_entities: list[str] = None,
    ) -> list[DiscoveryEvidence]:
        """Gather evidence from RAG and other sources."""
        evidence = []

        # Query RAG service
        if self._rag_service:
            try:
                # Build comprehensive query
                query = f"treatments cures prevention {disease}"
                if focus_entities:
                    query += " " + " ".join(focus_entities)

                rag_result = await self._rag_service.query(query)

                for i, chunk in enumerate(rag_result.context.chunks[:settings.DISCOVERY_MAX_EVIDENCE_CHUNKS]):
                    evidence.append(DiscoveryEvidence(
                        id=f"rag-{i}",
                        content=chunk.content,
                        source=chunk.metadata.get("document_title", "Unknown"),
                        source_type=chunk.source.value,
                        relevance_score=chunk.score,
                        metadata=chunk.metadata,
                    ))
            except Exception as e:
                self.logger.warning("RAG query failed", error=str(e))

        # Web search backends were removed for v1 — discovery now grounds
        # exclusively in the open biomedical sources (PubMed, EuropePMC,
        # OpenAlex, ClinicalTrials.gov, etc.). See SOURCES_ROADMAP.md.

        return evidence

    async def _find_pathways(
        self,
        disease: str,
        focus_entities: list[str] = None,
    ) -> list[PathwayConnection]:
        """Find biological pathway connections in the knowledge graph."""
        pathways = []

        if not self._graph_store:
            return pathways

        try:
            # Search for disease entity
            disease_entities = await self._graph_store.search_entities(
                disease,
                entity_types=["disease", "phenotype", "disorder"],
                limit=5,
            )

            if not disease_entities:
                return pathways

            # Find paths from disease to potential targets
            for disease_entity in disease_entities[:2]:
                # Get neighborhood
                neighborhood = await self._graph_store.get_neighborhood(
                    disease_entity.id,
                    depth=3,
                    limit=settings.DISCOVERY_MAX_GRAPH_PATHS,
                )

                if neighborhood:
                    for relation in neighborhood.relations:
                        pathways.append(PathwayConnection(
                            source_entity=relation.source_name,
                            source_type=relation.source_type,
                            relation=relation.relation_type,
                            target_entity=relation.target_name,
                            target_type=relation.target_type,
                            confidence=relation.confidence,
                            evidence_count=relation.evidence_count,
                            source_references=relation.source_references,
                        ))

            # If focus entities provided, find paths to them
            if focus_entities and disease_entities:
                for entity_name in focus_entities[:5]:
                    target_entities = await self._graph_store.search_entities(
                        entity_name,
                        limit=2,
                    )

                    for target in target_entities:
                        paths = await self._graph_store.find_paths(
                            disease_entities[0].id,
                            target.id,
                            max_length=4,
                            limit=3,
                        )

                        for path in paths:
                            for relation in path.path:
                                pathways.append(PathwayConnection(
                                    source_entity=relation.source_name,
                                    source_type=relation.source_type,
                                    relation=relation.relation_type,
                                    target_entity=relation.target_name,
                                    target_type=relation.target_type,
                                    confidence=relation.confidence,
                                    evidence_count=relation.evidence_count,
                                ))

        except Exception as e:
            self.logger.warning("Pathway search failed", error=str(e))

        return pathways

    async def _identify_entities(
        self,
        disease: str,
        focus_entities: list[str] = None,
    ) -> dict[str, list[dict[str, Any]]]:
        """Identify relevant genes, proteins, and drugs."""
        entities = {
            "genes": [],
            "proteins": [],
            "drugs": [],
            "pathways": [],
            "targets": [],
        }

        if not self._graph_store:
            return entities

        try:
            # Search for related genes
            genes = await self._graph_store.search_entities(
                disease,
                entity_types=["gene"],
                limit=20,
            )
            entities["genes"] = [{"name": g.name, "id": g.id, "description": g.description} for g in genes]

            # Search for related proteins
            proteins = await self._graph_store.search_entities(
                disease,
                entity_types=["protein"],
                limit=20,
            )
            entities["proteins"] = [{"name": p.name, "id": p.id, "description": p.description} for p in proteins]

            # Search for potential drugs
            drugs = await self._graph_store.search_entities(
                disease,
                entity_types=["drug", "compound", "chemical"],
                limit=20,
            )
            entities["drugs"] = [{"name": d.name, "id": d.id, "description": d.description} for d in drugs]

            # Add focus entities
            if focus_entities:
                for entity_name in focus_entities:
                    results = await self._graph_store.search_entities(entity_name, limit=3)
                    for r in results:
                        entities["targets"].append({
                            "name": r.name,
                            "id": r.id,
                            "type": r.entity_type,
                            "description": r.description,
                        })

        except Exception as e:
            self.logger.warning("Entity search failed", error=str(e))

        return entities

    async def _synthesize_discoveries(
        self,
        disease: str,
        discovery_type: DiscoveryType,
        evidence: list[DiscoveryEvidence],
        pathways: list[PathwayConnection],
        entities: dict[str, list[dict[str, Any]]],
        max_results: int = 5,
    ) -> list[DiscoveryResult]:
        """Use LLM to synthesize discoveries from gathered data."""

        # Prepare evidence summary
        evidence_text = "\n".join([
            f"- [{e.source_type}] {e.content[:300]}... (relevance: {e.relevance_score:.2f})"
            for e in evidence[:20]
        ])

        # Prepare pathway summary
        pathway_text = "\n".join([
            f"- {p.source_entity} ({p.source_type}) --[{p.relation}]--> {p.target_entity} ({p.target_type}) [confidence: {p.confidence:.2f}]"
            for p in pathways[:30]
        ])

        # Prepare entity summary
        entity_text = json.dumps({
            "genes": [g["name"] for g in entities.get("genes", [])[:10]],
            "proteins": [p["name"] for p in entities.get("proteins", [])[:10]],
            "drugs": [d["name"] for d in entities.get("drugs", [])[:10]],
            "targets": [t["name"] for t in entities.get("targets", [])[:5]],
        }, indent=2)

        prompt = f"""Analyze the following data about {disease} and identify {max_results} potential {discovery_type.value} strategies.
Each strategy MUST include a complete bench-to-bedside translational roadmap spanning T0 through T5.

## Disease: {disease}
## Discovery Type: {discovery_type.value}

## Research Evidence:
{evidence_text if evidence_text else "No direct evidence available."}

## Biological Pathway Connections:
{pathway_text if pathway_text else "No pathway data available."}

## Related Entities:
{entity_text}

## Your Task:
Based on the above data, identify the {max_results} most promising {discovery_type.value} strategies for {disease}.

For each discovery, provide a JSON object with:
1. "title": Brief title for the discovery
2. "description": Detailed description (2-3 sentences)
3. "mechanism_of_action": How this would work at molecular level
4. "confidence_score": Your confidence (0.0-1.0) based on evidence strength
5. "evidence_strength": "strong", "moderate", "weak", or "theoretical"
6. "novelty_score": How novel is this (0.0-1.0)
7. "target_entities": List of genes/proteins involved
8. "drug_candidates": Potential drugs/compounds (if applicable)
9. "potential_risks": List of potential risks/side effects
10. "contraindications": Who should not receive this treatment
11. "next_steps": Actionable research steps
12. "validation_experiments": Experiments to validate this discovery
13. "translational_roadmap": A complete bench-to-bedside roadmap object with the structure below

## TRANSLATIONAL ROADMAP STRUCTURE (REQUIRED for each discovery):
The "translational_roadmap" must contain:
- "current_phase": Which phase (T0-T5) this discovery is currently at
- "overall_feasibility_score": 0.0-1.0
- "estimated_total_timeline": e.g. "8-12 years"
- "critical_path_summary": 1-2 sentence summary of the critical path
- "key_decision_points": List of key go/no-go decision points
- "cross_phase_risks": Risks that span multiple phases
- "regulatory_pathway_summary": Summary of the regulatory strategy (e.g., 505(b)(2), BLA, breakthrough therapy designation)
- "commercialization_potential": Assessment of market potential
- "phases": An array of 6 phase objects (T0 through T5), each containing:
  - "phase": "T0", "T1", "T2", "T3", "T4", or "T5"
  - "phase_name": e.g., "Basic Research"
  - "formal_name": e.g., "Basic / Preclinical Research"
  - "objectives": 3-5 specific objectives for this phase
  - "key_activities": 4-6 concrete activities (experiments, trials, analyses)
  - "milestones": 3-5 measurable milestones
  - "deliverables": 2-4 tangible outputs
  - "evidence_requirements": What evidence is needed (data types, study designs)
  - "data_sources": Databases, registries, trial systems to leverage
  - "regulatory_considerations": Phase-specific regulatory requirements (IND, NDA, IRB, etc.)
  - "regulatory_milestones": Specific regulatory filings and approvals
  - "key_stakeholders": Who is involved (bench scientists, clinicians, FDA, payers, etc.)
  - "collaborators": Specific types of collaborators needed
  - "success_criteria": Measurable criteria to advance to next phase
  - "go_no_go_gates": Decision gates before proceeding
  - "phase_risks": Risks specific to this phase
  - "mitigation_strategies": How to mitigate each risk
  - "estimated_duration": e.g., "2-3 years"
  - "resource_requirements": What resources are needed
  - "estimated_cost_range": e.g., "$2-5M"
  - "prerequisites": What must be completed before this phase
  - "blockers": Potential blockers

### Phase definitions:
- T0 (Basic Research): Laboratory discovery, preclinical research, animal studies, target validation, lead compound identification
- T1 (Translation to Humans): First-in-human proof of concept, Phase 0/1 trials, IND filing, PK/PD studies, dose-finding
- T2 (Translation to Patients): Phase 2/3 clinical trials, efficacy/safety establishment, NDA/BLA submission, pivotal trial design
- T3 (Translation to Practice): Implementation research, clinical guideline development, physician training, EHR integration, formulary adoption
- T4 (Translation to Community): Real-world evidence, population health outcomes, health disparities assessment, cost-effectiveness, post-marketing surveillance
- T5 (Global Impact): Global health policy, WHO Essential Medicines consideration, LMIC access, international regulatory harmonization, pandemic/endemic preparedness

Return a JSON array of {max_results} discovery objects.
"""

        try:
            response = await self._llm.generate(
                prompt=prompt,
                system_prompt=DISCOVERY_SYSTEM_PROMPT,
                max_tokens=4000,
                temperature=0.3,
            )

            # Parse JSON response
            discoveries = self._parse_llm_discoveries(response, disease, discovery_type)

            # Add supporting evidence and pathways
            for discovery in discoveries:
                discovery.supporting_evidence = [
                    {"id": e.id, "content": e.content[:200], "source": e.source, "score": e.relevance_score}
                    for e in evidence[:10]
                ]
                discovery.pathway_connections = [
                    {"source": p.source_entity, "relation": p.relation, "target": p.target_entity, "confidence": p.confidence}
                    for p in pathways[:10]
                ]

            return discoveries

        except Exception as e:
            self.logger.error("LLM synthesis failed", error=str(e))
            return []

    def _parse_llm_discoveries(
        self,
        response: str,
        disease: str,
        discovery_type: DiscoveryType,
    ) -> list[DiscoveryResult]:
        """Parse LLM response into DiscoveryResult objects."""
        discoveries = []

        try:
            # Extract JSON from response
            response = response.strip()
            if response.startswith("```json"):
                response = response[7:]
            if response.startswith("```"):
                response = response[3:]
            if response.endswith("```"):
                response = response[:-3]

            data = json.loads(response)

            if not isinstance(data, list):
                data = [data]

            for item in data:
                try:
                    # Parse translational roadmap if present
                    translational_roadmap = None
                    roadmap_data = item.get("translational_roadmap")
                    if roadmap_data and isinstance(roadmap_data, dict):
                        translational_roadmap = self._parse_translational_roadmap(roadmap_data)

                    discoveries.append(DiscoveryResult(
                        id=str(uuid4()),
                        disease=disease,
                        discovery_type=discovery_type,
                        title=item.get("title", "Untitled Discovery"),
                        description=item.get("description", ""),
                        mechanism_of_action=item.get("mechanism_of_action", ""),
                        confidence_score=float(item.get("confidence_score", 0.5)),
                        evidence_strength=EvidenceStrength(item.get("evidence_strength", "moderate")),
                        novelty_score=float(item.get("novelty_score", 0.5)),
                        target_entities=[{"name": e} if isinstance(e, str) else e for e in item.get("target_entities", [])],
                        drug_candidates=[{"name": d} if isinstance(d, str) else d for d in item.get("drug_candidates", [])],
                        potential_risks=item.get("potential_risks", []),
                        contraindications=item.get("contraindications", []),
                        next_steps=item.get("next_steps", []),
                        validation_experiments=item.get("validation_experiments", []),
                        translational_roadmap=translational_roadmap,
                    ))
                except Exception as e:
                    self.logger.warning("Failed to parse discovery item", error=str(e))
                    continue

        except json.JSONDecodeError as e:
            self.logger.warning("Failed to parse LLM JSON response", error=str(e))

            # Fallback: create a single discovery from the raw response
            discoveries.append(DiscoveryResult(
                id=str(uuid4()),
                disease=disease,
                discovery_type=discovery_type,
                title=f"Analysis for {disease}",
                description=response[:500],
                mechanism_of_action="See description",
                confidence_score=0.3,
                evidence_strength=EvidenceStrength.THEORETICAL,
                novelty_score=0.5,
            ))

        return discoveries

    def _parse_translational_roadmap(self, data: dict) -> TranslationalRoadmap:
        """Parse a translational roadmap from LLM JSON output."""
        phases = []
        for phase_data in data.get("phases", []):
            if not isinstance(phase_data, dict):
                continue
            phase_id = phase_data.get("phase", "T0")
            meta = TRANSLATIONAL_PHASE_META.get(phase_id, {})
            phases.append(TranslationalPhaseDetail(
                phase=phase_id,
                phase_name=phase_data.get("phase_name", meta.get("name", phase_id)),
                formal_name=phase_data.get("formal_name", meta.get("formal_name", "")),
                description=phase_data.get("description", meta.get("description", "")),
                objectives=self._ensure_list(phase_data.get("objectives")),
                key_activities=self._ensure_list(phase_data.get("key_activities")),
                milestones=self._ensure_list(phase_data.get("milestones")),
                deliverables=self._ensure_list(phase_data.get("deliverables")),
                evidence_requirements=self._ensure_list(phase_data.get("evidence_requirements")),
                data_sources=self._ensure_list(phase_data.get("data_sources")),
                regulatory_considerations=self._ensure_list(phase_data.get("regulatory_considerations")),
                regulatory_milestones=self._ensure_list(phase_data.get("regulatory_milestones")),
                key_stakeholders=self._ensure_list(phase_data.get("key_stakeholders")),
                collaborators=self._ensure_list(phase_data.get("collaborators")),
                success_criteria=self._ensure_list(phase_data.get("success_criteria")),
                go_no_go_gates=self._ensure_list(phase_data.get("go_no_go_gates")),
                phase_risks=self._ensure_list(phase_data.get("phase_risks")),
                mitigation_strategies=self._ensure_list(phase_data.get("mitigation_strategies")),
                estimated_duration=phase_data.get("estimated_duration", ""),
                resource_requirements=self._ensure_list(phase_data.get("resource_requirements")),
                estimated_cost_range=phase_data.get("estimated_cost_range", ""),
                prerequisites=self._ensure_list(phase_data.get("prerequisites")),
                blockers=self._ensure_list(phase_data.get("blockers")),
            ))

        # Ensure all 6 phases exist (fill gaps with defaults)
        existing_phases = {p.phase for p in phases}
        for phase_id in ["T0", "T1", "T2", "T3", "T4", "T5"]:
            if phase_id not in existing_phases:
                meta = TRANSLATIONAL_PHASE_META[phase_id]
                phases.append(TranslationalPhaseDetail(
                    phase=phase_id,
                    phase_name=meta["name"],
                    formal_name=meta["formal_name"],
                    description=meta["description"],
                ))
        phases.sort(key=lambda p: p.phase)

        return TranslationalRoadmap(
            current_phase=data.get("current_phase", "T0"),
            phases=phases,
            overall_feasibility_score=float(data.get("overall_feasibility_score", 0.5)),
            estimated_total_timeline=data.get("estimated_total_timeline", ""),
            critical_path_summary=data.get("critical_path_summary", ""),
            key_decision_points=self._ensure_list(data.get("key_decision_points")),
            cross_phase_risks=self._ensure_list(data.get("cross_phase_risks")),
            regulatory_pathway_summary=data.get("regulatory_pathway_summary", ""),
            commercialization_potential=data.get("commercialization_potential", ""),
        )

    @staticmethod
    def _ensure_list(val) -> list[str]:
        """Safely convert a value to a list of strings."""
        if val is None:
            return []
        if isinstance(val, list):
            return [str(v) for v in val]
        if isinstance(val, str):
            return [val]
        return []

    async def _score_discoveries(
        self,
        discoveries: list[DiscoveryResult],
        evidence: list[DiscoveryEvidence],
        pathways: list[PathwayConnection],
    ) -> list[DiscoveryResult]:
        """Refine confidence scores based on evidence and pathway alignment."""

        for discovery in discoveries:
            # Base score from LLM
            base_score = discovery.confidence_score

            # Evidence boost: more relevant evidence = higher confidence
            evidence_boost = 0
            for e in evidence:
                # Check if evidence mentions any target entities
                content_lower = e.content.lower()
                for target in discovery.target_entities:
                    if target.get("name", "").lower() in content_lower:
                        evidence_boost += e.relevance_score * 0.05

            # Pathway boost: more pathway connections = higher confidence
            pathway_boost = 0
            for p in pathways:
                for target in discovery.target_entities:
                    target_name = target.get("name", "").lower()
                    if target_name in p.source_entity.lower() or target_name in p.target_entity.lower():
                        pathway_boost += p.confidence * 0.03

            # Drug candidate boost: existing drugs = higher confidence
            drug_boost = len(discovery.drug_candidates) * 0.02

            # Calculate final score
            final_score = min(1.0, base_score + evidence_boost + pathway_boost + drug_boost)
            discovery.confidence_score = round(final_score, 3)

            # Adjust evidence strength based on final score
            if final_score >= 0.8:
                discovery.evidence_strength = EvidenceStrength.STRONG
            elif final_score >= 0.6:
                discovery.evidence_strength = EvidenceStrength.MODERATE
            elif final_score >= 0.4:
                discovery.evidence_strength = EvidenceStrength.WEAK
            else:
                discovery.evidence_strength = EvidenceStrength.THEORETICAL

        return discoveries

    async def explain_discovery(
        self,
        discovery: DiscoveryResult,
        detail_level: str = "comprehensive",
    ) -> str:
        """Generate a detailed explanation of a discovery."""

        prompt = f"""Provide a {detail_level} explanation of this disease discovery:

Disease: {discovery.disease}
Discovery Type: {discovery.discovery_type.value}
Title: {discovery.title}
Description: {discovery.description}
Mechanism: {discovery.mechanism_of_action}
Confidence: {discovery.confidence_score:.1%}
Evidence Strength: {discovery.evidence_strength.value}

Target Entities: {json.dumps(discovery.target_entities)}
Drug Candidates: {json.dumps(discovery.drug_candidates)}
Pathway Connections: {json.dumps(discovery.pathway_connections[:5])}

Please explain:
1. Why this discovery is significant
2. The biological rationale behind the mechanism
3. Current state of research in this area
4. Potential challenges and limitations
5. Recommended next steps for validation
"""

        response = await self._llm.generate(
            prompt=prompt,
            system_prompt="You are a biomedical expert explaining research discoveries to fellow scientists.",
            max_tokens=2000,
            temperature=0.5,
        )

        return response

    async def compare_discoveries(
        self,
        discoveries: list[DiscoveryResult],
    ) -> dict[str, Any]:
        """Compare multiple discoveries and provide recommendations."""

        discovery_summaries = "\n\n".join([
            f"## Discovery {i+1}: {d.title}\n"
            f"Confidence: {d.confidence_score:.1%}\n"
            f"Evidence: {d.evidence_strength.value}\n"
            f"Description: {d.description}"
            for i, d in enumerate(discoveries)
        ])

        prompt = f"""Compare these {len(discoveries)} potential discoveries and provide recommendations:

{discovery_summaries}

Please provide:
1. Ranking of discoveries by overall promise
2. Key differentiators between approaches
3. Potential for combination strategies
4. Resource requirements for each
5. Timeline estimates for validation
6. Final recommendation

Return as structured JSON with keys: ranking, differentiators, combinations, resources, timelines, recommendation
"""

        response = await self._llm.generate(
            prompt=prompt,
            system_prompt="You are a biomedical research advisor helping prioritize drug discovery efforts.",
            max_tokens=2000,
            temperature=0.3,
        )

        try:
            # Parse JSON response
            response = response.strip()
            if response.startswith("```"):
                response = response.split("```")[1]
                if response.startswith("json"):
                    response = response[4:]
            return json.loads(response)
        except:
            return {"raw_analysis": response}


# Global service instance
_discovery_service: Optional[DiseaseDiscoveryService] = None


async def init_discovery_service(provider: LLMProvider = None) -> None:
    """Initialize the global discovery service."""
    global _discovery_service
    _discovery_service = DiseaseDiscoveryService(provider)
    await _discovery_service.initialize()


def get_discovery_service() -> DiseaseDiscoveryService:
    """Get the global discovery service instance."""
    if _discovery_service is None:
        raise RuntimeError("Discovery service not initialized")
    return _discovery_service


async def discover_cures(
    disease: str,
    discovery_type: DiscoveryType = DiscoveryType.CURE,
    focus_entities: list[str] = None,
    max_results: int = 5,
) -> list[DiscoveryResult]:
    """Convenience function to discover cures for a disease."""
    service = get_discovery_service()
    return await service.discover(
        disease=disease,
        discovery_type=discovery_type,
        focus_entities=focus_entities,
        max_results=max_results,
    )
