/**
 * CloseGuardManager — intercepts the native window's close request
 * when the closeGuard registry has any reasons, and asks the user to
 * confirm before letting humanovo exit.
 *
 * Why bother: long-running surfaces (active discovery, in-flight agent
 * call) would lose minutes of work + accumulated cost if the user
 * accidentally hits the X. Web mode is a no-op — the browser already
 * runs its own beforeunload prompt; we don't need a parallel one.
 *
 * Renderless. Mount once at app root.
 *
 * The lazy `import('@tauri-apps/plugin-dialog')` mirrors the lazy
 * pattern in `lib/native.ts` so a web-only Vite build doesn't have to
 * bundle Tauri internals.
 */

import { useEffect } from 'react'
import { isNativeApp } from '../lib/native'
import { currentGuards } from '../lib/closeGuard'

export default function CloseGuardManager() {
  useEffect(() => {
    if (!isNativeApp()) return

    let cancelled = false
    let unlisten: (() => void) | null = null

    void (async () => {
      try {
        const winMod = await import('@tauri-apps/api/window')
        const w = winMod.getCurrentWindow()
        const handler = await w.onCloseRequested(async (event) => {
          const reasons = currentGuards()
          if (reasons.length === 0) return // nothing to guard, let it close

          // Block the close immediately, then ask. preventDefault must
          // run synchronously on the event before any await — Tauri's
          // contract is the same as the DOM beforeunload event.
          event.preventDefault()

          const dialogMod = await import('@tauri-apps/plugin-dialog')
          const message =
            reasons.length === 1
              ? `${reasons[0]}. Quitting now will lose this run's progress.`
              : `${reasons.length} tasks are still running (e.g. ${reasons[0]}). Quitting now will lose their progress.`
          const ok = await dialogMod.ask(message, {
            title: 'Quit humanovo?',
            kind: 'warning',
            okLabel: 'Quit anyway',
            cancelLabel: 'Stay',
          })
          if (ok && !cancelled) {
            // User confirmed. Re-issue the close — the handler reads
            // currentGuards() afresh, but since they explicitly said
            // "quit anyway" we just trigger destroy directly.
            await w.destroy()
          }
        })
        if (cancelled) {
          handler()
          return
        }
        unlisten = handler
      } catch (err) {
        console.warn('CloseGuardManager: failed to attach handler', err)
      }
    })()

    return () => {
      cancelled = true
      if (unlisten) unlisten()
    }
  }, [])

  return null
}
