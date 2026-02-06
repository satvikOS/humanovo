"""
GenUp Knowledge Engine

The Holy Bible of Healthcare - A continuously updating, deduplicated
knowledge base that aggregates biomedical data from multiple sources.

Features:
- Continuous ingestion from PubMed, ClinicalTrials, and more
- Content deduplication using hash + semantic similarity
- Incremental embedding updates
- Knowledge versioning and lineage tracking
"""

import asyncio
import hashlib
import json
from datetime import datetime, timedelta
from enum import Enum
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, Field

from app.core.logging import get_logger

logger = get_logger(__name__)


class KnowledgeStatus(str, Enum):
    """Status of a knowledge record."""
    PENDING = "pending"
    PROCESSING = "processing"
    INDEXED = "indexed"
    DUPLICATE = "duplicate"
    FAILED = "failed"
    STALE = "stale"


class KnowledgeSource(str, Enum):
    """Sources of knowledge."""
    PUBMED = "pubmed"
    CLINICAL_TRIALS = "clinical_trials"
    DRUGBANK = "drugbank"
    UNIPROT = "uniprot"
    GENE_ONTOLOGY = "gene_ontology"
    USER_UPLOAD = "user_upload"
    PREPRINT = "preprint"


class KnowledgeRecord(BaseModel):
    """A single piece of knowledge in the GenUp bible."""

    id: str = Field(default_factory=lambda: str(uuid4()))
    content_hash: str  # MD5 of normalized content for dedup
    semantic_hash: str | None = None  # Hash of embedding for semantic dedup

    # Content
    title: str
    content: str
    abstract: str | None = None

    # Source tracking
    source: KnowledgeSource
    source_id: str  # Original ID from source (PMID, NCT, etc.)
    source_url: str | None = None

    # Metadata
    authors: list[str] = []
    publication_date: datetime | None = None
    keywords: list[str] = []
    mesh_terms: list[str] = []
    entities: list[dict[str, Any]] = []  # Extracted entities
    relations: list[dict[str, Any]] = []  # Extracted relations

    # Processing status
    status: KnowledgeStatus = KnowledgeStatus.PENDING
    embedding_id: str | None = None
    graph_node_id: str | None = None

    # Versioning
    version: int = 1
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    supersedes: str | None = None  # ID of previous version

    # Quality metrics
    citation_count: int = 0
    relevance_score: float = 0.0
    quality_score: float = 0.0


class IngestionJob(BaseModel):
    """A scheduled ingestion job."""

    id: str = Field(default_factory=lambda: str(uuid4()))
    source: KnowledgeSource
    query: str
    priority: int = 0  # Higher = more important

    # Scheduling
    scheduled_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None

    # Results
    records_fetched: int = 0
    records_indexed: int = 0
    records_deduplicated: int = 0
    records_failed: int = 0

    # Status
    status: str = "pending"
    error: str | None = None


class DeduplicationResult(BaseModel):
    """Result of deduplication check."""

    is_duplicate: bool
    duplicate_of: str | None = None
    similarity_score: float = 0.0
    method: str = "none"  # "hash", "semantic", "none"


