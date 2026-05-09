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
  FiCheck,
  FiDollarSign,
  FiShare2,
  FiAlertCircle,
  FiTrendingUp
} from 'react-icons/fi'
import clsx from 'clsx'
import { useTheme } from '../contexts/ThemeContext'
import api, { type IngestionJob } from '../services/api'
import {
  isNativeApp,
  openExternal,
  getAppVersion,
  getPlatform,
  getNotificationPermission,
  getAutostartEnabled,
  setAutostartEnabled,
  getDiagnostics,
  notify,
} from '../lib/native'
import { toast } from '../contexts/ToastContext'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'

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
  { id: 'billing', label: 'Usage & Billing', icon: FiDollarSign },
  { id: 'kg-contributions', label: 'KG & Contributions', icon: FiShare2 },
  { id: 'notifications', label: 'Notifications', icon: FiBell },
  { id: 'privacy', label: 'Privacy & Security', icon: FiShield },
  { id: 'data', label: 'Data & Storage', icon: FiDatabase },
  { id: 'integrations', label: 'Integrations', icon: FiGlobe },
]
const ADMIN_SECTION = { id: 'admin', label: 'Admin · Seed demo data', icon: FiDatabase }
// Desktop-only section — surfaces native-shell affordances (manual
// update check, deep-links to Issue tracker) that don't make sense
// in the web build. Injected when `isNativeApp()` is true.
const DESKTOP_SECTION = { id: 'desktop', label: 'Desktop App', icon: FiMonitor }

