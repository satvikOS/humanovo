"""
Tests for /discovery-sessions endpoints.

Calls the FastAPI route handlers directly against a fresh async DB
session per test — matches the pattern used by
tests/test_regression_endpoint.py and avoids the asyncpg-connection-
reuse race that shared-client test harnesses run into.
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
async def test_create_session_returns_defaults() -> None:
    body = SessionCreate()
    data = await _with_session(lambda db: create_session(body, db))
    assert data.title == "New conversation"
    assert data.pinned is False
    assert data.messages == []
    assert data.agent_config["model"] == "claude-opus-4-7"
    assert data.agent_config["temperature"] == 0.7
    assert data.agent_config["tools"]["rag"] is True
    assert data.agent_config["tools"]["simulation"] is False


@pytest.mark.asyncio
async def test_create_session_with_custom_title_and_config() -> None:
    body = SessionCreate(title="Cancer hypothesis hunt", agent_config={"temperature": 0.2, "model": "claude-sonnet-4-6"})
    data = await _with_session(lambda db: create_session(body, db))
    assert data.title == "Cancer hypothesis hunt"
    assert data.agent_config["temperature"] == 0.2
    assert data.agent_config["model"] == "claude-sonnet-4-6"
    # The default fields we didn't override must still be present.
    assert "system_prompt" in data.agent_config


@pytest.mark.asyncio
async def test_list_sessions_orders_pinned_first() -> None:
    unique = uuid.uuid4().hex[:8]
    a = await _with_session(lambda db: create_session(SessionCreate(title=f"A-{unique}"), db))
    b = await _with_session(lambda db: create_session(SessionCreate(title=f"B-{unique}"), db))
    c = await _with_session(lambda db: create_session(SessionCreate(title=f"C-{unique}"), db))
    # Pin b.
    await _with_session(lambda db: update_session(b.id, SessionUpdate(pinned=True), db))
    rows = await _with_session(lambda db: list_sessions(project_id=None, q=unique, pinned_only=False, limit=100, db=db))
    titles = [s.title for s in rows]
    assert titles.index(f"B-{unique}") < titles.index(f"A-{unique}")
    assert titles.index(f"B-{unique}") < titles.index(f"C-{unique}")


@pytest.mark.asyncio
async def test_list_pinned_only_filter() -> None:
    tag = uuid.uuid4().hex[:8]
    a = await _with_session(lambda db: create_session(SessionCreate(title=f"unpinned-{tag}"), db))
    b = await _with_session(lambda db: create_session(SessionCreate(title=f"pinned-{tag}"), db))
    await _with_session(lambda db: update_session(b.id, SessionUpdate(pinned=True), db))
    rows = await _with_session(lambda db: list_sessions(project_id=None, q=tag, pinned_only=True, limit=100, db=db))
    titles = [s.title for s in rows]
    assert f"pinned-{tag}" in titles
    assert f"unpinned-{tag}" not in titles


@pytest.mark.asyncio
async def test_search_by_title() -> None:
    needle = f"needle-{uuid.uuid4().hex[:8]}"
    haystack = f"hay-{uuid.uuid4().hex[:8]}"
    await _with_session(lambda db: create_session(SessionCreate(title=f"about {needle}"), db))
    await _with_session(lambda db: create_session(SessionCreate(title=haystack), db))
    rows = await _with_session(lambda db: list_sessions(project_id=None, q=needle, pinned_only=False, limit=100, db=db))
    titles = [s.title for s in rows]
    assert any(needle in t for t in titles)
    assert haystack not in titles


@pytest.mark.asyncio
async def test_append_message_retitles_session_from_first_user_msg() -> None:
    sess = await _with_session(lambda db: create_session(SessionCreate(), db))
    text = "What are the leading hypotheses for Alzheimer's amyloid-independent pathways?"
    msg = Message(role="user", content=text)
    updated = await _with_session(lambda db: append_message(sess.id, AppendMessagePayload(message=msg), db))
    assert updated.title.startswith("What are the leading hypotheses")
    assert len(updated.messages) == 1
    assert updated.messages[0].role == "user"


@pytest.mark.asyncio
async def test_append_preserves_existing_custom_title() -> None:
    sess = await _with_session(lambda db: create_session(SessionCreate(title="Amyloid vs. Tau debate"), db))
    msg = Message(role="user", content="Initial prompt")
    updated = await _with_session(lambda db: append_message(sess.id, AppendMessagePayload(message=msg), db))
    assert updated.title == "Amyloid vs. Tau debate"


@pytest.mark.asyncio
async def test_append_assistant_message_with_cards() -> None:
    sess = await _with_session(lambda db: create_session(SessionCreate(title="Card test"), db))
    # User turn first.
    await _with_session(lambda db: append_message(
        sess.id, AppendMessagePayload(message=Message(role="user", content="Find mechanisms")), db,
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
    updated = await _with_session(lambda db: append_message(sess.id, AppendMessagePayload(message=assistant_msg), db))
    assert len(updated.messages) == 2
    assert updated.messages[1].role == "assistant"
    assert len(updated.messages[1].cards) == 2
    assert updated.messages[1].cards[0].kind == "hypothesis"
    assert updated.messages[1].tokens["completion"] == 85


@pytest.mark.asyncio
async def test_patch_merges_agent_config_without_losing_defaults() -> None:
    sess = await _with_session(lambda db: create_session(SessionCreate(), db))
    original_prompt = sess.agent_config["system_prompt"]
    body = SessionUpdate(agent_config={"temperature": 0.3})
    updated = await _with_session(lambda db: update_session(sess.id, body, db))
    assert updated.agent_config["temperature"] == 0.3
    # System prompt must survive a partial update.
    assert updated.agent_config["system_prompt"] == original_prompt
    assert updated.agent_config["model"] == "claude-opus-4-7"


@pytest.mark.asyncio
async def test_fork_clones_messages_and_config() -> None:
    sess = await _with_session(lambda db: create_session(SessionCreate(title="Original"), db))
    await _with_session(lambda db: append_message(
        sess.id, AppendMessagePayload(message=Message(role="user", content="ping")), db,
    ))
    fork = await _with_session(lambda db: fork_session(sess.id, db))
    assert fork.id != sess.id
    assert fork.title.endswith("(fork)")
    assert len(fork.messages) == 1
    assert fork.messages[0].content == "ping"


@pytest.mark.asyncio
async def test_delete_session_then_get_404() -> None:
    sess = await _with_session(lambda db: create_session(SessionCreate(), db))
    await _with_session(lambda db: delete_session(sess.id, db))
    with pytest.raises(HTTPException) as exc:
        await _with_session(lambda db: get_session(sess.id, db))
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_missing_session_404s() -> None:
    fake = uuid.uuid4()
    with pytest.raises(HTTPException):
        await _with_session(lambda db: get_session(fake, db))
    with pytest.raises(HTTPException):
        await _with_session(lambda db: update_session(fake, SessionUpdate(title="x"), db))
    with pytest.raises(HTTPException):
        await _with_session(lambda db: delete_session(fake, db))
