import { useState, useCallback, useRef, useMemo } from 'react'
import {
  FiBarChart2, FiPieChart, FiTrendingUp, FiPlus, FiTrash2, FiGrid,
  FiDownload, FiUpload, FiTarget, FiLayers, FiSettings, FiSave, FiX,
  FiMaximize2, FiMinimize2, FiEdit3, FiCopy, FiDroplet,
} from 'react-icons/fi'
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  ScatterChart, Scatter, AreaChart, Area,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  FunnelChart, Funnel, LabelList,
  Treemap, ComposedChart, ErrorBar, ReferenceLine, ZAxis,
  RadialBarChart, RadialBar,
} from 'recharts'
import { persistGet, persistSet } from '../utils/persistence'

// ─── Types ──────────────────────────────────────────────────────
interface DataPoint {
  label: string
  value: number
  category?: string
  value2?: number      // secondary series
  value3?: number      // tertiary series
  errorPlus?: number   // error bar upper
  errorMinus?: number  // error bar lower
  size?: number        // bubble size
}

type ChartType =
  | 'bar' | 'horizontal_bar' | 'grouped_bar' | 'stacked_bar' | 'stacked_bar_100'
  | 'line' | 'multi_line' | 'step' | 'spline'
  | 'area' | 'stacked_area' | 'stream'
  | 'pie' | 'donut' | 'radial_bar'
  | 'scatter' | 'bubble'
  | 'radar'
  | 'funnel' | 'treemap'
  | 'histogram' | 'box_plot'
  | 'waterfall' | 'error_bar' | 'candlestick'
  | 'heatmap' | 'stem' | 'band'
  | 'polar_area'

interface ChartConfig {
  id: string
  title: string
  type: ChartType
  data: DataPoint[]
  options: ChartOptions
  createdAt: string
}

interface ChartOptions {
  color: string
  colorPalette: string
  xLabel: string
  yLabel: string
  showGrid: boolean
  showLegend: boolean
  legendPosition: 'top' | 'bottom' | 'left' | 'right'
  logScaleX: boolean
  logScaleY: boolean
  lineWidth: number
  markerSize: number
  markerShape: 'circle' | 'square' | 'diamond' | 'triangle'
  fillOpacity: number
  showValues: boolean
  animate: boolean
  barGap: number
  innerRadius: number  // donut
  startAngle: number
  smooth: boolean
}

const defaultOptions: ChartOptions = {
  color: 'var(--color-accent-blue)',
  colorPalette: 'default',
  xLabel: '', yLabel: '',
  showGrid: true, showLegend: true, legendPosition: 'bottom',
  logScaleX: false, logScaleY: false,
  lineWidth: 2, markerSize: 4, markerShape: 'circle',
  fillOpacity: 0.15, showValues: false, animate: true,
  barGap: 4, innerRadius: 60, startAngle: 90, smooth: true,
}

// ─── Palettes ───────────────────────────────────────────────────
const PALETTES: Record<string, string[]> = {
  default: ['#3b82f6', '#8b5cf6', '#22c55e', '#f97316', '#06b6d4', '#ef4444', '#eab308', '#ec4899', '#14b8a6', '#a855f7'],
  nature: ['#2d6a4f', '#40916c', '#52b788', '#74c69d', '#95d5b2', '#b7e4c7', '#d8f3dc', '#1b4332', '#081c15', '#344e41'],
  ocean: ['#03045e', '#023e8a', '#0077b6', '#0096c7', '#00b4d8', '#48cae4', '#90e0ef', '#ade8f4', '#caf0f8', '#264653'],
  warm: ['#d00000', '#dc2f02', '#e85d04', '#f48c06', '#faa307', '#ffba08', '#ffd60a', '#9d0208', '#6a040f', '#370617'],
  pastel: ['#ffd6ff', '#e7c6ff', '#c8b6ff', '#b8c0ff', '#bbd0ff', '#caffbf', '#fdffb6', '#ffd6a5', '#ffadad', '#a0c4ff'],
  scientific: ['#264653', '#2a9d8f', '#e9c46a', '#f4a261', '#e76f51', '#606c38', '#283618', '#dda15e', '#bc6c25', '#001219'],
  diverging: ['#d73027', '#f46d43', '#fdae61', '#fee08b', '#ffffbf', '#d9ef8b', '#a6d96a', '#66bd63', '#1a9850', '#006837'],
  monochrome: ['#0d1b2a', '#1b2838', '#2b3a4a', '#3c4d5e', '#4d6072', '#5e7388', '#70869e', '#8299b4', '#94acca', '#a6bfe0'],
}

const CHART_TYPES: { value: ChartType; label: string; group: string }[] = [
  // Bars
  { value: 'bar', label: 'Bar', group: 'Bar Charts' },
  { value: 'horizontal_bar', label: 'Horizontal Bar', group: 'Bar Charts' },
  { value: 'grouped_bar', label: 'Grouped Bar', group: 'Bar Charts' },
  { value: 'stacked_bar', label: 'Stacked Bar', group: 'Bar Charts' },
  { value: 'stacked_bar_100', label: 'Stacked Bar (100%)', group: 'Bar Charts' },
  { value: 'waterfall', label: 'Waterfall', group: 'Bar Charts' },
  // Lines
  { value: 'line', label: 'Line', group: 'Line Charts' },
  { value: 'multi_line', label: 'Multi-Line', group: 'Line Charts' },
  { value: 'step', label: 'Step', group: 'Line Charts' },
  { value: 'spline', label: 'Spline (Smooth)', group: 'Line Charts' },
  { value: 'stem', label: 'Stem (Lollipop)', group: 'Line Charts' },
  // Areas
  { value: 'area', label: 'Area', group: 'Area Charts' },
  { value: 'stacked_area', label: 'Stacked Area', group: 'Area Charts' },
  { value: 'stream', label: 'Streamgraph', group: 'Area Charts' },
  { value: 'band', label: 'Band / Range', group: 'Area Charts' },
  // Circular
  { value: 'pie', label: 'Pie', group: 'Circular Charts' },
  { value: 'donut', label: 'Donut', group: 'Circular Charts' },
  { value: 'radial_bar', label: 'Radial Bar', group: 'Circular Charts' },
  { value: 'polar_area', label: 'Polar Area', group: 'Circular Charts' },
  { value: 'radar', label: 'Radar / Spider', group: 'Circular Charts' },
  // Scatter
  { value: 'scatter', label: 'Scatter', group: 'Scatter / Bubble' },
  { value: 'bubble', label: 'Bubble', group: 'Scatter / Bubble' },
  // Statistical
  { value: 'histogram', label: 'Histogram', group: 'Statistical' },
  { value: 'box_plot', label: 'Box Plot', group: 'Statistical' },
  { value: 'error_bar', label: 'Error Bars', group: 'Statistical' },
  { value: 'candlestick', label: 'Candlestick', group: 'Statistical' },
  // Other
  { value: 'heatmap', label: 'Heatmap', group: 'Other' },
  { value: 'funnel', label: 'Funnel', group: 'Other' },
  { value: 'treemap', label: 'Treemap', group: 'Other' },
]

