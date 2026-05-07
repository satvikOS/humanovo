"""
Base Ingestion Agent

Abstract base class for all ingestion agents with common functionality
for fetching, processing, and storing biomedical data.
"""

import asyncio
import hashlib
import time
from abc import ABC, abstractmethod
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from typing import (
    Any,
    TypeVar,
)
from uuid import UUID, uuid4

from pydantic import BaseModel, Field

from app.agents.base import (
    AgentContext,
    AgentResult,
    AgentType,
    BaseAgent,
    Tool,
)
from app.core.logging import get_logger

logger = get_logger(__name__)

T = TypeVar("T")


class IngestionStatus(StrEnum):
    """Status of an ingestion operation."""

    PENDING = "pending"
    FETCHING = "fetching"
    PROCESSING = "processing"
    EXTRACTING = "extracting"
    INDEXING = "indexing"
    COMPLETED = "completed"
    FAILED = "failed"
    PAUSED = "paused"
    RATE_LIMITED = "rate_limited"


class SourceType(StrEnum):
    """Types of data sources for ingestion."""

    PUBMED = "pubmed"
    CLINICAL_TRIALS = "clinical_trials"
    PATENTS = "patents"
    PREPRINT = "preprint"
    CUSTOM_DOCUMENT = "custom_document"
    FDA_LABELS = "fda_labels"
    GUIDELINES = "guidelines"


@dataclass
class IngestionMetrics:
    """Metrics for tracking ingestion performance."""

    records_fetched: int = 0
    records_processed: int = 0
    records_indexed: int = 0
    records_skipped: int = 0
    records_failed: int = 0
    entities_extracted: int = 0
    relations_extracted: int = 0
    api_calls_made: int = 0
    bytes_downloaded: int = 0
    rate_limit_hits: int = 0
    start_time: datetime | None = None
    end_time: datetime | None = None

    @property
    def duration_seconds(self) -> float:
        if not self.start_time:
            return 0.0
        end = self.end_time or datetime.now(UTC)
        return (end - self.start_time).total_seconds()

    @property
    def records_per_second(self) -> float:
        if self.duration_seconds == 0:
            return 0.0
        return self.records_processed / self.duration_seconds

    def to_dict(self) -> dict[str, Any]:
        return {
            "records_fetched": self.records_fetched,
            "records_processed": self.records_processed,
            "records_indexed": self.records_indexed,
            "records_skipped": self.records_skipped,
            "records_failed": self.records_failed,
            "entities_extracted": self.entities_extracted,
            "relations_extracted": self.relations_extracted,
            "api_calls_made": self.api_calls_made,
            "bytes_downloaded": self.bytes_downloaded,
            "rate_limit_hits": self.rate_limit_hits,
            "duration_seconds": self.duration_seconds,
            "records_per_second": self.records_per_second,
        }


class IngestionConfig(BaseModel):
    """Configuration for an ingestion agent."""

    # Query parameters
    query: str = ""
    keywords: list[str] = Field(default_factory=list)
    date_from: datetime | None = None
    date_to: datetime | None = None

    # Fetch limits
    max_results: int = 1000
    batch_size: int = 100

    # Rate limiting
    requests_per_second: float = 3.0
    max_retries: int = 3
    retry_delay_seconds: float = 1.0

    # Processing options
    extract_entities: bool = True
    extract_relations: bool = True
    extract_full_text: bool = False

    # Indexing options
    index_to_vector_store: bool = True
    index_to_graph_store: bool = True

    # Deduplication
    skip_existing: bool = True
    content_hash_check: bool = True

    # Filtering
    min_abstract_length: int = 50
    required_fields: list[str] = Field(default_factory=lambda: ["title", "abstract"])
    language_filter: list[str] = Field(default_factory=lambda: ["en"])

    # Metadata
    project_id: UUID | None = None
    tags: list[str] = Field(default_factory=list)
    priority: int = 5  # 1-10, higher = more important


