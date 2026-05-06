"""
Discovery Session Model — persists conversational Discovery sessions.

Every time an author opens the Discovery (/agents) page and starts
asking questions, we persist the conversation so:

  * The left-rail session list can reload past sessions across tabs
    and devices (not just the current browser).
  * Results (hypotheses, evidence refs, KG nodes) stay linked to
    their originating conversation and their parent project.
  * Agent config (model / temperature / system prompt / tools) is
    remembered per session so re-opening doesn't lose state.

Schema overview:
  discovery_sessions
    - id                   UUID PK
    - project_id           UUID (nullable — NULL for scratch sessions)
    - title                text (user-editable)
    - pinned               bool (float-to-top flag)
    - agent_config         JSONB (model, temperature, system_prompt, tools)
    - messages             JSONB[]  (chat turns; see shape below)
    - last_run_id          text (FK-lite to discovery_runs.id)
    - created_at / updated_at

Message shape (stored inline so cross-session query is easy):
  {
    "id": "<uuid>",
    "role": "user" | "assistant" | "system" | "tool",
    "content": "<markdown text>",
    "cards": [ {kind, payload} ],  # inline hypothesis/evidence/entity refs
    "timestamp": "<iso8601>",
    "finish_reason": "stop" | "cancelled" | "error" | null,
    "tokens": {"prompt": n, "completion": n}
  }

Design note: stuffing messages into a JSONB array (instead of a
separate `discovery_messages` table) trades query flexibility for
much simpler CRUD — the typical session has < 200 turns and we
never query by individual turn. If that assumption breaks, the
migration to a child table is straightforward.
"""
from sqlalchemy import Boolean, Column, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID

from app.models.base import BaseModel


class DiscoverySession(BaseModel):
    __tablename__ = "discovery_sessions"

    # Owner — every row belongs to exactly one user. Migration
    # 015_owner_id_on_sessions_and_citations adds the column nullable
    # for backfill purposes; the column is treated as required by the
    # router layer and a follow-up migration will tighten to NOT NULL.
    owner_id = Column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )

    # Optional FK to Project. NULL means the session is a "scratch"
    # conversation the author started without a project scope — they
    # can assign it later via PATCH.
    project_id = Column(PGUUID(as_uuid=True), nullable=True, index=True)

    # User-editable title. Defaults to "New conversation" on create;
    # the first few words of the opening user message fill it in when
    # the session gets saved the first time.
    title = Column(String(500), nullable=False, default="New conversation")

    # Pinned sessions float to the top of the sidebar regardless of
    # last-activity timestamp.
    pinned = Column(Boolean, nullable=False, default=False, index=True)

    # Agent configuration payload. Shape:
    #   { "model": "claude-opus-4-7", "temperature": 0.7,
    #     "system_prompt": "...", "tools": {"rag": true, "kg": true,
    #     "evidence": true, "simulation": false}, "max_hypotheses": 5 }
    agent_config = Column(JSONB, nullable=False, default=dict)

    # List of message objects. See the module-level docstring for the
    # per-message shape.
    messages = Column(JSONB, nullable=False, default=list)

    # FK-lite to DiscoveryRun — set to the most recent run_id this
    # session triggered, so reopening the session can reconnect to
    # that WebSocket (if the run is still live).
    last_run_id = Column(String(128), nullable=True)

    # Free-form author notes (visible in the sidebar tooltip).
    notes = Column(Text, nullable=True)
