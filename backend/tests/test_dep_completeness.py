"""
Dependency completeness guard.

Scans every module under app/ and asserts each can be imported without
a ModuleNotFoundError on a fresh Python interpreter. This catches the
class of bug where a developer adds `from some_lib import X` in
application code but forgets to add `some-lib` to requirements.txt —
local dev venvs have it leftover from a prior install so tests pass,
but a fresh-install CI runner fails.

This is exactly the failure mode that silently shipped app.core.auth
depending on python-jose + passlib + email-validator without them in
requirements.txt — every test that transitively imported the v1 router
blew up on CI with ModuleNotFoundError: No module named 'jose'.

Runs the import sweep in a subprocess so prior tests' monkeypatches /
sys.modules pollution / asyncio loop state can't poison the check.
Hermetic: no DB, no TestClient, no services.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path


_PROBE = r"""
import importlib, json, sys
from pathlib import Path

backend = Path(r'{backend}')
sys.path.insert(0, str(backend))

missing = []
for f in sorted((backend / 'app').rglob('*.py')):
    if '__pycache__' in f.parts or f.name == '__init__.py':
        continue
    rel = f.relative_to(backend).with_suffix('')
    mod = '.'.join(rel.parts)
    try:
        importlib.import_module(mod)
    except ModuleNotFoundError as exc:
        missing.append((mod, str(exc)))
    except Exception:
        pass

print(json.dumps(missing))
"""


def test_every_app_module_has_its_deps_declared() -> None:
    backend_dir = Path(__file__).resolve().parents[1]
    probe = _PROBE.format(backend=str(backend_dir))
    result = subprocess.run(
        [sys.executable, "-c", probe],
        cwd=backend_dir,
        capture_output=True,
        text=True,
        timeout=240,
    )
    assert result.returncode == 0, (
        f"Probe subprocess failed (rc={result.returncode}): "
        f"stdout={result.stdout!r} stderr={result.stderr!r}"
    )
    import json

    missing = json.loads(result.stdout.strip().splitlines()[-1])
    assert not missing, (
        "Modules fail to import on a fresh Python (missing entries in "
        f"requirements.txt?): {missing}"
    )
