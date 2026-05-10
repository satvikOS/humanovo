/**
 * Shared plot export helpers.
 *
 * Plotly renders 3D / WebGL surfaces inside a `.js-plotly-plot` wrapper
 * with an SVG overlay that contains only axes + colorbar. Cloning that
 * SVG misses the main scene, which is why naive "copy as image" used to
 * hand users a lonely colorbar. For Plotly nodes we call Plotly.toImage
 * (which internally rasterizes the full scene). Recharts uses pure SVG,
 * so the clone + serialize path works there.
 *
 * Exports are **transparent by default** so figures drop cleanly into
 * papers, slides and posters without the host app's chrome bleeding
 * through. Pass `transparent: false` in opts to restore the theme-aware
 * solid background (used for in-app previews where a see-through png is
 * confusing).
 *
 * Exposed as a small utility so MonteCarloPanel, EquationPlotter,
 * Workstation, etc. share one implementation.
 */
import Plotly from '../lib/plotlyMin'
import type { Layout, ToImgopts } from 'plotly.js'

type PlotFormat = 'png' | 'svg'

export interface PlotExportOptions {
  /** Export with fully transparent background (publication default). */
  transparent?: boolean
}

function getThemeBgColor(): string {
  const isDark = document.documentElement.classList.contains('dark')
  return isDark ? '#0a0a0a' : '#ffffff'
}

/**
 * Capture whatever plot is rendered inside `host` as a Blob.
 * Returns null if no plot or an unrecoverable error occurred.
 */
export async function getPlotBlob(
  host: HTMLElement | null,
  format: PlotFormat,
  opts: PlotExportOptions = {},
): Promise<Blob | null> {
  if (!host) return null
  const transparent = opts.transparent !== false
  const bgColor = transparent ? 'rgba(0,0,0,0)' : getThemeBgColor()

  // ── Plotly (WebGL 3D scenes, heatmaps, contours) ─────────────────
  const plotlyNode = host.querySelector<HTMLDivElement>('.js-plotly-plot')
  if (plotlyNode) {
    const rect = plotlyNode.getBoundingClientRect()
    const w = Math.max(200, Math.round(rect.width))
    const h = Math.max(150, Math.round(rect.height))

    // Capture the figure's own bgcolors so we can restore after the snapshot.
    // Plotly.toImage respects whatever paper_bgcolor / plot_bgcolor the figure
    // currently has, so transient-relayout is the most reliable way to get a
    // truly transparent snapshot without affecting the on-screen appearance
    // once we reset.
    // Plotly's PlotlyHTMLElement type lives in plotly.js-dist-min but
    // its public type surface is incomplete. Treat as a minimal subset
    // we actually use (layout for paper/plot bgcolor reads).
    const gd = plotlyNode as HTMLDivElement & {
      layout?: { paper_bgcolor?: string | null; plot_bgcolor?: string | null }
    }
    const origPaper = gd.layout?.paper_bgcolor
    const origPlot = gd.layout?.plot_bgcolor
    try {
      if (transparent) {
        try {
          await Plotly.relayout(gd, {
            paper_bgcolor: 'rgba(0,0,0,0)',
            plot_bgcolor: 'rgba(0,0,0,0)',
          } as Partial<Layout>)
        } catch { /* best-effort */ }
      }
      const dataUrl = await Plotly.toImage(gd, {
        format, width: w, height: h,
      } as ToImgopts)
      if (format === 'svg') {
        const commaIdx = dataUrl.indexOf(',')
        const body = commaIdx >= 0 ? decodeURIComponent(dataUrl.slice(commaIdx + 1)) : ''
        return new Blob([body], { type: 'image/svg+xml' })
      }
      const img = new Image()
      img.src = dataUrl
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('plotly png load failed'))
      })
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      if (!transparent) {
        ctx.fillStyle = bgColor
        ctx.fillRect(0, 0, w, h)
      }
      ctx.drawImage(img, 0, 0, w, h)
      return await new Promise<Blob | null>(resolve =>
        canvas.toBlob(b => resolve(b), 'image/png')
      )
    } catch {
      // Fall through to the SVG path if Plotly.toImage failed (rare).
    } finally {
      if (transparent) {
        try {
          await Plotly.relayout(gd, {
            paper_bgcolor: origPaper ?? null,
            plot_bgcolor: origPlot ?? null,
          } as Partial<Layout>)
        } catch { /* best-effort */ }
      }
    }
  }

  // ── Recharts / inline SVG ──
  const svg = host.querySelector('svg')
  if (!svg) return null
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  const rect = svg.getBoundingClientRect()
  if (!clone.getAttribute('width')) clone.setAttribute('width', String(rect.width))
  if (!clone.getAttribute('height')) clone.setAttribute('height', String(rect.height))
  if (!transparent) {
    const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    bgRect.setAttribute('width', '100%')
    bgRect.setAttribute('height', '100%')
    bgRect.setAttribute('fill', bgColor)
    clone.insertBefore(bgRect, clone.firstChild)
  }
  const xml = new XMLSerializer().serializeToString(clone)

  if (format === 'svg') {
    return new Blob([xml], { type: 'image/svg+xml' })
  }

  // Rasterize SVG at 2× for crisp output on hi-dpi displays.
  const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' })
  const svgUrl = URL.createObjectURL(svgBlob)
  try {
    const img = new Image()
    img.src = svgUrl
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('svg load failed'))
    })
    const w = Number(clone.getAttribute('width')) || img.width || 800
    const h = Number(clone.getAttribute('height')) || img.height || 480
    const scale = 2
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(w * scale)
    canvas.height = Math.round(h * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    if (!transparent) {
      ctx.fillStyle = bgColor
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob | null>(resolve =>
      canvas.toBlob(b => resolve(b), 'image/png')
    )
  } finally {
    URL.revokeObjectURL(svgUrl)
  }
}

/** Copy the current plot rendered inside `host` to the clipboard as PNG. */
export async function copyPlotToClipboard(
  host: HTMLElement | null,
  opts: PlotExportOptions = {},
): Promise<boolean> {
  try {
    const blob = await getPlotBlob(host, 'png', opts)
    if (!blob) return false
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    return true
  } catch {
    return false
  }
}

/** Download the current plot as PNG. */
export async function downloadPlotPng(
  host: HTMLElement | null,
  filename: string,
  opts: PlotExportOptions = {},
): Promise<boolean> {
  const blob = await getPlotBlob(host, 'png', opts)
  if (!blob) return false
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.png') ? filename : `${filename}.png`
  a.click()
  URL.revokeObjectURL(url)
  return true
}

/** Download the current plot as SVG. */
export async function downloadPlotSvg(
  host: HTMLElement | null,
  filename: string,
  opts: PlotExportOptions = {},
): Promise<boolean> {
  const blob = await getPlotBlob(host, 'svg', opts)
  if (!blob) return false
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.svg') ? filename : `${filename}.svg`
  a.click()
  URL.revokeObjectURL(url)
  return true
}
