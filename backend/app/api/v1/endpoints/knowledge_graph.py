"""
Knowledge Graph API Endpoints

Interactive biomedical knowledge graph with nodes (genes, proteins,
pathways, diseases, drugs) and edges (relationships).
"""

import logging
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AUTH_REQUIRED, get_current_active_user
from app.core.database import get_db
from app.models.hypothesis import Hypothesis
from app.models.platform_entities import KnowledgeGraphEdge, KnowledgeGraphNode
from app.models.saved_research_paper import SavedResearchPaper
from app.models.user import User

logger = logging.getLogger(__name__)
router = APIRouter(dependencies=AUTH_REQUIRED)
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

async def _get_node_or_404(db: AsyncSession, node_id: UUID) -> KnowledgeGraphNode:
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
    type: str | None = None,
    search: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    # Paginated — the common KG holds 150k+ nodes, and an unbounded
    # dump blows past Lambda's 6 MB response limit (API Gateway 500).
    query = select(KnowledgeGraphNode)
    count_query = select(func.count(KnowledgeGraphNode.id))
    if type:
        query = query.where(KnowledgeGraphNode.type == type)
        count_query = count_query.where(KnowledgeGraphNode.type == type)
    if search:
        q = f"%{search.lower()}%"
        cond = or_(
            func.lower(KnowledgeGraphNode.name).like(q),
            func.lower(KnowledgeGraphNode.description).like(q),
        )
        query = query.where(cond)
        count_query = count_query.where(cond)
    total = (await db.execute(count_query)).scalar_one()
    query = (
        query.order_by(KnowledgeGraphNode.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    items = (await db.execute(query)).scalars().all()
    return {
        "items": [n.to_dict() for n in items],
        "total": total, "page": page, "page_size": page_size,
    }


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
async def get_node(node_id: UUID, db: AsyncSession = Depends(get_db)):
    node = await _get_node_or_404(db, node_id)
    return node.to_dict()


@router.delete("/nodes/{node_id}")
async def delete_node(node_id: UUID, db: AsyncSession = Depends(get_db)):
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
async def list_edges(
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    # Paginated — see list_nodes; the edge table is just as large.
    total = (await db.execute(
        select(func.count(KnowledgeGraphEdge.id))
    )).scalar_one()
    query = (
        select(KnowledgeGraphEdge)
        .order_by(KnowledgeGraphEdge.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    items = (await db.execute(query)).scalars().all()
    return {
        "items": [e.to_dict() for e in items],
        "total": total, "page": page, "page_size": page_size,
    }


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
async def delete_edge(edge_id: UUID, db: AsyncSession = Depends(get_db)):
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
    node_id: UUID,
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


# ── Scope-aware visual KG endpoints ──────────────────────────────
# Powering the Visual KG component embedded in three places:
#   1. /knowledge-graph page — Private vs Common toggle
#   2. Each hypothesis (HypothesisReview) — subgraph for that
#      hypothesis's mentioned entities
#   3. Each research paper — subgraph for that paper's entities
#
# `owner_id IS NULL` = community/common (visible to every user);
# `owner_id = current_user.id` = private to that user. Migration
# 023 adds the column to both KG tables; rows written before that
# migration land in the common pool by default.

ScopeFilter = Literal["private", "common", "all"]


def _apply_scope(
    query, model, scope: ScopeFilter, user_id: UUID,
):
    """Apply the private/common/all filter to a SELECT query."""
    if scope == "private":
        return query.where(model.owner_id == user_id)
    if scope == "common":
        return query.where(model.owner_id.is_(None))
    # "all" — user's private + community
    return query.where(
        or_(model.owner_id == user_id, model.owner_id.is_(None))
    )


@router.get("/scope/{scope}")
async def get_scoped_graph(
    scope: ScopeFilter,
    limit: int = Query(500, ge=1, le=5000),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    """Return nodes + edges within the requested scope.

    `scope=private` is the user's owned KG; `scope=common` is the
    community pool (rows with NULL owner_id); `scope=all` returns
    both. The limit is applied to nodes; edges are filtered to the
    pairs whose endpoints both made the cut.
    """
    node_q = _apply_scope(
        select(KnowledgeGraphNode), KnowledgeGraphNode, scope, user.id,
    ).limit(limit)
    nodes = (await db.execute(node_q)).scalars().all()
    node_ids = {n.id for n in nodes}

    edge_q = select(KnowledgeGraphEdge).where(
        and_(
            KnowledgeGraphEdge.source_id.in_(node_ids),
            KnowledgeGraphEdge.target_id.in_(node_ids),
        )
    ) if node_ids else select(KnowledgeGraphEdge).where(False)
    edges = (await db.execute(edge_q)).scalars().all()

    return {
        "scope": scope,
        "nodes": [n.to_dict() for n in nodes],
        "edges": [e.to_dict() for e in edges],
        "total_nodes": len(nodes),
        "total_edges": len(edges),
    }


def _candidate_keywords(*texts: str | None) -> list[str]:
    """Pull a small set of lookup keywords from one or more text
    fragments. MVP heuristic: split on whitespace + punctuation,
    keep words >= 4 chars, dedupe, cap at 12 to bound the SQL
    fan-out. Phase 2 swaps this for proper NER + entity-link."""
    import re

    seen: set[str] = set()
    out: list[str] = []
    for t in texts:
        if not t:
            continue
        for tok in re.findall(r"[A-Za-z][A-Za-z0-9-]{3,}", t):
            tok = tok.strip()
            low = tok.lower()
            if low and low not in seen:
                seen.add(low)
                out.append(tok)
                if len(out) >= 12:
                    return out
    return out


async def _subgraph_for_keywords(
    db: AsyncSession,
    keywords: list[str],
    *,
    user_id: UUID,
    limit: int = 60,
) -> dict:
    """Return a subgraph of nodes matching ANY of the keywords by
    name (case-insensitive substring) plus the edges between them.

    Scope: union of the user's private KG and the community pool —
    the idea is that an embedded subgraph view should surface any
    entity the user can see, without the caller having to think
    about scope. Callers that want a stricter scope can use the
    /scope/{scope} endpoint instead.
    """
    if not keywords:
        return {"nodes": [], "edges": [], "total_nodes": 0, "total_edges": 0}

    name_clauses = [
        func.lower(KnowledgeGraphNode.name).like(f"%{k.lower()}%")
        for k in keywords
    ]
    node_q = (
        select(KnowledgeGraphNode)
        .where(
            and_(
                or_(*name_clauses),
                or_(
                    KnowledgeGraphNode.owner_id == user_id,
                    KnowledgeGraphNode.owner_id.is_(None),
                ),
            )
        )
        .limit(limit)
    )
    nodes = (await db.execute(node_q)).scalars().all()
    node_ids = {n.id for n in nodes}
    if not node_ids:
        return {"nodes": [], "edges": [], "total_nodes": 0, "total_edges": 0}

    edge_q = select(KnowledgeGraphEdge).where(
        and_(
            KnowledgeGraphEdge.source_id.in_(node_ids),
            KnowledgeGraphEdge.target_id.in_(node_ids),
        )
    )
    edges = (await db.execute(edge_q)).scalars().all()

    return {
        "nodes": [n.to_dict() for n in nodes],
        "edges": [e.to_dict() for e in edges],
        "total_nodes": len(nodes),
        "total_edges": len(edges),
    }


@router.get("/hypothesis/{hypothesis_id}")
async def get_hypothesis_subgraph(
    hypothesis_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    """Subgraph of KG entities mentioned in the hypothesis text.

    MVP heuristic: extract keywords from the hypothesis statement,
    mechanism, and tags, then match KG node names by ILIKE. Phase 2
    will swap this for proper NER + entity linking once the
    extraction pipeline is wired through to the KG.
    """
    h = (
        await db.execute(
            select(Hypothesis).where(Hypothesis.id == hypothesis_id)
        )
    ).scalar_one_or_none()
    if h is None:
        # Per the tenant-isolation convention (404 not 403) so we
        # don't leak existence to non-owners.
        raise HTTPException(status_code=404, detail="Hypothesis not found")

    keywords = _candidate_keywords(
        h.statement, h.mechanism, *(h.tags or [])
    )
    payload = await _subgraph_for_keywords(db, keywords, user_id=user.id)
    payload["hypothesis_id"] = str(hypothesis_id)
    payload["keywords_used"] = keywords
    return payload


@router.get("/paper/{paper_id}")
async def get_paper_subgraph(
    paper_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    """Subgraph of KG entities mentioned in the saved paper.

    Same MVP heuristic as the hypothesis variant — extracts keywords
    from the paper's title and disease focus, then ILIKE-matches KG
    node names. Phase 2 swaps for NER once the paper-ingest pipeline
    surfaces entities directly.
    """
    p = (
        await db.execute(
            select(SavedResearchPaper).where(SavedResearchPaper.id == paper_id)
        )
    ).scalar_one_or_none()
    if p is None:
        raise HTTPException(status_code=404, detail="Paper not found")

    keywords = _candidate_keywords(
        getattr(p, "hypothesis_title", None) or getattr(p, "title", None),
        getattr(p, "disease", None),
    )
    payload = await _subgraph_for_keywords(db, keywords, user_id=user.id)
    payload["paper_id"] = str(paper_id)
    payload["keywords_used"] = keywords
    return payload
