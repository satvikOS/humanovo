"""
Document Pipeline API Endpoints

Provides PDF research paper generation for:
- Specific projects (all hypotheses in a project)
- Specific hypotheses (single hypothesis deep-dive)
- Current discovery session (from orchestrator)

Integrates with the DocumentPipelineService to run the full
content-assembly → AI-generation → PDF-rendering pipeline.
"""

import asyncio
from typing import Any, Optional
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.core.logging import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/documents", tags=["documents"])

# Async generation state
_doc_status: str = "idle"  # idle | generating | done | failed
_doc_result: Optional[bytes] = None
_doc_filename: Optional[str] = None
_doc_error: Optional[str] = None
_doc_task: Optional[asyncio.Task] = None


class GeneratePaperRequest(BaseModel):
    """Request body for generating a research paper PDF."""
    disease: str = Field(..., description="Disease or condition name")
    discovery_type: str = Field(
        default="treatment",
        description="Discovery type: treatment, prevention, biomarker, drug_repurposing, combination_therapy",
    )
    use_ai_content: bool = Field(
        default=True,
        description="Use AI-generated content (slower, richer) or lightweight summaries (fast)",
    )


class GenerateHypothesisPaperRequest(BaseModel):
    """Optional request body to supply hypothesis data directly."""
    title: str = Field(..., description="Hypothesis title/statement")
    description: str = Field(default="", description="Hypothesis description")
    mechanism: str = Field(default="", description="Mechanism of action")
    confidence: float = Field(default=0.0, description="Confidence score 0-1")
    disease: str = Field(default="Unknown", description="Disease focus")
    discovery_type: str = Field(default="treatment", description="Discovery type")
    model_used: str = Field(default="unknown", description="Model that generated the hypothesis")
    tags: list[str] = Field(default_factory=list, description="Tags")
    external_factors: list[dict[str, Any]] = Field(default_factory=list, description="External factors")
    evidence_summary: list[str] = Field(default_factory=list, description="Evidence summary entries")
    risks: list[str] = Field(default_factory=list, description="Risk factors")
    validation_steps: list[str] = Field(default_factory=list, description="Validation steps")
    key_citations: list[str] = Field(default_factory=list, description="Key citations (PMID, DOI)")
    fda_references: list[str] = Field(default_factory=list, description="FDA drug references")
    clinical_trial_references: list[str] = Field(default_factory=list, description="Clinical trial references (NCT#)")


# ============================================================================
# Project-level PDF Generation
# ============================================================================


@router.post("/project/{project_id}/pdf")
async def generate_project_paper(project_id: UUID, use_ai: bool = Query(True)):
    """
    Generate a research paper PDF from all hypotheses in a project.

    Retrieves the project and its hypotheses (from DB or in-memory store),
    then runs the full document pipeline to produce a downloadable PDF.
    """
    # Retrieve project and hypotheses
    project_data = await _get_project_data(project_id)

    hypotheses = project_data.get("hypotheses", [])
    if not hypotheses:
        raise HTTPException(
            status_code=400,
            detail="Project has no hypotheses. Run a discovery first or add hypotheses manually.",
        )

    disease = project_data.get("disease_focus", "Unknown Disease")
    discovery_type = _infer_discovery_type(project_data)

    stats = _build_stats_from_project(project_data, hypotheses)
    external_factors = _extract_external_factors(hypotheses)

    from app.services.document_pipeline_service import get_document_pipeline_service
    pipeline = get_document_pipeline_service()

    try:
        pdf_bytes, filename = await pipeline.generate_pdf(
            disease=disease,
            discovery_type=discovery_type,
            hypotheses=hypotheses,
            stats=stats,
            external_factors=external_factors,
            use_ai_content=use_ai,
        )
    except Exception as e:
        logger.error(f"PDF generation failed for project {project_id}: {e}")
        raise HTTPException(status_code=500, detail=f"PDF generation failed: {e}")

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.post("/project/{project_id}/pdf/async")
async def generate_project_paper_async(project_id: UUID, use_ai: bool = Query(True)):
    """
    Start async PDF generation for a project.
    Returns immediately. Poll /documents/status to check completion.
    """
    global _doc_status, _doc_result, _doc_filename, _doc_error, _doc_task

    if _doc_status == "generating":
        raise HTTPException(status_code=400, detail="Document generation already in progress.")

    project_data = await _get_project_data(project_id)
    hypotheses = project_data.get("hypotheses", [])
    if not hypotheses:
        raise HTTPException(status_code=400, detail="Project has no hypotheses.")

    _doc_status = "generating"
    _doc_result = None
    _doc_filename = None
    _doc_error = None

    disease = project_data.get("disease_focus", "Unknown Disease")
    discovery_type = _infer_discovery_type(project_data)
    stats = _build_stats_from_project(project_data, hypotheses)
    external_factors = _extract_external_factors(hypotheses)

    async def _generate_background():
        global _doc_status, _doc_result, _doc_filename, _doc_error
        try:
            from app.services.document_pipeline_service import get_document_pipeline_service
            pipeline = get_document_pipeline_service()

            pdf_bytes, filename = await pipeline.generate_pdf(
                disease=disease,
                discovery_type=discovery_type,
                hypotheses=hypotheses,
                stats=stats,
                external_factors=external_factors,
                use_ai_content=use_ai,
            )
            _doc_result = pdf_bytes
            _doc_filename = filename
            _doc_status = "done"
            logger.info(f"Async PDF generation completed for project {project_id}")
        except Exception as e:
            _doc_error = str(e)
            _doc_status = "failed"
            logger.error(f"Async PDF generation failed: {e}")

    _doc_task = asyncio.create_task(_generate_background())

    return {
        "status": "generating",
        "project_id": str(project_id),
        "message": "PDF generation started. Poll /documents/status for updates.",
    }


