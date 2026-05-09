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
