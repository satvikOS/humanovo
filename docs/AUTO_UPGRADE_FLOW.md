# humanovo — Auto-upgrade flow

How code changes propagate to users — without anyone clicking a
button after `git push`.

## TL;DR

```
git push origin humanovo
         │
         ├──► ci.yml             tests, type-check, lint  ─►  pass / fail
         │
         ├──► deploy-frontend-new-account.yml
         │       Vite build + S3 sync + CloudFront invalidation
         │       (only if frontend/ changed)
         │       ─►  https://d1l1516144ax30.cloudfront.net  (live)
         │
         └──► build-native-apps.yml
                 Matrix: macOS / Windows / Linux
                 ─►  GitHub Release `auto-{shortSHA}`  (published)
                       │
                       └──► installed apps poll latest.json on launch
                            ─►  Tauri updater downloads + applies
```

End users never see "go download v0.2.1" — their installed app silently
upgrades on the next launch (Tauri default: check on startup, prompt
once, then download in background).

## Three pieces

### 1. Web URL (`https://d1l1516144ax30.cloudfront.net`)

**Trigger:** push to `humanovo` that touches `frontend/**` (with
`!frontend/src-tauri/**` and `!frontend/e2e/**` exclusions so a
Tauri-only or e2e-only change doesn't invalidate the CDN cache for
nothing).

**What happens** (`.github/workflows/deploy-frontend-new-account.yml`):

1. Configure new-account AWS credentials.
2. Read Terraform outputs to discover the bucket + distribution.
3. `npm ci && npm run build`.
4. Two-pass `aws s3 sync`:
   - hashed assets in `/assets/*` get `Cache-Control: public, max-age=31536000, immutable`
   - top-level files (index.html, manifest, etc.) get `Cache-Control: no-cache, no-store, must-revalidate`
5. `aws cloudfront create-invalidation --paths '/*'` and wait for completion.

**Time to live:** ~3 minutes from `git push` to the new build serving
out of CloudFront. The wait-for-invalidation step means the workflow
only reports success once the URL is actually serving the new assets.

### 2. Native apps build + publish

**Trigger:** push to `humanovo` that touches `frontend/**` or this
workflow file. Also fires on `vX.Y.Z` tag pushes (manual release path).

**What happens** (`.github/workflows/build-native-apps.yml`):

1. Matrix runs on `macos-latest` / `ubuntu-22.04` / `windows-latest`.
2. Auto-generate placeholder icons if missing (1024×1024 humanovo-bronze
   solid, expanded into all platform sizes via `tauri icon`).
3. Compute version + tag:
   - tag push → use the tag verbatim (`v0.3.0`)
   - regular push → coin `auto-{shortSHA}` and version `0.2.0+{shortSHA}`
   - dispatch with no tag → artifact-only build, no release
4. Patch `tauri.conf.json` with the resolved version (matters for the
   updater's version comparison).
5. `tauri-action@v0` builds the platform's bundle and uploads it.
6. **Auto-pushes get published immediately**; tag/dispatch builds get
   `releaseDraft: true` so a human reviews before rolling out.

**What lands in the release** (per platform):

| OS | Artifact | Updater manifest entry |
|---|---|---|
| macOS (universal) | `humanovo_<v>_universal.dmg` | `darwin-x86_64`, `darwin-aarch64` |
| Windows x86_64 | `humanovo_<v>_x64-setup.exe` (NSIS) + `_x64_en-US.msi` | `windows-x86_64` |
| Linux x86_64 | `humanovo_<v>_amd64.deb` + `_amd64.AppImage` | `linux-x86_64` |

`tauri-action@v0` automatically generates `latest.json` (the manifest
the updater reads) and attaches it to the release as a downloadable
asset.

### 3. Installed-app self-upgrade

The Tauri shell ships with the `tauri-plugin-updater` and a configured
endpoint:

```jsonc
// frontend/src-tauri/tauri.conf.json
"updater": {
  "active": true,
  "endpoints": [
    "https://github.com/satvikOS/humanovo/releases/latest/download/latest.json"
  ],
  "dialog": true,
  "pubkey": "..."
}
```

On every app launch the updater fetches `latest.json`, compares its
`version` to `CARGO_PKG_VERSION` in the running binary, and if newer:

1. Downloads the platform-specific installer (`.dmg` / `.exe` / `.AppImage`).
2. Verifies the `.sig` signature against the embedded `pubkey`.
3. Shows the user a "humanovo {{version}} is available" dialog.
4. On accept, applies the update and relaunches.

**Signing required for auto-apply:** without a Tauri signing keypair
(`TAURI_SIGNING_PRIVATE_KEY` + `_PASSWORD` repo secrets), the build
still succeeds but the updater shows the user a manual-download link
instead of auto-applying.

## Setting up code signing (one-time)

The build pipeline runs unsigned by default — works fine for closed
beta, but production users will see "unidentified developer" warnings
on macOS and "Windows protected your PC" on Windows. Three signing
flavors needed for clean installs + auto-update:

### Tauri auto-updater

1. `cd frontend && npm run tauri signer generate -- -w ~/.tauri/humanovo.key`
2. Copy the **public** key (the script prints it) → paste into
   `frontend/src-tauri/tauri.conf.json` `updater.pubkey`.
3. Repo Settings → Secrets:
   - `TAURI_SIGNING_PRIVATE_KEY` → contents of `~/.tauri/humanovo.key`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` → the password you set

After the next push, `latest.json` will carry signatures and installed
apps will auto-apply updates.

### macOS — Apple Developer ID

1. Enroll in [Apple Developer Program](https://developer.apple.com/programs/) ($99/yr).
2. Create a "Developer ID Application" cert in Xcode → export `.p12`.
3. Repo Secrets:
   - `APPLE_CERTIFICATE` (base64 of the .p12)
   - `APPLE_CERTIFICATE_PASSWORD` (export password)
   - `APPLE_SIGNING_IDENTITY` (e.g., `Developer ID Application: humanovo (TEAMID)`)
   - `APPLE_ID` (developer-account email)
   - `APPLE_PASSWORD` (app-specific password — NOT your Apple ID password)
   - `APPLE_TEAM_ID` (10-char team ID from developer.apple.com)

The build action picks these up automatically and notarizes the
`.dmg` end-to-end.

### Windows — Authenticode

1. Buy a code-signing cert (DigiCert / Sectigo / GlobalSign — ~$200-500/yr).
2. Export as `.pfx`.
3. Either install on the build runner OR add a custom `signtool` step
   (the simplest path is configuring `tauri.conf.json` `windows.certificateThumbprint`).

## What you need to do TODAY

The pipeline is already wired up — the next push to `humanovo` will:
1. Auto-deploy the frontend.
2. Auto-build all three native apps.
3. Auto-publish a release named `auto-{shortSHA}`.

The first push will show an unsigned build warning when users install
it. To fix that, follow the signing setup above — but functionally
the apps work today, both first install and auto-upgrade.
