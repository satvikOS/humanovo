"""
humanovo Services Module

Contains business logic services for the platform.

The convenience re-exports below are loaded lazily (PEP 562
`__getattr__`) so that importing a leaf submodule like
`app.services.agents` does NOT trigger SQLAlchemy + boto3 + the full
service stack. Callers that do `from app.services import AuditService`
get the same import-time semantics they always had — the lookup just
runs through `__getattr__` on first access.
"""
from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:  # pragma: no cover — types only
    from app.services.audit_service import (
        AuditContext,
        AuditEventType,
        AuditRecord,
        AuditService,
        AuditSeverity,
        get_audit_service,
    )
    from app.services.disease_discovery_service import (
        DiscoveryResult,
        DiscoveryType,
        DiseaseDiscoveryService,
        EvidenceStrength,
        LLMProvider,
        discover_cures,
        get_discovery_service,
        init_discovery_service,
    )


# name → (submodule path, attribute name)
_LAZY_EXPORTS: dict[str, tuple[str, str]] = {
    # Audit
    "AuditContext": ("app.services.audit_service", "AuditContext"),
    "AuditEventType": ("app.services.audit_service", "AuditEventType"),
    "AuditRecord": ("app.services.audit_service", "AuditRecord"),
    "AuditService": ("app.services.audit_service", "AuditService"),
    "AuditSeverity": ("app.services.audit_service", "AuditSeverity"),
    "get_audit_service": ("app.services.audit_service", "get_audit_service"),
    # Disease Discovery
    "DiseaseDiscoveryService": ("app.services.disease_discovery_service", "DiseaseDiscoveryService"),
    "DiscoveryResult": ("app.services.disease_discovery_service", "DiscoveryResult"),
    "DiscoveryType": ("app.services.disease_discovery_service", "DiscoveryType"),
    "EvidenceStrength": ("app.services.disease_discovery_service", "EvidenceStrength"),
    "LLMProvider": ("app.services.disease_discovery_service", "LLMProvider"),
    "discover_cures": ("app.services.disease_discovery_service", "discover_cures"),
    "get_discovery_service": ("app.services.disease_discovery_service", "get_discovery_service"),
    "init_discovery_service": ("app.services.disease_discovery_service", "init_discovery_service"),
}


def __getattr__(name: str) -> Any:
    if name in _LAZY_EXPORTS:
        import importlib
        mod_path, attr = _LAZY_EXPORTS[name]
        module = importlib.import_module(mod_path)
        value = getattr(module, attr)
        globals()[name] = value  # cache for subsequent access
        return value
    raise AttributeError(f"module 'app.services' has no attribute {name!r}")


__all__ = list(_LAZY_EXPORTS.keys())