function Toggle({
  enabled,
  onChange,
  disabled = false,
}: {
  enabled: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!enabled)}
      disabled={disabled}
      className={clsx(
        'relative w-9 h-5 rounded-full transition-colors',
        enabled ? 'bg-[var(--color-text)]' : 'bg-white/10',
        disabled && 'opacity-50 cursor-not-allowed',
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
  type NotifPrefs = { email: boolean; push: boolean; sound: boolean; evidence: boolean; simulation: boolean; mention: boolean }
  const defaultNotifPrefs: NotifPrefs = { email: true, push: true, sound: false, evidence: true, simulation: true, mention: true }
  const [prefs, setPrefs] = useState<NotifPrefs>(() => {
    try {
      const stored = localStorage.getItem('humanovo-notification-settings')
      return stored ? { ...defaultNotifPrefs, ...(JSON.parse(stored) as Partial<NotifPrefs>) } : defaultNotifPrefs
    } catch { return defaultNotifPrefs }
  })

  const update = (key: keyof NotifPrefs, value: boolean) => {
    setPrefs((p) => {
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
                const data: Record<string, unknown> = {}
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
  type Profile = { name: string; email: string; institution: string; role: string }
  const defaultProfile: Profile = { name: 'Researcher', email: 'researcher@institution.edu', institution: '', role: 'Principal Investigator' }
  const [profile, setProfile] = useState<Profile>(() => {
    try {
      const stored = localStorage.getItem('humanovo-user-profile')
      return stored ? { ...defaultProfile, ...(JSON.parse(stored) as Partial<Profile>) } : defaultProfile
    } catch { return defaultProfile }
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
            <input type="text" value={profile.name} onChange={e => setProfile((p) => ({ ...p, name: e.target.value }))} className="input w-full text-sm" />
          </div>
          <div>
            <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Email</label>
            <input type="email" value={profile.email} onChange={e => setProfile((p) => ({ ...p, email: e.target.value }))} className="input w-full text-sm" />
          </div>
          <div>
            <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Institution</label>
            <input type="text" value={profile.institution} onChange={e => setProfile((p) => ({ ...p, institution: e.target.value }))} className="input w-full text-sm" placeholder="University or organization" />
          </div>
          <div>
            <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Role</label>
            <select value={profile.role} onChange={e => setProfile((p) => ({ ...p, role: e.target.value }))} className="input w-full text-sm">
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
  type PrivacyPrefs = { analytics: boolean; crashReports: boolean; shareUsage: boolean; autoLock: number }
  const defaultPrivacyPrefs: PrivacyPrefs = { analytics: false, crashReports: true, shareUsage: false, autoLock: 30 }
  const [prefs, setPrefs] = useState<PrivacyPrefs>(() => {
    try {
      const stored = localStorage.getItem('humanovo-privacy-settings')
      return stored ? { ...defaultPrivacyPrefs, ...(JSON.parse(stored) as Partial<PrivacyPrefs>) } : defaultPrivacyPrefs
    } catch { return defaultPrivacyPrefs }
  })

  const update = <K extends keyof PrivacyPrefs>(key: K, value: PrivacyPrefs[K]) => {
    setPrefs((p) => {
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

// ─── Usage & Billing ───────────────────────────────────────────
// Shows the user's current monthly AI-spend, lets them set a hard cap,
// and surfaces a real last-30-days usage breakdown. When the cap is
// reached the backend blocks new discovery runs with an explanatory
// notification (UserBudgetBlocked).
//
// The user-id is read from the profile stored in localStorage (same
// convention AccountSettings uses). When no profile exists we fall
// back to the email; both are string-keyed on the server.

function _currentUserId(): string {
  try {
    const stored = localStorage.getItem('humanovo-user-profile')
    if (stored) {
      const p = JSON.parse(stored)
      return p.email || p.name || 'self'
    }
  } catch {
    // localStorage unavailable / parse failure — fall through to default.
  }
  return 'self'
}

type BudgetPayload = Awaited<ReturnType<typeof api.getUserBudget>>
type BudgetUsagePayload = Awaited<ReturnType<typeof api.getUserBudgetUsage>>

function UsageBillingSettings() {
  const userId = _currentUserId()
  const [loading, setLoading] = useState(true)
  const [budget, setBudget] = useState<BudgetPayload | null>(null)
  const [usage, setUsage] = useState<BudgetUsagePayload | null>(null)
  const [capUsd, setCapUsd] = useState<number>(50)
  const [threshold, setThreshold] = useState<number>(80)
  const [hardLimit, setHardLimit] = useState<boolean>(true)
  const [notifEmail, setNotifEmail] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [b, u] = await Promise.all([
        api.getUserBudget(userId),
        api.getUserBudgetUsage(userId, 30),
      ])
      setBudget(b)
      setUsage(u)
      setCapUsd(Number(b.monthly_budget_usd) || 50)
      setThreshold(b.alert_threshold_pct ?? 80)
      setHardLimit(Boolean(b.hard_limit))
      setNotifEmail(b.notification_email || '')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to load usage data'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => { load() }, [load])

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const updated = await api.updateUserBudget(userId, {
        monthly_budget_cents: Math.max(0, Math.round(capUsd * 100)),
        alert_threshold_pct: threshold,
        hard_limit: hardLimit,
        notification_email: notifEmail.trim() || null,
      })
      setBudget(updated as BudgetPayload)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to save'
      setError(msg)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <h3 className="text-base font-medium">Usage &amp; Billing</h3>
        <div className="glass-card p-4 text-sm text-[var(--color-text-muted)]">
          Loading usage&hellip;
        </div>
      </div>
    )
  }

  const pct = budget?.percent_used || 0
  const statusColor =
    budget?.status === 'blocked' ? 'text-red-400' :
    budget?.status === 'warning' ? 'text-amber-400' :
    'text-emerald-400'

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div>
        <h3 className="text-base font-medium mb-4 flex items-center gap-2">
          <FiDollarSign className="w-4 h-4" />
          This month
        </h3>
        <div className="glass-card p-4 space-y-3">
          <div className="flex items-baseline justify-between">
            <div>
              <div className="text-3xl font-semibold text-[var(--color-text)]">
                ${Number(budget?.current_spend_usd || 0).toFixed(2)}
              </div>
              <div className="text-xs text-[var(--color-text-muted)] mt-1">
                of ${Number(budget?.monthly_budget_usd || 0).toFixed(2)} cap
                <span className="mx-1">·</span>
                resets {budget?.current_month_starts
                  ? new Date(budget.current_month_starts).toLocaleDateString()
                  : '—'}
              </div>
            </div>
            <div className={clsx('text-xs uppercase tracking-wide', statusColor)}>
              {budget?.status || 'ok'}
            </div>
          </div>
          {/* Progress bar */}
          <div className="w-full h-2 rounded-full bg-white/5 overflow-hidden">
            <div
              className={clsx(
                'h-full transition-all',
                pct >= 100 ? 'bg-red-500/70' :
                pct >= threshold ? 'bg-amber-500/70' :
                'bg-emerald-500/70',
              )}
              style={{ width: `${Math.min(100, pct)}%` }}
            />
          </div>
          {budget?.message && (
            <div className="flex items-start gap-2 text-xs text-[var(--color-text-muted)] pt-1">
              <FiAlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span>{budget.message}</span>
            </div>
          )}
        </div>
      </div>

      {/* Cap configuration */}
      <div>
        <h3 className="text-base font-medium mb-4">Monthly cap</h3>
        <div className="glass-card p-4 space-y-4">
          <div>
            <label className="text-xs text-[var(--color-text-muted)] mb-1 block">
              Hard cap (USD / month)
            </label>
            <div className="flex items-center gap-2">
              <span className="text-[var(--color-text-muted)] text-sm">$</span>
              <input
                type="number" min={0} max={10000} step={1}
                value={capUsd}
                onChange={e => setCapUsd(Number(e.target.value))}
                className="input w-32 text-sm"
              />
              <span className="text-xs text-[var(--color-text-muted)]">
                per calendar month · 0 disables discovery
              </span>
            </div>
          </div>

          <div>
            <label className="text-xs text-[var(--color-text-muted)] mb-1 block">
              Alert threshold
            </label>
            <div className="flex items-center gap-2">
              <input
                type="range" min={10} max={99} step={1}
                value={threshold}
                onChange={e => setThreshold(Number(e.target.value))}
                className="w-40 accent-[var(--color-text)]"
              />
              <span className="text-sm text-[var(--color-text)] w-10">
                {threshold}%
              </span>
              <span className="text-xs text-[var(--color-text-muted)]">
                notify when month-to-date spend reaches this %
              </span>
            </div>
          </div>

          <SettingRow
            title="Hard-stop at cap"
            description="When enabled, new discovery runs are blocked once the cap is reached. When off, runs proceed but warnings fire."
          >
            <Toggle enabled={hardLimit} onChange={setHardLimit} />
          </SettingRow>

          <div>
            <label className="text-xs text-[var(--color-text-muted)] mb-1 block">
              Notification email (optional)
            </label>
            <input
              type="email"
              value={notifEmail}
              onChange={e => setNotifEmail(e.target.value)}
              className="input w-full text-sm"
              placeholder="ops@example.com"
            />
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={save}
              disabled={saving}
              className="btn btn-primary text-sm"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            {saved && (
              <span className="text-xs text-emerald-400 flex items-center gap-1">
                <FiCheck className="w-3.5 h-3.5" /> Saved
              </span>
            )}
            {error && (
              <span className="text-xs text-red-400">{error}</span>
            )}
          </div>
        </div>
      </div>

      {/* 30-day breakdown */}
      <div>
        <h3 className="text-base font-medium mb-4 flex items-center gap-2">
          <FiTrendingUp className="w-4 h-4" />
          Last 30 days
        </h3>
        <div className="glass-card p-4 space-y-4">
          <div className="grid grid-cols-4 gap-3 text-sm">
            <div>
              <div className="text-xs text-[var(--color-text-muted)]">
                Total spend
              </div>
              <div className="text-lg font-semibold">
                ${Number(usage?.total_spend_usd || 0).toFixed(2)}
              </div>
            </div>
            <div>
              <div className="text-xs text-[var(--color-text-muted)]">
                Runs
              </div>
              <div className="text-lg font-semibold">
                {usage?.total_runs || 0}
              </div>
            </div>
            <div>
              <div className="text-xs text-[var(--color-text-muted)]">
                Hypotheses
              </div>
              <div className="text-lg font-semibold">
                {usage?.total_hypotheses_generated || 0}
              </div>
            </div>
            <div>
              <div className="text-xs text-[var(--color-text-muted)]">
                Papers
              </div>
              <div className="text-lg font-semibold">
                {usage?.total_papers_generated || 0}
              </div>
            </div>
          </div>

          {(usage?.by_day || []).length > 0 && (
            <div>
              <div className="text-xs text-[var(--color-text-muted)] mb-2">
                Daily spend
              </div>
              <div style={{ width: '100%', height: 140 }}>
                <ResponsiveContainer>
                  <AreaChart
                    data={(usage?.by_day ?? []).map((d) => ({
                      day: (d.day || '').slice(5),
                      cost_usd: Number(d.cost_cents || 0) / 100,
                      n_calls: d.n_calls || 0,
                    }))}
                    margin={{ top: 4, right: 6, left: 0, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="spendFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#0369a1" stopOpacity={0.55} />
                        <stop offset="100%" stopColor="#0369a1" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="rgba(255,255,255,0.04)" />
                    <XAxis dataKey="day" tick={{ fill: 'var(--color-text-muted)', fontSize: 9 }} />
                    <YAxis tick={{ fill: 'var(--color-text-muted)', fontSize: 9 }} width={30} />
                    <Tooltip
                      contentStyle={{
                        background: 'var(--color-bg-elevated)',
                        border: '1px solid var(--color-border)',
                        fontSize: 11,
                      }}
                      formatter={(v) => `$${Number(v ?? 0).toFixed(3)}`}
                      labelStyle={{ color: 'var(--color-text-muted)' }}
                    />
                    <Area
                      type="monotone"
                      dataKey="cost_usd"
                      stroke="#0369a1"
                      strokeWidth={1.5}
                      fill="url(#spendFill)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {usage && usage.by_model && usage.by_model.length > 0 && (
            <div>
              <div className="text-xs text-[var(--color-text-muted)] mb-2">
                Spend by model
              </div>
              <div className="space-y-1.5">
                {usage.by_model.slice(0, 8).map((m) => (
                  <div key={m.model} className="flex items-center gap-2 text-xs">
                    <div className="w-48 truncate" title={m.model}>
                      {m.model}
                    </div>
                    <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                      <div
                        className="h-full bg-[var(--color-text)]/40"
                        style={{
                          width: `${Math.min(100, (m.cost_usd / Math.max(0.01, usage.total_spend_usd)) * 100)}%`,
                        }}
                      />
                    </div>
                    <div className="w-16 text-right tabular-nums">
                      ${Number(m.cost_usd).toFixed(3)}
                    </div>
                    <div className="w-14 text-right text-[var(--color-text-muted)] tabular-nums">
                      {m.n_calls}×
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── KG & Contributions ────────────────────────────────────────
// Shows the user's private KG footprint, public (common) contributions,
// and royalty accrual. Also lets the user flip the default upload
// scope between 'private' (no sharing) and 'common' (shared + royalty-
// eligible).

type KGOverviewPayload = Awaited<ReturnType<typeof api.getUserKGOverview>>
type RoyaltiesPayload = Awaited<ReturnType<typeof api.getUserRoyalties>>
type UploadScope = 'private' | 'common'

function KGContributionsSettings() {
  const userId = _currentUserId()
  const [overview, setOverview] = useState<KGOverviewPayload | null>(null)
  const [royalties, setRoyalties] = useState<RoyaltiesPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [defaultScope, setDefaultScope] = useState<UploadScope>(() => {
    try {
      const v = localStorage.getItem('humanovo-default-upload-scope')
      return v === 'private' || v === 'common' ? v : 'private'
    } catch { return 'private' }
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [o, r] = await Promise.all([
        api.getUserKGOverview(userId).catch(() => null),
        api.getUserRoyalties(userId, 30).catch(() => null),
      ])
      setOverview(o)
      setRoyalties(r)
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => { load() }, [load])

  const changeDefault = (scope: 'private' | 'common') => {
    setDefaultScope(scope)
    try { localStorage.setItem('humanovo-default-upload-scope', scope) } catch {
      // localStorage write blocked (private browsing / quota) — non-fatal.
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <h3 className="text-base font-medium">KG &amp; Contributions</h3>
        <div className="glass-card p-4 text-sm text-[var(--color-text-muted)]">
          Loading…
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-medium mb-4 flex items-center gap-2">
          <FiShare2 className="w-4 h-4" />
          Your Knowledge Graph
        </h3>
        <div className="glass-card p-4 grid grid-cols-3 gap-4 text-sm">
          <div>
            <div className="text-xs text-[var(--color-text-muted)]">
              Private nodes
            </div>
            <div className="text-2xl font-semibold">
              {overview?.private_nodes?.toLocaleString() || 0}
            </div>
          </div>
          <div>
            <div className="text-xs text-[var(--color-text-muted)]">
              Private edges
            </div>
            <div className="text-2xl font-semibold">
              {overview?.private_edges?.toLocaleString() || 0}
            </div>
          </div>
          <div>
            <div className="text-xs text-[var(--color-text-muted)]">
              Common contributions
            </div>
            <div className="text-2xl font-semibold">
              {overview?.common_contributions?.toLocaleString() || 0}
            </div>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-base font-medium mb-4">
          Default upload scope
        </h3>
        <div className="glass-card p-4 space-y-3">
          <p className="text-xs text-[var(--color-text-muted)]">
            When you upload a document, humanovo asks whether it should
            stay private (only your agents can query it) or join the
            common Knowledge Graph (other users' agents can query facts
            derived from it, and you receive royalty credit every time
            they do).
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => changeDefault('private')}
              className={clsx(
                'px-3 py-1.5 rounded text-xs border transition-colors',
                defaultScope === 'private'
                  ? 'border-[var(--color-text)] bg-white/10 text-[var(--color-text)]'
                  : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]',
              )}
            >
              Private (recommended)
            </button>
            <button
              onClick={() => changeDefault('common')}
              className={clsx(
                'px-3 py-1.5 rounded text-xs border transition-colors',
                defaultScope === 'common'
                  ? 'border-[var(--color-text)] bg-white/10 text-[var(--color-text)]'
                  : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]',
              )}
            >
              Common (royalty-eligible)
            </button>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-base font-medium mb-4 flex items-center gap-2">
          <FiTrendingUp className="w-4 h-4" />
          Royalty accrual (last 30 days)
        </h3>
        <div className="glass-card p-4 space-y-3 text-sm">
          <div>
            <div className="text-xs text-[var(--color-text-muted)]">
              Total weight
            </div>
            <div className="text-2xl font-semibold">
              {Number(royalties?.total_weight || 0).toFixed(2)}
            </div>
            <div className="text-xs text-[var(--color-text-muted)] mt-1">
              All-time weight: {Number(overview?.royalty_weight_all_time || 0).toFixed(2)}
            </div>
          </div>
          {(royalties?.by_kind || []).length > 0 ? (
            <div className="space-y-1.5">
              {(royalties?.by_kind ?? []).map((k) => (
                <div key={k.event_kind}
                     className="flex items-center justify-between text-xs">
                  <span className="capitalize">{k.event_kind}</span>
                  <span className="text-[var(--color-text-muted)] tabular-nums">
                    {k.n}× · weight {Number(k.weight).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-[var(--color-text-muted)]">
              No royalty events yet. Enable common sharing on a document
              or validated hypothesis to become eligible.
            </p>
          )}
          {royalties?.note && (
            <p className="text-[11px] text-[var(--color-text-muted)] leading-relaxed pt-2">
              {royalties.note}
            </p>
          )}
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
        embeddings?: { kg_entity?: number | null; evidence?: number | null }
        flags?: { seed_available?: boolean; corpus_seeded?: boolean }
      }
  >(null)
  const [busy, setBusy] = useState<'kg' | 'corpus' | null>(null)
  const [lastMessage, setLastMessage] = useState<string>('')
  const [lastPolled, setLastPolled] = useState<Date | null>(null)
  const [ingestionJobs, setIngestionJobs] = useState<IngestionJob[] | null>(null)
  const [queueStats, setQueueStats] = useState<Record<string, unknown> | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [s, h, jobs, qs] = await Promise.all([
        api.getKgStats().catch(() => null),
        api.getAdminHealth().catch(() => null),
        // Show the last 5 jobs — the full list lives on a dedicated
        // page; the admin panel is a "heartbeat" surface, not a
        // replacement for job management.
        api.getIngestionJobs({ page: 1, page_size: 5 }).catch(() => null),
        api.getIngestionQueueStats().catch(() => null),
      ])
      setStats(s)
      setHealth(h)
      setIngestionJobs(jobs ? jobs.items : null)
      setQueueStats((qs as Record<string, unknown> | null) || null)
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
        {/* Prefer /admin/health when available (newer, includes embedding
            split + flags). Fall back to /admin/kg-stats fields for older
            backends that predate the health enrichment. */}
        {stats || health ? (
          <div className="grid grid-cols-2 gap-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
            <div>Environment</div>
            <div style={{ color: 'var(--color-text)' }}>
              {stats?.environment ?? health?.environment ?? '—'}
            </div>
            <div>KG nodes</div>
            <div style={{ color: 'var(--color-text)' }}>
              {health?.counts?.kg_nodes ?? stats?.node_count ?? '—'}
            </div>
            <div>KG edges</div>
            <div style={{ color: 'var(--color-text)' }}>
              {health?.counts?.kg_edges ?? stats?.edge_count ?? '—'}
            </div>
            <div>KG embeddings (pgvector 1024d)</div>
            <div style={{ color: 'var(--color-text)' }}>
              {health?.embeddings?.kg_entity ?? stats?.embedding_count ?? '—'}
            </div>
            <div>Evidence rows</div>
            <div style={{ color: 'var(--color-text)' }}>
              {health?.counts?.evidence ?? stats?.evidence_count ?? '—'}
            </div>
            <div>Evidence embeddings</div>
            <div style={{ color: 'var(--color-text)' }}>
              {health?.embeddings?.evidence ?? stats?.evidence_embedding_count ?? '—'}
            </div>
            <div>Hypotheses</div>
            <div style={{ color: 'var(--color-text)' }}>
              {health?.counts?.hypotheses ?? stats?.hypothesis_count ?? '—'}
            </div>
            <div>Projects</div>
            <div style={{ color: 'var(--color-text)' }}>
              {health?.counts?.projects ?? stats?.project_count ?? '—'}
            </div>
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

      {/* Ingestion activity — read-only view of the queue + last 5 jobs.
          Link out to the dedicated Data Manager → Ingestion page for
          actions like create / cancel / retry. */}
      <div className="glass-card p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium">Ingestion activity</h3>
          <a
            href="/data-manager?tab=ingestion"
            className="text-xxs hover:underline"
            style={{ color: 'var(--color-accent, #60a5fa)' }}
          >
            Open Data Manager →
          </a>
        </div>
        {queueStats ? (
          <div className="grid grid-cols-4 gap-2 text-xxs mb-3" style={{ color: 'var(--color-text-muted)' }}>
            {(['pending', 'running', 'completed', 'failed'] as const).map(k => (
              <div key={k} className="flex flex-col">
                <span>{k}</span>
                <span
                  className="tabular-nums text-sm"
                  style={{ color: 'var(--color-text)' }}
                >
                  {String(queueStats[k] ?? queueStats[`${k}_count`] ?? 0)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-[var(--color-text-muted)] mb-3">
            Queue stats unavailable — ingestion scheduler may be offline.
          </p>
        )}
        {ingestionJobs && ingestionJobs.length > 0 ? (
          <table className="w-full text-xxs">
            <thead>
              <tr style={{ color: 'var(--color-text-muted)' }}>
                <th className="text-left font-normal pb-1">Name</th>
                <th className="text-left font-normal pb-1">Source</th>
                <th className="text-left font-normal pb-1">Status</th>
                <th className="text-right font-normal pb-1">Created</th>
              </tr>
            </thead>
            <tbody>
              {ingestionJobs.map(j => (
                <tr key={j.id}>
                  <td className="py-0.5 pr-2 truncate max-w-[180px]" title={j.name}>
                    {j.name}
                  </td>
                  <td className="py-0.5 pr-2" style={{ color: 'var(--color-text-muted)' }}>
                    {j.source}
                  </td>
                  <td
                    className="py-0.5 pr-2"
                    style={{
                      color:
                        j.status === 'completed'
                          ? 'var(--color-success)'
                          : j.status === 'failed' || j.status === 'cancelled'
                            ? 'var(--color-error)'
                            : j.status === 'fetching' || j.status === 'processing' || j.status === 'indexing'
                              ? 'var(--color-warning)'
                              : 'var(--color-text-muted)',
                    }}
                  >
                    {j.status}
                  </td>
                  <td
                    className="py-0.5 text-right tabular-nums"
                    style={{ color: 'var(--color-text-muted)' }}
                    title={j.created_at}
                  >
                    {new Date(j.created_at).toLocaleTimeString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-xs text-[var(--color-text-muted)]">
            No ingestion jobs yet. Run one from Data Manager → Ingestion or upload a document from a project.
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
  type Integrations = { github: boolean; slack: boolean; pubmed: boolean; orcid: boolean; zenodo: boolean }
  const defaultIntegrations: Integrations = { github: false, slack: false, pubmed: true, orcid: false, zenodo: false }
  const [integrations, setIntegrations] = useState<Integrations>(() => {
    try {
      const stored = localStorage.getItem('humanovo-integrations')
      return stored ? { ...defaultIntegrations, ...(JSON.parse(stored) as Partial<Integrations>) } : defaultIntegrations
    } catch { return defaultIntegrations }
  })

  const toggle = (key: keyof Integrations) => {
    setIntegrations((p) => {
      const next = { ...p, [key]: !p[key] }
      localStorage.setItem('humanovo-integrations', JSON.stringify(next))
      return next
    })
  }

  const items: Array<{ key: keyof Integrations; name: string; description: string }> = [
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

// ── Desktop App Settings ───────────────────────────────────────
// Section only injected when isNativeApp() is true. Surfaces the
// affordances that don't make sense in the web build: a manual
// "Check for updates now" trigger that mirrors the launch-time
// UpdateChecker (commit ad3d61d), and a "Report an issue" external
// link to the GitHub Issues page via openExternal so the OS browser
// owns the Authentication flow with GitHub instead of the WebView.

function DesktopSettings() {
  const [checking, setChecking] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<{ version: string; current: string } | null>(null)
  const [version, setVersion] = useState<string | null>(null)
  const [plat, setPlat] = useState<string | null>(null)
  const [notifPerm, setNotifPerm] = useState<'granted' | 'denied' | 'default' | null>(null)
  const [testingNotif, setTestingNotif] = useState(false)
  const [autostart, setAutostart] = useState<boolean | null>(null)
  const [togglingAutostart, setTogglingAutostart] = useState(false)

  const refreshNotifPerm = useCallback(async () => {
    const p = await getNotificationPermission()
    setNotifPerm(p)
  }, [])

  useEffect(() => {
    // Pull build info eagerly so the rendered values are stable —
    // the user shouldn't see them shift between dashes and the real
    // string after a render. Helpers are no-throw.
    let cancelled = false
    void Promise.all([
      getAppVersion(),
      getPlatform(),
      getNotificationPermission(),
      getAutostartEnabled(),
    ]).then(([v, p, n, a]) => {
      if (cancelled) return
      setVersion(v)
      setPlat(p)
      setNotifPerm(n)
      setAutostart(a)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const toggleAutostart = useCallback(async () => {
    if (autostart === null) return
    setTogglingAutostart(true)
    const next = !autostart
    const ok = await setAutostartEnabled(next)
    if (!ok) {
      toast('error', 'Couldn’t update auto-launch — see console for details.', {
        title: 'humanovo',
      })
    }
    // Re-read so the toggle reflects the actual OS state, not just
    // what we asked for. On macOS the LaunchAgent registration can be
    // declined silently.
    const actual = await getAutostartEnabled()
    setAutostart(actual)
    setTogglingAutostart(false)
  }, [autostart])

  const sendTestNotification = useCallback(async () => {
    setTestingNotif(true)
    try {
      // force: true so notify() doesn't suppress when humanovo has
      // focus — the whole point of the test is to verify the OS
      // surfaces the notification, which we can only confirm if it
      // actually fires.
      const fired = await notify(
        'humanovo',
        'Test notification — discovery completions will look like this.',
        { force: true },
      )
      if (fired) {
        toast('success', 'Notification sent. Check your OS notification centre.', {
          title: 'humanovo',
        })
      } else {
        toast(
          'error',
          'Notification was blocked. Enable notifications for humanovo in your OS settings.',
          { title: 'humanovo' },
        )
      }
      await refreshNotifPerm()
    } finally {
      setTestingNotif(false)
    }
  }, [refreshNotifPerm])

  const checkForUpdates = useCallback(async () => {
    setChecking(true)
    setUpdateInfo(null)
    try {
      const updaterMod = await import('@tauri-apps/plugin-updater')
      const u = await updaterMod.check()
      if (u) {
        setUpdateInfo({ version: u.version, current: u.currentVersion })
        toast(
          'success',
          `Update available — humanovo ${u.version}. Restart-to-install banner is at the bottom-right.`,
          { title: 'humanovo' },
        )
      } else {
        toast('info', 'You’re running the latest version.', { title: 'humanovo' })
      }
    } catch (err) {
      toast(
        'error',
        err instanceof Error ? err.message : 'Update check failed',
        { title: 'humanovo' },
      )
    } finally {
      setChecking(false)
    }
  }, [])

  const reportIssue = useCallback(async () => {
    // Pre-fill the issue body with the full diagnostics block so
    // triage doesn't have to ask "what version / OS / perms?". The
    // user types over the placeholder sections to describe their
    // actual issue.
    const diagnostics = await getDiagnostics()
    const body =
      `**Diagnostics**\n\`\`\`\n${diagnostics}\n\`\`\`\n\n` +
      `**Steps to reproduce**:\n1. \n2. \n\n` +
      `**Expected**:\n\n` +
      `**Actual**:\n`
    const url =
      'https://github.com/satvikOS/humanovo/issues/new?labels=desktop' +
      `&body=${encodeURIComponent(body)}`
    try {
      await openExternal(url)
    } catch (err) {
      toast(
        'error',
        err instanceof Error ? err.message : 'Couldn’t open the browser',
        { title: 'humanovo' },
      )
    }
  }, [])

  const copyDiagnostics = useCallback(async () => {
    try {
      const text = await getDiagnostics()
      await navigator.clipboard.writeText(text)
      toast('success', 'Diagnostics copied. Paste into your support ticket.', {
        title: 'humanovo',
      })
    } catch (err) {
      toast(
        'error',
        err instanceof Error ? err.message : 'Couldn’t copy to clipboard',
        { title: 'humanovo' },
      )
    }
  }, [])

  return (
    <div className="max-w-2xl">
      <h2 className="text-lg font-semibold mb-1" style={{ color: 'var(--color-text)' }}>
        Desktop App
      </h2>
      <p className="text-xs mb-2" style={{ color: 'var(--color-text-muted)' }}>
        Native-shell affordances. The auto-updater also runs ~3 seconds after launch and
        surfaces a Restart-to-install banner when an update is available.
      </p>
      <p className="text-xs mb-6" style={{ color: 'var(--color-text-secondary)' }}>
        humanovo {version ?? '…'} · {plat ?? '…'}
      </p>

      <div className="space-y-4">
        <div
          className="flex items-start justify-between gap-4 p-4 rounded-lg"
          style={{ background: 'var(--glass-bg)', border: '1px solid var(--color-border)' }}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                Notifications
              </div>
              <span
                className="text-[10px] px-1.5 py-0.5 rounded-full"
                style={{
                  background:
                    notifPerm === 'granted'
                      ? 'rgba(34, 197, 94, 0.15)'
                      : notifPerm === 'denied'
                      ? 'rgba(239, 68, 68, 0.15)'
                      : 'var(--color-bg-secondary)',
                  color:
                    notifPerm === 'granted'
                      ? '#16a34a'
                      : notifPerm === 'denied'
                      ? '#dc2626'
                      : 'var(--color-text-muted)',
                }}
              >
                {notifPerm === 'granted'
                  ? 'Allowed'
                  : notifPerm === 'denied'
                  ? 'Blocked'
                  : 'Not yet asked'}
              </span>
            </div>
            <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
              humanovo pings the OS when a discovery finishes (or fails) while you’re
              tabbed away — much easier than babysitting the window. Send a test
              notification to confirm your OS will surface ours.
            </p>
          </div>
          <button
            type="button"
            onClick={sendTestNotification}
            disabled={testingNotif}
            className="text-xs px-3 py-1.5 rounded-md disabled:opacity-50 active:scale-95 shrink-0"
            style={{
              background: 'transparent',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text)',
            }}
          >
            {testingNotif ? 'Sending…' : 'Send test'}
          </button>
        </div>

        <div
          className="flex items-start justify-between gap-4 p-4 rounded-lg"
          style={{ background: 'var(--glass-bg)', border: '1px solid var(--color-border)' }}
        >
          <div className="min-w-0">
            <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
              Launch on login
            </div>
            <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
              Start humanovo automatically when you log in. Convenient for overnight
              discoveries — your morning starts with results in hand instead of with
              waiting for the app to spin up.
            </p>
          </div>
          <Toggle
            enabled={autostart === true}
            disabled={autostart === null || togglingAutostart}
            onChange={toggleAutostart}
          />
        </div>

        <div
          className="flex items-start justify-between gap-4 p-4 rounded-lg"
          style={{ background: 'var(--glass-bg)', border: '1px solid var(--color-border)' }}
        >
          <div className="min-w-0">
            <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
              Check for updates
            </div>
            <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
              Triggers an immediate check against the GitHub Releases manifest. The
              installed version updates only on restart — the banner appears with a
              one-click Restart-to-install button when an update is found.
            </p>
            {updateInfo && (
              <p className="text-xs mt-2" style={{ color: 'var(--color-text-secondary)' }}>
                Available: {updateInfo.version} (current: {updateInfo.current}).
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={checkForUpdates}
            disabled={checking}
            className="text-xs px-3 py-1.5 rounded-md disabled:opacity-50 active:scale-95 shrink-0"
            style={{
              background: 'var(--color-text)',
              color: 'var(--color-bg)',
              fontWeight: 500,
            }}
          >
            {checking ? 'Checking…' : 'Check now'}
          </button>
        </div>

        <div
          className="flex items-start justify-between gap-4 p-4 rounded-lg"
          style={{ background: 'var(--glass-bg)', border: '1px solid var(--color-border)' }}
        >
          <div className="min-w-0">
            <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
              Report an issue
            </div>
            <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
              Opens the humanovo GitHub Issues page in your system browser so the
              GitHub login + 2FA flow happens in your normal browser session, not
              inside the desktop app’s WebView.
            </p>
          </div>
          <div className="flex flex-col gap-2 shrink-0">
            <button
              type="button"
              onClick={reportIssue}
              className="text-xs px-3 py-1.5 rounded-md active:scale-95"
              style={{
                background: 'transparent',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text)',
              }}
            >
              Open issue tracker
            </button>
            <button
              type="button"
              onClick={copyDiagnostics}
              className="text-xs px-3 py-1.5 rounded-md active:scale-95"
              style={{
                background: 'transparent',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text-muted)',
              }}
            >
              Copy diagnostics
            </button>
          </div>
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
  // Desktop section toggles on for the Tauri shell only — gated at
  // runtime via the `__TAURI_INTERNALS__` window-property check inside
  // isNativeApp() so the web build never offers update-check / native-
  // shell affordances that wouldn't work there anyway.
  const isDesktop = isNativeApp()
  const settingsSections = [
    ...BASE_SETTINGS_SECTIONS,
    ...(isDesktop ? [DESKTOP_SECTION] : []),
    ...(isDevEnv ? [ADMIN_SECTION] : []),
  ]
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
     
  }, [])

  const renderContent = () => {
    switch (activeSection) {
      case 'appearance':
        return <AppearanceSettings />
      case 'account':
        return <AccountSettings />
      case 'billing':
        return <UsageBillingSettings />
      case 'kg-contributions':
        return <KGContributionsSettings />
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
      case 'desktop':
        return <DesktopSettings />
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
