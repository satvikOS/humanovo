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
  FiUpload,
  FiTarget,
  FiLayers,
} from 'react-icons/fi'
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  ScatterChart, Scatter, AreaChart, Area,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  FunnelChart, Funnel, LabelList,
  Treemap,
} from 'recharts'

interface DataPoint {
  label: string
  value: number
  category?: string
}

type ChartType = 'bar' | 'line' | 'pie' | 'scatter' | 'area' | 'radar' | 'funnel' | 'horizontal_bar' | 'stacked_bar' | 'treemap'

interface ChartConfig {
  id: string
  title: string
  type: ChartType
  data: DataPoint[]
  color: string
  createdAt: string
}

function smartDownsample(data: DataPoint[], maxPoints: number = 100): DataPoint[] {
  if (data.length <= maxPoints) return data

  // Check if data is purely numeric labels (time series)
  const isTimeSeries = data.every(d => !isNaN(Number(d.label)))

  if (isTimeSeries) {
    // Bin into groups and average
    const binSize = Math.ceil(data.length / maxPoints)
    const binned: DataPoint[] = []
    for (let i = 0; i < data.length; i += binSize) {
      const chunk = data.slice(i, i + binSize)
      const avgVal = chunk.reduce((s, d) => s + d.value, 0) / chunk.length
      const minLabel = chunk[0].label
      const maxLabel = chunk[chunk.length - 1].label
      binned.push({ label: chunk.length > 1 ? `${minLabel}-${maxLabel}` : minLabel, value: Math.round(avgVal * 100) / 100 })
    }
    return binned
  }

  // For categorical: take top N by value, aggregate rest into "Other"
  const sorted = [...data].sort((a, b) => b.value - a.value)
  const top = sorted.slice(0, maxPoints - 1)
  const rest = sorted.slice(maxPoints - 1)
  const otherVal = rest.reduce((s, d) => s + d.value, 0)
  return [...top, { label: `Other (${rest.length})`, value: Math.round(otherVal * 100) / 100 }]
}

function suggestChartType(data: DataPoint[]): ChartType {
  if (data.length === 0) return 'bar'

  const n = data.length
  const hasCategories = data.some(d => d.category)
  const isTimeSeries = data.every(d => !isNaN(Number(d.label))) || data.every(d => /^\d{4}[-\/]/.test(d.label))
  const allPositive = data.every(d => d.value >= 0)
  const sumClose100 = Math.abs(data.reduce((s, d) => s + d.value, 0) - 100) < 5

  // Pie chart: small count, positive values, percentages
  if (n <= 8 && allPositive && (sumClose100 || n <= 5)) return 'pie'

  // Stacked bar: has categories
  if (hasCategories) return 'stacked_bar'

  // Area/Line: time series
  if (isTimeSeries && n > 5) return n > 50 ? 'area' : 'line'

  // Funnel: monotonically decreasing, small count
  const isDecreasing = data.every((d, i) => i === 0 || d.value <= data[i - 1].value)
  if (isDecreasing && n >= 3 && n <= 10) return 'funnel'

  // Treemap: many categories with sizes
  if (n > 10 && allPositive) return 'treemap'

  // Radar: small count, multiple dimensions
  if (n >= 3 && n <= 12) return 'radar'

  // Default: bar
  return 'bar'
}

const CHART_COLORS = [
  'var(--color-accent-blue)', 'var(--color-accent-purple)', 'var(--color-accent-green)',
  'var(--color-accent-orange)', 'var(--color-accent-cyan)', 'var(--color-error)',
]

const PIE_COLORS = ['#3b82f6', '#8b5cf6', '#22c55e', '#f97316', '#06b6d4', '#ef4444', '#eab308', '#ec4899']

const TOOLTIP_STYLE = {
  background: 'var(--color-surface-solid)',
  border: '1px solid var(--color-border)',
  borderRadius: '8px',
  fontSize: '12px',
  color: 'var(--color-text)',
}

const AXIS_TICK = { fontSize: 11, fill: 'var(--color-text-muted)' }

