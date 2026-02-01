"""
Ingestion Orchestrator

Coordinates multiple ingestion agents for comprehensive data collection
from various biomedical sources.
"""

import asyncio
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
from uuid import uuid4

from app.agents.ingestion.base import (
    IngestionAgent,
    IngestionConfig,
    IngestionMetrics,
    IngestionState,
    SourceType,
)
from app.agents.ingestion.clinical_trials_agent import (
    ClinicalTrialsConfig,
    ClinicalTrialsIngestionAgent,
)
from app.agents.ingestion.custom_document_agent import (
    CustomDocumentConfig,
    CustomDocumentIngestionAgent,
)
from app.agents.ingestion.patents_agent import PatentsConfig, PatentsIngestionAgent
from app.agents.ingestion.preprint_agent import PreprintConfig, PreprintIngestionAgent
from app.agents.ingestion.pubmed_agent import PubMedConfig, PubMedIngestionAgent
from app.core.logging import get_logger

logger = get_logger(__name__)


@dataclass
class OrchestratorMetrics:
    """Aggregated metrics from all ingestion agents."""

    total_records_fetched: int = 0
    total_records_processed: int = 0
    total_records_indexed: int = 0
    total_records_failed: int = 0
    total_entities_extracted: int = 0
    total_relations_extracted: int = 0
    total_api_calls: int = 0
    total_bytes_downloaded: int = 0
    sources_completed: int = 0
    sources_failed: int = 0
    start_time: datetime | None = None
    end_time: datetime | None = None
    source_metrics: dict[str, IngestionMetrics] = field(default_factory=dict)

    @property
    def duration_seconds(self) -> float:
        if not self.start_time:
            return 0.0
        end = self.end_time or datetime.utcnow()
        return (end - self.start_time).total_seconds()

    def add_agent_metrics(self, source_type: str, metrics: IngestionMetrics) -> None:
        """Add metrics from a completed agent."""
        self.source_metrics[source_type] = metrics
        self.total_records_fetched += metrics.records_fetched
        self.total_records_processed += metrics.records_processed
        self.total_records_indexed += metrics.records_indexed
        self.total_records_failed += metrics.records_failed
        self.total_entities_extracted += metrics.entities_extracted
        self.total_relations_extracted += metrics.relations_extracted
        self.total_api_calls += metrics.api_calls_made
        self.total_bytes_downloaded += metrics.bytes_downloaded

    def to_dict(self) -> dict[str, Any]:
        return {
            "total_records_fetched": self.total_records_fetched,
            "total_records_processed": self.total_records_processed,
            "total_records_indexed": self.total_records_indexed,
            "total_records_failed": self.total_records_failed,
            "total_entities_extracted": self.total_entities_extracted,
            "total_relations_extracted": self.total_relations_extracted,
            "total_api_calls": self.total_api_calls,
            "total_bytes_downloaded": self.total_bytes_downloaded,
            "sources_completed": self.sources_completed,
            "sources_failed": self.sources_failed,
            "duration_seconds": self.duration_seconds,
            "source_metrics": {k: v.to_dict() for k, v in self.source_metrics.items()},
        }


