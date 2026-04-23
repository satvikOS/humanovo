"""
Tests for /citations, /citation-folders, /citations/{id}/highlights,
and the import/export endpoints. Same direct-handler pattern as
test_discovery_sessions.py to avoid event-loop connection reuse.
"""
from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.citations import (
    BulkDeleteBody,
    CitationCreate,
    CitationUpdate,
    ExportBody,
    FolderCreate,
    FolderUpdate,
    HighlightCreate,
    HighlightUpdate,
    ImportBody,
    bulk_delete_citations,
    create_citation,
    create_folder,
    create_highlight,
    delete_citation,
    delete_folder,
    delete_highlight,
    export_citations,
    get_citation,
    import_citations,
    list_citations,
    list_folders,
    list_highlights,
    update_citation,
    update_folder,
    update_highlight,
)
from app.core.database import async_session_factory, engine


@pytest.fixture(autouse=True)
async def _dispose_between_tests():
    await engine.dispose()
    yield


async def _with_session(fn):
    async with async_session_factory() as db:
        try:
            result = await fn(db)
            await db.commit()
            return result
        except Exception:
            await db.rollback()
            raise


# ─── Citations CRUD ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_and_get_citation() -> None:
    body = CitationCreate(title="Test Paper", authors=["Alice Smith"], year=2024, doi=f"10.9999/{uuid.uuid4().hex[:8]}")
    created = await _with_session(lambda db: create_citation(body, db))
    assert created.title == "Test Paper"
    assert created.authors == ["Alice Smith"]
    assert created.year == 2024
    fetched = await _with_session(lambda db: get_citation(created.id, db))
    assert fetched.id == created.id


@pytest.mark.asyncio
async def test_create_citation_dedupes_on_doi() -> None:
    doi = f"10.9999/{uuid.uuid4().hex[:8]}"
    a = await _with_session(lambda db: create_citation(CitationCreate(title="Original", authors=["A"], year=2024, doi=doi), db))
    b = await _with_session(lambda db: create_citation(CitationCreate(title="Dupe", authors=["B"], year=2024, doi=doi), db))
    # Second call with same DOI returns the existing row.
    assert a.id == b.id
    assert b.title == "Original"


@pytest.mark.asyncio
async def test_update_citation_partial() -> None:
    c = await _with_session(lambda db: create_citation(CitationCreate(title="Patch me", authors=["X"], year=2024, doi=f"10.0/{uuid.uuid4().hex[:8]}"), db))
    updated = await _with_session(lambda db: update_citation(c.id, CitationUpdate(starred=True, notes="read this"), db))
    assert updated.starred is True
    assert updated.notes == "read this"
    # Unspecified fields preserved.
    assert updated.title == "Patch me"


@pytest.mark.asyncio
async def test_list_citations_search_and_filters() -> None:
    tag = f"unique-tag-{uuid.uuid4().hex[:6]}"
    d1 = f"10.0/{uuid.uuid4().hex[:8]}"
    d2 = f"10.0/{uuid.uuid4().hex[:8]}"
    await _with_session(lambda db: create_citation(CitationCreate(title=f"needle-{uuid.uuid4().hex[:6]} paper", authors=["Y"], year=2020, tags=[tag], doi=d1), db))
    await _with_session(lambda db: create_citation(CitationCreate(title="haystack paper", authors=["Z"], year=2021, doi=d2), db))
    # Tag filter
    rows = await _with_session(lambda db: list_citations(q=None, starred_only=False, unread_only=False, tag=tag, folder=None, year=None, author=None, project_id=None, limit=200, offset=0, db=db))
    assert len(rows) == 1
    assert tag in rows[0].tags
    # Year filter
    rows_y = await _with_session(lambda db: list_citations(q=None, starred_only=False, unread_only=False, tag=None, folder=None, year=2020, author=None, project_id=None, limit=200, offset=0, db=db))
    assert any(r.year == 2020 for r in rows_y)


@pytest.mark.asyncio
async def test_delete_citation_and_404() -> None:
    c = await _with_session(lambda db: create_citation(CitationCreate(title="Goner", authors=["W"], year=2019, doi=f"10.0/{uuid.uuid4().hex[:8]}"), db))
    await _with_session(lambda db: delete_citation(c.id, db))
    with pytest.raises(HTTPException) as exc:
        await _with_session(lambda db: get_citation(c.id, db))
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_bulk_delete_citations() -> None:
    created_ids = []
    for i in range(3):
        c = await _with_session(lambda db: create_citation(CitationCreate(title=f"Bulk {i}", authors=["B"], year=2024, doi=f"10.0/{uuid.uuid4().hex[:8]}"), db))
        created_ids.append(c.id)
    res = await _with_session(lambda db: bulk_delete_citations(BulkDeleteBody(ids=created_ids), db))
    assert res["deleted_count"] == 3


# ─── Folders ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_folder_crud_including_delete_reparents_children() -> None:
    parent = await _with_session(lambda db: create_folder(FolderCreate(name="Parent"), db))
    child = await _with_session(lambda db: create_folder(FolderCreate(name="Child", parent_id=parent.id), db))
    grandchild = await _with_session(lambda db: create_folder(FolderCreate(name="Grand", parent_id=child.id), db))

    # Delete the middle node — grandchild should reparent to parent.
    await _with_session(lambda db: delete_folder(child.id, db))

    rows = await _with_session(lambda db: list_folders(project_id=None, db=db))
    by_id = {f.id: f for f in rows}
    assert child.id not in by_id
    assert parent.id in by_id
    assert by_id[grandchild.id].parent_id == parent.id