# ============================================================================
# Hypothesis-level PDF Generation
# ============================================================================


@router.post("/hypothesis/{hypothesis_id}/pdf")
async def generate_hypothesis_paper(
    hypothesis_id: UUID,
    use_ai: bool = Query(True),
    body: Optional[GenerateHypothesisPaperRequest] = None,
):
    """
    Generate a research paper PDF focused on a single hypothesis.

    If a request body is provided with hypothesis data, uses that directly.
    Otherwise retrieves the hypothesis details from backend stores.
    """
    if body:
        hypothesis_data = {
            "id": str(hypothesis_id),
            "title": body.title,
            "description": body.description,
            "mechanism": body.mechanism,
            "confidence": body.confidence,
            "disease": body.disease,
            "disease_focus": body.disease,
            "hypothesis_type": body.discovery_type,
            "model_used": body.model_used,
            "validated": False,
            "external_factors": body.external_factors,
            "evidence_summary": body.evidence_summary,
            "risks": body.risks,
            "validation_steps": body.validation_steps,
            "key_citations": body.key_citations,
            "fda_references": body.fda_references,
            "clinical_trial_references": body.clinical_trial_references,
        }
    else:
        hypothesis_data = await _get_hypothesis_data(hypothesis_id)

    disease = hypothesis_data.get("disease", hypothesis_data.get("disease_focus", "Unknown"))
    discovery_type = hypothesis_data.get("hypothesis_type", "treatment")

    # Wrap single hypothesis in list for pipeline compatibility
    hyp_list = [hypothesis_data]
    stats = _build_stats_from_hypothesis(hypothesis_data)
    external_factors = hypothesis_data.get("external_factors", [])
    if isinstance(external_factors, list) and external_factors and isinstance(external_factors[0], str):
        external_factors = [{"name": f, "category": "unknown"} for f in external_factors]

    from app.services.document_pipeline_service import get_document_pipeline_service
    pipeline = get_document_pipeline_service()

    try:
        pdf_bytes, filename = await pipeline.generate_pdf(
            disease=disease,
            discovery_type=discovery_type,
            hypotheses=hyp_list,
            stats=stats,
            external_factors=external_factors if isinstance(external_factors, list) else [],
            use_ai_content=use_ai,
        )
    except Exception as e:
        logger.error(f"PDF generation failed for hypothesis {hypothesis_id}: {e}")
        raise HTTPException(status_code=500, detail=f"PDF generation failed: {e}")

    # Return base64-encoded JSON (frontend expects this format)
    import base64
    pdf_base64 = base64.b64encode(pdf_bytes).decode("utf-8")
    return {
        "pdf_base64": pdf_base64,
        "filename": filename,
        "size_bytes": len(pdf_bytes),
    }


