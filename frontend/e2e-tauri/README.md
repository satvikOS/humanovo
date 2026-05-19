# e2e-tauri — desktop-app E2E harness

End-to-end tests that drive the **packaged humanovo Tauri desktop app**
(Windows, WebView2) — **not** a browser.

## Why this exists

The chart-render bugs we are chasing are **WebView2-specific**. They
reproduce only inside the real desktop app; a normal Chromium/Playwright
run renders all ~50 chart types fine. The existing browser suite in
`frontend/e2e/` (Playwright) **is left untouched** — this harness is
separate and additive.

The stack is the Tauri-official one:

```
WebdriverIO  ──WebDriver──▶  tauri-driver  ──spawns/proxies──▶  msedgedriver  ──drives──▶  humanovo.exe (WebView2)
```

`tauri-driver` is a thin WebDriver shim. On **Windows** it proxies
**Microsoft Edge Driver (`msedgedriver`)** because Tauri renders inside
the WebView2 (Chromium/Edge) runtime.

## Prerequisites (one-time, on the Windows machine)

1. **Rust toolchain** — needed both to build the app and to install
   `tauri-driver`. Install from <https://rustup.rs>.

2. **tauri-driver** (Tauri 2 compatible):
   ```powershell
   cargo install tauri-driver --locked
   ```
   This installs to `~/.cargo/bin`. Confirm that directory is on
   `PATH`:
   ```powershell
   tauri-driver --help
   ```

3. **Microsoft Edge WebDriver (`msedgedriver.exe`)** — its version must
   match the **WebView2 Evergreen Runtime** installed on the machine
   (which tracks your installed Microsoft Edge version).
   - Check your Edge version: `edge://version`.
   - Download the matching `msedgedriver` from
     <https://developer.microsoft.com/microsoft-edge/tools/webdriver/>.
   - Put `msedgedriver.exe` on `PATH`, **or** set the `MSEDGEDRIVER`
     env var to its full path (the harness passes it to tauri-driver
     via `--native-driver`).

4. **Node 20+** and the harness dependencies:
   ```powershell
   cd frontend/e2e-tauri
   npm install
   ```

5. **Build the desktop app in release mode** — the harness launches the
   *packaged binary*, so it must exist first:
   ```powershell
   cd frontend
   npm run tauri:build
   ```
   This produces `frontend/src-tauri/target/release/humanovo.exe`
   (the harness's default `TAURI_APP_PATH`).

   > Release builds set `VITE_ENABLE_MOCK_AUTH=false`, so the dev
   > `1234 / 1234` login does **not** work — see credentials below.

6. **Credentials.** Release builds disable mock auth, so the harness
   logs in with **real** credentials, read from env vars (never
   hard-coded — do not commit them):
   ```powershell
   $env:E2E_EMAIL    = "you@yourlab.edu"
   $env:E2E_PASSWORD = "your-real-password"
   ```
   The account must be a working humanovo login against the backend
   the release build is pointed at (the AWS prod API).

## Running

From `frontend/e2e-tauri`:

```powershell
# all specs (chart catalog + spot checks)
npm test

# just the chart catalog
npm run test:charts
```

The harness automatically spawns and tears down `tauri-driver`; you do
**not** start it yourself.

### Optional env vars

| Var                 | Default                                                  | Purpose                                            |
| ------------------- | -------------------------------------------------------- | -------------------------------------------------- |
| `E2E_EMAIL`         | _(required)_                                             | Login email.                                       |
| `E2E_PASSWORD`      | _(required)_                                             | Login password.                                    |
| `TAURI_APP_PATH`    | `../src-tauri/target/release/humanovo.exe`               | Override the built-binary path.                    |
| `MSEDGEDRIVER`      | _(PATH lookup)_                                           | Full path to `msedgedriver.exe`.                   |
| `TAURI_DRIVER_PORT` | `4444`                                                   | Port `tauri-driver` listens on.                    |
| `WDIO_LOG_LEVEL`    | `info`                                                   | `trace` / `debug` / `info` / `warn` / `error`.     |

## What the tests do

`specs/charts.e2e.ts`:

1. **Launch + login** — drives the real `Login.tsx` form using the
   `data-testid` selectors `login-email`, `login-password`,
   `login-submit`; waits for the `/dashboard` redirect.
2. **Chart catalog** — seeds one chart per type (the `CHART_TYPES` list
   mirrored in `lib/chart-types.ts`) into `localStorage`
   (`humanovo-charts`), reloads **Data Visualization**, and for each
   type:
   - screenshots the chart card → `screenshots/<type>.png`,
   - asserts it rendered: the `ChartErrorBoundary` text
     **"This chart could not be rendered"** is absent, and a non-empty
     `<canvas>` (3D / Plotly WebGL) or chart `<svg>` (2D / recharts) is
     present.
   - One `it()` per type, so the spec reporter shows a per-type
     pass/fail line; an `after` hook prints a summary table.
3. **Spot checks** — Compute Lab equation-plotter figure output, and
   the Knowledge Graph page render (no error boundary).

## Output

- `screenshots/<chart-type>.png` — one per chart type.
- `screenshots/_compute-lab.png`, `screenshots/_knowledge-graph.png`.
- Console summary: `PASS`/`FAIL` per chart type + a final tally.

## Keeping `CHART_TYPES` in sync

`lib/chart-types.ts` is a **hand-maintained mirror** of the
`CHART_TYPES` array in `frontend/src/pages/DataVisualization.tsx`. If a
chart type is added/removed/renamed there, update `lib/chart-types.ts`
to match (the `label` must match exactly — it is shown in the chart
card's type pill, though the harness primarily locates cards by the
chart `value` used as the title).

## Troubleshooting

- **"Built app not found"** — run `npm run tauri:build` in `frontend/`,
  or set `TAURI_APP_PATH`.
- **"tauri-driver not found on PATH"** — `cargo install tauri-driver`
  and ensure `~/.cargo/bin` is on `PATH`.
- **Session fails to start / version mismatch** — your `msedgedriver`
  version does not match the WebView2 runtime. Re-download a matching
  `msedgedriver` (check `edge://version`).
- **Login never reaches `/dashboard`** — wrong `E2E_EMAIL` /
  `E2E_PASSWORD`, or the backend is unreachable from this machine.
