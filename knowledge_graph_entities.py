"""
Knowledge Graph — Entity Endpoints

Entity-centric API surface (in addition to the legacy node/edge endpoints).
This is what the frontend `services/knowledge.ts` service calls.

Wraps the underlying Neo4j graph store + PostgreSQL platform_entities tables
into a clean Entity/Relationship abstraction.
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, func, or_, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.platform_entities import (
    KnowledgeGraphNode,
    KnowledgeGraphEdge,
)

logger = logging.getLogger(__name__)
router = APIRouter()


# ─── Schemas ────────────────────────────────────────────────────

class Entity(BaseModel):
    """Canonical biomedical entity."""
    id: str
    name: str
    synonyms: list[str] = []
    category: str
    subcategory: Optional[str] = None
    description: Optional[str] = None
    external_ids: dict[str, str] = {}
    source: str = "internal"
    evidence_count: int = 0
    created_at: str
    updated_at: str

    @classmethod
    def from_node(cls, node: KnowledgeGraphNode) -> "Entity":
        props = node.properties or {}
        return cls(
            id=node.id,
            name=node.name,
            synonyms=props.get("synonyms", []),
            category=node.type or "unknown",
            subcategory=props.get("subcategory"),
            description=node.description or "",
            external_ids=props.get("external_ids", {}),
            source=props.get("source", "internal"),
            evidence_count=props.get("evidence_count", 0),
            created_at=node.created_at.isoformat() if node.created_at else "",
            updated_at=node.updated_at.isoformat() if node.updated_at else "",
        )


class EntityRelationship(BaseModel):
    """Relationship between two entities."""
    id: str
    source_id: str
    target_id: str
    relation_type: str
    confidence: float = 0.5
    evidence_pmids: list[str] = []
    evidence_count: int = 0
    source: str = "internal"

    @classmethod
    def from_edge(cls, edge: KnowledgeGraphEdge) -> "EntityRelationship":
        props = (edge.properties or {}) if hasattr(edge, "properties") else {}
        return cls(
            id=edge.id,
            source_id=edge.source_id,
            target_id=edge.target_id,
            relation_type=edge.relationship,
            confidence=edge.strength or 0.5,
            evidence_pmids=props.get("evidence_pmids", []),
            evidence_count=props.get("evidence_count", 0),
            source=props.get("source", "internal"),
        )


class EntitySearchResult(BaseModel):
    entities: list[Entity]
    total: int
    limit: int
    offset: int


class PathQuery(BaseModel):
    source_id: str
    target_id: str
    max_hops: int = Field(default=3, ge=1, le=6)
    min_confidence: float = Field(default=0.5, ge=0, le=1)


class Path(BaseModel):
    nodes: list[Entity]
    edges: list[EntityRelationship]
    total_confidence: float
    hop_count: int


class BulkEntityRequest(BaseModel):
    ids: list[str] = Field(..., max_length=200)


class NeighborhoodResult(BaseModel):
    nodes: list[Entity]
    edges: list[EntityRelationship]


# ─── Helpers ────────────────────────────────────────────────────

async def _get_entity_or_404(
    db: AsyncSession, entity_id: str,
) -> KnowledgeGraphNode:
    result = await db.execute(
        select(KnowledgeGraphNode).where(KnowledgeGraphNode.id == entity_id)
    )
    node = result.scalar_one_or_none()
    if node is None:
        raise HTTPException(
            status_code=404, detail=f"Entity {entity_id} not found",
        )
    return node


# ─── Search ─────────────────────────────────────────────────────

@router.get("/entities", response_model=EntitySearchResult)
async def search_entities(
    query: Optional[str] = None,
    category: Optional[str] = None,
    source: Optional[str] = None,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    """Search entities by query, category, or source."""
    stmt = select(KnowledgeGraphNode)

    if query:
        q = f"%{query.lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(KnowledgeGraphNode.name).like(q),
                func.lower(KnowledgeGraphNode.description).like(q),
            )
        )
    if category:
        stmt = stmt.where(KnowledgeGraphNode.type == category)

    # Total count (before pagination)
    count_stmt = select(func.count()).select_from(stmt.subquery())
    total_result = await db.execute(count_stmt)
    total = total_result.scalar() or 0

    # Page
    stmt = stmt.limit(limit).offset(offset)
    result = await db.execute(stmt)
    nodes = result.scalars().all()

    return EntitySearchResult(
        entities=[Entity.from_node(n) for n in nodes],
        total=total,
        limit=limit,
        offset=offset,
    )


# ─── Single Entity ─────────────────────────────────────────────

@router.get("/entities/{entity_id}", response_model=Entity)
async def get_entity(
    entity_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get a single entity by canonical ID."""
    node = await _get_entity_or_404(db, entity_id)
    return Entity.from_node(node)


