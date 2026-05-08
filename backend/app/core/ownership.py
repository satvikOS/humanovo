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


def filter_by_owned_or_global_project(
    query: Select[T],
    model_with_nullable_project_id,
    user: User,
) -> Select[T]:
    """Augment `query` so it returns rows whose `project_id` is either
    NULL (a globally-visible item) or references a Project owned by
    `user`.

    Used by Evidence and Citation, which carry an optional `project_id`
    and intentionally allow null-project rows in the corpus.

    Once we add `created_by` to those models, the global branch will
    tighten to `created_by IS NULL OR created_by == user.id` so that
    user-uploaded items aren't visible to other users by default.
    """
    return query.outerjoin(
        Project, Project.id == model_with_nullable_project_id.project_id
    ).where(
        (model_with_nullable_project_id.project_id.is_(None))
        | (Project.owner_id == user.id)
    )


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


async def fetch_owned_or_global_or_404(
    db: AsyncSession,
    model_with_nullable_project_id,
    row_id: UUID,
    user: User,
):
    """Like `fetch_owned_or_404` but tolerates a NULL project_id (the
    row is then treated as globally accessible). For Evidence and
    Citation pre-`created_by`-column.
    """
    query = (
        select(model_with_nullable_project_id)
        .outerjoin(
            Project, Project.id == model_with_nullable_project_id.project_id
        )
        .where(
            model_with_nullable_project_id.id == row_id,
            (model_with_nullable_project_id.project_id.is_(None))
            | (Project.owner_id == user.id),
        )
    )
    result = await db.execute(query)
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(
            status_code=404,
            detail=f"{model_with_nullable_project_id.__name__} not found",
        )
    return row


async def fetch_owned_directly_or_404(
    db: AsyncSession,
    model_with_owner_id,
    row_id: UUID,
    user: User,
):
    """Fetch a row by `id` only if the caller is its direct owner.

    For platform-shared models that carry an `owner_id` FK directly
    (no transitive ownership through a Project): clinical trials,
    biobank samples, IRB submissions, ML models, imaging studies,
    manuscripts, regulatory documents, datasets, saved analyses.

    Returns the row on success; raises 404 (not 403) on absent /
    cross-tenant. The 404 is intentional: it prevents probing for
    the existence of someone else's row IDs.
    """
    query = select(model_with_owner_id).where(
        model_with_owner_id.id == row_id,
        model_with_owner_id.owner_id == user.id,
    )
    result = await db.execute(query)
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(
            status_code=404, detail=f"{model_with_owner_id.__name__} not found"
        )
    return row


def filter_by_owner(query: Select[T], model_with_owner_id, user: User) -> Select[T]:
    """Augment `query` so it only returns rows whose `owner_id` is the
    caller. For platform-shared models with a direct owner_id column.
    """
    return query.where(model_with_owner_id.owner_id == user.id)
