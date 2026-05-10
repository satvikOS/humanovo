/**
 * Native-app helpers — detect whether we're running inside a Tauri
 * shell vs a browser, and route the few features that need to behave
 * differently in each (Stripe checkout redirects, deep-link receipts,
 * external link opening).
 *
 * Most of the React app can stay native-agnostic; only the surfaces
 * that interact with the OS (open browser, register URI handler,
 * receive deep-link callbacks) need to import from here.
 *
 * Web mode (admin testing surface) — every helper falls back to
 * standard web APIs (window.open, location, etc.). Native mode
 * delegates to Tauri's plugin APIs so the OS shell handles things
 * properly (e.g. `tauri-plugin-shell.open()` opens the system
 * browser instead of a new tab).
 */

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: unknown;
  }
}

/**
 * True when the React app is running inside the Tauri shell.
 *
 * Tauri injects `window.__TAURI_INTERNALS__` (v2) into the WebView
 * before the page loads — checking for it is the official detection
 * pattern. We also fall back to `__TAURI__` for resilience against
 * minor version drift.
 */
export function isNativeApp(): boolean {
  if (typeof window === 'undefined') return false
  return Boolean(window.__TAURI_INTERNALS__ || window.__TAURI__)
}

/**
 * Open a URL externally — in the system browser when running natively,
 * in a new tab when running in a regular web context.
 *
 * Used by the billing flow: Stripe Checkout / Customer Portal sessions
 * must open in a real browser (not embedded in the Tauri WebView)
 * because Stripe's auth flows interact with the user's existing
 * browser state (saved cards, third-party cookies, etc.) and because
 * embedding payment forms inside our WebView is a security smell.
 */
