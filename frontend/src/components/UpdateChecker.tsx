/**
 * UpdateChecker — silently checks for app updates on launch and
 * surfaces a non-blocking banner when one is available.
 *
 * The Tauri shell ships every push to `humanovo` as a tagged GitHub
 * Release with a `latest.json` manifest the updater plugin reads
 * (see `.github/workflows/build-native-apps.yml` + the
 * `tauri-plugin-updater` config injected by
 * `scripts/configure_tauri_updater.py`). Until this component
 * existed, the plugin was loaded but never invoked — installed apps
 * would only update if the user manually re-downloaded the
 * installer.
 *
 * UX flow:
 *   1. App launches.
 *   2. After a 3 s grace (so the user hits the dashboard / does
 *      whatever they wanted to do FIRST, not block on a network
 *      check), call `check()`.
 *   3. If an update exists, render a small bottom-right banner with
 *      the new version number + a "Restart to install" CTA.
 *   4. CTA triggers `downloadAndInstall()` then `relaunch()`. The
 *      installed app exits and the new version starts.
 *   5. User dismisses the banner → snooze for the rest of the
 *      session; we'll re-check on next launch.
 *
 * Native-only via `isNativeApp()`. Web mode is a no-op.
 *
 * The banner deliberately doesn't auto-install. Forced restarts
 * mid-discovery would be miserable; the user picks the moment.
 */

import { useEffect, useState } from 'react'
import { isNativeApp, notify } from '../lib/native'

interface UpdateInfo {
  version: string
  body?: string
}

const SNOOZE_KEY = 'humanovo.update.snoozed-version'


export default function UpdateChecker() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isNativeApp()) return
    let cancelled = false

    const t = window.setTimeout(async () => {
      try {
        const updaterMod = await import('@tauri-apps/plugin-updater')
        const u = await updaterMod.check()
        if (cancelled || !u) return
        // Honour a per-version snooze so the user doesn't see the
        // banner repeatedly within a single session if they
        // dismissed it.
        const snoozed = sessionStorage.getItem(SNOOZE_KEY)
        if (snoozed === u.version) return
        setUpdate({ version: u.version, body: u.body })
        // Ping the OS as well so the user notices if humanovo isn't
        // focused at the 3 s mark — they probably already tabbed away.
        // notify() no-ops when the window has focus (in-app banner is
        // enough then) and in web mode.
        void notify(
          'humanovo update available',
          `Version ${u.version} is ready to install. Open humanovo and click Restart to install.`,
        )
      } catch (err) {
        // Swallow + log. Update-check failures are silent UX —
        // we'd rather miss an update than nag the user with an
        // error toast about something they didn't ask for.
        console.warn('UpdateChecker: check() failed', err)
      }
    }, 3_000)

    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [])

  const install = async () => {
    if (!update) return
    setInstalling(true)
    setError(null)
    try {
      const updaterMod = await import('@tauri-apps/plugin-updater')
      const processMod = await import('@tauri-apps/plugin-process')
      // Re-check to get the live Update handle (the previous one
      // came from the launch-time check; the resource may already
      // be released by Tauri's GC). The double-check round-trip is
      // ~100 ms on a warm cache.
      const u = await updaterMod.check()
      if (!u) {
        setUpdate(null)
        setInstalling(false)
        return
      }
      await u.downloadAndInstall()
      await processMod.relaunch()
      // relaunch() doesn't return — the binary exits and the new
      // version starts. The reset below covers the unlikely path
      // where relaunch fails silently.
      setInstalling(false)
    } catch (err) {
      setInstalling(false)
      setError(err instanceof Error ? err.message : 'Update install failed')
    }
  }

  const snooze = () => {
    if (update) sessionStorage.setItem(SNOOZE_KEY, update.version)
    setUpdate(null)
  }

  if (!update) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-40 max-w-sm rounded-lg shadow-lg p-4"
      style={{
        background: 'var(--color-surface-solid)',
        border: '1px solid var(--color-border)',
        color: 'var(--color-text)',
      }}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="text-sm font-semibold">Update available</div>
        <button
          type="button"
          onClick={snooze}
          aria-label="Dismiss update notification"
          className="text-xs opacity-60 hover:opacity-100 disabled:opacity-30"
          style={{ color: 'var(--color-text-muted)' }}
          disabled={installing}
        >
          Later
        </button>
      </div>
      <p className="text-xs mb-3" style={{ color: 'var(--color-text-muted)' }}>
        humanovo {update.version} is ready to install. The app will restart
        once the download finishes.
      </p>
      {error && (
        <p className="text-xs mb-3" style={{ color: 'var(--color-error, #ef4444)' }}>
          {error}
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={install}
          disabled={installing}
          className="text-xs px-3 py-1.5 rounded-md disabled:opacity-50 active:scale-95"
          style={{
            background: 'var(--color-text)',
            color: 'var(--color-bg)',
            fontWeight: 500,
          }}
        >
          {installing ? 'Installing…' : 'Restart to install'}
        </button>
      </div>
    </div>
  )
}
