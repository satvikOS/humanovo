# humanovo — Native app build guide

The Win/Mac/Linux apps users actually install. The web URL
(`https://d1l1516144ax30.cloudfront.net`) is admin-only — end users
download a desktop binary from the GitHub Releases page.

## Architecture

The native app is a **Tauri v2 shell** that bundles the same Vite SPA
that runs on the web. No code duplication; the React tree decides at
runtime whether to use Tauri APIs (`window.__TAURI_INTERNALS__` is
set) vs browser fallbacks. See `frontend/src/lib/native.ts`.

| Layer | Tech |
|---|---|
| UI | Vite + React + Tailwind (same code as web) |
| Native shell | Tauri v2 (Rust + WebView) |
| API surface | Tauri plugins: `shell`, `deep-link`, `os`, `process`, `updater`, `single-instance` |
| Bundle output | macOS `.dmg`, Windows `.msi` + `.exe`, Linux `.deb` + `.AppImage` |
| Code signing | Apple Developer cert (mac) / Authenticode (win) / none on Linux (AppImage) |
| Updates | Tauri updater plugin pointing at `releases.humanovo.com/...` |

The shell is intentionally thin: ~200 lines of Rust in
`frontend/src-tauri/src/lib.rs`. Heavy logic stays in the Vite bundle
so a frontend-only release doesn't require re-shipping the binary.

---

## One-time local setup

You only need this once per dev machine.

### 1. Install Rust

```sh
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
rustc --version    # should print 1.77.2 or newer
```

### 2. Install platform build deps

**macOS:**
```sh
xcode-select --install
```

**Linux (Ubuntu 22.04 / Debian 12):**
```sh
sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev \
  librsvg2-dev patchelf build-essential libxdo-dev libssl-dev \
  libayatana-appindicator3-dev libgtk-3-dev
```

**Windows:**
- Install [Microsoft Visual Studio C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
- Install [WebView2 runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (already on Windows 11)

### 3. Install npm deps

```sh
cd frontend
npm install
```

This pulls `@tauri-apps/cli` and the JS plugin packages.

### 4. Generate icons (one-time)

The Tauri bundler refuses to build without icon files. Generate them
once from a 1024×1024 source PNG:

```sh
cd frontend
npm run tauri:icon path/to/source-icon-1024.png
```

This produces `src-tauri/icons/{32x32,128x128,128x128@2x}.png`,
`icon.icns` (macOS), and `icon.ico` (Windows). Commit the generated
files OR keep them out of git (current default — see `src-tauri/icons/README.md`).

For closed-beta you can use a placeholder (the humanovo glyph in
`src/components/HumanovoGlyph.tsx`); replace with a properly-designed
app icon before public release.

---

## Daily dev loop

```sh
cd frontend
npm run tauri:dev
```

This starts:
- Vite dev server on `http://localhost:5173` (HMR for the React side)
- Tauri shell pointing at it (HMR for Rust side)

Edit React → changes hot-reload. Edit `src-tauri/src/lib.rs` → Tauri
auto-recompiles the Rust crate (~5-10s on cached builds).

---

## Production build (single platform)

```sh
cd frontend
npm run tauri:build
```

Output:
- macOS: `src-tauri/target/release/bundle/{macos,dmg}/*.app` and `*.dmg`
- Windows: `src-tauri/target/release/bundle/{nsis,msi}/*.exe` and `*.msi`
- Linux: `src-tauri/target/release/bundle/{deb,appimage}/*.deb` and `*.AppImage`

First-time builds take 5-15 minutes (Rust dep compilation).
Subsequent builds with `swatinem/rust-cache` are 2-3 minutes.

---

## Cross-platform CI build

Workflow: `.github/workflows/build-native-apps.yml`

**Cut a release:**
```sh
git tag v0.3.0
git push origin v0.3.0
```

The workflow runs the build matrix (macOS / Windows / Linux), uploads
all artifacts, and creates a **draft** GitHub Release. Review the
draft in the Releases tab → publish.

**Manual test build (no release):**
- Actions → "Build Native Apps (Win/Mac/Linux)" → Run workflow → leave
  `release_tag` empty → green button.
- Artifacts upload under `humanovo-{macos-universal,linux-x86_64,windows-x86_64}` for 14 days.

---

## Code signing (production releases only)

Unsigned binaries work for developer testing but not for distribution
— users get scary "unidentified developer" / "Windows protected your
PC" warnings.

### macOS

1. Enroll in [Apple Developer Program](https://developer.apple.com/programs/) ($99/yr).
2. Create a "Developer ID Application" certificate in Xcode.
3. Export as `.p12`, base64-encode it.
4. Add repo secrets:
   - `APPLE_CERTIFICATE` — base64 of the .p12
   - `APPLE_CERTIFICATE_PASSWORD` — the export password
   - `APPLE_SIGNING_IDENTITY` — `Developer ID Application: humanovo (TEAMID)`
   - `APPLE_ID` — your developer account email
   - `APPLE_PASSWORD` — an app-specific password (NOT your Apple ID password)
   - `APPLE_TEAM_ID` — 10-char team ID from developer.apple.com

The CI workflow auto-uses these for codesigning + notarization.

### Windows

1. Buy a code-signing certificate (DigiCert, Sectigo, GlobalSign — ~$200-500/yr).
2. Export as `.pfx`, install on the build runner OR run signing as a post-build step.
3. Configure `tauri.conf.json` `windows.certificateThumbprint` (or use a custom signtool step).

### Tauri auto-updater

1. Generate a Tauri signing keypair:
   ```sh
   npm run tauri signer generate
   ```
2. Add to repo secrets:
   - `TAURI_SIGNING_PRIVATE_KEY` — the private key
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — its password
3. Replace the `pubkey` placeholder in `tauri.conf.json` with the public key.
4. Stand up the update endpoint at `releases.humanovo.com/{target}/{arch}/{current_version}` (S3 + CloudFront, returns a JSON manifest).

---

## Distribution channels

| Channel | OS | Status |
|---|---|---|
| GitHub Releases | All | Live (draft created on each tag push) |
| Direct download from humanovo.net/download | All | Pending |
| Mac App Store | macOS | Future |
| Microsoft Store | Windows | Future |
| Snap / Flathub | Linux | Future |
| Tauri auto-updater | All | Configured, needs `releases.humanovo.com` endpoint |

For closed beta, GitHub Releases is fine — share the release URL with
users; they download the platform-specific artifact.
