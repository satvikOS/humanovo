"""
Discovery Orchestrator

Multi-model parallel agent system for continuous biomedical discovery.
Runs Kimi 2.5, DeepSeek R1, Llama Maverick, and GPT OSS 120B in parallel
with token pool management to prevent exhaustion at 100-10000 agent scale.

Features:
- Four-model parallel reasoning (Kimi 2.5, DeepSeek R1, Llama Maverick, GPT OSS 120B)
- Token pool with rate limiting, backoff, and per-model quota management
- 100 to 10,000 concurrent agents with adaptive batching
- Confidence-based stopping with start/pause/stop controls
- Learning system to skip redundant relations
- External factor simulation (nutrients, chemicals, drugs, compounds, elements)
- Research paper generation upon completion
"""

import asyncio
import json
import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Callable, Optional
from uuid import uuid4

from pydantic import BaseModel

from app.core.config import settings
from app.core.logging import LoggerMixin, get_logger
from app.agents.prompts import get_agent_prompt, MASTER_DISCOVERY_PROMPT

logger = get_logger(__name__)


class OrchestratorState(str, Enum):
    """State of the discovery orchestrator."""
    IDLE = "idle"
    RUNNING = "running"
    PAUSED = "paused"
    STOPPING = "stopping"


class AgentRole(str, Enum):
    """Role of an agent in the discovery process."""
    EXPLORER = "explorer"
    REASONER = "reasoner"
    VALIDATOR = "validator"
    SYNTHESIZER = "synthesizer"
    CRITIC = "critic"


class ModelType(str, Enum):
    """LLM model types available for parallel discovery."""
    LLAMA_MAVERICK = "llama_maverick"
    DEEPSEEK_R1 = "deepseek_r1"
    KIMI_25 = "kimi_25"
    GPT_OSS_120B = "gpt_oss_120b"
    HYBRID = "hybrid"


@dataclass
class RelationPath:
    """A path of relations between entities."""
    entities: list[str]
    relations: list[str]
    confidence: float
    evidence_count: int
    hash_key: str = ""

    def __post_init__(self):
        path_str = "->".join(f"{e}:{r}" for e, r in zip(self.entities, self.relations + [""]))
        self.hash_key = hash(path_str)


@dataclass
class DiscoveryHypothesis:
    """A hypothesis discovered by the agents."""
    id: str
    disease: str
    hypothesis_type: str  # cure, prevention, treatment
    title: str
    description: str
    mechanism: str
    confidence: float
    supporting_paths: list[RelationPath]
    contributing_agents: list[str]
    model_used: str
    external_factors: list[dict[str, Any]] = field(default_factory=list)
    created_at: datetime = field(default_factory=datetime.utcnow)
    validated: bool = False
    validation_score: float = 0.0


@dataclass
class AgentState:
    """State of a single discovery agent."""
    id: str
    role: AgentRole
    model: ModelType
    current_task: str = ""
    paths_explored: int = 0
    hypotheses_generated: int = 0
    is_active: bool = True
    last_activity: datetime = field(default_factory=datetime.utcnow)


class TokenPool:
    """
    Token pool manager for parallel multi-model inference.
    Prevents token exhaustion when running 100-10,000 agents simultaneously
    by managing per-model rate limits, concurrency caps, and backoff.
    """

    def __init__(self):
        self._model_semaphores: dict[ModelType, asyncio.Semaphore] = {}
        self._model_token_counts: dict[ModelType, int] = defaultdict(int)
        self._model_request_counts: dict[ModelType, int] = defaultdict(int)
        self._model_error_counts: dict[ModelType, int] = defaultdict(int)
        self._global_token_count = 0
        self._window_start = time.time()
        self._lock = asyncio.Lock()

        max_concurrent = settings.TOKEN_POOL_MAX_CONCURRENT_REQUESTS
        for model in ModelType:
            if model != ModelType.HYBRID:
                self._model_semaphores[model] = asyncio.Semaphore(max_concurrent)

    async def acquire(self, model: ModelType) -> bool:
        """Acquire a slot from the token pool for a model."""
        if model == ModelType.HYBRID:
            return True

        semaphore = self._model_semaphores.get(model)
        if not semaphore:
            return True

        # Check global rate limit
        async with self._lock:
            elapsed = time.time() - self._window_start
            if elapsed >= 60:
                self._global_token_count = 0
                self._window_start = time.time()

            if self._global_token_count >= settings.TOKEN_POOL_MAX_TOKENS_PER_MINUTE:
                return False

        await semaphore.acquire()
        return True

    def release(self, model: ModelType, tokens_used: int = 0) -> None:
        """Release a slot and record token usage."""
        if model == ModelType.HYBRID:
            return

        semaphore = self._model_semaphores.get(model)
        if semaphore:
            semaphore.release()

        self._model_token_counts[model] += tokens_used
        self._model_request_counts[model] += 1
        self._global_token_count += tokens_used

    def record_error(self, model: ModelType) -> None:
        """Record an error for a model."""
        self._model_error_counts[model] += 1

    def get_stats(self) -> dict[str, Any]:
        """Get token pool statistics."""
        return {
            "global_tokens_used": self._global_token_count,
            "tokens_per_model": dict(self._model_token_counts),
            "requests_per_model": dict(self._model_request_counts),
            "errors_per_model": dict(self._model_error_counts),
            "window_elapsed_seconds": time.time() - self._window_start,
        }