@dataclass
class IngestionRecord:
    """A record fetched during ingestion."""

    record_id: str
    source_type: SourceType
    source_id: str  # ID from the source (e.g., PMID, NCT ID)
    title: str
    abstract: str | None = None
    full_text: str | None = None
    authors: list[str] = field(default_factory=list)
    publication_date: datetime | None = None
    url: str | None = None
    doi: str | None = None
    keywords: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)
    content_hash: str | None = None
    fetched_at: datetime = field(default_factory=datetime.utcnow)

    def compute_content_hash(self) -> str:
        """Compute hash for deduplication."""
        content = f"{self.title}|{self.abstract or ''}|{self.doi or ''}"
        self.content_hash = hashlib.sha256(content.encode()).hexdigest()
        return self.content_hash

    def get_text(self) -> str:
        """Get combined text for processing."""
        parts = [self.title]
        if self.abstract:
            parts.append(self.abstract)
        if self.full_text:
            parts.append(self.full_text)
        return "\n\n".join(parts)

    def to_dict(self) -> dict[str, Any]:
        return {
            "record_id": self.record_id,
            "source_type": self.source_type.value,
            "source_id": self.source_id,
            "title": self.title,
            "abstract": self.abstract,
            "authors": self.authors,
            "publication_date": self.publication_date.isoformat()
            if self.publication_date
            else None,
            "url": self.url,
            "doi": self.doi,
            "keywords": self.keywords,
            "metadata": self.metadata,
            "content_hash": self.content_hash,
            "fetched_at": self.fetched_at.isoformat(),
        }


@dataclass
class IngestionState:
    """State tracking for resumable ingestion."""

    job_id: str
    source_type: SourceType
    config: IngestionConfig
    status: IngestionStatus = IngestionStatus.PENDING
    metrics: IngestionMetrics = field(default_factory=IngestionMetrics)
    last_cursor: str | None = None  # For pagination
    last_record_id: str | None = None
    processed_ids: set[str] = field(default_factory=set)
    error_message: str | None = None
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)

    def to_dict(self) -> dict[str, Any]:
        return {
            "job_id": self.job_id,
            "source_type": self.source_type.value,
            "status": self.status.value,
            "metrics": self.metrics.to_dict(),
            "last_cursor": self.last_cursor,
            "last_record_id": self.last_record_id,
            "processed_count": len(self.processed_ids),
            "error_message": self.error_message,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }


