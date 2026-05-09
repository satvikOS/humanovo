/**
 * closeGuard — module-level registry of "don't quit yet" reasons.
 *
 * Long-running surfaces (DiscoveryRunner, Agents while a discovery is
 * active, etc.) call `register()` to record that quitting now would
 * cost the user real work, and call the returned unregister function
 * when the work is done.
 *
 * The CloseGuardManager component mounts at app root, listens for the
 * native window's close-requested event, and consults this registry to
 * decide whether to actually let the close go through. We keep the
 * registry decoupled from React state because the close handler runs
 * outside the React tree and needs to query the latest value
 * synchronously — re-rendering the manager on every guard change just
 * to update a ref would be silly.
 */

const guards = new Map<symbol, string>()

/**
 * Register a "don't quit" reason. Returns an unregister function the
 * caller MUST invoke when the guarded work finishes — usually via a
 * useEffect cleanup.
 *
 * Multiple guards are supported (e.g. two parallel discoveries); the
 * close handler shows the count + the first reason as a representative
 * example. Reasons should be short user-facing fragments — e.g.
 * "Discovery is running" — that read naturally in a confirm dialog
 * sentence.
 */
export function register(reason: string): () => void {
  const key = Symbol('closeGuard')
  guards.set(key, reason)
  return () => {
    guards.delete(key)
  }
}

/**
 * Snapshot of the currently-registered reasons. Returned as a fresh
 * array so callers can't mutate the registry. The close handler reads
 * this on the close-request callback to compose the confirm-dialog
 * message.
 */
export function currentGuards(): string[] {
  return Array.from(guards.values())
}
