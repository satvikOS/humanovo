#!/usr/bin/env python3
"""
Inject the Tauri updater config into tauri.conf.json. The committed
config has no updater block, so this script is responsible for ALWAYS
writing one — otherwise the updater plugin (loaded unconditionally in
src-tauri/src/lib.rs) panics at startup with:

    PluginInitialization("updater",
      "Error deserializing 'plugins.updater' within your Tauri configuration:
       invalid type: null, expected struct Config")

Two modes:
  - PUBLIC_KEY set   → real updater config (active: true) pointing at
                       the GitHub Releases manifest. Updates work end-to-end.
  - PUBLIC_KEY empty → inert stub (active: false, no endpoints, no pubkey).
                       Plugin deserializes cleanly but never tries to update,
                       so first-build UX (no signing keys) still ships a
                       launchable binary.

Inputs (env vars):
    TAURI_SIGNING_PUBLIC_KEY  — base64 minisign public key (optional)
    TAURI_UPDATER_ENDPOINT    — manifest URL (defaults to GH Releases)

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
    target = Path(os.environ.get("TAURI_CONF_PATH", DEFAULT_PATH))
    if not target.exists():
        print(f"error: {target} not found", file=sys.stderr)
        return 1

    pubkey = os.environ.get("TAURI_SIGNING_PUBLIC_KEY", "").strip()
    endpoint = os.environ.get("TAURI_UPDATER_ENDPOINT", DEFAULT_ENDPOINT).strip()

    data = json.loads(target.read_text())
    plugins = data.setdefault("plugins", {})

    if pubkey:
        # Real config — bundler emits .sig sidecars, app verifies them
        # against pubkey before applying any update.
        data.setdefault("bundle", {})["createUpdaterArtifacts"] = True
        plugins["updater"] = {
            "active": True,
            "endpoints": [endpoint],
            "dialog": True,
            "pubkey": pubkey,
        }
        print(
            f"{target} updater ENABLED. endpoint={endpoint} "
            f"pubkey={pubkey[:16]}...{pubkey[-8:]}",
        )
    else:
        # Inert stub — plugin loads, deserializes a valid Config, then
        # does nothing. Required because Builder::new().build() in
        # lib.rs runs the plugin's init unconditionally; absence of the
        # block panics with "invalid type: null".
        data.setdefault("bundle", {})["createUpdaterArtifacts"] = False
        plugins["updater"] = {
            "active": False,
            "endpoints": [],
            "dialog": False,
            "pubkey": "",
        }
        print(
            f"{target} updater stub written (active=false). Set "
            "TAURI_SIGNING_PUBLIC_KEY repo secret + push to enable real updates."
        )

    target.write_text(json.dumps(data, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