class KnowledgeEngine:
    """
    The GenUp Knowledge Engine - continuously building the Holy Bible of Healthcare.

    This engine:
    1. Schedules and runs ingestion jobs from multiple sources
    2. Deduplicates incoming records using hash + semantic similarity
    3. Extracts entities and relations
    4. Generates and stores embeddings
    5. Maintains versioned knowledge records
    6. Provides fast retrieval with caching
    """

    # Deduplication thresholds
    SEMANTIC_SIMILARITY_THRESHOLD = 0.92  # Above this = duplicate
    TITLE_SIMILARITY_THRESHOLD = 0.85

    # Ingestion settings
    DEFAULT_BATCH_SIZE = 100
    MAX_CONCURRENT_JOBS = 3

    def __init__(self):
        self._knowledge_store: dict[str, KnowledgeRecord] = {}
        self._hash_index: dict[str, str] = {}  # content_hash -> record_id
        self._source_index: dict[str, dict[str, str]] = {}  # source -> {source_id -> record_id}
        self._embedding_cache: dict[str, list[float]] = {}
        self._job_queue: list[IngestionJob] = []
        self._running_jobs: dict[str, IngestionJob] = {}
        self._stats = {
            "total_records": 0,
            "records_by_source": {},
            "duplicates_prevented": 0,
            "last_ingestion": None,
        }
        self._initialized = False

    async def initialize(self) -> None:
        """Initialize the knowledge engine."""
        if self._initialized:
            return

        logger.info("Initializing Knowledge Engine - The Holy Bible of Healthcare")

        # Initialize source indices
        for source in KnowledgeSource:
            self._source_index[source.value] = {}
            self._stats["records_by_source"][source.value] = 0

        self._initialized = True
        logger.info("Knowledge Engine initialized")

    def _compute_content_hash(self, content: str, title: str = "") -> str:
        """Compute hash of normalized content for exact deduplication."""
        # Normalize: lowercase, strip whitespace, remove punctuation
        normalized = f"{title.lower().strip()} {content.lower().strip()}"
        normalized = ''.join(c for c in normalized if c.isalnum() or c.isspace())
        normalized = ' '.join(normalized.split())  # Normalize whitespace
        return hashlib.md5(normalized.encode()).hexdigest()

    async def _compute_semantic_hash(self, embedding: list[float]) -> str:
        """Compute hash of embedding for semantic deduplication."""
        # Quantize embedding to reduce precision (for hashing)
        quantized = [round(v, 3) for v in embedding]
        return hashlib.md5(json.dumps(quantized).encode()).hexdigest()

    async def check_duplicate(
        self,
        content: str,
        title: str = "",
        embedding: list[float] | None = None,
    ) -> DeduplicationResult:
        """
        Check if content is a duplicate of existing knowledge.

        Uses two-phase deduplication:
        1. Exact hash match (fast)
        2. Semantic similarity match (accurate)
        """
        # Phase 1: Exact hash match
        content_hash = self._compute_content_hash(content, title)
        if content_hash in self._hash_index:
            return DeduplicationResult(
                is_duplicate=True,
                duplicate_of=self._hash_index[content_hash],
                similarity_score=1.0,
                method="hash",
            )

        # Phase 2: Semantic similarity (if embedding provided)
        if embedding and self._embedding_cache:
            import numpy as np
            query_vec = np.array(embedding)

            for record_id, cached_embedding in self._embedding_cache.items():
                cached_vec = np.array(cached_embedding)
                similarity = np.dot(query_vec, cached_vec) / (
                    np.linalg.norm(query_vec) * np.linalg.norm(cached_vec)
                )

                if similarity >= self.SEMANTIC_SIMILARITY_THRESHOLD:
                    return DeduplicationResult(
                        is_duplicate=True,
                        duplicate_of=record_id,
                        similarity_score=float(similarity),
                        method="semantic",
                    )

        return DeduplicationResult(is_duplicate=False)

    async def ingest_record(
        self,
        title: str,
        content: str,
        source: KnowledgeSource,
        source_id: str,
        embedding: list[float] | None = None,
        **metadata,
    ) -> tuple[KnowledgeRecord | None, DeduplicationResult]:
        """
        Ingest a single record into the knowledge base.

        Returns:
            Tuple of (record, dedup_result). Record is None if duplicate.
        """
        # Check for duplicates
        dedup_result = await self.check_duplicate(content, title, embedding)
        if dedup_result.is_duplicate:
            self._stats["duplicates_prevented"] += 1
            logger.debug(
                "Duplicate detected",
                source=source.value,
                source_id=source_id,
                method=dedup_result.method,
            )
            return None, dedup_result

        # Create record
        content_hash = self._compute_content_hash(content, title)
        record = KnowledgeRecord(
            content_hash=content_hash,
            title=title,
            content=content,
            abstract=metadata.get("abstract"),
            source=source,
            source_id=source_id,
            source_url=metadata.get("url"),
            authors=metadata.get("authors", []),
            publication_date=metadata.get("publication_date"),
            keywords=metadata.get("keywords", []),
            mesh_terms=metadata.get("mesh_terms", []),
            status=KnowledgeStatus.INDEXED,
        )

        # Store in indices
        self._knowledge_store[record.id] = record
        self._hash_index[content_hash] = record.id

        if source.value not in self._source_index:
            self._source_index[source.value] = {}
        self._source_index[source.value][source_id] = record.id

        # Cache embedding if provided
        if embedding:
            self._embedding_cache[record.id] = embedding
            record.semantic_hash = await self._compute_semantic_hash(embedding)

        # Update stats
        self._stats["total_records"] += 1
        self._stats["records_by_source"][source.value] = \
            self._stats["records_by_source"].get(source.value, 0) + 1
        self._stats["last_ingestion"] = datetime.utcnow().isoformat()

        logger.debug(
            "Record ingested",
            record_id=record.id,
            source=source.value,
            source_id=source_id,
        )

        return record, dedup_result

    async def ingest_batch(
        self,
        records: list[dict[str, Any]],
        source: KnowledgeSource,
    ) -> dict[str, Any]:
        """
        Ingest a batch of records with deduplication.

        Args:
            records: List of record dicts with title, content, source_id, etc.
            source: Source of the records

        Returns:
            Dict with ingestion statistics
        """
        stats = {
            "total": len(records),
            "indexed": 0,
            "duplicates": 0,
            "failed": 0,
        }

        for record_data in records:
            try:
                record, dedup = await self.ingest_record(
                    title=record_data.get("title", ""),
                    content=record_data.get("content", record_data.get("abstract", "")),
                    source=source,
                    source_id=record_data.get("source_id", str(uuid4())),
                    embedding=record_data.get("embedding"),
                    **record_data,
                )

                if record:
                    stats["indexed"] += 1
                else:
                    stats["duplicates"] += 1

            except Exception as e:
                logger.error("Failed to ingest record", error=str(e))
                stats["failed"] += 1

        logger.info(
            "Batch ingestion complete",
            source=source.value,
            **stats,
        )

        return stats

    async def schedule_ingestion(
        self,
        source: KnowledgeSource,
        query: str,
        priority: int = 0,
        run_at: datetime | None = None,
    ) -> IngestionJob:
        """Schedule an ingestion job."""
        job = IngestionJob(
            source=source,
            query=query,
            priority=priority,
            scheduled_at=run_at or datetime.utcnow(),
        )

        self._job_queue.append(job)
        self._job_queue.sort(key=lambda j: (-j.priority, j.scheduled_at))

        logger.info(
            "Ingestion job scheduled",
            job_id=job.id,
            source=source.value,
            query=query[:50],
        )

        return job

    async def run_scheduled_jobs(self) -> list[dict[str, Any]]:
        """Run all scheduled jobs that are due."""
        results = []
        now = datetime.utcnow()

        # Get jobs that are due
        due_jobs = [j for j in self._job_queue if j.scheduled_at <= now]

        for job in due_jobs:
            self._job_queue.remove(job)

            try:
                result = await self._execute_job(job)
                results.append(result)
            except Exception as e:
                logger.error("Job failed", job_id=job.id, error=str(e))
                job.status = "failed"
                job.error = str(e)
                results.append({"job_id": job.id, "status": "failed", "error": str(e)})

        return results

    async def _execute_job(self, job: IngestionJob) -> dict[str, Any]:
        """Execute a single ingestion job."""
        job.status = "running"
        job.started_at = datetime.utcnow()
        self._running_jobs[job.id] = job

        logger.info("Starting ingestion job", job_id=job.id, source=job.source.value)

        try:
            # Get the appropriate ingestion agent
            from app.agents.ingestion.orchestrator import IngestionOrchestrator
            from app.agents.ingestion.base import SourceType

            # Map our source to orchestrator source type
            source_map = {
                KnowledgeSource.PUBMED: SourceType.PUBMED,
                KnowledgeSource.CLINICAL_TRIALS: SourceType.CLINICAL_TRIALS,
                KnowledgeSource.PREPRINT: SourceType.PREPRINT,
            }

            if job.source not in source_map:
                raise ValueError(f"Unsupported source: {job.source}")

            orchestrator = IngestionOrchestrator(
                sources=[source_map[job.source]],
                parallel=False,
            )

            result = await orchestrator.ingest(
                query=job.query,
                max_results_per_source=self.DEFAULT_BATCH_SIZE,
            )

            await orchestrator.close()

            # Update job stats
            job.records_fetched = result["metrics"]["total_records_fetched"]
            job.records_indexed = result["metrics"]["total_records_indexed"]
            job.status = "completed"
            job.completed_at = datetime.utcnow()

            return {
                "job_id": job.id,
                "status": "completed",
                "records_fetched": job.records_fetched,
                "records_indexed": job.records_indexed,
            }

        finally:
            del self._running_jobs[job.id]

    async def search(
        self,
        query: str,
        sources: list[KnowledgeSource] | None = None,
        limit: int = 20,
        min_score: float = 0.5,
    ) -> list[KnowledgeRecord]:
        """
        Search the knowledge base.

        Args:
            query: Search query
            sources: Filter by sources (None = all)
            limit: Maximum results
            min_score: Minimum relevance score

        Returns:
            List of matching records
        """
        # For now, simple keyword search
        # TODO: Integrate with vector store for semantic search
        results = []
        query_lower = query.lower()
        query_terms = query_lower.split()

        for record in self._knowledge_store.values():
            # Filter by source
            if sources and record.source not in sources:
                continue

            # Simple relevance scoring
            text = f"{record.title} {record.content} {' '.join(record.keywords)}".lower()

            matches = sum(1 for term in query_terms if term in text)
            score = matches / len(query_terms) if query_terms else 0

            if score >= min_score:
                record.relevance_score = score
                results.append(record)

        # Sort by relevance
        results.sort(key=lambda r: r.relevance_score, reverse=True)

        return results[:limit]

    def get_record(self, record_id: str) -> KnowledgeRecord | None:
        """Get a record by ID."""
        return self._knowledge_store.get(record_id)

    def get_by_source_id(
        self,
        source: KnowledgeSource,
        source_id: str,
    ) -> KnowledgeRecord | None:
        """Get a record by source and source ID."""
        record_id = self._source_index.get(source.value, {}).get(source_id)
        if record_id:
            return self._knowledge_store.get(record_id)
        return None

    def get_stats(self) -> dict[str, Any]:
        """Get knowledge base statistics."""
        return {
            **self._stats,
            "pending_jobs": len(self._job_queue),
            "running_jobs": len(self._running_jobs),
            "cache_size": len(self._embedding_cache),
        }

    async def compact(self) -> dict[str, Any]:
        """
        Compact the knowledge base by removing duplicates and stale records.

        This is a maintenance operation that should be run periodically.
        """
        stats = {
            "duplicates_merged": 0,
            "stale_removed": 0,
        }

        # Find and merge semantic duplicates
        # TODO: Implement full semantic deduplication scan

        logger.info("Knowledge base compaction complete", **stats)
        return stats


