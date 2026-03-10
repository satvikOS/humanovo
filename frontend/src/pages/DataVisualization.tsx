import { useState, useCallback, useRef } from 'react'
import {
  FiBarChart2,
  FiPieChart,
  FiTrendingUp,
  FiPlus,
  FiTrash2,
  FiGrid,
  FiDownload,
  FiCopy,
} from 'react-icons/fi'
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  ScatterChart, Scatter, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'

interface DataPoint {
  label: string
  value: number
  category?: string
}

interface ChartConfig {
  id: string
  title: string
  type: 'bar' | 'line' | 'pie' | 'scatter' | 'area'
  data: DataPoint[]
  color: string
  createdAt: string
}

const CHART_COLORS = [
  'var(--color-accent-blue)', 'var(--color-accent-purple)', 'var(--color-accent-green)',
  'var(--color-accent-orange)', 'var(--color-accent-cyan)', 'var(--color-error)',
]

const PIE_COLORS = ['#3b82f6', '#8b5cf6', '#22c55e', '#f97316', '#06b6d4', '#ef4444', '#eab308', '#ec4899']

export default function DataVisualization() {
  const [charts, setCharts] = useState<ChartConfig[]>(() => {
    try { return JSON.parse(localStorage.getItem('humanovo-charts') || '[]') } catch { return [] }
  })
  const [showAdd, setShowAdd] = useState(false)
  const [selected, setSelected] = useState<ChartConfig | null>(null)
  const chartRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const exportChartPng = useCallback((chartId: string, title: string) => {
    const container = chartRefs.current[chartId]
    if (!container) return
    const svg = container.querySelector('svg')
    if (!svg) return
    const svgData = new XMLSerializer().serializeToString(svg)
    const canvas = document.createElement('canvas')
    const svgRect = svg.getBoundingClientRect()
    canvas.width = svgRect.width * 2
    canvas.height = svgRect.height * 2
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(2, 2)
    ctx.fillStyle = '#1a1a2e'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    const img = new Image()
    img.onload = () => {
      ctx.drawImage(img, 0, 0)
      const a = document.createElement('a')
      a.download = `${title.replace(/\s+/g, '-').toLowerCase()}.png`
      a.href = canvas.toDataURL('image/png')
      a.click()
    }
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)))
  }, [])

  const exportChartCsv = useCallback((chart: ChartConfig) => {
    const rows = ['label,value' + (chart.data.some(d => d.category) ? ',category' : '')]
    chart.data.forEach(d => {
      rows.push(`"${d.label}",${d.value}${d.category ? `,"${d.category}"` : ''}`)
    })
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.download = `${chart.title.replace(/\s+/g, '-').toLowerCase()}.csv`
    a.href = URL.createObjectURL(blob)
    a.click()
    URL.revokeObjectURL(a.href)
  }, [])

  const [form, setForm] = useState({
    title: '', type: 'bar' as ChartConfig['type'],
    dataText: '', color: CHART_COLORS[0],
  })

  const saveCharts = (updated: ChartConfig[]) => {
    setCharts(updated)
    localStorage.setItem('humanovo-charts', JSON.stringify(updated))
  }

  const parseData = (text: string): DataPoint[] => {
    return text.split('\n').filter(line => line.trim()).map(line => {
      const parts = line.split(',').map(p => p.trim())
      return { label: parts[0] || '', value: parseFloat(parts[1]) || 0, category: parts[2] }
    })
  }

  const addChart = () => {
    if (!form.title.trim() || !form.dataText.trim()) return
    const chart: ChartConfig = {
      id: `chart-${Date.now()}`,
      title: form.title,
      type: form.type,
      data: parseData(form.dataText),
      color: form.color,
      createdAt: new Date().toISOString(),
    }
    saveCharts([chart, ...charts])
    setForm({ title: '', type: 'bar', dataText: '', color: CHART_COLORS[0] })
    setShowAdd(false)
    setSelected(chart)
  }

  const deleteChart = (id: string) => {
    saveCharts(charts.filter(c => c.id !== id))
    if (selected?.id === id) setSelected(null)
  }

  const renderChart = (chart: ChartConfig, height = 300) => {
    const { data, type, color } = chart
    switch (type) {
      case 'bar':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} />
              <Tooltip contentStyle={{ background: 'var(--color-surface-solid)', border: '1px solid var(--color-border)', borderRadius: '8px', fontSize: '12px', color: 'var(--color-text)' }} />
              <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )
      case 'line':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} />
              <Tooltip contentStyle={{ background: 'var(--color-surface-solid)', border: '1px solid var(--color-border)', borderRadius: '8px', fontSize: '12px', color: 'var(--color-text)' }} />
              <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={{ fill: color, r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        )
      case 'area':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <AreaChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} />
              <Tooltip contentStyle={{ background: 'var(--color-surface-solid)', border: '1px solid var(--color-border)', borderRadius: '8px', fontSize: '12px', color: 'var(--color-text)' }} />
              <Area type="monotone" dataKey="value" stroke={color} fill={color} fillOpacity={0.15} strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        )
      case 'pie':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="label" cx="50%" cy="50%" outerRadius={height / 3} label={(props: any) => `${props.name || ''} ${((props.percent || 0) * 100).toFixed(0)}%`}>
                {data.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={{ background: 'var(--color-surface-solid)', border: '1px solid var(--color-border)', borderRadius: '8px', fontSize: '12px', color: 'var(--color-text)' }} />
            </PieChart>
          </ResponsiveContainer>
        )
      case 'scatter':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <ScatterChart>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} />
              <YAxis dataKey="value" tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} />
              <Tooltip contentStyle={{ background: 'var(--color-surface-solid)', border: '1px solid var(--color-border)', borderRadius: '8px', fontSize: '12px', color: 'var(--color-text)' }} />
              <Scatter data={data} fill={color} />
            </ScatterChart>
          </ResponsiveContainer>
        )
      default:
        return null
    }
  }

  const chartTypeIcons = {
    bar: <FiBarChart2 className="w-3.5 h-3.5" />,
    line: <FiTrendingUp className="w-3.5 h-3.5" />,
    pie: <FiPieChart className="w-3.5 h-3.5" />,
    scatter: <FiGrid className="w-3.5 h-3.5" />,
    area: <FiTrendingUp className="w-3.5 h-3.5" />,
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="p-6 border-b border-[var(--color-border)]">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Data Visualization</h1>
            <p className="text-sm text-[var(--color-text-muted)] mt-1">Create charts and visualizations from your research data</p>
          </div>
          <button onClick={() => setShowAdd(!showAdd)} className="btn text-sm" style={{ color: 'var(--color-accent-blue)' }}>
            <FiPlus className="w-4 h-4" /> New Chart
          </button>
        </div>
      </div>

      {showAdd && (
        <div className="p-4 border-b border-[var(--color-border)] bg-[var(--glass-bg)] animate-slide-down">
          <div className="max-w-3xl mx-auto space-y-3">
            <div className="flex gap-3">
              <input type="text" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Chart title *" className="input flex-1 text-sm" />
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as ChartConfig['type'] }))} className="input text-xs w-32">
                <option value="bar">Bar Chart</option>
                <option value="line">Line Chart</option>
                <option value="area">Area Chart</option>
                <option value="pie">Pie Chart</option>
                <option value="scatter">Scatter Plot</option>
              </select>
              <select value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))} className="input text-xs w-32">
                {CHART_COLORS.map(c => <option key={c} value={c}>{c.replace('var(--color-', '').replace(')', '')}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Data (one per line: label, value)</label>
              <textarea
                value={form.dataText}
                onChange={e => setForm(f => ({ ...f, dataText: e.target.value }))}
                placeholder={"e.g.:\nSample A, 45\nSample B, 72\nSample C, 38\nSample D, 91"}
                rows={5}
                className="input w-full text-xs font-mono resize-none"
              />
            </div>
            <div className="flex gap-2">
              <button onClick={addChart} disabled={!form.title.trim() || !form.dataText.trim()} className="btn text-xs disabled:opacity-30" style={{ color: 'var(--color-success)' }}>Create Chart</button>
              <button onClick={() => setShowAdd(false)} className="btn text-xs text-[var(--color-text-muted)]">Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-6">
        {charts.length === 0 ? (
          <div className="text-center py-16 text-[var(--color-text-muted)]">
            <FiBarChart2 className="w-12 h-12 mx-auto mb-4 opacity-20" />
            <p className="text-sm">No charts yet</p>
            <p className="text-xs mt-1">Create your first visualization with the "New Chart" button</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-6xl mx-auto">
            {charts.map(chart => (
              <div key={chart.id} className="glass-card p-5 group">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    {chartTypeIcons[chart.type]}
                    <h3 className="text-sm font-medium">{chart.title}</h3>
                  </div>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => exportChartPng(chart.id, chart.title)} className="p-1.5 rounded hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)] hover:text-[var(--color-accent-blue)]" title="Download PNG">
                      <FiDownload className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => exportChartCsv(chart)} className="p-1.5 rounded hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)] hover:text-[var(--color-accent-green)]" title="Export CSV">
                      <FiCopy className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => deleteChart(chart.id)} className="p-1.5 rounded hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)] hover:text-[var(--color-error)]" title="Delete">
                      <FiTrash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <div ref={el => { chartRefs.current[chart.id] = el }}>
                  {renderChart(chart, 250)}
                </div>
                <div className="flex items-center gap-2 mt-3 text-xxs text-[var(--color-text-muted)]">
                  <span>{chart.data.length} data points</span>
                  <span>{chart.type}</span>
                  <span>{new Date(chart.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