class IngestionOrchestrator:
    """
    Orchestrates multiple ingestion agents for comprehensive data collection.

    Features:
    - Parallel or sequential ingestion from multiple sources
    - Unified configuration management
    - Aggregated metrics and progress tracking
    - Deduplication across sources
    - Error handling and retry logic
    """

    def __init__(
        self,
        sources: list[SourceType] | None = None,
        parallel: bool = True,
        max_concurrent: int = 3,
    ):
        """
        Initialize the orchestrator.

        Args:
            sources: List of source types to use (default: all)
            parallel: Whether to run agents in parallel
            max_concurrent: Maximum concurrent agents when parallel
        """
        self.sources = sources or [
            SourceType.PUBMED,
            SourceType.CLINICAL_TRIALS,
            SourceType.PATENTS,
            SourceType.PREPRINT,
        ]
        self.parallel = parallel
        self.max_concurrent = max_concurrent

        self._agents: dict[SourceType, IngestionAgent] = {}
        self._metrics = OrchestratorMetrics()
        self._seen_hashes: set[str] = set()
        self._progress_callback: Callable | None = None

        self.logger = logger

    def _create_agent(
        self,
        source_type: SourceType,
        config: IngestionConfig | None = None,
    ) -> IngestionAgent:
        """Create an agent for the given source type."""
        agent_map = {
            SourceType.PUBMED: (PubMedIngestionAgent, PubMedConfig),
            SourceType.CLINICAL_TRIALS: (ClinicalTrialsIngestionAgent, ClinicalTrialsConfig),
            SourceType.PATENTS: (PatentsIngestionAgent, PatentsConfig),
            SourceType.PREPRINT: (PreprintIngestionAgent, PreprintConfig),
            SourceType.CUSTOM_DOCUMENT: (CustomDocumentIngestionAgent, CustomDocumentConfig),
        }

        if source_type not in agent_map:
            raise ValueError(f"Unknown source type: {source_type}")

        agent_class, config_class = agent_map[source_type]

        # Create config if not provided
        if config is None:
            config = config_class()
        elif not isinstance(config, config_class):
            # Convert generic config to specific config
            config = config_class(**config.model_dump())

        return agent_class(config=config)

    def configure_source(
        self,
        source_type: SourceType,
        config: IngestionConfig,
    ) -> None:
        """
        Configure a specific source with custom settings.

        Args:
            source_type: Source to configure
            config: Configuration for the source
        """
        self._agents[source_type] = self._create_agent(source_type, config)

    def set_progress_callback(
        self,
        callback: Callable[[str, IngestionState], None],
    ) -> None:
        """
        Set callback for progress updates.

        Callback receives (source_type, state) for each update.
        """
        self._progress_callback = callback

    async def ingest(
        self,
        query: str,
        max_results_per_source: int = 100,
        extract_entities: bool = True,
        extract_relations: bool = True,
        index_to_stores: bool = True,
    ) -> dict[str, Any]:
        """
        Run ingestion from all configured sources.

        Args:
            query: Search query
            max_results_per_source: Maximum results per source
            extract_entities: Whether to extract entities
            extract_relations: Whether to extract relations
            index_to_stores: Whether to index to vector/graph stores

        Returns:
            Dict with results and metrics
        """
        self._metrics = OrchestratorMetrics()
        self._metrics.start_time = datetime.utcnow()
        self._seen_hashes = set()

        job_id = str(uuid4())

        self.logger.info(
            "Starting orchestrated ingestion",
            job_id=job_id,
            sources=[s.value for s in self.sources],
            query=query[:50],
        )

        # Create agents for sources that don't have custom configs
        for source_type in self.sources:
            if source_type not in self._agents:
                config = IngestionConfig(
                    query=query,
                    max_results=max_results_per_source,
                    extract_entities=extract_entities,
                    extract_relations=extract_relations,
                    index_to_vector_store=index_to_stores,
                    index_to_graph_store=index_to_stores,
                )
                self._agents[source_type] = self._create_agent(source_type, config)
            else:
                # Update query on existing agent
                self._agents[source_type].config.query = query
                self._agents[source_type].config.max_results = max_results_per_source

        # Run agents
        if self.parallel:
            results = await self._run_parallel()
        else:
            results = await self._run_sequential()

        self._metrics.end_time = datetime.utcnow()

        self.logger.info(
            "Orchestrated ingestion complete",
            job_id=job_id,
            sources_completed=self._metrics.sources_completed,
            sources_failed=self._metrics.sources_failed,
            total_records=self._metrics.total_records_indexed,
            duration_s=round(self._metrics.duration_seconds, 2),
        )

        return {
            "job_id": job_id,
            "query": query,
            "sources": [s.value for s in self.sources],
            "metrics": self._metrics.to_dict(),
            "results": results,
        }

    async def _run_parallel(self) -> dict[str, Any]:
        """Run agents in parallel with concurrency limit."""
        semaphore = asyncio.Semaphore(self.max_concurrent)
        results = {}

        async def run_with_semaphore(source_type: SourceType):
            async with semaphore:
                return await self._run_agent(source_type)

        tasks = [run_with_semaphore(source_type) for source_type in self.sources]

        agent_results = await asyncio.gather(*tasks, return_exceptions=True)

        for source_type, result in zip(self.sources, agent_results):
            if isinstance(result, Exception):
                self.logger.error(
                    "Agent failed with exception",
                    source=source_type.value,
                    error=str(result),
                )
                results[source_type.value] = {"success": False, "error": str(result)}
                self._metrics.sources_failed += 1
            else:
                results[source_type.value] = result

        return results

    async def _run_sequential(self) -> dict[str, Any]:
        """Run agents sequentially."""
        results = {}

        for source_type in self.sources:
            try:
                result = await self._run_agent(source_type)
                results[source_type.value] = result
            except Exception as e:
                self.logger.error(
                    "Agent failed with exception",
                    source=source_type.value,
                    error=str(e),
                )
                results[source_type.value] = {"success": False, "error": str(e)}
                self._metrics.sources_failed += 1

        return results

    async def _run_agent(self, source_type: SourceType) -> dict[str, Any]:
        """Run a single agent and collect results."""
        agent = self._agents.get(source_type)
        if not agent:
            return {"success": False, "error": "Agent not configured"}

        self.logger.info("Starting agent", source=source_type.value)

        # Set up progress callback
        if self._progress_callback:

            def agent_progress(state: IngestionState):
                self._progress_callback(source_type.value, state)

            agent.set_progress_callback(agent_progress)

        try:
            from app.agents.base import AgentContext

            context = AgentContext(query=agent.config.query)
            result = await agent.run(agent.config.query, context)

            if result.success:
                self._metrics.sources_completed += 1
                self._metrics.add_agent_metrics(source_type.value, agent.state.metrics)

                return {
                    "success": True,
                    "records_count": agent.state.metrics.records_indexed,
                    "metrics": agent.state.metrics.to_dict(),
                }
            else:
                self._metrics.sources_failed += 1
                return {
                    "success": False,
                    "error": result.error,
                    "metrics": agent.state.metrics.to_dict() if agent.state else {},
                }

        except Exception as e:
            self._metrics.sources_failed += 1
            self.logger.error("Agent execution failed", source=source_type.value, error=str(e))
            return {"success": False, "error": str(e)}

        finally:
            # Clean up agent resources
            if hasattr(agent, "close"):
                await agent.close()

    async def ingest_from_source(
        self,
        source_type: SourceType,
        query: str,
        config: IngestionConfig | None = None,
    ) -> dict[str, Any]:
        """
        Ingest from a single specific source.

        Args:
            source_type: Source to ingest from
            query: Search query
            config: Optional custom configuration

        Returns:
            Dict with results and metrics
        """
        if config:
            self.configure_source(source_type, config)

        # Temporarily set sources to just this one
        original_sources = self.sources
        self.sources = [source_type]

        try:
            return await self.ingest(query)
        finally:
            self.sources = original_sources

    async def add_custom_document(
        self,
        content: bytes,
        filename: str,
        metadata: dict[str, Any] | None = None,
    ) -> str:
        """
        Add a custom document for ingestion.

        Args:
            content: Document content
            filename: Filename
            metadata: Optional metadata

        Returns:
            Document ID
        """
        if SourceType.CUSTOM_DOCUMENT not in self._agents:
            self._agents[SourceType.CUSTOM_DOCUMENT] = self._create_agent(
                SourceType.CUSTOM_DOCUMENT
            )

        agent = self._agents[SourceType.CUSTOM_DOCUMENT]
        return agent.add_document(content, filename, metadata)

    def get_metrics(self) -> OrchestratorMetrics:
        """Get current aggregated metrics."""
        return self._metrics

    def get_agent(self, source_type: SourceType) -> IngestionAgent | None:
        """Get a specific agent instance."""
        return self._agents.get(source_type)

    async def close(self) -> None:
        """Close all agent resources."""
        for agent in self._agents.values():
            if hasattr(agent, "close"):
                try:
                    await agent.close()
                except Exception as e:
                    self.logger.warning("Error closing agent", error=str(e))

        self._agents.clear()


# Convenience function
async def quick_ingest(
    query: str,
    sources: list[str] | None = None,
    max_results: int = 50,
) -> dict[str, Any]:
    """
    Quick ingestion from multiple sources.

    Args:
        query: Search query
        sources: List of source names (default: pubmed, clinical_trials)
        max_results: Maximum results per source

    Returns:
        Ingestion results
    """
    source_types = []
    source_map = {
        "pubmed": SourceType.PUBMED,
        "clinical_trials": SourceType.CLINICAL_TRIALS,
        "patents": SourceType.PATENTS,
        "preprint": SourceType.PREPRINT,
    }

    for source_name in sources or ["pubmed", "clinical_trials"]:
        if source_name in source_map:
            source_types.append(source_map[source_name])

    orchestrator = IngestionOrchestrator(sources=source_types)

    try:
        return await orchestrator.ingest(
            query=query,
            max_results_per_source=max_results,
        )
    finally:
        await orchestrator.close()
