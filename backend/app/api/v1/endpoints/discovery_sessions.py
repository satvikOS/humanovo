"""
Discovery Sessions — conversational Discovery session persistence.

CRUD for the DiscoverySession model that backs the left-rail session
list and the chat-history display in the redesigned Discovery
(/agents) page. Appending messages is done via a dedicated endpoint
rather than generic PATCH so concurrent streaming writes don't
clobber each other.

Endpoints:
  GET    /discovery-sessions                list (search, project filter, pinned-first)
  POST   /discovery-sessions                create
  GET    /discovery-sessions/{id}           detail
  PATCH  /discovery-sessions/{id}           update (title, pinned, agent_config, notes, project_id)
  DELETE /discovery-sessions/{id}           delete
  POST   /discovery-sessions/{id}/append    append a message (atomic, no read-modify-write race)
  POST   /discovery-sessions/{id}/fork      duplicate a session (useful for "try a different system prompt")
"""
from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import desc, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.logging import get_logger
from app.core.auth import AUTH_REQUIRED, get_current_active_user
from app.core.ownership import assert_owns_project
from app.models.discovery_session import DiscoverySession
from app.models.user import User

logger = get_logger(__name__)
router = APIRouter(prefix="/discovery-sessions", tags=["discovery-sessions"], dependencies=AUTH_REQUIRED)
# ─── Default agent config ────────────────────────────────────────
# Conservative defaults for a newly-created session. The user can
# override any field via the right-side config drawer on the
# Discovery page. `tools` is a dict of boolean flags so toggling
# individual capabilities (RAG / KG / evidence / simulation) doesn't
# require schema churn.
DEFAULT_AGENT_CONFIG: dict[str, Any] = {
    "model": "claude-opus-4-7",
    "temperature": 0.7,
    "system_prompt": (
        "You are Humanovo, a biomedical research co-pilot. Reason from "
        "the provided evidence and knowledge-graph context, cite specific "
        "sources when making claims, and surface novel hypotheses only "
        "when the supporting chain is explicit."
    ),
    "max_hypotheses": 5,
    "tools": {
        "rag": True,         # retrieval-augmented generation over evidence corpus
        "kg": True,          # knowledge-graph traversal
        "evidence": True,    # evidence search
        "simulation": False, # compute-lab simulations (off by default — expensive)
        "web": False,        # external web search (off by default — requires API key)
    },
    "verbosity": "normal",   # terse | normal | verbose
}


# ─── Schemas ─────────────────────────────────────────────────────


class MessageCard(BaseModel):
    """Rich card embedded in an assistant message."""

    kind: str  # "hypothesis" | "evidence" | "entity" | "kg_subgraph" | "citation"
    payload: dict[str, Any]


class Message(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    role: str  # "user" | "assistant" | "system" | "tool"
    content: str
    cards: list[MessageCard] = Field(default_factory=list)
    timestamp: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
    finish_reason: str | None = None
    tokens: dict[str, int] | None = None
    # Optional tool-call trace (only set when role == "tool").
    tool_name: str | None = None
    tool_args: dict[str, Any] | None = None


class SessionCreate(BaseModel):
    title: str | None = None
    project_id: UUID | None = None
    agent_config: dict[str, Any] | None = None
    notes: str | None = None


class SessionUpdate(BaseModel):
    title: str | None = None
    pinned: bool | None = None
    agent_config: dict[str, Any] | None = None
    notes: str | None = None
    project_id: UUID | None = None
    last_run_id: str | None = None


class SessionSummary(BaseModel):
    id: UUID
    title: str
    pinned: bool
    project_id: UUID | None
    message_count: int
    last_run_id: str | None
    updated_at: str
    created_at: str
    # First ~80 chars of the most recent user message — powers the
    # sidebar preview text.
    preview: str | None = None


class SessionDetail(SessionSummary):
    agent_config: dict[str, Any]
    messages: list[Message]
    notes: str | None


class AppendMessagePayload(BaseModel):
    message: Message


# ─── Helpers ─────────────────────────────────────────────────────


def _preview_from_messages(messages: list[dict[str, Any]]) -> str | None:
    """Return the first ~80 chars of the most recent user message."""
    for msg in reversed(messages):
        if msg.get("role") == "user" and msg.get("content"):
            text = msg["content"].strip()
            if len(text) > 80:
                return text[:77] + "..."
            return text
    return None


def _to_summary(session: DiscoverySession) -> SessionSummary:
    messages = session.messages or []
    return SessionSummary(
        id=session.id,
        title=session.title,
        pinned=session.pinned,
        project_id=session.project_id,
        message_count=len(messages),
        last_run_id=session.last_run_id,
        updated_at=session.updated_at.isoformat(),
        created_at=session.created_at.isoformat(),
        preview=_preview_from_messages(messages),
    )


def _to_detail(session: DiscoverySession) -> SessionDetail:
    summary = _to_summary(session)
    # Re-parse messages through the Message schema so validation
    # strips any stale fields before returning to the client.
    msgs = [Message(**m) if isinstance(m, dict) else m for m in (session.messages or [])]
    return SessionDetail(
        **summary.model_dump(),
        agent_config=session.agent_config or DEFAULT_AGENT_CONFIG,
        messages=msgs,
        notes=session.notes,
    )


# ─── Endpoints ───────────────────────────────────────────────────


async def _owned_session_or_404(
    db: AsyncSession, session_id: UUID, current_user: User,
) -> DiscoverySession:
    """Look up a session and confirm `current_user` owns it."""
    result = await db.execute(
        select(DiscoverySession).where(
            DiscoverySession.id == session_id,
            DiscoverySession.owner_id == current_user.id,
        )
    )
    session = result.scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=404, detail="Discovery session not found")
    return session


