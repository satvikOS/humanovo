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
import { markClean } from '../lib/lifecycle'

export default function CloseGuardManager() {
  useEffect(() => {
    if (!isNativeApp()) return

    let cancelled = false
    let unlisten: (() => void) | null = null

    // Force-exit helper. Lazy-imported so web-only builds don't pull
    // it in. Calling exit(0) here is a renderer-side belt over the
    // Rust-side CloseRequested/Destroyed handlers in lib.rs — users
    // reported humanovo hanging in the tray after X click on Windows;
    // adding a JS exit guarantees the process terminates the moment
    // the close-guard's prevention chain falls through to "let it
    // close".
    const forceExit = async () => {
      try {
        const { exit } = await import('@tauri-apps/plugin-process')
        await exit(0)
      } catch (err) {
        console.warn('CloseGuardManager: forceExit failed', err)
      }
    }

    void (async () => {
      try {
        const winMod = await import('@tauri-apps/api/window')
        const w = winMod.getCurrentWindow()
        const handler = await w.onCloseRequested(async (event) => {
          const reasons = currentGuards()
          if (reasons.length === 0) {
            // Nothing to guard. Stamp the clean-shutdown marker, then
            // explicitly exit the process. Don't rely on Tauri's
            // default destroy chain to terminate the runtime — the
            // single-instance plugin keeps the runtime alive after
            // window destroy on Windows, which left users with a
            // zombie humanovo that only Task Manager could end.
            markClean()
            await forceExit()
            return
          }

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
            // User confirmed. Force-exit (don't bother with destroy +
            // wait — the plugin-process exit terminates the runtime
            // immediately, which is what the user just signalled they
            // wanted by clicking "Quit anyway").
            markClean()
            await forceExit()
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
