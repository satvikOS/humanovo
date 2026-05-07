#!/usr/bin/env python3
"""
Strict YAML validator for `.github/workflows/*.yml`.

PyYAML's default `safe_load` silently keeps the LAST value when a
mapping has duplicate keys at the same depth. GitHub Actions parser
is stricter and rejects the workflow at load time with errors like:

    Invalid workflow file: foo.yml#L1
    (Line: 393, Col: 9): 'if' is already defined

The "duplicate keys" pattern is what merge conflicts leave behind
when the chevrons get stripped but content from both sides stays —
the symptom is that PyYAML happily parses the file, every test
passes, and then GitHub rejects the run on the first push.

This script installs a `construct_mapping` override that errors out
on any duplicate key at any depth. Run it locally before pushing
workflow changes:

    python3 scripts/check_workflow_yaml.py

Or wire it into a pre-commit hook / CI step.

Exit code: 0 if every workflow parses with unique keys; 1 otherwise.
"""
from __future__ import annotations

import sys
from pathlib import Path

import yaml


class StrictUniqueLoader(yaml.SafeLoader):
    pass


def _no_duplicate_keys(loader, node, deep=False):
    seen: set = set()
    for key_node, _ in node.value:
        key = loader.construct_object(key_node, deep=deep)
        # Hashable check: dicts/lists in YAML keys are weird but legal
        # in some flow styles; fall back to repr-based dedupe.
        try:
            hash(key)
            hashable = key
        except TypeError:
            hashable = repr(key)
        if hashable in seen:
            raise yaml.constructor.ConstructorError(
                "while constructing a mapping",
                node.start_mark,
                f"duplicate key {key!r}",
                key_node.start_mark,
            )
        seen.add(hashable)
    return yaml.SafeLoader.construct_mapping(loader, node, deep=deep)


StrictUniqueLoader.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG,
    _no_duplicate_keys,
)


def main() -> int:
    repo_root = Path(__file__).resolve().parents[1]
    workflows_dir = repo_root / ".github" / "workflows"
    if not workflows_dir.exists():
        print(f"  no workflows dir: {workflows_dir}")
        return 0

    rc = 0
    for path in sorted(workflows_dir.glob("*.yml")):
        try:
            yaml.load(path.read_text(), Loader=StrictUniqueLoader)
            print(f"  OK     {path.name}")
        except yaml.YAMLError as exc:
            rc = 1
            print(f"  FAIL   {path.name}")
            for line in str(exc).splitlines():
                print(f"         {line}")
    return rc


if __name__ == "__main__":
    sys.exit(main())