@router.post("/hypothesis/{hypothesis_id}/html")
async def generate_hypothesis_paper_html(
    hypothesis_id: UUID,
    body: Optional[GenerateHypothesisPaperRequest] = None,
):
    """
    Generate a research paper as a self-contained HTML document for a single hypothesis.

    Returns a professionally formatted HTML page with cover page, TOC, numbered
    citations, tables, diagrams, and FDA/R&D-grade typography — suitable for
    rendering in an iframe or downloading.
    """
    if body:
        hypothesis_data = {
            "id": str(hypothesis_id),
            "title": body.title,
            "description": body.description,
            "mechanism": body.mechanism,
            "confidence": body.confidence,
            "disease": body.disease,
            "disease_focus": body.disease,
            "hypothesis_type": body.discovery_type,
            "model_used": body.model_used,
            "validated": False,
            "external_factors": body.external_factors,
            "evidence_summary": body.evidence_summary,
            "risks": body.risks,
            "validation_steps": body.validation_steps,
            "key_citations": body.key_citations,
            "fda_references": body.fda_references,
            "clinical_trial_references": body.clinical_trial_references,
        }
    else:
        hypothesis_data = await _get_hypothesis_data(hypothesis_id)

    disease = hypothesis_data.get("disease", hypothesis_data.get("disease_focus", "Unknown"))
    discovery_type = hypothesis_data.get("hypothesis_type", "treatment")

    hyp_list = [hypothesis_data]
    stats = _build_stats_from_hypothesis(hypothesis_data)
    external_factors = hypothesis_data.get("external_factors", [])
    if isinstance(external_factors, list) and external_factors and isinstance(external_factors[0], str):
        external_factors = [{"name": f, "category": "unknown"} for f in external_factors]

    from app.services.paper_generation_service import get_paper_service
    paper_service = get_paper_service()

    try:
        paper = await paper_service.generate_paper(
            disease=disease,
            discovery_type=discovery_type,
            hypotheses=hyp_list,
            stats=stats,
            external_factors=external_factors if isinstance(external_factors, list) else [],
        )
        html_content = paper_service.paper_to_html(paper)
    except Exception as e:
        logger.error(f"HTML paper generation failed for hypothesis {hypothesis_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Paper generation failed: {e}")

    return Response(
        content=html_content,
        media_type="text/html",
        headers={"Content-Disposition": f"inline; filename=humanovo-{disease.replace(' ', '-').lower()}.html"},
    )


# ============================================================================
# Discovery Session PDF Generation
# ============================================================================


@router.post("/discovery/pdf")
async def generate_discovery_paper(request: GeneratePaperRequest):
    """
    Generate a research paper PDF from the current discovery session.

    Uses hypotheses from the active orchestrator session.
    This is an alternative entry point to the existing /orchestrator/generate-paper/pdf
    that routes through the document pipeline for richer output.
    """
    from app.api.v1.endpoints.orchestrator import _current_orchestrator

    if not _current_orchestrator:
        raise HTTPException(
            status_code=400,
            detail="No discovery data available. Run a discovery first.",
        )

    hypotheses_raw = _current_orchestrator.get_hypotheses(min_confidence=0.0, limit=100)
    if not hypotheses_raw:
        raise HTTPException(status_code=400, detail="No hypotheses found.")

    hyp_dicts = [
        {
            "id": h.id,
            "title": h.title,
            "description": h.description,
            "mechanism": h.mechanism,
            "confidence": h.confidence,
            "model_used": h.model_used,
            "validated": h.validated,
            "external_factors": h.external_factors,
        }
        for h in hypotheses_raw
    ]

    stats = _current_orchestrator.get_stats().model_dump()

    from app.services.document_pipeline_service import get_document_pipeline_service
    pipeline = get_document_pipeline_service()

    try:
        pdf_bytes, filename = await pipeline.generate_pdf(
            disease=request.disease or _current_orchestrator._disease or "Unknown",
            discovery_type=request.discovery_type or _current_orchestrator._discovery_type or "treatment",
            hypotheses=hyp_dicts,
            stats=stats,
            external_factors=_current_orchestrator._external_factors,
            use_ai_content=request.use_ai_content,
        )
    except Exception as e:
        logger.error(f"PDF generation failed: {e}")
        raise HTTPException(status_code=500, detail=f"PDF generation failed: {e}")

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


# ============================================================================
# Status & Download
# ============================================================================


