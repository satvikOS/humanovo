/**
 * Typed localStorage persistence layer for humanovo.
 * All user data persists across sessions — projects, evidence, notebooks, workspace.
 * Syncs to backend API for cross-device consistency with ID-based array merging.
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
  'charts',
  'research-papers',
  'tab-counter',
  'citations',
  'project-documents',
])

// Keys whose values are arrays of objects with an `id` field — these get merged
// instead of last-write-wins so data from multiple devices is combined.
const ARRAY_MERGE_KEYS = new Set([
  'experiments',
  'mc-simulations',
  'eq-history',
  'comp-history',
  'activity-log',
  'notebook-index',
  'workspace-tabs',
  'charts',
  'research-papers',
  'citations',
  'project-documents',
])

// Max items per key (to prevent unbounded growth after merging)
const MAX_ITEMS: Record<string, number> = {
  'activity-log': 500,
  'eq-history': 50,
  'comp-history': 50,
}

// Debounce timers for backend sync
const _syncTimers: Record<string, ReturnType<typeof setTimeout>> = {}
const _syncInFlight: Set<string> = new Set()

/**
 * Merge two arrays by `id` field. Items from `incoming` that don't exist in
 * `existing` are added. Items that exist in both keep the newer version
 * (by `updatedAt`, `updated_at`, `createdAt`, or `timestamp` field).
 * Returns the merged array sorted newest-first.
 */
function mergeArraysById(existing: any[], incoming: any[]): any[] {
  const map = new Map<string, any>()

  const getTime = (item: any): number => {
    const ts = item.updatedAt || item.updated_at || item.createdAt || item.timestamp || item.created_at || ''
    return ts ? new Date(ts).getTime() : 0
  }

  // Add existing items
  for (const item of existing) {
    if (item && item.id) {
      map.set(item.id, item)
    }
  }

  // Merge incoming — keep newer version if same id exists
  for (const item of incoming) {
    if (!item || !item.id) continue
    const prev = map.get(item.id)
    if (!prev || getTime(item) >= getTime(prev)) {
      map.set(item.id, item)
    }
  }

  // Sort newest first
  const merged = Array.from(map.values())
  merged.sort((a, b) => getTime(b) - getTime(a))
  return merged
}

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
 * Sync a single key from backend, merging arrays by ID.
 * Returns true if local data was updated.
 */
async function syncKeyFromBackend(key: string): Promise<boolean> {
  const remoteValue = await syncFromBackend(key)
  if (remoteValue === null) return false

  const localRaw = localStorage.getItem(PREFIX + key)
  let localValue: any = null
  try { localValue = localRaw ? JSON.parse(localRaw) : null } catch { /* */ }

  let merged: any
  if (ARRAY_MERGE_KEYS.has(key) && Array.isArray(remoteValue)) {
    const localArr = Array.isArray(localValue) ? localValue : []
    merged = mergeArraysById(localArr, remoteValue)
    const max = MAX_ITEMS[key]
    if (max && merged.length > max) merged = merged.slice(0, max)
  } else {
    // Scalar/object: remote wins
    merged = remoteValue
  }

  const mergedRaw = JSON.stringify(merged)
  if (mergedRaw !== localRaw) {
    localStorage.setItem(PREFIX + key, mergedRaw)
    localStorage.setItem(PREFIX + key + '-sync-ts', new Date().toISOString())
    return true
  }
  return false
}

/**
 * Initial sync: pull all synced keys from backend on app startup.
 * Uses ID-based merging for arrays so no data is lost.
 */
let _initialSyncDone = false
const _initialSyncPromise: Promise<void> = (async () => {
  if (_initialSyncDone) return
  try {
    const res = await fetch(`${API_BASE}/api/v1/user-state`)
    if (!res.ok) return
    const data = await res.json()
    const remoteKeys = (data.items || []) as Array<{ key: string; updated_at: string }>

    for (const { key } of remoteKeys) {
      if (!SYNCED_KEYS.has(key)) continue
      await syncKeyFromBackend(key)
    }

    // After pulling remote data, push any local-only keys that don't exist on backend
    const remoteKeySet = new Set(remoteKeys.map((r: any) => r.key))
    for (const key of SYNCED_KEYS) {
      if (remoteKeySet.has(key)) continue
      const localRaw = localStorage.getItem(PREFIX + key)
      if (localRaw) {
        try {
          syncToBackend(key, JSON.parse(localRaw))
        } catch { /* */ }
      }
    }
  } catch {
    // Backend unavailable — use localStorage as-is
  } finally {
    _initialSyncDone = true
  }
})()

