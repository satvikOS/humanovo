"""
humanovo Services Module

Contains business logic services for the platform.
"""

from app.models.audit import AuditRecord
from app.services.audit_service import (
    AuditContext,
    AuditEventType,
    AuditService,
    AuditSeverity,
    get_audit_service,
)

from app.services.brave_search_service import (
    BraveSearchService,
    HealthcareDataIngestionService,
    get_brave_service,
    search_healthcare_data,
    start_24_7_ingestion,
)

from app.services.disease_discovery_service import (
    DiseaseDiscoveryService,
    DiscoveryResult,
    DiscoveryType,
    EvidenceStrength,
    LLMProvider,
    discover_cures,
    get_discovery_service,
    init_discovery_service,
)

__all__ = [
    # Audit
    "AuditContext",
    "AuditEventType",
    "AuditRecord",
    "AuditService",
    "AuditSeverity",
    "get_audit_service",
    # Brave Search
    "BraveSearchService",
    "HealthcareDataIngestionService",
    "get_brave_service",
    "search_healthcare_data",
    "start_24_7_ingestion",
    # Disease Discovery
    "DiseaseDiscoveryService",
    "DiscoveryResult",
    "DiscoveryType",
    "EvidenceStrength",
    "LLMProvider",
    "discover_cures",
    "get_discovery_service",
    "init_discovery_service",
]
