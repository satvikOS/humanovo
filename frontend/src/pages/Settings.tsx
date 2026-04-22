import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  FiSettings,
  FiUser,
  FiMoon,
  FiSun,
  FiBell,
  FiShield,
  FiDatabase,
  FiGlobe,
  FiMonitor,
  FiChevronRight,
  FiCheck
} from 'react-icons/fi'
import clsx from 'clsx'
import { useTheme } from '../contexts/ThemeContext'
import api from '../services/api'

const SETTINGS_KEY = 'humanovo-appearance-settings'

interface AppearancePrefs {
  fontSize: string
  compactMode: boolean
  animations: boolean
}

function loadAppearancePrefs(): AppearancePrefs {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY)
    if (stored) return JSON.parse(stored)
  } catch { /* ignore */ }
  return { fontSize: 'medium', compactMode: false, animations: true }
}

function saveAppearancePrefs(prefs: AppearancePrefs) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(prefs))
}

function applyAppearancePrefs(prefs: AppearancePrefs) {
  const root = document.documentElement
  const fontSizeMap: Record<string, string> = { small: '13px', medium: '14px', large: '16px' }
  root.style.fontSize = fontSizeMap[prefs.fontSize] || '14px'
  document.body.classList.toggle('compact-mode', prefs.compactMode)
  root.style.setProperty('--animation-duration', prefs.animations ? '200ms' : '0ms')
}

// Apply on initial load
applyAppearancePrefs(loadAppearancePrefs())

// Admin section is surfaced at render-time only when the backend
// reports environment=development. Done in the component below via
// live /admin/kg-stats check.
const BASE_SETTINGS_SECTIONS = [
  { id: 'appearance', label: 'Appearance', icon: FiMonitor },
  { id: 'account', label: 'Account', icon: FiUser },
  { id: 'notifications', label: 'Notifications', icon: FiBell },
  { id: 'privacy', label: 'Privacy & Security', icon: FiShield },
  { id: 'data', label: 'Data & Storage', icon: FiDatabase },
  { id: 'integrations', label: 'Integrations', icon: FiGlobe },
]
const ADMIN_SECTION = { id: 'admin', label: 'Admin · Seed demo data', icon: FiDatabase }

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!enabled)}
      className={clsx(
        'relative w-9 h-5 rounded-full transition-colors',
        enabled ? 'bg-[var(--color-text)]' : 'bg-white/10'
      )}
    >
      <span
        className={clsx(
          'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
          enabled ? 'translate-x-4' : 'translate-x-0.5'
        )}
      />
    </button>
  )
}

function SettingRow({ title, description, children }: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between py-3 border-b border-[var(--color-border)] last:border-0">
      <div className="flex-1 pr-4">
        <div className="text-sm font-medium">{title}</div>
        {description && (
          <div className="text-xs text-[var(--color-text-muted)] mt-0.5">{description}</div>
        )}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  )
}

