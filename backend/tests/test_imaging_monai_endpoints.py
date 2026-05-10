"""
Tests for the MONAI endpoint scaffolding in
`backend/app/api/v1/endpoints/imaging.py`.

Strategy mirrors the citations endpoint test (direct handler invocation
+ per-test User fixture) so we don't have to spin up an HTTP server.
The MONAI runtime itself is intentionally not exercised — the endpoints
return 501 with a helpful install-hint message until
`pip install monai[all]` lands on the backend image. These tests
freeze that contract so a future runtime wire-up doesn't silently
change the response shape.

Tested:
  * /imaging/monai/health responds with the available flag (false in
    the test venv — pytest doesn't have monai installed).
  * /imaging/monai/segment with an unknown study_id returns 404 (tenant
    isolation enforced via fetch_owned_directly_or_404 BEFORE the MONAI
    501 check).
  * /imaging/monai/segment with a valid owned study_id returns 501 with
    the install-hint detail message in the test venv.
  * /imaging/monai/classify same shape as segment.
  * /imaging/monai/register requires both fixed_study_id and
    moving_study_id — 422 if either is missing.
"""
from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.imaging import (
    MonaiOpRequest,
    monai_classify,
    monai_health,
    monai_register,
    monai_segment,
)
from app.core.database import async_session_factory, engine
from app.models.platform_entities import ImagingStudy
from app.models.user import User, UserRole, UserTier


@pytest.fixture(autouse=True)
async def _dispose_between_tests():
    await engine.dispose()
    yield


async def _make_user() -> User:
    async with async_session_factory() as db:
        u = User(
            email=f"test-monai-{uuid.uuid4().hex[:12]}@humanovo.test",
            hashed_password="x" * 60,
            full_name="MONAI Test User",
            role=UserRole.RESEARCHER,
            tier=UserTier.RESEARCHER,
            is_active=True,
            is_verified=True,
        )
        db.add(u)
        await db.commit()
        await db.refresh(u)
        return u


async def _make_study(owner: User) -> ImagingStudy:
    """Create an ImagingStudy owned by `owner` and return its row."""
    async with async_session_factory() as db:
        s = ImagingStudy(
            owner_id=owner.id,
            title="Test CT scan",
            modality="CT",
            body_part="Chest",
            findings="",
            width=512,
            height=512,
        )
        db.add(s)
        await db.commit()
        await db.refresh(s)
        return s


@pytest.fixture
async def user() -> User:
    return await _make_user()


# ─── /monai/health ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_monai_health_reports_unavailable_in_test_venv() -> None:
    """
    The test virtualenv doesn't have monai installed, so health should
    report available=false. Endpoint list should match the three
    actually-exposed routes (segment / classify / register).
    """
    result = await monai_health()
    assert result["available"] is False
    assert sorted(result["endpoints"]) == sorted([
        "/monai/segment",
        "/monai/classify",
        "/monai/register",
    ])


# ─── /monai/segment ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_monai_segment_returns_404_for_unknown_study(user: User) -> None:
    """
    Tenant isolation runs BEFORE the 501-not-installed check —
    fetch_owned_directly_or_404 raises 404 for a study_id the user
    doesn't own (or that doesn't exist at all). Important: don't leak
    runtime-availability information to a non-owner.
    """
    body = MonaiOpRequest(study_id=uuid.uuid4())
    async with async_session_factory() as db:
        with pytest.raises(HTTPException) as exc:
            await monai_segment(body, user, db)
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_monai_segment_returns_501_with_install_hint(user: User) -> None:
    """
    A valid owned study_id passes the tenant check, then hits the
    runtime probe. In the test venv MONAI isn't installed so the
    handler raises 501 with a detail message that points the operator
    at the install command + MONAI_MODEL_DIR setup. Frozen here so a
    future runtime wire-up doesn't accidentally change the contract
    the renderer is already calling against.
    """
    study = await _make_study(user)
    body = MonaiOpRequest(study_id=study.id)
    async with async_session_factory() as db:
        with pytest.raises(HTTPException) as exc:
            await monai_segment(body, user, db)
    assert exc.value.status_code == 501
    detail = str(exc.value.detail)
    # Frozen contract — renderer surfaces this message verbatim, so the
    # exact words matter for diagnosing self-hosted backends. The test
    # asserts the key phrases without pinning the full string.
    assert "MONAI" in detail
    assert "monai[all]" in detail


# ─── /monai/classify ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_monai_classify_returns_501_with_install_hint(user: User) -> None:
    study = await _make_study(user)
    body = MonaiOpRequest(study_id=study.id)
    async with async_session_factory() as db:
        with pytest.raises(HTTPException) as exc:
            await monai_classify(body, user, db)
    assert exc.value.status_code == 501


@pytest.mark.asyncio
async def test_monai_classify_returns_404_for_unknown_study(user: User) -> None:
    body = MonaiOpRequest(study_id=uuid.uuid4())
    async with async_session_factory() as db:
        with pytest.raises(HTTPException) as exc:
            await monai_classify(body, user, db)
    assert exc.value.status_code == 404


# ─── /monai/register ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_monai_register_requires_both_study_ids(user: User) -> None:
    """
    Register operates on a fixed/moving pair; either being missing is
    a 422 *before* the tenant check, since the request shape itself
    is invalid.
    """
    # Only fixed_study_id provided.
    body = MonaiOpRequest(
        study_id=uuid.uuid4(),
        fixed_study_id=uuid.uuid4(),
    )
    async with async_session_factory() as db:
        with pytest.raises(HTTPException) as exc:
            await monai_register(body, user, db)
    assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_monai_register_returns_501_for_owned_pair(user: User) -> None:
    fixed = await _make_study(user)
    moving = await _make_study(user)
    body = MonaiOpRequest(
        study_id=uuid.uuid4(),  # placeholder; register doesn't use it for tenancy
        fixed_study_id=fixed.id,
        moving_study_id=moving.id,
    )
    async with async_session_factory() as db:
        with pytest.raises(HTTPException) as exc:
            await monai_register(body, user, db)
    assert exc.value.status_code == 501


@pytest.mark.asyncio
async def test_monai_register_returns_404_when_user_doesnt_own_fixed_study(user: User) -> None:
    # Random fixed_study_id (doesn't exist / not owned).
    body = MonaiOpRequest(
        study_id=uuid.uuid4(),
        fixed_study_id=uuid.uuid4(),
        moving_study_id=uuid.uuid4(),
    )
    async with async_session_factory() as db:
        with pytest.raises(HTTPException) as exc:
            await monai_register(body, user, db)
    assert exc.value.status_code == 404
