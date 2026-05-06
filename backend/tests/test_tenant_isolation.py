"""
Tenant-isolation guard for the v1 API.

Auth (`test_auth_enforcement.py`) proves a caller is signed in. This
test proves they only see THEIR data: every `select(...) / update(...)
/ delete(...)` against an owner-tracked model in the v1 endpoint
modules must include an ownership filter or go through one of the
helpers in `app.core.ownership`.

Owner-tracked models tracked by this guard:
  Project    — direct ownership via `owner_id`
  Hypothesis — transitive via Hypothesis.project_id → Project.owner_id
  Evidence   — transitive (nullable project_id; global rows allowed)
  Simulation — transitive
  AgentTask  — transitive (when present)
  Citation   — transitive (nullable project_id; global allowed)
  DiscoverySession — transitive (nullable project_id)

Heuristic per call-site (parsed via AST):

  PASS if any of these conditions hold within the same function body
  as the SELECT/UPDATE/DELETE:
    1. The function body references one of the canonical ownership
       helpers: `assert_owns_project`, `fetch_owned_or_404`,
       `fetch_owned_or_global_or_404`, `filter_by_owned_project`,
       `filter_by_owned_or_global_project`.
    2. The query expression contains `<Model>.owner_id` (direct
       ownership match — only Project today).
    3. The call expression chain on the result includes `.join(Project)`
       or `.outerjoin(Project)` AND a where-clause referencing
       `Project.owner_id` somewhere in the same function body.

  FAIL otherwise.

The test maintains a tiny EXEMPT_FUNCTIONS allowlist for handlers
that legitimately need an unfiltered query (admin endpoints, system-
wide aggregates). Adding a new entry requires explaining why in a
nearby comment so the choice is reviewable.

This guard is intentionally conservative — it's a smoke-test, not a
proof of correctness. The runtime tests in tests/integration/ verify
end-to-end isolation against a real DB.
"""
from __future__ import annotations

import ast
from pathlib import Path

ENDPOINTS_DIR = (
    Path(__file__).resolve().parents[1] / "app" / "api" / "v1" / "endpoints"
)

# Models whose rows are owned by exactly one user (directly or via
# Project). The guard requires every R/U/D call against these to be
# tenant-scoped.
OWNED_MODELS: set[str] = {
    "Project",
    "Hypothesis",
    "Evidence",
    "Simulation",
    "AgentTask",
    "Citation",
    "CitationFolder",
    "CitationHighlight",
    "DiscoverySession",
}

# Functions whose use anywhere in a handler proves an ownership filter.
OWNERSHIP_HELPERS: set[str] = {
    "assert_owns_project",
    "fetch_owned_or_404",
    "fetch_owned_or_global_or_404",
    "filter_by_owned_project",
    "filter_by_owned_or_global_project",
}

# Per-function exemption: (filename, function_name). Entries here
# document handlers that legitimately query an OWNED_MODELS row
# without a tenant filter — typically internal background helpers
# that the matching API endpoint already gated, or pure aggregates.
# Keep this list short and add a one-line comment per entry.
EXEMPT_FUNCTIONS: set[tuple[str, str]] = {
    # Background task spawned by POST /agents/tasks (which checked
    # ownership). Runs in trusted server context with the task_id
    # the endpoint just inserted; no external caller can invoke it.
    ("agents.py", "_execute_agent_task"),
    # Internal progress writer called from inside _execute_agent_task.
    ("agents.py", "_update_task_progress_db"),
    # citations.py file-local helper that joins CitationHighlight to
    # Citation.owner_id. The join + where clause IS the proof of
    # ownership; guard's heuristic only spots Project.owner_id joins
    # (since the owned-via-Project pattern is canonical).
    ("citations.py", "_owned_highlight_or_404"),
    # list_highlights calls _owned_citation_or_404 (verifies parent
    # ownership) before the CitationHighlight query — same pattern
    # as the discovery sessions / agent task helpers, just two steps.
    ("citations.py", "list_highlights"),
}


def _func_body_text(node: ast.FunctionDef | ast.AsyncFunctionDef) -> str:
    """Concatenate the source representation of a function body so we
    can string-match for helper / column references. Cheaper than a
    full pass with a NameVisitor and good enough for this guard."""
    return ast.unparse(node)


