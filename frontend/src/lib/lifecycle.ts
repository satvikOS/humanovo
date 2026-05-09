/**
 * lifecycle — detect whether humanovo's previous session ended cleanly.
 *
 * Why: errorLog only captures things `window.onerror` /
 * `unhandledrejection` / React error boundaries can see. A Rust-side
 * panic, an OOM kill, or a `kill -9` from the OS bypasses all of
 * those — the user just sees humanovo disappear. With this module,
 * the next launch can surface "Last shutdown: unclean" in the
 * diagnostics block, so support knows the crash was at the process
 * level, not in the React app.
 *
 * Mechanism:
 *   1. On module load, read the prior session's flag (clean / running /
 *      missing) and stash whether *that* state was unclean.
 *   2. Set the flag to 'running' so a crash mid-session leaves it
 *      stuck on 'running' — which we read as "unclean" next launch.
 *   3. On a clean shutdown (CloseGuardManager confirm path) call
 *      `markClean()` so the next launch reads 'clean' and we skip
 *      the unclean-shutdown line.
 *
 * The flag is in localStorage so it survives across launches without
 * touching Rust state files. False positives are possible if the
 * user has multiple humanovo windows (we don't), or if storage is
 * cleared between sessions (rare).
 */

const KEY = 'humanovo.shutdownState'

type State = 'clean' | 'running' | null

function read(): State {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(KEY)
    if (raw === 'clean' || raw === 'running') return raw
    return null
  } catch {
    return null
  }
}

function write(state: 'clean' | 'running'): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(KEY, state)
  } catch {
    /* storage disabled — degraded but not fatal */
  }
}

// Captured at module load; subsequent reads of the flag would all
// return 'running' (since installLifecycle sets it). Cache the prior
// value so it's queryable for the lifetime of the session.
let priorWasUnclean: boolean | null = null

/**
 * Snapshot the prior-session flag and arm the current session.
 * Idempotent — call once at app startup. Subsequent calls are no-ops
 * so React.StrictMode's double-invoke doesn't break the snapshot.
 */
let installed = false
export function installLifecycle(): void {
  if (installed) return
  installed = true
  const prior = read()
  // 'running' = previous session never wrote 'clean' before exiting.
  // null = first launch / cleared storage; treat as unknown rather
  // than unclean since we can't tell.
  priorWasUnclean = prior === 'running'
  write('running')
}

/**
 * Mark the current session as cleanly shutting down. Called from the
 * CloseGuardManager confirm path before window destroy, so the next
 * launch reads 'clean' instead of being treated as a crash.
 */
export function markClean(): void {
  write('clean')
}

/**
 * Did the previous session exit uncleanly (process killed, Rust
 * panic, OOM)? Returns null on first launch / unknown, true on
 * detected unclean exit, false on detected clean exit.
 *
 * Reads the snapshot taken at `installLifecycle` time so a caller
 * doesn't see the current-session marker.
 */
export function wasUncleanLastSession(): boolean | null {
  return priorWasUnclean
}
