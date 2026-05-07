#!/usr/bin/env python3
"""
Inject the Tauri updater config into tauri.conf.json IFF the public
key is provided. The committed config has no updater block so the
build succeeds with no signing keys at all (first-run UX). Once the
user generates a Tauri updater keypair and adds both halves to repo
Secrets, the build workflow runs this script to wire the updater on.

Inputs (env vars, not args):
    TAURI_SIGNING_PUBLIC_KEY  — base64 minisign public key (required to
                                enable updater)
    TAURI_UPDATER_ENDPOINT    — manifest URL the updater polls. Defaults
                                to the latest GitHub Release manifest.

Behavior:
    - PUBLIC_KEY empty/missing → no-op (exit 0). Build proceeds with
      updater disabled.
    - PUBLIC_KEY set            → tauri.conf.json patched in place to
      enable bundle.createUpdaterArtifacts + plugins.updater.

Usage:
    TAURI_SIGNING_PUBLIC_KEY="$KEY" python3 scripts/configure_tauri_updater.py
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

DEFAULT_PATH = Path("frontend/src-tauri/tauri.conf.json")
DEFAULT_ENDPOINT = (
    "https://github.com/satvikOS/humanovo/releases/latest/download/latest.json"
)


def main() -> int:
    pubkey = os.environ.get("TAURI_SIGNING_PUBLIC_KEY", "").strip()
    if not pubkey:
        print(
            "TAURI_SIGNING_PUBLIC_KEY not set — leaving updater disabled "
            "(build will produce unsigned installers).",
        )
        return 0

    target = Path(os.environ.get("TAURI_CONF_PATH", DEFAULT_PATH))
    if not target.exists():
        print(f"error: {target} not found", file=sys.stderr)
        return 1

    endpoint = os.environ.get("TAURI_UPDATER_ENDPOINT", DEFAULT_ENDPOINT).strip()

    data = json.loads(target.read_text())
    data.setdefault("bundle", {})["createUpdaterArtifacts"] = True
    plugins = data.setdefault("plugins", {})
    plugins["updater"] = {
        "active": True,
        "endpoints": [endpoint],
        "dialog": True,
        "pubkey": pubkey,
    }

    target.write_text(json.dumps(data, indent=2) + "\n")
    print(
        f"{target} updater enabled. endpoint={endpoint} "
        f"pubkey={pubkey[:16]}...{pubkey[-8:]}",
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