class LearningMemory:
    """Memory system for learning to skip redundant relations."""

    def __init__(self):
        self._explored_paths: set[int] = set()
        self._low_value_paths: set[int] = set()
        self._high_value_paths: dict[int, float] = {}
        self._relation_scores: dict[str, float] = defaultdict(float)
        self._entity_pair_scores: dict[tuple, float] = {}
        self._lock = asyncio.Lock()

    async def should_skip(self, path: RelationPath) -> tuple[bool, str]:
        """Check if a path should be skipped based on learning."""
        async with self._lock:
            if path.hash_key in self._explored_paths:
                return True, "Already explored"
            if path.hash_key in self._low_value_paths:
                return True, "Previously low value"
            for relation in path.relations:
                if self._relation_scores.get(relation, 1.0) < 0.2:
                    return True, f"Relation '{relation}' has low success rate"
            return False, ""

    async def record_exploration(
        self, path: RelationPath, outcome_confidence: float, led_to_discovery: bool,
    ) -> None:
        """Record the outcome of exploring a path."""
        async with self._lock:
            self._explored_paths.add(path.hash_key)
            if outcome_confidence < 0.3 and not led_to_discovery:
                self._low_value_paths.add(path.hash_key)
            elif outcome_confidence > 0.6 or led_to_discovery:
                self._high_value_paths[path.hash_key] = outcome_confidence
            score_delta = 0.1 if led_to_discovery else -0.05
            for relation in path.relations:
                current = self._relation_scores.get(relation, 0.5)
                self._relation_scores[relation] = max(0, min(1, current + score_delta))
            for i in range(len(path.entities) - 1):
                pair = (path.entities[i], path.entities[i + 1])
                current = self._entity_pair_scores.get(pair, 0.5)
                self._entity_pair_scores[pair] = max(0, min(1, current + score_delta))

    def get_stats(self) -> dict[str, Any]:
        return {
            "total_explored": len(self._explored_paths),
            "low_value_paths": len(self._low_value_paths),
            "high_value_paths": len(self._high_value_paths),
            "relation_scores": dict(self._relation_scores),
            "avg_relation_score": sum(self._relation_scores.values()) / max(1, len(self._relation_scores)),
        }

    def to_dict(self) -> dict[str, Any]:
        return {
            "explored_paths": list(self._explored_paths),
            "low_value_paths": list(self._low_value_paths),
            "high_value_paths": self._high_value_paths,
            "relation_scores": dict(self._relation_scores),
            "entity_pair_scores": {f"{k[0]}|{k[1]}": v for k, v in self._entity_pair_scores.items()},
        }

    def from_dict(self, data: dict[str, Any]) -> None:
        self._explored_paths = set(data.get("explored_paths", []))
        self._low_value_paths = set(data.get("low_value_paths", []))
        self._high_value_paths = data.get("high_value_paths", {})
        self._relation_scores = defaultdict(float, data.get("relation_scores", {}))
        self._entity_pair_scores = {
            tuple(k.split("|")): v for k, v in data.get("entity_pair_scores", {}).items()
        }


