"""
Data Ingestion Pipeline

Orchestrates the data ingestion process from multiple sources.
"""

import asyncio
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional
from uuid import uuid4

from pydantic import BaseModel

from app.ingestion.sources import DataSource, DataRecord, get_source
from app.ingestion.extractors import EntityExtractor, RelationExtractor
from app.core.config import settings
from app.core.logging import get_logger, LoggerMixin

logger = get_logger(__name__)


class IngestionTask(BaseModel):
    """Configuration for an ingestion task."""

    id: str
    sources: List[str]
    query: str
    max_results_per_source: int = 100
    extract_entities: bool = True
    extract_relations: bool = True
    index_to_vector_store: bool = True
    index_to_graph_store: bool = True


class IngestionResult(BaseModel):
    """Results from an ingestion task."""

    task_id: str
    records_fetched: int
    entities_extracted: int
    relations_extracted: int
    documents_indexed: int
    graph_nodes_added: int
    graph_edges_added: int
    errors: List[str]
    duration_seconds: float


class IngestionPipeline(LoggerMixin):
    """Pipeline for ingesting and processing biomedical data.

    Handles:
    - Fetching from multiple data sources
    - Entity and relation extraction
    - Indexing to vector store
    - Adding to knowledge graph
    """

    def __init__(self):
        self.entity_extractor = EntityExtractor(use_nlp=True)
        self.relation_extractor = RelationExtractor()
        self._sources: Dict[str, DataSource] = {}

    def _get_source(self, name: str) -> DataSource:
        """Get or create a data source."""
        if name not in self._sources:
            self._sources[name] = get_source(name)
        return self._sources[name]

    async def run(
        self,
        task: IngestionTask,
        progress_callback: Optional[Callable[[str, float], None]] = None,
    ) -> IngestionResult:
        """Run the ingestion pipeline.

        Args:
            task: Ingestion task configuration
            progress_callback: Optional callback for progress updates (stage, progress)

        Returns:
            IngestionResult with statistics
        """
        import time

        start_time = time.time()
        errors = []

        self.logger.info(
            "Starting ingestion pipeline",
            task_id=task.id,
            sources=task.sources,
            query=task.query[:50],
        )

        # Stage 1: Fetch data from sources
        if progress_callback:
            progress_callback("fetching", 0.0)

        records = await self._fetch_from_sources(task)

        if progress_callback:
            progress_callback("fetching", 1.0)

        self.logger.info("Fetching complete", records=len(records))

        # Stage 2: Extract entities
        entities_count = 0
        if task.extract_entities:
            if progress_callback:
                progress_callback("extracting_entities", 0.0)

            for i, record in enumerate(records):
                try:
                    entities = self.entity_extractor.extract(record.content)
                    record.metadata["entities"] = [e.dict() for e in entities]
                    entities_count += len(entities)
                except Exception as e:
                    errors.append(f"Entity extraction failed for {record.source_id}: {e}")

                if progress_callback and i % 10 == 0:
                    progress_callback("extracting_entities", i / len(records))

            if progress_callback:
                progress_callback("extracting_entities", 1.0)

        self.logger.info("Entity extraction complete", entities=entities_count)

        # Stage 3: Extract relations
        relations_count = 0
        if task.extract_relations:
            if progress_callback:
                progress_callback("extracting_relations", 0.0)

            for i, record in enumerate(records):
                try:
                    entities = record.metadata.get("entities", [])
                    if entities:
                        from app.ingestion.extractors import ExtractedEntity
                        entity_objs = [ExtractedEntity(**e) for e in entities]
                        relations = self.relation_extractor.extract(record.content, entity_objs)
                        record.metadata["relations"] = [r.dict() for r in relations]
                        relations_count += len(relations)
                except Exception as e:
                    errors.append(f"Relation extraction failed for {record.source_id}: {e}")

                if progress_callback and i % 10 == 0:
                    progress_callback("extracting_relations", i / len(records))

            if progress_callback:
                progress_callback("extracting_relations", 1.0)

        self.logger.info("Relation extraction complete", relations=relations_count)

        # Stage 4: Index to vector store
        documents_indexed = 0
        if task.index_to_vector_store:
            if progress_callback:
                progress_callback("indexing_vectors", 0.0)

            documents_indexed = await self._index_to_vector_store(records, errors)

            if progress_callback:
                progress_callback("indexing_vectors", 1.0)

        self.logger.info("Vector indexing complete", documents=documents_indexed)

        # Stage 5: Add to knowledge graph
        nodes_added = 0
        edges_added = 0
        if task.index_to_graph_store:
            if progress_callback:
                progress_callback("indexing_graph", 0.0)

            nodes_added, edges_added = await self._index_to_graph_store(records, errors)

            if progress_callback:
                progress_callback("indexing_graph", 1.0)

        self.logger.info("Graph indexing complete", nodes=nodes_added, edges=edges_added)

        duration = time.time() - start_time

        result = IngestionResult(
            task_id=task.id,
            records_fetched=len(records),
            entities_extracted=entities_count,
            relations_extracted=relations_count,
            documents_indexed=documents_indexed,
            graph_nodes_added=nodes_added,
            graph_edges_added=edges_added,
            errors=errors,
            duration_seconds=duration,
        )

        self.logger.info(
            "Ingestion pipeline complete",
            task_id=task.id,
            duration_s=round(duration, 2),
        )

        return result

    async def _fetch_from_sources(
        self,
        task: IngestionTask,
    ) -> List[DataRecord]:
        """Fetch data from all configured sources."""
        all_records = []

        # Fetch from sources in parallel
        tasks = []
        for source_name in task.sources:
            try:
                source = self._get_source(source_name)
                tasks.append(
                    source.fetch(
                        query=task.query,
                        max_results=task.max_results_per_source,
                    )
                )
            except ValueError as e:
                self.logger.warning(f"Unknown source: {source_name}")
                continue

        results = await asyncio.gather(*tasks, return_exceptions=True)

        for i, result in enumerate(results):
            if isinstance(result, Exception):
                self.logger.warning(
                    "Source fetch failed",
                    source=task.sources[i],
                    error=str(result),
                )
            else:
                all_records.extend(result)

        return all_records

    async def _index_to_vector_store(
        self,
        records: List[DataRecord],
        errors: List[str],
    ) -> int:
        """Index records to the vector store."""
        try:
            from app.knowledge.vector_store import get_vector_store

            store = get_vector_store()
        except RuntimeError:
            self.logger.warning("Vector store not initialized")
            return 0

        indexed = 0
        for record in records:
            try:
                # Create document for indexing
                doc_id = await store.add_document(
                    content=f"{record.title}\n\n{record.abstract or record.content}",
                    metadata={
                        "source": record.source,
                        "source_id": record.source_id,
                        "title": record.title,
                        "url": record.url,
                        "authors": record.authors,
                        "publication_date": record.publication_date.isoformat() if record.publication_date else None,
                        "entities": [e.get("text") for e in record.metadata.get("entities", [])],
                    },
                    doc_id=f"{record.source}:{record.source_id}",
                )
                indexed += 1
            except Exception as e:
                errors.append(f"Vector indexing failed for {record.source_id}: {e}")

        return indexed

    async def _index_to_graph_store(
        self,
        records: List[DataRecord],
        errors: List[str],
    ) -> tuple[int, int]:
        """Add entities and relations to the knowledge graph."""
        try:
            from app.knowledge.graph_store import get_graph_store, Entity, Relation

            store = get_graph_store()
        except RuntimeError:
            self.logger.warning("Graph store not initialized")
            return 0, 0

        nodes_added = 0
        edges_added = 0

        for record in records:
            try:
                # Add entities as nodes
                entities = record.metadata.get("entities", [])
                entity_ids = {}

                for entity_data in entities:
                    entity_id = f"{entity_data['entity_type']}:{entity_data['text'].lower().replace(' ', '_')}"

                    entity = Entity(
                        id=entity_id,
                        name=entity_data["text"],
                        entity_type=entity_data["entity_type"],
                        source_count=1,
                    )

                    await store.add_entity(entity)
                    entity_ids[entity_data["text"]] = entity_id
                    nodes_added += 1

                # Add relations as edges
                relations = record.metadata.get("relations", [])
                for rel_data in relations:
                    subject_text = rel_data["subject"]["text"]
                    object_text = rel_data["object"]["text"]

                    if subject_text in entity_ids and object_text in entity_ids:
                        relation = Relation(
                            id=str(uuid4()),
                            source_id=entity_ids[subject_text],
                            source_name=subject_text,
                            source_type=rel_data["subject"]["entity_type"],
                            target_id=entity_ids[object_text],
                            target_name=object_text,
                            target_type=rel_data["object"]["entity_type"],
                            relation_type=rel_data["predicate"],
                            confidence=rel_data.get("confidence", 0.7),
                            source_references=[f"{record.source}:{record.source_id}"],
                        )

                        await store.add_relation(relation)
                        edges_added += 1

            except Exception as e:
                errors.append(f"Graph indexing failed for {record.source_id}: {e}")

        return nodes_added, edges_added

    async def close(self) -> None:
        """Close all data sources."""
        for source in self._sources.values():
            await source.close()


# Convenience function
async def ingest(
    query: str,
    sources: List[str] = None,
    max_results: int = 100,
) -> IngestionResult:
    """Run a quick ingestion task.

    Args:
        query: Search query
        sources: Data sources to use (default: pubmed, clinical_trials)
        max_results: Maximum results per source

    Returns:
        IngestionResult
    """
    pipeline = IngestionPipeline()

    task = IngestionTask(
        id=str(uuid4()),
        sources=sources or ["pubmed", "clinical_trials"],
        query=query,
        max_results_per_source=max_results,
    )

    try:
        result = await pipeline.run(task)
        return result
    finally:
        await pipeline.close()