# ─── Bulk Fetch ────────────────────────────────────────────────

@router.post("/entities/bulk", response_model=list[Entity])
async def get_entities_bulk(
    request: BulkEntityRequest,
    db: AsyncSession = Depends(get_db),
):
    """Bulk fetch entities by ID list (max 200)."""
    if not request.ids:
        return []
    stmt = select(KnowledgeGraphNode).where(
        KnowledgeGraphNode.id.in_(request.ids)
    )
    result = await db.execute(stmt)
    nodes = result.scalars().all()
    return [Entity.from_node(n) for n in nodes]


# ─── Relationships ─────────────────────────────────────────────

@router.get(
    "/entities/{entity_id}/relationships",
    response_model=list[EntityRelationship],
)
async def get_entity_relationships(
    entity_id: str,
    limit: int = Query(100, ge=1, le=1000),
    min_confidence: float = Query(0.0, ge=0, le=1),
    db: AsyncSession = Depends(get_db),
):
    """Get all relationships for an entity (both directions)."""
    await _get_entity_or_404(db, entity_id)

    stmt = (
        select(KnowledgeGraphEdge)
        .where(
            or_(
                KnowledgeGraphEdge.source_id == entity_id,
                KnowledgeGraphEdge.target_id == entity_id,
            )
        )
        .where(KnowledgeGraphEdge.strength >= min_confidence)
        .limit(limit)
    )
    result = await db.execute(stmt)
    edges = result.scalars().all()
    return [EntityRelationship.from_edge(e) for e in edges]


# ─── Neighborhood Subgraph ─────────────────────────────────────