# Global instance
_knowledge_engine: KnowledgeEngine | None = None


async def get_knowledge_engine() -> KnowledgeEngine:
    """Get or create the global knowledge engine."""
    global _knowledge_engine
    if _knowledge_engine is None:
        _knowledge_engine = KnowledgeEngine()
        await _knowledge_engine.initialize()
    return _knowledge_engine


# Scheduled ingestion queries for building the Holy Bible
SCHEDULED_QUERIES = [
    # Core cancer research
    {"source": KnowledgeSource.PUBMED, "query": "cancer genomics mutations", "priority": 10},
    {"source": KnowledgeSource.PUBMED, "query": "immunotherapy checkpoint inhibitors", "priority": 10},
    {"source": KnowledgeSource.PUBMED, "query": "targeted therapy resistance mechanisms", "priority": 9},

    # Gene-specific
    {"source": KnowledgeSource.PUBMED, "query": "TP53 tumor suppressor", "priority": 8},
    {"source": KnowledgeSource.PUBMED, "query": "BRCA1 BRCA2 DNA repair", "priority": 8},
    {"source": KnowledgeSource.PUBMED, "query": "EGFR mutations lung cancer", "priority": 8},
    {"source": KnowledgeSource.PUBMED, "query": "KRAS inhibitors", "priority": 8},

    # Drug discovery
    {"source": KnowledgeSource.PUBMED, "query": "PARP inhibitors clinical trials", "priority": 7},
    {"source": KnowledgeSource.PUBMED, "query": "CAR-T cell therapy", "priority": 7},
    {"source": KnowledgeSource.PUBMED, "query": "antibody drug conjugates", "priority": 7},

    # Clinical trials
    {"source": KnowledgeSource.CLINICAL_TRIALS, "query": "cancer phase 3", "priority": 9},
    {"source": KnowledgeSource.CLINICAL_TRIALS, "query": "immunotherapy combination", "priority": 8},
    {"source": KnowledgeSource.CLINICAL_TRIALS, "query": "biomarker-driven treatment", "priority": 7},

    # Emerging areas
    {"source": KnowledgeSource.PUBMED, "query": "liquid biopsy ctDNA", "priority": 6},
    {"source": KnowledgeSource.PUBMED, "query": "tumor microenvironment", "priority": 6},
    {"source": KnowledgeSource.PUBMED, "query": "single cell sequencing cancer", "priority": 6},
]


async def schedule_continuous_ingestion(
    engine: KnowledgeEngine,
    interval_hours: int = 24,
) -> None:
    """
    Schedule continuous ingestion from all sources.

    This builds up the Holy Bible of Healthcare over time.
    """
    now = datetime.utcnow()

    for i, query_config in enumerate(SCHEDULED_QUERIES):
        # Stagger jobs over the interval
        run_at = now + timedelta(hours=(i * interval_hours / len(SCHEDULED_QUERIES)))

        await engine.schedule_ingestion(
            source=query_config["source"],
            query=query_config["query"],
            priority=query_config["priority"],
            run_at=run_at,
        )

    logger.info(
        "Continuous ingestion scheduled",
        jobs=len(SCHEDULED_QUERIES),
        interval_hours=interval_hours,
    )