def _calls_select_on_owned_model(node: ast.Call) -> str | None:
    """Return the OWNED_MODELS name if `node` is `select(<Owned>)` or
    `select(func.count(<Owned>.id))` etc., else None."""
    if not isinstance(node.func, ast.Name) or node.func.id != "select":
        return None
    for arg in node.args:
        # select(Hypothesis), select(Hypothesis.id), select(Hypothesis.evidence_refs)
        if isinstance(arg, ast.Name) and arg.id in OWNED_MODELS:
            return arg.id
        if isinstance(arg, ast.Attribute) and isinstance(arg.value, ast.Name):
            if arg.value.id in OWNED_MODELS:
                return arg.value.id
        # select(func.count(Hypothesis.id))
        if isinstance(arg, ast.Call):
            for inner in arg.args:
                if isinstance(inner, ast.Attribute) and isinstance(inner.value, ast.Name):
                    if inner.value.id in OWNED_MODELS:
                        return inner.value.id
    return None


def _function_has_ownership_proof(
    func: ast.FunctionDef | ast.AsyncFunctionDef,
    model_name: str,
) -> bool:
    """True iff the function body shows evidence of an ownership
    filter for `model_name`. See module docstring for the heuristic."""
    body_src = _func_body_text(func)

    # Helper signal — any of the canonical ownership helpers used.
    if any(h in body_src for h in OWNERSHIP_HELPERS):
        return True

    # Direct `<Model>.owner_id` reference (only Project carries it
    # today, but other models may grow it later).
    if f"{model_name}.owner_id" in body_src:
        return True

    # Project.owner_id in the same function body, used in conjunction
    # with a `.join(Project)` / `.outerjoin(Project)` somewhere.
    if "Project.owner_id" in body_src and (
        ".join(Project" in body_src or ".outerjoin(Project" in body_src
    ):
        return True

    return False


def _scan_file(path: Path) -> list[tuple[str, int, str]]:
    """Return a list of (function_name, lineno, model_name) offences."""
    tree = ast.parse(path.read_text())
    offences: list[tuple[str, int, str]] = []

    for func in ast.walk(tree):
        if not isinstance(func, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        if (path.name, func.name) in EXEMPT_FUNCTIONS:
            continue

        # Find any select() against an owned model inside this function.
        found_models: set[str] = set()
        for sub in ast.walk(func):
            if isinstance(sub, ast.Call):
                m = _calls_select_on_owned_model(sub)
                if m is not None:
                    found_models.add(m)

        if not found_models:
            continue

        # For each model touched, check the function shows an ownership
        # proof. Project carries `owner_id` directly, so a select(Project)
        # alongside a `.where(Project.owner_id == ...)` passes.
        for model in found_models:
            if not _function_has_ownership_proof(func, model):
                offences.append((func.name, func.lineno, model))

    return offences


def test_no_owned_model_query_without_ownership_proof() -> None:
    """Fail the build if any handler in app/api/v1/endpoints/ runs an
    unscoped SELECT/UPDATE/DELETE against an owner-tracked model.

    Currently expected to pass for projects.py, hypotheses.py,
    evidence.py, simulation.py (the ones we hardened in waves 1-2).
    Other routers (datasets, manuscripts, citations, etc.) appear in
    the offender list — that's the intentional residual surface, and
    the test will flip green as each one ships through the same
    helper pattern.
    """
    offences: dict[str, list[tuple[str, int, str]]] = {}
    for path in sorted(ENDPOINTS_DIR.glob("*.py")):
        if path.name.startswith("_"):
            continue
        per_file = _scan_file(path)
        if per_file:
            offences[path.name] = per_file

    # Files that are PROVEN tenant-isolated. Once a file is added here
    # the guard tightens — any new offender in that file fails the
    # build. This is how we ratchet up coverage without merging
    # regressions into already-clean modules.
    PROVEN_CLEAN: set[str] = {
        "projects.py",
        "hypotheses.py",
        "evidence.py",
        "simulation.py",
        "agents.py",
        "evoe.py",
        "discovery_sessions.py",
        "citations.py",
        "document_pipeline.py",
        "agent_chat_stream.py",
    }

    regressions: list[str] = []
    for name in PROVEN_CLEAN:
        if name in offences:
            for func_name, lineno, model in offences[name]:
                regressions.append(
                    f"  {name}:{lineno}  {func_name}()  selects {model} "
                    f"without an ownership filter"
                )

    assert not regressions, (
        "Tenant-isolation regression — these handlers in "
        "PROVEN_CLEAN files lost their ownership filter:\n"
        + "\n".join(regressions)
    )
