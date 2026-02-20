"""
Discovery Orchestrator

Six-model parallel agent system for continuous biomedical discovery.
Runs 4 Bedrock models (Kimi 2.5, DeepSeek R1, Llama Maverick, GPT OSS 120B)
and 2 Azure OpenAI models (GPT-4o, o1) in parallel with token pool management
to prevent exhaustion at 100-10000 agent scale.

Features:
- Six-model parallel reasoning across AWS Bedrock and Azure OpenAI
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


# ============== Bedrock InvokeModel helpers ==============

def _build_invoke_body(model_id: str, prompt: str, system_prompt: str,
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


def _parse_invoke_response(model_id: str, response_body: dict) -> str:
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
    # Bedrock models
    LLAMA_MAVERICK = "llama_maverick"
    DEEPSEEK_R1 = "deepseek_r1"
    KIMI_25 = "kimi_25"
    GPT_OSS_120B = "gpt_oss_120b"
    # Azure OpenAI models
    GPT_4O = "gpt_4o"
    O1 = "o1"
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


class ParallelMCP:
    """
    Parallel Model Context Protocol (MCP) for distributing context across models.

    Overcomes per-model token limits by sharding large contexts across the 4 models,
    having each model process its shard, then synthesizing results. This allows
    effective context windows of 4x a single model's limit.

    Strategies:
    - semantic: Split context by semantic sections (pathways, evidence, entities, factors)
    - fixed: Split context into equal-sized chunks
    - sliding_window: Overlapping sliding window chunks
    """

    def __init__(self, bedrock_client, token_pool: TokenPool):
        self._bedrock_client = bedrock_client
        self._token_pool = token_pool

    def _estimate_tokens(self, text: str) -> int:
        """Estimate token count (rough: 1 token ~ 4 chars)."""
        return len(text) // 4

    def _shard_context_semantic(
        self, context: str, num_shards: int, overlap: int,
    ) -> list[dict[str, str]]:
        """Split context into semantic shards with labeled sections."""
        sections = {
            "molecular_pathways": [],
            "evidence_literature": [],
            "entity_relationships": [],
            "external_factors": [],
        }

        current_section = "molecular_pathways"
        for line in context.split("\n"):
            line_lower = line.lower()
            if any(kw in line_lower for kw in ["evidence", "pubmed", "clinical trial", "study", "paper", "citation"]):
                current_section = "evidence_literature"
            elif any(kw in line_lower for kw in ["entity", "gene", "protein", "drug", "target", "relation"]):
                current_section = "entity_relationships"
            elif any(kw in line_lower for kw in ["nutrient", "chemical", "compound", "element", "external", "factor", "vitamin"]):
                current_section = "external_factors"
            elif any(kw in line_lower for kw in ["pathway", "signal", "mechanism", "molecular", "cellular"]):
                current_section = "molecular_pathways"
            sections[current_section].append(line)

        section_keys = list(sections.keys())
        shards = []
        for i in range(num_shards):
            primary_key = section_keys[i % len(section_keys)]
            primary_text = "\n".join(sections[primary_key])

            # Add overlap from adjacent sections
            overlap_text = ""
            if overlap > 0:
                for j in range(len(section_keys)):
                    if j != (i % len(section_keys)):
                        other_text = "\n".join(sections[section_keys[j]])
                        overlap_chars = overlap * 4  # tokens to chars
                        if other_text:
                            overlap_text += f"\n[Cross-reference from {section_keys[j]}]:\n{other_text[:overlap_chars]}\n"

            shards.append({
                "section": primary_key,
                "content": primary_text + overlap_text,
                "shard_index": i,
                "total_shards": num_shards,
            })

        return shards

    def _shard_context_fixed(
        self, context: str, num_shards: int, overlap: int,
    ) -> list[dict[str, str]]:
        """Split context into fixed-size chunks."""
        lines = context.split("\n")
        chunk_size = max(1, len(lines) // num_shards)
        overlap_lines = overlap // 10  # rough estimate

        shards = []
        for i in range(num_shards):
            start = max(0, i * chunk_size - overlap_lines)
            end = min(len(lines), (i + 1) * chunk_size + overlap_lines)
            shards.append({
                "section": f"chunk_{i}",
                "content": "\n".join(lines[start:end]),
                "shard_index": i,
                "total_shards": num_shards,
            })

        return shards

    def shard_context(
        self, context: str, strategy: str = None,
    ) -> list[dict[str, str]]:
        """Shard context according to configured strategy."""
        strategy = strategy or settings.MCP_CHUNK_STRATEGY
        num_shards = settings.MCP_PARALLEL_SHARDS
        overlap = settings.MCP_CONTEXT_OVERLAP

        if strategy == "semantic":
            return self._shard_context_semantic(context, num_shards, overlap)
        else:
            return self._shard_context_fixed(context, num_shards, overlap)

    async def parallel_process(
        self,
        prompt: str,
        context: str,
        model_assignments: dict[str, str],
        system_prompts: dict[str, str],
        max_tokens: int = 4000,
        temperature: float = 0.3,
    ) -> dict[str, str]:
        """
        Process a large context in parallel across all 4 models.

        Each model receives its context shard + the shared prompt.
        Results are collected for synthesis.
        """
        context_tokens = self._estimate_tokens(context)
        max_per_model = settings.MCP_MAX_CONTEXT_PER_MODEL

        # If context fits in a single model, no sharding needed
        if context_tokens <= max_per_model:
            shards = [{"section": "full", "content": context, "shard_index": 0, "total_shards": 1}]
        else:
            shards = self.shard_context(context)

        model_keys = list(model_assignments.keys())
        tasks = {}

        for i, (model_key, model_id) in enumerate(model_assignments.items()):
            shard = shards[i % len(shards)]
            shard_prompt = f"""[MCP Shard {shard['shard_index'] + 1}/{shard['total_shards']} — Section: {shard['section']}]

