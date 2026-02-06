"""
Discovery Orchestrator

Multi-model parallel agent system for continuous disease cure/prevention discovery.
Uses Llama Maverick and DeepSeek R1 via AWS Bedrock for collaborative reasoning.

Features:
- Thousands of parallel agents for simultaneous exploration
- Continuous logic and reasoning across billions of data points
- Confidence-based stopping with start/pause/stop controls
- Learning system to skip redundant relations
- Integration with RAG and knowledge graph for persistent learning
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

logger = get_logger(__name__)


class OrchestratorState(str, Enum):
    """State of the discovery orchestrator."""
    IDLE = "idle"
    RUNNING = "running"
    PAUSED = "paused"
    STOPPING = "stopping"


class AgentRole(str, Enum):
    """Role of an agent in the discovery process."""
    EXPLORER = "explorer"  # Explores new pathways
    REASONER = "reasoner"  # Deep logical reasoning
    VALIDATOR = "validator"  # Validates discoveries
    SYNTHESIZER = "synthesizer"  # Combines findings
    CRITIC = "critic"  # Challenges assumptions


class ModelType(str, Enum):
    """LLM model types available."""
    LLAMA_MAVERICK = "llama_maverick"  # Fast, broad reasoning
    DEEPSEEK_R1 = "deepseek_r1"  # Deep logical reasoning
    CLAUDE = "claude"  # Balanced reasoning
    HYBRID = "hybrid"  # Use both models collaboratively


@dataclass
class RelationPath:
    """A path of relations between entities."""
    entities: list[str]
    relations: list[str]
    confidence: float
    evidence_count: int
    hash_key: str = ""

    def __post_init__(self):
        # Create unique hash for this path
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


class LearningMemory:
    """
    Memory system for learning to skip redundant relations.
    Stores explored paths and their outcomes to avoid repetition.
    """

    def __init__(self):
        self._explored_paths: set[int] = set()  # Hash keys of explored paths
        self._low_value_paths: set[int] = set()  # Paths that led to low confidence
        self._high_value_paths: dict[int, float] = {}  # Paths with their confidence scores
        self._relation_scores: dict[str, float] = defaultdict(float)  # Relation type effectiveness
        self._entity_pair_scores: dict[tuple, float] = {}  # Entity pair connection strength
        self._lock = asyncio.Lock()

    async def should_skip(self, path: RelationPath) -> tuple[bool, str]:
        """Check if a path should be skipped based on learning."""
        async with self._lock:
            # Skip if already explored
            if path.hash_key in self._explored_paths:
                return True, "Already explored"

            # Skip if marked as low value
            if path.hash_key in self._low_value_paths:
                return True, "Previously low value"

            # Check relation type scores
            for relation in path.relations:
                if self._relation_scores.get(relation, 1.0) < 0.2:
                    return True, f"Relation '{relation}' has low success rate"

            return False, ""

    async def record_exploration(
        self,
        path: RelationPath,
        outcome_confidence: float,
        led_to_discovery: bool,
    ) -> None:
        """Record the outcome of exploring a path."""
        async with self._lock:
            self._explored_paths.add(path.hash_key)

            if outcome_confidence < 0.3 and not led_to_discovery:
                self._low_value_paths.add(path.hash_key)
            elif outcome_confidence > 0.6 or led_to_discovery:
                self._high_value_paths[path.hash_key] = outcome_confidence

            # Update relation scores
            score_delta = 0.1 if led_to_discovery else -0.05
            for relation in path.relations:
                current = self._relation_scores.get(relation, 0.5)
                self._relation_scores[relation] = max(0, min(1, current + score_delta))

            # Update entity pair scores
            for i in range(len(path.entities) - 1):
                pair = (path.entities[i], path.entities[i + 1])
                current = self._entity_pair_scores.get(pair, 0.5)
                self._entity_pair_scores[pair] = max(0, min(1, current + score_delta))

    def get_stats(self) -> dict[str, Any]:
        """Get learning memory statistics."""
        return {
            "total_explored": len(self._explored_paths),
            "low_value_paths": len(self._low_value_paths),
            "high_value_paths": len(self._high_value_paths),
            "relation_scores": dict(self._relation_scores),
            "avg_relation_score": sum(self._relation_scores.values()) / max(1, len(self._relation_scores)),
        }

    def to_dict(self) -> dict[str, Any]:
        """Serialize memory for storage."""
        return {
            "explored_paths": list(self._explored_paths),
            "low_value_paths": list(self._low_value_paths),
            "high_value_paths": self._high_value_paths,
            "relation_scores": dict(self._relation_scores),
            "entity_pair_scores": {f"{k[0]}|{k[1]}": v for k, v in self._entity_pair_scores.items()},
        }

    def from_dict(self, data: dict[str, Any]) -> None:
        """Load memory from stored data."""
        self._explored_paths = set(data.get("explored_paths", []))
        self._low_value_paths = set(data.get("low_value_paths", []))
        self._high_value_paths = data.get("high_value_paths", {})
        self._relation_scores = defaultdict(float, data.get("relation_scores", {}))
        self._entity_pair_scores = {
            tuple(k.split("|")): v
            for k, v in data.get("entity_pair_scores", {}).items()
        }


class BedrockMultiModel:
    """
    Multi-model interface for AWS Bedrock.
    Supports Llama Maverick and DeepSeek R1 for collaborative reasoning.
    """

    # Model IDs for AWS Bedrock
    MODELS = {
        ModelType.LLAMA_MAVERICK: "us.meta.llama4-maverick-17b-instruct-v1:0",
        ModelType.DEEPSEEK_R1: "us.deepseek.deepseek-r1-distill-llama-70b-v1:0",
        ModelType.CLAUDE: "anthropic.claude-3-5-sonnet-20241022-v2:0",
    }

    def __init__(self):
        self._client = None
        self._initialized = False

    async def initialize(self) -> None:
        """Initialize Bedrock client."""
        if self._initialized:
            return

        try:
            import boto3
            self._client = boto3.client(
                "bedrock-runtime",
                region_name=settings.AWS_REGION,
                aws_access_key_id=settings.aws_access_key_value,
                aws_secret_access_key=settings.aws_secret_key_value,
            )
            self._initialized = True
            logger.info("Bedrock multi-model client initialized")
        except Exception as e:
            logger.error(f"Failed to initialize Bedrock: {e}")
            raise

    async def generate(
        self,
        model_type: ModelType,
        prompt: str,
        system_prompt: str = "",
        max_tokens: int = 4000,
        temperature: float = 0.3,
    ) -> str:
        """Generate response from specified model."""
        if not self._initialized:
            await self.initialize()

        model_id = self.MODELS.get(model_type, self.MODELS[ModelType.LLAMA_MAVERICK])

        # Build messages
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

        # Run in thread pool since boto3 is synchronous
        loop = asyncio.get_event_loop()

        try:
            response = await loop.run_in_executor(
                None,
                lambda: self._client.invoke_model(
                    modelId=model_id,
                    body=body,
                    contentType="application/json",
                    accept="application/json",
                )
            )

            result = json.loads(response["body"].read())

            # Handle different response formats
            if "content" in result:
                return result["content"][0]["text"]
            elif "generation" in result:
                return result["generation"]
            elif "outputs" in result:
                return result["outputs"][0]["text"]
            elif "choices" in result:
                return result["choices"][0]["message"]["content"]
            else:
                return str(result)

        except Exception as e:
            logger.error(f"Bedrock generation failed: {e}")
            raise

    async def collaborative_reasoning(
        self,
        prompt: str,
        context: str = "",
    ) -> tuple[str, str, str]:
        """
        Use both Llama Maverick and DeepSeek R1 for collaborative reasoning.

        Returns:
            Tuple of (maverick_response, deepseek_response, synthesized_response)
        """
        system_prompt = """You are a biomedical research AI specialized in discovering disease cures and prevention strategies.
