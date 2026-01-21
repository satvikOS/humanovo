"""
Knowledge Graph API Endpoints

Query and explore the biomedical knowledge graph.
"""

from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.logging import get_logger

logger = get_logger(__name__)
router = APIRouter()


class EntityType(str, Enum):
    """Types of biomedical entities."""

    GENE = "gene"
    PROTEIN = "protein"
    DISEASE = "disease"
    DRUG = "drug"
    PATHWAY = "pathway"
    PHENOTYPE = "phenotype"
    CELL_TYPE = "cell_type"
    TISSUE = "tissue"
    ORGANISM = "organism"
    CLINICAL_TRIAL = "clinical_trial"
    PUBLICATION = "publication"


class RelationType(str, Enum):
    """Types of relationships in the knowledge graph."""

    INTERACTS_WITH = "interacts_with"
    REGULATES = "regulates"
    INHIBITS = "inhibits"
    ACTIVATES = "activates"
    TREATS = "treats"
    CAUSES = "causes"
    ASSOCIATED_WITH = "associated_with"
    EXPRESSED_IN = "expressed_in"
    PART_OF = "part_of"
    TARGETS = "targets"
    BINDS_TO = "binds_to"
    METABOLIZES = "metabolizes"


class EntityResponse(BaseModel):
    """Schema for entity response."""

    id: str
    name: str
    entity_type: EntityType
    aliases: List[str] = Field(default_factory=list)
    description: Optional[str] = None
    external_ids: Dict[str, str] = Field(default_factory=dict)
    properties: Dict[str, Any] = Field(default_factory=dict)
    source_count: int = 0


class RelationResponse(BaseModel):
    """Schema for relation response."""

    id: str
    source_id: str
    source_name: str
    source_type: EntityType
    target_id: str
    target_name: str
    target_type: EntityType
    relation_type: RelationType
    confidence: float = Field(..., ge=0, le=1)
    evidence_count: int = 0
    source_references: List[str] = Field(default_factory=list)


class GraphNeighborhood(BaseModel):
    """Schema for a neighborhood subgraph."""

    center_entity: EntityResponse
    entities: List[EntityResponse]
    relations: List[RelationResponse]
    depth: int


class PathResponse(BaseModel):
    """Schema for a path between entities."""

    source: EntityResponse
    target: EntityResponse
    path: List[RelationResponse]
    path_length: int
    path_confidence: float


class GraphQueryRequest(BaseModel):
    """Schema for custom graph query."""

    cypher_query: str = Field(
        ...,
        description="Cypher query to execute",
        max_length=2000,
    )
    parameters: Dict[str, Any] = Field(default_factory=dict)
    limit: int = Field(default=100, ge=1, le=1000)


class GraphStatsResponse(BaseModel):
    """Statistics about the knowledge graph."""

    total_entities: int
    total_relations: int
    entity_counts: Dict[str, int]
    relation_counts: Dict[str, int]
    last_updated: datetime


@router.get("/entities/search", response_model=List[EntityResponse])
async def search_entities(
    query: str = Query(..., min_length=2),
    entity_types: Optional[List[EntityType]] = Query(None),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
) -> List[EntityResponse]:
    """Search for entities by name or alias."""
    logger.info("Searching entities", query=query, types=entity_types)

    from app.knowledge.graph_store import search_entities as graph_search

    results = await graph_search(
        query=query,
        entity_types=[t.value for t in entity_types] if entity_types else None,
        limit=limit,
    )

    return results


@router.get("/entities/{entity_id}", response_model=EntityResponse)
async def get_entity(
    entity_id: str,
    db: AsyncSession = Depends(get_db),
) -> EntityResponse:
    """Get a specific entity by ID."""
    from app.knowledge.graph_store import get_entity as graph_get

    entity = await graph_get(entity_id)

    if not entity:
        raise HTTPException(status_code=404, detail="Entity not found")

    return entity


@router.get("/entities/{entity_id}/neighbors", response_model=GraphNeighborhood)
async def get_entity_neighbors(
    entity_id: str,
    depth: int = Query(1, ge=1, le=3),
    relation_types: Optional[List[RelationType]] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
) -> GraphNeighborhood:
    """Get the neighborhood subgraph around an entity."""
    logger.info("Getting entity neighbors", entity_id=entity_id, depth=depth)

    from app.knowledge.graph_store import get_neighborhood

    neighborhood = await get_neighborhood(
        entity_id=entity_id,
        depth=depth,
        relation_types=[r.value for r in relation_types] if relation_types else None,
        limit=limit,
    )

    if not neighborhood:
        raise HTTPException(status_code=404, detail="Entity not found")

    return neighborhood


@router.get("/relations/between", response_model=List[RelationResponse])
async def get_relations_between(
    source_id: str,
    target_id: str,
    db: AsyncSession = Depends(get_db),
) -> List[RelationResponse]:
    """Get all relations between two entities."""
    from app.knowledge.graph_store import get_relations_between as graph_relations

    relations = await graph_relations(source_id, target_id)

    return relations


@router.get("/paths", response_model=List[PathResponse])
async def find_paths(
    source_id: str,
    target_id: str,
    max_length: int = Query(4, ge=2, le=6),
    limit: int = Query(5, ge=1, le=20),
    db: AsyncSession = Depends(get_db),
) -> List[PathResponse]:
    """Find paths between two entities in the knowledge graph.

    This is useful for discovering indirect connections and
    generating hypotheses about relationships.
    """
    logger.info(
        "Finding paths",
        source=source_id,
        target=target_id,
        max_length=max_length,
    )

    from app.knowledge.graph_store import find_paths as graph_paths

    paths = await graph_paths(
        source_id=source_id,
        target_id=target_id,
        max_length=max_length,
        limit=limit,
    )

    return paths


@router.post("/query", response_model=Dict[str, Any])
async def execute_graph_query(
    request: GraphQueryRequest,
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    """Execute a custom Cypher query against the knowledge graph.

    Note: Only read queries are allowed for safety.
    """
    # Validate query is read-only
    query_upper = request.cypher_query.upper()
    if any(kw in query_upper for kw in ["CREATE", "DELETE", "SET", "REMOVE", "MERGE"]):
        raise HTTPException(
            status_code=400,
            detail="Only read queries are allowed through this endpoint",
        )

    logger.info("Executing graph query", query=request.cypher_query[:100])

    from app.knowledge.graph_store import execute_query

    results = await execute_query(
        query=request.cypher_query,
        parameters=request.parameters,
        limit=request.limit,
    )

    return {"results": results, "count": len(results)}


@router.get("/stats", response_model=GraphStatsResponse)
async def get_graph_stats(
    db: AsyncSession = Depends(get_db),
) -> GraphStatsResponse:
    """Get statistics about the knowledge graph."""
    from app.knowledge.graph_store import get_stats

    stats = await get_stats()

    return stats


@router.get("/entity-types", response_model=List[str])
async def list_entity_types() -> List[str]:
    """List all available entity types."""
    return [t.value for t in EntityType]


@router.get("/relation-types", response_model=List[str])
async def list_relation_types() -> List[str]:
    """List all available relation types."""
    return [r.value for r in RelationType]
