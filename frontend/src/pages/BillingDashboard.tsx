/**
 * BillingDashboard — Full billing & usage dashboard
 * Route: /settings/billing
 * Sections: Summary cards, daily spend chart, cost breakdown, project costs table, budget management
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  FiDollarSign, FiTrendingUp, FiPieChart, FiGrid,
  FiList, FiEdit3, FiAlertTriangle, FiChevronDown,
  FiChevronUp, FiPlus, FiX, FiCheck, FiSliders,
  FiClock, FiZap, FiRefreshCw, FiTarget, FiActivity,
} from 'react-icons/fi'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts'
import clsx from 'clsx'

// ── Shared chart styles ──────────────────────────────────────
const CHART_TOOLTIP_STYLE = {
  backgroundColor: 'rgba(17, 17, 17, 0.95)',
  border: '1px solid rgba(255, 255, 255, 0.1)',
  borderRadius: '8px',
  padding: '8px 12px',
  fontSize: '12px',
  color: '#fff',
  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
}

const MODEL_COLORS = ['#10b981', '#6366f1', '#f59e0b', '#3b82f6', '#ec4899', '#8b5cf6']
const STAGE_COLORS = ['#06b6d4', '#f97316', '#84cc16', '#e879f9', '#3b82f6']

// ── Types ────────────────────────────────────────────────────

interface BillingSummary {
  current_month_spend_cents: number
  budget_cents: number
  projected_spend_cents: number
  total_requests: number
}

interface DailySpend {
  date: string
  cost_cents: number
}

interface ModelBreakdown {
  name: string
  cost_cents: number
}

interface StageBreakdown {
  name: string
  cost_cents: number
}

interface ProjectCost {
  project_name: string
  total_cost_cents: number
  runs: number
  last_activity: string
}

interface BudgetConfig {
  id: string
  name: string
  monthly_budget_cents: number
  spent_cents: number
  alert_threshold_pct: number
  hard_limit: boolean
  scope: 'global' | 'project'
}

// ── Helpers ──────────────────────────────────────────────────

function formatUSD(cents: number) {
  const n = Number.isFinite(cents) ? cents : 0
  return `$${(n / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function budgetColor(pct: number): string {
  if (pct < 60) return '#10b981'
  if (pct < 85) return '#f59e0b'
  return '#ef4444'
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const hours = Math.floor(diff / 3600000)
  if (hours < 1) return 'Just now'
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

// ── Budget Edit Modal ────────────────────────────────────────

function BudgetModal({
  budget,
  onSave,
  onClose,
}: {
  budget: BudgetConfig
  onSave: (b: BudgetConfig) => void
  onClose: () => void
}) {
  const [monthlyBudgetDollars, setMonthlyBudgetDollars] = useState((budget.monthly_budget_cents / 100).toFixed(0))
  const [alertThreshold, setAlertThreshold] = useState(budget.alert_threshold_pct)
  const [hardLimit, setHardLimit] = useState(budget.hard_limit)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="glass-card p-6 w-full max-w-md space-y-5 animate-in fade-in" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">Edit Budget &mdash; {budget.name}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors text-[var(--color-text-muted)] hover:text-white">
            <FiX className="w-4 h-4" />
          </button>
        </div>

        <div>
          <label className="block text-sm text-[var(--color-text-muted)] mb-1">Monthly Budget (USD)</label>
          <input
            type="number"
            value={monthlyBudgetDollars}
            onChange={e => setMonthlyBudgetDollars(e.target.value)}
            className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-blue)]/40"
          />
        </div>

        <div>
          <label className="block text-sm text-[var(--color-text-muted)] mb-1">
            Alert Threshold: <span className="text-white font-medium">{alertThreshold}%</span>
          </label>
          <input
            type="range"
            min={10}
            max={100}
            value={alertThreshold}
            onChange={e => setAlertThreshold(+e.target.value)}
            className="w-full accent-[var(--color-accent-blue)]"
          />
          <div className="flex justify-between text-xs text-[var(--color-text-muted)]">
            <span>10%</span><span>100%</span>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-white">Hard Limit</div>
            <div className="text-xs text-[var(--color-text-muted)]">Block runs when budget exceeded</div>
          </div>
          <button
            onClick={() => setHardLimit(!hardLimit)}
            className={clsx(
              'relative w-11 h-6 rounded-full transition-colors',
              hardLimit ? 'bg-[var(--color-accent-blue)]' : 'bg-white/15'
            )}
          >
            <span
              className={clsx(
                'absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform',
                hardLimit && 'translate-x-5'
              )}
            />
          </button>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg border border-white/10 text-sm text-[var(--color-text-muted)] hover:bg-white/5 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave({
              ...budget,
              monthly_budget_cents: Math.round(parseFloat(monthlyBudgetDollars || '0') * 100),
              alert_threshold_pct: alertThreshold,
              hard_limit: hardLimit,
            })}
            className="flex-1 px-4 py-2 rounded-lg bg-[var(--color-accent-blue)] text-white text-sm font-medium hover:opacity-90 transition-opacity flex items-center justify-center gap-1"
          >
            <FiCheck className="w-4 h-4" /> Save
          </button>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
// ██  BILLING DASHBOARD  ██████████████████████████████████████
// ══════════════════════════════════════════════════════════════

export default function BillingDashboard() {
  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState<BillingSummary | null>(null)
  const [daily, setDaily] = useState<DailySpend[]>([])
  const [modelBreakdown, setModelBreakdown] = useState<ModelBreakdown[]>([])
  const [stageBreakdown, setStageBreakdown] = useState<StageBreakdown[]>([])
  const [projectCosts, setProjectCosts] = useState<ProjectCost[]>([])
  const [budgets, setBudgets] = useState<BudgetConfig[]>([])
  const [editingBudget, setEditingBudget] = useState<BudgetConfig | null>(null)
  const [projectSort, setProjectSort] = useState<{ col: string; dir: 'asc' | 'desc' }>({ col: 'total_cost_cents', dir: 'desc' })

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [summaryRes, dailyRes, breakdownRes, projectsRes, budgetsRes] = await Promise.allSettled([
        fetch('/api/v1/billing/summary').then(r => r.ok ? r.json() : null),
        fetch('/api/v1/billing/daily').then(r => r.ok ? r.json() : null),
        fetch('/api/v1/billing/breakdown').then(r => r.ok ? r.json() : null),
        fetch('/api/v1/billing/projects').then(r => r.ok ? r.json() : null),
        fetch('/api/v1/billing/budgets').then(r => r.ok ? r.json() : null),
      ])

      setSummary(
        summaryRes.status === 'fulfilled' && summaryRes.value
          ? summaryRes.value
          : null
      )

      const dailyVal = dailyRes.status === 'fulfilled' && dailyRes.value
        ? (Array.isArray(dailyRes.value) ? dailyRes.value : dailyRes.value.items || [])
        : []
      setDaily(dailyVal)

      if (breakdownRes.status === 'fulfilled' && breakdownRes.value) {
        const bd = breakdownRes.value
        setModelBreakdown(Array.isArray(bd.by_model) ? bd.by_model : [])
        setStageBreakdown(Array.isArray(bd.by_stage) ? bd.by_stage : [])
      } else {
        setModelBreakdown([])
        setStageBreakdown([])
      }

      const pVal = projectsRes.status === 'fulfilled' && projectsRes.value
        ? (Array.isArray(projectsRes.value) ? projectsRes.value : projectsRes.value.items || [])
        : []
      setProjectCosts(pVal)

      const bVal = budgetsRes.status === 'fulfilled' && budgetsRes.value
        ? (Array.isArray(budgetsRes.value) ? budgetsRes.value : budgetsRes.value.items || [])
        : []
      setBudgets(bVal)
    } catch {
      setSummary(null)
      setDaily([])
      setModelBreakdown([])
      setStageBreakdown([])
      setProjectCosts([])
      setBudgets([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  // ── Derived ────────────────────────────────────────────────
  const spendCents = summary?.current_month_spend_cents ?? 0
  const budgetCents = summary?.budget_cents ?? 0
  const budgetRemaining = Math.max(0, budgetCents - spendCents)
  const projectedCents = summary?.projected_spend_cents ?? 0

  const dailyChart = useMemo(() =>
    daily.map(d => ({ date: d.date, cost: d.cost_cents / 100 })),
    [daily]
  )

  const modelPieData = useMemo(() =>
    modelBreakdown.map(m => ({ name: m.name, value: m.cost_cents / 100 })),
    [modelBreakdown]
  )

  const stageBarData = useMemo(() =>
    stageBreakdown.map(s => ({ name: s.name, cost: s.cost_cents / 100 })),
    [stageBreakdown]
  )

  const sortedProjects = useMemo(() => {
    return [...projectCosts].sort((a, b) => {
      const col = projectSort.col as keyof ProjectCost
      const av = a[col]
      const bv = b[col]
      if (typeof av === 'number' && typeof bv === 'number') {
        return projectSort.dir === 'asc' ? av - bv : bv - av
      }
      return projectSort.dir === 'asc'
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av))
    })
  }, [projectCosts, projectSort])

  const toggleSort = useCallback((col: string) => {
    setProjectSort(prev =>
      prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'desc' }
    )
  }, [])

  const handleBudgetSave = useCallback((updated: BudgetConfig) => {
    setBudgets(prev => {
      const exists = prev.find(b => b.id === updated.id)
      if (exists) return prev.map(b => b.id === updated.id ? updated : b)
      return [...prev, updated]
    })
    setEditingBudget(null)
  }, [])

  // ── Loading state ──────────────────────────────────────────
  if (loading) {
    return (
      <div className="p-6 lg:p-8 max-w-[1400px] mx-auto">
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-white/20 border-t-[var(--color-accent-blue)] rounded-full animate-spin" />
            <span className="text-sm text-[var(--color-text-muted)]">Loading billing data...</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 lg:p-8 max-w-[1400px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-white flex items-center gap-3">
            <FiDollarSign className="w-7 h-7 text-[var(--color-accent-green)]" />
            Billing & Usage
          </h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            Monitor API spend, usage metrics, and budget controls
          </p>
        </div>
        <button
          onClick={loadData}
          className="btn text-[var(--color-text-muted)] hover:text-white p-2"
          title="Refresh"
        >
          <FiRefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* ── Section 1: Summary Cards ─────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="glass-card p-5 flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-emerald-500/10">
            <FiDollarSign className="w-5 h-5 text-[var(--color-text-secondary)]" />
          </div>
          <div>
            <div className="text-2xl font-bold text-white">{formatUSD(spendCents)}</div>
            <div className="text-xs text-[var(--color-text-muted)]">Current Month Spend</div>
          </div>
        </div>

        <div className="glass-card p-5 flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-blue-500/10">
            <FiTarget className="w-5 h-5 text-[var(--color-text-secondary)]" />
          </div>
          <div>
            <div className="text-2xl font-bold text-white">{formatUSD(budgetRemaining)}</div>
            <div className="text-xs text-[var(--color-text-muted)]">Budget Remaining</div>
          </div>
        </div>

        <div className="glass-card p-5 flex items-center gap-3">
          <div className="p-2.5 rounded-lg" style={{ backgroundColor: projectedCents > budgetCents ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)' }}>
            <FiTrendingUp className="w-5 h-5" style={{ color: projectedCents > budgetCents ? '#ef4444' : '#f59e0b' }} />
          </div>
          <div>
            <div className="text-2xl font-bold text-white">{formatUSD(projectedCents)}</div>
            <div className="text-xs text-[var(--color-text-muted)] flex items-center gap-1">
              Projected End-of-Month
              {projectedCents > budgetCents && (
                <span className="text-[var(--color-text-muted)] flex items-center gap-0.5">
                  <FiAlertTriangle className="w-3 h-3" /> Over
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="glass-card p-5 flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-purple-500/10">
            <FiActivity className="w-5 h-5 text-[var(--color-text-secondary)]" />
          </div>
          <div>
            <div className="text-2xl font-bold text-white">{(summary?.total_requests ?? 0).toLocaleString()}</div>
            <div className="text-xs text-[var(--color-text-muted)]">Total Requests</div>
          </div>
        </div>
      </div>

      {/* ── Section 2: Daily Spend Chart ─────────────────── */}
      <div className="glass-card p-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <FiTrendingUp className="w-5 h-5 text-[var(--color-accent-blue)]" />
          Daily Spend &mdash; Last 30 Days
        </h2>
        {dailyChart.length > 0 ? (
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailyChart} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="dailyGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={v => v.slice(5)}
                />
                <YAxis
                  tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={v => `$${v}`}
                />
                <Tooltip
                  contentStyle={CHART_TOOLTIP_STYLE}
                  formatter={(value) => [`$${Number(value).toFixed(2)}`, 'Daily Spend']}
                  labelStyle={{ color: 'rgba(255,255,255,0.6)', fontSize: '11px' }}
                />
                <Area
                  type="monotone"
                  dataKey="cost"
                  stroke="#6366f1"
                  fill="url(#dailyGrad)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="flex items-center justify-center py-16 text-sm text-[var(--color-text-muted)]">
            No daily spend data yet
          </div>
        )}
      </div>

      {/* ── Section 3: Cost Breakdown ────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* By Model - Pie */}
        <div className="glass-card p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <FiPieChart className="w-5 h-5 text-[var(--color-accent-purple)]" />
            Cost by Model
          </h2>
          {modelPieData.length > 0 ? (
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={modelPieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={95}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {modelPieData.map((_, idx) => (
                      <Cell key={idx} fill={MODEL_COLORS[idx % MODEL_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={CHART_TOOLTIP_STYLE}
                    formatter={(value) => [`$${Number(value).toFixed(2)}`, 'Cost']}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: '11px' }}
                    formatter={(value) => <span style={{ color: 'rgba(255,255,255,0.7)' }}>{value}</span>}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex items-center justify-center py-16 text-sm text-[var(--color-text-muted)]">
              No model cost data yet
            </div>
          )}
        </div>

        {/* By Pipeline Stage - Bar */}
        <div className="glass-card p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <FiGrid className="w-5 h-5 text-[var(--color-accent-cyan)]" />
            Cost by Pipeline Stage
          </h2>
          {stageBarData.length > 0 ? (
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stageBarData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={v => `$${v}`}
                  />
                  <Tooltip
                    contentStyle={CHART_TOOLTIP_STYLE}
                    formatter={(value) => [`$${Number(value).toFixed(2)}`, 'Cost']}
                    labelStyle={{ color: 'rgba(255,255,255,0.6)', fontSize: '11px' }}
                  />
                  <Bar dataKey="cost" radius={[4, 4, 0, 0]}>
                    {stageBarData.map((_, idx) => (
                      <Cell key={idx} fill={STAGE_COLORS[idx % STAGE_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex items-center justify-center py-16 text-sm text-[var(--color-text-muted)]">
              No stage cost data yet
            </div>
          )}
        </div>
      </div>

      {/* ── Section 4: Project Costs Table ───────────────── */}
      <div className="glass-card p-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <FiList className="w-5 h-5 text-[var(--color-accent-blue)]" />
          Project Costs
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10">
                {[
                  { key: 'project_name', label: 'Project Name' },
                  { key: 'total_cost_cents', label: 'Total Cost' },
                  { key: 'runs', label: 'Runs' },
                  { key: 'last_activity', label: 'Last Activity' },
                ].map(col => (
                  <th
                    key={col.key}
                    onClick={() => toggleSort(col.key)}
                    className="text-left py-3 px-4 text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider cursor-pointer hover:text-white transition-colors select-none"
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.label}
                      {projectSort.col === col.key && (
                        projectSort.dir === 'asc'
                          ? <FiChevronUp className="w-3 h-3" />
                          : <FiChevronDown className="w-3 h-3" />
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedProjects.map((p, i) => (
                <tr
                  key={p.project_name}
                  className={clsx(
                    'border-b border-white/5 hover:bg-white/5 transition-colors',
                    i % 2 === 0 && 'bg-white/[0.02]'
                  )}
                >
                  <td className="py-3 px-4 font-medium text-white">{p.project_name}</td>
                  <td className="py-3 px-4 font-medium text-white">{formatUSD(p.total_cost_cents)}</td>
                  <td className="py-3 px-4 text-[var(--color-text-muted)]">{p.runs}</td>
                  <td className="py-3 px-4 text-[var(--color-text-muted)] flex items-center gap-1">
                    <FiClock className="w-3 h-3" />
                    {formatRelativeTime(p.last_activity)}
                  </td>
                </tr>
              ))}
              {sortedProjects.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-[var(--color-text-muted)] text-sm">
                    No project cost data available
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Section 5: Budget Management ─────────────────── */}
      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <FiZap className="w-5 h-5 text-[var(--color-accent-orange)]" />
            Budget Management
          </h2>
          <div className="flex gap-2">
            <button
              onClick={() =>
                setEditingBudget({
                  id: `b-${Date.now()}`,
                  name: 'New Project Budget',
                  monthly_budget_cents: 10000,
                  spent_cents: 0,
                  alert_threshold_pct: 80,
                  hard_limit: false,
                  scope: 'project',
                })
              }
              className="px-3 py-1.5 rounded-lg border border-white/10 text-xs font-medium text-[var(--color-text-muted)] hover:text-white hover:bg-white/5 transition-colors flex items-center gap-1"
            >
              <FiPlus className="w-3.5 h-3.5" />
              Add Budget
            </button>
            <button
              onClick={() => {
                const g = budgets.find(b => b.scope === 'global')
                if (g) setEditingBudget(g)
              }}
              className="px-3 py-1.5 rounded-lg bg-[var(--color-accent-blue)] text-white text-xs font-medium hover:opacity-90 transition-opacity flex items-center gap-1"
            >
              <FiSliders className="w-3.5 h-3.5" />
              Set Budget
            </button>
          </div>
        </div>

        <div className="space-y-3">
          {budgets.map(b => {
            const pct = b.monthly_budget_cents > 0
              ? Math.min((b.spent_cents / b.monthly_budget_cents) * 100, 100)
              : 0
            return (
              <div
                key={b.id}
                className="flex items-center gap-4 p-4 rounded-xl bg-white/[0.03] border border-white/5 hover:border-white/10 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="font-medium text-sm text-white truncate">{b.name}</span>
                    {b.scope === 'global' && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--color-accent-blue)]/15 text-[var(--color-accent-blue)]">
                        GLOBAL
                      </span>
                    )}
                    {b.hard_limit && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-500/15 text-[var(--color-text-muted)]">
                        HARD LIMIT
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-2.5 rounded-full bg-white/10 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${pct}%`, backgroundColor: budgetColor(pct) }}
                      />
                    </div>
                    <span className="text-xs text-[var(--color-text-muted)] whitespace-nowrap">
                      {formatUSD(b.spent_cents)} / {formatUSD(b.monthly_budget_cents)}
                    </span>
                  </div>
                  <div className="text-[10px] text-[var(--color-text-muted)] mt-1">
                    Alert at {b.alert_threshold_pct}%
                    {pct >= b.alert_threshold_pct && (
                      <span className="text-[var(--color-text-muted)] ml-2 inline-flex items-center gap-0.5">
                        <FiAlertTriangle className="w-2.5 h-2.5" /> Threshold reached
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => setEditingBudget(b)}
                  className="p-2 rounded-lg hover:bg-white/10 transition-colors text-[var(--color-text-muted)] hover:text-white"
                >
                  <FiEdit3 className="w-4 h-4" />
                </button>
              </div>
            )
          })}

          {budgets.length === 0 && (
            <div className="text-center py-8">
              <FiSliders className="w-8 h-8 text-[var(--color-text-muted)] mx-auto mb-3 opacity-30" />
              <p className="text-sm text-[var(--color-text-muted)]">No budgets configured yet</p>
            </div>
          )}
        </div>
      </div>

      {/* Budget Modal */}
      {editingBudget && (
        <BudgetModal
          budget={editingBudget}
          onSave={handleBudgetSave}
          onClose={() => setEditingBudget(null)}
        />
      )}
    </div>
  )
}
