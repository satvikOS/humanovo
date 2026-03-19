import { useState, useMemo, useCallback } from 'react'
import {
  FiDollarSign, FiTrendingUp, FiPieChart, FiGrid,
  FiList, FiEdit3, FiAlertTriangle, FiChevronDown,
  FiChevronUp, FiChevronLeft, FiChevronRight, FiPlus,
  FiX, FiCheck, FiSliders, FiClock, FiZap,
} from 'react-icons/fi'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts'
import clsx from 'clsx'

// ── Tooltip styling (shared) ──────────────────────────────────
const CHART_TOOLTIP_STYLE = {
  backgroundColor: 'rgba(17, 17, 17, 0.95)',
  border: '1px solid rgba(255, 255, 255, 0.1)',
  borderRadius: '8px',
  padding: '8px 12px',
  fontSize: '12px',
  color: '#fff',
  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
}

// ── Colors ────────────────────────────────────────────────────
const PROVIDER_COLORS: Record<string, string> = {
  'OpenAI': '#10b981',
  'Anthropic': '#6366f1',
  'Cohere': '#f59e0b',
  'Google': '#3b82f6',
}

const MODEL_COLORS = ['#10b981', '#6366f1', '#f59e0b', '#3b82f6', '#ec4899', '#8b5cf6']
const PIPELINE_COLORS = ['#06b6d4', '#f97316', '#84cc16', '#e879f9']

// ── Mock data ─────────────────────────────────────────────────

function generateDailySpend(days: number) {
  const data = []
  const now = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    data.push({
      date: d.toISOString().slice(0, 10),
      OpenAI: +(Math.random() * 12 + 3).toFixed(2),
      Anthropic: +(Math.random() * 18 + 5).toFixed(2),
      Cohere: +(Math.random() * 6 + 1).toFixed(2),
      Google: +(Math.random() * 8 + 2).toFixed(2),
    })
  }
  return data
}

const MOCK_DAILY_SPEND_90 = generateDailySpend(90)

const MOCK_COST_BY_MODEL = [
  { name: 'GPT-4o', value: 142.30 },
  { name: 'Claude Opus', value: 198.50 },
  { name: 'Claude Sonnet', value: 87.20 },
  { name: 'Cohere Command-R+', value: 42.60 },
  { name: 'Gemini 1.5 Pro', value: 63.40 },
  { name: 'GPT-4o-mini', value: 18.90 },
]

const MOCK_COST_BY_PIPELINE = [
  { name: 'Discovery', value: 285.40 },
  { name: 'Synthesis', value: 147.20 },
  { name: 'Evidence Grounding', value: 68.90 },
  { name: 'Literature Review', value: 51.40 },
]

const MOCK_PROJECTS = [
  { name: 'Alzheimer\'s TREM2', disease: 'Alzheimer\'s', discoveryRuns: 12, synthesisRuns: 8, totalCost: 142.80, avgCostPerRun: 7.14 },
  { name: 'BRCA2 Resistance', disease: 'Breast Cancer', discoveryRuns: 9, synthesisRuns: 5, totalCost: 98.40, avgCostPerRun: 7.03 },
  { name: 'GLP-1 Neuroplasticity', disease: 'Parkinson\'s', discoveryRuns: 15, synthesisRuns: 11, totalCost: 187.60, avgCostPerRun: 7.22 },
  { name: 'CAR-T Optimization', disease: 'Lymphoma', discoveryRuns: 7, synthesisRuns: 4, totalCost: 67.20, avgCostPerRun: 6.11 },
  { name: 'CRISPR Off-Target', disease: 'Sickle Cell', discoveryRuns: 6, synthesisRuns: 3, totalCost: 54.30, avgCostPerRun: 6.03 },
  { name: 'mRNA Delivery Vectors', disease: 'Influenza', discoveryRuns: 4, synthesisRuns: 2, totalCost: 32.60, avgCostPerRun: 5.43 },
]