const TOOLTIP_STYLE = {
  background: 'var(--color-surface-solid)',
  border: '1px solid var(--color-border)',
  borderRadius: '8px',
  fontSize: '12px',
  color: 'var(--color-text)',
}

const AXIS_TICK = { fontSize: 11, fill: 'var(--color-text-muted)' }

// ─── Helpers ────────────────────────────────────────────────────
function parseCSV(text: string): DataPoint[] {
  return text.split('\n').filter(l => l.trim()).map(line => {
    const parts = line.split(',').map(p => p.trim())
    const pt: DataPoint = { label: parts[0] || '', value: parseFloat(parts[1]) || 0 }
    if (parts[2] && !isNaN(parseFloat(parts[2]))) pt.value2 = parseFloat(parts[2])
    else if (parts[2]) pt.category = parts[2]
    if (parts[3] && !isNaN(parseFloat(parts[3]))) pt.value3 = parseFloat(parts[3])
    if (parts[4] && !isNaN(parseFloat(parts[4]))) pt.errorPlus = parseFloat(parts[4])
    if (parts[5] && !isNaN(parseFloat(parts[5]))) pt.errorMinus = parseFloat(parts[5])
    if (parts[6] && !isNaN(parseFloat(parts[6]))) pt.size = parseFloat(parts[6])
    return pt
  })
}

function getPalette(name: string): string[] {
  return PALETTES[name] || PALETTES.default
}

function computeBoxStats(values: number[]): { min: number; q1: number; median: number; q3: number; max: number; outliers: number[] } {
  const s = [...values].sort((a, b) => a - b)
  const n = s.length
  const q1 = s[Math.floor(n * 0.25)]
  const median = n % 2 === 0 ? (s[n / 2 - 1] + s[n / 2]) / 2 : s[Math.floor(n / 2)]
  const q3 = s[Math.floor(n * 0.75)]
  const iqr = q3 - q1
  const lo = q1 - 1.5 * iqr
  const hi = q3 + 1.5 * iqr
  const outliers = s.filter(v => v < lo || v > hi)
  return { min: Math.max(s[0], lo), q1, median, q3, max: Math.min(s[n - 1], hi), outliers }
}

function computeHistogram(values: number[], bins = 15): { label: string; count: number }[] {
  if (!values.length) return []
  const mn = Math.min(...values), mx = Math.max(...values)
  const w = (mx - mn) / bins || 1
  const buckets = Array.from({ length: bins }, (_, i) => ({
    label: `${(mn + i * w).toFixed(1)}`,
    lo: mn + i * w,
    hi: mn + (i + 1) * w,
    count: 0,
  }))
  values.forEach(v => {
    const idx = Math.min(Math.floor((v - mn) / w), bins - 1)
    if (idx >= 0) buckets[idx].count++
  })
  return buckets.map(b => ({ label: b.label, count: b.count }))
}