function AppearanceSettings() {
  const { theme, setTheme } = useTheme()
  const [prefs, setPrefs] = useState<AppearancePrefs>(loadAppearancePrefs)

  const updatePref = useCallback(<K extends keyof AppearancePrefs>(key: K, value: AppearancePrefs[K]) => {
    setPrefs(prev => {
      const next = { ...prev, [key]: value }
      saveAppearancePrefs(next)
      applyAppearancePrefs(next)
      return next
    })
  }, [])

  const fontSize = prefs.fontSize
  const setFontSize = (v: string) => updatePref('fontSize', v)
  const compactMode = prefs.compactMode
  const setCompactMode = (v: boolean) => updatePref('compactMode', v)
  const animations = prefs.animations
  const setAnimations = (v: boolean) => updatePref('animations', v)

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-medium mb-4">Theme</h3>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setTheme('dark')}
            className={clsx(
              'relative p-4 rounded-lg border-2 transition-colors text-left',
              theme === 'dark'
                ? 'border-[var(--color-text)] bg-[var(--color-surface-raised)]'
                : 'border-[var(--color-border)] hover:border-white/10'
            )}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 rounded-lg bg-black flex items-center justify-center">
                <FiMoon className="w-4 h-4 text-white" />
              </div>
              <div>
                <div className="text-sm font-medium">Dark</div>
                <div className="text-xxs text-[var(--color-text-muted)]">OLED Black</div>
              </div>
            </div>
            <div className="h-12 rounded bg-black border border-white/5 flex overflow-hidden">
              <div className="w-8 bg-[#0a0a0a] border-r border-white/5" />
              <div className="flex-1 p-1">
                <div className="h-1.5 w-12 bg-white/10 rounded mb-1" />
                <div className="h-1 w-8 bg-white/5 rounded" />
              </div>
            </div>
            {theme === 'dark' && (
              <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-[var(--color-text)] flex items-center justify-center">
                <FiCheck className="w-3 h-3" style={{ color: 'var(--color-bg)' }} />
              </div>
            )}
          </button>

          <button
            onClick={() => setTheme('light')}
            className={clsx(
              'relative p-4 rounded-lg border-2 transition-colors text-left',
              theme === 'light'
                ? 'border-[var(--color-text)] bg-[var(--color-surface-raised)]'
                : 'border-[var(--color-border)] hover:border-white/10'
            )}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center">
                <FiSun className="w-4 h-4 text-gray-700" />
              </div>
              <div>
                <div className="text-sm font-medium">Light</div>
                <div className="text-xxs text-[var(--color-text-muted)]">Clean Grey</div>
              </div>
            </div>
            <div className="h-12 rounded bg-gray-100 border border-gray-200 flex overflow-hidden">
              <div className="w-8 bg-white border-r border-gray-200" />
              <div className="flex-1 p-1">
                <div className="h-1.5 w-12 bg-gray-300 rounded mb-1" />
                <div className="h-1 w-8 bg-gray-200 rounded" />
              </div>
            </div>
            {theme === 'light' && (
              <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-[var(--color-text)] flex items-center justify-center">
                <FiCheck className="w-3 h-3" style={{ color: 'var(--color-bg)' }} />
              </div>
            )}
          </button>
        </div>
      </div>

      <div>
        <h3 className="text-base font-medium mb-4">Display</h3>
        <div className="glass-card">
          <SettingRow
            title="Font Size"
            description="Adjust the base font size throughout the application"
          >
            <select
              value={fontSize}
              onChange={e => setFontSize(e.target.value)}
              className="input text-xs"
            >
              <option value="small">Small</option>
              <option value="medium">Medium</option>
              <option value="large">Large</option>
            </select>
          </SettingRow>

          <SettingRow
            title="Compact Mode"
            description="Reduce spacing and padding for a denser layout"
          >
            <Toggle enabled={compactMode} onChange={setCompactMode} />
          </SettingRow>

          <SettingRow
            title="Animations"
            description="Enable smooth transitions and animations"
          >
            <Toggle enabled={animations} onChange={setAnimations} />
          </SettingRow>
        </div>
      </div>
    </div>
  )
}

