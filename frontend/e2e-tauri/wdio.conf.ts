/**
 * WebdriverIO config — drives the PACKAGED humanovo Tauri desktop app.
 *
 * Why this exists (and is NOT Playwright):
 *   The chart-render bugs we are chasing are WebView2-specific. They
 *   reproduce ONLY inside the real Tauri desktop app, never in a
 *   normal Chromium browser. Playwright cannot attach to a Tauri
 *   window, so we use the Tauri-official stack instead:
 *
 *     WebdriverIO  ──talks WebDriver──▶  tauri-driver
 *     tauri-driver ──spawns + proxies──▶ msedgedriver (Edge WebView2)
 *     msedgedriver ──drives──▶ the humanovo.exe WebView2 window
 *
 * tauri-driver is a thin WebDriver shim. On Windows it proxies
 * Microsoft Edge Driver (msedgedriver) because Tauri renders inside
 * the WebView2 runtime, which is Chromium/Edge under the hood.
 *
 * Prerequisites (see e2e-tauri/README.md for the full checklist):
 *   - `cargo install tauri-driver` (Tauri 2 compatible)
 *   - msedgedriver.exe whose version matches the installed WebView2
 *     Evergreen runtime, on PATH (or set MSEDGEDRIVER env var).
 *   - A release build of the app:  `npm run tauri:build` in frontend/
 *   - Credentials in env:  E2E_EMAIL  and  E2E_PASSWORD
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── Locate the built app binary ───────────────────────────────────
// productName in src-tauri/tauri.conf.json is "humanovo", so cargo
// emits `humanovo.exe`. The release profile output lives under
// frontend/src-tauri/target/release/.
//
// Override with TAURI_APP_PATH if you build to a non-default target
// dir (e.g. a workspace-shared target/, or a cross-compile output).
const DEFAULT_APP_PATH = resolve(
  __dirname,
  '..',
  'src-tauri',
  'target',
  'release',
  process.platform === 'win32' ? 'humanovo.exe' : 'humanovo',
)
const APP_PATH = process.env.TAURI_APP_PATH
  ? resolve(process.env.TAURI_APP_PATH)
  : DEFAULT_APP_PATH

// tauri-driver listens here; WDIO connects to it as a plain WebDriver
// server. 4444 is the tauri-driver default.
const TAURI_DRIVER_PORT = Number(process.env.TAURI_DRIVER_PORT ?? 4444)

// msedgedriver path — tauri-driver needs to know which native
// WebDriver to proxy. If MSEDGEDRIVER is unset, tauri-driver falls
// back to looking for `msedgedriver` on PATH.
const MSEDGEDRIVER = process.env.MSEDGEDRIVER // optional

let tauriDriver: ChildProcess | undefined

// ── Pre-flight: fail loudly with actionable messages ──────────────
function preflight(): void {
  const problems: string[] = []

  if (!existsSync(APP_PATH)) {
    problems.push(
      `Built app not found at:\n    ${APP_PATH}\n` +
        `  Build it first:  (cd ../ && npm run tauri:build)\n` +
        `  or point TAURI_APP_PATH at the binary.`,
    )
  }

  // tauri-driver must be on PATH (cargo install puts it in ~/.cargo/bin).
  const tdCheck = spawnSync('tauri-driver', ['--help'], { shell: true })
  if (tdCheck.error || tdCheck.status === null) {
    problems.push(
      'tauri-driver not found on PATH.\n' +
        '  Install it:  cargo install tauri-driver\n' +
        '  Ensure ~/.cargo/bin is on PATH.',
    )
  }

  if (!process.env.E2E_EMAIL || !process.env.E2E_PASSWORD) {
    problems.push(
      'E2E_EMAIL / E2E_PASSWORD env vars are not set.\n' +
        '  Release builds disable mock auth, so the harness must log in\n' +
        '  with REAL credentials. Set them before running:\n' +
        '    PowerShell:  $env:E2E_EMAIL="you@lab.edu"; $env:E2E_PASSWORD="..."',
    )
  }

  if (problems.length) {
    throw new Error(
      '\n\n=== e2e-tauri pre-flight failed ===\n\n' +
        problems.map((p, i) => `(${i + 1}) ${p}`).join('\n\n') +
        '\n\nSee e2e-tauri/README.md for the full setup checklist.\n',
    )
  }
}

export const config: WebdriverIO.Config = {
  runner: 'local',

  // WDIO 9 auto-detects the installed `tsx` loader and uses it to run
  // this .ts config and the .ts specs — no ts-node `require` shim
  // needed. `tsConfigPath` points it at our tsconfig.
  tsConfigPath: resolve(__dirname, 'tsconfig.json'),

  specs: ['./specs/**/*.e2e.ts'],
  maxInstances: 1, // a desktop app is a single-window singleton — never parallelize

  // tauri-driver speaks the W3C WebDriver protocol; point WDIO at it
  // directly instead of letting WDIO manage its own driver.
  hostname: '127.0.0.1',
  port: TAURI_DRIVER_PORT,
  path: '/',

  capabilities: [
    {
      // `tauri:options` is the capability tauri-driver consumes. The
      // `application` key is the absolute path to the built binary it
      // should launch. `webviewOptions` is reserved for future Tauri
      // versions; left empty.
      'tauri:options': {
        application: APP_PATH,
      },
      // WebView2 is Chromium/Edge — declare the browser so WDIO loads
      // the right protocol handlers.
      browserName: 'wry',
    } as WebdriverIO.Capabilities,
  ],

  logLevel: (process.env.WDIO_LOG_LEVEL as 'info') ?? 'info',
  bail: 0,
  baseUrl: '',
  waitforTimeout: 20_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 3,

  framework: 'mocha',
  mochaOpts: {
    ui: 'bdd',
    // Driving ~50 charts (17 of them WebGL) through one window is slow
    // — generous per-test timeout. Individual waits are tighter.
    timeout: 600_000,
  },

  reporters: ['spec'],

  // ── Lifecycle: own the tauri-driver process ─────────────────────
  // WDIO does not know about tauri-driver, so we spawn it ourselves
  // before the session and kill it after.
  onPrepare: () => {
    preflight()

    const args = ['--port', String(TAURI_DRIVER_PORT)]
    if (MSEDGEDRIVER) args.push('--native-driver', MSEDGEDRIVER)

    tauriDriver = spawn('tauri-driver', args, {
      stdio: [null, process.stdout, process.stderr],
      shell: true,
    })
    tauriDriver.on('error', (err) => {
      console.error('tauri-driver failed to start:', err)
      process.exit(1)
    })
  },

  onComplete: () => {
    if (tauriDriver) {
      tauriDriver.kill()
      tauriDriver = undefined
    }
  },
}
