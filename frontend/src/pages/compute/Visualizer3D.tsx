/**
 * Visualizer3D — Interactive 3D surface/scatter/wireframe plotting for Compute Lab
 * Uses Plotly.js for rendering. Supports z=f(x,y) expressions, presets, multiple chart types.
 */
import { useState, useMemo, useCallback } from 'react'
import { FiPlay, FiBookOpen, FiX, FiCopy, FiCheck, FiRotateCw } from 'react-icons/fi'
import createPlotlyComponent from 'react-plotly.js/factory'
import Plotly from 'plotly.js-dist-min'

const Plot = createPlotlyComponent(Plotly)

/* ── Chart type options ── */
type ChartMode = 'surface' | 'wireframe' | 'contour' | 'scatter3d' | 'heatmap'

const CHART_MODES: { id: ChartMode; label: string }[] = [
  { id: 'surface', label: 'Surface' },
  { id: 'wireframe', label: 'Wireframe' },
  { id: 'contour', label: 'Contour' },
  { id: 'scatter3d', label: 'Scatter 3D' },
  { id: 'heatmap', label: 'Heatmap' },
]

/* ── Colorscale options ── */
const COLORSCALES = [
  'Viridis', 'Plasma', 'Inferno', 'Magma', 'Cividis',
  'YlGnBu', 'Hot', 'Electric', 'Blackbody', 'Greys',
]

/* ── Safe expression evaluator for z=f(x,y) ── */
function evalExpr(expr: string, x: number, y: number): number {
  const env: Record<string, number | ((...a: number[]) => number)> = {
    x, y, pi: Math.PI, e: Math.E, PI: Math.PI, E: Math.E,
    sin: Math.sin, cos: Math.cos, tan: Math.tan,
    asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
    sqrt: Math.sqrt, abs: Math.abs, exp: Math.exp, log: Math.log, log10: Math.log10, log2: Math.log2,
    pow: Math.pow, min: Math.min, max: Math.max,
    floor: Math.floor, ceil: Math.ceil, round: Math.round, sign: Math.sign,
    hypot: Math.hypot,
  }
  const keys = Object.keys(env)
  const vals = Object.values(env)
  try {
    const fn = new Function(...keys, `"use strict"; return (${expr});`)
    const result = fn(...vals)
    return typeof result === 'number' && isFinite(result) ? result : NaN
  } catch { return NaN }
}

/* ── Preset definitions ── */
interface Preset3D {
  id: string
  name: string
  category: string
  expr: string
  xRange: [number, number]
  yRange: [number, number]
  resolution: number
  description: string
}

const PRESET_CATEGORIES = [
  { name: 'Mathematical', color: '#6366f1' },
  { name: 'Biomedical', color: '#22c55e' },
  { name: 'Physics', color: '#f59e0b' },
  { name: 'Engineering', color: '#3b82f6' },
]