const MOCK_USAGE_ROWS = Array.from({ length: 200 }, (_, i) => {
  const models = ['gpt-4o', 'claude-opus-4-20250514', 'claude-sonnet-4-20250514', 'command-r-plus', 'gemini-1.5-pro']
  const projects = ['Alzheimer\'s TREM2', 'BRCA2 Resistance', 'GLP-1 Neuroplasticity', 'CAR-T Optimization']
  const runTypes = ['Discovery', 'Synthesis', 'Evidence', 'Literature']
  const stages = ['hypothesis-gen', 'evidence-grounding', 'synthesis-merge', 'literature-scan', 'ranking']
  const statuses = ['success', 'success', 'success', 'success', 'error', 'timeout'] as const
  const ts = new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000)
  const tokIn = Math.floor(Math.random() * 8000 + 500)
  const tokOut = Math.floor(Math.random() * 4000 + 200)
  return {
    id: `usage-${i}`,
    timestamp: ts.toISOString(),
    project: projects[Math.floor(Math.random() * projects.length)],
    runType: runTypes[Math.floor(Math.random() * runTypes.length)],
    stage: stages[Math.floor(Math.random() * stages.length)],
    model: models[Math.floor(Math.random() * models.length)],
    tokensIn: tokIn,
    tokensOut: tokOut,
    cost: +((tokIn * 0.003 + tokOut * 0.006) / 1000 * (Math.random() * 2 + 0.5)).toFixed(4),
    latency: +(Math.random() * 12 + 0.5).toFixed(2),
    status: statuses[Math.floor(Math.random() * statuses.length)],
  }
}).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

interface BudgetConfig {
  id: string
  name: string
  monthlyBudget: number
  alertThreshold: number
  hardLimit: boolean
  scope: 'global' | 'project'
}

const MOCK_BUDGETS: BudgetConfig[] = [
  { id: 'b1', name: 'Global Budget', monthlyBudget: 800, alertThreshold: 80, hardLimit: false, scope: 'global' },
  { id: 'b2', name: 'Alzheimer\'s TREM2', monthlyBudget: 200, alertThreshold: 75, hardLimit: true, scope: 'project' },
  { id: 'b3', name: 'BRCA2 Resistance', monthlyBudget: 150, alertThreshold: 80, hardLimit: false, scope: 'project' },
]

// ── Helpers ───────────────────────────────────────────────────

type SortDir = 'asc' | 'desc'

