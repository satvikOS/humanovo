"""
Tests for /discovery-sessions endpoints.

Calls the FastAPI route handlers directly against a fresh async DB
session per test — matches the pattern used by
tests/test_regression_endpoint.py and avoids the asyncpg-connection-
reuse race that shared-client test harnesses run into.

Each test gets its own fresh User row so `owner_id` filters in the
handlers exercise correctly without cross-test bleed.
"""
from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.discovery_sessions import (
    AppendMessagePayload,
    Message,
    SessionCreate,
    SessionUpdate,
    append_message,
    create_session,
    delete_session,
    fork_session,
    get_session,
    list_sessions,
    update_session,
)
from app.core.database import async_session_factory, engine
from app.models.user import User, UserRole, UserTier


@pytest.fixture(autouse=True)
async def _dispose_between_tests():
    """
    pytest-asyncio's auto mode spins up a fresh event loop for each
    test, but the module-level SQLAlchemy engine keeps its asyncpg
    connection pool bound to the original loop. Disposing before
    each test forces a fresh pool on the current loop so we don't
    hit "another operation is in progress" across tests.
    """
    await engine.dispose()
    yield


async def _make_user() -> User:
    """Create and persist a fresh User row for this test, return it."""
    async with async_session_factory() as db:
        u = User(
            email=f"test-{uuid.uuid4().hex[:12]}@humanovo.test",
            hashed_password="x" * 60,  # bcrypt-shaped placeholder, never verified here
            full_name="Test User",
            role=UserRole.RESEARCHER,
            tier=UserTier.RESEARCHER,
            is_active=True,
            is_verified=True,
        )
        db.add(u)
        await db.commit()
        await db.refresh(u)
        return u


@pytest.fixture
async def user() -> User:
    return await _make_user()


async def _with_session(fn):
    """Run an endpoint handler against a fresh AsyncSession."""
    async with async_session_factory() as db:
        try:
            result = await fn(db)
            await db.commit()
            return result
        except Exception:
            await db.rollback()
            raise


@pytest.mark.asyncio
async def test_create_session_returns_defaults(user: User) -> None:
    body = SessionCreate()
    data = await _with_session(lambda db: create_session(body, db, user))
    assert data.title == "New conversation"
    assert data.pinned is False
    assert data.messages == []
    assert data.agent_config["model"] == "claude-opus-4-7"
    assert data.agent_config["temperature"] == 0.7
    assert data.agent_config["tools"]["rag"] is True
    assert data.agent_config["tools"]["simulation"] is False


@pytest.mark.asyncio
async def test_create_session_with_custom_title_and_config(user: User) -> None:
    body = SessionCreate(title="Cancer hypothesis hunt", agent_config={"temperature": 0.2, "model": "claude-sonnet-4-6"})
    data = await _with_session(lambda db: create_session(body, db, user))
    assert data.title == "Cancer hypothesis hunt"
    assert data.agent_config["temperature"] == 0.2
    assert data.agent_config["model"] == "claude-sonnet-4-6"
    # The default fields we didn't override must still be present.
    assert "system_prompt" in data.agent_config


@pytest.mark.asyncio
async def test_list_sessions_orders_pinned_first(user: User) -> None:
    unique = uuid.uuid4().hex[:8]
    a = await _with_session(lambda db: create_session(SessionCreate(title=f"A-{unique}"), db, user))
    b = await _with_session(lambda db: create_session(SessionCreate(title=f"B-{unique}"), db, user))
    c = await _with_session(lambda db: create_session(SessionCreate(title=f"C-{unique}"), db, user))
    # Pin b.
    await _with_session(lambda db: update_session(b.id, SessionUpdate(pinned=True), db, user))
    rows = await _with_session(lambda db: list_sessions(
        project_id=None, q=unique, pinned_only=False, limit=100, db=db, current_user=user,
    ))
    titles = [s.title for s in rows]
    assert titles.index(f"B-{unique}") < titles.index(f"A-{unique}")
    assert titles.index(f"B-{unique}") < titles.index(f"C-{unique}")


@pytest.mark.asyncio
async def test_list_pinned_only_filter(user: User) -> None:
    tag = uuid.uuid4().hex[:8]
    a = await _with_session(lambda db: create_session(SessionCreate(title=f"unpinned-{tag}"), db, user))
    b = await _with_session(lambda db: create_session(SessionCreate(title=f"pinned-{tag}"), db, user))
    await _with_session(lambda db: update_session(b.id, SessionUpdate(pinned=True), db, user))
    rows = await _with_session(lambda db: list_sessions(
        project_id=None, q=tag, pinned_only=True, limit=100, db=db, current_user=user,
    ))
    titles = [s.title for s in rows]
    assert f"pinned-{tag}" in titles
    assert f"unpinned-{tag}" not in titles