// ─── Component ──────────────────────────────────────────────────
export default function DataVisualization() {
  const [charts, setCharts] = useState<ChartConfig[]>(() => persistGet<ChartConfig[]>('charts', []))
  const [showAdd, setShowAdd] = useState(false)
  const [showSettings, setShowSettings] = useState<string | null>(null)
  const [expandedChart, setExpandedChart] = useState<string | null>(null)
  const chartRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ─── Form state ─────────────────────────────────────────────
  const [form, setForm] = useState({
    title: '', type: 'bar' as ChartType, dataText: '',
    options: { ...defaultOptions },
  })

  const saveCharts = (updated: ChartConfig[]) => {
    setCharts(updated)
    persistSet('charts', updated)
  }

  const addChart = () => {
    if (!form.title.trim() || !form.dataText.trim()) return
    const chart: ChartConfig = {
      id: `chart-${Date.now()}`,
      title: form.title,
      type: form.type,
      data: parseCSV(form.dataText),
      options: { ...form.options },
      createdAt: new Date().toISOString(),
    }
    saveCharts([chart, ...charts])
    setForm({ title: '', type: 'bar', dataText: '', options: { ...defaultOptions } })
    setShowAdd(false)
  }

  const deleteChart = (id: string) => saveCharts(charts.filter(c => c.id !== id))
  const duplicateChart = (c: ChartConfig) => {
    const dup = { ...c, id: `chart-${Date.now()}`, title: c.title + ' (copy)', createdAt: new Date().toISOString() }
    saveCharts([dup, ...charts])
  }
  const updateChartOptions = (id: string, opts: Partial<ChartOptions>) => {
    saveCharts(charts.map(c => c.id === id ? { ...c, options: { ...c.options, ...opts } } : c))
  }

  // ─── File upload ────────────────────────────────────────────
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      if (!text) return
      const lines = text.split('\n').filter(l => l.trim())
      if (!lines.length) return
      const sep = text.includes('\t') ? /\t/ : /,/
      const first = lines[0].split(sep).map(p => p.trim().replace(/^["']|["']$/g, ''))
      const hasHeader = first.length >= 2 && isNaN(parseFloat(first[1]))
      const dataLines = hasHeader ? lines.slice(1) : lines
      const dataText = dataLines.map(l => l.split(sep).map(p => p.trim().replace(/^["']|["']$/g, '')).join(', ')).join('\n')
      const title = file.name.replace(/\.(csv|tsv|xlsx?|txt)$/i, '').replace(/[-_]/g, ' ')
      setForm(f => ({ ...f, title: title || f.title, dataText }))
      setShowAdd(true)
    }
    reader.readAsText(file)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ─── Export ─────────────────────────────────────────────────
  const exportPng = useCallback((id: string, title: string) => {
    const el = chartRefs.current[id]
    if (!el) return
    const svg = el.querySelector('svg')
    if (!svg) return
    const svgData = new XMLSerializer().serializeToString(svg)
    const canvas = document.createElement('canvas')
    const r = svg.getBoundingClientRect()
    canvas.width = r.width * 2; canvas.height = r.height * 2
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(2, 2)
    ctx.fillStyle = '#0f172a'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    const img = new Image()
    img.onload = () => { ctx.drawImage(img, 0, 0); const a = document.createElement('a'); a.download = `${title.replace(/\s+/g, '-').toLowerCase()}.png`; a.href = canvas.toDataURL('image/png'); a.click() }
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)))
  }, [])

  const exportSvg = useCallback((id: string, title: string) => {
    const el = chartRefs.current[id]
    if (!el) return
    const svg = el.querySelector('svg')
    if (!svg) return
    const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' })
    const a = document.createElement('a')
    a.download = `${title.replace(/\s+/g, '-').toLowerCase()}.svg`
    a.href = URL.createObjectURL(blob); a.click(); URL.revokeObjectURL(a.href)
  }, [])

  const exportCsv = useCallback((chart: ChartConfig) => {
    const hdr = ['label', 'value', chart.data.some(d => d.category) ? 'category' : '', chart.data.some(d => d.value2 !== undefined) ? 'value2' : ''].filter(Boolean)
    const rows = [hdr.join(','), ...chart.data.map(d => {
      const parts = [`"${d.label}"`, d.value]
      if (hdr.includes('category')) parts.push(`"${d.category || ''}"`)
      if (hdr.includes('value2')) parts.push(d.value2 ?? '')
      return parts.join(',')
    })]
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.download = `${chart.title.replace(/\s+/g, '-').toLowerCase()}.csv`
    a.href = URL.createObjectURL(blob); a.click(); URL.revokeObjectURL(a.href)
  }, [])

  // ─── Grouped chart types for dropdown ───────────────────────
  const chartTypeGroups = useMemo(() => {
    const groups: Record<string, typeof CHART_TYPES> = {}
    CHART_TYPES.forEach(ct => { if (!groups[ct.group]) groups[ct.group] = []; groups[ct.group].push(ct) })
    return groups
  }, [])

  // ─── Render any chart ───────────────────────────────────────
  const renderChart = (chart: ChartConfig, height = 300) => {
    const { data, type, options: o } = chart
    const colors = getPalette(o.colorPalette)
    const gridEl = o.showGrid ? <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" /> : null
    const tooltipEl = <Tooltip contentStyle={TOOLTIP_STYLE} />
    const legendEl = o.showLegend ? <Legend wrapperStyle={{ fontSize: 11 }} /> : null
    const xAxisEl = <XAxis dataKey="label" tick={AXIS_TICK} label={o.xLabel ? { value: o.xLabel, position: 'insideBottom', offset: -5, style: { fontSize: 11, fill: 'var(--color-text-muted)' } } : undefined} scale={o.logScaleX ? 'log' : 'auto'} />
    const yAxisEl = <YAxis tick={AXIS_TICK} label={o.yLabel ? { value: o.yLabel, angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: 'var(--color-text-muted)' } } : undefined} scale={o.logScaleY ? 'log' : 'auto'} domain={o.logScaleY ? ['auto', 'auto'] : undefined} />

    switch (type) {
      // ── BAR CHARTS ──────────────────────────────────────────
      case 'bar':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <BarChart data={data} barGap={o.barGap}>
              {gridEl}{xAxisEl}{yAxisEl}{tooltipEl}{legendEl}
              <Bar dataKey="value" fill={colors[0]} radius={[4, 4, 0, 0]} animationDuration={o.animate ? 400 : 0}>
                {o.showValues && <LabelList dataKey="value" position="top" style={{ fontSize: 10, fill: 'var(--color-text-muted)' }} />}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )

      case 'horizontal_bar':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <BarChart data={data} layout="vertical" barGap={o.barGap}>
              {gridEl}
              <XAxis type="number" tick={AXIS_TICK} />
              <YAxis dataKey="label" type="category" tick={AXIS_TICK} width={90} />
              {tooltipEl}{legendEl}
              <Bar dataKey="value" fill={colors[0]} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )

      case 'grouped_bar': {
        const cats = [...new Set(data.map(d => d.category).filter(Boolean))]
        if (cats.length === 0) {
          // Use value + value2 as two series
          return (
            <ResponsiveContainer width="100%" height={height}>
              <BarChart data={data} barGap={o.barGap}>
                {gridEl}{xAxisEl}{yAxisEl}{tooltipEl}{legendEl}
                <Bar dataKey="value" name="Series 1" fill={colors[0]} radius={[4, 4, 0, 0]} />
                {data.some(d => d.value2 !== undefined) && <Bar dataKey="value2" name="Series 2" fill={colors[1]} radius={[4, 4, 0, 0]} />}
                {data.some(d => d.value3 !== undefined) && <Bar dataKey="value3" name="Series 3" fill={colors[2]} radius={[4, 4, 0, 0]} />}
              </BarChart>
            </ResponsiveContainer>
          )
        }
        const labels = [...new Set(data.map(d => d.label))]
        const pivoted = labels.map(label => {
          const row: Record<string, any> = { label }
          cats.forEach(cat => { row[cat!] = data.find(d => d.label === label && d.category === cat)?.value || 0 })
          return row
        })
        return (
          <ResponsiveContainer width="100%" height={height}>
            <BarChart data={pivoted} barGap={o.barGap}>
              {gridEl}{xAxisEl}{yAxisEl}{tooltipEl}{legendEl}
              {cats.map((cat, i) => <Bar key={cat} dataKey={cat!} fill={colors[i % colors.length]} radius={[4, 4, 0, 0]} />)}
            </BarChart>
          </ResponsiveContainer>
        )
      }

      case 'stacked_bar':
      case 'stacked_bar_100': {
        const cats = [...new Set(data.map(d => d.category).filter(Boolean))]
        if (cats.length === 0) {
          return (
            <ResponsiveContainer width="100%" height={height}>
              <BarChart data={data}>
                {gridEl}{xAxisEl}{yAxisEl}{tooltipEl}{legendEl}
                <Bar dataKey="value" stackId="a" fill={colors[0]} />
                {data.some(d => d.value2 !== undefined) && <Bar dataKey="value2" stackId="a" fill={colors[1]} />}
              </BarChart>
            </ResponsiveContainer>
          )
        }
        const labels = [...new Set(data.map(d => d.label))]
        let pivoted = labels.map(label => {
          const row: Record<string, any> = { label }
          cats.forEach(cat => { row[cat!] = data.find(d => d.label === label && d.category === cat)?.value || 0 })
          return row
        })
        if (type === 'stacked_bar_100') {
          pivoted = pivoted.map(row => {
            const total = cats.reduce((s, cat) => s + (row[cat!] || 0), 0)
            const normalized: Record<string, any> = { label: row.label }
            cats.forEach(cat => { normalized[cat!] = total > 0 ? Math.round((row[cat!] / total) * 100 * 10) / 10 : 0 })
            return normalized
          })
        }
        return (
          <ResponsiveContainer width="100%" height={height}>
            <BarChart data={pivoted}>
              {gridEl}{xAxisEl}{yAxisEl}{tooltipEl}{legendEl}
              {cats.map((cat, i) => <Bar key={cat} dataKey={cat!} stackId="a" fill={colors[i % colors.length]} />)}
            </BarChart>
          </ResponsiveContainer>
        )
      }

      case 'waterfall': {
        let cumulative = 0
        const waterfallData = data.map((d, i) => {
          const start = cumulative
          cumulative += d.value
          return { ...d, start, end: cumulative, fill: i === data.length - 1 ? colors[2] : d.value >= 0 ? colors[0] : colors[3] || '#ef4444' }
        })
        return (
          <ResponsiveContainer width="100%" height={height}>
            <BarChart data={waterfallData}>
              {gridEl}{xAxisEl}{yAxisEl}{tooltipEl}
              <Bar dataKey="end" fill="transparent" stackId="w">
                {waterfallData.map((d, i) => <Cell key={i} fill="transparent" />)}
              </Bar>
              <Bar dataKey="value" stackId="w2" radius={[3, 3, 0, 0]}>
                {waterfallData.map((d, i) => <Cell key={i} fill={d.fill} />)}
              </Bar>
              <ReferenceLine y={0} stroke="var(--color-text-muted)" strokeDasharray="3 3" />
            </BarChart>
          </ResponsiveContainer>
        )
      }

      // ── LINE CHARTS ─────────────────────────────────────────
      case 'line':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <LineChart data={data}>
              {gridEl}{xAxisEl}{yAxisEl}{tooltipEl}{legendEl}
              <Line type={o.smooth ? 'monotone' : 'linear'} dataKey="value" stroke={colors[0]} strokeWidth={o.lineWidth} dot={{ r: o.markerSize, fill: colors[0] }} animationDuration={o.animate ? 400 : 0} />
            </LineChart>
          </ResponsiveContainer>
        )

      case 'multi_line':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <LineChart data={data}>
              {gridEl}{xAxisEl}{yAxisEl}{tooltipEl}{legendEl}
              <Line type="monotone" dataKey="value" name="Series 1" stroke={colors[0]} strokeWidth={o.lineWidth} dot={{ r: o.markerSize }} />
              {data.some(d => d.value2 !== undefined) && <Line type="monotone" dataKey="value2" name="Series 2" stroke={colors[1]} strokeWidth={o.lineWidth} dot={{ r: o.markerSize }} />}
              {data.some(d => d.value3 !== undefined) && <Line type="monotone" dataKey="value3" name="Series 3" stroke={colors[2]} strokeWidth={o.lineWidth} dot={{ r: o.markerSize }} />}
            </LineChart>
          </ResponsiveContainer>
        )

      case 'step':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <LineChart data={data}>
              {gridEl}{xAxisEl}{yAxisEl}{tooltipEl}{legendEl}
              <Line type="stepAfter" dataKey="value" stroke={colors[0]} strokeWidth={o.lineWidth} dot={{ r: o.markerSize, fill: colors[0] }} />
            </LineChart>
          </ResponsiveContainer>
        )

      case 'spline':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <LineChart data={data}>
              {gridEl}{xAxisEl}{yAxisEl}{tooltipEl}{legendEl}
              <Line type="natural" dataKey="value" stroke={colors[0]} strokeWidth={o.lineWidth} dot={{ r: o.markerSize, fill: colors[0] }} />
            </LineChart>
          </ResponsiveContainer>
        )

      case 'stem':
        // Lollipop chart: bars + dots
        return (
          <ResponsiveContainer width="100%" height={height}>
            <ComposedChart data={data}>
              {gridEl}{xAxisEl}{yAxisEl}{tooltipEl}
              <Bar dataKey="value" fill={colors[0]} barSize={2} />
              <Line type="linear" dataKey="value" stroke="none" dot={{ r: o.markerSize + 2, fill: colors[0], strokeWidth: 0 }} />
            </ComposedChart>
          </ResponsiveContainer>
        )

      // ── AREA CHARTS ─────────────────────────────────────────
      case 'area':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <AreaChart data={data}>
              {gridEl}{xAxisEl}{yAxisEl}{tooltipEl}{legendEl}
              <Area type="monotone" dataKey="value" stroke={colors[0]} fill={colors[0]} fillOpacity={o.fillOpacity} strokeWidth={o.lineWidth} />
            </AreaChart>
          </ResponsiveContainer>
        )

      case 'stacked_area':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <AreaChart data={data}>
              {gridEl}{xAxisEl}{yAxisEl}{tooltipEl}{legendEl}
              <Area type="monotone" dataKey="value" stackId="1" name="Series 1" stroke={colors[0]} fill={colors[0]} fillOpacity={o.fillOpacity} />
              {data.some(d => d.value2 !== undefined) && <Area type="monotone" dataKey="value2" stackId="1" name="Series 2" stroke={colors[1]} fill={colors[1]} fillOpacity={o.fillOpacity} />}
              {data.some(d => d.value3 !== undefined) && <Area type="monotone" dataKey="value3" stackId="1" name="Series 3" stroke={colors[2]} fill={colors[2]} fillOpacity={o.fillOpacity} />}
            </AreaChart>
          </ResponsiveContainer>
        )

      case 'stream':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <AreaChart data={data} stackOffset="silhouette">
              {gridEl}{xAxisEl}{yAxisEl}{tooltipEl}{legendEl}
              <Area type="monotone" dataKey="value" stackId="1" stroke={colors[0]} fill={colors[0]} fillOpacity={0.6} />
              {data.some(d => d.value2 !== undefined) && <Area type="monotone" dataKey="value2" stackId="1" stroke={colors[1]} fill={colors[1]} fillOpacity={0.6} />}
              {data.some(d => d.value3 !== undefined) && <Area type="monotone" dataKey="value3" stackId="1" stroke={colors[2]} fill={colors[2]} fillOpacity={0.6} />}
            </AreaChart>
          </ResponsiveContainer>
        )

      case 'band':
        // Render as area between value (low) and value2 (high)
        return (
          <ResponsiveContainer width="100%" height={height}>
            <AreaChart data={data}>
              {gridEl}{xAxisEl}{yAxisEl}{tooltipEl}{legendEl}
              <Area type="monotone" dataKey="value2" stroke="none" fill={colors[0]} fillOpacity={o.fillOpacity} name="Upper" />
              <Area type="monotone" dataKey="value" stroke="none" fill="var(--color-bg)" fillOpacity={1} name="Lower" />
              <Line type="monotone" dataKey="value" stroke={colors[0]} strokeWidth={o.lineWidth} dot={false} />
              <Line type="monotone" dataKey="value2" stroke={colors[0]} strokeWidth={o.lineWidth} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        )

      // ── CIRCULAR CHARTS ─────────────────────────────────────
      case 'pie':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="label" cx="50%" cy="50%" outerRadius={height / 3}
                label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`} startAngle={o.startAngle} endAngle={o.startAngle + 360}>
                {data.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
              </Pie>
              {tooltipEl}{legendEl}
            </PieChart>
          </ResponsiveContainer>
        )

      case 'donut':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="label" cx="50%" cy="50%"
                innerRadius={o.innerRadius} outerRadius={height / 3}
                label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`}
                startAngle={o.startAngle} endAngle={o.startAngle + 360}>
                {data.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
              </Pie>
              {tooltipEl}{legendEl}
            </PieChart>
          </ResponsiveContainer>
        )

      case 'radial_bar': {
        const rbData = data.map((d, i) => ({ ...d, fill: colors[i % colors.length] }))
        return (
          <ResponsiveContainer width="100%" height={height}>
            <RadialBarChart data={rbData} cx="50%" cy="50%" innerRadius="20%" outerRadius="90%" startAngle={180} endAngle={0}>
              <RadialBar dataKey="value" label={{ fill: 'var(--color-text-muted)', fontSize: 10 }} />
              {tooltipEl}{legendEl}
            </RadialBarChart>
          </ResponsiveContainer>
        )
      }

      case 'polar_area':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <RadarChart data={data} cx="50%" cy="50%" outerRadius="70%">
              <PolarGrid stroke="var(--color-border)" />
              <PolarAngleAxis dataKey="label" tick={AXIS_TICK} />
              <PolarRadiusAxis tick={AXIS_TICK} />
              <Radar dataKey="value" stroke={colors[0]} fill={colors[0]} fillOpacity={0.5} />
              {tooltipEl}
            </RadarChart>
          </ResponsiveContainer>
        )

      case 'radar':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <RadarChart data={data} cx="50%" cy="50%" outerRadius="70%">
              <PolarGrid stroke="var(--color-border)" />
              <PolarAngleAxis dataKey="label" tick={AXIS_TICK} />
              <PolarRadiusAxis tick={AXIS_TICK} />
              <Radar dataKey="value" name="Series 1" stroke={colors[0]} fill={colors[0]} fillOpacity={o.fillOpacity} strokeWidth={o.lineWidth} />
              {data.some(d => d.value2 !== undefined) && (
                <Radar dataKey="value2" name="Series 2" stroke={colors[1]} fill={colors[1]} fillOpacity={o.fillOpacity} strokeWidth={o.lineWidth} />
              )}
              {tooltipEl}{legendEl}
            </RadarChart>
          </ResponsiveContainer>
        )

      // ── SCATTER / BUBBLE ────────────────────────────────────
      case 'scatter':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <ScatterChart>
              {gridEl}
              <XAxis dataKey="value" name={o.xLabel || 'X'} tick={AXIS_TICK} type="number" />
              <YAxis dataKey="value2" name={o.yLabel || 'Y'} tick={AXIS_TICK} type="number" />
              {tooltipEl}
              <Scatter data={data.map(d => ({ ...d, value2: d.value2 ?? d.value }))} fill={colors[0]}>
                {data.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        )

      case 'bubble':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <ScatterChart>
              {gridEl}
              <XAxis dataKey="value" name="X" tick={AXIS_TICK} type="number" />
              <YAxis dataKey="value2" name="Y" tick={AXIS_TICK} type="number" />
              <ZAxis dataKey="size" range={[40, 400]} name="Size" />
              {tooltipEl}
              <Scatter data={data.map(d => ({ ...d, value2: d.value2 ?? d.value, size: d.size ?? d.value }))} fill={colors[0]}>
                {data.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} opacity={0.7} />)}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        )

      // ── STATISTICAL ─────────────────────────────────────────
      case 'histogram': {
        const hist = computeHistogram(data.map(d => d.value))
        return (
          <ResponsiveContainer width="100%" height={height}>
            <BarChart data={hist}>
              {gridEl}
              <XAxis dataKey="label" tick={AXIS_TICK} />
              <YAxis tick={AXIS_TICK} />
              {tooltipEl}
              <Bar dataKey="count" fill={colors[0]} radius={[2, 2, 0, 0]}>
                {hist.map((_, i) => <Cell key={i} fill={colors[0]} opacity={0.8} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )
      }

      case 'box_plot': {
        // Group by category or treat all as one group
        const groups: Record<string, number[]> = {}
        data.forEach(d => {
          const grp = d.category || d.label || 'All'
          if (!groups[grp]) groups[grp] = []
          groups[grp].push(d.value)
        })
        const boxData = Object.entries(groups).map(([name, vals]) => {
          const stats = computeBoxStats(vals)
          return { name, ...stats, outlierCount: stats.outliers.length }
        })
        // Render as bar chart with custom rendering
        return (
          <ResponsiveContainer width="100%" height={height}>
            <ComposedChart data={boxData}>
              {gridEl}
              <XAxis dataKey="name" tick={AXIS_TICK} />
              <YAxis tick={AXIS_TICK} />
              {tooltipEl}
              {/* IQR box */}
              <Bar dataKey="q3" fill="transparent" stackId="box" />
              <Bar dataKey="median" fill={colors[0]} opacity={0.3} stackId="box2" barSize={40} radius={[4, 4, 4, 4]} />
              {/* Whiskers */}
              <Line type="linear" dataKey="max" stroke={colors[0]} dot={{ r: 3 }} />
              <Line type="linear" dataKey="min" stroke={colors[0]} dot={{ r: 3 }} />
              <Line type="linear" dataKey="q1" stroke={colors[0]} dot={{ r: 5, fill: colors[0] }} strokeWidth={0} />
              <Line type="linear" dataKey="q3" stroke={colors[0]} dot={{ r: 5, fill: colors[0] }} strokeWidth={0} />
              <ReferenceLine y={0} stroke="var(--color-border)" />
            </ComposedChart>
          </ResponsiveContainer>
        )
      }

      case 'error_bar':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <BarChart data={data}>
              {gridEl}{xAxisEl}{yAxisEl}{tooltipEl}
              <Bar dataKey="value" fill={colors[0]} radius={[4, 4, 0, 0]}>
                <ErrorBar dataKey="errorPlus" width={4} strokeWidth={2} stroke={colors[1] || '#ef4444'} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )

      case 'candlestick': {
        // value=open, value2=close, value3=high, errorPlus=low
        return (
          <ResponsiveContainer width="100%" height={height}>
            <ComposedChart data={data}>
              {gridEl}{xAxisEl}{yAxisEl}{tooltipEl}
              <Bar dataKey="value" fill="transparent" />
              {data.map((d, i) => {
                const open = d.value, close = d.value2 ?? d.value
                const color = close >= open ? '#22c55e' : '#ef4444'
                return <ReferenceLine key={i} y={close} stroke={color} strokeWidth={0} />
              })}
              <Bar dataKey="value2" barSize={12}>
                {data.map((d, i) => {
                  const open = d.value, close = d.value2 ?? d.value
                  return <Cell key={i} fill={close >= open ? '#22c55e' : '#ef4444'} />
                })}
              </Bar>
              <Line type="linear" dataKey="value3" stroke="var(--color-text-muted)" strokeWidth={1} dot={{ r: 0 }} />
            </ComposedChart>
          </ResponsiveContainer>
        )
      }

      // ── HEATMAP ─────────────────────────────────────────────
      case 'heatmap': {
        const cats = [...new Set(data.map(d => d.category).filter(Boolean))]
        const labels = [...new Set(data.map(d => d.label))]
        const maxVal = Math.max(...data.map(d => Math.abs(d.value)), 1)
        const cellH = Math.max(20, Math.min(40, (height - 40) / Math.max(labels.length, 1)))
        const cellW = Math.max(40, 500 / Math.max(cats.length || 1, 1))
        return (
          <div style={{ overflowX: 'auto', height }}>
            <svg width={Math.max(cats.length * cellW + 100, 300)} height={Math.max(labels.length * cellH + 40, 100)}>
              {labels.map((label, ri) =>
                (cats.length > 0 ? cats : ['']).map((cat, ci) => {
                  const d = data.find(d => d.label === label && (cat === '' || d.category === cat))
                  const v = d?.value ?? 0
                  const intensity = Math.abs(v) / maxVal
                  const color = v >= 0
                    ? `rgba(59, 130, 246, ${intensity * 0.9})`
                    : `rgba(239, 68, 68, ${intensity * 0.9})`
                  return (
                    <g key={`${ri}-${ci}`}>
                      <rect x={90 + ci * cellW} y={20 + ri * cellH} width={cellW - 2} height={cellH - 2} fill={color} rx={3}>
                        <title>{`${label}${cat ? ` / ${cat}` : ''}: ${v}`}</title>
                      </rect>
                      <text x={90 + ci * cellW + cellW / 2} y={20 + ri * cellH + cellH / 2} textAnchor="middle" dominantBaseline="central"
                        fill="var(--color-text)" fontSize={9} opacity={0.8}>{v.toFixed(1)}</text>
                    </g>
                  )
                })
              )}
              {labels.map((label, ri) => (
                <text key={ri} x={85} y={20 + ri * cellH + cellH / 2} textAnchor="end" dominantBaseline="central"
                  fill="var(--color-text-muted)" fontSize={10}>{label}</text>
              ))}
              {cats.length > 0 && cats.map((cat, ci) => (
                <text key={ci} x={90 + ci * cellW + cellW / 2} y={12} textAnchor="middle"
                  fill="var(--color-text-muted)" fontSize={10}>{cat}</text>
              ))}
            </svg>
          </div>
        )
      }

      // ── FUNNEL / TREEMAP ────────────────────────────────────
      case 'funnel':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <FunnelChart>
              {tooltipEl}
              <Funnel dataKey="value" data={data.map((d, i) => ({ ...d, fill: colors[i % colors.length] }))} isAnimationActive={o.animate}>
                <LabelList position="right" fill="var(--color-text)" stroke="none" dataKey="label" fontSize={11} />
              </Funnel>
            </FunnelChart>
          </ResponsiveContainer>
        )

      case 'treemap':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <Treemap
              data={data.map((d, i) => ({ name: d.label, size: d.value, fill: colors[i % colors.length] }))}
              dataKey="size" aspectRatio={4 / 3} stroke="var(--color-border)"
              content={({ x, y, width, height: h, name, fill }: any) => (
                <g>
                  <rect x={x} y={y} width={width} height={h} fill={fill} stroke="var(--color-border)" strokeWidth={1} rx={4} />
                  {width > 40 && h > 20 && <text x={x + width / 2} y={y + h / 2} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={11}>{name}</text>}
                </g>
              )}
            />
          </ResponsiveContainer>
        )

      default:
        return <div className="text-center text-xs text-[var(--color-text-muted)] py-8">Chart type "{type}" not yet rendered</div>
    }
  }

  // ─── Settings Panel ─────────────────────────────────────────
  const renderSettingsPanel = (chart: ChartConfig) => (
    <div className="p-4 border-t border-[var(--color-border)] bg-[var(--glass-bg)] space-y-3 animate-slide-down">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xxs text-[var(--color-text-muted)] block mb-0.5">X-Axis Label</label>
          <input className="input text-xs w-full" value={chart.options.xLabel} onChange={e => updateChartOptions(chart.id, { xLabel: e.target.value })} placeholder="X axis" />
        </div>
        <div>
          <label className="text-xxs text-[var(--color-text-muted)] block mb-0.5">Y-Axis Label</label>
          <input className="input text-xs w-full" value={chart.options.yLabel} onChange={e => updateChartOptions(chart.id, { yLabel: e.target.value })} placeholder="Y axis" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-xxs text-[var(--color-text-muted)] block mb-0.5">Color Palette</label>
          <select className="input text-xs w-full" value={chart.options.colorPalette} onChange={e => updateChartOptions(chart.id, { colorPalette: e.target.value })}>
            {Object.keys(PALETTES).map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xxs text-[var(--color-text-muted)] block mb-0.5">Legend Position</label>
          <select className="input text-xs w-full" value={chart.options.legendPosition} onChange={e => updateChartOptions(chart.id, { legendPosition: e.target.value as any })}>
            <option value="top">Top</option><option value="bottom">Bottom</option>
            <option value="left">Left</option><option value="right">Right</option>
          </select>
        </div>
        <div>
          <label className="text-xxs text-[var(--color-text-muted)] block mb-0.5">Line Width</label>
          <input type="range" min={1} max={5} step={0.5} value={chart.options.lineWidth} onChange={e => updateChartOptions(chart.id, { lineWidth: parseFloat(e.target.value) })} className="w-full" />
        </div>
      </div>
      <div className="grid grid-cols-4 gap-3">
        <div>
          <label className="text-xxs text-[var(--color-text-muted)] block mb-0.5">Marker Size</label>
          <input type="range" min={0} max={10} step={1} value={chart.options.markerSize} onChange={e => updateChartOptions(chart.id, { markerSize: parseInt(e.target.value) })} className="w-full" />
        </div>
        <div>
          <label className="text-xxs text-[var(--color-text-muted)] block mb-0.5">Fill Opacity</label>
          <input type="range" min={0} max={1} step={0.05} value={chart.options.fillOpacity} onChange={e => updateChartOptions(chart.id, { fillOpacity: parseFloat(e.target.value) })} className="w-full" />
        </div>
        <div>
          <label className="text-xxs text-[var(--color-text-muted)] block mb-0.5">Donut Inner R</label>
          <input type="range" min={20} max={100} step={5} value={chart.options.innerRadius} onChange={e => updateChartOptions(chart.id, { innerRadius: parseInt(e.target.value) })} className="w-full" />
        </div>
        <div>
          <label className="text-xxs text-[var(--color-text-muted)] block mb-0.5">Bar Gap</label>
          <input type="range" min={0} max={20} step={1} value={chart.options.barGap} onChange={e => updateChartOptions(chart.id, { barGap: parseInt(e.target.value) })} className="w-full" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-xs">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={chart.options.showGrid} onChange={e => updateChartOptions(chart.id, { showGrid: e.target.checked })} />
          Grid
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={chart.options.showLegend} onChange={e => updateChartOptions(chart.id, { showLegend: e.target.checked })} />
          Legend
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={chart.options.showValues} onChange={e => updateChartOptions(chart.id, { showValues: e.target.checked })} />
          Show Values
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={chart.options.logScaleX} onChange={e => updateChartOptions(chart.id, { logScaleX: e.target.checked })} />
          Log X
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={chart.options.logScaleY} onChange={e => updateChartOptions(chart.id, { logScaleY: e.target.checked })} />
          Log Y
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={chart.options.animate} onChange={e => updateChartOptions(chart.id, { animate: e.target.checked })} />
          Animate
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={chart.options.smooth} onChange={e => updateChartOptions(chart.id, { smooth: e.target.checked })} />
          Smooth
        </label>
      </div>
      {/* Palette preview */}
      <div className="flex items-center gap-1">
        <span className="text-xxs text-[var(--color-text-muted)] mr-1">Palette:</span>
        {getPalette(chart.options.colorPalette).slice(0, 10).map((c, i) => (
          <div key={i} className="w-4 h-4 rounded-sm" style={{ background: c }} />
        ))}
      </div>
    </div>
  )

  // ─── Layout ─────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-6 border-b border-[var(--color-border)]">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Data Visualization Engine</h1>
            <p className="text-sm text-[var(--color-text-muted)] mt-1">
              {charts.length} chart{charts.length !== 1 ? 's' : ''} — 29 chart types, CSV/TSV upload, full customization, PNG/SVG/CSV export
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input ref={fileInputRef} type="file" accept=".csv,.tsv,.txt" onChange={handleFileUpload} className="hidden" />
            <button onClick={() => fileInputRef.current?.click()} className="btn text-sm border border-[var(--color-border)]" style={{ color: 'var(--color-accent-green)' }}>
              <FiUpload className="w-4 h-4" /> Upload CSV
            </button>
            <button onClick={() => setShowAdd(!showAdd)} className="btn text-sm" style={{ color: 'var(--color-accent-blue)' }}>
              <FiPlus className="w-4 h-4" /> New Chart
            </button>
          </div>
        </div>
      </div>

      {/* New Chart Form */}
      {showAdd && (
        <div className="p-4 border-b border-[var(--color-border)] bg-[var(--glass-bg)] animate-slide-down">
          <div className="max-w-4xl mx-auto space-y-3">
            <div className="flex gap-3">
              <input type="text" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="Chart title *" className="input flex-1 text-sm" />
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as ChartType }))} className="input text-xs w-48">
                {Object.entries(chartTypeGroups).map(([group, types]) => (
                  <optgroup key={group} label={group}>
                    {types.map(ct => <option key={ct.value} value={ct.value}>{ct.label}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <select value={form.options.colorPalette} onChange={e => setForm(f => ({ ...f, options: { ...f.options, colorPalette: e.target.value } }))} className="input text-xs">
                {Object.keys(PALETTES).map(p => <option key={p} value={p}>{p} palette</option>)}
              </select>
              <div className="flex items-center gap-1">
                {getPalette(form.options.colorPalette).slice(0, 10).map((c, i) => (
                  <div key={i} className="w-5 h-5 rounded-sm" style={{ background: c }} />
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs text-[var(--color-text-muted)] mb-1 block">
                Data — one entry per line: <span className="font-mono">label, value[, value2, value3, errorPlus, errorMinus, size]</span>
                <br />For categories: <span className="font-mono">label, value, categoryName</span>
              </label>
              <textarea value={form.dataText} onChange={e => setForm(f => ({ ...f, dataText: e.target.value }))}
                placeholder={"e.g.:\nSample A, 45\nSample B, 72\nSample C, 38\nSample D, 91\n\nOr multi-series:\nJan, 10, 15, 8\nFeb, 20, 25, 12\nMar, 15, 30, 20\n\nOr categorized:\nQ1, 100, Sales\nQ1, 80, Marketing\nQ2, 120, Sales\nQ2, 95, Marketing"}
                rows={6} className="input w-full text-xs font-mono resize-none" />
            </div>
            <div className="flex gap-2">
              <button onClick={addChart} disabled={!form.title.trim() || !form.dataText.trim()}
                className="btn text-xs disabled:opacity-30" style={{ color: 'var(--color-success)' }}>
                <FiSave className="w-3.5 h-3.5" /> Create Chart
              </button>
              <button onClick={() => setShowAdd(false)} className="btn text-xs text-[var(--color-text-muted)]">
                <FiX className="w-3.5 h-3.5" /> Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Charts Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        {charts.length === 0 ? (
          <div className="text-center py-16 text-[var(--color-text-muted)]">
            <FiBarChart2 className="w-12 h-12 mx-auto mb-4 opacity-20" />
            <p className="text-sm">No charts yet</p>
            <p className="text-xs mt-1">Create a visualization or upload a CSV file to get started</p>
            <div className="mt-6 max-w-md mx-auto text-left">
              <p className="text-xs font-medium mb-2">Supported chart types:</p>
              <div className="grid grid-cols-3 gap-1 text-xxs text-[var(--color-text-muted)]">
                {CHART_TYPES.map(ct => <span key={ct.value}>{ct.label}</span>)}
              </div>
            </div>
          </div>
        ) : (
          <div className={`max-w-7xl mx-auto ${expandedChart ? '' : 'grid grid-cols-1 lg:grid-cols-2 gap-6'}`}>
            {charts.filter(c => !expandedChart || c.id === expandedChart).map(chart => (
              <div key={chart.id} className="glass-card group">
                {/* Chart header */}
                <div className="flex items-center justify-between p-4 pb-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <FiBarChart2 className="w-4 h-4 flex-shrink-0 text-[var(--color-text-muted)]" />
                    <h3 className="text-sm font-medium truncate">{chart.title}</h3>
                    <span className="text-xxs px-1.5 py-0.5 rounded bg-[var(--glass-bg)] text-[var(--color-text-muted)]">
                      {CHART_TYPES.find(t => t.value === chart.type)?.label || chart.type}
                    </span>
                  </div>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => setShowSettings(showSettings === chart.id ? null : chart.id)}
                      className="p-1.5 rounded hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)] hover:text-[var(--color-accent-purple)]" title="Settings">
                      <FiSettings className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => setExpandedChart(expandedChart === chart.id ? null : chart.id)}
                      className="p-1.5 rounded hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)] hover:text-[var(--color-accent-cyan)]"
                      title={expandedChart ? 'Collapse' : 'Expand'}>
                      {expandedChart === chart.id ? <FiMinimize2 className="w-3.5 h-3.5" /> : <FiMaximize2 className="w-3.5 h-3.5" />}
                    </button>
                    <button onClick={() => exportPng(chart.id, chart.title)}
                      className="p-1.5 rounded hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)] hover:text-[var(--color-accent-blue)]" title="PNG">
                      <FiDownload className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => exportSvg(chart.id, chart.title)}
                      className="p-1.5 rounded hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)] hover:text-[var(--color-accent-green)]" title="SVG">
                      <FiDroplet className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => exportCsv(chart)}
                      className="p-1.5 rounded hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)] hover:text-[var(--color-accent-orange)]" title="CSV">
                      <FiCopy className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => duplicateChart(chart)}
                      className="p-1.5 rounded hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]" title="Duplicate">
                      <FiEdit3 className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => deleteChart(chart.id)}
                      className="p-1.5 rounded hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)] hover:text-[var(--color-error)]" title="Delete">
                      <FiTrash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Chart body */}
                <div className="p-4" ref={el => { chartRefs.current[chart.id] = el }}>
                  {renderChart(chart, expandedChart === chart.id ? 500 : 280)}
                </div>

                {/* Footer */}
                <div className="px-4 pb-3 flex items-center gap-3 text-xxs text-[var(--color-text-muted)]">
                  <span>{chart.data.length} pts</span>
                  <span>{chart.options.colorPalette}</span>
                  <span>{new Date(chart.createdAt).toLocaleDateString()}</span>
                </div>

                {/* Settings panel */}
                {showSettings === chart.id && renderSettingsPanel(chart)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