export default function DataVisualization() {
  const [charts, setCharts] = useState<ChartConfig[]>(() => {
    try { return JSON.parse(localStorage.getItem('humanovo-charts') || '[]') } catch { return [] }
  })
  const [showAdd, setShowAdd] = useState(false)
  const [, setSelected] = useState<ChartConfig | null>(null)
  const chartRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const fileInputRef = useRef<HTMLInputElement>(null)

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
    title: '', type: 'bar' as ChartType,
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

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const text = event.target?.result as string
      if (!text) return

      // Parse CSV/TSV - skip header row if it looks like one
      const lines = text.split('\n').filter(l => l.trim())
      if (lines.length === 0) return

      // Detect if first row is a header (contains non-numeric second column)
      const firstParts = lines[0].split(/[,\t]/).map(p => p.trim().replace(/^["']|["']$/g, ''))
      const hasHeader = firstParts.length >= 2 && isNaN(parseFloat(firstParts[1]))
      const dataLines = hasHeader ? lines.slice(1) : lines

      const dataText = dataLines.map(line => {
        const parts = line.split(/[,\t]/).map(p => p.trim().replace(/^["']|["']$/g, ''))
        return parts.slice(0, 3).join(', ')
      }).join('\n')

      const title = file.name.replace(/\.(csv|tsv|xlsx?|txt)$/i, '').replace(/[-_]/g, ' ')
      setForm(f => ({ ...f, title: title || f.title, dataText }))
      setShowAdd(true)
    }
    reader.readAsText(file)
    // Reset input so the same file can be re-uploaded
    if (fileInputRef.current) fileInputRef.current.value = ''
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
  }

  const renderChart = (chart: ChartConfig, height = 300) => {
    const { type, color } = chart
    const maxPoints = type === 'scatter' ? 500 : 100
    const displayData = smartDownsample(chart.data, maxPoints)
    const wasDownsampled = displayData.length < chart.data.length
    const data = displayData
    return (
      <>
        {wasDownsampled && (
          <div className="text-xxs text-[var(--color-text-muted)] bg-[var(--glass-bg)] border border-[var(--color-border)] rounded px-2 py-1 mb-2 flex items-center gap-1">
            <span>Downsampled from {chart.data.length} to {displayData.length} points for display</span>
          </div>
        )}
        {renderChartInner(data, type, color, height)}
      </>
    )
  }

  const renderChartInner = (data: DataPoint[], type: ChartType, color: string, height: number) => {
    switch (type) {
      case 'bar':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="label" tick={AXIS_TICK} />
              <YAxis tick={AXIS_TICK} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )
      case 'horizontal_bar':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <BarChart data={data} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis type="number" tick={AXIS_TICK} />
              <YAxis dataKey="label" type="category" tick={AXIS_TICK} width={80} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="value" fill={color} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )
      case 'stacked_bar': {
        // Group data by category for stacked bar
        const categories = [...new Set(data.map(d => d.category).filter(Boolean))]
        if (categories.length === 0) {
          // Fallback: render as grouped bars with value and a second synthetic series
          return (
            <ResponsiveContainer width="100%" height={height}>
              <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="label" tick={AXIS_TICK} />
                <YAxis tick={AXIS_TICK} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Legend />
                <Bar dataKey="value" stackId="a" fill={color} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )
        }
        // Pivot data: group by label, spread categories as keys
        const labels = [...new Set(data.map(d => d.label))]
        const pivoted = labels.map(label => {
          const row: Record<string, any> = { label }
          categories.forEach(cat => {
            const match = data.find(d => d.label === label && d.category === cat)
            row[cat!] = match?.value || 0
          })
          return row
        })
        return (
          <ResponsiveContainer width="100%" height={height}>
            <BarChart data={pivoted}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="label" tick={AXIS_TICK} />
              <YAxis tick={AXIS_TICK} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Legend />
              {categories.map((cat, i) => (
                <Bar key={cat} dataKey={cat!} stackId="a" fill={PIE_COLORS[i % PIE_COLORS.length]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )
      }
      case 'line':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="label" tick={AXIS_TICK} />
              <YAxis tick={AXIS_TICK} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={{ fill: color, r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        )
      case 'area':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <AreaChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="label" tick={AXIS_TICK} />
              <YAxis tick={AXIS_TICK} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
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
              <Tooltip contentStyle={TOOLTIP_STYLE} />
            </PieChart>
          </ResponsiveContainer>
        )
      case 'scatter':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <ScatterChart>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="label" tick={AXIS_TICK} />
              <YAxis dataKey="value" tick={AXIS_TICK} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Scatter data={data} fill={color} />
            </ScatterChart>
          </ResponsiveContainer>
        )
      case 'radar':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <RadarChart data={data} cx="50%" cy="50%" outerRadius="70%">
              <PolarGrid stroke="var(--color-border)" />
              <PolarAngleAxis dataKey="label" tick={AXIS_TICK} />
              <PolarRadiusAxis tick={AXIS_TICK} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Radar dataKey="value" stroke={color} fill={color} fillOpacity={0.2} strokeWidth={2} />
            </RadarChart>
          </ResponsiveContainer>
        )
      case 'funnel':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <FunnelChart>
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Funnel dataKey="value" data={data.map((d, i) => ({ ...d, fill: PIE_COLORS[i % PIE_COLORS.length] }))} isAnimationActive>
                <LabelList position="right" fill="var(--color-text)" stroke="none" dataKey="label" fontSize={11} />
              </Funnel>
            </FunnelChart>
          </ResponsiveContainer>
        )
      case 'treemap':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <Treemap
              data={data.map((d, i) => ({ name: d.label, size: d.value, fill: PIE_COLORS[i % PIE_COLORS.length] }))}
              dataKey="size"
              aspectRatio={4 / 3}
              stroke="var(--color-border)"
              content={({ x, y, width, height: h, name, fill }: any) => (
                <g>
                  <rect x={x} y={y} width={width} height={h} fill={fill} stroke="var(--color-border)" strokeWidth={1} rx={4} />
                  {width > 40 && h > 20 && (
                    <text x={x + width / 2} y={y + h / 2} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={11}>
                      {name}
                    </text>
                  )}
                </g>
              )}
            />
          </ResponsiveContainer>
        )
      default:
        return null
    }
  }

  const chartTypeIcons: Record<ChartType, JSX.Element> = {
    bar: <FiBarChart2 className="w-3.5 h-3.5" />,
    horizontal_bar: <FiBarChart2 className="w-3.5 h-3.5 rotate-90" />,
    stacked_bar: <FiLayers className="w-3.5 h-3.5" />,
    line: <FiTrendingUp className="w-3.5 h-3.5" />,
    pie: <FiPieChart className="w-3.5 h-3.5" />,
    scatter: <FiGrid className="w-3.5 h-3.5" />,
    area: <FiTrendingUp className="w-3.5 h-3.5" />,
    radar: <FiTarget className="w-3.5 h-3.5" />,
    funnel: <FiTrendingUp className="w-3.5 h-3.5" />,
    treemap: <FiGrid className="w-3.5 h-3.5" />,
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="p-6 border-b border-[var(--color-border)]">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Data Visualization</h1>
            <p className="text-sm text-[var(--color-text-muted)] mt-1">Create charts and visualizations from your research data</p>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.tsv,.txt,.xls,.xlsx"
              onChange={handleFileUpload}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="btn text-sm border border-[var(--color-border)]"
              style={{ color: 'var(--color-accent-green)' }}
            >
              <FiUpload className="w-4 h-4" /> Upload CSV / Excel
            </button>
            <button onClick={() => setShowAdd(!showAdd)} className="btn text-sm" style={{ color: 'var(--color-accent-blue)' }}>
              <FiPlus className="w-4 h-4" /> New Chart
            </button>
          </div>
        </div>
      </div>

      {showAdd && (
        <div className="p-4 border-b border-[var(--color-border)] bg-[var(--glass-bg)] animate-slide-down">
          <div className="max-w-3xl mx-auto space-y-3">
            <div className="flex gap-3">
              <input type="text" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Chart title *" className="input flex-1 text-sm" />
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as ChartType }))} className="input text-xs w-40">
                <option value="bar">Bar Chart</option>
                <option value="horizontal_bar">Horizontal Bar</option>
                <option value="stacked_bar">Stacked Bar</option>
                <option value="line">Line Chart</option>
                <option value="area">Area Chart</option>
                <option value="pie">Pie Chart</option>
                <option value="scatter">Scatter Plot</option>
                <option value="radar">Radar Chart</option>
                <option value="funnel">Funnel Chart</option>
                <option value="treemap">Treemap</option>
              </select>
              <button
                type="button"
                onClick={() => {
                  const data = parseData(form.dataText)
                  if (data.length > 0) setForm(f => ({ ...f, type: suggestChartType(data) }))
                }}
                disabled={!form.dataText.trim()}
                className="btn text-xs border border-[var(--color-border)] disabled:opacity-30 whitespace-nowrap"
                style={{ color: 'var(--color-accent-purple)' }}
                title="Analyze data and suggest the best chart type"
              >
                Suggest
              </button>
              <select value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))} className="input text-xs w-32">
                {CHART_COLORS.map(c => <option key={c} value={c}>{c.replace('var(--color-', '').replace(')', '')}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Data (one per line: label, value[, category]). Upload a CSV/Excel file to auto-fill.</label>
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
            <p className="text-xs mt-1">Create a visualization with "New Chart" or upload a CSV/Excel file</p>
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
                  <span>{chart.type.replace(/_/g, ' ')}</span>
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