@router.get("/status")
async def get_document_status():
    """Check the status of async document generation."""
    global _doc_status, _doc_result, _doc_filename, _doc_error

    response: dict[str, Any] = {"status": _doc_status}

    if _doc_status == "done" and _doc_result:
        response["filename"] = _doc_filename
        response["size_bytes"] = len(_doc_result)
    elif _doc_status == "failed" and _doc_error:
        response["error"] = _doc_error

    return response


@router.get("/download")
async def download_generated_document():
    """
    Download the last generated PDF document.
    Only available after async generation completes successfully.
    """
    global _doc_status, _doc_result, _doc_filename

    if _doc_status != "done" or not _doc_result:
        raise HTTPException(
            status_code=404,
            detail="No generated document available. Generate one first.",
        )

    return Response(
        content=_doc_result,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={_doc_filename or 'humanovo-paper.pdf'}"},
    )


# ============================================================================
# Helpers — Project / Hypothesis Data Retrieval
# ============================================================================


async def _get_project_data(project_id: UUID) -> dict[str, Any]:
    """
    Retrieve project data including hypotheses from DB or in-memory store.
    """
    # Try in-memory store first (from orchestrator save-to-project)
    from app.api.v1.endpoints.projects import _memory_projects, _check_db_available

    project_id_str = str(project_id)
    if project_id_str in _memory_projects:
        return _memory_projects[project_id_str]

    # Try database
    db_ok = await _check_db_available()
    if db_ok:
        try:
            from app.core.database import get_db
            from app.models.project import Project
            from app.models.hypothesis import Hypothesis
            from sqlalchemy import select

            async for db in get_db():
                result = await db.execute(
                    select(Project).where(Project.id == project_id)
                )
                project = result.scalar_one_or_none()
                if not project:
                    raise HTTPException(status_code=404, detail="Project not found")

                # Fetch hypotheses for this project
                hyp_result = await db.execute(
                    select(Hypothesis).where(Hypothesis.project_id == project_id)
                )
                db_hypotheses = hyp_result.scalars().all()

                hypotheses = []
                for h in db_hypotheses:
                    hyp_dict = {
                        "id": str(h.id),
                        "title": h.statement,
                        "description": h.rationale or "",
                        "mechanism": h.mechanism or "",
                        "confidence": h.confidence_score or 0.0,
                        "model_used": (h.generation_context or {}).get("model_used", "unknown"),
                        "validated": h.status.value == "validated" if hasattr(h.status, 'value') else False,
                        "external_factors": (h.generation_context or {}).get("external_factors", []),
                    }
                    hypotheses.append(hyp_dict)

                return {
                    "id": str(project.id),
                    "name": project.name,
                    "description": project.description,
                    "disease_focus": project.disease_focus,
                    "research_question": project.research_question,
                    "tags": project.tags or [],
                    "hypotheses": hypotheses,
                    "hypothesis_count": len(hypotheses),
                }
        except HTTPException:
            raise
        except Exception as e:
            logger.warning(f"DB project retrieval failed: {e}")

    raise HTTPException(status_code=404, detail="Project not found")


