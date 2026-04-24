// PublicationFigure — universal publication-grade chart wrapper.
//
// Wraps any chart child (Recharts, Plotly, Three.js, raw <svg>, etc.)
// with the same publication chrome that DataVisualization exposes:
//   title / subtitle / caption / source rendered on canvas
//   theme (screen/paper/nature/science/ieee)
//   font scale (small/normal/large/huge)
//   aspect ratio (16:9, 4:3, golden, two-col, …)
//   color-blind preview filter (protan/deutan/tritan/achromatopsia)
//   watermark overlay
//   per-figure PDF + high-DPI PNG + SVG + 1× PNG export
//
// Caller stays in control of the actual chart rendering — this only
// supplies the surrounding container, controls, and export pipeline.
//
// Usage:
//   <PublicationFigure title="…" caption="…" source="…">
//     <ResponsiveContainer><LineChart …>…</LineChart></ResponsiveContainer>
//   </PublicationFigure>
import { useState, useRef, useCallback } from 'react'
import { FiDownload, FiSettings, FiMaximize2, FiMinimize2 } from 'react-icons/fi'
import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import { getPlotBlob } from '../utils/plotExport'
import {
  THEMES, FONT_SCALE_MULT, ASPECT_RATIO, CB_SIM_FILTER,
  PALETTES, CB_SAFE_PALETTES, normalizeHex,
  type PublicationTheme, type FontScale, type AspectPreset, type CBlindSim,
  type TickFormat,
} from '../utils/publicationTheme'

export interface PublicationFigureProps {
  title?: string
  subtitle?: string
  caption?: string
  source?: string
  children: React.ReactNode
  // Initial publication state (caller-controlled). Kept as state
  // inside the wrapper so authors can tweak the figure inline
  // without piping every option through a parent component.
  initialTheme?: PublicationTheme
  initialFontScale?: FontScale
  initialAspect?: AspectPreset
  initialPalette?: string
  initialTickFormatX?: TickFormat
  initialTickFormatY?: TickFormat
  // Filename stem for exports (no extension).
  exportName?: string
  // When true, renders a compact toolbar instead of the full settings
  // accordion — useful when embedding inside other panels.
  compact?: boolean
  // External hook: parent can sync palette / theme back into its own
  // chart props by listening to this callback.
  onOptionsChange?: (opts: {
    theme: PublicationTheme; fontScale: FontScale; aspect: AspectPreset
    palette: string; customColors?: string[]
    tickFormatX: TickFormat; tickFormatY: TickFormat
    cbSim: CBlindSim; watermark: string
  }) => void
}