class IngestionAgent(BaseAgent, ABC):
    """
    Abstract base class for ingestion agents.

    Provides common functionality for:
    - Rate-limited API calls
    - Batch processing
    - Entity and relation extraction
    - Vector and graph indexing
    - Progress tracking and resumption
    - Error handling and retries
    """

    agent_type: AgentType = AgentType.EXTRACTION
    source_type: SourceType = SourceType.PUBMED  # Override in subclasses
    description: str = "Base ingestion agent"

    def __init__(
        self,
        config: IngestionConfig | None = None,
        max_iterations: int = 100,
        timeout_seconds: int = 3600,  # 1 hour default
    ):
        super().__init__(max_iterations=max_iterations, timeout_seconds=timeout_seconds)
        self.config = config or IngestionConfig()
        self.state: IngestionState | None = None
        self._last_request_time: float = 0
        self._rate_limit_delay: float = 1.0 / self.config.requests_per_second
        self._seen_hashes: set[str] = set()
        self._progress_callback: Callable[[IngestionState], None] | None = None

    def _setup_tools(self) -> None:
        """Set up tools for ingestion agent."""
        self.register_tool(
            Tool(
                name="fetch_records",
                description="Fetch records from the data source",
                parameters={"query": "str", "max_results": "int"},
                handler=self._fetch_records_tool,
            )
        )
        self.register_tool(
            Tool(
                name="process_record",
                description="Process a single record (extraction, enrichment)",
                parameters={"record": "IngestionRecord"},
                handler=self._process_record_tool,
            )
        )
        self.register_tool(
            Tool(
                name="index_record",
                description="Index a record to vector and graph stores",
                parameters={"record": "IngestionRecord"},
                handler=self._index_record_tool,
            )
        )

    async def _rate_limit(self) -> None:
        """Apply rate limiting between API calls."""
        elapsed = time.time() - self._last_request_time
        if elapsed < self._rate_limit_delay:
            await asyncio.sleep(self._rate_limit_delay - elapsed)
        self._last_request_time = time.time()

    async def _retry_with_backoff(
        self,
        func: Callable,
        *args,
        **kwargs,
    ) -> Any:
        """Execute function with exponential backoff retry."""
        last_error = None
        for attempt in range(self.config.max_retries):
            try:
                return await func(*args, **kwargs)
            except Exception as e:
                last_error = e
                if attempt < self.config.max_retries - 1:
                    delay = self.config.retry_delay_seconds * (2**attempt)
                    self.logger.warning(
                        "Retry attempt",
                        attempt=attempt + 1,
                        delay=delay,
                        error=str(e),
                    )
                    await asyncio.sleep(delay)
        raise last_error

    @abstractmethod
    async def fetch_batch(
        self,
        query: str,
        offset: int = 0,
        limit: int = 100,
        **kwargs,
    ) -> tuple[list[IngestionRecord], str | None]:
        """
        Fetch a batch of records from the source.

        Args:
            query: Search query
            offset: Starting offset
            limit: Maximum records to fetch
            **kwargs: Source-specific parameters

        Returns:
            Tuple of (records, next_cursor)
        """
        pass

    @abstractmethod
    async def fetch_by_id(self, source_id: str) -> IngestionRecord | None:
        """
        Fetch a specific record by its source ID.

        Args:
            source_id: The ID in the source system (e.g., PMID)

        Returns:
            IngestionRecord or None
        """
        pass

    async def _fetch_records_tool(
        self,
        query: str,
        max_results: int = 100,
    ) -> list[IngestionRecord]:
        """Tool handler for fetching records."""
        records = []
        cursor = None
        offset = 0

        while len(records) < max_results:
            await self._rate_limit()
            batch, cursor = await self.fetch_batch(
                query=query,
                offset=offset,
                limit=min(self.config.batch_size, max_results - len(records)),
            )

            if not batch:
                break

            records.extend(batch)
            self.state.metrics.records_fetched += len(batch)
            self.state.metrics.api_calls_made += 1
            offset += len(batch)

            if cursor:
                self.state.last_cursor = cursor

        return records

    async def _process_record_tool(
        self,
        record: IngestionRecord,
    ) -> IngestionRecord:
        """Tool handler for processing a record."""
        # Compute content hash for deduplication
        content_hash = record.compute_content_hash()

        # Skip if already seen
        if self.config.content_hash_check and content_hash in self._seen_hashes:
            self.state.metrics.records_skipped += 1
            return record

        self._seen_hashes.add(content_hash)

        # Extract entities if enabled
        if self.config.extract_entities:
            entities = await self._extract_entities(record)
            record.metadata["entities"] = entities
            self.state.metrics.entities_extracted += len(entities)

        # Extract relations if enabled
        if self.config.extract_relations:
            relations = await self._extract_relations(record)
            record.metadata["relations"] = relations
            self.state.metrics.relations_extracted += len(relations)

        self.state.metrics.records_processed += 1
        return record

    async def _extract_entities(
        self,
        record: IngestionRecord,
    ) -> list[dict[str, Any]]:
        """Extract biomedical entities from record text."""
        try:
            from app.nlp.pipeline import NLPPipeline

            pipeline = NLPPipeline()
            text = record.get_text()
            result = await pipeline.process(text)

            return [
                {
                    "text": ent.text,
                    "type": ent.entity_type,
                    "start": ent.start,
                    "end": ent.end,
                    "confidence": ent.confidence,
                    "normalized_id": ent.normalized_id,
                }
                for ent in result.entities
            ]
        except Exception as e:
            self.logger.warning("Entity extraction failed", error=str(e))
            return []

    async def _extract_relations(
        self,
        record: IngestionRecord,
    ) -> list[dict[str, Any]]:
        """Extract relations between entities."""
        try:
            from app.nlp.relation_extractor import RelationExtractor

            extractor = RelationExtractor()
            entities = record.metadata.get("entities", [])
            if not entities:
                return []

            text = record.get_text()
            relations = await extractor.extract(text, entities)

            return [
                {
                    "subject": rel.subject,
                    "predicate": rel.predicate,
                    "object": rel.object,
                    "confidence": rel.confidence,
                    "evidence": rel.evidence_text,
                }
                for rel in relations
            ]
        except Exception as e:
            self.logger.warning("Relation extraction failed", error=str(e))
            return []

    async def _index_record_tool(
        self,
        record: IngestionRecord,
    ) -> bool:
        """Tool handler for indexing a record."""
        success = True

        # Index to vector store
        if self.config.index_to_vector_store:
            try:
                await self._index_to_vector_store(record)
            except Exception as e:
                self.logger.warning("Vector indexing failed", error=str(e))
                success = False

        # Index to graph store
        if self.config.index_to_graph_store:
            try:
                await self._index_to_graph_store(record)
            except Exception as e:
                self.logger.warning("Graph indexing failed", error=str(e))
                success = False

        if success:
            self.state.metrics.records_indexed += 1

        return success

    async def _index_to_vector_store(
        self,
        record: IngestionRecord,
    ) -> None:
        """Index record to vector store."""
        try:
            from app.knowledge.vector_store import get_vector_store

            store = get_vector_store()
            await store.add_document(
                content=record.get_text(),
                metadata={
                    "source_type": record.source_type.value,
                    "source_id": record.source_id,
                    "title": record.title,
                    "url": record.url,
                    "authors": record.authors,
                    "publication_date": record.publication_date.isoformat()
                    if record.publication_date
                    else None,
                    "doi": record.doi,
                    "keywords": record.keywords,
                    "content_hash": record.content_hash,
                },
                doc_id=f"{record.source_type.value}:{record.source_id}",
            )
        except RuntimeError:
            self.logger.debug("Vector store not initialized, skipping")

    async def _index_to_graph_store(
        self,
        record: IngestionRecord,
    ) -> None:
        """Index entities and relations to graph store."""
        try:
            from app.knowledge.graph_store import Entity, Relation, get_graph_store

            store = get_graph_store()
            entities = record.metadata.get("entities", [])
            relations = record.metadata.get("relations", [])

            # Add entities as nodes
            entity_id_map = {}
            for ent in entities:
                entity_id = f"{ent['type']}:{ent['text'].lower().replace(' ', '_')}"
                entity = Entity(
                    id=entity_id,
                    name=ent["text"],
                    entity_type=ent["type"],
                    source_count=1,
                )
                await store.add_entity(entity)
                entity_id_map[ent["text"]] = entity_id

            # Add relations as edges
            for rel in relations:
                subject_id = entity_id_map.get(rel["subject"])
                object_id = entity_id_map.get(rel["object"])

                if subject_id and object_id:
                    relation = Relation(
                        id=str(uuid4()),
                        source_id=subject_id,
                        source_name=rel["subject"],
                        target_id=object_id,
                        target_name=rel["object"],
                        relation_type=rel["predicate"],
                        confidence=rel.get("confidence", 0.7),
                        source_references=[f"{record.source_type.value}:{record.source_id}"],
                    )
                    await store.add_relation(relation)

        except RuntimeError:
            self.logger.debug("Graph store not initialized, skipping")

    def _is_valid_record(self, record: IngestionRecord) -> bool:
        """Check if record meets validation criteria."""
        # Check required fields
        for field_name in self.config.required_fields:
            value = getattr(record, field_name, None)
            if not value:
                return False

        # Check abstract length
        if record.abstract and len(record.abstract) < self.config.min_abstract_length:
            return False

        return True

    async def execute(
        self,
        context: AgentContext,
        **kwargs,
    ) -> AgentResult:
        """Execute the ingestion agent."""
        # Initialize state
        self.state = IngestionState(
            job_id=str(uuid4()),
            source_type=self.source_type,
            config=self.config,
            status=IngestionStatus.FETCHING,
        )
        self.state.metrics.start_time = datetime.now(UTC)

        query = self.config.query or context.query

        self.logger.info(
            "Starting ingestion",
            source=self.source_type.value,
            query=query[:50] if query else "N/A",
            max_results=self.config.max_results,
        )

        try:
            # Fetch records in batches
            self.state.status = IngestionStatus.FETCHING
            records = await self._fetch_records_tool(
                query=query,
                max_results=self.config.max_results,
            )

            self.record_step(
                action="fetch_records",
                input_data={"query": query, "max_results": self.config.max_results},
                output_data={"records_fetched": len(records)},
            )

            # Process records
            self.state.status = IngestionStatus.PROCESSING
            processed_records = []
            for record in records:
                if not self._is_valid_record(record):
                    self.state.metrics.records_skipped += 1
                    continue

                try:
                    processed = await self._process_record_tool(record)
                    processed_records.append(processed)
                except Exception as e:
                    self.logger.warning(
                        "Record processing failed",
                        record_id=record.record_id,
                        error=str(e),
                    )
                    self.state.metrics.records_failed += 1

                # Update progress
                if self._progress_callback:
                    self._progress_callback(self.state)

            self.record_step(
                action="process_records",
                input_data={"records_count": len(records)},
                output_data={"processed_count": len(processed_records)},
            )

            # Index records
            self.state.status = IngestionStatus.INDEXING
            for record in processed_records:
                try:
                    await self._index_record_tool(record)
                    self.state.processed_ids.add(record.record_id)
                except Exception as e:
                    self.logger.warning(
                        "Record indexing failed",
                        record_id=record.record_id,
                        error=str(e),
                    )

            self.record_step(
                action="index_records",
                input_data={"records_count": len(processed_records)},
                output_data={"indexed_count": self.state.metrics.records_indexed},
            )

            # Complete
            self.state.status = IngestionStatus.COMPLETED
            self.state.metrics.end_time = datetime.now(UTC)

            self.logger.info(
                "Ingestion completed",
                source=self.source_type.value,
                metrics=self.state.metrics.to_dict(),
            )

            return AgentResult(
                success=True,
                data={
                    "job_id": self.state.job_id,
                    "source_type": self.source_type.value,
                    "metrics": self.state.metrics.to_dict(),
                    "records": [r.to_dict() for r in processed_records[:10]],  # Sample
                },
            )

        except Exception as e:
            self.state.status = IngestionStatus.FAILED
            self.state.error_message = str(e)
            self.state.metrics.end_time = datetime.now(UTC)

            self.logger.error(
                "Ingestion failed",
                source=self.source_type.value,
                error=str(e),
            )

            return AgentResult(
                success=False,
                error=str(e),
                data={
                    "job_id": self.state.job_id,
                    "metrics": self.state.metrics.to_dict(),
                },
            )

    def set_progress_callback(
        self,
        callback: Callable[[IngestionState], None],
    ) -> None:
        """Set callback for progress updates."""
        self._progress_callback = callback

    async def resume(
        self,
        state: IngestionState,
    ) -> AgentResult:
        """Resume a paused or failed ingestion job."""
        self.state = state
        self.state.status = IngestionStatus.FETCHING
        self._seen_hashes = set()  # Reset for resumption

        # Restore seen hashes from processed IDs if available
        # This would ideally load from persistent storage

        context = AgentContext(query=state.config.query)
        return await self.execute(context)