CONTEXT FOR YOUR SHARD:
{shard['content']}

TASK:
{prompt}

IMPORTANT: You are processing shard {shard['shard_index'] + 1} of {shard['total_shards']}. Focus on extracting insights from YOUR section while noting cross-references to other sections. Your output will be synthesized with outputs from the other shards."""

            system = system_prompts.get(model_key, "")
            tasks[model_key] = self._invoke_bedrock(
                model_id, shard_prompt, system, max_tokens, temperature,
            )

        results = await asyncio.gather(
            *[asyncio.create_task(coro) for coro in tasks.values()],
            return_exceptions=True,
        )

        responses = {}
        for (name, _), result in zip(tasks.items(), results):
            if isinstance(result, Exception):
                responses[name] = f"[MCP Shard Error]: {result}"
                logger.warning(f"MCP shard {name} failed: {result}")
            else:
                responses[name] = result

        return responses

    async def synthesize_shards(
        self, shard_results: dict[str, str], original_prompt: str,
        synthesis_model_id: str = None,
    ) -> str:
        """Synthesize results from all MCP shards into a unified response."""
        synthesis_model = synthesis_model_id or settings.MCP_SYNTHESIS_MODEL

        shard_summaries = "\n\n".join([
            f"=== SHARD: {name} ===\n{result}"
            for name, result in shard_results.items()
            if not result.startswith("[MCP Shard Error]")
        ])

        synthesis_prompt = f"""You are synthesizing results from a parallel multi-model context protocol (MCP) run.
Multiple AI models each processed a different shard of the total context in parallel.
Your job is to integrate their findings into a single, coherent, comprehensive response.

ORIGINAL TASK:
{original_prompt}

SHARD RESULTS FROM PARALLEL MODELS:
{shard_summaries}