function NotificationSettings() {
  const [prefs, setPrefs] = useState(() => {
    try {
      const stored = localStorage.getItem('humanovo-notification-settings')
      return stored ? JSON.parse(stored) : { email: true, push: true, sound: false, evidence: true, simulation: true, mention: true }
    } catch { return { email: true, push: true, sound: false, evidence: true, simulation: true, mention: true } }
  })

  const update = (key: string, value: boolean) => {
    setPrefs((p: any) => {
      const next = { ...p, [key]: value }
      localStorage.setItem('humanovo-notification-settings', JSON.stringify(next))
      return next
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-medium mb-4">Notification Channels</h3>
        <div className="glass-card">
          <SettingRow title="Email Notifications" description="Receive notifications via email">
            <Toggle enabled={prefs.email} onChange={v => update('email', v)} />
          </SettingRow>
          <SettingRow title="Push Notifications" description="Receive browser push notifications">
            <Toggle enabled={prefs.push} onChange={v => update('push', v)} />
          </SettingRow>
          <SettingRow title="Sound" description="Play a sound for notifications">
            <Toggle enabled={prefs.sound} onChange={v => update('sound', v)} />
          </SettingRow>
        </div>
      </div>

      <div>
        <h3 className="text-base font-medium mb-4">Notification Types</h3>
        <div className="glass-card">
          <SettingRow title="New Evidence" description="When new evidence is ingested into your projects">
            <Toggle enabled={prefs.evidence} onChange={v => update('evidence', v)} />
          </SettingRow>
          <SettingRow title="Simulation Complete" description="When a simulation finishes running">
            <Toggle enabled={prefs.simulation} onChange={v => update('simulation', v)} />
          </SettingRow>
          <SettingRow title="Mentions" description="When someone mentions you in a comment">
            <Toggle enabled={prefs.mention} onChange={v => update('mention', v)} />
          </SettingRow>
        </div>
      </div>
    </div>
  )
}

function DataSettings() {
  const [storageInfo, setStorageInfo] = useState({ total: 0, keys: [] as { key: string; size: number }[] })
  const [confirmClear, setConfirmClear] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    let total = 0
    const keys: { key: string; size: number }[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key) continue
      const val = localStorage.getItem(key) || ''
      const size = new Blob([val]).size
      total += size
      keys.push({ key, size })
    }
    keys.sort((a, b) => b.size - a.size)
    setStorageInfo({ total, keys })
  }, [])

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-medium mb-4">Storage</h3>
        <div className="glass-card">
          <div className="mb-4">
            <div className="flex items-center justify-between text-sm mb-2">
              <span>Local Storage Used</span>
              <span className="text-[var(--color-text-muted)]">{formatSize(storageInfo.total)} / 10 MB</span>
            </div>
            <div className="h-2 bg-white/5 rounded-full overflow-hidden">
              <div className="h-full bg-[var(--color-text)] rounded-full" style={{ width: `${Math.min(100, (storageInfo.total / (10 * 1024 * 1024)) * 100)}%` }} />
            </div>
          </div>

          <div className="space-y-2 text-xs">
            {storageInfo.keys.slice(0, 6).map(({ key, size }) => (
              <div key={key} className="flex items-center justify-between">
                <span className="text-[var(--color-text-muted)] truncate max-w-[200px]">{key}</span>
                <span>{formatSize(size)}</span>
              </div>
            ))}
            {storageInfo.keys.length > 6 && (
              <div className="text-[var(--color-text-muted)]">+{storageInfo.keys.length - 6} more keys</div>
            )}
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-base font-medium mb-4">Data Management</h3>
        <div className="glass-card">
          <SettingRow title="Export All Data" description="Download all your projects, hypotheses, and evidence as JSON">
            <button
              className="btn text-[var(--color-text-secondary)] hover:bg-white/5 text-xs"
              onClick={() => {
                const data: Record<string, any> = {}
                for (let i = 0; i < localStorage.length; i++) {
                  const key = localStorage.key(i)
                  if (!key) continue
                  try { data[key] = JSON.parse(localStorage.getItem(key) || '') } catch { data[key] = localStorage.getItem(key) }
                }
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
                const a = document.createElement('a')
                a.href = URL.createObjectURL(blob)
                a.download = `humanovo-export-${new Date().toISOString().slice(0, 10)}.json`
                a.click()
                URL.revokeObjectURL(a.href)
              }}
            >Export</button>
          </SettingRow>
          <SettingRow title="Clear Cache" description="Remove cached data to free up space">
            {confirmClear ? (
              <div className="flex items-center gap-2">
                <button onClick={() => { localStorage.clear(); window.location.reload() }} className="btn text-xs text-red-400 hover:bg-red-400/10">Confirm</button>
                <button onClick={() => setConfirmClear(false)} className="btn text-xs text-[var(--color-text-muted)]">Cancel</button>
              </div>
            ) : (
              <button className="btn text-[var(--color-text-secondary)] hover:bg-white/5 text-xs" onClick={() => setConfirmClear(true)}>Clear</button>
            )}
          </SettingRow>
          <SettingRow title="Delete All Data" description="Permanently delete all your data. This cannot be undone.">
            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <button onClick={() => { localStorage.clear(); window.location.reload() }} className="btn text-xs text-red-400 hover:bg-red-400/10">Yes, Delete</button>
                <button onClick={() => setConfirmDelete(false)} className="btn text-xs text-[var(--color-text-muted)]">Cancel</button>
              </div>
            ) : (
              <button className="btn text-[var(--color-text-muted)] hover:text-red-400 hover:bg-red-400/10 text-xs" onClick={() => setConfirmDelete(true)}>Delete</button>
            )}
          </SettingRow>
        </div>
      </div>
    </div>
  )
}

