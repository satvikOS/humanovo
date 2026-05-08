# CI / GitHub Actions Gotchas

A running catalogue of CI failures we've hit in this repo, the root
cause, and the durable fix. Each entry is dated so a future engineer
can correlate against the changelog.

The point of this file is to short-circuit the next agent session
(or the next dev) from re-deriving the same fix from a green CI log.
If you fix something in `.github/workflows/`, leave a breadcrumb
here.

---

## 1. Hallucinated SHA on third-party action

**Date observed:** 2026-05-08
**Symptom:** All matrix legs of `build-native-apps` red with

    Unable to resolve action `tauri-apps/tauri-action@2a55bea...`,
    unable to find version `2a55bea...`

**Root cause:** An earlier session SHA-pinned the action with a
40-char hash that didn't exist in the upstream repo. The hash
*looked* plausible (right length, right alphabet) so it survived
review.

**Fix:** Replaced with a SHA verified against the live commit
endpoint:

    curl https://github.com/<owner>/<repo>/commit/<sha>
    HTTP 200  -> good
    HTTP 404  -> bad

**Durable defence:**
* `scripts/verify-action-shas.py` hits each `uses: <action>@<sha>`
  via HEAD request and reports any 404.
* `.github/workflows/verify-action-shas.yml` runs it on every PR
  touching `.github/workflows/` and nightly.

---

## 2. Ref-name-as-config gotcha

**Date observed:** 2026-05-08
**Symptom:** Tauri matrix legs failed mid-build with

    error: invalid toolchain name ''

from `dtolnay/rust-toolchain`.

**Root cause:** The action reads its primary config (toolchain
channel: `stable` / `nightly` / `1.75`) from the *ref name*, not a
`with:` input. SHA-pinning replaced the ref with a 40-char hash, so
the channel inference fell through to `""` and rustup ran with no
toolchain.

**Fix:**

    uses: dtolnay/rust-toolchain@<sha>
    with:
      toolchain: stable        # required when SHA-pinned
      targets: aarch64-apple-darwin

**Durable defence:**
* Audited all 13 SHA-pinned third-party actions in this repo
  (2026-05-08). Only `dtolnay/rust-toolchain` reads ref-name-as-
  config; all `actions/*`, `aws-actions/*`, `azure/*`,
  `google-github-actions/*`, `hashicorp/*`, `Swatinem/rust-cache`,
  `tauri-apps/tauri-action` take their config exclusively from
  `with:` inputs.
* Re-audit any newly-introduced SHA-pinned action against this list.
* `actionlint` (`.github/workflows/actionlint.yml`) catches this
  when the action's metadata declares the input as required.

---

## 3. Cache service 400 errors with v5-generation actions

**Date observed:** 2026-05-08
**Symptom:** Build matrix red with

    Failed to restore: Cache service responded with 400

on every `setup-node` step that had `cache: 'npm'`.

**Root cause:** GitHub migrated the cache backend to a v2 service
that rejects requests from the cache library bundled in v5-generation
of `actions/setup-node`, `actions/setup-python`, `actions/cache`, etc.
The v5 actions also run on Node 20, which is being deprecated on the
runner side.