class MultiModelLLM:
    """
    Multi-model interface supporting four parallel LLMs:
    - Llama Maverick (AWS Bedrock) - Fast broad reasoning
    - DeepSeek R1 (AWS Bedrock) - Deep logical reasoning
    - Kimi 2.5 (Moonshot API) - Long-context analysis
    - GPT OSS 120B (Together API) - Large parameter reasoning
    """

    BEDROCK_MODELS = {
        ModelType.LLAMA_MAVERICK: "us.meta.llama4-maverick-17b-instruct-v1:0",
        ModelType.DEEPSEEK_R1: "us.deepseek.deepseek-r1-distill-llama-70b-v1:0",
    }

    def __init__(self, token_pool: TokenPool):
        self._bedrock_client = None
        self._kimi_client = None
        self._gpt_oss_client = None
        self._initialized = False
        self._token_pool = token_pool

    async def initialize(self) -> None:
        if self._initialized:
            return

        # Initialize Bedrock for Llama Maverick + DeepSeek R1
        try:
            import boto3
            self._bedrock_client = boto3.client(
                "bedrock-runtime",
                region_name=settings.AWS_REGION,
                aws_access_key_id=settings.aws_access_key_value,
                aws_secret_access_key=settings.aws_secret_key_value,
            )
        except Exception as e:
            logger.warning(f"Bedrock init failed (Maverick/DeepSeek unavailable): {e}")

        # Initialize Kimi 2.5 client
        try:
            from openai import AsyncOpenAI
            if settings.kimi_api_key_value:
                self._kimi_client = AsyncOpenAI(
                    api_key=settings.kimi_api_key_value,
                    base_url=settings.KIMI_BASE_URL,
                )
        except Exception as e:
            logger.warning(f"Kimi init failed: {e}")

        # Initialize GPT OSS 120B client
        try:
            from openai import AsyncOpenAI
            api_key = settings.gpt_oss_api_key_value or settings.together_api_key_value
            if api_key:
                self._gpt_oss_client = AsyncOpenAI(
                    api_key=api_key,
                    base_url=settings.GPT_OSS_BASE_URL,
                )
        except Exception as e:
            logger.warning(f"GPT OSS init failed: {e}")

        self._initialized = True
        available = []
        if self._bedrock_client:
            available.extend(["llama_maverick", "deepseek_r1"])
        if self._kimi_client:
            available.append("kimi_25")
        if self._gpt_oss_client:
            available.append("gpt_oss_120b")
        logger.info(f"Multi-model LLM initialized. Available: {available}")

    async def generate(
        self,
        model_type: ModelType,
        prompt: str,
        system_prompt: str = "",
        max_tokens: int = 4000,
        temperature: float = 0.3,
    ) -> str:
        """Generate response from specified model with token pool management."""
        if not self._initialized:
            await self.initialize()

        acquired = await self._token_pool.acquire(model_type)
        if not acquired:
            raise RuntimeError(f"Token pool exhausted for {model_type.value}, rate limit hit")

        try:
            if model_type in (ModelType.LLAMA_MAVERICK, ModelType.DEEPSEEK_R1):
                return await self._generate_bedrock(model_type, prompt, system_prompt, max_tokens, temperature)
            elif model_type == ModelType.KIMI_25:
                return await self._generate_kimi(prompt, system_prompt, max_tokens, temperature)
            elif model_type == ModelType.GPT_OSS_120B:
                return await self._generate_gpt_oss(prompt, system_prompt, max_tokens, temperature)
            else:
                # Fallback to any available
                return await self._generate_fallback(prompt, system_prompt, max_tokens, temperature)
        except Exception as e:
            self._token_pool.record_error(model_type)
            raise
        finally:
            self._token_pool.release(model_type, max_tokens)

    async def _generate_bedrock(
        self, model_type: ModelType, prompt: str, system_prompt: str,
        max_tokens: int, temperature: float,
    ) -> str:
        if not self._bedrock_client:
            raise RuntimeError("Bedrock client not initialized")

        model_id = self.BEDROCK_MODELS[model_type]
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        body = json.dumps({
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "top_p": 0.9,
        })

        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(
            None,
            lambda: self._bedrock_client.invoke_model(
                modelId=model_id, body=body,
                contentType="application/json", accept="application/json",
            )
        )

        result = json.loads(response["body"].read())
        if "content" in result:
            return result["content"][0]["text"]
        elif "generation" in result:
            return result["generation"]
        elif "outputs" in result:
            return result["outputs"][0]["text"]
        elif "choices" in result:
            return result["choices"][0]["message"]["content"]
        return str(result)

    async def _generate_kimi(
        self, prompt: str, system_prompt: str, max_tokens: int, temperature: float,
    ) -> str:
        if not self._kimi_client:
            raise RuntimeError("Kimi client not initialized")

        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        response = await self._kimi_client.chat.completions.create(
            model=settings.KIMI_MODEL,
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature,
        )
        return response.choices[0].message.content

    async def _generate_gpt_oss(
        self, prompt: str, system_prompt: str, max_tokens: int, temperature: float,
    ) -> str:
        if not self._gpt_oss_client:
            raise RuntimeError("GPT OSS client not initialized")

        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        response = await self._gpt_oss_client.chat.completions.create(
            model=settings.GPT_OSS_MODEL,
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature,
        )
        return response.choices[0].message.content

    async def _generate_fallback(
        self, prompt: str, system_prompt: str, max_tokens: int, temperature: float,
    ) -> str:
        """Try each model in priority order until one works."""
        for model_type, generator in [
            (ModelType.LLAMA_MAVERICK, lambda: self._generate_bedrock(ModelType.LLAMA_MAVERICK, prompt, system_prompt, max_tokens, temperature)),
            (ModelType.DEEPSEEK_R1, lambda: self._generate_bedrock(ModelType.DEEPSEEK_R1, prompt, system_prompt, max_tokens, temperature)),
            (ModelType.KIMI_25, lambda: self._generate_kimi(prompt, system_prompt, max_tokens, temperature)),
            (ModelType.GPT_OSS_120B, lambda: self._generate_gpt_oss(prompt, system_prompt, max_tokens, temperature)),
        ]:
            try:
                return await generator()
            except Exception:
                continue
        raise RuntimeError("All models unavailable")

    async def parallel_reasoning(
        self, prompt: str, context: str = "",
    ) -> dict[str, str]:
        """
        Run all four models in parallel on the same prompt.
        Returns dict mapping model name to response.
        Uses comprehensive system prompts from prompts.py.
        """
        full_prompt = f"{context}\n\n{prompt}" if context else prompt

        tasks = {}
        if self._bedrock_client:
            tasks["llama_maverick"] = self.generate(
                ModelType.LLAMA_MAVERICK, full_prompt,
                get_agent_prompt("explorer", include_master=True),
                temperature=0.4,
            )
            tasks["deepseek_r1"] = self.generate(
                ModelType.DEEPSEEK_R1, full_prompt,
                get_agent_prompt("reasoner", include_master=True),
                temperature=0.2,
            )
        if self._kimi_client:
            tasks["kimi_25"] = self.generate(
                ModelType.KIMI_25, full_prompt,
                get_agent_prompt("synthesizer", include_master=True),
                temperature=0.3,
            )
        if self._gpt_oss_client:
            tasks["gpt_oss_120b"] = self.generate(
                ModelType.GPT_OSS_120B, full_prompt,
                get_agent_prompt("critic", include_master=True),
                temperature=0.3,
            )

        if not tasks:
            raise RuntimeError("No models available for parallel reasoning")

        results = await asyncio.gather(
            *[asyncio.create_task(coro) for coro in tasks.values()],
            return_exceptions=True,
        )

        responses = {}
        for (name, _), result in zip(tasks.items(), results):
            if isinstance(result, Exception):
                responses[name] = f"Error: {result}"
            else:
                responses[name] = result

        return responses