const PRESETS_3D: Preset3D[] = [
  // Mathematical
  { id: '3d-gaussian', name: 'Gaussian Surface', category: 'Mathematical', expr: 'exp(-(x*x + y*y)/2)', xRange: [-3, 3], yRange: [-3, 3], resolution: 50, description: '2D Gaussian bell curve: exp(-(x²+y²)/2)' },
  { id: '3d-sinc', name: 'Sinc Function', category: 'Mathematical', expr: 'sin(sqrt(x*x+y*y)+0.001)/(sqrt(x*x+y*y)+0.001)', xRange: [-10, 10], yRange: [-10, 10], resolution: 60, description: 'sinc(r) = sin(r)/r — circular ripple' },
  { id: '3d-saddle', name: 'Saddle Point', category: 'Mathematical', expr: 'x*x - y*y', xRange: [-2, 2], yRange: [-2, 2], resolution: 40, description: 'Hyperbolic paraboloid: x² - y²' },
  { id: '3d-rosenbrock', name: 'Rosenbrock Banana', category: 'Mathematical', expr: 'log(1 + (1-x)*(1-x) + 100*(y - x*x)*(y - x*x))', xRange: [-2, 2], yRange: [-1, 3], resolution: 60, description: 'Log of Rosenbrock function — classic optimization test' },
  { id: '3d-ripple', name: 'Ripple', category: 'Mathematical', expr: 'sin(5*sqrt(x*x+y*y))*exp(-0.5*sqrt(x*x+y*y))', xRange: [-4, 4], yRange: [-4, 4], resolution: 60, description: 'Damped circular ripple pattern' },
  { id: '3d-egg-carton', name: 'Egg Carton', category: 'Mathematical', expr: 'sin(x)*sin(y)', xRange: [-6, 6], yRange: [-6, 6], resolution: 50, description: 'sin(x)·sin(y) — periodic 2D wave' },
  { id: '3d-monkey-saddle', name: 'Monkey Saddle', category: 'Mathematical', expr: 'x*x*x - 3*x*y*y', xRange: [-1.5, 1.5], yRange: [-1.5, 1.5], resolution: 50, description: 'x³ - 3xy² — three-valley surface' },

  // Biomedical
  { id: '3d-dose-dist', name: 'Radiation Dose Distribution', category: 'Biomedical', expr: '100*exp(-((x-0.5)*(x-0.5)+(y-0.3)*(y-0.3))/0.8) + 40*exp(-((x+0.5)*(x+0.5)+(y+0.5)*(y+0.5))/1.2)', xRange: [-3, 3], yRange: [-3, 3], resolution: 50, description: 'Dual-beam radiation dose profile' },
  { id: '3d-membrane', name: 'Cell Membrane Potential', category: 'Biomedical', expr: '0.5*tanh(3*x)*cos(2*y) + 0.3*sin(4*x)*exp(-y*y)', xRange: [-3, 3], yRange: [-3, 3], resolution: 50, description: 'Spatially varying membrane potential model' },
  { id: '3d-drug-conc', name: 'Drug Concentration Field', category: 'Biomedical', expr: 'exp(-0.3*sqrt(x*x+y*y))*cos(0.5*x)*cos(0.5*y)', xRange: [-6, 6], yRange: [-6, 6], resolution: 50, description: 'Radially decaying drug diffusion concentration' },
  { id: '3d-eeg-topo', name: 'EEG Topographic Map', category: 'Biomedical', expr: '2*exp(-((x-1)*(x-1)+y*y)/1.5) - 1.5*exp(-((x+1)*(x+1)+(y-0.5)*(y-0.5))/0.8) + 0.5*sin(2*x)*cos(3*y)', xRange: [-3, 3], yRange: [-3, 3], resolution: 50, description: 'Simulated EEG scalp potential distribution' },
  { id: '3d-tumor-growth', name: 'Tumor Growth Model', category: 'Biomedical', expr: 'exp(-((x*x+y*y)/4)) * (1 + 0.3*sin(5*atan2(y,x))) * (1 - 0.2*cos(3*sqrt(x*x+y*y)))', xRange: [-3, 3], yRange: [-3, 3], resolution: 60, description: 'Anisotropic tumor growth with angular variation' },
  { id: '3d-oxygen-sat', name: 'Tissue Oxygen Saturation', category: 'Biomedical', expr: '95 - 20*exp(-((x-1)*(x-1)+(y-1)*(y-1))/2) - 15*exp(-((x+1)*(x+1)+(y+1)*(y+1))/3)', xRange: [-4, 4], yRange: [-4, 4], resolution: 50, description: 'SpO₂ spatial distribution with hypoxic regions' },

  // Physics
  { id: '3d-wave-interference', name: 'Wave Interference', category: 'Physics', expr: 'sin(sqrt((x-2)*(x-2)+y*y)*3) + sin(sqrt((x+2)*(x+2)+y*y)*3)', xRange: [-6, 6], yRange: [-6, 6], resolution: 60, description: 'Two-source circular wave interference pattern' },
  { id: '3d-potential-well', name: 'Double Potential Well', category: 'Physics', expr: '(x*x-1)*(x*x-1) + y*y', xRange: [-2, 2], yRange: [-2, 2], resolution: 50, description: 'Symmetric double-well potential energy surface' },
  { id: '3d-magnetic-field', name: 'Magnetic Dipole Field', category: 'Physics', expr: '(2*x*x - y*y) / pow(x*x + y*y + 0.1, 2.5)', xRange: [-2, 2], yRange: [-2, 2], resolution: 60, description: 'z-component of magnetic dipole field' },
  { id: '3d-heat-diffusion', name: 'Heat Diffusion', category: 'Physics', expr: 'exp(-0.1*(x*x+y*y))*cos(x)*cos(y) + 0.5*exp(-0.5*((x-2)*(x-2)+(y-1)*(y-1)))', xRange: [-4, 4], yRange: [-4, 4], resolution: 50, description: 'Transient heat diffusion with two sources' },

  // Engineering
  { id: '3d-stress-plate', name: 'Stress in Plate', category: 'Engineering', expr: 'sin(pi*x/4)*sin(pi*y/4)*(4-abs(x))*(4-abs(y))/16', xRange: [-4, 4], yRange: [-4, 4], resolution: 50, description: 'Von Mises stress in a clamped rectangular plate' },
  { id: '3d-flow-velocity', name: 'Flow Velocity Profile', category: 'Engineering', expr: '(1 - x*x/4)*(1 - y*y/4)*max(0, 1 - x*x/4)*max(0, 1 - y*y/4)', xRange: [-2.5, 2.5], yRange: [-2.5, 2.5], resolution: 50, description: 'Laminar flow velocity in a rectangular duct' },
  { id: '3d-antenna', name: 'Antenna Radiation Pattern', category: 'Engineering', expr: 'abs(sin(3*x)*cos(2*y)) * exp(-0.1*(x*x+y*y))', xRange: [-4, 4], yRange: [-4, 4], resolution: 50, description: 'Simplified far-field antenna radiation pattern' },
]

