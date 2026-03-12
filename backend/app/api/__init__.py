"""
Humanovo API Router

Central router aggregating all API endpoints.
"""

from fastapi import APIRouter

from app.api.v1 import router as v1_router
from app.api.v1.endpoints import genomics, statistics

router = APIRouter()

# Include versioned API routers
router.include_router(v1_router, prefix="/v1")

# Also mount statistics and genomics directly under /api so the frontend
# can reach them at /api/statistics/* and /api/genomics/* (without /v1).
router.include_router(statistics.router, prefix="/statistics", tags=["statistics"])
router.include_router(genomics.router, prefix="/genomics", tags=["genomics"])
