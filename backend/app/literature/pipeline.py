"""
End-to-End Literature Pipeline

Orchestrates the full literature processing workflow:
1. Source selection and configuration
2. Data retrieval
3. Inclusion/exclusion filtering
4. NLP processing
5. Entity resolution
6. Knowledge graph construction
7. Confidence scoring
8. Snapshot management
"""

import asyncio
import hashlib
import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from .criteria import ExclusionCriteria, InclusionCriteria, SelectionEngine, SelectionResult
from .snapshots import SnapshotManager
from .sources import (
    ClinicalTrialsSource,
    LiteratureRecord,
    LiteratureSource,
    PatentSource,
    PrePrintSource,
    PubMedSource,
    SourceType,
)
from .updates import UpdateType

logger = logging.getLogger(__name__)


@dataclass
class PipelineConfig:
    """Configuration for the literature pipeline."""

    name: str
    description: str = ""
    sources: list[SourceType] = field(default_factory=list)
    queries: list[str] = field(default_factory=list)
    max_records_per_source: int = 1000
    enable_nlp: bool = True
    enable_entity_resolution: bool = True
    enable_scoring: bool = True
    enable_snapshots: bool = True
    update_type: UpdateType = UpdateType.INCREMENTAL
    parallel_processing: bool = True
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "sources": [s.value for s in self.sources],
            "queries": self.queries,
            "max_records_per_source": self.max_records_per_source,
            "enable_nlp": self.enable_nlp,
            "enable_entity_resolution": self.enable_entity_resolution,
            "enable_scoring": self.enable_scoring,
            "enable_snapshots": self.enable_snapshots,
            "update_type": self.update_type.value,
            "parallel_processing": self.parallel_processing,
            "metadata": self.metadata,
        }


@dataclass
class ProcessedRecord:
    """A fully processed literature record."""

    record: LiteratureRecord
    selection_result: SelectionResult | None = None
    entities: list[dict[str, Any]] = field(default_factory=list)
    relations: list[dict[str, Any]] = field(default_factory=list)
    resolved_entities: list[dict[str, Any]] = field(default_factory=list)
    confidence_scores: dict[str, float] = field(default_factory=dict)
    processing_metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "record": self.record.to_dict(),
            "selection_result": self.selection_result.to_dict() if self.selection_result else None,
            "entities": self.entities,
            "relations": self.relations,
            "resolved_entities": self.resolved_entities,
            "confidence_scores": self.confidence_scores,
            "processing_metadata": self.processing_metadata,
        }


@dataclass
class PipelineResult:
    """Result of a pipeline run."""

    pipeline_id: str
    config: PipelineConfig
    started_at: str
    completed_at: str | None = None
    success: bool = False
    total_fetched: int = 0
    total_included: int = 0
    total_excluded: int = 0
    total_entities: int = 0
    total_relations: int = 0
    processed_records: list[ProcessedRecord] = field(default_factory=list)
    snapshot_id: str | None = None
    errors: list[str] = field(default_factory=list)
    statistics: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "pipeline_id": self.pipeline_id,
            "config": self.config.to_dict(),
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "success": self.success,
            "total_fetched": self.total_fetched,
            "total_included": self.total_included,
            "total_excluded": self.total_excluded,
            "total_entities": self.total_entities,
            "total_relations": self.total_relations,
            "processed_records_count": len(self.processed_records),
            "snapshot_id": self.snapshot_id,
            "errors": self.errors,
            "statistics": self.statistics,
        }