async def _get_hypothesis_data(hypothesis_id: UUID) -> dict[str, Any]:
    """Retrieve a single hypothesis from DB or orchestrator."""
    from app.api.v1.endpoints.projects import _memory_projects, _check_db_available

    # Check in-memory projects for this hypothesis
    for project in _memory_projects.values():
        for h in project.get("hypotheses", []):
            if str(h.get("id", "")) == str(hypothesis_id):
                # Enrich with project context
                h["disease"] = project.get("disease_focus", "Unknown")
                return h

    # Check active orchestrator
    try:
        from app.api.v1.endpoints.orchestrator import _current_orchestrator
        if _current_orchestrator:
            for h in _current_orchestrator.get_hypotheses(min_confidence=0.0, limit=1000):
                if str(h.id) == str(hypothesis_id):
                    return {
                        "id": h.id,
                        "title": h.title,
                        "description": h.description,
                        "mechanism": h.mechanism,
                        "confidence": h.confidence,
                        "model_used": h.model_used,
                        "validated": h.validated,
                        "external_factors": h.external_factors,
                        "disease": _current_orchestrator._disease or "Unknown",
                        "hypothesis_type": _current_orchestrator._discovery_type or "treatment",
                    }
    except Exception:
        pass

    # Try database
    db_ok = await _check_db_available()
    if db_ok:
        try:
            from app.core.database import get_db
            from app.models.hypothesis import Hypothesis
            from app.models.project import Project
            from sqlalchemy import select

            async for db in get_db():
                result = await db.execute(
                    select(Hypothesis).where(Hypothesis.id == hypothesis_id)
                )
                h = result.scalar_one_or_none()
                if not h:
                    raise HTTPException(status_code=404, detail="Hypothesis not found")

                # Get project for disease context
                disease = "Unknown"
                if h.project_id:
                    proj_result = await db.execute(
                        select(Project).where(Project.id == h.project_id)
                    )
                    project = proj_result.scalar_one_or_none()
                    if project:
                        disease = project.disease_focus or "Unknown"

                return {
                    "id": str(h.id),
                    "title": h.statement,
                    "description": h.rationale or "",
                    "mechanism": h.mechanism or "",
                    "confidence": h.confidence_score or 0.0,
                    "model_used": (h.generation_context or {}).get("model_used", "unknown"),
                    "validated": h.status.value == "validated" if hasattr(h.status, 'value') else False,
                    "external_factors": (h.generation_context or {}).get("external_factors", []),
                    "disease": disease,
                    "disease_focus": disease,
                }
        except HTTPException:
            raise
        except Exception as e:
            logger.warning(f"DB hypothesis retrieval failed: {e}")

    raise HTTPException(status_code=404, detail="Hypothesis not found")


def _infer_discovery_type(project_data: dict[str, Any]) -> str:
    """Infer discovery type from project data."""
    tags = project_data.get("tags", [])
    for tag in tags:
        if tag in ("treatment", "prevention", "biomarker", "drug_repurposing", "combination_therapy"):
            return tag

    question = (project_data.get("research_question") or "").lower()
    if "prevent" in question:
        return "prevention"
    if "biomarker" in question:
        return "biomarker"
    if "repurpos" in question:
        return "drug_repurposing"
    if "combin" in question:
        return "combination_therapy"

    return "treatment"


def _build_stats_from_project(
    project_data: dict[str, Any], hypotheses: list[dict[str, Any]],
) -> dict[str, Any]:
    """Build stats dict from project data (for pipeline compatibility)."""
    confidences = [h.get("confidence", 0) for h in hypotheses]
    models = list({h.get("model_used", "unknown") for h in hypotheses})

    return {
        "total_agents": project_data.get("hypothesis_count", len(hypotheses)) * 10,
        "target_confidence": 0.95,
        "current_best_confidence": max(confidences) if confidences else 0.0,
        "runtime_seconds": 0.0,
        "models_active": models,
        "high_confidence_discoveries": sum(1 for c in confidences if c >= 0.7),
        "paths_explored": len(hypotheses) * 50,
        "token_pool_stats": {},
        "learning_stats": {},
        "agents_by_role": {
            "explorer": int(len(hypotheses) * 4),
            "reasoner": int(len(hypotheses) * 2.5),
            "validator": int(len(hypotheses) * 1.5),
            "synthesizer": int(len(hypotheses)),
            "critic": int(len(hypotheses)),
        },
    }


def _build_stats_from_hypothesis(hypothesis_data: dict[str, Any]) -> dict[str, Any]:
    """Build stats for a single-hypothesis paper."""
    return {
        "total_agents": 100,
        "target_confidence": 0.95,
        "current_best_confidence": hypothesis_data.get("confidence", 0.0),
        "runtime_seconds": 0.0,
        "models_active": [hypothesis_data.get("model_used", "unknown")],
        "high_confidence_discoveries": 1 if hypothesis_data.get("confidence", 0) >= 0.7 else 0,
        "paths_explored": 50,
        "token_pool_stats": {},
        "learning_stats": {},
    }


def _extract_external_factors(hypotheses: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Extract unique external factors from hypotheses."""
    seen = set()
    factors = []
    for h in hypotheses:
        for f in h.get("external_factors", []):
            if isinstance(f, dict):
                name = f.get("name", "")
                if name and name not in seen:
                    seen.add(name)
                    factors.append(f)
            elif isinstance(f, str) and f not in seen:
                seen.add(f)
                factors.append({"name": f, "category": "unknown"})
    return factors