// ── Periodic background sync ──────────────────────────────────────
// Every 30s, pull changes from backend so data from other devices appears
// without requiring a page reload.

const _syncListeners = new Set<(key: string) => void>()

let _periodicSyncInterval: ReturnType<typeof setInterval> | null = null

function startPeriodicSync() {
  if (_periodicSyncInterval) return
  _periodicSyncInterval = setInterval(async () => {
    if (!_initialSyncDone) return
    try {
      const res = await fetch(`${API_BASE}/api/v1/user-state`)
      if (!res.ok) return
      const data = await res.json()
      const remoteKeys = (data.items || []) as Array<{ key: string; updated_at: string }>

      for (const { key, updated_at } of remoteKeys) {
        if (!SYNCED_KEYS.has(key)) continue
        const localTs = localStorage.getItem(PREFIX + key + '-sync-ts')
        // Only sync if remote is newer than our last sync
        if (localTs && new Date(updated_at) <= new Date(localTs)) continue

        const changed = await syncKeyFromBackend(key)
        if (changed) {
          // Notify any mounted usePersistentState hooks to re-read
          for (const listener of _syncListeners) {
            listener(key)
          }
        }
      }
    } catch {
      // Backend unavailable — skip this cycle
    }
  }, 30_000)
}

// Start periodic sync once initial sync completes
_initialSyncPromise.then(() => startPeriodicSync())

// ── Public API ────────────────────────────────────────────────────

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
 * Automatically re-reads when periodic sync detects changes from other devices.
 */
export function usePersistentState<T>(key: string, initialValue: T): [T, (value: T | ((prev: T) => T)) => void] {
  const [state, setStateRaw] = useState<T>(() => persistGet(key, initialValue))
  const keyRef = useRef(key)
  keyRef.current = key
  const initialValueRef = useRef(initialValue)
  const skipNextPersist = useRef(false)

  // On mount, wait for initial sync then re-read merged data
  useEffect(() => {
    let cancelled = false
    if (SYNCED_KEYS.has(key)) {
      _initialSyncPromise.then(() => {
        if (cancelled) return
        const synced = persistGet(key, initialValue)
        const currentRaw = JSON.stringify(state)
        const syncedRaw = JSON.stringify(synced)
        if (currentRaw !== syncedRaw) {
          skipNextPersist.current = true
          setStateRaw(synced)
        }
      })
    }
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for periodic sync updates from other devices
  useEffect(() => {
    if (!SYNCED_KEYS.has(key)) return

    const listener = (changedKey: string) => {
      if (changedKey !== keyRef.current) return
      const updated = persistGet(keyRef.current, initialValueRef.current)
      skipNextPersist.current = true
      setStateRaw(updated)
    }
    _syncListeners.add(listener)
    return () => { _syncListeners.delete(listener) }
  }, [key])

  // Persist to localStorage + backend on state change
  useEffect(() => {
    if (skipNextPersist.current) {
      skipNextPersist.current = false
      return
    }
    persistSet(keyRef.current, state)
  }, [state])

  const setState = useCallback((value: T | ((prev: T) => T)) => {
    setStateRaw(value)
  }, [])

  return [state, setState]
}

// ── IndexedDB for large blobs (documents, PDFs) ──────────────────

const IDB_NAME = 'humanovo-blobs'
const IDB_STORE = 'files'
const IDB_VERSION = 1

function openBlobDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function blobPut(key: string, data: string): Promise<void> {
  const db = await openBlobDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).put(data, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function blobGet(key: string): Promise<string | null> {
  const db = await openBlobDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly')
    const req = tx.objectStore(IDB_STORE).get(key)
    req.onsuccess = () => resolve(req.result ?? null)
    req.onerror = () => reject(req.error)
  })
}

export async function blobDelete(key: string): Promise<void> {
  const db = await openBlobDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// ── Activity Logger ───────────────────────────────────────────────

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

// ── Numeric / formatting utilities ────────────────────────────────

export function safeNum(val: unknown, fallback = 0): number {
  if (val == null) return fallback
  const n = typeof val === 'number' ? val : Number(val)
  return Number.isFinite(n) ? n : fallback
}

export function safePct(val: unknown, decimals = 0, fallback = '--'): string {
  const n = safeNum(val, NaN)
  if (!Number.isFinite(n)) return fallback
  return `${(n * 100).toFixed(decimals)}%`
}

export function safeDollars(cents: unknown): string {
  const n = safeNum(cents, 0)
  return `$${(n / 100).toFixed(2)}`
}

export function formatDate(date: string | Date | undefined | null): string {
  if (!date) return ''
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return ''
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const year = d.getFullYear()
  return `${month}/${day}/${year}`
}

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