@router.get("", response_model=list[SessionSummary])
async def list_sessions(
    project_id: UUID | None = Query(None),
    q: str | None = Query(None, description="Search query (title / notes)"),
    pinned_only: bool = Query(False),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> list[SessionSummary]:
    """List the caller's conversations for the sidebar. Pinned
    sessions float to the top regardless of updated_at; within each
    bucket we sort by most recent activity."""
    stmt = (
        select(DiscoverySession)
        .where(DiscoverySession.owner_id == current_user.id)
        .order_by(desc(DiscoverySession.pinned), desc(DiscoverySession.updated_at))
        .limit(limit)
    )
    if project_id is not None:
        stmt = stmt.where(DiscoverySession.project_id == project_id)
    if pinned_only:
        stmt = stmt.where(DiscoverySession.pinned.is_(True))
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(DiscoverySession.title.ilike(like), DiscoverySession.notes.ilike(like)))
    result = await db.execute(stmt)
    return [_to_summary(s) for s in result.scalars().all()]


@router.post("", response_model=SessionDetail, status_code=201)
async def create_session(
    body: SessionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> SessionDetail:
    if body.project_id is not None:
        await assert_owns_project(db, body.project_id, current_user)
    cfg = dict(DEFAULT_AGENT_CONFIG)
    if body.agent_config:
        cfg.update(body.agent_config)
    session = DiscoverySession(
        title=body.title or "New conversation",
        project_id=body.project_id,
        owner_id=current_user.id,
        agent_config=cfg,
        messages=[],
        notes=body.notes,
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return _to_detail(session)


@router.get("/{session_id}", response_model=SessionDetail)
async def get_session(
    session_id: UUID,
    db: AsyncSession = Depends(get_db)  ,
    current_user: User = Depends(get_current_active_user),
) -> SessionDetail:
    session = await _owned_session_or_404(db, session_id, current_user)
    return _to_detail(session)


@router.patch("/{session_id}", response_model=SessionDetail)
async def update_session(
    session_id: UUID,
    body: SessionUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> SessionDetail:
    session = await _owned_session_or_404(db, session_id, current_user)
    data = body.model_dump(exclude_unset=True)
    # Merge agent_config instead of overwriting so partial updates
    # don't drop the system prompt.
    if "agent_config" in data and data["agent_config"] is not None:
        merged = dict(session.agent_config or {})
        merged.update(data.pop("agent_config"))
        session.agent_config = merged
    # If the caller is reassigning project_id, require ownership of
    # the new target project.
    if "project_id" in data and data["project_id"] is not None:
        await assert_owns_project(db, data["project_id"], current_user)
    for key, value in data.items():
        setattr(session, key, value)
    await db.commit()
    await db.refresh(session)
    return _to_detail(session)


@router.delete("/{session_id}", status_code=204)
async def delete_session(
    session_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> None:
    session = await _owned_session_or_404(db, session_id, current_user)
    await db.delete(session)
    await db.commit()


@router.post("/{session_id}/append", response_model=SessionDetail)
async def append_message(
    session_id: UUID,
    body: AppendMessagePayload,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> SessionDetail:
    """Append a single message to one of the caller's sessions
    atomically. Writing the full message list via PATCH would race
    with concurrent streaming writers; this endpoint rebinds the
    JSONB array in-place.

    Auto-retitles the session from the first user message if it's
    still the default "New conversation"."""
    session = await _owned_session_or_404(db, session_id, current_user)
    messages = list(session.messages or [])
    messages.append(body.message.model_dump())
    session.messages = messages
    if session.title in ("New conversation", "", None) and body.message.role == "user":
        text = body.message.content.strip()
        session.title = text[:60] + ("..." if len(text) > 60 else "")
    await db.commit()
    await db.refresh(session)
    return _to_detail(session)


@router.post("/{session_id}/fork", response_model=SessionDetail, status_code=201)
async def fork_session(
    session_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> SessionDetail:
    """Duplicate one of the caller's sessions."""
    source = await _owned_session_or_404(db, session_id, current_user)
    fork = DiscoverySession(
        title=f"{source.title} (fork)",
        project_id=source.project_id,
        owner_id=current_user.id,
        agent_config=dict(source.agent_config or DEFAULT_AGENT_CONFIG),
        messages=list(source.messages or []),
        notes=source.notes,
    )
    db.add(fork)
    await db.commit()
    await db.refresh(fork)
    return _to_detail(fork)