class LiteraturePipeline:
    """
    End-to-end literature processing pipeline.

    Workflow:
    1. Configure sources and queries
    2. Fetch records from sources
    3. Apply selection criteria
    4. Process with NLP (optional)
    5. Resolve entities (optional)
    6. Score confidence (optional)
    7. Create snapshot
    """

    def __init__(
        self,
        config: PipelineConfig,
        inclusion_criteria: InclusionCriteria | None = None,
        exclusion_criteria: ExclusionCriteria | None = None,
        snapshot_manager: SnapshotManager | None = None,
        progress_callback: Callable[[str, float], None] | None = None,
    ):
        """
        Initialize the pipeline.

        Args:
            config: Pipeline configuration
            inclusion_criteria: Inclusion criteria
            exclusion_criteria: Exclusion criteria
            snapshot_manager: Snapshot manager
            progress_callback: Progress callback function
        """
        self.config = config
        self.inclusion_criteria = inclusion_criteria or InclusionCriteria()
        self.exclusion_criteria = exclusion_criteria or ExclusionCriteria()
        self.snapshot_manager = snapshot_manager or SnapshotManager()
        self.progress_callback = progress_callback

        # Initialize sources
        self._sources: dict[SourceType, LiteratureSource] = {}
        self._setup_sources()

        # Selection engine
        self.selection_engine = SelectionEngine(
            inclusion_criteria=self.inclusion_criteria, exclusion_criteria=self.exclusion_criteria
        )

        logger.info(f"LiteraturePipeline initialized: {config.name}")

    def _setup_sources(self):
        """Initialize configured sources."""
        source_classes = {
            SourceType.PUBMED: PubMedSource,
            SourceType.PATENT: PatentSource,
            SourceType.CLINICAL_TRIAL: ClinicalTrialsSource,
            SourceType.PREPRINT: PrePrintSource,
        }

        for source_type in self.config.sources:
            source_class = source_classes.get(source_type)
            if source_class:
                self._sources[source_type] = source_class()

    def _report_progress(self, stage: str, progress: float):
        """Report progress."""
        if self.progress_callback:
            self.progress_callback(stage, progress)

    async def run(self) -> PipelineResult:
        """
        Run the full pipeline.

        Returns:
            PipelineResult
        """
        pipeline_id = f"pipe_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_{hashlib.md5(self.config.name.encode()).hexdigest()[:6]}"

        result = PipelineResult(
            pipeline_id=pipeline_id, config=self.config, started_at=datetime.utcnow().isoformat()
        )

        try:
            # Stage 1: Fetch records
            self._report_progress("Fetching records", 0.0)
            all_records = await self._fetch_all_records()
            result.total_fetched = len(all_records)
            self._report_progress("Fetching records", 1.0)

            # Stage 2: Apply selection criteria
            self._report_progress("Applying selection criteria", 0.0)
            selection_results = self.selection_engine.batch_select(all_records)
            included_records = selection_results["included_records"]
            result.total_included = len(included_records)
            result.total_excluded = result.total_fetched - result.total_included
            self._report_progress("Applying selection criteria", 1.0)

            # Stage 3: Process records
            self._report_progress("Processing records", 0.0)
            processed_records = await self._process_records(
                included_records, selection_results["results"]
            )
            result.processed_records = processed_records
            self._report_progress("Processing records", 1.0)

            # Count entities and relations
            for pr in processed_records:
                result.total_entities += len(pr.entities)
                result.total_relations += len(pr.relations)

            # Stage 4: Create snapshot
            if self.config.enable_snapshots and included_records:
                self._report_progress("Creating snapshot", 0.0)
                snapshot = self.snapshot_manager.create_snapshot(
                    records=included_records,
                    description=f"Pipeline run: {self.config.name}",
                    query_info={
                        "queries": self.config.queries,
                        "sources": [s.value for s in self.config.sources],
                    },
                    selection_criteria={
                        "inclusion_count": len(self.inclusion_criteria.criteria),
                        "exclusion_count": len(self.exclusion_criteria.criteria),
                    },
                )
                result.snapshot_id = snapshot.metadata.snapshot_id
                self._report_progress("Creating snapshot", 1.0)

            # Calculate statistics
            result.statistics = self._calculate_statistics(result)

            result.success = True
            result.completed_at = datetime.utcnow().isoformat()

        except Exception as e:
            logger.error(f"Pipeline failed: {e}")
            result.errors.append(str(e))
            result.completed_at = datetime.utcnow().isoformat()

        return result

    async def _fetch_all_records(self) -> list[LiteratureRecord]:
        """Fetch records from all configured sources."""
        all_records = []

        for query in self.config.queries:
            if self.config.parallel_processing:
                # Parallel fetching
                tasks = []
                for source_type, source in self._sources.items():
                    task = source.search(
                        query=query, max_results=self.config.max_records_per_source
                    )
                    tasks.append(task)

                results = await asyncio.gather(*tasks, return_exceptions=True)

                for result in results:
                    if isinstance(result, list):
                        all_records.extend(result)
                    elif isinstance(result, Exception):
                        logger.error(f"Source fetch error: {result}")
            else:
                # Sequential fetching
                for source_type, source in self._sources.items():
                    try:
                        records = await source.search(
                            query=query, max_results=self.config.max_records_per_source
                        )
                        all_records.extend(records)
                    except Exception as e:
                        logger.error(f"Source fetch error: {e}")

        # Deduplicate
        seen = set()
        unique_records = []
        for record in all_records:
            if record.record_id not in seen:
                seen.add(record.record_id)
                unique_records.append(record)

        return unique_records

    async def _process_records(
        self, records: list[LiteratureRecord], selection_results: list[dict]
    ) -> list[ProcessedRecord]:
        """Process records through NLP, entity resolution, and scoring."""
        processed = []

        # Create selection result lookup
        selection_lookup = {r["record_id"]: r for r in selection_results}

        for i, record in enumerate(records):
            # Get selection result
            sel_dict = selection_lookup.get(record.record_id, {})
            sel_result = SelectionResult(
                record_id=record.record_id,
                included=sel_dict.get("included", True),
                overall_score=sel_dict.get("overall_score", 0.5),
                decision_reason=sel_dict.get("decision_reason", ""),
            )

            pr = ProcessedRecord(
                record=record,
                selection_result=sel_result,
                processing_metadata={"processed_at": datetime.utcnow().isoformat()},
            )

            # NLP Processing (mock - in production, use actual NLP pipeline)
            if self.config.enable_nlp:
                pr.entities = self._extract_entities_mock(record)
                pr.relations = self._extract_relations_mock(record, pr.entities)

            # Entity Resolution (mock)
            if self.config.enable_entity_resolution:
                pr.resolved_entities = self._resolve_entities_mock(pr.entities)

            # Confidence Scoring (mock)
            if self.config.enable_scoring:
                pr.confidence_scores = self._score_mock(record, pr.entities, pr.relations)

            processed.append(pr)

            # Report progress
            self._report_progress("Processing records", (i + 1) / len(records))

        return processed

    def _extract_entities_mock(self, record: LiteratureRecord) -> list[dict[str, Any]]:
        """Mock entity extraction."""
        # In production, use actual NLP pipeline
        import re

        text = record.get_text()
        entities = []

        # Simple pattern matching for demo
        patterns = {
            "gene": r"\b[A-Z][A-Z0-9]{1,10}\b",
            "drug": r"\b\w+(?:mab|nib|lib)\b",
        }

        for entity_type, pattern in patterns.items():
            matches = re.findall(pattern, text)
            for match in set(matches[:5]):  # Limit
                entities.append({"text": match, "type": entity_type, "confidence": 0.7})

        return entities

    def _extract_relations_mock(
        self, record: LiteratureRecord, entities: list[dict]
    ) -> list[dict[str, Any]]:
        """Mock relation extraction."""
        relations = []

        # Create simple co-occurrence relations
        if len(entities) >= 2:
            relations.append(
                {
                    "source": entities[0]["text"],
                    "target": entities[1]["text"],
                    "relation": "associated_with",
                    "confidence": 0.6,
                    "evidence": record.title,
                }
            )

        return relations

    def _resolve_entities_mock(self, entities: list[dict]) -> list[dict[str, Any]]:
        """Mock entity resolution."""
        resolved = []
        for entity in entities:
            resolved.append(
                {
                    "original": entity["text"],
                    "canonical_name": entity["text"],
                    "canonical_id": f"genup:{hashlib.md5(entity['text'].encode()).hexdigest()[:8]}",
                    "confidence": entity.get("confidence", 0.5),
                }
            )
        return resolved

    def _score_mock(
        self, record: LiteratureRecord, entities: list[dict], relations: list[dict]
    ) -> dict[str, float]:
        """Mock confidence scoring."""
        return {
            "source_quality": 0.7,
            "entity_confidence": sum(e.get("confidence", 0.5) for e in entities)
            / max(1, len(entities)),
            "relation_confidence": sum(r.get("confidence", 0.5) for r in relations)
            / max(1, len(relations)),
            "overall": 0.65,
        }

    def _calculate_statistics(self, result: PipelineResult) -> dict[str, Any]:
        """Calculate pipeline statistics."""
        source_counts = {}
        for pr in result.processed_records:
            source = pr.record.source_type.value
            source_counts[source] = source_counts.get(source, 0) + 1

        entity_types = {}
        for pr in result.processed_records:
            for entity in pr.entities:
                etype = entity.get("type", "unknown")
                entity_types[etype] = entity_types.get(etype, 0) + 1

        return {
            "records_by_source": source_counts,
            "entity_type_distribution": entity_types,
            "selection_rate": result.total_included / max(1, result.total_fetched),
            "avg_entities_per_record": result.total_entities / max(1, result.total_included),
            "avg_relations_per_record": result.total_relations / max(1, result.total_included),
            "processing_time_seconds": None,  # Would calculate from timestamps
        }


# Factory function
def create_pipeline(
    name: str, queries: list[str], sources: list[SourceType] | None = None, **kwargs
) -> LiteraturePipeline:
    """
    Create a literature pipeline.

    Args:
        name: Pipeline name
        queries: Search queries
        sources: Source types
        **kwargs: Additional config options

    Returns:
        Configured LiteraturePipeline
    """
    sources = sources or [SourceType.PUBMED]

    config = PipelineConfig(name=name, queries=queries, sources=sources, **kwargs)

    return LiteraturePipeline(config)


# Convenience function
async def run_simple_pipeline(
    query: str, sources: list[SourceType] | None = None
) -> PipelineResult:
    """Run a simple pipeline with minimal config."""
    pipeline = create_pipeline(
        name=f"Simple: {query}",
        queries=[query],
        sources=sources,
        enable_nlp=True,
        enable_entity_resolution=False,
        enable_scoring=False,
    )
    return await pipeline.run()
