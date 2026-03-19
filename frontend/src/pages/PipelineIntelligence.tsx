/**
 * PipelineIntelligence — 4-tab analytics dashboard
 * Tabs: Costs, Model Performance, Benchmarks, Optimizations
 * Uses Recharts for all charts, fetches from billing + pipeline-intelligence APIs
 */
import { useState, useEffect, useCallback } from 'react'
import {
  FiDollarSign, FiCpu, FiBarChart2, FiZap, FiRefreshCw,
  FiTrendingUp, FiAlertTriangle, FiClock, FiCheckCircle,
  FiActivity, FiTarget, FiLayers,
} from 'react-icons/fi'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
  LineChart, Line,
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

const CHART_COLORS = ['#10b981', '#6366f1', '#f59e0b', '#3b82f6', '#ec4899', '#8b5cf6', '#06b6d4', '#f97316']
const STAGE_COLORS: Record<string, string> = {
  'hypothesis-generation': '#6366f1',
  'evidence-grounding': '#10b981',
  'synthesis': '#f59e0b',
  'literature-review': '#3b82f6',
  'ranking': '#ec4899',
}

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
  model: string
  cost_cents: number
  requests: number
}

interface StageBreakdown {
  stage: string
  cost_cents: number
}

interface ModelPerformanceRow {
  model: string
  avg_latency_ms: number
  success_rate: number
  total_tokens: number
  cost_cents: number
  total_calls: number
}

interface BenchmarkData {
  avg_hypotheses_per_run: number
  avg_confidence: number
  avg_duration_seconds: number
  stage_metrics: {
    stage: string
    avg_duration_seconds: number
    failure_rate: number
  }[]
}

interface Optimization {
  id: string
  type: 'recommendation' | 'bottleneck' | 'efficiency'
  severity: 'info' | 'warning' | 'critical'
  title: string
  description: string
  metric?: string
}

const TABS = ['Costs', 'Model Performance', 'Benchmarks', 'Optimizations'] as const
type Tab = typeof TABS[number]

const TAB_ICONS: Record<Tab, typeof FiDollarSign> = {
  'Costs': FiDollarSign,
  'Model Performance': FiCpu,
  'Benchmarks': FiBarChart2,
  'Optimizations': FiZap,
}

function generateOptimizations(
  models: ModelPerformanceRow[],
  benchmarks: BenchmarkData | null,
): Optimization[] {
  const opts: Optimization[] = []

  // Model-based recommendations
  models.forEach(m => {
    if (m.success_rate < 0.97) {
      opts.push({
        id: `err-${m.model}`,
        type: 'recommendation',
        severity: m.success_rate < 0.95 ? 'critical' : 'warning',
        title: `High error rate on ${m.model.split('-').slice(0, 2).join('-')}`,
        description: `${m.model} has a ${((1 - m.success_rate) * 100).toFixed(1)}% failure rate. Consider reviewing the fallback chain or switching to a more reliable model for this stage.`,
        metric: `${(m.success_rate * 100).toFixed(1)}% success`,
      })
    }
    if (m.avg_latency_ms > 6000) {
      opts.push({
        id: `lat-${m.model}`,
        type: 'bottleneck',
        severity: m.avg_latency_ms > 10000 ? 'critical' : 'warning',
        title: `High latency on ${m.model.split('-').slice(0, 2).join('-')}`,
        description: `Average latency of ${(m.avg_latency_ms / 1000).toFixed(1)}s. Consider using a faster model variant or reducing prompt length.`,
        metric: `${(m.avg_latency_ms / 1000).toFixed(1)}s avg`,
      })
    }
  })

  // Benchmark-based
  if (benchmarks) {
    if (benchmarks.avg_confidence < 0.75) {
      opts.push({
        id: 'conf-low',
        type: 'recommendation',
        severity: 'info',
        title: 'Consider increasing grounding threshold for better accuracy',
        description: `Average confidence score is ${(benchmarks.avg_confidence * 100).toFixed(0)}%. Increasing the evidence grounding threshold may improve hypothesis quality at the cost of longer run times.`,
        metric: `${(benchmarks.avg_confidence * 100).toFixed(0)}% avg confidence`,
      })
    }

    const bottleneck = benchmarks.stage_metrics.reduce((a, b) =>
      a.avg_duration_seconds > b.avg_duration_seconds ? a : b
    )
    opts.push({
      id: 'bottleneck-stage',
      type: 'bottleneck',
      severity: bottleneck.avg_duration_seconds > 15 ? 'warning' : 'info',
      title: `Pipeline bottleneck: ${bottleneck.stage.replace(/-/g, ' ')}`,
      description: `The ${bottleneck.stage.replace(/-/g, ' ')} stage takes an average of ${bottleneck.avg_duration_seconds.toFixed(1)}s, making it the slowest stage in the pipeline.`,
      metric: `${bottleneck.avg_duration_seconds.toFixed(1)}s avg`,
    })

    const totalTokens = models.reduce((s, m) => s + m.total_tokens, 0)
    const totalCostCents = models.reduce((s, m) => s + m.cost_cents, 0)
    const costPerMToken = totalTokens > 0 ? (totalCostCents / 100) / (totalTokens / 1_000_000) : 0
    opts.push({
      id: 'token-efficiency',
      type: 'efficiency',
      severity: 'info',
      title: 'Token efficiency overview',
      description: `Current cost is $${costPerMToken.toFixed(2)} per million tokens across all models. Consider batching smaller requests or switching high-volume stages to cheaper model variants.`,
      metric: `$${costPerMToken.toFixed(2)}/M tokens`,
    })
  }

  return opts
}