**Fix:** Bumped every actions/* SHA to v6:

    actions/checkout         v5 -> v6  (de0fac2...)
    actions/setup-node       v5 -> v6  (48b55a0...)
    actions/setup-python     v5 -> v6  (a309ff8...)
    actions/upload-artifact  v5 -> v6  (b7c566a...)
    actions/download-artifact v5 -> v6 (018cc2c...)

`Swatinem/rust-cache` v2 alias also bumped to the v2.9.1
dereferenced commit (the alias pointed at an annotated-tag object
SHA, which github.com only resolves at the tag-page level, not the
commit-page level — see § 4 below).

**Durable defence:**
* `verify-action-shas.py --strict-deprecations` flags any of the
  known-deprecated v5 SHAs in `NODE20_DEPRECATED_SHAS`.
* The set is hand-extended whenever we observe a runtime
  deprecation warning.

---

## 4. Annotated tag SHA vs commit SHA

**Date observed:** 2026-05-08
**Symptom:** `verify-action-shas.py` reports `[FAIL]` HTTP 404 for
`Swatinem/rust-cache@23869a5b...` even though `git ls-remote` clearly
shows the tag at that SHA.

**Root cause:** `git ls-remote` returns *two* entries for an annotated
tag:

    23869a5bd66c...  refs/tags/v2.9.1       <- annotated tag object
    c19371144df3...  refs/tags/v2.9.1^{}    <- commit it points at

GitHub Actions resolves the *commit* SHA, not the tag-object SHA. The
public `github.com/<repo>/commit/<sha>` page only renders for commit
SHAs (which is what HEAD resolves) and 404s for tag-object SHAs.

**Fix:** Use the dereferenced SHA (`...^{}` row from `ls-remote`).

**Durable defence:** `verify-action-shas.py` HEAD-checks against the
commit page; a tag-object SHA correctly fails the check before it
ships to CI.

---

## 5. Hallucinated runner label

**Date observed:** 2026-05-08
**Symptom:** actionlint reports

    label "windows-2025-vs2026" is unknown. available labels are ...

**Root cause:** GitHub announced the `windows-2025` runner alias
will redirect to a `windows-2025-vs2026` image on 2026-05-12. The
"redirect target" label appears in the announcement but isn't
accepted by the dispatcher *until* the redirect lands.

**Fix:** Use the bare `windows-2025` label and let the May-12
redirect carry the build forward to the new image. Tauri only
depends on MSBuild (which both VS 2022 and VS 2026 ship with), so
the toolchain rollover doesn't break the build.

**Durable defence:** actionlint flags unknown runner labels at
PR-time. If the label IS legitimate (e.g. a self-hosted runner we've
deployed), add it under `self-hosted-runner.labels` in
`.github/actionlint.yaml`.

---

## 6. Download-script directory pre-create

**Date observed:** 2026-05-08
**Symptom:** `actionlint` workflow red with

    Directory '/tmp/bin' does not exist
    Error: Process completed with exit code 1.

**Root cause:** `download-actionlint.bash` validates that the target
directory already exists before writing the binary. The action step
that called it didn't `mkdir -p` first.

**Fix:**

    BIN_DIR="$RUNNER_TEMP/actionlint-bin"
    mkdir -p "$BIN_DIR"
    bash download-actionlint.bash "$VERSION" "$BIN_DIR"

`$RUNNER_TEMP` is preferred over `/tmp` because it works on Windows
runners (which don't have a usable /tmp).

**Durable defence:** general principle — any external installer
script we run in CI gets a `mkdir -p` for its target dir, no matter
how innocuous the script looks.

---

## 7. Boolean flag with mistaken argument

**Date observed:** 2026-05-08
**Symptom:** actionlint workflow red with

    could not read "always": open always: no such file or directory
    Error: Process completed with exit code 3.

**Root cause:** Workflow used `actionlint -color always`. actionlint's
`-color` is a *boolean* (no value); the binary parsed `always` as a
workflow-file path argument and tried to open it.

**Fix:** `actionlint -color` (no argument) forces colour output;
`actionlint -no-color` disables it; `actionlint` (default) auto-
detects.

**Durable defence:** when invoking a CLI tool we haven't memorised,
double-check `-h | grep <flag>` to see whether the flag takes a
value. Common Go-style boolean flags don't (`-color`, `-verbose`,
`-quiet`, etc.).

---

## How to extend this file

When you fix a CI failure, add a new numbered section with:

1. **Date observed** — when the failure first hit a CI run we noticed.
2. **Symptom** — the exact error message from the runner log.
3. **Root cause** — *why* it broke, in one paragraph.
4. **Fix** — the diff applied, with any required env / config calls.
5. **Durable defence** — the linter / script / convention that
   prevents the same class of error from re-surfacing.

If the fix involves a new SHA, validate it via the verifier before
committing:

    python3 scripts/verify-action-shas.py --quiet