function AccountSettings() {
  const [profile, setProfile] = useState(() => {
    try {
      const stored = localStorage.getItem('humanovo-user-profile')
      return stored ? JSON.parse(stored) : { name: 'Researcher', email: 'researcher@institution.edu', institution: '', role: 'Principal Investigator' }
    } catch { return { name: 'Researcher', email: 'researcher@institution.edu', institution: '', role: 'Principal Investigator' } }
  })
  const [saved, setSaved] = useState(false)

  const saveProfile = () => {
    localStorage.setItem('humanovo-user-profile', JSON.stringify(profile))
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-medium mb-4">Profile</h3>
        <div className="glass-card space-y-4 p-4">
          <div>
            <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Full Name</label>
            <input type="text" value={profile.name} onChange={e => setProfile((p: any) => ({ ...p, name: e.target.value }))} className="input w-full text-sm" />
          </div>
          <div>
            <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Email</label>
            <input type="email" value={profile.email} onChange={e => setProfile((p: any) => ({ ...p, email: e.target.value }))} className="input w-full text-sm" />
          </div>
          <div>
            <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Institution</label>
            <input type="text" value={profile.institution} onChange={e => setProfile((p: any) => ({ ...p, institution: e.target.value }))} className="input w-full text-sm" placeholder="University or organization" />
          </div>
          <div>
            <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Role</label>
            <select value={profile.role} onChange={e => setProfile((p: any) => ({ ...p, role: e.target.value }))} className="input w-full text-sm">
              <option>Principal Investigator</option>
              <option>Postdoctoral Researcher</option>
              <option>PhD Student</option>
              <option>Research Associate</option>
              <option>Lab Manager</option>
              <option>Data Scientist</option>
              <option>Bioinformatician</option>
              <option>Clinical Researcher</option>
            </select>
          </div>
          <button onClick={saveProfile} className="btn text-sm px-4 py-2" style={{ color: saved ? 'var(--color-success)' : 'var(--color-text-secondary)' }}>
            {saved ? 'Saved!' : 'Save Profile'}
          </button>
        </div>
      </div>
    </div>
  )
}