Analyze the given data carefully and provide logical, evidence-based reasoning."""

        full_prompt = f"{context}\n\n{prompt}" if context else prompt

        # Run both models in parallel
        maverick_task = self.generate(
            ModelType.LLAMA_MAVERICK,
            full_prompt,
            system_prompt,
            temperature=0.4,  # Slightly more creative
        )

        deepseek_task = self.generate(
            ModelType.DEEPSEEK_R1,
            full_prompt,
            system_prompt + "\nProvide deep logical reasoning with step-by-step analysis.",
            temperature=0.2,  # More focused reasoning
        )

        maverick_response, deepseek_response = await asyncio.gather(
            maverick_task,
            deepseek_task,
            return_exceptions=True,
        )

        # Handle errors
        if isinstance(maverick_response, Exception):
            maverick_response = f"Error: {maverick_response}"
        if isinstance(deepseek_response, Exception):
            deepseek_response = f"Error: {deepseek_response}"

        # Synthesize responses
        synthesis_prompt = f"""Two AI models have analyzed the same biomedical question. Synthesize their responses into a unified, comprehensive answer.

## Model 1 (Fast Reasoning) Response:
{maverick_response}

## Model 2 (Deep Logic) Response:
{deepseek_response}

## Task:
Combine the best insights from both responses. Resolve any contradictions by favoring the more logically sound argument. Provide a unified answer with confidence assessment."""

        try:
            synthesized = await self.generate(
                ModelType.LLAMA_MAVERICK,
                synthesis_prompt,
                "You are a synthesis AI that combines multiple perspectives into unified insights.",
                temperature=0.3,
            )
        except Exception as e:
            synthesized = f"Synthesis failed: {e}\n\nMaverick: {maverick_response}\n\nDeepSeek: {deepseek_response}"

        return maverick_response, deepseek_response, synthesized


class DiscoveryAgent:
    """
    A single discovery agent that explores pathways and generates hypotheses.
    """

    def __init__(
        self,
        agent_id: str,
        role: AgentRole,
        model: ModelType,
        llm: BedrockMultiModel,
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
        """Cancel the agent's current work."""
        self._cancelled = True

    async def explore_pathway(
        self,
        disease: str,
        start_entity: str,
        graph_data: dict[str, Any],
        max_depth: int = 4,
    ) -> list[DiscoveryHypothesis]:
        """Explore pathways from a starting entity to find discoveries."""
        if self._cancelled:
            return []

        self.state.current_task = f"Exploring from {start_entity}"
        self.state.last_activity = datetime.utcnow()

        hypotheses = []

        # Get connected entities from graph
        neighbors = graph_data.get("neighbors", {}).get(start_entity, [])

        for neighbor in neighbors[:10]:  # Limit neighbors per agent
            if self._cancelled:
                break

            # Build path
            path = RelationPath(
                entities=[start_entity, neighbor["entity"]],
                relations=[neighbor["relation"]],
                confidence=neighbor.get("confidence", 0.5),
                evidence_count=neighbor.get("evidence_count", 0),
            )

            # Check if we should skip this path
            should_skip, reason = await self.memory.should_skip(path)
            if should_skip:
                continue

            self.state.paths_explored += 1

            # Analyze the pathway
            prompt = f"""Analyze this biological pathway for potential {disease} treatment:

Entity 1: {start_entity}
Relation: {neighbor["relation"]}
Entity 2: {neighbor["entity"]}
Confidence: {path.confidence}
Evidence Count: {path.evidence_count}

Based on this connection, could this pathway lead to a cure or prevention strategy for {disease}?
Provide:
1. Hypothesis (if any)
2. Mechanism of action
3. Confidence score (0-1)
4. Required validation steps

Return as JSON with keys: has_hypothesis, title, description, mechanism, confidence, validation_steps"""

            try:
                if self.role == AgentRole.REASONER:
                    # Use deep reasoning for reasoner agents
                    _, deepseek_resp, _ = await self.llm.collaborative_reasoning(prompt)
                    response = deepseek_resp
                else:
                    response = await self.llm.generate(self.model, prompt)

                # Parse response
                hypothesis = self._parse_hypothesis(response, disease, path)
                if hypothesis:
                    hypotheses.append(hypothesis)
                    self.state.hypotheses_generated += 1

                    # Record successful exploration
                    await self.memory.record_exploration(path, hypothesis.confidence, True)
                else:
                    # Record unsuccessful exploration
                    await self.memory.record_exploration(path, 0.2, False)

            except Exception as e:
                logger.warning(f"Agent {self.id} exploration failed: {e}")
                await self.memory.record_exploration(path, 0.0, False)

        return hypotheses

    def _parse_hypothesis(
        self,
        response: str,
        disease: str,
        path: RelationPath,
    ) -> Optional[DiscoveryHypothesis]:
        """Parse LLM response into a hypothesis."""
        try:
            # Clean response
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
            if confidence < 0.3:  # Skip low confidence
                return None

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
    learning_stats: dict[str, Any]