@pytest.mark.asyncio
async def test_search_by_title(user: User) -> None:
    needle = f"needle-{uuid.uuid4().hex[:8]}"
    haystack = f"hay-{uuid.uuid4().hex[:8]}"
    await _with_session(lambda db: create_session(SessionCreate(title=f"about {needle}"), db, user))
    await _with_session(lambda db: create_session(SessionCreate(title=haystack), db, user))
    rows = await _with_session(lambda db: list_sessions(
        project_id=None, q=needle, pinned_only=False, limit=100, db=db, current_user=user,
    ))
    titles = [s.title for s in rows]
    assert any(needle in t for t in titles)
    assert haystack not in titles


@pytest.mark.asyncio
async def test_append_message_retitles_session_from_first_user_msg(user: User) -> None:
    sess = await _with_session(lambda db: create_session(SessionCreate(), db, user))
    text = "What are the leading hypotheses for Alzheimer's amyloid-independent pathways?"
    msg = Message(role="user", content=text)
    updated = await _with_session(lambda db: append_message(sess.id, AppendMessagePayload(message=msg), db, user))
    assert updated.title.startswith("What are the leading hypotheses")
    assert len(updated.messages) == 1
    assert updated.messages[0].role == "user"


@pytest.mark.asyncio
async def test_append_preserves_existing_custom_title(user: User) -> None:
    sess = await _with_session(lambda db: create_session(SessionCreate(title="Amyloid vs. Tau debate"), db, user))
    msg = Message(role="user", content="Initial prompt")
    updated = await _with_session(lambda db: append_message(sess.id, AppendMessagePayload(message=msg), db, user))
    assert updated.title == "Amyloid vs. Tau debate"


@pytest.mark.asyncio
async def test_append_assistant_message_with_cards(user: User) -> None:
    sess = await _with_session(lambda db: create_session(SessionCreate(title="Card test"), db, user))
    # User turn first.
    await _with_session(lambda db: append_message(
        sess.id, AppendMessagePayload(message=Message(role="user", content="Find mechanisms")), db, user,
    ))
    assistant_msg = Message(
        role="assistant",
        content="Here are three candidates:",
        cards=[  # type: ignore[arg-type]
            {"kind": "hypothesis", "payload": {"id": "h1", "statement": "X regulates Y"}},
            {"kind": "evidence", "payload": {"id": "e1", "title": "Smith 2024"}},
        ],
        finish_reason="stop",
        tokens={"prompt": 120, "completion": 85},
    )
    updated = await _with_session(lambda db: append_message(sess.id, AppendMessagePayload(message=assistant_msg), db, user))
    assert len(updated.messages) == 2
    assert updated.messages[1].role == "assistant"
    assert len(updated.messages[1].cards) == 2
    assert updated.messages[1].cards[0].kind == "hypothesis"
    assert updated.messages[1].tokens["completion"] == 85


@pytest.mark.asyncio
async def test_patch_merges_agent_config_without_losing_defaults(user: User) -> None:
    sess = await _with_session(lambda db: create_session(SessionCreate(), db, user))
    original_prompt = sess.agent_config["system_prompt"]
    body = SessionUpdate(agent_config={"temperature": 0.3})
    updated = await _with_session(lambda db: update_session(sess.id, body, db, user))
    assert updated.agent_config["temperature"] == 0.3
    # System prompt must survive a partial update.
    assert updated.agent_config["system_prompt"] == original_prompt
    assert updated.agent_config["model"] == "claude-opus-4-7"


@pytest.mark.asyncio
async def test_fork_clones_messages_and_config(user: User) -> None:
    sess = await _with_session(lambda db: create_session(SessionCreate(title="Original"), db, user))
    await _with_session(lambda db: append_message(
        sess.id, AppendMessagePayload(message=Message(role="user", content="ping")), db, user,
    ))
    fork = await _with_session(lambda db: fork_session(sess.id, db, user))
    assert fork.id != sess.id
    assert fork.title.endswith("(fork)")
    assert len(fork.messages) == 1
    assert fork.messages[0].content == "ping"


@pytest.mark.asyncio
async def test_delete_session_then_get_404(user: User) -> None:
    sess = await _with_session(lambda db: create_session(SessionCreate(), db, user))
    await _with_session(lambda db: delete_session(sess.id, db, user))
    with pytest.raises(HTTPException) as exc:
        await _with_session(lambda db: get_session(sess.id, db, user))
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_missing_session_404s(user: User) -> None:
    fake = uuid.uuid4()
    with pytest.raises(HTTPException):
        await _with_session(lambda db: get_session(fake, db, user))
    with pytest.raises(HTTPException):
        await _with_session(lambda db: update_session(fake, SessionUpdate(title="x"), db, user))
    with pytest.raises(HTTPException):
        await _with_session(lambda db: delete_session(fake, db, user))


@pytest.mark.asyncio
async def test_other_users_session_is_404() -> None:
    """User A's session must not be visible to User B."""
    user_a = await _make_user()
    user_b = await _make_user()
    sess = await _with_session(lambda db: create_session(SessionCreate(title="A's secret"), db, user_a))
    # User B trying to read A's session — must 404, not 403, to avoid
    # leaking the existence of someone else's UUIDs.
    with pytest.raises(HTTPException) as exc:
        await _with_session(lambda db: get_session(sess.id, db, user_b))
    assert exc.value.status_code == 404