@pytest.mark.asyncio
async def test_folder_rename_and_reorder() -> None:
    f = await _with_session(lambda db: create_folder(FolderCreate(name="Original"), db))
    updated = await _with_session(lambda db: update_folder(f.id, FolderUpdate(name="Renamed", order_index=5, color="#888888"), db))
    assert updated.name == "Renamed"
    assert updated.order_index == 5
    assert updated.color == "#888888"


# ─── Highlights ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_highlights_attach_to_citation_and_list() -> None:
    c = await _with_session(lambda db: create_citation(CitationCreate(title="With highlights", authors=["H"], year=2024, doi=f"10.0/{uuid.uuid4().hex[:8]}"), db))
    h1 = await _with_session(lambda db: create_highlight(c.id, HighlightCreate(citation_id=c.id, page=1, rect={"x": 0.1, "y": 0.2, "w": 0.3, "h": 0.05}, text="first", color="#C4956A"), db))
    h2 = await _with_session(lambda db: create_highlight(c.id, HighlightCreate(citation_id=c.id, page=3, rect={"x": 0.0, "y": 0.5, "w": 0.4, "h": 0.08}, text="third", note="important"), db))
    rows = await _with_session(lambda db: list_highlights(c.id, db))
    # Ordered by page.
    assert [h.page for h in rows] == [1, 3]
    assert rows[0].text == "first"
    assert rows[1].note == "important"
    # Update one.
    u = await _with_session(lambda db: update_highlight(h1.id, HighlightUpdate(note="revisit"), db))
    assert u.note == "revisit"
    # Delete.
    await _with_session(lambda db: delete_highlight(h2.id, db))
    rows_after = await _with_session(lambda db: list_highlights(c.id, db))
    assert len(rows_after) == 1


@pytest.mark.asyncio
async def test_delete_citation_cascades_highlights() -> None:
    c = await _with_session(lambda db: create_citation(CitationCreate(title="Cascade", authors=["C"], year=2024, doi=f"10.0/{uuid.uuid4().hex[:8]}"), db))
    await _with_session(lambda db: create_highlight(c.id, HighlightCreate(citation_id=c.id, page=1, rect={"x": 0, "y": 0, "w": 1, "h": 1}), db))
    await _with_session(lambda db: delete_citation(c.id, db))
    # Highlights list returns empty for the deleted citation id.
    rows = await _with_session(lambda db: list_highlights(c.id, db))
    assert rows == []


# ─── Import / Export ────────────────────────────────────────────


BIBTEX_TEXT = """
@article{test_import_2024,
  title = {Imported Test Paper},
  author = {Imp, Orte},
  journal = {Test J},
  year = {2024},
  doi = {10.9991/imp.{}.2024}
}
""".replace("{}", uuid.uuid4().hex[:8])


@pytest.mark.asyncio
async def test_import_bibtex_creates_citations_and_dedupes_on_reimport() -> None:
    r1 = await _with_session(lambda db: import_citations(ImportBody(format="bibtex", text=BIBTEX_TEXT), db))
    assert r1.imported == 1
    assert r1.skipped_duplicates == 0
    # Reimport — DOI dedupe should skip.
    r2 = await _with_session(lambda db: import_citations(ImportBody(format="bibtex", text=BIBTEX_TEXT), db))
    assert r2.imported == 0
    assert r2.skipped_duplicates == 1


@pytest.mark.asyncio
async def test_import_ris_creates_citations() -> None:
    doi = f"10.9991/ris.{uuid.uuid4().hex[:8]}"
    ris = f"""TY  - JOUR
AU  - Rev, R.
TI  - RIS Import Test
JO  - J. Misc
PY  - 2023
DO  - {doi}
ER  -
"""
    r = await _with_session(lambda db: import_citations(ImportBody(format="ris", text=ris), db))
    assert r.imported == 1
    assert r.citations[0].doi == doi


@pytest.mark.asyncio
async def test_import_csl_json_creates_citations() -> None:
    import json
    doi = f"10.9991/csl.{uuid.uuid4().hex[:8]}"
    payload = json.dumps([{
        "id": "csl-test",
        "type": "article-journal",
        "title": "CSL Import Test",
        "author": [{"given": "A", "family": "Uthor"}],
        "issued": {"date-parts": [[2022]]},
        "DOI": doi,
    }])
    r = await _with_session(lambda db: import_citations(ImportBody(format="csl", text=payload), db))
    assert r.imported == 1
    assert r.citations[0].doi == doi


@pytest.mark.asyncio
async def test_import_unknown_format_400s() -> None:
    with pytest.raises(HTTPException) as exc:
        await _with_session(lambda db: import_citations(ImportBody(format="zotero", text=""), db))
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_export_bibtex_round_trip_produces_valid_text() -> None:
    doi = f"10.9991/roundtrip.{uuid.uuid4().hex[:8]}"
    created = await _with_session(lambda db: create_citation(CitationCreate(title="Export Me", authors=["R. Trip"], year=2024, doi=doi, journal="J Export"), db))
    resp = await _with_session(lambda db: export_citations(ExportBody(format="bibtex", ids=[created.id]), db))
    # Plaintext response — assert the body string shape.
    assert hasattr(resp, "body")
    body = resp.body.decode("utf-8")
    assert "@article" in body
    assert "Export Me" in body
    assert doi in body


@pytest.mark.asyncio
async def test_export_csl_returns_items_list() -> None:
    doi = f"10.9991/csl-export.{uuid.uuid4().hex[:8]}"
    created = await _with_session(lambda db: create_citation(CitationCreate(title="CSL Export", authors=["X Y"], year=2024, doi=doi), db))
    resp = await _with_session(lambda db: export_citations(ExportBody(format="csl", ids=[created.id]), db))
    assert resp["count"] == 1
    assert resp["items"][0]["title"] == "CSL Export"
    assert resp["items"][0]["DOI"] == doi
