/**
 * Typed localStorage persistence layer for humanovo.
 * All user data persists across sessions — projects, evidence, notebooks, workspace.
 * Syncs to backend API for cross-device consistency.
 */
// @ts-ignore — types provided by @types/react at install time
import { useState, useCallback, useEffect, useRef } from 'react'

const PREFIX = 'humanovo-'

// Backend API base URL — same as the main API
const API_BASE = (import.meta as any).env?.VITE_API_BASE_URL || ''

// Keys that should be synced to the backend for cross-device access
const SYNCED_KEYS = new Set([
  'experiments',
  'mc-simulations',
  'eq-history',
  'comp-history',
  'activity-log',
  'notebook-index',
  'workspace-tabs',
  'workspace-active-tab',
])

// Debounce timers for backend sync
const _syncTimers: Record<string, ReturnType<typeof setTimeout>> = {}
const _syncInFlight: Set<string> = new Set()

/**
 * Push a key's value to the backend API (fire-and-forget, debounced).
 */
function syncToBackend(key: string, value: unknown): void {
  if (!SYNCED_KEYS.has(key)) return

  // Debounce: wait 1s after last write before syncing
  if (_syncTimers[key]) clearTimeout(_syncTimers[key])
  _syncTimers[key] = setTimeout(async () => {
    if (_syncInFlight.has(key)) return
    _syncInFlight.add(key)
    try {
      await fetch(`${API_BASE}/api/v1/user-state/${encodeURIComponent(key)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      })
    } catch {
      // Backend unavailable — localStorage is the source of truth
    } finally {
      _syncInFlight.delete(key)
    }
  }, 1000)
}

/**
 * Pull a key's value from the backend API. Returns null if unavailable.
 */
async function syncFromBackend<T>(key: string): Promise<T | null> {
  if (!SYNCED_KEYS.has(key)) return null
  try {
    const res = await fetch(`${API_BASE}/api/v1/user-state/${encodeURIComponent(key)}`)
    if (!res.ok) return null
    const data = await res.json()
    return (data.value ?? null) as T
  } catch {
    return null
  }
}

/**
 * Initial sync: pull all synced keys from backend on app startup.
 * Merges with localStorage (backend wins for newer data).
 */
let _initialSyncDone = false
const _initialSyncPromise: Promise<void> = (async () => {
  if (_initialSyncDone) return
  try {
    const res = await fetch(`${API_BASE}/api/v1/user-state`)
    if (!res.ok) return
    const data = await res.json()
    const remoteKeys = (data.items || []) as Array<{ key: string; updated_at: string }>

    for (const { key, updated_at } of remoteKeys) {
      if (!SYNCED_KEYS.has(key)) continue
      const localRaw = localStorage.getItem(PREFIX + key)
      const localTimestamp = localStorage.getItem(PREFIX + key + '-sync-ts')

      // If backend is newer or local doesn't exist, pull from backend
      if (!localRaw || !localTimestamp || new Date(updated_at) > new Date(localTimestamp)) {
        const remoteValue = await syncFromBackend(key)
        if (remoteValue !== null) {
          localStorage.setItem(PREFIX + key, JSON.stringify(remoteValue))
          localStorage.setItem(PREFIX + key + '-sync-ts', updated_at)
        }
      }
    }
  } catch {
    // Backend unavailable — use localStorage as-is
  } finally {
    _initialSyncDone = true
  }
})()

export function persistGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (raw === null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function persistSet<T>(key: string, value: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
    localStorage.setItem(PREFIX + key + '-sync-ts', new Date().toISOString())
  } catch (e) {
    console.warn('localStorage write failed:', e)
  }
  // Sync to backend for cross-device access
  syncToBackend(key, value)
}

export function persistRemove(key: string): void {
  localStorage.removeItem(PREFIX + key)
  localStorage.removeItem(PREFIX + key + '-sync-ts')
  // Also remove from backend
  if (SYNCED_KEYS.has(key)) {
    fetch(`${API_BASE}/api/v1/user-state/${encodeURIComponent(key)}`, { method: 'DELETE' }).catch(() => {})
  }
}

/**
 * React hook: useState backed by localStorage + backend sync.
 * On mount reads from localStorage; on every setState writes back and syncs.
 */
export function usePersistentState<T>(key: string, initialValue: T): [T, (value: T | ((prev: T) => T)) => void] {
  const [state, setStateRaw] = useState<T>(() => persistGet(key, initialValue))
  const keyRef = useRef(key)
  keyRef.current = key
  const mountedRef = useRef(false)

  // On mount, try to pull from backend if newer
  useEffect(() => {
    let cancelled = false
    if (SYNCED_KEYS.has(key)) {
      _initialSyncPromise.then(() => {
        if (cancelled) return
        // Re-read from localStorage after sync completes
        const synced = persistGet(key, initialValue)
        const currentRaw = JSON.stringify(state)
        const syncedRaw = JSON.stringify(synced)
        if (currentRaw !== syncedRaw) {
          setStateRaw(synced)
        }
        mountedRef.current = true
      })
    } else {
      mountedRef.current = true
    }
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    persistSet(keyRef.current, state)
  }, [state])

  const setState = useCallback((value: T | ((prev: T) => T)) => {
    setStateRaw(value)
  }, [])

  return [state, setState]
}

/**
 * Activity logger — records user actions for Timeline page.
 */
export interface ActivityEntry {
  id: string
  type: 'project' | 'hypothesis' | 'evidence' | 'simulation' | 'notebook' | 'discovery'
  action: 'created' | 'updated' | 'completed' | 'validated' | 'rejected' | 'imported' | 'started' | 'deleted'
  title: string
  project?: string
  timestamp: string
  metadata?: Record<string, unknown>
}

const MAX_ACTIVITY = 500

export function logActivity(entry: Omit<ActivityEntry, 'id' | 'timestamp'>): void {
  const now = new Date().toISOString()
  const activities = persistGet<ActivityEntry[]>('activity-log', [])
  activities.unshift({
    ...entry,
    id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: now,
    created_at: now,
  } as ActivityEntry & { created_at: string })
  persistSet('activity-log', activities.slice(0, MAX_ACTIVITY))
}

export function getActivityLog(): ActivityEntry[] {
  return persistGet<ActivityEntry[]>('activity-log', [])
}

/**
 * Sanitize a numeric value — returns `fallback` if the value is NaN, null, undefined, or not a finite number.
 */
export function safeNum(val: unknown, fallback = 0): number {
  if (val == null) return fallback
  const n = typeof val === 'number' ? val : Number(val)
  return Number.isFinite(n) ? n : fallback
}

/**
 * Format a percentage value safely — returns formatted string like "73%" or fallback string.
 */
export function safePct(val: unknown, decimals = 0, fallback = '--'): string {
  const n = safeNum(val, NaN)
  if (!Number.isFinite(n)) return fallback
  return `${(n * 100).toFixed(decimals)}%`
}

/**
 * Format a dollar amount from cents safely.
 */
export function safeDollars(cents: unknown): string {
  const n = safeNum(cents, 0)
  return `$${(n / 100).toFixed(2)}`
}

/**
 * Format a date string or Date to MM/DD/YYYY format.
 */
export function formatDate(date: string | Date | undefined | null): string {
  if (!date) return ''
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return ''
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const year = d.getFullYear()
  return `${month}/${day}/${year}`
}

/**
 * Format a date string or Date to MM/DD/YYYY with time (HH:MM AM/PM).
 */
export function formatDateTime(date: string | Date | undefined | null): string {
  if (!date) return ''
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return ''
  const dateStr = formatDate(d)
  const hours = d.getHours()
  const mins = String(d.getMinutes()).padStart(2, '0')
  const ampm = hours >= 12 ? 'PM' : 'AM'
  const h12 = hours % 12 || 12
  return `${dateStr} ${h12}:${mins} ${ampm}`
}