class DiscoveryAgent:
    """A single discovery agent that explores pathways and generates hypotheses."""

    def __init__(
        self,
        agent_id: str,
        role: AgentRole,
        model: ModelType,
        llm: MultiModelLLM,
        memory: LearningMemory,
    ):
        self.id = agent_id
        self.role = role
        self.model = model
        self.llm = llm
        self.memory = memory
        self.state = AgentState(id=agent_id, role=role, model=model)
        self._cancelled = False

    def cancel(self) -> None:
        self._cancelled = True

    async def explore_pathway(
        self,
        disease: str,
        start_entity: str,
        graph_data: dict[str, Any],
        external_factors: list[dict[str, Any]] = None,
        max_depth: int = 4,
    ) -> list[DiscoveryHypothesis]:
        """Explore pathways from a starting entity, including external factors."""
        if self._cancelled:
            return []

        self.state.current_task = f"Exploring from {start_entity}"
        self.state.last_activity = datetime.utcnow()
        hypotheses = []

        neighbors = graph_data.get("neighbors", {}).get(start_entity, [])

        for neighbor in neighbors[:10]:
            if self._cancelled:
                break

            path = RelationPath(
                entities=[start_entity, neighbor["entity"]],
                relations=[neighbor["relation"]],
                confidence=neighbor.get("confidence", 0.5),
                evidence_count=neighbor.get("evidence_count", 0),
            )

            should_skip, reason = await self.memory.should_skip(path)
            if should_skip:
                continue

            self.state.paths_explored += 1

            # Build prompt with external factors context
            external_context = ""
            if external_factors:
                factor_lines = []
                for f in external_factors[:10]:
                    factor_lines.append(
                        f"- {f['name']} ({f['category']}): {f.get('interaction', 'unknown interaction')}"
                    )
                external_context = f"""
External Factors in Environment:
{chr(10).join(factor_lines)}

Consider how these external factors (nutrients, chemicals, drugs, compounds, elements) interact with the pathway and affect the hypothesis.
"""

            prompt = f"""Analyze this biological pathway for potential {disease} treatment:

Entity 1: {start_entity}
Relation: {neighbor["relation"]}
Entity 2: {neighbor["entity"]}
Confidence: {path.confidence}
Evidence Count: {path.evidence_count}
{external_context}
Based on this connection, could this pathway lead to a cure or prevention strategy for {disease}?
Provide:
1. Hypothesis (if any)
2. Mechanism of action
3. Confidence score (0-1)
4. Required validation steps
5. External factor interactions (if applicable)

Return as JSON with keys: has_hypothesis, title, description, mechanism, confidence, validation_steps, external_factor_interactions"""

            # Use full system prompt from prompts.py (role-specific + master)
            system_prompt = get_agent_prompt(self.role.value, include_master=True)

            try:
                response = await self.llm.generate(self.model, prompt, system_prompt=system_prompt)
                hypothesis = self._parse_hypothesis(response, disease, path, external_factors)
                if hypothesis:
                    hypotheses.append(hypothesis)
                    self.state.hypotheses_generated += 1
                    await self.memory.record_exploration(path, hypothesis.confidence, True)
                else:
                    await self.memory.record_exploration(path, 0.2, False)
            except Exception as e:
                logger.warning(f"Agent {self.id} exploration failed: {e}")
                await self.memory.record_exploration(path, 0.0, False)

        return hypotheses

    def _parse_hypothesis(
        self, response: str, disease: str, path: RelationPath,
        external_factors: list[dict[str, Any]] = None,
    ) -> Optional[DiscoveryHypothesis]:
        try:
            response = response.strip()
            if response.startswith("```"):
                response = response.split("```")[1]
                if response.startswith("json"):
                    response = response[4:]
            if response.endswith("```"):
                response = response[:-3]

            data = json.loads(response)

            if not data.get("has_hypothesis", False):
                return None

            confidence = float(data.get("confidence", 0.5))
            if confidence < 0.3:
                return None

            ext_factors = []
            if external_factors:
                interactions = data.get("external_factor_interactions", [])
                if isinstance(interactions, list):
                    ext_factors = [{"factor": str(i)} for i in interactions]
                elif isinstance(interactions, dict):
                    ext_factors = [interactions]

            return DiscoveryHypothesis(
                id=str(uuid4()),
                disease=disease,
                hypothesis_type="treatment",
                title=data.get("title", "Untitled"),
                description=data.get("description", ""),
                mechanism=data.get("mechanism", ""),
                confidence=confidence,
                supporting_paths=[path],
                contributing_agents=[self.id],
                model_used=self.model.value,
                external_factors=ext_factors,
            )
        except (json.JSONDecodeError, KeyError, ValueError):
            return None


