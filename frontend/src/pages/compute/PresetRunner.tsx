import { useState, useCallback, useMemo, useRef } from 'react'
import {
  FiPlay, FiCopy, FiDownload, FiSearch, FiCheck, FiLoader,
  FiChevronRight, FiChevronLeft, FiAlertCircle, FiCode, FiGrid as FiGridIcon,
} from 'react-icons/fi'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ScatterChart, Scatter, AreaChart, Area,
} from 'recharts'
import type { Preset, ComputeResult, ToolboxCategory } from './types'
import { ALL_PRESETS, TOOLBOX_CATEGORIES } from './presets'

/* ── helpers ── */
const fmt = (v: number) => {
  if (Number.isNaN(v) || !Number.isFinite(v)) return String(v)
  if (Math.abs(v) >= 1e6 || (Math.abs(v) < 0.001 && v !== 0)) return v.toExponential(4)
  return Math.abs(v) < 10 ? v.toFixed(4) : v.toFixed(2)
}

/* ── Custom Recharts tooltip ── */
function ChartTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded px-2 py-1 text-xs border" style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-border)', color: 'var(--color-text)' }}>
      <div className="font-medium">{typeof label === 'number' ? fmt(label) : label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ color: p.color }}>{p.name}: {fmt(p.value)}</div>
      ))}
    </div>
  )
}