function PrivacySettings() {
  const [prefs, setPrefs] = useState(() => {
    try {
      const stored = localStorage.getItem('humanovo-privacy-settings')
      return stored ? JSON.parse(stored) : { analytics: false, crashReports: true, shareUsage: false, autoLock: 30 }
    } catch { return { analytics: false, crashReports: true, shareUsage: false, autoLock: 30 } }
  })

  const update = (key: string, value: any) => {
    setPrefs((p: any) => {
      const next = { ...p, [key]: value }
      localStorage.setItem('humanovo-privacy-settings', JSON.stringify(next))
      return next
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-medium mb-4">Privacy</h3>
        <div className="glass-card">
          <SettingRow title="Analytics" description="Help improve Humanovo by sharing anonymized usage data">
            <Toggle enabled={prefs.analytics} onChange={v => update('analytics', v)} />
          </SettingRow>
          <SettingRow title="Crash Reports" description="Automatically send crash reports to help fix bugs">
            <Toggle enabled={prefs.crashReports} onChange={v => update('crashReports', v)} />
          </SettingRow>
          <SettingRow title="Share Usage Statistics" description="Share feature usage stats with your team admins">
            <Toggle enabled={prefs.shareUsage} onChange={v => update('shareUsage', v)} />
          </SettingRow>
        </div>
      </div>

      <div>
        <h3 className="text-base font-medium mb-4">Security</h3>
        <div className="glass-card">
          <SettingRow title="Auto-Lock Timeout" description="Automatically lock the session after inactivity">
            <select value={prefs.autoLock} onChange={e => update('autoLock', Number(e.target.value))} className="input text-xs">
              <option value={5}>5 minutes</option>
              <option value={15}>15 minutes</option>
              <option value={30}>30 minutes</option>
              <option value={60}>1 hour</option>
              <option value={0}>Never</option>
            </select>
          </SettingRow>
        </div>
      </div>
    </div>
  )
}

// ─── Admin · Seed demo data ────────────────────────────────────
// Exposes the backend /admin/seed-kg + /admin/seed-corpus endpoints as
// one-click buttons so fresh installs can populate the KG + evidence
// corpus without SSH-ing and running the python scripts directly.
// Non-production only (backend refuses when ENVIRONMENT=production).

function AdminSeedSettings() {
  const [stats, setStats] = useState<
    | null
    | {
        environment: string
        node_count: number
        edge_count: number
        embedding_count: number
        evidence_count?: number
        evidence_embedding_count?: number
        hypothesis_count?: number
        project_count?: number
      }
  >(null)
  const [health, setHealth] = useState<
    | null
    | {
        status: 'healthy' | 'degraded'
        environment: string
        version: string
        checks: Record<string, string>
        counts: Record<string, number | null>
        last_seen: Record<string, string | null>
      }
  >(null)
  const [busy, setBusy] = useState<'kg' | 'corpus' | null>(null)
  const [lastMessage, setLastMessage] = useState<string>('')
  const [lastPolled, setLastPolled] = useState<Date | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [s, h] = await Promise.all([
        api.getKgStats().catch(() => null),
        api.getAdminHealth().catch(() => null),
      ])
      setStats(s)
      setHealth(h)
      setLastPolled(new Date())
    } catch {
      // already handled per-promise
    }
  }, [])
  useEffect(() => {
    refresh()
    // 10s poll — Admin panel is the "is the backend alive?" surface so
    // freshness matters more than bandwidth. Unsubscribe on unmount.
    const id = window.setInterval(refresh, 10_000)
    return () => window.clearInterval(id)
  }, [refresh])

  const runKgSeed = async () => {
    setBusy('kg')
    try {
      const r = await api.seedKg(true)
      setLastMessage(r.message)
    } catch (e) {
      setLastMessage(`seed-kg failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(null)
      refresh()
    }
  }
  const runCorpusSeed = async () => {
    setBusy('corpus')
    try {
      const r = await api.seedCorpus(true)
      setLastMessage(r.message)
    } catch (e) {
      setLastMessage(`seed-corpus failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(null)
      refresh()
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold mb-1">Admin · Seed demo data</h2>
        <p className="text-sm text-[var(--color-text-muted)]">
          Populate the backend KG + evidence corpus without opening a terminal.
          Non-production environments only.
        </p>
        {stats && stats.environment !== 'development' && (
          <div className="mt-2 p-2 rounded bg-[var(--glass-bg)] border border-[var(--color-warning)] text-xs" style={{ color: 'var(--color-warning)' }}>
            Current environment is <code>{stats.environment}</code> — seed buttons may be refused by the backend.
          </div>
        )}
      </div>

      <div className="glass-card p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium">Service health</h3>
          <span className="text-xxs" style={{ color: 'var(--color-text-muted)' }}>
            {lastPolled
              ? `Polled ${lastPolled.toLocaleTimeString()} · auto-refreshes every 10s`
              : 'Polling…'}
          </span>
        </div>
        {health ? (
          <div className="flex flex-wrap gap-2">
            {Object.entries(health.checks).map(([name, state]) => {
              const isOk = state === 'ok' || state === 'connected'
              const isSoft = state === 'not_configured' || state === 'missing'
              const color = isOk
                ? 'var(--color-success)'
                : isSoft
                  ? 'var(--color-text-muted)'
                  : 'var(--color-error)'
              return (
                <span
                  key={name}
                  title={state}
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs"
                  style={{ borderColor: color, color }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: color,
                      display: 'inline-block',
                    }}
                  />
                  <span style={{ color: 'var(--color-text)' }}>{name}</span>
                  <span className="tabular-nums">{state.length > 24 ? `${state.slice(0, 24)}…` : state}</span>
                </span>
              )
            })}
            <span
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs ml-auto"
              style={{
                borderColor:
                  health.status === 'healthy'
                    ? 'var(--color-success)'
                    : 'var(--color-warning)',
                color:
                  health.status === 'healthy'
                    ? 'var(--color-success)'
                    : 'var(--color-warning)',
              }}
            >
              overall: {health.status} · v{health.version}
            </span>
          </div>
        ) : (
          <p className="text-xs text-[var(--color-text-muted)]">
            Health unavailable — /admin/health unreachable.
          </p>
        )}
      </div>

      {health && (
        <div className="glass-card p-4">
          <h3 className="text-sm font-medium mb-2">Table freshness</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs">
            {Object.entries(health.counts).map(([table, count]) => {
              const iso = health.last_seen[table]
              const isError = typeof iso === 'string' && iso.startsWith('error:')
              const ts = iso && !isError ? new Date(iso) : null
              const ageMs = ts ? Date.now() - ts.getTime() : null
              const ageDays = ageMs != null ? ageMs / 86_400_000 : null
              const stale = ageDays != null && ageDays > 7
              const empty = count === 0
              return (
                <div key={table} className="flex items-center justify-between gap-2 py-1">
                  <span style={{ color: 'var(--color-text-muted)' }}>{table}</span>
                  <span className="flex items-center gap-2">
                    <span
                      className="tabular-nums"
                      style={{
                        color: empty ? 'var(--color-warning)' : 'var(--color-text)',
                      }}
                    >
                      {count ?? '—'}
                    </span>
                    <span
                      className="text-xxs tabular-nums"
                      style={{
                        color: stale
                          ? 'var(--color-warning)'
                          : isError
                            ? 'var(--color-error)'
                            : 'var(--color-text-muted)',
                      }}
                      title={iso ?? 'never'}
                    >
                      {isError
                        ? 'error'
                        : ts
                          ? ageDays! < 1
                            ? 'today'
                            : `${Math.floor(ageDays!)}d ago`
                          : 'never'}
                    </span>
                  </span>
                </div>
              )
            })}
          </div>
          {Object.entries(health.last_seen).some(([, iso]) => {
            if (!iso || iso.startsWith('error:')) return false
            return Date.now() - new Date(iso).getTime() > 7 * 86_400_000
          }) && (
            <p
              className="mt-2 text-xxs"
              style={{ color: 'var(--color-warning)' }}
            >
              Some tables have not been updated in &gt; 7 days. Consider re-seeding or running an ingestion job.
            </p>
          )}
        </div>
      )}

      <div className="glass-card p-4">
        <h3 className="text-sm font-medium mb-2">Current corpus</h3>
        {stats ? (
          <div className="grid grid-cols-2 gap-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
            <div>Environment</div><div style={{ color: 'var(--color-text)' }}>{stats.environment}</div>
            <div>KG nodes</div><div style={{ color: 'var(--color-text)' }}>{stats.node_count}</div>
            <div>KG edges</div><div style={{ color: 'var(--color-text)' }}>{stats.edge_count}</div>
            <div>KG embeddings (pgvector 1024d)</div><div style={{ color: 'var(--color-text)' }}>{stats.embedding_count}</div>
            <div>Evidence rows</div><div style={{ color: 'var(--color-text)' }}>{stats.evidence_count ?? '—'}</div>
            <div>Evidence embeddings</div><div style={{ color: 'var(--color-text)' }}>{stats.evidence_embedding_count ?? '—'}</div>
            <div>Hypotheses</div><div style={{ color: 'var(--color-text)' }}>{stats.hypothesis_count ?? '—'}</div>
            <div>Projects</div><div style={{ color: 'var(--color-text)' }}>{stats.project_count ?? '—'}</div>
          </div>
        ) : (
          <p className="text-xs text-[var(--color-text-muted)]">Stats unavailable — backend unreachable.</p>
        )}
      </div>

      <div className="glass-card p-4">
        <h3 className="text-sm font-medium mb-2">Seed actions</h3>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={runKgSeed}
            disabled={busy !== null}
            aria-label="Re-seed knowledge graph"
            className="btn btn-sm btn-primary disabled:opacity-50"
          >
            {busy === 'kg' ? 'Seeding KG…' : 'Re-seed KG (91 entities, 50 relations)'}
          </button>
          <button
            type="button"
            onClick={runCorpusSeed}
            disabled={busy !== null}
            aria-label="Re-seed evidence corpus"
            className="btn btn-sm btn-secondary disabled:opacity-50"
          >
            {busy === 'corpus' ? 'Seeding corpus…' : 'Re-seed Evidence + Hypotheses (12/3)'}
          </button>
          <button
            type="button"
            onClick={refresh}
            aria-label="Refresh stats"
            className="btn btn-sm btn-secondary"
          >
            Refresh stats
          </button>
        </div>
        {lastMessage && (
          <p
            className="mt-3 text-xs"
            style={{ color: 'var(--color-text-muted)' }}
            aria-live="polite"
          >
            {lastMessage}
          </p>
        )}
      </div>

      <div
        className="text-xxs"
        style={{ color: 'var(--color-text-muted)' }}
      >
        Backend endpoints: <code>POST /api/v1/admin/seed-kg?force=true</code>,{' '}
        <code>POST /api/v1/admin/seed-corpus?force=true</code>. Both refuse to
        run in production.
      </div>
    </div>
  )
}

