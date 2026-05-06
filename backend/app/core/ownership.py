"""
Tenant-isolation helpers.

Two patterns dominate humanovo's data model:

1. **Direct ownership** — the row carries `owner_id` (currently only
   `Project`). Filter with `Model.owner_id == user.id`.

2. **Transitive ownership via project** — the row carries `project_id`
   pointing at a Project owned by some user (Hypothesis, Evidence,
   Simulation, AgentTask, Citation, DiscoverySession). Filter through
   a JOIN on `Project.owner_id`.

The helpers below implement (2) so the routers stay concise and the
ownership clause can never be forgotten by accident — every R/U/D
query passes through one of these. The CI guard in
`tests/test_tenant_isolation.py` asserts that fact.

Behavioral contract:
- 404 (not 403) is raised when the row exists but isn't owned by the
  caller — this prevents callers from probing for the existence of
  someone else's project IDs.
- The helpers operate on `select(...)` queries, returning the augmented
  query so the handler can apply further filters/sorts/pagination.
"""

from __future__ import annotations

from typing import TypeVar
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import Project
from app.models.user import User

T = TypeVar("T")


def filter_by_owned_project(
    query: Select[T],
    model_with_project_id,
    user: User,
) -> Select[T]:
    """Augment `query` so it only returns rows whose `project_id`
    references a Project owned by `user`.

    Usage:
        query = select(Hypothesis).where(Hypothesis.project_id == project_id)
        query = filter_by_owned_project(query, Hypothesis, current_user)

    The join is INNER so rows with `project_id IS NULL` are excluded —
    intentional. If a model legitimately allows ownerless rows (e.g.
    public Citations) the route handler should branch around this
    helper for that case.
    """
    return query.join(
        Project, Project.id == model_with_project_id.project_id
    ).where(Project.owner_id == user.id)


async def assert_owns_project(
    db: AsyncSession,
    project_id: UUID,
    user: User,
) -> Project:
    """Confirm the caller owns `project_id`. Returns the Project row on
    success; raises 404 otherwise.

    Used by handlers that mutate child rows (e.g. POST /hypotheses) to
    verify the parent project before writing.
    """
    result = await db.execute(
        select(Project).where(
            Project.id == project_id,
            Project.owner_id == user.id,
        )
    )
    project = result.scalar_one_or_none()
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


async def fetch_owned_or_404(
    db: AsyncSession,
    model_with_project_id,
    row_id: UUID,
    user: User,
):
    """Fetch a row by `id` only if the caller owns its parent project.

    Returns the row on success; raises 404 otherwise. This collapses
    the canonical "load row → check ownership → 404 or proceed" pattern
    that every GET/PATCH/DELETE handler implements.
    """
    query = (
        select(model_with_project_id)
        .join(Project, Project.id == model_with_project_id.project_id)
        .where(
            model_with_project_id.id == row_id,
            Project.owner_id == user.id,
        )
    )
    result = await db.execute(query)
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(
            status_code=404, detail=f"{model_with_project_id.__name__} not found"
        )
    return row