/* ── Component ── */
export default function Visualizer3D() {
  const [expr, setExpr] = useState('exp(-(x*x + y*y)/2)')
  const [xMin, setXMin] = useState(-3)
  const [xMax, setXMax] = useState(3)
  const [yMin, setYMin] = useState(-3)
  const [yMax, setYMax] = useState(3)
  const [resolution, setResolution] = useState(50)
  const [chartMode, setChartMode] = useState<ChartMode>('surface')
  const [colorscale, setColorscale] = useState('Viridis')
  const [showLibrary, setShowLibrary] = useState(false)
  const [copied, setCopied] = useState(false)
  const [plotKey, setPlotKey] = useState(0)
  const [activePreset, setActivePreset] = useState<string | null>('3d-gaussian')

  /* Generate z = f(x,y) grid data */
  const plotData = useMemo(() => {
    const nx = resolution
    const ny = resolution
    const xs: number[] = []
    const ys: number[] = []
    const zGrid: number[][] = []

    for (let j = 0; j < ny; j++) {
      const yVal = yMin + (yMax - yMin) * j / (ny - 1)
      ys.push(yVal)
      const row: number[] = []
      for (let i = 0; i < nx; i++) {
        const xVal = xMin + (xMax - xMin) * i / (nx - 1)
        if (j === 0) xs.push(xVal)
        row.push(evalExpr(expr, xVal, yVal))
      }
      zGrid.push(row)
    }
    return { xs, ys, zGrid }
  }, [expr, xMin, xMax, yMin, yMax, resolution, plotKey])

  /* Build Plotly traces based on chart mode */
  const traces = useMemo(() => {
    const { xs, ys, zGrid } = plotData
    switch (chartMode) {
      case 'surface':
        return [{ type: 'surface' as const, x: xs, y: ys, z: zGrid, colorscale, opacity: 0.92 }]
      case 'wireframe':
        return [{
          type: 'surface' as const, x: xs, y: ys, z: zGrid, colorscale, opacity: 0.4,
          hidesurface: true,
          contours: {
            x: { show: true, color: '#888', width: 1 },
            y: { show: true, color: '#888', width: 1 },
            z: { show: false },
          },
        } as any]
      case 'contour':
        return [{
          type: 'surface' as const, x: xs, y: ys, z: zGrid, colorscale,
          contours: {
            z: { show: true, usecolormap: true, highlightcolor: '#fff', project: { z: true } },
          },
        } as any]
      case 'scatter3d': {
        const px: number[] = [], py: number[] = [], pz: number[] = []
        for (let j = 0; j < ys.length; j += 2) {
          for (let i = 0; i < xs.length; i += 2) {
            px.push(xs[i]); py.push(ys[j]); pz.push(zGrid[j][i])
          }
        }
        return [{
          type: 'scatter3d' as const, mode: 'markers' as const,
          x: px, y: py, z: pz,
          marker: { size: 2.5, color: pz, colorscale, opacity: 0.8 },
        }]
      }
      case 'heatmap':
        return [{
          type: 'heatmap' as const, x: xs, y: ys, z: zGrid, colorscale,
        }]
      default:
        return [{ type: 'surface' as const, x: xs, y: ys, z: zGrid, colorscale }]
    }
  }, [plotData, chartMode, colorscale])

  /* Plotly layout */
  const layout = useMemo(() => {
    const is3D = chartMode !== 'heatmap'
    const base: any = {
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
      font: { color: '#a1a1aa', size: 11 },
      margin: { l: 10, r: 10, t: 10, b: 10 },
      showlegend: false,
      autosize: true,
    }
    if (is3D) {
      base.scene = {
        xaxis: { title: 'x', color: '#a1a1aa', gridcolor: 'rgba(255,255,255,0.06)', zerolinecolor: 'rgba(255,255,255,0.1)', backgroundcolor: 'rgba(0,0,0,0)' },
        yaxis: { title: 'y', color: '#a1a1aa', gridcolor: 'rgba(255,255,255,0.06)', zerolinecolor: 'rgba(255,255,255,0.1)', backgroundcolor: 'rgba(0,0,0,0)' },
        zaxis: { title: 'z', color: '#a1a1aa', gridcolor: 'rgba(255,255,255,0.06)', zerolinecolor: 'rgba(255,255,255,0.1)', backgroundcolor: 'rgba(0,0,0,0)' },
        bgcolor: 'rgba(0,0,0,0)',
        camera: { eye: { x: 1.5, y: 1.5, z: 1.2 } },
      }
    } else {
      base.xaxis = { title: 'x', color: '#a1a1aa', gridcolor: 'rgba(255,255,255,0.06)' }
      base.yaxis = { title: 'y', color: '#a1a1aa', gridcolor: 'rgba(255,255,255,0.06)' }
    }
    return base
  }, [chartMode])

  /* Apply preset */
  const applyPreset = useCallback((p: Preset3D) => {
    setExpr(p.expr)
    setXMin(p.xRange[0]); setXMax(p.xRange[1])
    setYMin(p.yRange[0]); setYMax(p.yRange[1])
    setResolution(p.resolution)
    setActivePreset(p.id)
    setShowLibrary(false)
    setPlotKey(k => k + 1)
  }, [])

  /* Copy expression */
  const copyExpr = useCallback(() => {
    navigator.clipboard.writeText(`z = ${expr}`).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1500)
    })
  }, [expr])

  /* ── Styles ── */
  const panelBg = 'var(--color-bg-elevated)'
  const border = 'var(--glass-border)'
  const textMuted = 'var(--color-text-muted)'
  const text = 'var(--color-text)'

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', background: 'var(--color-bg)' }}>
      {/* ── Left Controls ── */}
      <div style={{ width: 280, flexShrink: 0, borderRight: `1px solid ${border}`, background: panelBg, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
        {/* Expression input */}
        <div style={{ padding: '12px 14px', borderBottom: `1px solid ${border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: text, letterSpacing: 0.5 }}>z = f(x, y)</span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={copyExpr} style={{ background: 'none', border: 'none', color: textMuted, cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center' }} title="Copy">
                {copied ? <FiCheck size={13} /> : <FiCopy size={13} />}
              </button>
              <button onClick={() => setShowLibrary(true)} style={{ background: 'none', border: 'none', color: textMuted, cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center' }} title="Library">
                <FiBookOpen size={13} />
              </button>
            </div>
          </div>
          <textarea
            value={expr}
            onChange={e => { setExpr(e.target.value); setActivePreset(null) }}
            rows={3}
            spellCheck={false}
            style={{
              width: '100%', background: 'rgba(255,255,255,0.03)', border: `1px solid ${border}`,
              borderRadius: 4, padding: '6px 8px', fontSize: 12, fontFamily: 'monospace',
              color: text, resize: 'none', outline: 'none', boxSizing: 'border-box',
            }}
          />
          <button
            onClick={() => setPlotKey(k => k + 1)}
            style={{
              width: '100%', marginTop: 6, padding: '5px 0', background: 'rgba(99,102,241,0.15)',
              border: `1px solid rgba(99,102,241,0.3)`, borderRadius: 4, color: '#818cf8',
              fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center',
              justifyContent: 'center', gap: 5,
            }}
          >
            <FiPlay size={12} /> Plot
          </button>
        </div>

        {/* Range controls */}
        <div style={{ padding: '10px 14px', borderBottom: `1px solid ${border}` }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: textMuted, textTransform: 'uppercase', letterSpacing: 0.8 }}>Domain</span>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 6 }}>
            {[
              { label: 'x min', value: xMin, set: setXMin },
              { label: 'x max', value: xMax, set: setXMax },
              { label: 'y min', value: yMin, set: setYMin },
              { label: 'y max', value: yMax, set: setYMax },
            ].map(({ label, value, set }) => (
              <div key={label}>
                <label style={{ fontSize: 10, color: textMuted }}>{label}</label>
                <input
                  type="number"
                  value={value}
                  onChange={e => set(Number(e.target.value))}
                  style={{
                    width: '100%', background: 'rgba(255,255,255,0.03)', border: `1px solid ${border}`,
                    borderRadius: 3, padding: '3px 6px', fontSize: 11, color: text, outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            ))}
          </div>
          <div style={{ marginTop: 8 }}>
            <label style={{ fontSize: 10, color: textMuted }}>Resolution: {resolution}</label>
            <input
              type="range" min={10} max={100} value={resolution}
              onChange={e => setResolution(Number(e.target.value))}
              style={{ width: '100%', accentColor: '#6366f1' }}
            />
          </div>
        </div>

        {/* Chart mode */}
        <div style={{ padding: '10px 14px', borderBottom: `1px solid ${border}` }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: textMuted, textTransform: 'uppercase', letterSpacing: 0.8 }}>Render Mode</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
            {CHART_MODES.map(m => (
              <button
                key={m.id}
                onClick={() => setChartMode(m.id)}
                style={{
                  padding: '3px 8px', fontSize: 10, borderRadius: 3, cursor: 'pointer',
                  border: chartMode === m.id ? '1px solid rgba(99,102,241,0.5)' : `1px solid ${border}`,
                  background: chartMode === m.id ? 'rgba(99,102,241,0.15)' : 'transparent',
                  color: chartMode === m.id ? '#818cf8' : textMuted,
                  fontWeight: chartMode === m.id ? 600 : 400,
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Colorscale */}
        <div style={{ padding: '10px 14px', borderBottom: `1px solid ${border}` }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: textMuted, textTransform: 'uppercase', letterSpacing: 0.8 }}>Colorscale</span>
          <select
            value={colorscale}
            onChange={e => setColorscale(e.target.value)}
            style={{
              width: '100%', marginTop: 6, background: 'rgba(255,255,255,0.03)',
              border: `1px solid ${border}`, borderRadius: 3, padding: '4px 6px',
              fontSize: 11, color: text, outline: 'none',
            }}
          >
            {COLORSCALES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {/* Quick presets */}
        <div style={{ padding: '10px 14px', flex: 1, overflow: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: textMuted, textTransform: 'uppercase', letterSpacing: 0.8 }}>Quick Presets</span>
            <button onClick={() => setShowLibrary(true)} style={{ fontSize: 10, color: '#818cf8', background: 'none', border: 'none', cursor: 'pointer' }}>
              View All
            </button>
          </div>
          {PRESETS_3D.slice(0, 8).map(p => (
            <button
              key={p.id}
              onClick={() => applyPreset(p)}
              style={{
                width: '100%', textAlign: 'left', padding: '5px 8px', marginBottom: 3,
                background: activePreset === p.id ? 'rgba(99,102,241,0.12)' : 'transparent',
                border: activePreset === p.id ? '1px solid rgba(99,102,241,0.3)' : '1px solid transparent',
                borderRadius: 4, cursor: 'pointer', color: text, fontSize: 11,
                display: 'block',
              }}
            >
              <div style={{ fontWeight: 500 }}>{p.name}</div>
              <div style={{ fontSize: 10, color: textMuted, fontFamily: 'monospace', marginTop: 1 }}>{p.expr.length > 35 ? p.expr.slice(0, 35) + '…' : p.expr}</div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Plot Area ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Info bar */}
        <div style={{ padding: '6px 14px', borderBottom: `1px solid ${border}`, display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0, background: panelBg }}>
          <span style={{ fontSize: 11, color: textMuted }}>
            z = <span style={{ color: text, fontFamily: 'monospace' }}>{expr.length > 60 ? expr.slice(0, 60) + '…' : expr}</span>
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 10, color: textMuted }}>
            {resolution}×{resolution} • {chartMode}
          </span>
          <button
            onClick={() => setPlotKey(k => k + 1)}
            style={{ background: 'none', border: 'none', color: textMuted, cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center' }}
            title="Re-render"
          >
            <FiRotateCw size={12} />
          </button>
        </div>

        {/* Plotly chart */}
        <div style={{ flex: 1, position: 'relative' }}>
          <Plot
            data={traces as any}
            layout={layout}
            config={{
              responsive: true,
              displayModeBar: 'hover',
              displaylogo: false,
              toImageButtonOptions: { format: 'svg', filename: '3d-plot', width: 1400, height: 900 },
            }}
            style={{ width: '100%', height: '100%' }}
            useResizeHandler
          />
        </div>
      </div>

      {/* ── Library Overlay ── */}
      {showLibrary && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
        }} onClick={() => setShowLibrary(false)}>
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: 620, maxHeight: '80vh', background: 'var(--color-bg-elevated)', border: `1px solid ${border}`,
              borderRadius: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column',
            }}
          >
            {/* Header */}
            <div style={{ padding: '12px 16px', borderBottom: `1px solid ${border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: text }}>3D Surface Library</span>
              <button onClick={() => setShowLibrary(false)} style={{ background: 'none', border: 'none', color: textMuted, cursor: 'pointer' }}>
                <FiX size={16} />
              </button>
            </div>
            {/* Categories */}
            <div style={{ padding: '12px 16px', overflow: 'auto', flex: 1 }}>
              {PRESET_CATEGORIES.map(cat => {
                const items = PRESETS_3D.filter(p => p.category === cat.name)
                if (items.length === 0) return null
                return (
                  <div key={cat.name} style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: cat.color }} />
                      <span style={{ fontSize: 12, fontWeight: 600, color: text }}>{cat.name}</span>
                      <span style={{ fontSize: 10, color: textMuted }}>({items.length})</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                      {items.map(p => (
                        <button
                          key={p.id}
                          onClick={() => applyPreset(p)}
                          style={{
                            textAlign: 'left', padding: '8px 10px', background: activePreset === p.id ? 'rgba(99,102,241,0.12)' : 'rgba(255,255,255,0.02)',
                            border: activePreset === p.id ? '1px solid rgba(99,102,241,0.3)' : `1px solid ${border}`,
                            borderRadius: 5, cursor: 'pointer', color: text,
                          }}
                        >
                          <div style={{ fontSize: 11, fontWeight: 500 }}>{p.name}</div>
                          <div style={{ fontSize: 10, color: textMuted, fontFamily: 'monospace', marginTop: 2 }}>
                            {p.expr.length > 40 ? p.expr.slice(0, 40) + '…' : p.expr}
                          </div>
                          <div style={{ fontSize: 10, color: textMuted, marginTop: 2 }}>{p.description}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
