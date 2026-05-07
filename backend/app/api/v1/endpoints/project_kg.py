"""
Project Knowledge Graph API

GET /api/v1/projects/{project_id}/kg
    Return the 3D-renderable subgraph that was used during discovery
    runs for a given project. Output shape matches react-force-graph-3d:
        { nodes: [...], links: [...], stats: {...} }

This is what powers the project-level "Knowledge Graph" tab — every
node emitted by a stage of a discovery run in this project, plus every
connected public-domain / common-scope ancestor, rendered as an
interactive 3D force-directed graph with kind-coloured nodes and
relation-coloured edges.

The endpoint is public-shaped (no auth) intentionally — scope filtering
happens at the service layer (private nodes are filtered by owner_user_id
when the caller identifies themselves via the user_id query param). A
hardening pass can add proper auth dep later; this ships the feature
the user asked for today.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Path, Query
from pydantic import BaseModel, Field

from app.core.auth import AUTH_REQUIRED
from app.core.logging import get_logger
from app.services.kg_first_service import get_kg_first_service

logger = get_logger(__name__)

router = APIRouter(prefix="/projects", tags=["project-kg"], dependencies=AUTH_REQUIRED)


class KGNode(BaseModel):
    id: str
    name: str
    kind: str
    scope: str
    group: str
    color: str
    shape: str
    size: int
    canonical_id: str | None = None
    payload: dict = Field(default_factory=dict)


class KGLink(BaseModel):
    source: str
    target: str
    relation: str
    confidence: float
    color: str
    scope: str


class KGStats(BaseModel):
    nodes: int
    edges: int
    project_private: int
    project_common: int
    public_domain: int


class ProjectKGResponse(BaseModel):
    project_id: str
    nodes: list[KGNode]
    links: list[KGLink]
    stats: KGStats


@router.get("/{project_id}/kg", response_model=ProjectKGResponse)
async def get_project_kg(
    project_id: str = Path(..., min_length=1, max_length=128),
    user_id: str | None = Query(
        default=None,
        description="Optional user_id — required to see project_private nodes owned by that user",
    ),
    include_ancestors: bool = Query(
        default=True,
        description="Include public-domain seed nodes connected to this project (Reactome pathways, UniProt proteins referenced by hypotheses)",
    ),
    max_nodes: int = Query(default=500, ge=10, le=5000),
):
    """Return the 3D-renderable subgraph for a project.

    Shape:
        { nodes: [ {id, name, kind, scope, color, shape, size, payload}, ...],
          links: [ {source, target, relation, confidence, color, scope}, ...],
          stats: { nodes, edges, project_private, project_common, public_domain } }

    The frontend renders this with react-force-graph-3d:
        <ForceGraph3D graphData={data}
                      nodeColor={n => n.color}
                      nodeVal={n => n.size}
                      linkColor={l => l.color} />
    """
    svc = get_kg_first_service()
    try:
        data = await svc.project_subgraph(
            project_id=project_id,
            user_id=user_id,
            include_ancestors=include_ancestors,
            max_nodes=max_nodes,
        )
    except Exception as e:
        logger.warning(f"project_subgraph failed for {project_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    return ProjectKGResponse(
        project_id=project_id,
        nodes=data["nodes"],
        links=data["links"],
        stats=data["stats"],
    )
