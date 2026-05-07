#!/usr/bin/env python3
"""
Patch the `version` field in frontend/src-tauri/tauri.conf.json.

Used by the build-native-apps.yml workflow to bake the resolved
build-version into the binary so the Tauri auto-updater can compare
it against latest.json on each app launch.

Usage:
    python3 scripts/set_tauri_version.py 0.2.0+abcdef12

Without arguments, falls back to env var TAURI_VERSION.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

DEFAULT_PATH = Path("frontend/src-tauri/tauri.conf.json")


def main() -> int:
    version = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("TAURI_VERSION")
    if not version:
        print("usage: set_tauri_version.py <version>", file=sys.stderr)
        return 2

    target = Path(os.environ.get("TAURI_CONF_PATH", DEFAULT_PATH))
    if not target.exists():
        print(f"error: {target} not found", file=sys.stderr)
        return 1

    data = json.loads(target.read_text())
    old = data.get("version")
    data["version"] = version
    target.write_text(json.dumps(data, indent=2) + "\n")
    print(f"{target} version: {old!r} -> {version!r}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