export default function PublicationFigure({
  title,
  subtitle,
  caption,
  source,
  children,
  initialTheme = 'screen',
  initialFontScale = 'normal',
  initialAspect = 'free',
  initialPalette = 'default',
  initialTickFormatX = 'auto',
  initialTickFormatY = 'auto',
  exportName,
  compact = false,
  onOptionsChange,
}: PublicationFigureProps) {
  const [theme, setTheme] = useState<PublicationTheme>(initialTheme)
  const [fontScale, setFontScale] = useState<FontScale>(initialFontScale)
  const [aspect, setAspect] = useState<AspectPreset>(initialAspect)
  const [palette, setPalette] = useState<string>(initialPalette)
  const [customColors, setCustomColors] = useState<string[] | undefined>(undefined)
  const [tickFormatX, setTickFormatX] = useState<TickFormat>(initialTickFormatX)
  const [tickFormatY, setTickFormatY] = useState<TickFormat>(initialTickFormatY)
  const [cbSim, setCbSim] = useState<CBlindSim>('none')
  const [watermark, setWatermark] = useState<string>('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const figRef = useRef<HTMLDivElement>(null)

  const themeStyle = THEMES[theme]
  const fs = FONT_SCALE_MULT[fontScale]
  const aspectRatio = ASPECT_RATIO[aspect]
  const exportStem = (exportName || title || 'figure').replace(/[^\w-]+/g, '-').toLowerCase()

  // Notify parent whenever any option changes (single useEffect-like
  // call inline so React batches the dependent re-renders).
  const notify = useCallback(() => {
    if (!onOptionsChange) return
    onOptionsChange({
      theme, fontScale, aspect, palette, customColors,
      tickFormatX, tickFormatY, cbSim, watermark,
    })
  }, [onOptionsChange, theme, fontScale, aspect, palette, customColors, tickFormatX, tickFormatY, cbSim, watermark])

  // ── Exports ──
  const exportPng = useCallback(async (scale: number) => {
    const el = figRef.current?.querySelector('[data-pub-figure-canvas]') as HTMLElement | null
    if (!el) return
    const isPlotly = !!el.querySelector('.js-plotly-plot')
    try {
      if (isPlotly) {
        const blob = await getPlotBlob(el, 'png')
        if (blob) {
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.download = `${exportStem}${scale > 1 ? `-${scale}x` : ''}.png`
          a.href = url; a.click(); URL.revokeObjectURL(url)
          return
        }
      }
      const canvas = await html2canvas(el, { backgroundColor: themeStyle.bg === 'transparent' ? null : themeStyle.bg, scale, useCORS: true, logging: false })
      const a = document.createElement('a')
      a.download = `${exportStem}${scale > 1 ? `-${scale}x` : ''}.png`
      a.href = canvas.toDataURL('image/png'); a.click()
    } catch { /* ignore */ }
  }, [exportStem, themeStyle.bg])

  const exportSvg = useCallback(() => {
    const el = figRef.current?.querySelector('[data-pub-figure-canvas]') as HTMLElement | null
    if (!el) return
    const svg = el.querySelector('svg')
    if (!svg) return
    const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' })
    const a = document.createElement('a')
    a.download = `${exportStem}.svg`
    a.href = URL.createObjectURL(blob); a.click(); URL.revokeObjectURL(a.href)
  }, [exportStem])

  const exportPdf = useCallback(async () => {
    const el = figRef.current?.querySelector('[data-pub-figure-canvas]') as HTMLElement | null
    if (!el) return
    try {
      const isPlotly = !!el.querySelector('.js-plotly-plot')
      let dataUrl: string
      if (isPlotly) {
        const blob = await getPlotBlob(el, 'png')
        if (!blob) throw new Error('plotly export failed')
        dataUrl = await new Promise<string>(res => {
          const r = new FileReader()
          r.onload = () => res(r.result as string)
          r.readAsDataURL(blob)
        })
      } else {
        const canvas = await html2canvas(el, { backgroundColor: '#FFFFFF', scale: 4, useCORS: true, logging: false })
        dataUrl = canvas.toDataURL('image/png')
      }
      const pdf = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' })
      const pageW = pdf.internal.pageSize.getWidth()
      const pageH = pdf.internal.pageSize.getHeight()
      const margin = 36
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(16)
      pdf.setTextColor(20)
      pdf.text(title || 'Untitled Figure', margin, margin + 6)
      let y = margin + 22
      if (subtitle) {
        pdf.setFont('helvetica', 'normal')
        pdf.setFontSize(11)
        pdf.setTextColor(80)
        pdf.text(subtitle, margin, y)
        y += 14
      }
      const maxW = pageW - margin * 2
      const maxH = pageH - y - margin - 60
      const img = new Image()
      img.src = dataUrl
      await new Promise<void>(res => { img.onload = () => res() })
      const aspectRatioImg = img.width / img.height
      let drawW = maxW
      let drawH = maxW / aspectRatioImg
      if (drawH > maxH) { drawH = maxH; drawW = maxH * aspectRatioImg }
      const drawX = margin + (maxW - drawW) / 2
      pdf.addImage(dataUrl, 'PNG', drawX, y, drawW, drawH)
      y += drawH + 18
      if (caption) {
        pdf.setFont('helvetica', 'normal')
        pdf.setFontSize(10)
        pdf.setTextColor(40)
        const lines = pdf.splitTextToSize(caption, maxW)
        pdf.text(lines, margin, y)
        y += lines.length * 12 + 4
      }
      if (source) {
        pdf.setFont('helvetica', 'italic')
        pdf.setFontSize(9)
        pdf.setTextColor(100)
        pdf.text(`Source: ${source}`, margin, y)
      }
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(8)
      pdf.setTextColor(140)
      const stamp = `Generated by Humanovo Compute Lab · ${new Date().toLocaleString()}`
      pdf.text(stamp, margin, pageH - 18)
      pdf.save(`${exportStem}.pdf`)
    } catch { /* ignore */ }
  }, [exportStem, title, subtitle, caption, source])

  // The exposed render context — passed to children so they can apply
  // the publication theme to their own axes/ticks/colors. Retrieved
  // via React's `cloneElement` pattern when caller wraps a known
  // component, OR ignored if caller renders plain SVG.
  const ctx = {
    theme, themeStyle, fs, palette, customColors,
    tickFormatX, tickFormatY, cbSim, watermark,
    onChange: notify,
  }

  return (
    <div
      ref={figRef}
      className={expanded ? 'fixed inset-4 z-50 overflow-auto' : ''}
      style={{
        background: themeStyle.bg,
        color: themeStyle.textColor,
        fontFamily: themeStyle.bodyFont,
        padding: themeStyle.bg === 'transparent' ? 0 : 16,
        borderRadius: themeStyle.bg === 'transparent' ? 0 : 6,
        position: expanded ? 'fixed' : 'relative',
        boxShadow: expanded ? '0 25px 50px -12px rgba(0,0,0,0.5)' : undefined,
        border: expanded ? '1px solid var(--color-border)' : undefined,
      }}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex-1" />
        <div className="flex items-center gap-1">
          <button
            onClick={() => exportPng(1)}
            className="p-1.5 rounded hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            title="Download PNG (1×)"
            aria-label="Download PNG"
          >
            <FiDownload className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => exportPng(4)}
            className="px-1.5 rounded hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] text-xxs font-mono"
            title="Download PNG @ 4× (publication / ~300 DPI)"
          >4×</button>
          <button
            onClick={exportSvg}
            className="px-1.5 rounded hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] text-xxs font-mono"
            title="Download SVG (vector)"
          >SVG</button>
          <button
            onClick={exportPdf}
            className="px-1.5 rounded hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] text-xxs font-mono"
            title="Download PDF (publication layout)"
          >PDF</button>
          <button
            onClick={() => setSettingsOpen(o => !o)}
            className={`p-1.5 rounded hover:bg-[var(--glass-bg)] ${settingsOpen ? 'text-[var(--color-text)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}
            title="Publication settings"
            aria-label="Publication settings"
            aria-pressed={settingsOpen}
          >
            <FiSettings className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setExpanded(e => !e)}
            className="p-1.5 rounded hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            title={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? <FiMinimize2 className="w-3.5 h-3.5" /> : <FiMaximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Settings drawer */}
      {settingsOpen && !compact && (
        <div className="mb-3 p-3 rounded border border-[var(--glass-border)]" style={{ background: themeStyle.bg === 'transparent' ? 'var(--glass-bg)' : '#F8F8F8' }}>
          <div className="grid grid-cols-4 gap-2 text-xxs">
            <label className="flex flex-col gap-0.5">
              <span style={{ color: themeStyle.mutedColor }}>Theme</span>
              <select className="input text-xxs" value={theme} onChange={e => { setTheme(e.target.value as PublicationTheme); notify() }}>
                <option value="screen">Screen (dark)</option>
                <option value="paper">Paper (white)</option>
                <option value="nature">Nature</option>
                <option value="science">Science</option>
                <option value="ieee">IEEE (serif)</option>
              </select>
            </label>
            <label className="flex flex-col gap-0.5">
              <span style={{ color: themeStyle.mutedColor }}>Aspect</span>
              <select className="input text-xxs" value={aspect} onChange={e => { setAspect(e.target.value as AspectPreset); notify() }}>
                <option value="free">Free</option>
                <option value="16:9">16:9 (slide)</option>
                <option value="4:3">4:3</option>
                <option value="3:2">3:2 (photo)</option>
                <option value="1:1">1:1 (square)</option>
                <option value="golden">Golden φ</option>
                <option value="two-col">2:1 (2-col)</option>
              </select>
            </label>
            <label className="flex flex-col gap-0.5">
              <span style={{ color: themeStyle.mutedColor }}>Font scale</span>
              <select className="input text-xxs" value={fontScale} onChange={e => { setFontScale(e.target.value as FontScale); notify() }}>
                <option value="small">Small</option>
                <option value="normal">Normal</option>
                <option value="large">Large</option>
                <option value="huge">Huge</option>
              </select>
            </label>
            <label className="flex flex-col gap-0.5">
              <span style={{ color: themeStyle.mutedColor }}>CB preview</span>
              <select className="input text-xxs" value={cbSim} onChange={e => { setCbSim(e.target.value as CBlindSim); notify() }}>
                <option value="none">No simulation</option>
                <option value="protanopia">Protanopia</option>
                <option value="deuteranopia">Deuteranopia</option>
                <option value="tritanopia">Tritanopia</option>
                <option value="achromatopsia">Achromatopsia</option>
              </select>
            </label>
            <label className="flex flex-col gap-0.5">
              <span style={{ color: themeStyle.mutedColor }}>X tick</span>
              <select className="input text-xxs" value={tickFormatX} onChange={e => { setTickFormatX(e.target.value as TickFormat); notify() }}>
                <option value="auto">Auto</option>
                <option value="plain">Plain</option>
                <option value="scientific">Scientific (1.0e3)</option>
                <option value="percent">Percent (%)</option>
                <option value="currency">Currency ($)</option>
                <option value="compact">Compact (1.2K)</option>
              </select>
            </label>
            <label className="flex flex-col gap-0.5">
              <span style={{ color: themeStyle.mutedColor }}>Y tick</span>
              <select className="input text-xxs" value={tickFormatY} onChange={e => { setTickFormatY(e.target.value as TickFormat); notify() }}>
                <option value="auto">Auto</option>
                <option value="plain">Plain</option>
                <option value="scientific">Scientific (1.0e3)</option>
                <option value="percent">Percent (%)</option>
                <option value="currency">Currency ($)</option>
                <option value="compact">Compact (1.2K)</option>
              </select>
            </label>
            <label className="flex flex-col gap-0.5">
              <span style={{ color: themeStyle.mutedColor }}>
                Palette {CB_SAFE_PALETTES.has(palette) && <span className="ml-1 px-1 rounded text-xxs" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>CB-safe</span>}
              </span>
              <select className="input text-xxs" value={palette} onChange={e => { setPalette(e.target.value); setCustomColors(undefined); notify() }}>
                {Object.keys(PALETTES).map(p => (
                  <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1).replace('_', ' ')}{CB_SAFE_PALETTES.has(p) ? ' (CB-safe)' : ''}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-0.5">
              <span style={{ color: themeStyle.mutedColor }}>Watermark</span>
              <input className="input text-xxs" placeholder="(empty)" value={watermark} onChange={e => { setWatermark(e.target.value); notify() }} />
            </label>
          </div>
          <div className="mt-2">
            <div className="text-xxs mb-1" style={{ color: themeStyle.mutedColor }}>Per-series colors (overrides palette)</div>
            <div className="flex gap-1 flex-wrap">
              {(PALETTES[palette] || PALETTES.default).slice(0, 10).map((c, i) => {
                const current = customColors?.[i] || c
                return (
                  <input
                    key={i}
                    type="color"
                    value={normalizeHex(current)}
                    onChange={e => {
                      const next = [...(customColors || (PALETTES[palette] || PALETTES.default).slice(0, 10))]
                      while (next.length < 10) next.push((PALETTES[palette] || PALETTES.default)[next.length] || '#888888')
                      next[i] = e.target.value
                      setCustomColors(next); notify()
                    }}
                    title={`Series ${i + 1}: ${current}`}
                    className="w-6 h-6 rounded cursor-pointer p-0 border-0 bg-transparent"
                  />
                )
              })}
              {customColors && (
                <button
                  onClick={() => { setCustomColors(undefined); notify() }}
                  className="text-xxs px-1.5 rounded border border-[var(--glass-border)] hover:bg-[var(--glass-bg)]"
                  style={{ color: themeStyle.mutedColor }}
                >Reset</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* SVG filter defs for color-blind simulation. */}
      <svg width="0" height="0" style={{ position: 'absolute' }}>
        <defs>
          <filter id="cb-protan">
            <feColorMatrix type="matrix" values="0.567 0.433 0 0 0  0.558 0.442 0 0 0  0 0.242 0.758 0 0  0 0 0 1 0" />
          </filter>
          <filter id="cb-deuter">
            <feColorMatrix type="matrix" values="0.625 0.375 0 0 0  0.7 0.3 0 0 0  0 0.3 0.7 0 0  0 0 0 1 0" />
          </filter>
          <filter id="cb-tritan">
            <feColorMatrix type="matrix" values="0.95 0.05 0 0 0  0 0.433 0.567 0 0  0 0.475 0.525 0 0  0 0 0 1 0" />
          </filter>
        </defs>
      </svg>

      {/* Title block */}
      {(title || subtitle) && (
        <div style={{ marginBottom: 10 }}>
          {title && (
            <h3 style={{
              margin: 0, fontSize: 16 * fs, fontWeight: 600,
              fontFamily: themeStyle.titleFont, color: themeStyle.textColor,
              letterSpacing: theme === 'ieee' ? 0 : '-0.01em',
            }}>{title}</h3>
          )}
          {subtitle && (
            <p style={{ margin: '2px 0 0', fontSize: 11 * fs, color: themeStyle.mutedColor, fontFamily: themeStyle.bodyFont }}>
              {subtitle}
            </p>
          )}
        </div>
      )}

      {/* Chart canvas — children render here. data-pub-figure-canvas
          is the export hook. */}
      <div
        data-pub-figure-canvas
        style={{
          filter: cbSim !== 'none' ? CB_SIM_FILTER[cbSim] : undefined,
          position: 'relative',
          ...(aspectRatio ? { aspectRatio: String(aspectRatio), width: '100%' } : {}),
        }}
      >
        {/* Pass theme context via a CSS variable so children can opt-in
            to the publication palette without changing their props. */}
        <div style={{
          height: aspectRatio ? '100%' : undefined,
          // Expose context as data attrs for downstream styling hooks.
          ['--pub-axis-color' as any]: themeStyle.axisColor,
          ['--pub-grid-color' as any]: themeStyle.gridColor,
          ['--pub-text-color' as any]: themeStyle.textColor,
          ['--pub-muted-color' as any]: themeStyle.mutedColor,
          ['--pub-tooltip-bg' as any]: themeStyle.tooltipBg,
          ['--pub-font-mult' as any]: fs,
        }}>
          {typeof children === 'function' ? (children as any)(ctx) : children}
        </div>

        {/* Watermark */}
        {watermark && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none', userSelect: 'none',
            fontSize: 64 * fs, fontWeight: 700, opacity: 0.06,
            color: themeStyle.textColor, transform: 'rotate(-22deg)',
            fontFamily: themeStyle.titleFont, letterSpacing: '0.1em',
          }}>{watermark}</div>
        )}
      </div>

      {/* Caption + source */}
      {(caption || source) && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${themeStyle.gridColor}` }}>
          {caption && (
            <p style={{ margin: 0, fontSize: 11 * fs, lineHeight: 1.4, color: themeStyle.textColor, fontFamily: themeStyle.bodyFont }}>
              {caption}
            </p>
          )}
          {source && (
            <p style={{ margin: caption ? '6px 0 0' : 0, fontSize: 10 * fs, fontStyle: 'italic', color: themeStyle.mutedColor, fontFamily: themeStyle.bodyFont }}>
              Source: {source}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
