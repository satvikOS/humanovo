/**
 * Typed localStorage persistence layer for humanovo.
 * All user data persists across sessions — projects, evidence, notebooks, workspace.
 */
// @ts-ignore — types provided by @types/react at install time
import { useState, useCallback, useEffect, useRef } from 'react'

const PREFIX = 'humanovo-'

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
  } catch (e) {
    console.warn('localStorage write failed:', e)
  }
}

export function persistRemove(key: string): void {
  localStorage.removeItem(PREFIX + key)
}

/**
 * React hook: useState backed by localStorage.
 * On mount reads from localStorage; on every setState writes back.
 */
export function usePersistentState<T>(key: string, initialValue: T): [T, (value: T | ((prev: T) => T)) => void] {
  const [state, setStateRaw] = useState<T>(() => persistGet(key, initialValue))
  const keyRef = useRef(key)
  keyRef.current = key

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
  const activities = persistGet<ActivityEntry[]>('activity-log', [])
  activities.unshift({
    ...entry,
    id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
  })
  persistSet('activity-log', activities.slice(0, MAX_ACTIVITY))
}

export function getActivityLog(): ActivityEntry[] {
  return persistGet<ActivityEntry[]>('activity-log', [])
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
