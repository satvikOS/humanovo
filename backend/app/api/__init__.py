"""
Humanovo API Router

Central router aggregating all API endpoints.
"""

from fastapi import APIRouter

from app.api.v1 import router as v1_router

router = APIRouter()

# Include versioned API routers
router.include_router(v1_router, prefix="/v1")