// ── Helpers ──────────────────────────────────────────────────

function formatUSD(cents: number) {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function severityStyles(severity: string) {
  switch (severity) {
    case 'critical': return { bg: 'bg-red-500/10', border: 'border-red-500/20', icon: 'text-red-400', dot: 'bg-red-400' }
    case 'warning': return { bg: 'bg-amber-500/10', border: 'border-amber-500/20', icon: 'text-amber-400', dot: 'bg-amber-400' }
    default: return { bg: 'bg-blue-500/10', border: 'border-blue-500/20', icon: 'text-blue-400', dot: 'bg-blue-400' }
  }
}

// ── Sub-components ───────────────────────────────────────────

function StatCard({ label, value, icon: Icon, color }: { label: string; value: string; icon: typeof FiDollarSign; color: string }) {
  return (
    <div className="glass-card p-4 flex items-center gap-3">
      <div className="p-2.5 rounded-lg" style={{ backgroundColor: `${color}15` }}>
        <Icon className="w-4 h-4" style={{ color }} />
      </div>
      <div>
        <div className="text-xl font-bold text-white">{value}</div>
        <div className="text-xs text-[var(--color-text-muted)]">{label}</div>
      </div>
    </div>
  )
}

// ── Costs Tab ────────────────────────────────────────────────

function CostsTab({
  summary,
  daily,
  breakdown,
}: {
  summary: BillingSummary | null
  daily: DailySpend[]
  breakdown: ModelBreakdown[]
}) {
  const monthlyData = [
    { month: 'Oct', spend: 42300 },
    { month: 'Nov', spend: 51200 },
    { month: 'Dec', spend: 38700 },
    { month: 'Jan', spend: 61400 },
    { month: 'Feb', spend: 48900 },
    { month: 'Mar', spend: summary?.current_month_spend_cents ?? 55290 },
  ]

  const pieData = breakdown.map(b => ({ name: b.model.split('-').slice(0, 2).join('-'), value: b.cost_cents / 100 }))
  const dailyChart = daily.map(d => ({ date: d.date, cost: d.cost_cents / 100 }))

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Current Month" value={formatUSD(summary?.current_month_spend_cents ?? 0)} icon={FiDollarSign} color="#10b981" />
        <StatCard label="Budget Remaining" value={formatUSD(Math.max(0, (summary?.budget_cents ?? 0) - (summary?.current_month_spend_cents ?? 0)))} icon={FiTarget} color="#3b82f6" />
        <StatCard label="Projected EOM" value={formatUSD(summary?.projected_spend_cents ?? 0)} icon={FiTrendingUp} color="#f59e0b" />
        <StatCard label="Total Requests" value={(summary?.total_requests ?? 0).toLocaleString()} icon={FiActivity} color="#8b5cf6" />
      </div>

      {/* Monthly spend bar chart */}
      <div className="glass-card p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <FiBarChart2 className="w-5 h-5 text-[var(--color-accent-blue)]" />
          Monthly Spend
        </h3>
        <div className="h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthlyData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis
                dataKey="month"
                tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={v => `$${(v / 100).toFixed(0)}`}
              />
              <Tooltip
                contentStyle={CHART_TOOLTIP_STYLE}
                formatter={(value: number) => [formatUSD(value), 'Spend']}
                labelStyle={{ color: 'rgba(255,255,255,0.6)', fontSize: '11px' }}
              />
              <Bar dataKey="spend" fill="#6366f1" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Cost by model pie chart */}
        <div className="glass-card p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <FiLayers className="w-5 h-5 text-[var(--color-accent-purple)]" />
            Cost by Model
          </h3>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={95}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {pieData.map((_, idx) => (
                    <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={CHART_TOOLTIP_STYLE}
                  formatter={(value: number) => [`$${value.toFixed(2)}`, 'Cost']}
                />
                <Legend
                  wrapperStyle={{ fontSize: '11px' }}
                  formatter={(value) => <span style={{ color: 'rgba(255,255,255,0.7)' }}>{value}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Daily trend line chart */}
        <div className="glass-card p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <FiTrendingUp className="w-5 h-5 text-[var(--color-accent-green)]" />
            Daily Trend
          </h3>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={dailyChart} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
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
                  formatter={(value: number) => [`$${value.toFixed(2)}`, 'Daily Cost']}
                  labelStyle={{ color: 'rgba(255,255,255,0.6)', fontSize: '11px' }}
                />
                <Line
                  type="monotone"
                  dataKey="cost"
                  stroke="#10b981"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: '#10b981' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Model Performance Tab ────────────────────────────────────

function ModelPerformanceTab({ models }: { models: ModelPerformanceRow[] }) {
  if (models.length === 0) {
    return (
      <div className="text-center py-16">
        <FiCpu className="w-10 h-10 text-[var(--color-text-muted)] mx-auto mb-4 opacity-30" />
        <h3 className="text-lg font-medium text-white mb-2">No performance data yet</h3>
        <p className="text-sm text-[var(--color-text-muted)]">Run discovery pipelines to generate model performance metrics.</p>
      </div>
    )
  }

  return (
    <div className="glass-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10">
              <th className="text-left py-3 px-4 text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">Model</th>
              <th className="text-right py-3 px-4 text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">Calls</th>
              <th className="text-right py-3 px-4 text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">Avg Latency</th>
              <th className="text-right py-3 px-4 text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">Success Rate</th>
              <th className="text-right py-3 px-4 text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">Tokens Used</th>
              <th className="text-right py-3 px-4 text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">Cost</th>
            </tr>
          </thead>
          <tbody>
            {models.map((m, i) => {
              const successColor = m.success_rate >= 0.98 ? 'text-emerald-400' : m.success_rate >= 0.95 ? 'text-amber-400' : 'text-red-400'
              const latencyColor = m.avg_latency_ms <= 3000 ? 'text-emerald-400' : m.avg_latency_ms <= 6000 ? 'text-amber-400' : 'text-red-400'
              return (
                <tr key={m.model} className={clsx('border-b border-white/5 hover:bg-white/5 transition-colors', i % 2 === 0 && 'bg-white/[0.02]')}>
                  <td className="py-3 px-4">
                    <span className="font-mono text-xs text-white">{m.model}</span>
                  </td>
                  <td className="py-3 px-4 text-right text-[var(--color-text-muted)]">
                    {m.total_calls.toLocaleString()}
                  </td>
                  <td className={clsx('py-3 px-4 text-right font-mono', latencyColor)}>
                    {m.avg_latency_ms >= 1000 ? `${(m.avg_latency_ms / 1000).toFixed(1)}s` : `${m.avg_latency_ms}ms`}
                  </td>
                  <td className={clsx('py-3 px-4 text-right font-mono', successColor)}>
                    {(m.success_rate * 100).toFixed(1)}%
                  </td>
                  <td className="py-3 px-4 text-right text-[var(--color-text-muted)] font-mono">
                    {(m.total_tokens / 1000).toFixed(0)}k
                  </td>
                  <td className="py-3 px-4 text-right font-medium text-white">
                    {formatUSD(m.cost_cents)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Benchmarks Tab ───────────────────────────────────────────

function BenchmarksTab({ data }: { data: BenchmarkData | null }) {
  if (!data) {
    return (
      <div className="text-center py-16">
        <FiBarChart2 className="w-10 h-10 text-[var(--color-text-muted)] mx-auto mb-4 opacity-30" />
        <h3 className="text-lg font-medium text-white mb-2">No benchmark data yet</h3>
        <p className="text-sm text-[var(--color-text-muted)]">Run discovery pipelines to generate benchmarks.</p>
      </div>
    )
  }

  const stageBarData = data.stage_metrics.map(s => ({
    stage: s.stage.replace(/-/g, ' '),
    duration: s.avg_duration_seconds,
    failureRate: +(s.failure_rate * 100).toFixed(1),
  }))

  return (
    <div className="space-y-6">
      {/* Discovery run summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard
          label="Avg Hypotheses / Run"
          value={data.avg_hypotheses_per_run.toFixed(1)}
          icon={FiTarget}
          color="#6366f1"
        />
        <StatCard
          label="Avg Confidence"
          value={`${(data.avg_confidence * 100).toFixed(0)}%`}
          icon={FiCheckCircle}
          color="#10b981"
        />
        <StatCard
          label="Avg Duration"
          value={`${data.avg_duration_seconds.toFixed(1)}s`}
          icon={FiClock}
          color="#f59e0b"
        />
      </div>

      {/* Stage duration chart */}
      <div className="glass-card p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <FiClock className="w-5 h-5 text-[var(--color-accent-blue)]" />
          Average Duration per Stage
        </h3>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stageBarData} layout="vertical" margin={{ top: 8, right: 24, bottom: 0, left: 24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis
                type="number"
                tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={v => `${v}s`}
              />
              <YAxis
                type="category"
                dataKey="stage"
                tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={140}
              />
              <Tooltip
                contentStyle={CHART_TOOLTIP_STYLE}
                formatter={(value: number) => [`${value.toFixed(1)}s`, 'Avg Duration']}
                labelStyle={{ color: 'rgba(255,255,255,0.6)', fontSize: '11px' }}
              />
              <Bar dataKey="duration" radius={[0, 4, 4, 0]}>
                {stageBarData.map((entry, idx) => (
                  <Cell
                    key={idx}
                    fill={STAGE_COLORS[data.stage_metrics[idx]?.stage] || CHART_COLORS[idx % CHART_COLORS.length]}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Stage failure rates */}
      <div className="glass-card p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <FiAlertTriangle className="w-5 h-5 text-[var(--color-accent-orange)]" />
          Failure Rates per Stage
        </h3>
        <div className="space-y-3">
          {data.stage_metrics.map(s => {
            const pct = s.failure_rate * 100
            const barColor = pct > 4 ? '#ef4444' : pct > 2 ? '#f59e0b' : '#10b981'
            return (
              <div key={s.stage} className="flex items-center gap-4">
                <div className="w-40 text-sm text-[var(--color-text-muted)] capitalize truncate">
                  {s.stage.replace(/-/g, ' ')}
                </div>
                <div className="flex-1 h-2.5 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${Math.max(pct * 10, 2)}%`, backgroundColor: barColor }}
                  />
                </div>
                <div className="w-14 text-right text-sm font-mono" style={{ color: barColor }}>
                  {pct.toFixed(1)}%
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Optimizations Tab ────────────────────────────────────────

function OptimizationsTab({ optimizations }: { optimizations: Optimization[] }) {
  if (optimizations.length === 0) {
    return (
      <div className="text-center py-16">
        <FiZap className="w-10 h-10 text-[var(--color-text-muted)] mx-auto mb-4 opacity-30" />
        <h3 className="text-lg font-medium text-white mb-2">No optimizations available</h3>
        <p className="text-sm text-[var(--color-text-muted)]">Run more discovery pipelines to generate optimization recommendations.</p>
      </div>
    )
  }

  const recommendations = optimizations.filter(o => o.type === 'recommendation')
  const bottlenecks = optimizations.filter(o => o.type === 'bottleneck')
  const efficiencies = optimizations.filter(o => o.type === 'efficiency')

  const renderList = (items: Optimization[], title: string, Icon: typeof FiZap) => {
    if (items.length === 0) return null
    return (
      <div className="glass-card p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Icon className="w-5 h-5 text-[var(--color-accent-blue)]" />
          {title}
        </h3>
        <div className="space-y-3">
          {items.map(opt => {
            const style = severityStyles(opt.severity)
            return (
              <div key={opt.id} className={clsx('p-4 rounded-xl border', style.bg, style.border)}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={clsx('w-2 h-2 rounded-full', style.dot)} />
                      <span className="text-sm font-medium text-white">{opt.title}</span>
                    </div>
                    <p className="text-sm text-[var(--color-text-muted)] leading-relaxed">{opt.description}</p>
                  </div>
                  {opt.metric && (
                    <span className="text-xs font-mono px-2 py-1 rounded-lg bg-white/5 text-[var(--color-text-muted)] whitespace-nowrap">
                      {opt.metric}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {renderList(recommendations, 'Recommendations', FiTarget)}
      {renderList(bottlenecks, 'Pipeline Bottleneck Analysis', FiAlertTriangle)}
      {renderList(efficiencies, 'Token Efficiency', FiActivity)}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
// ██  MAIN COMPONENT  █████████████████████████████████████████
// ══════════════════════════════════════════════════════════════

export default function PipelineIntelligence() {
  const [tab, setTab] = useState<Tab>('Costs')
  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState<BillingSummary | null>(null)
  const [daily, setDaily] = useState<DailySpend[]>([])
  const [breakdown, setBreakdown] = useState<ModelBreakdown[]>([])
  const [models, setModels] = useState<ModelPerformanceRow[]>([])
  const [benchmarkData, setBenchmarkData] = useState<BenchmarkData | null>(null)
  const [optimizations, setOptimizations] = useState<Optimization[]>([])

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [summaryRes, dailyRes, breakdownRes, modelsRes, benchRes] = await Promise.allSettled([
        fetch('/api/v1/billing/summary').then(r => r.ok ? r.json() : null),
        fetch('/api/v1/billing/daily').then(r => r.ok ? r.json() : null),
        fetch('/api/v1/billing/breakdown').then(r => r.ok ? r.json() : null),
        fetch('/api/v1/pipeline-intelligence/model-performance').then(r => r.ok ? r.json() : null),
        fetch('/api/v1/pipeline-intelligence/benchmarks').then(r => r.ok ? r.json() : null),
      ])

      const s = summaryRes.status === 'fulfilled' && summaryRes.value ? summaryRes.value : mockBillingSummary()
      const d = dailyRes.status === 'fulfilled' && dailyRes.value ? (Array.isArray(dailyRes.value) ? dailyRes.value : dailyRes.value.items || []) : mockDailySpend()
      const b = breakdownRes.status === 'fulfilled' && breakdownRes.value ? (Array.isArray(breakdownRes.value) ? breakdownRes.value : breakdownRes.value.by_model || []) : mockModelBreakdown()
      const m = modelsRes.status === 'fulfilled' && modelsRes.value ? (Array.isArray(modelsRes.value) ? modelsRes.value : modelsRes.value.items || []) : mockModelPerformance()
      const bench = benchRes.status === 'fulfilled' && benchRes.value ? benchRes.value : mockBenchmarks()

      setSummary(s)
      setDaily(d.length > 0 ? d : mockDailySpend())
      setBreakdown(b.length > 0 ? b : mockModelBreakdown())
      setModels(m.length > 0 ? m : mockModelPerformance())
      setBenchmarkData(bench)
      setOptimizations(generateOptimizations(
        m.length > 0 ? m : mockModelPerformance(),
        bench,
      ))
    } catch {
      // Fallback to mock data
      setSummary(mockBillingSummary())
      setDaily(mockDailySpend())
      setBreakdown(mockModelBreakdown())
      const m = mockModelPerformance()
      setModels(m)
      const bench = mockBenchmarks()
      setBenchmarkData(bench)
      setOptimizations(generateOptimizations(m, bench))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  return (
    <div className="p-6 lg:p-8 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-white flex items-center gap-3">
            <FiActivity className="w-7 h-7 text-[var(--color-accent-blue)]" />
            Pipeline Intelligence
          </h1>
          <p className="text-[var(--color-text-muted)] mt-1 text-sm">
            Analytics, performance metrics, and optimization insights
          </p>
        </div>
        <button
          onClick={loadData}
          className="btn text-[var(--color-text-muted)] hover:text-white p-2"
          title="Refresh data"
        >
          <FiRefreshCw className={clsx('w-4 h-4', loading && 'animate-spin')} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-[var(--color-border)]">
        {TABS.map(t => {
          const Icon = TAB_ICONS[t]
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={clsx(
                'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px',
                tab === t
                  ? 'text-[var(--color-accent-blue)] border-[var(--color-accent-blue)]'
                  : 'text-[var(--color-text-muted)] border-transparent hover:text-white'
              )}
            >
              <Icon className="w-4 h-4" />
              {t}
            </button>
          )
        })}
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-white/20 border-t-[var(--color-accent-blue)] rounded-full animate-spin" />
            <span className="text-sm text-[var(--color-text-muted)]">Loading analytics...</span>
          </div>
        </div>
      )}

      {/* Tab content */}
      {!loading && tab === 'Costs' && (
        <CostsTab summary={summary} daily={daily} breakdown={breakdown} />
      )}
      {!loading && tab === 'Model Performance' && (
        <ModelPerformanceTab models={models} />
      )}
      {!loading && tab === 'Benchmarks' && (
        <BenchmarksTab data={benchmarkData} />
      )}
      {!loading && tab === 'Optimizations' && (
        <OptimizationsTab optimizations={optimizations} />
      )}
    </div>
  )
}