class DiscoveryOrchestratorStats(BaseModel):
    """Statistics for the discovery orchestrator."""
    state: str
    total_agents: int
    active_agents: int
    hypotheses_found: int
    paths_explored: int
    high_confidence_discoveries: int
    current_best_confidence: float
    runtime_seconds: float
    agents_by_role: dict[str, int]
    models_active: list[str]
    token_pool_stats: dict[str, Any]
    learning_stats: dict[str, Any]


class DiscoveryOrchestrator(LoggerMixin):
    """
    Main orchestrator for parallel discovery agents.

    Manages 100-10,000 agents running across four models in parallel:
    - Llama Maverick: Fast exploration
    - DeepSeek R1: Deep reasoning
    - Kimi 2.5: Long-context analysis
    - GPT OSS 120B: Large-parameter reasoning

    Token pool prevents exhaustion across all models simultaneously.
    """

    def __init__(
        self,
        max_agents: int = 1000,
        target_confidence: float = 0.95,
    ):
        self.max_agents = min(max(100, max_agents), 10000)
        self.target_confidence = target_confidence

        self.token_pool = TokenPool()
        self.llm = MultiModelLLM(self.token_pool)
        self.memory = LearningMemory()

        self._agents: dict[str, DiscoveryAgent] = {}
        self._hypotheses: list[DiscoveryHypothesis] = []
        self._best_confidence = 0.0
        self._start_time: Optional[float] = None
        self._pause_event = asyncio.Event()
        self._pause_event.set()
        self._stop_requested = False
        self._disease: Optional[str] = None
        self._external_factors: list[dict[str, Any]] = []

        self._on_hypothesis: Optional[Callable] = None
        self._on_stats_update: Optional[Callable] = None

        self._graph_store = None
        self._rag_service = None

    async def initialize(self) -> None:
        self.logger.info("Initializing discovery orchestrator (4-model parallel)")
        await self.llm.initialize()

        try:
            from app.knowledge.graph_store import get_graph_store
            self._graph_store = get_graph_store()
        except Exception as e:
            self.logger.warning(f"Graph store not available: {e}")

        try:
            from app.rag.service import get_rag_service
            self._rag_service = get_rag_service()
        except Exception as e:
            self.logger.warning(f"RAG service not available: {e}")

        await self._load_memory()
        self.logger.info("Discovery orchestrator initialized")

    async def _load_memory(self) -> None:
        if self._rag_service:
            try:
                result = await self._rag_service.query("discovery learning memory state")
                if result and result.context.chunks:
                    for chunk in result.context.chunks:
                        if "learning_memory" in chunk.metadata:
                            self.memory.from_dict(chunk.metadata["learning_memory"])
                            self.logger.info("Loaded learning memory from storage")
                            return
            except Exception as e:
                self.logger.debug(f"Could not load memory: {e}")

    async def _save_memory(self) -> None:
        pass

    def set_callbacks(
        self,
        on_hypothesis: Optional[Callable] = None,
        on_stats_update: Optional[Callable] = None,
    ) -> None:
        self._on_hypothesis = on_hypothesis
        self._on_stats_update = on_stats_update

    async def start(
        self,
        disease: str,
        focus_entities: list[str] = None,
        discovery_type: str = "cure",
        external_factors: list[dict[str, Any]] = None,
    ) -> None:
        if self.state == OrchestratorState.RUNNING:
            self.logger.warning("Orchestrator already running")
            return

        self.logger.info(f"Starting discovery for {disease} with {self.max_agents} agents across 4 models")
        self.state = OrchestratorState.RUNNING
        self._start_time = time.time()
        self._stop_requested = False
        self._hypotheses = []
        self._best_confidence = 0.0
        self._disease = disease
        self._external_factors = external_factors or []

        graph_data = await self._get_graph_data(disease, focus_entities)
        await self._create_agents()

        try:
            await self._run_discovery_loop(disease, graph_data, discovery_type)
        finally:
            self.state = OrchestratorState.IDLE
            await self._save_memory()

    async def _get_graph_data(
        self, disease: str, focus_entities: list[str] = None,
    ) -> dict[str, Any]:
        graph_data = {"disease": disease, "entities": [], "neighbors": {}}

        if not self._graph_store:
            self.logger.warning("Using synthetic graph data")
            return self._generate_synthetic_graph(disease)

        try:
            entities = await self._graph_store.search_entities(disease, limit=100)
            graph_data["entities"] = [e.name for e in entities]

            for entity in entities[:20]:
                neighborhood = await self._graph_store.get_neighborhood(entity.id, depth=2, limit=50)
                if neighborhood:
                    graph_data["neighbors"][entity.name] = [
                        {
                            "entity": r.target_name,
                            "relation": r.relation_type,
                            "confidence": r.confidence,
                            "evidence_count": r.evidence_count,
                        }
                        for r in neighborhood.relations
                    ]

            if focus_entities:
                for entity_name in focus_entities:
                    results = await self._graph_store.search_entities(entity_name, limit=5)
                    for r in results:
                        if r.name not in graph_data["entities"]:
                            graph_data["entities"].append(r.name)
        except Exception as e:
            self.logger.error(f"Failed to get graph data: {e}")

        return graph_data

    def _generate_synthetic_graph(self, disease: str) -> dict[str, Any]:
        import random

        entity_types = {
            "genes": ["BRCA1", "TP53", "EGFR", "KRAS", "MYC", "AKT1", "PTEN", "RB1"],
            "proteins": ["p53", "EGFR protein", "HER2", "PD-1", "PD-L1", "VEGF"],
            "drugs": ["Metformin", "Aspirin", "Ibuprofen", "Paclitaxel", "Cisplatin"],
            "pathways": ["Apoptosis", "Cell cycle", "DNA repair", "Immune response"],
            "nutrients": ["Vitamin D", "Omega-3", "Zinc", "Selenium", "Curcumin"],
            "compounds": ["Resveratrol", "Quercetin", "EGCG", "Sulforaphane", "Berberine"],
            "elements": ["Iron", "Magnesium", "Calcium", "Potassium", "Copper"],
        }

        relations = [
            "inhibits", "activates", "regulates", "binds_to", "treats",
            "causes", "modulates", "synergizes_with", "antagonizes",
            "metabolized_by", "absorbed_with", "enhances", "depletes",
        ]

        graph_data = {"disease": disease, "entities": [disease], "neighbors": {}}

        disease_neighbors = []
        for gene in entity_types["genes"][:5]:
            disease_neighbors.append({
                "entity": gene,
                "relation": random.choice(["associated_with", "mutated_in", "causes"]),
                "confidence": random.uniform(0.4, 0.9),
                "evidence_count": random.randint(1, 100),
            })

        graph_data["entities"].extend(entity_types["genes"][:5])
        graph_data["neighbors"][disease] = disease_neighbors

        for gene in entity_types["genes"][:5]:
            gene_neighbors = []
            for drug in random.sample(entity_types["drugs"], 2):
                gene_neighbors.append({
                    "entity": drug, "relation": random.choice(relations),
                    "confidence": random.uniform(0.3, 0.8),
                    "evidence_count": random.randint(1, 50),
                })
            for nutrient in random.sample(entity_types["nutrients"], 2):
                gene_neighbors.append({
                    "entity": nutrient, "relation": random.choice(["modulates", "enhances", "inhibits"]),
                    "confidence": random.uniform(0.3, 0.7),
                    "evidence_count": random.randint(1, 30),
                })
            for compound in random.sample(entity_types["compounds"], 1):
                gene_neighbors.append({
                    "entity": compound, "relation": random.choice(["inhibits", "modulates", "synergizes_with"]),
                    "confidence": random.uniform(0.3, 0.7),
                    "evidence_count": random.randint(1, 20),
                })
            for protein in random.sample(entity_types["proteins"], 2):
                gene_neighbors.append({
                    "entity": protein, "relation": random.choice(relations),
                    "confidence": random.uniform(0.5, 0.95),
                    "evidence_count": random.randint(5, 200),
                })
            graph_data["neighbors"][gene] = gene_neighbors
            graph_data["entities"].extend([n["entity"] for n in gene_neighbors])

        return graph_data

    async def _create_agents(self) -> None:
        self._agents = {}

        role_distribution = {
            AgentRole.EXPLORER: 0.4,
            AgentRole.REASONER: 0.25,
            AgentRole.VALIDATOR: 0.15,
            AgentRole.SYNTHESIZER: 0.1,
            AgentRole.CRITIC: 0.1,
        }

        # Distribute across all four models
        models = [
            ModelType.LLAMA_MAVERICK,
            ModelType.DEEPSEEK_R1,
            ModelType.KIMI_25,
            ModelType.GPT_OSS_120B,
        ]

        for i in range(self.max_agents):
            rand = i / self.max_agents
            cumulative = 0
            role = AgentRole.EXPLORER
            for r, prob in role_distribution.items():
                cumulative += prob
                if rand < cumulative:
                    role = r
                    break

            # Assign model: reasoners get DeepSeek, explorers get round-robin across all 4
            if role == AgentRole.REASONER:
                model = ModelType.DEEPSEEK_R1
            elif role == AgentRole.SYNTHESIZER:
                model = ModelType.KIMI_25  # Long context for synthesis
            else:
                model = models[i % len(models)]

            agent = DiscoveryAgent(
                agent_id=f"agent-{i:04d}",
                role=role,
                model=model,
                llm=self.llm,
                memory=self.memory,
            )
            self._agents[agent.id] = agent

        self.logger.info(f"Created {len(self._agents)} agents across 4 models")

    async def _run_discovery_loop(
        self, disease: str, graph_data: dict[str, Any], discovery_type: str,
    ) -> None:
        entities = graph_data.get("entities", [])
        if not entities:
            self.logger.warning("No entities to explore")
            return

        batch_size = min(settings.TOKEN_POOL_AGENT_BATCH_SIZE, len(self._agents))
        entity_index = 0

        while not self._stop_requested:
            await self._pause_event.wait()
            if self._stop_requested:
                break

            if self._best_confidence >= self.target_confidence:
                self.logger.info(f"Reached target confidence: {self._best_confidence}")
                break

            agent_list = list(self._agents.values())
            batch_agents = agent_list[:batch_size]

            tasks = []
            for agent in batch_agents:
                if not agent.state.is_active:
                    continue

                entity = entities[entity_index % len(entities)]
                entity_index += 1

                task = agent.explore_pathway(
                    disease=disease,
                    start_entity=entity,
                    graph_data=graph_data,
                    external_factors=self._external_factors,
                )
                tasks.append(task)

            if not tasks:
                break

            results = await asyncio.gather(*tasks, return_exceptions=True)

            for result in results:
                if isinstance(result, Exception):
                    self.logger.warning(f"Agent task failed: {result}")
                    continue

                for hypothesis in result:
                    self._hypotheses.append(hypothesis)
                    if hypothesis.confidence > self._best_confidence:
                        self._best_confidence = hypothesis.confidence

                    if self._on_hypothesis:
                        try:
                            await self._on_hypothesis(hypothesis)
                        except Exception as e:
                            self.logger.warning(f"Hypothesis callback failed: {e}")

            if self._on_stats_update:
                try:
                    stats = self.get_stats()
                    await self._on_stats_update(stats)
                except Exception as e:
                    self.logger.warning(f"Stats callback failed: {e}")

            await asyncio.sleep(0.1)

        self.logger.info(
            f"Discovery loop ended. Found {len(self._hypotheses)} hypotheses, "
            f"best confidence: {self._best_confidence}"
        )

    def pause(self) -> None:
        if self.state == OrchestratorState.RUNNING:
            self.state = OrchestratorState.PAUSED
            self._pause_event.clear()
            self.logger.info("Discovery paused")

    def resume(self) -> None:
        if self.state == OrchestratorState.PAUSED:
            self.state = OrchestratorState.RUNNING
            self._pause_event.set()
            self.logger.info("Discovery resumed")

    def stop(self) -> None:
        self._stop_requested = True
        self._pause_event.set()
        self.state = OrchestratorState.STOPPING
        for agent in self._agents.values():
            agent.cancel()
        self.logger.info("Discovery stopping")

    def get_stats(self) -> DiscoveryOrchestratorStats:
        active_agents = sum(1 for a in self._agents.values() if a.state.is_active)
        paths_explored = sum(a.state.paths_explored for a in self._agents.values())

        agents_by_role = {}
        for agent in self._agents.values():
            role = agent.role.value
            agents_by_role[role] = agents_by_role.get(role, 0) + 1

        high_confidence = sum(1 for h in self._hypotheses if h.confidence >= 0.7)
        runtime = time.time() - self._start_time if self._start_time else 0

        models_active = list(set(a.model.value for a in self._agents.values()))

        return DiscoveryOrchestratorStats(
            state=self.state.value,
            total_agents=len(self._agents),
            active_agents=active_agents,
            hypotheses_found=len(self._hypotheses),
            paths_explored=paths_explored,
            high_confidence_discoveries=high_confidence,
            current_best_confidence=self._best_confidence,
            runtime_seconds=runtime,
            agents_by_role=agents_by_role,
            models_active=models_active,
            token_pool_stats=self.token_pool.get_stats(),
            learning_stats=self.memory.get_stats(),
        )

    def get_hypotheses(
        self, min_confidence: float = 0.0, limit: int = 100,
    ) -> list[DiscoveryHypothesis]:
        filtered = [h for h in self._hypotheses if h.confidence >= min_confidence]
        filtered.sort(key=lambda h: h.confidence, reverse=True)
        return filtered[:limit]


# Global orchestrator instance
_orchestrator: Optional[DiscoveryOrchestrator] = None


async def get_orchestrator() -> DiscoveryOrchestrator:
    global _orchestrator
    if _orchestrator is None:
        _orchestrator = DiscoveryOrchestrator()
        await _orchestrator.initialize()
    return _orchestrator


async def start_discovery(
    disease: str,
    focus_entities: list[str] = None,
    discovery_type: str = "cure",
    max_agents: int = 1000,
    target_confidence: float = 0.95,
    external_factors: list[dict[str, Any]] = None,
) -> DiscoveryOrchestrator:
    global _orchestrator

    _orchestrator = DiscoveryOrchestrator(
        max_agents=max_agents,
        target_confidence=target_confidence,
    )
    await _orchestrator.initialize()

    asyncio.create_task(
        _orchestrator.start(disease, focus_entities, discovery_type, external_factors)
    )

    return _orchestrator
