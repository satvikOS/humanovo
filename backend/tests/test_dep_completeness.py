"""
Dependency completeness guard.

Scans every module under app/ and asserts each can be imported without
a ModuleNotFoundError. This catches the class of bug where a developer
adds `from some_lib import X` in application code but forgets to add
`some-lib` to requirements.txt — the local venv has it leftover from a
prior install so tests pass, but a fresh-install CI runner fails.

This is exactly the failure mode that silently shipped
app.core.auth depending on python-jose + passlib + email-validator
without them in requirements.txt — every test that transitively
imported the v1 router (including test_router_contracts.py) blew up
on CI with ModuleNotFoundError: No module named 'jose'.

Kept hermetic: no DB, no TestClient, no services. Pure import discipline.
"""
from __future__ import annotations

import importlib
from pathlib import Path


def _app_modules() -> list[str]:
    backend_dir = Path(__file__).resolve().parents[1]
    app_dir = backend_dir / "app"
    modules: list[str] = []
    for f in sorted(app_dir.rglob("*.py")):
        if "__pycache__" in f.parts:
            continue
        if f.name == "__init__.py":
            # Parent package gets imported via its children anyway.
            continue
        rel = f.relative_to(backend_dir).with_suffix("")
        modules.append(".".join(rel.parts))
    return modules


def test_every_app_module_has_its_deps_declared() -> None:
    """Every app/ module must import without a ModuleNotFoundError.

    Non-dep failures (e.g. env-var lookups at import time) are NOT
    caught here on purpose — they'd be false positives for a dep check.
    """
    missing: list[tuple[str, str]] = []
    for mod in _app_modules():
        try:
            importlib.import_module(mod)
        except ModuleNotFoundError as exc:
            missing.append((mod, str(exc)))
        except Exception:
            # Non-dep import errors (env-var missing, DB config, etc.)
            # are outside this test's scope.
            pass

    assert not missing, (
        "Modules fail to import on a fresh install (missing entries in "
        f"requirements.txt?): {missing}"
    )