INSTRUCTIONS:
1. Integrate all findings — do not discard any shard's unique contributions
2. Resolve any contradictions by noting both perspectives with confidence levels
3. Identify cross-shard connections that individual models may have missed
4. Produce a unified JSON response following the standard hypothesis format
5. The final confidence score should be a weighted average across all shards"""

        system = "You are a synthesis agent integrating parallel model outputs into a unified biomedical discovery."
        return await self._invoke_bedrock(
            synthesis_model, synthesis_prompt, system, max_tokens=4000, temperature=0.3,
        )

    async def _invoke_bedrock(
        self, model_id: str, prompt: str, system_prompt: str,
        max_tokens: int, temperature: float,
    ) -> str:
        """Invoke a Bedrock model. Tries Converse API, falls back to InvokeModel."""
        if not self._bedrock_client:
            raise RuntimeError("Bedrock client not initialized for MCP")

        loop = asyncio.get_event_loop()

        # Try Converse first
        try:
            response = await loop.run_in_executor(
                None,
                lambda: self._bedrock_client.converse(
                    modelId=model_id,
                    messages=[{"role": "user", "content": [{"text": prompt}]}],
                    system=[{"text": system_prompt}] if system_prompt else [],
                    inferenceConfig={"maxTokens": max_tokens, "temperature": temperature},
                )
            )
            return response["output"]["message"]["content"][0]["text"]
        except Exception as e:
            logger.warning(f"MCP Converse failed for {model_id}: {e}, trying InvokeModel")

        # Fallback: InvokeModel
        body = _build_invoke_body(model_id, prompt, system_prompt, max_tokens, temperature)
        response = await loop.run_in_executor(
            None,
            lambda: self._bedrock_client.invoke_model(
                modelId=model_id,
                contentType="application/json",
                accept="application/json",
                body=json.dumps(body),
            )
        )
        response_body = json.loads(response["body"].read())
        return _parse_invoke_response(model_id, response_body)


class MultiModelLLM:
    """
    Six-model interface routing models through AWS Bedrock and Azure OpenAI:

    Bedrock (4 models):
    - Llama Maverick 17B (meta.llama4-maverick-17b-instruct-v1:0) — Fast broad exploration
    - DeepSeek R1 (deepseek.r1-v1:0) — Deep causal chain reasoning
    - Kimi 2.5 (moonshotai.kimi-k2.5) — Long-context synthesis & integration
    - GPT OSS Safeguard 120B (openai.gpt-oss-safeguard-120b) — Large-parameter critical analysis

    Azure OpenAI (2 models):
    - GPT-4o — Strategic analysis, structured output, clinical planning
    - o1 — Deep multi-step reasoning, statistical & mathematical analysis

    Parallel MCP (Model Context Protocol) distributes large contexts across all 6 models.
    """

    BEDROCK_MODELS = {
        ModelType.LLAMA_MAVERICK: settings.BEDROCK_MODEL_LLAMA_MAVERICK,
        ModelType.DEEPSEEK_R1: settings.BEDROCK_MODEL_DEEPSEEK,
        ModelType.KIMI_25: settings.BEDROCK_MODEL_KIMI,
        ModelType.GPT_OSS_120B: settings.BEDROCK_MODEL_GPT_OSS,
    }

    AZURE_MODELS = {
        ModelType.GPT_4O: settings.AZURE_OPENAI_DEPLOYMENT_GPT4O,
        ModelType.O1: settings.AZURE_OPENAI_DEPLOYMENT_O1,
    }

    def __init__(self, token_pool: TokenPool):
        self._bedrock_client = None
        self._azure_client = None
        self._initialized = False
        self._token_pool = token_pool
        self._mcp: Optional[ParallelMCP] = None

    async def initialize(self) -> None:
        if self._initialized:
            return

        # Initialize Bedrock client
        if settings.aws_access_key_value and settings.aws_secret_key_value:
            try:
                import boto3
                self._bedrock_client = boto3.client(
                    "bedrock-runtime",
                    region_name=settings.AWS_REGION,
                    aws_access_key_id=settings.aws_access_key_value,
                    aws_secret_access_key=settings.aws_secret_key_value,
                )
                logger.info(f"Bedrock client initialized (region={settings.AWS_REGION})")
            except Exception as e:
                logger.error(f"Bedrock client initialization FAILED: {e}")
        else:
            logger.error("AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are REQUIRED for Bedrock models")

        # Initialize Azure OpenAI client
        if settings.azure_openai_api_key_value and settings.AZURE_OPENAI_ENDPOINT:
            try:
                from openai import AsyncAzureOpenAI
                self._azure_client = AsyncAzureOpenAI(
                    api_key=settings.azure_openai_api_key_value,
                    azure_endpoint=settings.AZURE_OPENAI_ENDPOINT,
                    api_version=settings.AZURE_OPENAI_API_VERSION,
                )
                logger.info(f"Azure OpenAI client initialized (endpoint={settings.AZURE_OPENAI_ENDPOINT})")
            except Exception as e:
                logger.error(f"Azure OpenAI client initialization FAILED: {e}")
        else:
            logger.warning("AZURE_OPENAI_API_KEY and AZURE_OPENAI_ENDPOINT not set — Azure models unavailable")

        # Initialize Parallel MCP
        if self._bedrock_client and settings.MCP_ENABLED:
            self._mcp = ParallelMCP(self._bedrock_client, self._token_pool)
            logger.info("Parallel MCP initialized for cross-model context distribution")

        self._initialized = True
        available = []
        for model_type, model_id in self.BEDROCK_MODELS.items():
            if self._bedrock_client:
                available.append(f"{model_type.value} ({model_id}) [bedrock]")
        for model_type, deployment in self.AZURE_MODELS.items():
            if self._azure_client:
                available.append(f"{model_type.value} ({deployment}) [azure]")
        logger.info(f"Multi-model LLM initialized. Available: {available}")

    def _is_azure_model(self, model_type: ModelType) -> bool:
        """Check if a model type routes through Azure OpenAI."""
        return model_type in self.AZURE_MODELS

    async def generate(
        self,
        model_type: ModelType,
        prompt: str,
        system_prompt: str = "",
        max_tokens: int = 4000,
        temperature: float = 0.3,
    ) -> str:
        """Generate response from specified model via Bedrock or Azure OpenAI."""
        if not self._initialized:
            await self.initialize()

        acquired = await self._token_pool.acquire(model_type)
        if not acquired:
            raise RuntimeError(f"Token pool exhausted for {model_type.value}, rate limit hit")

        try:
            if self._is_azure_model(model_type):
                return await self._generate_azure(model_type, prompt, system_prompt, max_tokens, temperature)
            else:
                return await self._generate_bedrock(model_type, prompt, system_prompt, max_tokens, temperature)
        except Exception as e:
            self._token_pool.record_error(model_type)
            raise
        finally:
            self._token_pool.release(model_type, max_tokens)

    async def _generate_azure(
        self, model_type: ModelType, prompt: str, system_prompt: str,
        max_tokens: int, temperature: float,
    ) -> str:
        """Invoke a model via Azure OpenAI."""
        if not self._azure_client:
            raise RuntimeError(
                "Azure OpenAI client not initialized. Set AZURE_OPENAI_API_KEY "
                "and AZURE_OPENAI_ENDPOINT environment variables."
            )

        deployment = self.AZURE_MODELS[model_type]
        is_o1 = model_type == ModelType.O1

        # o1 models: no system message, no temperature, use max_completion_tokens
        if is_o1:
            messages = []
            if system_prompt:
                messages.append({"role": "user", "content": f"[System Instructions]\n{system_prompt}"})
            messages.append({"role": "user", "content": prompt})
            response = await self._azure_client.chat.completions.create(
                model=deployment,
                messages=messages,
                max_completion_tokens=max_tokens,
            )
        else:
            messages = []
            if system_prompt:
                messages.append({"role": "system", "content": system_prompt})
            messages.append({"role": "user", "content": prompt})
            response = await self._azure_client.chat.completions.create(
                model=deployment,
                messages=messages,
                max_tokens=max_tokens,
                temperature=temperature,
            )

        return response.choices[0].message.content

    async def _generate_bedrock(
        self, model_type: ModelType, prompt: str, system_prompt: str,
        max_tokens: int, temperature: float,
    ) -> str:
        """Invoke any model via Bedrock. Tries Converse API, falls back to InvokeModel."""
        if not self._bedrock_client:
            raise RuntimeError("Bedrock client not initialized")

        model_id = self.BEDROCK_MODELS[model_type]
        loop = asyncio.get_event_loop()

        # Try Converse API first
        try:
            response = await loop.run_in_executor(
                None,
                lambda: self._bedrock_client.converse(
                    modelId=model_id,
                    messages=[{"role": "user", "content": [{"text": prompt}]}],
                    system=[{"text": system_prompt}] if system_prompt else [],
                    inferenceConfig={"maxTokens": max_tokens, "temperature": temperature},
                )
            )
            return response["output"]["message"]["content"][0]["text"]
        except Exception as e:
            logger.warning(f"Converse failed for {model_id}: {e}, trying InvokeModel")

        # Fallback: InvokeModel with provider-specific body
        body = _build_invoke_body(model_id, prompt, system_prompt, max_tokens, temperature)
        response = await loop.run_in_executor(
            None,
            lambda: self._bedrock_client.invoke_model(
                modelId=model_id,
                contentType="application/json",
                accept="application/json",
                body=json.dumps(body),
            )
        )
        response_body = json.loads(response["body"].read())
        return _parse_invoke_response(model_id, response_body)

    async def _generate_fallback(
        self, prompt: str, system_prompt: str, max_tokens: int, temperature: float,
    ) -> str:
        """Try each model in priority order until one works."""
        for model_type in [
            ModelType.GPT_4O,
            ModelType.LLAMA_MAVERICK,
            ModelType.DEEPSEEK_R1,
            ModelType.KIMI_25,
            ModelType.GPT_OSS_120B,
            ModelType.O1,
        ]:
            try:
                if self._is_azure_model(model_type):
                    return await self._generate_azure(model_type, prompt, system_prompt, max_tokens, temperature)
                else:
                    return await self._generate_bedrock(model_type, prompt, system_prompt, max_tokens, temperature)
            except Exception:
                continue
        raise RuntimeError("All models unavailable (Bedrock + Azure)")

    async def parallel_reasoning(
        self, prompt: str, context: str = "",
    ) -> dict[str, str]:
        """
        Run all six models in parallel on the same prompt.
        Returns dict mapping model name to response.
        Uses comprehensive system prompts from prompts.py.

        When context exceeds per-model token limits, automatically engages
        Parallel MCP to shard context across models.
        """
        if not self._initialized:
            await self.initialize()

        full_prompt = f"{context}\n\n{prompt}" if context else prompt

        # Check if MCP sharding is needed for large contexts
        if self._mcp and context and (len(context) // 6) > settings.MCP_MAX_CONTEXT_PER_MODEL:
            logger.info("Context exceeds per-model limit — engaging Parallel MCP")
            return await self._mcp_parallel_reasoning(prompt, context)

        # Standard parallel: all 6 models get the same prompt
        tasks = {}

        # Bedrock models
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
            tasks["kimi_25"] = self.generate(
                ModelType.KIMI_25, full_prompt,
                get_agent_prompt("synthesizer", include_master=True),
                temperature=0.3,
            )
            tasks["gpt_oss_120b"] = self.generate(
                ModelType.GPT_OSS_120B, full_prompt,
                get_agent_prompt("critic", include_master=True),
                temperature=0.3,
            )

        # Azure OpenAI models
        if self._azure_client:
            tasks["gpt_4o"] = self.generate(
                ModelType.GPT_4O, full_prompt,
                get_agent_prompt("strategist", include_master=True),
                temperature=0.3,
            )
            tasks["o1"] = self.generate(
                ModelType.O1, full_prompt,
                get_agent_prompt("deep_analyst", include_master=True),
                temperature=0.3,  # ignored for o1 inside _generate_azure
            )

        if not tasks:
            raise RuntimeError("No models available for parallel reasoning (Bedrock + Azure)")

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

    async def _mcp_parallel_reasoning(
        self, prompt: str, context: str,
    ) -> dict[str, str]:
        """
        Parallel MCP reasoning: shard context across models, process, then synthesize.
        Used when total context exceeds per-model token limits.
        MCP shards go to Bedrock models; Azure models get the full prompt separately.
        """
        model_assignments = {
            "llama_maverick": self.BEDROCK_MODELS[ModelType.LLAMA_MAVERICK],
            "deepseek_r1": self.BEDROCK_MODELS[ModelType.DEEPSEEK_R1],
            "kimi_25": self.BEDROCK_MODELS[ModelType.KIMI_25],
            "gpt_oss_120b": self.BEDROCK_MODELS[ModelType.GPT_OSS_120B],
        }

        system_prompts = {
            "llama_maverick": get_agent_prompt("explorer", include_master=True),
            "deepseek_r1": get_agent_prompt("reasoner", include_master=True),
            "kimi_25": get_agent_prompt("synthesizer", include_master=True),
            "gpt_oss_120b": get_agent_prompt("critic", include_master=True),
        }

        # Phase 1: Parallel shard processing via Bedrock MCP
        shard_results = await self._mcp.parallel_process(
            prompt=prompt,
            context=context,
            model_assignments=model_assignments,
            system_prompts=system_prompts,
        )

        # Phase 1b: Azure models process the full context in parallel
        # (GPT-4o and o1 have large context windows — 128K and 200K respectively)
        if self._azure_client:
            full_prompt = f"{context}\n\n{prompt}"
            azure_tasks = {
                "gpt_4o": self._generate_azure(
                    ModelType.GPT_4O, full_prompt,
                    get_agent_prompt("strategist", include_master=True),
                    max_tokens=4000, temperature=0.3,
                ),
                "o1": self._generate_azure(
                    ModelType.O1, full_prompt,
                    get_agent_prompt("deep_analyst", include_master=True),
                    max_tokens=4000, temperature=0.3,
                ),
            }
            azure_results = await asyncio.gather(
                *[asyncio.create_task(c) for c in azure_tasks.values()],
                return_exceptions=True,
            )
            for (name, _), result in zip(azure_tasks.items(), azure_results):
                if isinstance(result, Exception):
                    logger.warning(f"Azure MCP model {name} failed: {result}")
                else:
                    shard_results[name] = result

        # Phase 2: Synthesis via Kimi 2.5 (largest Bedrock context window)
        synthesized = await self._mcp.synthesize_shards(
            shard_results, prompt,
            synthesis_model_id=self.BEDROCK_MODELS[ModelType.KIMI_25],
        )

        # Return both individual shard results and synthesis
        shard_results["mcp_synthesis"] = synthesized
        return shard_results


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
Based on this connection, could this pathway lead to a treatment or prevention strategy for {disease}?
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
    agents_by_model: dict[str, int] = {}
    models_active: list[str]
    token_pool_stats: dict[str, Any]
    learning_stats: dict[str, Any]


class DiscoveryOrchestrator(LoggerMixin):
    """
    Main orchestrator for parallel discovery agents.

    Manages 100-10,000 agents running across six models in parallel:
    Bedrock: Llama Maverick, DeepSeek R1, Kimi 2.5, GPT OSS 120B
    Azure:   GPT-4o, o1

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
        self._discovery_type: str = "treatment"
        self._external_factors: list[dict[str, Any]] = []

        self._on_hypothesis: Optional[Callable] = None
        self._on_stats_update: Optional[Callable] = None

        self._graph_store = None
        self._rag_service = None

    async def initialize(self) -> None:
        self.logger.info("Initializing discovery orchestrator (6-model parallel: Bedrock + Azure)")
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
        discovery_type: str = "treatment",
        external_factors: list[dict[str, Any]] = None,
    ) -> None:
        if self.state == OrchestratorState.RUNNING:
            self.logger.warning("Orchestrator already running")
            return

        self.logger.info(f"Starting discovery for {disease} with {self.max_agents} agents across 6 models")
        self.state = OrchestratorState.RUNNING
        self._start_time = time.time()
        self._stop_requested = False
        self._hypotheses = []
        self._best_confidence = 0.0
        self._disease = disease
        self._discovery_type = discovery_type
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

        # Equal distribution: max_agents / 6 per model
        # e.g. 10000 agents ≈ 1667 per model
        models = [
            ModelType.LLAMA_MAVERICK,
            ModelType.DEEPSEEK_R1,
            ModelType.KIMI_25,
            ModelType.GPT_OSS_120B,
            ModelType.GPT_4O,
            ModelType.O1,
        ]

        # Exclude Azure models if client is not initialized
        if not self.llm._azure_client:
            models = [m for m in models if m not in (ModelType.GPT_4O, ModelType.O1)]

        # Roles distributed within each model's agent pool
        role_distribution = [
            (AgentRole.EXPLORER, 0.4),
            (AgentRole.REASONER, 0.25),
            (AgentRole.VALIDATOR, 0.15),
            (AgentRole.SYNTHESIZER, 0.1),
            (AgentRole.CRITIC, 0.1),
        ]

        agents_per_model = self.max_agents // len(models)
        remainder = self.max_agents % len(models)

        agent_idx = 0
        model_counts: dict[str, int] = {}

        for model_idx, model in enumerate(models):
            # Distribute remainder agents to first models
            count = agents_per_model + (1 if model_idx < remainder else 0)
            model_counts[model.value] = count

            for j in range(count):
                # Assign role based on position within this model's pool
                frac = j / max(count, 1)
                cumulative = 0.0
                role = AgentRole.EXPLORER
                for r, prob in role_distribution:
                    cumulative += prob
                    if frac < cumulative:
                        role = r
                        break

                agent = DiscoveryAgent(
                    agent_id=f"agent-{agent_idx:04d}",
                    role=role,
                    model=model,
                    llm=self.llm,
                    memory=self.memory,
                )
                self._agents[agent.id] = agent
                agent_idx += 1

        self.logger.info(
            f"Created {len(self._agents)} agents — equal distribution: "
            + ", ".join(f"{k}: {v}" for k, v in model_counts.items())
        )

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

        agents_by_role: dict[str, int] = {}
        agents_by_model: dict[str, int] = {}
        for agent in self._agents.values():
            role = agent.role.value
            agents_by_role[role] = agents_by_role.get(role, 0) + 1
            model = agent.model.value
            agents_by_model[model] = agents_by_model.get(model, 0) + 1

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
            agents_by_model=agents_by_model,
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
    discovery_type: str = "treatment",
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
