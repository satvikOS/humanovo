import { useState, useEffect, useCallback } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
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

const settingsSections = [
  { id: 'appearance', label: 'Appearance', icon: FiMonitor },
  { id: 'account', label: 'Account', icon: FiUser },
  { id: 'notifications', label: 'Notifications', icon: FiBell },
  { id: 'privacy', label: 'Privacy & Security', icon: FiShield },
  { id: 'data', label: 'Data & Storage', icon: FiDatabase },
  { id: 'integrations', label: 'Integrations', icon: FiGlobe },
  { id: 'billing', label: 'Usage & Billing', icon: FiDatabase, link: '/settings/billing' },
]

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!enabled)}
      className={clsx(
        'relative w-9 h-5 rounded-full transition-colors',
        enabled ? 'bg-accent-blue' : 'bg-white/10'
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
                ? 'border-accent-blue bg-accent-blue/5'
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
              <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-accent-blue flex items-center justify-center">
                <FiCheck className="w-3 h-3 text-white" />
              </div>
            )}
          </button>

          <button
            onClick={() => setTheme('light')}
            className={clsx(
              'relative p-4 rounded-lg border-2 transition-colors text-left',
              theme === 'light'
                ? 'border-accent-blue bg-accent-blue/5'
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
              <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-accent-blue flex items-center justify-center">
                <FiCheck className="w-3 h-3 text-white" />
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
  const [emailNotifs, setEmailNotifs] = useState(true)
  const [pushNotifs, setPushNotifs] = useState(true)
  const [soundEnabled, setSoundEnabled] = useState(false)
  const [notifyOnEvidence, setNotifyOnEvidence] = useState(true)
  const [notifyOnSimulation, setNotifyOnSimulation] = useState(true)
  const [notifyOnMention, setNotifyOnMention] = useState(true)

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-medium mb-4">Notification Channels</h3>
        <div className="glass-card">
          <SettingRow title="Email Notifications" description="Receive notifications via email">
            <Toggle enabled={emailNotifs} onChange={setEmailNotifs} />
          </SettingRow>
          <SettingRow title="Push Notifications" description="Receive browser push notifications">
            <Toggle enabled={pushNotifs} onChange={setPushNotifs} />
          </SettingRow>
          <SettingRow title="Sound" description="Play a sound for notifications">
            <Toggle enabled={soundEnabled} onChange={setSoundEnabled} />
          </SettingRow>
        </div>
      </div>

      <div>
        <h3 className="text-base font-medium mb-4">Notification Types</h3>
        <div className="glass-card">
          <SettingRow title="New Evidence" description="When new evidence is ingested into your projects">
            <Toggle enabled={notifyOnEvidence} onChange={setNotifyOnEvidence} />
          </SettingRow>
          <SettingRow title="Simulation Complete" description="When a simulation finishes running">
            <Toggle enabled={notifyOnSimulation} onChange={setNotifyOnSimulation} />
          </SettingRow>
          <SettingRow title="Mentions" description="When someone mentions you in a comment">
            <Toggle enabled={notifyOnMention} onChange={setNotifyOnMention} />
          </SettingRow>
        </div>
      </div>
    </div>
  )
}

function DataSettings() {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-medium mb-4">Storage</h3>
        <div className="glass-card">
          <div className="mb-4">
            <div className="flex items-center justify-between text-sm mb-2">
              <span>Storage Used</span>
              <span className="text-[var(--color-text-muted)]">2.4 GB / 10 GB</span>
            </div>
            <div className="h-2 bg-white/5 rounded-full overflow-hidden">
              <div className="h-full w-[24%] bg-accent-blue rounded-full" />
            </div>
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-[var(--color-text-muted)]">Evidence Documents</span>
              <span>1.8 GB</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[var(--color-text-muted)]">Simulation Data</span>
              <span>420 MB</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[var(--color-text-muted)]">Notebook Attachments</span>
              <span>180 MB</span>
            </div>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-base font-medium mb-4">Data Management</h3>
        <div className="glass-card">
          <SettingRow title="Export All Data" description="Download all your projects, hypotheses, and evidence">
            <button className="btn text-accent-blue hover:bg-accent-blue/10 text-xs">Export</button>
          </SettingRow>
          <SettingRow title="Clear Cache" description="Remove cached data to free up space">
            <button className="btn text-[var(--color-text-secondary)] hover:bg-white/5 text-xs">Clear</button>
          </SettingRow>
          <SettingRow title="Delete All Data" description="Permanently delete all your data. This cannot be undone.">
            <button className="btn text-red-400 hover:bg-red-400/10 text-xs">Delete</button>
          </SettingRow>
        </div>
      </div>
    </div>
  )
}


export default function Settings() {
  const [searchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const [activeSection, setActiveSection] = useState(
    tabParam && settingsSections.some(s => s.id === tabParam) ? tabParam : 'appearance'
  )

  useEffect(() => {
    if (tabParam && settingsSections.some(s => s.id === tabParam)) {
      setActiveSection(tabParam)
    }
  }, [tabParam])

  const renderContent = () => {
    switch (activeSection) {
      case 'appearance':
        return <AppearanceSettings />
      case 'notifications':
        return <NotificationSettings />
      case 'data':
        return <DataSettings />
      default:
        return (
          <div className="flex items-center justify-center h-64 text-[var(--color-text-muted)]">
            <span className="text-sm">Coming soon</span>
          </div>
        )
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
