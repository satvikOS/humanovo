#!/usr/bin/env python3
"""Verify that every SHA-pinned action in .github/workflows/ is a real commit.

Hallucinated or copy-paste-corrupted SHAs cause every CI run on the
affected workflow to fail with "Unable to resolve action ... unable to
find version <sha>". This script catches the issue at PR-time so the
fix lands before the next workflow run.

Usage:
    python3 scripts/verify-action-shas.py            # standard run
    python3 scripts/verify-action-shas.py --quiet    # only print failures
    python3 scripts/verify-action-shas.py --json     # machine-readable

Exits non-zero if any SHA fails to resolve. Designed to be CI-callable.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import urllib.error
import urllib.request


PAT = re.compile(r"uses:\s+([a-zA-Z0-9_./-]+)@([0-9a-f]{40})")


def find_pinned_uses(workflows_dir: str = ".github/workflows") -> list[tuple[str, str, str]]:
    """Return (file, owner_repo, sha) tuples for every SHA-pinned action."""
    try:
        out = subprocess.check_output(
            ["grep", "-rnHE", r"uses:\s+[a-zA-Z0-9_./-]+@[0-9a-f]{40}", workflows_dir],
            text=True,
        )
    except subprocess.CalledProcessError:
        return []
    triples: list[tuple[str, str, str]] = []
    for line in out.splitlines():
        # grep -nH output: <file>:<lineno>:<text>
        first_colon = line.find(":")
        second_colon = line.find(":", first_colon + 1)
        path = line[:first_colon] if first_colon != -1 else line
        text = line[second_colon + 1:] if second_colon != -1 else line
        m = PAT.search(text)
        if m:
            triples.append((path, m.group(1), m.group(2)))
    return triples


def verify_sha(owner_repo: str, sha: str) -> tuple[bool, str]:
    """Return (ok, status). Uses an HTTP HEAD against the public commit
    page rather than the API to avoid unauthenticated rate limits."""
    url = f"https://github.com/{owner_repo}/commit/{sha}"
    req = urllib.request.Request(
        url, method="HEAD", headers={"User-Agent": "humanovo-ci"}
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status == 200, f"HTTP {resp.status}"
    except urllib.error.HTTPError as e:
        return False, f"HTTP {e.code}"
    except Exception as e:
        return False, f"err({type(e).__name__}: {e})"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--quiet", action="store_true", help="only print failures")
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    parser.add_argument(
        "--workflows-dir",
        default=".github/workflows",
        help="directory to scan (default: .github/workflows)",
    )
    args = parser.parse_args()

    triples = find_pinned_uses(args.workflows_dir)
    # De-dupe by (owner_repo, sha) - a single action+SHA pair appearing
    # in multiple workflow files only needs to be checked once.
    by_pair: dict[tuple[str, str], list[str]] = {}
    for path, owner_repo, sha in triples:
        by_pair.setdefault((owner_repo, sha), []).append(path)

    results: list[dict[str, object]] = []
    failures = 0
    for (owner_repo, sha), paths in sorted(by_pair.items()):
        ok, status = verify_sha(owner_repo, sha)
        if not ok:
            failures += 1
        results.append({
            "owner_repo": owner_repo,
            "sha": sha,
            "ok": ok,
            "status": status,
            "files": sorted(set(paths)),
        })

    if args.json:
        print(json.dumps({"results": results, "failures": failures}, indent=2))
    else:
        if not args.quiet:
            print(f"Verified {len(results)} action+SHA pairs:\n")
        for r in results:
            if r["ok"] and args.quiet:
                continue
            flag = "OK  " if r["ok"] else "FAIL"
            files = ", ".join(p.replace(".github/workflows/", "") for p in r["files"])
            print(
                f"  [{flag}] {r['owner_repo']}@{r['sha'][:12]}  "
                f"{r['status']}  ({files})"
            )
        print(f"\n{len(results) - failures} OK, {failures} FAIL")

    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
