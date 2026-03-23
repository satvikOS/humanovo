"""
Knowledge Graph API Endpoints

Interactive biomedical knowledge graph with nodes (genes, proteins,
pathways, diseases, drugs) and edges (relationships).
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.platform_entities import KnowledgeGraphNode, KnowledgeGraphEdge

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Schemas ──────────────────────────────────────────────────────

class NodeCreate(BaseModel):
    name: str
    type: str  # gene, protein, pathway, disease, drug
    description: str = ""
    properties: dict = {}


class EdgeCreate(BaseModel):
    source: str  # node_id
    target: str  # node_id
    relationship: str
    strength: float = 0.5
    evidence: str = ""


# ── Helpers ──────────────────────────────────────────────────────

async def _get_node_or_404(db: AsyncSession, node_id: str) -> KnowledgeGraphNode:
    result = await db.execute(
        select(KnowledgeGraphNode).where(KnowledgeGraphNode.id == node_id)
    )
    node = result.scalar_one_or_none()
    if node is None:
        raise HTTPException(status_code=404, detail="Node not found")
    return node


# ── Node Endpoints ───────────────────────────────────────────────

@router.get("/nodes")
async def list_nodes(
    type: Optional[str] = None,
    search: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    query = select(KnowledgeGraphNode)
    if type:
        query = query.where(KnowledgeGraphNode.type == type)
    if search:
        q = f"%{search.lower()}%"
        query = query.where(
            or_(
                func.lower(KnowledgeGraphNode.name).like(q),
                func.lower(KnowledgeGraphNode.description).like(q),
            )
        )
    result = await db.execute(query)
    items = result.scalars().all()
    return {"items": [n.to_dict() for n in items], "total": len(items)}


@router.post("/nodes")
async def create_node(data: NodeCreate, db: AsyncSession = Depends(get_db)):
    node = KnowledgeGraphNode(
        name=data.name,
        type=data.type,
        description=data.description,
        properties=data.properties,
    )
    db.add(node)
    await db.flush()
    await db.refresh(node)
    return node.to_dict()


@router.get("/nodes/{node_id}")
async def get_node(node_id: str, db: AsyncSession = Depends(get_db)):
    node = await _get_node_or_404(db, node_id)
    return node.to_dict()


@router.delete("/nodes/{node_id}")
async def delete_node(node_id: str, db: AsyncSession = Depends(get_db)):
    node = await _get_node_or_404(db, node_id)

    # Count and remove connected edges (CASCADE should handle this, but be explicit)
    edge_result = await db.execute(
        select(KnowledgeGraphEdge).where(
            or_(
                KnowledgeGraphEdge.source_id == node_id,
                KnowledgeGraphEdge.target_id == node_id,
            )
        )
    )
    edges = edge_result.scalars().all()
    edges_removed = len(edges)
    for edge in edges:
        await db.delete(edge)

    await db.delete(node)
    await db.flush()
    return {"status": "deleted", "edges_removed": edges_removed}


# ── Edge Endpoints ───────────────────────────────────────────────

@router.get("/edges")
async def list_edges(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(KnowledgeGraphEdge))
    items = result.scalars().all()
    return {"items": [e.to_dict() for e in items], "total": len(items)}


@router.post("/edges")
async def create_edge(data: EdgeCreate, db: AsyncSession = Depends(get_db)):
    # Validate source and target exist
    source_node = await _get_node_or_404(db, data.source)
    target_node = await _get_node_or_404(db, data.target)

    edge = KnowledgeGraphEdge(
        source_id=data.source,
        target_id=data.target,
        source_name=source_node.name,
        target_name=target_node.name,
        relationship=data.relationship,
        strength=data.strength,
        evidence=data.evidence,
    )
    db.add(edge)
    await db.flush()
    await db.refresh(edge)
    return edge.to_dict()


@router.delete("/edges/{edge_id}")
async def delete_edge(edge_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(KnowledgeGraphEdge).where(KnowledgeGraphEdge.id == edge_id)
    )
    edge = result.scalar_one_or_none()
    if edge is None:
        raise HTTPException(status_code=404, detail="Edge not found")
    await db.delete(edge)
    await db.flush()
    return {"status": "deleted"}


# ── Subgraph Traversal ───────────────────────────────────────────

@router.get("/subgraph/{node_id}")
async def get_subgraph(
    node_id: str,
    depth: int = Query(1, ge=1, le=3),
    db: AsyncSession = Depends(get_db),
):
    # Verify center node exists
    center_node = await _get_node_or_404(db, node_id)

    visited: set[str] = set()
    node_ids: set[str] = {node_id}
    collected_edge_ids: set[str] = set()
    collected_edges: list[dict] = []

    for _ in range(depth):
        frontier = node_ids - visited
        if not frontier:
            break

        # Find all edges touching the frontier nodes
        frontier_list = list(frontier)
        result = await db.execute(
            select(KnowledgeGraphEdge).where(
                or_(
                    KnowledgeGraphEdge.source_id.in_(frontier_list),
                    KnowledgeGraphEdge.target_id.in_(frontier_list),
                )
            )
        )
        edges = result.scalars().all()

        visited |= frontier
        new_nodes: set[str] = set()
        for edge in edges:
            eid = str(edge.id)
            if eid not in collected_edge_ids:
                collected_edge_ids.add(eid)
                collected_edges.append(edge.to_dict())
            new_nodes.add(str(edge.source_id))
            new_nodes.add(str(edge.target_id))

        node_ids |= new_nodes

    # Fetch all discovered nodes
    if node_ids:
        node_result = await db.execute(
            select(KnowledgeGraphNode).where(
                KnowledgeGraphNode.id.in_(list(node_ids))
            )
        )
        nodes = node_result.scalars().all()
    else:
        nodes = [center_node]

    return {
        "center_node": center_node.to_dict(),
        "nodes": [n.to_dict() for n in nodes],
        "edges": collected_edges,
    }


# ── Full Graph ──────────────────────────────────────────────────

@router.get("/full")
async def get_full_graph(db: AsyncSession = Depends(get_db)):
    """Return all nodes and edges for the interactive graph visualization."""
    node_result = await db.execute(select(KnowledgeGraphNode))
    nodes = node_result.scalars().all()

    edge_result = await db.execute(select(KnowledgeGraphEdge))
    edges = edge_result.scalars().all()

    return {
        "nodes": [n.to_dict() for n in nodes],
        "edges": [e.to_dict() for e in edges],
        "total_nodes": len(nodes),
        "total_edges": len(edges),
    }


# ── Stats ────────────────────────────────────────────────────────

@router.get("/stats")
async def graph_stats(db: AsyncSession = Depends(get_db)):
    # Total counts
    node_count_result = await db.execute(select(func.count(KnowledgeGraphNode.id)))
    total_nodes = node_count_result.scalar_one()

    edge_count_result = await db.execute(select(func.count(KnowledgeGraphEdge.id)))
    total_edges = edge_count_result.scalar_one()

    # Node type counts via SQL aggregation
    type_result = await db.execute(
        select(KnowledgeGraphNode.type, func.count(KnowledgeGraphNode.id))
        .group_by(KnowledgeGraphNode.type)
    )
    node_types = {row[0]: row[1] for row in type_result.all()}

    # Relationship type counts via SQL aggregation
    rel_result = await db.execute(
        select(KnowledgeGraphEdge.relationship, func.count(KnowledgeGraphEdge.id))
        .group_by(KnowledgeGraphEdge.relationship)
    )
    relationship_types = {row[0]: row[1] for row in rel_result.all()}

    return {
        "total_nodes": total_nodes,
        "total_edges": total_edges,
        "node_types": node_types,
        "relationship_types": relationship_types,
    }