class DiscoveryOrchestrator(LoggerMixin):
    """
    Main orchestrator for parallel discovery agents.

    Manages thousands of agents running in parallel to explore
    biological pathways and discover disease cures/preventions.
    """

    def __init__(
        self,
        max_agents: int = 1000,
        target_confidence: float = 0.95,
    ):
        self.max_agents = max_agents
        self.target_confidence = target_confidence

        self.state = OrchestratorState.IDLE
        self.llm = BedrockMultiModel()
        self.memory = LearningMemory()

        self._agents: dict[str, DiscoveryAgent] = {}
        self._hypotheses: list[DiscoveryHypothesis] = []
        self._best_confidence = 0.0
        self._start_time: Optional[float] = None
        self._pause_event = asyncio.Event()
        self._pause_event.set()  # Not paused initially
        self._stop_requested = False

        # Callbacks for real-time updates
        self._on_hypothesis: Optional[Callable] = None
        self._on_stats_update: Optional[Callable] = None

        # Graph and RAG connections
        self._graph_store = None
        self._rag_service = None

    async def initialize(self) -> None:
        """Initialize the orchestrator and its dependencies."""
        self.logger.info("Initializing discovery orchestrator")

        await self.llm.initialize()

        # Connect to knowledge graph
        try:
            from app.knowledge.graph_store import get_graph_store
            self._graph_store = get_graph_store()
        except Exception as e:
            self.logger.warning(f"Graph store not available: {e}")

        # Connect to RAG service
        try:
            from app.rag.service import get_rag_service
            self._rag_service = get_rag_service()
        except Exception as e:
            self.logger.warning(f"RAG service not available: {e}")

        # Load learning memory from storage
        await self._load_memory()

        self.logger.info("Discovery orchestrator initialized")

    async def _load_memory(self) -> None:
        """Load learning memory from RAG/storage."""
        if self._rag_service:
            try:
                # Query for stored learning data
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
        """Save learning memory to RAG/storage."""
        # Memory is saved as part of the knowledge graph and RAG
        # This will be fully implemented when database persistence is added
        pass

    def set_callbacks(
        self,
        on_hypothesis: Optional[Callable] = None,
        on_stats_update: Optional[Callable] = None,
    ) -> None:
        """Set callbacks for real-time updates."""
        self._on_hypothesis = on_hypothesis
        self._on_stats_update = on_stats_update

    async def start(
        self,
        disease: str,
        focus_entities: list[str] = None,
        discovery_type: str = "cure",
    ) -> None:
        """
        Start the discovery process.

        Args:
            disease: Target disease to find cures for
            focus_entities: Optional specific entities to focus on
            discovery_type: Type of discovery (cure, prevention, treatment)
        """
        if self.state == OrchestratorState.RUNNING:
            self.logger.warning("Orchestrator already running")
            return

        self.logger.info(f"Starting discovery for {disease}")

        self.state = OrchestratorState.RUNNING
        self._start_time = time.time()
        self._stop_requested = False
        self._hypotheses = []
        self._best_confidence = 0.0

        # Get graph data for exploration
        graph_data = await self._get_graph_data(disease, focus_entities)

        # Create agent pool with different roles
        await self._create_agents()

        # Start parallel exploration
        try:
            await self._run_discovery_loop(disease, graph_data, discovery_type)
        finally:
            self.state = OrchestratorState.IDLE
            await self._save_memory()

    async def _get_graph_data(
        self,
        disease: str,
        focus_entities: list[str] = None,
    ) -> dict[str, Any]:
        """Get graph data for exploration."""
        graph_data = {
            "disease": disease,
            "entities": [],
            "neighbors": {},
        }

        if not self._graph_store:
            # Generate synthetic data for testing
            self.logger.warning("Using synthetic graph data")
            return self._generate_synthetic_graph(disease)

        try:
            # Search for disease-related entities
            entities = await self._graph_store.search_entities(
                disease,
                limit=100,
            )

            graph_data["entities"] = [e.name for e in entities]

            # Get neighborhoods for each entity
            for entity in entities[:20]:  # Limit initial exploration
                neighborhood = await self._graph_store.get_neighborhood(
                    entity.id,
                    depth=2,
                    limit=50,
                )

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

            # Add focus entities
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
        """Generate synthetic graph data for testing."""
        # Common biomedical entities and relations
        entity_types = {
            "genes": ["BRCA1", "TP53", "EGFR", "KRAS", "MYC", "AKT1", "PTEN", "RB1"],
            "proteins": ["p53", "EGFR protein", "HER2", "PD-1", "PD-L1", "VEGF"],
            "drugs": ["Metformin", "Aspirin", "Ibuprofen", "Paclitaxel", "Cisplatin"],
            "pathways": ["Apoptosis", "Cell cycle", "DNA repair", "Immune response"],
        }

        relations = ["inhibits", "activates", "regulates", "binds_to", "treats", "causes"]

        graph_data = {
            "disease": disease,
            "entities": [disease],
            "neighbors": {},
        }

        # Add disease neighbors
        import random
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

        # Add gene neighbors (drugs, proteins)
        for gene in entity_types["genes"][:5]:
            gene_neighbors = []
            for drug in random.sample(entity_types["drugs"], 2):
                gene_neighbors.append({
                    "entity": drug,
                    "relation": random.choice(relations),
                    "confidence": random.uniform(0.3, 0.8),
                    "evidence_count": random.randint(1, 50),
                })
            for protein in random.sample(entity_types["proteins"], 2):
                gene_neighbors.append({
                    "entity": protein,
                    "relation": random.choice(relations),
                    "confidence": random.uniform(0.5, 0.95),
                    "evidence_count": random.randint(5, 200),
                })
            graph_data["neighbors"][gene] = gene_neighbors
            graph_data["entities"].extend([n["entity"] for n in gene_neighbors])

        return graph_data

    async def _create_agents(self) -> None:
        """Create the agent pool with different roles and models."""
        self._agents = {}

        # Distribution of roles
        role_distribution = {
            AgentRole.EXPLORER: 0.4,  # 40% explorers
            AgentRole.REASONER: 0.25,  # 25% deep reasoners
            AgentRole.VALIDATOR: 0.15,  # 15% validators
            AgentRole.SYNTHESIZER: 0.1,  # 10% synthesizers
            AgentRole.CRITIC: 0.1,  # 10% critics
        }

        # Model distribution (alternate between models)
        models = [ModelType.LLAMA_MAVERICK, ModelType.DEEPSEEK_R1]

        for i in range(self.max_agents):
            # Determine role based on distribution
            rand = i / self.max_agents
            cumulative = 0
            role = AgentRole.EXPLORER
            for r, prob in role_distribution.items():
                cumulative += prob
                if rand < cumulative:
                    role = r
                    break

            # Alternate models, with reasoners always using DeepSeek
            if role == AgentRole.REASONER:
                model = ModelType.DEEPSEEK_R1
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

        self.logger.info(f"Created {len(self._agents)} agents")

    async def _run_discovery_loop(
        self,
        disease: str,
        graph_data: dict[str, Any],
        discovery_type: str,
    ) -> None:
        """Main discovery loop running parallel agents."""
        entities = graph_data.get("entities", [])
        if not entities:
            self.logger.warning("No entities to explore")
            return

        batch_size = min(100, len(self._agents))  # Process in batches
        entity_index = 0

        while not self._stop_requested:
            # Check for pause
            await self._pause_event.wait()

            if self._stop_requested:
                break

            # Check if we've reached target confidence
            if self._best_confidence >= self.target_confidence:
                self.logger.info(f"Reached target confidence: {self._best_confidence}")
                break

            # Get batch of agents
            agent_list = list(self._agents.values())
            batch_agents = agent_list[:batch_size]

            # Assign entities to explore
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
                )
                tasks.append(task)

            if not tasks:
                break

            # Run batch in parallel
            results = await asyncio.gather(*tasks, return_exceptions=True)

            # Process results
            for result in results:
                if isinstance(result, Exception):
                    self.logger.warning(f"Agent task failed: {result}")
                    continue

                for hypothesis in result:
                    self._hypotheses.append(hypothesis)

                    if hypothesis.confidence > self._best_confidence:
                        self._best_confidence = hypothesis.confidence

                    # Notify callback
                    if self._on_hypothesis:
                        try:
                            await self._on_hypothesis(hypothesis)
                        except Exception as e:
                            self.logger.warning(f"Hypothesis callback failed: {e}")

            # Update stats callback
            if self._on_stats_update:
                try:
                    stats = self.get_stats()
                    await self._on_stats_update(stats)
                except Exception as e:
                    self.logger.warning(f"Stats callback failed: {e}")

            # Small delay to prevent overwhelming
            await asyncio.sleep(0.1)

        self.logger.info(
            f"Discovery loop ended. Found {len(self._hypotheses)} hypotheses, "
            f"best confidence: {self._best_confidence}"
        )

    def pause(self) -> None:
        """Pause the discovery process."""
        if self.state == OrchestratorState.RUNNING:
            self.state = OrchestratorState.PAUSED
            self._pause_event.clear()
            self.logger.info("Discovery paused")

    def resume(self) -> None:
        """Resume the discovery process."""
        if self.state == OrchestratorState.PAUSED:
            self.state = OrchestratorState.RUNNING
            self._pause_event.set()
            self.logger.info("Discovery resumed")

    def stop(self) -> None:
        """Stop the discovery process."""
        self._stop_requested = True
        self._pause_event.set()  # Unpause to allow clean exit
        self.state = OrchestratorState.STOPPING

        # Cancel all agents
        for agent in self._agents.values():
            agent.cancel()

        self.logger.info("Discovery stopping")

    def get_stats(self) -> DiscoveryOrchestratorStats:
        """Get current orchestrator statistics."""
        active_agents = sum(1 for a in self._agents.values() if a.state.is_active)
        paths_explored = sum(a.state.paths_explored for a in self._agents.values())

        agents_by_role = {}
        for agent in self._agents.values():
            role = agent.role.value
            agents_by_role[role] = agents_by_role.get(role, 0) + 1

        high_confidence = sum(1 for h in self._hypotheses if h.confidence >= 0.7)

        runtime = time.time() - self._start_time if self._start_time else 0

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
            learning_stats=self.memory.get_stats(),
        )

    def get_hypotheses(
        self,
        min_confidence: float = 0.0,
        limit: int = 100,
    ) -> list[DiscoveryHypothesis]:
        """Get discovered hypotheses, sorted by confidence."""
        filtered = [h for h in self._hypotheses if h.confidence >= min_confidence]
        filtered.sort(key=lambda h: h.confidence, reverse=True)
        return filtered[:limit]


# Global orchestrator instance
_orchestrator: Optional[DiscoveryOrchestrator] = None


async def get_orchestrator() -> DiscoveryOrchestrator:
    """Get or create the global orchestrator."""
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
) -> DiscoveryOrchestrator:
    """Start a new discovery process."""
    global _orchestrator

    _orchestrator = DiscoveryOrchestrator(
        max_agents=max_agents,
        target_confidence=target_confidence,
    )
    await _orchestrator.initialize()

    # Start in background
    asyncio.create_task(
        _orchestrator.start(disease, focus_entities, discovery_type)
    )

    return _orchestrator
