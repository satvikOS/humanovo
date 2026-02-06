"""
GenUp Services Module

Contains business logic services for the platform.
"""

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