function formatUSD(n: number) {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function budgetColor(pct: number): string {
  if (pct < 60) return 'var(--color-success, #10b981)'
  if (pct < 85) return 'var(--color-warning, #f59e0b)'
  return 'var(--color-error, #ef4444)'
}

function statusBadge(s: string) {
  const map: Record<string, string> = {
    success: 'bg-emerald-500/15 text-emerald-400',
    error: 'bg-red-500/15 text-red-400',
    timeout: 'bg-amber-500/15 text-amber-400',
  }
  return map[s] ?? 'bg-white/10 text-white/60'
}

// ── Budget Edit Modal ─────────────────────────────────────────

function BudgetModal({
  budget,
  onSave,
  onClose,
}: {
  budget: BudgetConfig
  onSave: (b: BudgetConfig) => void
  onClose: () => void
}) {
  const [monthlyBudget, setMonthlyBudget] = useState(budget.monthlyBudget)
  const [alertThreshold, setAlertThreshold] = useState(budget.alertThreshold)
  const [hardLimit, setHardLimit] = useState(budget.hardLimit)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="glass-card p-6 w-full max-w-md space-y-5 animate-in fade-in">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Edit Budget — {budget.name}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
            <FiX className="w-4 h-4" />
          </button>
        </div>

        {/* Monthly budget */}
        <div>
          <label className="block text-sm text-[var(--color-text-muted)] mb-1">Monthly Budget (USD)</label>
          <input
            type="number"
            value={monthlyBudget}
            onChange={e => setMonthlyBudget(+e.target.value)}
            className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/40"
          />
        </div>

        {/* Alert threshold slider */}
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
            className="w-full accent-[var(--color-accent)]"
          />
          <div className="flex justify-between text-xs text-[var(--color-text-muted)]">
            <span>10%</span><span>100%</span>
          </div>
        </div>

        {/* Hard limit toggle */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Hard Limit</div>
            <div className="text-xs text-[var(--color-text-muted)]">Block runs when budget exceeded</div>
          </div>
          <button
            onClick={() => setHardLimit(!hardLimit)}
            className={clsx(
              'relative w-11 h-6 rounded-full transition-colors',
              hardLimit ? 'bg-[var(--color-accent)]' : 'bg-white/15'
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
            className="flex-1 px-4 py-2 rounded-lg border border-white/10 text-sm hover:bg-white/5 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave({ ...budget, monthlyBudget, alertThreshold, hardLimit })}
            className="flex-1 px-4 py-2 rounded-lg bg-[var(--color-accent)] text-white text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <FiCheck className="inline w-4 h-4 mr-1 -mt-0.5" /> Save
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
  // ── State ──────────────────────────────────────────────────
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d'>('30d')
  const [projectSort, setProjectSort] = useState<{ col: string; dir: SortDir }>({ col: 'totalCost', dir: 'desc' })
  const [usagePage, setUsagePage] = useState(0)
  const [expandedRow, setExpandedRow] = useState<string | null>(null)
  const [budgets, setBudgets] = useState<BudgetConfig[]>(MOCK_BUDGETS)
  const [editingBudget, setEditingBudget] = useState<BudgetConfig | null>(null)

  // ── Derived ────────────────────────────────────────────────
  const totalSpend = 552.90
  const monthlyBudget = budgets.find(b => b.scope === 'global')?.monthlyBudget ?? 800
  const budgetPct = Math.min((totalSpend / monthlyBudget) * 100, 100)
  const projectedSpend = +(totalSpend * (30 / 19)).toFixed(2) // ~19 days into month

  const dailySpend = useMemo(() => {
    const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90
    return MOCK_DAILY_SPEND_90.slice(-days)
  }, [timeRange])

  const sortedProjects = useMemo(() => {
    const col = projectSort.col as keyof typeof MOCK_PROJECTS[0]
    return [...MOCK_PROJECTS].sort((a, b) => {
      const av = a[col] as number, bv = b[col] as number
      return projectSort.dir === 'asc' ? av - bv : bv - av
    })
  }, [projectSort])

  const pagedUsage = useMemo(() => {
    return MOCK_USAGE_ROWS.slice(usagePage * 50, (usagePage + 1) * 50)
  }, [usagePage])
  const totalUsagePages = Math.ceil(MOCK_USAGE_ROWS.length / 50)

  const toggleProjectSort = useCallback((col: string) => {
    setProjectSort(prev =>
      prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'desc' }
    )
  }, [])

  const handleBudgetSave = useCallback((updated: BudgetConfig) => {
    setBudgets(prev => prev.map(b => b.id === updated.id ? updated : b))
    setEditingBudget(null)
  }, [])

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      {/* Page title */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <FiDollarSign className="w-6 h-6 text-[var(--color-accent)]" />
            Billing &amp; Usage
          </h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            Monitor API spend, usage metrics, and budget controls
          </p>
        </div>
      </div>

      {/* ── Section 1: Current Month Summary ─────────────── */}
      <div className="glass-card p-6">
        <div className="flex flex-col md:flex-row md:items-end gap-6">
          {/* Total spend */}
          <div className="flex-1">
            <div className="text-sm text-[var(--color-text-muted)] mb-1">Current Month Spend</div>
            <div className="text-4xl font-bold tracking-tight">{formatUSD(totalSpend)}</div>
            <div className="text-xs text-[var(--color-text-muted)] mt-1">
              of {formatUSD(monthlyBudget)} budget
            </div>
          </div>

          {/* Budget bar */}
          <div className="flex-1 min-w-[200px]">
            <div className="flex items-center justify-between text-xs text-[var(--color-text-muted)] mb-1.5">
              <span>Budget usage</span>
              <span style={{ color: budgetColor(budgetPct) }}>{budgetPct.toFixed(1)}%</span>
            </div>
            <div className="h-3 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${budgetPct}%`, backgroundColor: budgetColor(budgetPct) }}
              />
            </div>
          </div>

          {/* Projected */}
          <div className="text-right">
            <div className="text-sm text-[var(--color-text-muted)] mb-1">Projected End-of-Month</div>
            <div className="text-2xl font-semibold" style={{ color: projectedSpend > monthlyBudget ? 'var(--color-error)' : 'var(--color-success)' }}>
              {formatUSD(projectedSpend)}
            </div>
            {projectedSpend > monthlyBudget && (
              <div className="flex items-center gap-1 text-xs text-[var(--color-error)] mt-1 justify-end">
                <FiAlertTriangle className="w-3 h-3" /> Over budget
              </div>
            )}
          </div>

          {/* Set Budget btn */}
          <button
            onClick={() => {
              const g = budgets.find(b => b.scope === 'global')
              if (g) setEditingBudget(g)
            }}
            className="px-4 py-2 rounded-lg bg-[var(--color-accent)] text-white text-sm font-medium hover:opacity-90 transition-opacity whitespace-nowrap"
          >
            <FiSliders className="inline w-4 h-4 mr-1.5 -mt-0.5" />
            Set Budget
          </button>
        </div>
      </div>

      {/* ── Section 2: Spend Over Time ───────────────────── */}
      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <FiTrendingUp className="w-5 h-5 text-[var(--color-accent)]" />
            Spend Over Time
          </h2>
          <div className="flex gap-1 bg-white/5 rounded-lg p-0.5">
            {(['7d', '30d', '90d'] as const).map(r => (
              <button
                key={r}
                onClick={() => setTimeRange(r)}
                className={clsx(
                  'px-3 py-1 rounded-md text-xs font-medium transition-colors',
                  timeRange === r ? 'bg-[var(--color-accent)] text-white' : 'text-[var(--color-text-muted)] hover:text-white'
                )}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        <div className="h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={dailySpend} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                {Object.entries(PROVIDER_COLORS).map(([key, color]) => (
                  <linearGradient key={key} id={`grad-${key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={color} stopOpacity={0} />
                  </linearGradient>
                ))}
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
                labelStyle={{ color: 'rgba(255,255,255,0.6)', fontSize: '11px', marginBottom: '4px' }}
                formatter={(value: any, name: any) => [`$${Number(value).toFixed(2)}`, String(name || '')]}
              />
              {Object.entries(PROVIDER_COLORS).map(([key, color]) => (
                <Area
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stackId="1"
                  stroke={color}
                  fill={`url(#grad-${key})`}
                  strokeWidth={1.5}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="flex gap-4 mt-3 justify-center">
          {Object.entries(PROVIDER_COLORS).map(([name, color]) => (
            <div key={name} className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
              {name}
            </div>
          ))}
        </div>
      </div>

      {/* ── Section 3: Cost Breakdown (two donuts) ───────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Cost by Model */}
        <div className="glass-card p-6">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
            <FiPieChart className="w-5 h-5 text-[var(--color-accent)]" />
            Cost by Model
          </h2>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={MOCK_COST_BY_MODEL}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={95}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {MOCK_COST_BY_MODEL.map((_, idx) => (
                    <Cell key={idx} fill={MODEL_COLORS[idx % MODEL_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={CHART_TOOLTIP_STYLE}
                  formatter={(value: any) => [`$${Number(value).toFixed(2)}`, 'Cost']}
                />
                <Legend
                  wrapperStyle={{ fontSize: '11px', color: 'rgba(255,255,255,0.6)' }}
                  formatter={(value) => <span style={{ color: 'rgba(255,255,255,0.7)' }}>{value}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Cost by Pipeline Type */}
        <div className="glass-card p-6">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
            <FiGrid className="w-5 h-5 text-[var(--color-accent)]" />
            Cost by Pipeline Type
          </h2>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={MOCK_COST_BY_PIPELINE}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={95}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {MOCK_COST_BY_PIPELINE.map((_, idx) => (
                    <Cell key={idx} fill={PIPELINE_COLORS[idx % PIPELINE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={CHART_TOOLTIP_STYLE}
                  formatter={(value: any) => [`$${Number(value).toFixed(2)}`, 'Cost']}
                />
                <Legend
                  wrapperStyle={{ fontSize: '11px', color: 'rgba(255,255,255,0.6)' }}
                  formatter={(value) => <span style={{ color: 'rgba(255,255,255,0.7)' }}>{value}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ── Section 4: Cost by Project (sortable table) ──── */}
      <div className="glass-card p-6">
        <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
          <FiList className="w-5 h-5 text-[var(--color-accent)]" />
          Cost by Project
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10">
                {[
                  { key: 'name', label: 'Project' },
                  { key: 'disease', label: 'Disease' },
                  { key: 'discoveryRuns', label: 'Discovery Runs' },
                  { key: 'synthesisRuns', label: 'Synthesis Runs' },
                  { key: 'totalCost', label: 'Total Cost' },
                  { key: 'avgCostPerRun', label: 'Avg Cost/Run' },
                ].map(col => (
                  <th
                    key={col.key}
                    onClick={() => toggleProjectSort(col.key)}
                    className="text-left py-2 px-3 text-xs font-medium text-[var(--color-text-muted)] cursor-pointer hover:text-white transition-colors select-none"
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.label}
                      {projectSort.col === col.key && (
                        projectSort.dir === 'asc' ? <FiChevronUp className="w-3 h-3" /> : <FiChevronDown className="w-3 h-3" />
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedProjects.map((p, i) => (
                <tr
                  key={p.name}
                  className={clsx(
                    'border-b border-white/5 hover:bg-white/5 transition-colors',
                    i % 2 === 0 && 'bg-white/[0.02]'
                  )}
                >
                  <td className="py-2.5 px-3 font-medium">{p.name}</td>
                  <td className="py-2.5 px-3 text-[var(--color-text-muted)]">{p.disease}</td>
                  <td className="py-2.5 px-3 text-center">{p.discoveryRuns}</td>
                  <td className="py-2.5 px-3 text-center">{p.synthesisRuns}</td>
                  <td className="py-2.5 px-3 font-medium">{formatUSD(p.totalCost)}</td>
                  <td className="py-2.5 px-3 text-[var(--color-text-muted)]">{formatUSD(p.avgCostPerRun)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Section 5: Usage Details (expandable, paginated) ─ */}
      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <FiClock className="w-5 h-5 text-[var(--color-accent)]" />
            Usage Details
          </h2>
          <span className="text-xs text-[var(--color-text-muted)]">
            {MOCK_USAGE_ROWS.length} records &middot; Page {usagePage + 1} of {totalUsagePages}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-left py-2 px-2 font-medium text-[var(--color-text-muted)]"></th>
                <th className="text-left py-2 px-2 font-medium text-[var(--color-text-muted)]">Timestamp</th>
                <th className="text-left py-2 px-2 font-medium text-[var(--color-text-muted)]">Project</th>
                <th className="text-left py-2 px-2 font-medium text-[var(--color-text-muted)]">Run Type</th>
                <th className="text-left py-2 px-2 font-medium text-[var(--color-text-muted)]">Stage</th>
                <th className="text-left py-2 px-2 font-medium text-[var(--color-text-muted)]">Model</th>
                <th className="text-right py-2 px-2 font-medium text-[var(--color-text-muted)]">Tokens In</th>
                <th className="text-right py-2 px-2 font-medium text-[var(--color-text-muted)]">Tokens Out</th>
                <th className="text-right py-2 px-2 font-medium text-[var(--color-text-muted)]">Cost</th>
                <th className="text-right py-2 px-2 font-medium text-[var(--color-text-muted)]">Latency</th>
                <th className="text-center py-2 px-2 font-medium text-[var(--color-text-muted)]">Status</th>
              </tr>
            </thead>
            <tbody>
              {pagedUsage.map(row => (
                <tr key={row.id}>
                  <td className="py-2 px-2">
                    <button
                      onClick={() => setExpandedRow(expandedRow === row.id ? null : row.id)}
                      className="p-0.5 rounded hover:bg-white/10 transition-colors"
                    >
                      {expandedRow === row.id ? <FiChevronUp className="w-3 h-3" /> : <FiChevronDown className="w-3 h-3" />}
                    </button>
                  </td>
                  <td className="py-2 px-2 text-[var(--color-text-muted)] whitespace-nowrap">
                    {new Date(row.timestamp).toLocaleString('en-US', {
                      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                    })}
                  </td>
                  <td className="py-2 px-2">{row.project}</td>
                  <td className="py-2 px-2">{row.runType}</td>
                  <td className="py-2 px-2 text-[var(--color-text-muted)]">{row.stage}</td>
                  <td className="py-2 px-2 font-mono text-[10px]">{row.model}</td>
                  <td className="py-2 px-2 text-right font-mono">{row.tokensIn.toLocaleString()}</td>
                  <td className="py-2 px-2 text-right font-mono">{row.tokensOut.toLocaleString()}</td>
                  <td className="py-2 px-2 text-right font-medium">{formatUSD(row.cost)}</td>
                  <td className="py-2 px-2 text-right text-[var(--color-text-muted)]">{row.latency}s</td>
                  <td className="py-2 px-2 text-center">
                    <span className={clsx('px-1.5 py-0.5 rounded text-[10px] font-medium', statusBadge(row.status))}>
                      {row.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-center gap-2 mt-4">
          <button
            onClick={() => setUsagePage(p => Math.max(0, p - 1))}
            disabled={usagePage === 0}
            className="p-1.5 rounded-lg hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <FiChevronLeft className="w-4 h-4" />
          </button>
          {Array.from({ length: totalUsagePages }, (_, i) => (
            <button
              key={i}
              onClick={() => setUsagePage(i)}
              className={clsx(
                'w-7 h-7 rounded-lg text-xs font-medium transition-colors',
                usagePage === i ? 'bg-[var(--color-accent)] text-white' : 'hover:bg-white/10 text-[var(--color-text-muted)]'
              )}
            >
              {i + 1}
            </button>
          ))}
          <button
            onClick={() => setUsagePage(p => Math.min(totalUsagePages - 1, p + 1))}
            disabled={usagePage === totalUsagePages - 1}
            className="p-1.5 rounded-lg hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <FiChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Section 6: Budget Management ─────────────────── */}
      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <FiZap className="w-5 h-5 text-[var(--color-accent)]" />
            Budget Management
          </h2>
          <div className="flex gap-2">
            <button
              onClick={() =>
                setEditingBudget({
                  id: `b${Date.now()}`,
                  name: 'New Project',
                  monthlyBudget: 100,
                  alertThreshold: 80,
                  hardLimit: false,
                  scope: 'project',
                })
              }
              className="px-3 py-1.5 rounded-lg border border-white/10 text-xs font-medium hover:bg-white/5 transition-colors"
            >
              <FiPlus className="inline w-3.5 h-3.5 mr-1 -mt-0.5" />
              Add Project Budget
            </button>
            <button
              onClick={() => {
                const g = budgets.find(b => b.scope === 'global')
                if (g) setEditingBudget(g)
              }}
              className="px-3 py-1.5 rounded-lg bg-[var(--color-accent)] text-white text-xs font-medium hover:opacity-90 transition-opacity"
            >
              Set Global Budget
            </button>
          </div>
        </div>

        <div className="space-y-3">
          {budgets.map(b => {
            const spent = b.scope === 'global' ? totalSpend : +(Math.random() * b.monthlyBudget * 0.8).toFixed(2)
            const pct = Math.min((spent / b.monthlyBudget) * 100, 100)
            return (
              <div
                key={b.id}
                className="flex items-center gap-4 p-4 rounded-xl bg-white/[0.03] border border-white/5 hover:border-white/10 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-sm truncate">{b.name}</span>
                    {b.scope === 'global' && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--color-accent)]/15 text-[var(--color-accent)]">
                        GLOBAL
                      </span>
                    )}
                    {b.hardLimit && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-500/15 text-red-400">
                        HARD LIMIT
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${pct}%`, backgroundColor: budgetColor(pct) }}
                      />
                    </div>
                    <span className="text-xs text-[var(--color-text-muted)] whitespace-nowrap">
                      {formatUSD(spent)} / {formatUSD(b.monthlyBudget)}
                    </span>
                  </div>
                  <div className="text-[10px] text-[var(--color-text-muted)] mt-1">
                    Alert at {b.alertThreshold}%
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
        </div>
      </div>

      {/* ── Budget Edit Modal ────────────────────────────── */}
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