/* ── Main component ── */
export default function PresetRunner() {
  const [selectedToolbox, setSelectedToolbox] = useState<string | null>(null)
  const [selectedPreset, setSelectedPreset] = useState<Preset | null>(null)
  const [params, setParams] = useState<Record<string, any>>({})
  const [result, setResult] = useState<ComputeResult | null>(null)
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  const [search, setSearch] = useState('')
  const [showCode, setShowCode] = useState(false)
  const runTimeRef = useRef(0)

  /* filter presets */
  const filteredPresets = useMemo(() => {
    let list = ALL_PRESETS
    if (selectedToolbox) list = list.filter(p => p.toolbox === selectedToolbox)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.referenceFn.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.toolbox.toLowerCase().includes(q)
      )
    }
    return list
  }, [selectedToolbox, search])

  /* categories with dynamic counts */
  const categories = useMemo<ToolboxCategory[]>(() =>
    TOOLBOX_CATEGORIES.map(c => ({
      ...c,
      presetCount: ALL_PRESETS.filter(p => p.toolbox === c.id).length,
    }))
  , [])

  /* select preset → auto-fill sample data */
  const selectPreset = useCallback((preset: Preset) => {
    setSelectedPreset(preset)
    setResult(null)
    setError('')
    const newParams: Record<string, any> = {}
    if (preset.sampleData) {
      for (const [k, v] of Object.entries(preset.sampleData)) {
        newParams[k] = Array.isArray(v) ? v.join(', ') : String(v)
      }
    }
    for (const p of preset.params) {
      if (!(p.key in newParams) && p.default !== undefined) {
        newParams[p.key] = String(p.default)
      }
    }
    setParams(newParams)
  }, [])

  /* run computation */
  const runCompute = useCallback(() => {
    if (!selectedPreset) return
    setRunning(true)
    setError('')
    setResult(null)
    const t0 = performance.now()
    setTimeout(() => {
      try {
        const parsed: Record<string, any> = {}
        for (const p of selectedPreset.params) {
          const raw = params[p.key]
          if (p.type === 'textarea' || (p.type === 'string' && String(raw).includes(','))) {
            const arr = String(raw).split(',').map(s => s.trim())
            const nums = arr.map(Number)
            parsed[p.key] = nums.every(n => !isNaN(n)) ? nums : raw
          } else if (p.type === 'number') {
            parsed[p.key] = parseFloat(raw) || p.default || 0
          } else {
            parsed[p.key] = raw
          }
        }
        const res = selectedPreset.compute(parsed)
        runTimeRef.current = performance.now() - t0
        setResult(res)
      } catch (e: any) {
        setError(e.message || 'Computation failed')
      } finally {
        setRunning(false)
      }
    }, 30)
  }, [selectedPreset, params])

  /* export helpers */
  const copyStats = useCallback(() => {
    if (!result?.statistics) return
    const text = result.statistics.map(s => `${s.label}\t${s.value}`).join('\n')
    navigator.clipboard.writeText(text)
  }, [result])

  const exportJSON = useCallback(() => {
    if (!result) return
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${selectedPreset?.id || 'result'}.json`
    a.click()
  }, [result, selectedPreset])

  const exportCSV = useCallback(() => {
    if (!result?.chartData) return
    const keys = Object.keys(result.chartData[0])
    const rows = [keys.join(','), ...result.chartData.map(r => keys.map(k => (r as any)[k]).join(','))]
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${selectedPreset?.id || 'chart'}.csv`
    a.click()
  }, [result, selectedPreset])

  /* ── render chart ── */
  const renderChart = (res: ComputeResult) => {
    if (!res.chartData?.length) return null
    const margin = { top: 5, right: 10, bottom: 20, left: 5 }
    const axisStyle = { fontSize: 10, fill: 'var(--color-text-muted)' }
    const gridStyle = { strokeDasharray: '3 3', stroke: 'var(--glass-border)' }

    switch (res.chartType) {
      case 'scatter':
        return (
          <ResponsiveContainer width="100%" height={220}>
            <ScatterChart margin={margin}>
              <CartesianGrid {...gridStyle} />
              <XAxis dataKey="x" type="number" tick={axisStyle} label={res.xLabel ? { value: res.xLabel, position: 'bottom', style: { ...axisStyle, fontSize: 9 } } : undefined} />
              <YAxis dataKey="y" type="number" tick={axisStyle} label={res.yLabel ? { value: res.yLabel, angle: -90, position: 'left', style: { ...axisStyle, fontSize: 9 } } : undefined} />
              <Tooltip content={<ChartTip />} />
              <Scatter data={res.chartData} fill="var(--color-text)" r={2.5} fillOpacity={0.7} />
            </ScatterChart>
          </ResponsiveContainer>
        )
      case 'bar':
        return (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={res.chartData} margin={margin}>
              <CartesianGrid {...gridStyle} />
              <XAxis dataKey="label" tick={axisStyle} />
              <YAxis tick={axisStyle} />
              <Tooltip content={<ChartTip />} />
              <Bar dataKey="y" fill="var(--color-text)" fillOpacity={0.85} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )
      case 'area':
        return (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={res.chartData} margin={margin}>
              <CartesianGrid {...gridStyle} />
              <XAxis dataKey="x" type="number" tick={axisStyle} />
              <YAxis tick={axisStyle} />
              <Tooltip content={<ChartTip />} />
              <Area type="monotone" dataKey="y" stroke="var(--color-text)" fill="var(--color-text)" fillOpacity={0.15} />
            </AreaChart>
          </ResponsiveContainer>
        )
      case 'multi-line':
        return (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={res.chartData} margin={margin}>
              <CartesianGrid {...gridStyle} />
              <XAxis dataKey="x" type="number" tick={axisStyle} />
              <YAxis tick={axisStyle} />
              <Tooltip content={<ChartTip />} />
              <Line type="monotone" dataKey="y" stroke="#5B8DB8" dot={false} strokeWidth={1.5} name={res.seriesLabels?.[0] || 'y'} />
              {res.chartData.some(d => d.y2 !== undefined) && (
                <Line type="monotone" dataKey="y2" stroke="#8B7EAF" dot={false} strokeWidth={1.5} name={res.seriesLabels?.[1] || 'y2'} />
              )}
              {res.chartData.some(d => d.y3 !== undefined) && (
                <Line type="monotone" dataKey="y3" stroke="#6BA594" dot={false} strokeWidth={1.5} name={res.seriesLabels?.[2] || 'y3'} />
              )}
            </LineChart>
          </ResponsiveContainer>
        )
      default: // line
        return (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={res.chartData} margin={margin}>
              <CartesianGrid {...gridStyle} />
              <XAxis dataKey="x" type="number" tick={axisStyle} label={res.xLabel ? { value: res.xLabel, position: 'bottom', style: { ...axisStyle, fontSize: 9 } } : undefined} />
              <YAxis tick={axisStyle} label={res.yLabel ? { value: res.yLabel, angle: -90, position: 'left', style: { ...axisStyle, fontSize: 9 } } : undefined} />
              <Tooltip content={<ChartTip />} />
              <Line type="monotone" dataKey="y" stroke="var(--color-text)" dot={false} strokeWidth={1.5} />
            </LineChart>
          </ResponsiveContainer>
        )
    }
  }

  /* ── RENDER ── */
  return (
    <div className="flex h-full overflow-hidden">
      {/* ─── LEFT: Category Sidebar ─── */}
      <div className="w-52 flex-shrink-0 border-r overflow-y-auto p-2 space-y-0.5" style={{ borderColor: 'var(--glass-border)' }}>
        <button
          onClick={() => { setSelectedToolbox(null); setSelectedPreset(null) }}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-xs font-medium transition-colors hover:bg-white/[0.03]"
          style={{
            background: !selectedToolbox ? 'var(--glass-bg-hover)' : 'transparent',
            color: !selectedToolbox ? 'var(--color-text)' : 'var(--color-text-secondary)',
          }}
        >
          <FiGridIcon className="text-sm" style={{ color: 'var(--color-text-muted)' }} />
          <span>All Toolboxes</span>
          <span className="ml-auto" style={{ color: 'var(--color-text-muted)' }}>{ALL_PRESETS.length}</span>
        </button>

        {categories.map(cat => {
          const Icon = cat.icon
          const active = selectedToolbox === cat.id
          return (
            <button
              key={cat.id}
              onClick={() => { setSelectedToolbox(cat.id); setSelectedPreset(null) }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-xs font-medium transition-colors hover:bg-white/[0.03]"
              style={{
                background: active ? 'var(--glass-bg-hover)' : 'transparent',
                color: active ? 'var(--color-text)' : 'var(--color-text-secondary)',
              }}
            >
              <Icon className="text-sm" style={{ color: 'var(--color-text-muted)' }} />
              <span className="truncate">{cat.name}</span>
              <span className="ml-auto" style={{ color: 'var(--color-text-muted)' }}>{cat.presetCount}</span>
            </button>
          )
        })}
      </div>

      {/* ─── CENTER: Preset Grid / Parameter Form ─── */}
      <div className="flex-1 overflow-y-auto p-4">
        {!selectedPreset ? (
          <>
            {/* Search bar */}
            <div className="flex items-center gap-2 mb-4">
              <div className="relative flex-1 max-w-md">
                <FiSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs" style={{ color: 'var(--color-text-muted)' }} />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search presets by name, function, or keyword..."
                  className="w-full pl-8 pr-3 py-1.5 rounded-md border text-xs"
                  style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-border)', color: 'var(--color-text)' }}
                />
              </div>
              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {filteredPresets.length} preset{filteredPresets.length !== 1 ? 's' : ''}
              </span>
            </div>

            {/* Preset grid */}
            <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
              {filteredPresets.map(preset => {
                const cat = categories.find(c => c.id === preset.toolbox)
                return (
                  <button
                    key={preset.id}
                    onClick={() => selectPreset(preset)}
                    className="group text-left p-3 rounded-lg border transition-colors hover:bg-white/[0.03]"
                    style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-border)' }}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <h3 className="text-xs font-semibold truncate" style={{ color: 'var(--color-text)' }}>{preset.name}</h3>
                        <span className="text-[11px] font-mono" style={{ color: 'var(--color-text-muted)' }}>{preset.referenceFn}</span>
                      </div>
                      <FiChevronRight className="text-sm opacity-0 group-hover:opacity-60 transition-opacity mt-0.5" style={{ color: 'var(--color-text-muted)' }} />
                    </div>
                    <p className="text-[11px] mt-1.5 line-clamp-2" style={{ color: 'var(--color-text-muted)' }}>{preset.description}</p>
                    <div className="flex items-center gap-1.5 mt-2">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ background: 'var(--glass-bg-hover)', color: 'var(--color-text-secondary)' }}>
                        {cat?.name || preset.toolbox}
                      </span>
                      {preset.workflowStage && (
                        <span className="px-1.5 py-0.5 rounded text-[10px]" style={{ background: 'var(--glass-bg)', color: 'var(--color-text-muted)' }}>
                          {preset.workflowStage}
                        </span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </>
        ) : (
          <>
            {/* Back button + preset header */}
            <button
              onClick={() => setSelectedPreset(null)}
              className="flex items-center gap-1 text-xs mb-3 hover:text-white transition-colors"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              <FiChevronLeft className="text-sm" /> Back to presets
            </button>

            <div className="mb-4">
              <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{selectedPreset.name}</h2>
              <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>{selectedPreset.description}</p>
              <span className="inline-block text-[11px] font-mono mt-2 px-1.5 py-0.5 rounded" style={{ background: 'var(--glass-bg-hover)', color: 'var(--color-text-secondary)' }}>
                {selectedPreset.referenceFn}
              </span>
            </div>

            {/* Reference code toggle */}
            <button
              onClick={() => setShowCode(!showCode)}
              className="flex items-center gap-1.5 text-xs mb-3 hover:text-white transition-colors"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              <FiCode className="text-sm" />
              {showCode ? 'Hide' : 'Show'} Code Equivalent
            </button>
            {showCode && (
              <pre className="text-[11px] p-3 rounded-md border mb-4 overflow-x-auto font-mono whitespace-pre-wrap" style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-border)', color: 'var(--color-text-secondary)' }}>
                {selectedPreset.referenceCode}
              </pre>
            )}

            {/* Parameter form */}
            <div className="space-y-3 mb-4">
              {selectedPreset.params.map(p => (
                <div key={p.key}>
                  <label className="text-[11px] font-medium block mb-1" style={{ color: 'var(--color-text-muted)' }}>
                    {p.label}
                    {p.description && <span className="font-normal ml-1 opacity-70">— {p.description}</span>}
                  </label>
                  {p.type === 'textarea' ? (
                    <textarea
                      value={params[p.key] || ''}
                      onChange={e => setParams(prev => ({ ...prev, [p.key]: e.target.value }))}
                      rows={3}
                      className="w-full px-2 py-1.5 rounded-md border text-xs font-mono resize-none"
                      style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-border)', color: 'var(--color-text)' }}
                    />
                  ) : p.type === 'select' ? (
                    <select
                      value={params[p.key] || p.default || ''}
                      onChange={e => setParams(prev => ({ ...prev, [p.key]: e.target.value }))}
                      className="w-full px-2 py-1.5 rounded-md border text-xs"
                      style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-border)', color: 'var(--color-text)' }}
                    >
                      {p.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  ) : (
                    <input
                      type={p.type === 'number' ? 'number' : 'text'}
                      value={params[p.key] ?? ''}
                      onChange={e => setParams(prev => ({ ...prev, [p.key]: e.target.value }))}
                      min={p.min}
                      max={p.max}
                      step={p.step}
                      className="w-full px-2 py-1.5 rounded-md border text-xs"
                      style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-border)', color: 'var(--color-text)' }}
                    />
                  )}
                </div>
              ))}
            </div>

            {/* Run button */}
            <button
              onClick={runCompute}
              disabled={running}
              className="flex items-center gap-2 px-4 py-2 rounded-md text-xs font-medium transition-colors hover:bg-white/[0.06] disabled:opacity-50"
              style={{
                background: 'var(--glass-bg-hover)',
                color: 'var(--color-text)',
                border: '1px solid var(--color-border-strong)',
              }}
            >
              {running ? <FiLoader className="animate-spin" /> : <FiPlay />}
              {running ? 'Computing...' : 'Run Computation'}
            </button>

            {error && (
              <div className="flex items-center gap-2 mt-3 p-2 rounded-md text-xs border" style={{ background: 'rgba(239, 68, 68, 0.08)', color: 'var(--color-error)', borderColor: 'rgba(239, 68, 68, 0.25)' }}>
                <FiAlertCircle /> {error}
              </div>
            )}
          </>
        )}
      </div>

      {/* ─── RIGHT: Results Panel ─── */}
      <div className="w-[400px] flex-shrink-0 border-l overflow-y-auto p-4" style={{ borderColor: 'var(--glass-border)' }}>
        {result ? (
          <>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-xs">
                <FiCheck style={{ color: 'var(--color-text-muted)' }} />
                <span style={{ color: 'var(--color-text-muted)' }}>
                  Complete — {(runTimeRef.current / 1000).toFixed(2)}s
                </span>
              </div>
              <div className="flex gap-1">
                <button onClick={copyStats} className="p-1 rounded hover:bg-white/[0.06] transition-colors" title="Copy"><FiCopy className="text-xs" style={{ color: 'var(--color-text-muted)' }} /></button>
                <button onClick={exportJSON} className="p-1 rounded hover:bg-white/[0.06] transition-colors" title="JSON"><FiDownload className="text-xs" style={{ color: 'var(--color-text-muted)' }} /></button>
                <button onClick={exportCSV} className="p-1 rounded hover:bg-white/[0.06] transition-colors" title="CSV"><FiDownload className="text-xs" style={{ color: 'var(--color-text-muted)' }} /></button>
              </div>
            </div>

            {result.warnings?.map((w, i) => (
              <div key={i} className="flex items-center gap-1.5 mb-2 px-2 py-1 rounded text-[11px] border" style={{ background: 'rgba(234, 179, 8, 0.08)', color: 'var(--color-warning)', borderColor: 'rgba(234, 179, 8, 0.25)' }}>
                <FiAlertCircle className="flex-shrink-0" /> {w}
              </div>
            ))}

            {/* Chart */}
            {result.chartData?.length ? (
              <div className="mb-4 rounded-lg border p-2" style={{ borderColor: 'var(--glass-border)', background: 'var(--glass-bg)' }}>
                {result.chartTitle && (
                  <div className="text-[11px] font-medium text-center mb-1" style={{ color: 'var(--color-text-muted)' }}>{result.chartTitle}</div>
                )}
                {renderChart(result)}
              </div>
            ) : null}

            {/* Statistics table */}
            {result.statistics?.length ? (
              <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--glass-border)', background: 'var(--glass-bg)' }}>
                <table className="w-full text-xs">
                  <tbody>
                    {result.statistics.map((s, i) => (
                      <tr key={i} className="border-b last:border-b-0" style={{ borderColor: 'var(--glass-border)' }}>
                        <td className="px-3 py-1.5 font-medium" style={{ color: 'var(--color-text-muted)' }}>{s.label}</td>
                        <td className="px-3 py-1.5 text-right font-mono" style={{ color: 'var(--color-text)' }}>{s.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full" style={{ color: 'var(--color-text-muted)' }}>
            <FiGridIcon className="text-2xl mb-3 opacity-40" />
            <p className="text-xs">Select a preset and run it</p>
            <p className="text-[11px] mt-1 opacity-70">Results appear here</p>
          </div>
        )}
      </div>
    </div>
  )
}
