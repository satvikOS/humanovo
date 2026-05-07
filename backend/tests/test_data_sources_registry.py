"""Smoke tests for the 62-source biomedical data registry.

These tests verify the registry is structurally healthy without firing
any real network requests. They protect against:

  - A new source class being added but forgetting to register in
    ALL_SOURCE_CLASSES.
  - A registered source whose class is missing the abstract `search()`
    method (would silently fail at first query).
  - A source class with a malformed `phase` attribute that breaks the
    PHASE_N_SOURCES filters.
  - The orchestrator default drifting away from PHASE_1+2+3+4.

Network-dependent integration tests live separately under
tests/e2e_live/test_live_smoke.py and are skipped in CI without
provider credentials.
"""
from __future__ import annotations

import inspect

import pytest

from app.services.data_sources import (
    ACTIVE_SOURCES,
    ALL_SOURCE_CLASSES,
    DataSourceBase,
    DataSourceOrchestrator,
    PHASE_1_SOURCES,
    PHASE_2_SOURCES,
    PHASE_3_SOURCES,
    PHASE_4_SOURCES,
    get_source_liveness_snapshot,
)


def test_all_source_classes_count() -> None:
    """Total registered sources matches the documented 62-source claim."""
    assert len(ALL_SOURCE_CLASSES) == 62


def test_phase_partition_covers_active_sources() -> None:
    """ACTIVE_SOURCES is exactly the union of all four phases."""
    union = set(PHASE_1_SOURCES + PHASE_2_SOURCES + PHASE_3_SOURCES + PHASE_4_SOURCES)
    assert union == set(ACTIVE_SOURCES)
    # No phase overlap.
    sums = (
        len(PHASE_1_SOURCES)
        + len(PHASE_2_SOURCES)
        + len(PHASE_3_SOURCES)
        + len(PHASE_4_SOURCES)
    )
    assert sums == len(union)


def test_every_source_class_inherits_base_and_implements_search() -> None:
    """Each source class extends DataSourceBase and overrides search()."""
    for name, cls in ALL_SOURCE_CLASSES.items():
        assert issubclass(cls, DataSourceBase), f"{name} is not a DataSourceBase"
        # search() is abstract on the base; subclasses must override.
        assert "search" in cls.__dict__ or any(
            "search" in parent.__dict__
            for parent in cls.__mro__[1:-1]
            if parent is not DataSourceBase
        ), f"{name} does not implement search()"
        # The override must be an async function.
        search_fn = cls.search
        assert inspect.iscoroutinefunction(search_fn), (
            f"{name}.search() is not async"
        )


def test_every_source_declares_required_metadata() -> None:
    """name, base_url, category, phase, description must be set."""
    for name, cls in ALL_SOURCE_CLASSES.items():
        assert isinstance(cls.name, str) and cls.name, f"{name}: empty name"
        assert isinstance(cls.base_url, str) and cls.base_url, (
            f"{name}: empty base_url"
        )
        assert isinstance(cls.category, str) and cls.category, (
            f"{name}: empty category"
        )
        assert isinstance(cls.phase, int) and 1 <= cls.phase <= 4, (
            f"{name}: phase={cls.phase!r} out of range"
        )
        assert isinstance(cls.description, str) and cls.description, (
            f"{name}: empty description"
        )
        # Registry key matches the class's own name attribute.
        assert cls.name == name, (
            f"registry key {name!r} != cls.name {cls.name!r}"
        )


def test_every_source_instantiates_without_arguments() -> None:
    """Each source must be constructible by the orchestrator's bare call."""
    for name, cls in ALL_SOURCE_CLASSES.items():
        try:
            inst = cls()
        except Exception as e:
            pytest.fail(f"{name}() raised {type(e).__name__}: {e}")
        assert isinstance(inst, DataSourceBase)
        # info() should round-trip the metadata.
        info = inst.info()
        assert info["name"] == name
        assert info["category"] == cls.category
        assert info["phase"] == cls.phase


def test_orchestrator_default_loads_all_active_sources() -> None:
    """Bare DataSourceOrchestrator() loads the full ACTIVE_SOURCES set."""
    orch = DataSourceOrchestrator()
    assert len(orch._sources) == len(ACTIVE_SOURCES)
    assert set(orch._sources.keys()) == set(ACTIVE_SOURCES)


def test_orchestrator_explicit_subset() -> None:
    """Explicit source_names overrides the ACTIVE_SOURCES default."""
    subset = ["pubmed", "clinicaltrials"]
    orch = DataSourceOrchestrator(source_names=subset)
    assert set(orch._sources.keys()) == set(subset)


def test_orchestrator_unknown_source_logs_and_skips() -> None:
    """Unknown source names are skipped, not fatal."""
    # Mix one known + one bogus name.
    orch = DataSourceOrchestrator(source_names=["pubmed", "this_source_does_not_exist"])
    assert "pubmed" in orch._sources
    assert "this_source_does_not_exist" not in orch._sources


def test_get_source_liveness_snapshot_initial_state() -> None:
    """Before any queries run, the liveness snapshot is empty (no entries
    means we don't claim health status we haven't measured)."""
    snap = get_source_liveness_snapshot()
    # Snapshot is a dict; it may have entries from prior tests in this
    # session, but if so each entry is a dict with the documented keys.
    assert isinstance(snap, dict)
    for name, entry in snap.items():
        assert isinstance(name, str)
        assert isinstance(entry, dict)
        for k in entry:
            assert k in {
                "last_success_age_seconds",
                "last_error_age_seconds",
                "last_error",
            }


def test_phase_counts_match_published_breakdown() -> None:
    """Per-phase counts match the SOURCES_ROADMAP contract."""
    assert len(PHASE_1_SOURCES) == 21
    assert len(PHASE_2_SOURCES) == 15
    assert len(PHASE_3_SOURCES) == 14
    assert len(PHASE_4_SOURCES) == 12


def test_source_categories_are_stable() -> None:
    """Every source's category is one of the documented values.

    Drift in category names breaks query_category() semantics on the
    frontend; the catalog is held to a fixed vocabulary.
    """
    allowed = {
        # Literature / clinical / regulatory
        "literature", "preprints", "patents", "clinical", "trials",
        "adverse_events", "regulation", "regulatory",
        # Sequence / structure / molecular biology
        "genomics", "genetics", "transcriptomics", "proteomics",
        "protein", "structure", "noncoding", "domains",
        # Functional / phenotypic
        "pathway", "metabolomics", "interaction", "interactions",
        "phenotypes", "ontologies", "ontology", "systems_biology",
        # Cells / tissue / single-cell
        "cell_biology", "single_cell", "cell_lines", "imaging",
        # Disease / cancer / variants
        "cancer", "cancer_genomics", "variants", "disease",
        # Chemicals / drugs / targets
        "chemistry", "drug", "drugs", "drug_target",
        "pharmacogenomics", "perturbation",
        # Catch-all / models
        "general", "models",
    }
    extras = set()
    for cls in ALL_SOURCE_CLASSES.values():
        if cls.category not in allowed:
            extras.add(cls.category)
    assert not extras, (
        f"Unrecognised source categories: {sorted(extras)}. "
        f"Either rename the source or update the allowed vocabulary."
    )