export async function openExternal(url: string): Promise<void> {
  if (isNativeApp()) {
    // Lazy-import the plugin so a web-only build doesn't bundle the
    // Tauri shell module. The `@vite-ignore` hint tells Vite's pre-
    // transform to leave the import alone — the package isn't in
    // package.json (it's installed at `npm run tauri:dev` time by
    // the Tauri CLI), so static resolution would fail. Runtime is
    // gated by `isNativeApp()` so web mode never executes the line.
    const { open } = await import(/* @vite-ignore */ '@tauri-apps/plugin-shell')
    await open(url)
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

/**
 * Subscribe to deep-link events (`humanovo://...`) for the duration
 * of the calling component's lifetime.
 *
 * Returns an unlisten function; callers should invoke it on unmount.
 * Pattern in a React effect:
 *
 *     useEffect(() => {
 *       const p = onDeepLink((url) => { ...handle url... })
 *       return () => { p.then(unlisten => unlisten()) }
 *     }, [])
 *
 * In web mode this is a no-op that returns an unlisten function that
 * does nothing — keeps the calling code simple (no `if (isNative)`
 * branches) at the cost of a function call.
 */
export async function onDeepLink(
  handler: (url: string) => void,
): Promise<() => void> {
  if (!isNativeApp()) {
    return () => {}
  }
  const { onOpenUrl } = await import(/* @vite-ignore */ '@tauri-apps/plugin-deep-link')
  // The plugin's signature emits the *full* deep link including the
  // scheme. Pass through to the caller as-is.
  return await onOpenUrl((urls) => {
    if (urls && urls.length > 0) handler(urls[0])
  })
}

/**
 * Read the deep-link URLs the app was launched *with* — i.e. the
 * cold-start case where humanovo wasn't running and the OS spawned
 * it in response to a `humanovo://...` click. `onOpenUrl` only fires
 * for runtime deliveries; without this, cold-start deep links land
 * the user on /dashboard regardless of where the URL pointed.
 *
 * Returns the first URL (or null) so callers can route once on
 * mount — most launches involve at most one initial URL.
 */
export async function getInitialDeepLink(): Promise<string | null> {
  if (!isNativeApp()) return null
  try {
    const { getCurrent } = await import(/* @vite-ignore */ '@tauri-apps/plugin-deep-link')
    const urls = await getCurrent()
    if (urls && urls.length > 0) return urls[0]
    return null
  } catch (err) {
    console.warn('native.getInitialDeepLink: failed', err)
    return null
  }
}

/**
 * Read the OS / arch the user is running on. Used by the in-app
 * "Send feedback" form so support tickets carry the platform context
 * without the user having to type it in. Returns a stable string so
 * comparisons and analytics aggregations stay consistent.
 */
export async function getPlatform(): Promise<string> {
  if (!isNativeApp()) return 'web'
  const { platform } = await import(/* @vite-ignore */ '@tauri-apps/plugin-os')
  return await platform() // 'macos' | 'windows' | 'linux' | 'ios' | 'android'
}

/**
 * Read whether humanovo is registered to launch on login (Windows
 * registry Run key / macOS LaunchAgent / Linux .desktop autostart).
 * Returns null in web mode where the concept doesn't apply.
 */
export async function getAutostartEnabled(): Promise<boolean | null> {
  if (!isNativeApp()) return null
  try {
    const mod = await import(/* @vite-ignore */ '@tauri-apps/plugin-autostart')
    return await mod.isEnabled()
  } catch (err) {
    console.warn('native.getAutostartEnabled: failed', err)
    return null
  }
}

/**
 * Toggle whether humanovo launches on login. Returns true on success.
 * Failures (insufficient permissions, OS-specific quirks) log + return
 * false so the caller can re-read the actual state.
 */
export async function setAutostartEnabled(enabled: boolean): Promise<boolean> {
  if (!isNativeApp()) return false
  try {
    const mod = await import(/* @vite-ignore */ '@tauri-apps/plugin-autostart')
    if (enabled) {
      await mod.enable()
    } else {
      await mod.disable()
    }
    return true
  } catch (err) {
    console.warn('native.setAutostartEnabled: failed', err)
    return false
  }
}

/**
 * Update the system tray's tooltip text. Used to surface long-running
 * activity (e.g. "humanovo · Discovery running") so the user can
 * glance at the tray without unminimising humanovo.
 *
 * Web mode: no-op. Native mode where the tray didn't initialise (e.g.
 * Linux without dbus, see `setup_tray` in lib.rs): also no-op since
 * `getById` returns null.
 */
export async function setTrayTooltip(tooltip: string): Promise<void> {
  if (!isNativeApp()) return
  try {
    const { TrayIcon } = await import(/* @vite-ignore */ '@tauri-apps/api/tray')
    const tray = await TrayIcon.getById('main')
    if (!tray) return
    await tray.setTooltip(tooltip)
  } catch (err) {
    console.warn('native.setTrayTooltip: failed', err)
  }
}

/**
 * Probe each backend AI provider/model and return a per-model
 * report. Backed by `/admin/ai/health` (admin-only). Settings →
 * Desktop App surfaces the result so admins can verify their
 * Bedrock + Azure secrets reach each model before a discovery run
 * fails on the first LLM call.
 *
 * Returns null for non-admin users (the endpoint 403s) so the
 * caller can hide the surface entirely. We don't want to render
 * "permission denied" chrome to researcher-tier users — they're
 * not the audience for this readout.
 */
export interface AiHealthEntry {
  model: string
  configured: boolean
  reachable: boolean
  latency_ms: number | null
  error: string | null
}

export interface AiHealthReport {
  providers: { bedrock: AiHealthEntry[]; azure: AiHealthEntry[] }
  summary: { total: number; configured: number; reachable: number; down: number }
  cached: boolean
  cache_age_s: number
}

export async function getAiHealth(forceRefresh = false): Promise<AiHealthReport | null> {
  // Caller is responsible for gating this on `user.role === 'admin'`
  // before invoking — the endpoint 403s for non-admins and the global
  // axios interceptor would surface that as a confusing "Request
  // failed" toast. This helper just wraps the call + null-on-error
  // so the consumer can render a "couldn't probe" empty state.
  try {
    const { apiClient } = await import('../services')
    const url = `/admin/ai/health${forceRefresh ? '?force_refresh=true' : ''}`
    const resp = await apiClient.get<AiHealthReport>(url)
    return resp.data
  } catch (err) {
    console.warn('native.getAiHealth: failed', err)
    return null
  }
}

/**
 * Build a one-shot diagnostics block: version, platform, perms, etc.
 *
 * Used by the Settings "Copy diagnostics" affordance so a user filing
 * a support issue can paste a single self-contained block instead of
 * being asked five follow-up questions. Plain text by design — drops
 * cleanly into GitHub Issues, email, or Slack without rendering
 * weirdly.
 *
 * Web mode returns the platform line only (no native fields apply).
 */
export async function getDiagnostics(): Promise<string> {
  // Imported lazily to avoid a cycle if errorLog ever needs to call
  // anything from native.ts. Lazy keeps the option open.
  const [{ recentErrors }, { getToken }, { wasUncleanLastSession }] =
    await Promise.all([
      import('./errorLog'),
      import('../services/auth'),
      import('./lifecycle'),
    ])
  const [version, plat, notifPerm, autostart] = await Promise.all([
    getAppVersion(),
    getPlatform(),
    getNotificationPermission(),
    getAutostartEnabled(),
  ])
  const lines = [
    `humanovo ${version ?? 'web'} · ${plat ?? 'web'}`,
    `User-Agent: ${typeof navigator !== 'undefined' ? navigator.userAgent : 'n/a'}`,
    `Window: ${
      typeof window !== 'undefined'
        ? `${window.innerWidth}×${window.innerHeight}`
        : 'n/a'
    }`,
    `Native: ${isNativeApp() ? 'yes' : 'no'}`,
    `Current path: ${typeof location !== 'undefined' ? location.pathname : 'n/a'}`,
    // Boolean only — never include the JWT or the user's email here.
    // Diagnostics blocks frequently end up in public GitHub issues;
    // PII would leak. "yes/no" is enough for triage to know whether
    // a 401 is "user wasn't logged in" vs "auth was broken".
    `Logged in: ${getToken() ? 'yes' : 'no'}`,
  ]
  const unclean = wasUncleanLastSession()
  if (unclean !== null) {
    // Only surface when we have a definitive answer. null = first
    // launch / cleared storage, which would just be noise.
    lines.push(`Last shutdown: ${unclean ? 'unclean (process killed / panic)' : 'clean'}`)
  }
  if (isNativeApp()) {
    lines.push(`Notifications: ${notifPerm ?? 'unknown'}`)
    lines.push(`Auto-launch: ${autostart === null ? 'unknown' : autostart ? 'on' : 'off'}`)
  }
  const errs = recentErrors()
  if (errs.length > 0) {
    lines.push('')
    lines.push(`Recent errors (last ${errs.length}):`)
    // Most-recent first reads more naturally for someone scanning
    // the bottom of the diagnostics block. Cap message length per
    // line so a giant stack doesn't dominate the paste. `× N` suffix
    // surfaces dedupe count when the same error fired repeatedly.
    for (const e of errs.slice().reverse()) {
      const suffix = e.count && e.count > 1 ? ` × ${e.count}` : ''
      lines.push(
        `  [${e.ts}] ${e.source} @ ${e.url} — ${e.message.slice(0, 200)}${suffix}`,
      )
    }
  }
  return lines.join('\n')
}

/**
 * Read the current OS notification permission for humanovo. Returns
 * 'granted' / 'denied' / 'default' (never asked) / null in web mode.
 *
 * Settings → Desktop App uses this to surface whether discovery-
 * completion notifications will actually fire, since a denied
 * permission is silent failure and users would otherwise wonder why
 * they never got the ping.
 */
export async function getNotificationPermission(): Promise<
  'granted' | 'denied' | 'default' | null
> {
  if (!isNativeApp()) return null
  try {
    const mod = await import(/* @vite-ignore */ '@tauri-apps/plugin-notification')
    const granted = await mod.isPermissionGranted()
    if (granted) return 'granted'
    // Tauri's plugin doesn't distinguish 'denied' from 'never asked'
    // without calling requestPermission. We return 'default' to mean
    // "needs a request" — UI can call notify() to trigger the prompt.
    return 'default'
  } catch (err) {
    console.warn('native.getNotificationPermission: failed', err)
    return null
  }
}

/**
 * Read the bundled native app version (the `version` field from
 * `tauri.conf.json` / `Cargo.toml`). Used by Settings → Desktop App
 * to surface the build the user is running so support tickets can
 * cite a concrete version. Web mode returns null — there's no native
 * binary to version against.
 */
export async function getAppVersion(): Promise<string | null> {
  if (!isNativeApp()) return null
  try {
    const { getVersion } = await import(/* @vite-ignore */ '@tauri-apps/api/app')
    return await getVersion()
  } catch (err) {
    console.warn('native.getAppVersion: failed', err)
    return null
  }
}

/**
 * Fire an OS-native notification (the system tray ping, not an in-app
 * toast). Used for events the user is likely waiting on but isn't
 * actively watching the window for — discovery completion, long agent
 * runs, ingestion finished — so they get a real desktop notification.
 *
 * Permission is requested on first call. The OS surfaces the prompt;
 * if the user denies it, `notify()` silently returns false on every
 * subsequent call. Callers should not depend on the notification
 * actually firing — it's an accelerant, not a contract.
 *
 * Returns true when a notification was dispatched. Web mode and denied
 * permission both return false; callers can fall back to in-app toast.
 *
 * Background-only by default — when humanovo's window already has
 * focus we skip the OS ping (the user can see the in-app toast just
 * fine), so we don't double-notify them. Pass `force: true` to
 * override (rare; only used by tests).
 */
export async function notify(
  title: string,
  body: string,
  opts: { force?: boolean } = {},
): Promise<boolean> {
  if (!isNativeApp()) return false
  if (!opts.force) {
    // The webview's `document.hasFocus()` is true exactly when humanovo
    // is the foreground window. Skip the OS ping in that case — toast
    // is enough.
    if (typeof document !== 'undefined' && document.hasFocus()) return false
  }
  try {
    const mod = await import(/* @vite-ignore */ '@tauri-apps/plugin-notification')
    let granted = await mod.isPermissionGranted()
    if (!granted) {
      const result = await mod.requestPermission()
      granted = result === 'granted'
    }
    if (!granted) return false
    await mod.sendNotification({ title, body })
    return true
  } catch (err) {
    console.warn('native.notify: dispatch failed', err)
    return false
  }
}
