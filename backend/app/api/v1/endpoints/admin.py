"""
Admin endpoints — dev-environment only.

Exposes the `seed_kg` script as a POST /admin/seed-kg call so the
frontend can surface a "Populate demo KG" button. Refuses to run
in production (ENVIRONMENT=production) or when a seed has already
completed unless `force=true` is passed.

These endpoints are NOT part of the public surface; they exist to
make the dev loop + sandbox demos self-service from the UI.
"""

import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.models.platform_entities import KnowledgeGraphNode, KnowledgeGraphEdge

logger = logging.getLogger(__name__)
router = APIRouter()


class SeedResponse(BaseModel):
    ok: bool
    environment: str
    nodes_before: int
    nodes_after: int
    edges_before: int
    edges_after: int
    embeddings_written: int
    neo4j_nodes: int
    neo4j_edges: int
    message: str


@router.get("/kg-stats")
async def get_kg_stats(
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Live KG + corpus stats — used by the frontend admin panel + the
    Dashboard differentiator strip to decide whether to offer the
    'Seed demo' CTA and to show live counts without per-page joins."""
    node_count = (await db.execute(select(func.count(KnowledgeGraphNode.id)))).scalar() or 0
    edge_count = (await db.execute(select(func.count(KnowledgeGraphEdge.id)))).scalar() or 0
    emb_kg = (
        await db.execute(
            text("SELECT COUNT(*) FROM vector_embeddings WHERE source_type = 'kg_entity'")
        )
    ).scalar() or 0
    emb_ev = (
        await db.execute(
            text("SELECT COUNT(*) FROM vector_embeddings WHERE source_type = 'evidence'")
        )
    ).scalar() or 0
    # Also include the downstream corpus counts so the Dashboard knows
    # whether to offer the full-seed CTA.
    ev_count = (
        await db.execute(text("SELECT COUNT(*) FROM evidence"))
    ).scalar() or 0
    hyp_count = (
        await db.execute(text("SELECT COUNT(*) FROM hypotheses"))
    ).scalar() or 0
    project_count = (
        await db.execute(text("SELECT COUNT(*) FROM projects"))
    ).scalar() or 0
    return {
        "environment": settings.ENVIRONMENT,
        "node_count": node_count,
        "edge_count": edge_count,
        "embedding_count": emb_kg,
        "evidence_count": ev_count,
        "evidence_embedding_count": emb_ev,
        "hypothesis_count": hyp_count,
        "project_count": project_count,
        "seed_available": node_count < 200,
        "corpus_seeded": ev_count >= 10 and hyp_count >= 2,
    }


@router.post("/seed-corpus", response_model=dict)
async def seed_evidence_corpus(
    force: bool = Query(False),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Run the evidence/hypothesis seed — fills the Evidence page +
    Hypothesis list with KG-linked demo data. Idempotent."""
    if settings.ENVIRONMENT.lower() == "production":
        raise HTTPException(
            status_code=403,
            detail="Seed refuses to run in production. Use the ingestion pipeline.",
        )
    before_ev = (await db.execute(text("SELECT COUNT(*) FROM evidence"))).scalar() or 0
    if before_ev >= 10 and not force:
        return {
            "ok": True,
            "message": f"Evidence corpus already has {before_ev} rows; pass ?force=true to reseed.",
            "evidence_count": before_ev,
        }
    from scripts.seed_evidence import seed as seed_corpus
    result = await seed_corpus()
    after_ev = (await db.execute(text("SELECT COUNT(*) FROM evidence"))).scalar() or 0
    return {
        "ok": True,
        "environment": settings.ENVIRONMENT,
        **result,
        "evidence_count_after": after_ev,
        "message": f"Seeded {result.get('evidence_upserted', 0)} evidence + "
                   f"{result.get('hypotheses_upserted', 0)} hypotheses + "
                   f"{result.get('projects_upserted', 0)} projects.",
    }


@router.post("/seed-kg", response_model=SeedResponse)
async def seed_knowledge_graph(
    force: bool = Query(False, description="Re-run seed even if KG already populated"),
    db: AsyncSession = Depends(get_db),
) -> SeedResponse:
    """Populate the KG with a curated biomedical slice.

    Idempotent: re-runs upsert by (name, type). If the KG already has
    at least 50 nodes and `force=false`, returns early without work.
    Gated to non-production environments.
    """
    if settings.ENVIRONMENT.lower() == "production":
        raise HTTPException(
            status_code=403,
            detail="Seed refuses to run in production. Use an ingestion pipeline instead.",
        )

    before_nodes = (await db.execute(select(func.count(KnowledgeGraphNode.id)))).scalar() or 0
    before_edges = (await db.execute(select(func.count(KnowledgeGraphEdge.id)))).scalar() or 0

    if before_nodes >= 50 and not force:
        return SeedResponse(
            ok=True,
            environment=settings.ENVIRONMENT,
            nodes_before=before_nodes,
            nodes_after=before_nodes,
            edges_before=before_edges,
            edges_after=before_edges,
            embeddings_written=0,
            neo4j_nodes=0,
            neo4j_edges=0,
            message=(
                f"KG already has {before_nodes} nodes; skipping seed. "
                "Pass ?force=true to reseed."
            ),
        )

    # Run the seed script's seed() in-process.
    from scripts.seed_kg import seed

    result = await seed()

    after_nodes = (await db.execute(select(func.count(KnowledgeGraphNode.id)))).scalar() or 0
    after_edges = (await db.execute(select(func.count(KnowledgeGraphEdge.id)))).scalar() or 0

    return SeedResponse(
        ok=True,
        environment=settings.ENVIRONMENT,
        nodes_before=before_nodes,
        nodes_after=after_nodes,
        edges_before=before_edges,
        edges_after=after_edges,
        embeddings_written=result.get("embeddings_written", 0),
        neo4j_nodes=result.get("neo4j_nodes_mirrored", 0),
        neo4j_edges=result.get("neo4j_edges_mirrored", 0),
        message=(
            f"Seeded: {after_nodes - before_nodes} new nodes, "
            f"{after_edges - before_edges} new edges, "
            f"{result.get('embeddings_written', 0)} embeddings, "
            f"Neo4j {result.get('neo4j_nodes_mirrored', 0)} nodes / "
            f"{result.get('neo4j_edges_mirrored', 0)} edges."
        ),
    )