@router.get(
    "/entities/{entity_id}/neighborhood",
    response_model=NeighborhoodResult,
)
async def get_neighborhood(
    entity_id: str,
    depth: int = Query(2, ge=1, le=4),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    """
    Get the N-hop neighborhood subgraph centered on an entity.

    For depth>1, this performs iterative expansion in PostgreSQL.
    For Neo4j-backed installations, this should delegate to a Cypher
    query for performance — see `app.knowledge.graph_store`.
    """
    center = await _get_entity_or_404(db, entity_id)
    visited_nodes: dict[str, KnowledgeGraphNode] = {entity_id: center}
    visited_edges: dict[str, KnowledgeGraphEdge] = {}
    frontier: set[str] = {entity_id}

    for _ in range(depth):
        if not frontier:
            break
        if len(visited_nodes) >= limit:
            break

        edge_stmt = select(KnowledgeGraphEdge).where(
            or_(
                KnowledgeGraphEdge.source_id.in_(frontier),
                KnowledgeGraphEdge.target_id.in_(frontier),
            )
        )
        edge_result = await db.execute(edge_stmt)
        new_frontier: set[str] = set()
        for edge in edge_result.scalars().all():
            if edge.id in visited_edges:
                continue
            visited_edges[edge.id] = edge
            for nid in (edge.source_id, edge.target_id):
                if nid not in visited_nodes:
                    new_frontier.add(nid)

        if new_frontier:
            node_stmt = select(KnowledgeGraphNode).where(
                KnowledgeGraphNode.id.in_(new_frontier)
            )
            node_result = await db.execute(node_stmt)
            for node in node_result.scalars().all():
                visited_nodes[node.id] = node

        frontier = new_frontier

    return NeighborhoodResult(
        nodes=[Entity.from_node(n) for n in visited_nodes.values()],
        edges=[
            EntityRelationship.from_edge(e) for e in visited_edges.values()
        ],
    )


# ─── Path Finding ──────────────────────────────────────────────

@router.post("/paths", response_model=list[Path])
async def find_paths(
    query: PathQuery,
    db: AsyncSession = Depends(get_db),
):
    """
    Find paths between two entities (BFS, max 5 paths returned).

    For production-scale graph queries, delegate to Neo4j Cypher
    via `app.knowledge.graph_store.GraphStore.find_paths()`.
    """
    # Verify both entities exist
    await _get_entity_or_404(db, query.source_id)
    await _get_entity_or_404(db, query.target_id)

    # Try Neo4j first if available (much faster for path queries)
    try:
        from app.knowledge.graph_store import get_graph_store
        graph_store = get_graph_store()
        if graph_store is not None:
            neo_paths = await graph_store.find_paths(
                source_id=query.source_id,
                target_id=query.target_id,
                max_hops=query.max_hops,
                min_confidence=query.min_confidence,
            )
            return [
                Path(
                    nodes=[Entity(**n) for n in p["nodes"]],
                    edges=[EntityRelationship(**e) for e in p["edges"]],
                    total_confidence=p["total_confidence"],
                    hop_count=p["hop_count"],
                )
                for p in neo_paths[:5]
            ]
    except Exception as e:
        logger.warning(
            "Neo4j path query failed, falling back to PostgreSQL BFS: %s", e,
        )

    # Fallback: PostgreSQL BFS (slower, but works without Neo4j)
    paths: list[Path] = []
    queue: list[tuple[list[str], list[KnowledgeGraphEdge], float]] = [
        ([query.source_id], [], 1.0)
    ]
    found_paths_count = 0

    while queue and found_paths_count < 5:
        current_path, current_edges, conf = queue.pop(0)

        if len(current_path) - 1 > query.max_hops:
            continue
        if current_path[-1] == query.target_id:
            # Build the Path
            node_stmt = select(KnowledgeGraphNode).where(
                KnowledgeGraphNode.id.in_(current_path)
            )
            node_result = await db.execute(node_stmt)
            nodes_by_id = {n.id: n for n in node_result.scalars().all()}
            ordered_nodes = [
                Entity.from_node(nodes_by_id[nid])
                for nid in current_path
                if nid in nodes_by_id
            ]
            paths.append(Path(
                nodes=ordered_nodes,
                edges=[EntityRelationship.from_edge(e) for e in current_edges],
                total_confidence=conf,
                hop_count=len(current_path) - 1,
            ))
            found_paths_count += 1
            continue

        # Expand
        edge_stmt = select(KnowledgeGraphEdge).where(
            and_(
                KnowledgeGraphEdge.source_id == current_path[-1],
                KnowledgeGraphEdge.strength >= query.min_confidence,
            )
        )
        edge_result = await db.execute(edge_stmt)
        for edge in edge_result.scalars().all():
            if edge.target_id in current_path:
                continue  # No cycles
            new_path = current_path + [edge.target_id]
            new_edges = current_edges + [edge]
            new_conf = conf * (edge.strength or 0.5)
            queue.append((new_path, new_edges, new_conf))

    return paths


# ─── Disease-centric query ─────────────────────────────────────

@router.get(
    "/diseases/{disease_id}/entities",
    response_model=list[Entity],
)
async def get_entities_by_disease(
    disease_id: str,
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    """Get all entities related to a disease (1-hop neighborhood)."""
    edge_stmt = (
        select(KnowledgeGraphEdge)
        .where(
            or_(
                KnowledgeGraphEdge.source_id == disease_id,
                KnowledgeGraphEdge.target_id == disease_id,
            )
        )
        .limit(limit)
    )
    edge_result = await db.execute(edge_stmt)
    edges = edge_result.scalars().all()

    related_ids = set()
    for e in edges:
        if e.source_id != disease_id:
            related_ids.add(e.source_id)
        if e.target_id != disease_id:
            related_ids.add(e.target_id)

    if not related_ids:
        return []

    node_stmt = select(KnowledgeGraphNode).where(
        KnowledgeGraphNode.id.in_(related_ids)
    )
    node_result = await db.execute(node_stmt)
    nodes = node_result.scalars().all()

    return [Entity.from_node(n) for n in nodes]