function IntegrationSettings() {
  const [integrations, setIntegrations] = useState(() => {
    try {
      const stored = localStorage.getItem('humanovo-integrations')
      return stored ? JSON.parse(stored) : { github: false, slack: false, pubmed: true, orcid: false, zenodo: false }
    } catch { return { github: false, slack: false, pubmed: true, orcid: false, zenodo: false } }
  })

  const toggle = (key: string) => {
    setIntegrations((p: any) => {
      const next = { ...p, [key]: !p[key] }
      localStorage.setItem('humanovo-integrations', JSON.stringify(next))
      return next
    })
  }

  const items = [
    { key: 'pubmed', name: 'PubMed', description: 'Search and import publications from NCBI PubMed' },
    { key: 'github', name: 'GitHub', description: 'Sync notebooks and analysis scripts with GitHub repos' },
    { key: 'orcid', name: 'ORCID', description: 'Link your ORCID profile for publication management' },
    { key: 'slack', name: 'Slack', description: 'Receive notifications in your Slack workspace' },
    { key: 'zenodo', name: 'Zenodo', description: 'Publish datasets and get DOIs for your research outputs' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-medium mb-4">Connected Services</h3>
        <div className="glass-card">
          {items.map(item => (
            <SettingRow key={item.key} title={item.name} description={item.description}>
              <div className="flex items-center gap-3">
                <span className="text-xs" style={{ color: integrations[item.key] ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
                  {integrations[item.key] ? 'Connected' : 'Disconnected'}
                </span>
                <Toggle enabled={integrations[item.key]} onChange={() => toggle(item.key)} />
              </div>
            </SettingRow>
          ))}
        </div>
      </div>
    </div>
  )
}


export default function Settings() {
  const [searchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const [isDevEnv, setIsDevEnv] = useState(false)
  useEffect(() => {
    api.getKgStats()
      .then(s => setIsDevEnv(s.environment === 'development'))
      .catch(() => setIsDevEnv(false))
  }, [])
  const settingsSections = isDevEnv
    ? [...BASE_SETTINGS_SECTIONS, ADMIN_SECTION]
    : BASE_SETTINGS_SECTIONS
  const [activeSection, setActiveSection] = useState(
    tabParam && settingsSections.some(s => s.id === tabParam) ? tabParam : 'appearance'
  )

  // Consume-and-clean the `?tab=` query so a soft reload after the user
  // clicks a different tab doesn't snap them back to the URL-seeded one.
  // Bogus values (e.g. /settings?tab=totally-bogus) silently fall back
  // to the 'appearance' default — the guard in `useState` above keeps
  // the render safe, we only need to strip the stray param from the
  // URL here.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    if (sp.has('tab')) {
      sp.delete('tab')
      const qs = sp.toString()
      const newUrl = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash
      window.history.replaceState(window.history.state, '', newUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const renderContent = () => {
    switch (activeSection) {
      case 'appearance':
        return <AppearanceSettings />
      case 'account':
        return <AccountSettings />
      case 'notifications':
        return <NotificationSettings />
      case 'privacy':
        return <PrivacySettings />
      case 'data':
        return <DataSettings />
      case 'integrations':
        return <IntegrationSettings />
      case 'admin':
        return <AdminSeedSettings />
      default:
        return <AppearanceSettings />
    }
  }

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <div className="w-56 border-r border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-4">
        <h1 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <FiSettings className="w-5 h-5" />
          Settings
        </h1>
        <nav className="space-y-0.5">
          {settingsSections.map(section => (
            <button
              key={section.id}
              onClick={() => {
                if ((section as any).link) { window.location.href = (section as any).link; return }
                setActiveSection(section.id)
              }}
              className={clsx(
                'flex items-center gap-2 w-full px-3 py-2 rounded text-xs transition-colors',
                activeSection === section.id
                  ? 'bg-white/10 text-white'
                  : 'text-[var(--color-text-muted)] hover:bg-white/5 hover:text-[var(--color-text)]'
              )}
            >
              <section.icon className="w-3.5 h-3.5" />
              <span className="flex-1 text-left">{section.label}</span>
              {activeSection === section.id && <FiChevronRight className="w-3 h-3" />}
            </button>
          ))}
        </nav>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl">
          {renderContent()}
        </div>
      </div>
    </div>
  )
}
