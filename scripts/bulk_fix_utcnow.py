#!/usr/bin/env python3
"""
Bulk-replace `datetime.utcnow()` -> `datetime.now(timezone.utc)` across a
directory tree, adding `timezone` to existing `from datetime import ...`
lines when missing.

Run from repo root:
    python3 scripts/bulk_fix_utcnow.py backend/app

Reports a summary; safe to re-run (idempotent — every replacement is the
exact `datetime.utcnow()` call form, and import dedup is automatic).
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

UTCNOW_RE = re.compile(r"\bdatetime\.utcnow\(\s*\)")
FROM_DATETIME_RE = re.compile(
    r"^(\s*from\s+datetime\s+import\s+)([^\n#]+?)(\s*(?:#.*)?)$",
    re.MULTILINE,
)


def fix_file(path: Path) -> tuple[int, bool]:
    """Returns (replacements_made, import_added)."""
    src = path.read_text(encoding="utf-8")
    if "datetime.utcnow()" not in src:
        return (0, False)

    new_src, n = UTCNOW_RE.subn("datetime.now(timezone.utc)", src)
    if n == 0:
        return (0, False)

    import_added = False
    # Ensure `timezone` is in the from-datetime imports if any line
    # imports from `datetime` and doesn't already include it.
    matches = list(FROM_DATETIME_RE.finditer(new_src))
    if matches:
        # Walk in reverse so offsets stay valid.
        for m in reversed(matches):
            prefix, names, suffix = m.group(1), m.group(2), m.group(3)
            tokens = [t.strip() for t in names.split(",") if t.strip()]
            if "timezone" not in tokens:
                tokens.append("timezone")
                new_names = ", ".join(tokens)
                new_src = (
                    new_src[: m.start()]
                    + prefix
                    + new_names
                    + suffix
                    + new_src[m.end():]
                )
                import_added = True
                # Patch the first match only — Python imports are
                # module-level so one fix-up covers the whole file.
                break
    elif "import datetime" in new_src:
        # File uses the qualified `datetime.datetime` form; reach
        # `timezone` via `datetime.timezone`. Rewrite the substitution
        # to use the qualified form to stay consistent.
        new_src = new_src.replace(
            "datetime.now(timezone.utc)",
            "datetime.datetime.now(datetime.timezone.utc)",
        )

    path.write_text(new_src, encoding="utf-8")
    return (n, import_added)


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2

    root = Path(sys.argv[1])
    if not root.exists():
        print(f"path not found: {root}", file=sys.stderr)
        return 2

    total_files = total_replacements = total_imports_added = 0
    for py in sorted(root.rglob("*.py")):
        # Skip pycache + venv-shaped dirs.
        if any(p.startswith((".", "__pycache__")) for p in py.parts):
            continue
        n, added = fix_file(py)
        if n:
            total_files += 1
            total_replacements += n
            total_imports_added += int(added)
            print(f"  {py.relative_to(root)}: {n} replacement(s)"
                  f"{' + import' if added else ''}")

    print(
        f"\nFixed {total_replacements} datetime.utcnow() call(s) across "
        f"{total_files} file(s); added timezone import in "
        f"{total_imports_added} file(s)."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
