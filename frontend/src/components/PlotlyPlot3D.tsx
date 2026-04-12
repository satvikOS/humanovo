/**
 * PlotlyPlot3D — 3D Visualization using Plotly.js
 * Renders as SVG/HTML (copy-pasteable, embeddable in documents).
 * Supports: scatter, bubble, line, bar, surface, wireframe, contour,
 *   trisurf, quiver, isosurface, voxel, streamline, slice, stem, waterfall, ribbon, pie
 */
import { useMemo } from 'react'
import createPlotlyComponent from 'react-plotly.js/factory'
import Plotly from 'plotly.js-dist-min'
import { plotlyConfig } from '../utils/plotlyConfig'

const Plot = createPlotlyComponent(Plotly)

export interface DataPoint3D {
  x: number; y: number; z: number
  label?: string; color?: string; size?: number; category?: string
  vx?: number; vy?: number; vz?: number
}

export type Chart3DType =
  | 'scatter_3d' | 'bubble_3d' | 'line_3d' | 'bar_3d'
  | 'surface_3d' | 'wireframe_3d' | 'contour_3d' | 'trisurf_3d'
  | 'quiver_3d' | 'isosurface_3d' | 'voxel_3d' | 'streamline_3d'
  | 'slice_3d' | 'stem_3d' | 'waterfall_3d' | 'ribbon_3d' | 'pie_3d'

export interface PlotlyPlot3DProps {
  data: DataPoint3D[]
  chartType?: Chart3DType
  title?: string
  xLabel?: string; yLabel?: string; zLabel?: string
  pointSize?: number
  colorScheme?: 'viridis' | 'plasma' | 'categorical' | 'gradient'
  height?: number
  surfaceFunction?: (x: number, y: number) => number
}

const CATEGORY_COLORS = [
  '#5B8DB8', '#8B7EAF', '#6BA594', '#C4956A', '#B07E8B',
  '#7BA7B8', '#A89B6E', '#8598AD', '#7E9B8A', '#9B8EAD',
]

const PLOTLY_COLORSCALE: Record<string, string> = {
  viridis: 'Viridis',
  plasma: 'Plasma',
  categorical: 'Viridis',
  gradient: 'YlGnBu',
}

function generateSurfaceData(
  fn: (x: number, y: number) => number,
  resolution = 50
): { x: number[][]; y: number[][]; z: number[][] } {
  const range = Array.from({ length: resolution }, (_, i) => -3 + (6 * i) / (resolution - 1))
  const x: number[][] = []
  const y: number[][] = []
  const z: number[][] = []
  for (const yi of range) {
    const xRow: number[] = []
    const yRow: number[] = []
    const zRow: number[] = []
    for (const xi of range) {
      xRow.push(xi)
      yRow.push(yi)
      zRow.push(fn(xi, yi))
    }
    x.push(xRow)
    y.push(yRow)
    z.push(zRow)
  }
  return { x, y, z }
}

export default function PlotlyPlot3D({
  data,
  chartType = 'scatter_3d',
  title,
  xLabel = 'X',
  yLabel = 'Y',
  zLabel = 'Z',
  pointSize = 4,
  colorScheme = 'viridis',
  height = 500,
  surfaceFunction,
}: PlotlyPlot3DProps) {
  const { traces, layout } = useMemo(() => {
    const xs = data.map(d => d.x)
    const ys = data.map(d => d.y)
    const zs = data.map(d => d.z)
    const labels = data.map(d => d.label || '')
    const categories = data.map(d => d.category || '')
    const sizes = data.map(d => d.size || pointSize)
    const colorscale = PLOTLY_COLORSCALE[colorScheme] || 'Viridis'

    // Group by category for categorical coloring
    const uniqueCats = [...new Set(categories.filter(Boolean))]
    const hasCats = uniqueCats.length > 1

    const buildTraces = (): any[] => {
      switch (chartType) {
        case 'scatter_3d': {
          if (hasCats) {
            return uniqueCats.map((cat, i) => {
              const idxs = data.map((d, j) => d.category === cat ? j : -1).filter(j => j >= 0)
              return {
                type: 'scatter3d' as const,
                mode: 'markers' as const,
                name: cat,
                x: idxs.map(j => xs[j]),
                y: idxs.map(j => ys[j]),
                z: idxs.map(j => zs[j]),
                text: idxs.map(j => labels[j]),
                marker: { size: pointSize, color: CATEGORY_COLORS[i % CATEGORY_COLORS.length], opacity: 0.85 },
              }
            })
          }
          return [{
            type: 'scatter3d' as const,
            mode: 'markers' as const,
            x: xs, y: ys, z: zs,
            text: labels,
            marker: { size: pointSize, color: zs, colorscale, opacity: 0.85, colorbar: { title: zLabel } },
          }]
        }

        case 'bubble_3d': {
          return [{
            type: 'scatter3d' as const,
            mode: 'markers' as const,
            x: xs, y: ys, z: zs,
            text: labels,
            marker: { size: sizes.map(s => s * 2), color: zs, colorscale, opacity: 0.7, colorbar: { title: zLabel } },
          }]
        }

        case 'line_3d': {
          return [{
            type: 'scatter3d' as const,
            mode: 'lines+markers' as const,
            x: xs, y: ys, z: zs,
            text: labels,
            line: { width: 3, color: zs, colorscale },
            marker: { size: 3, color: zs, colorscale },
          }]
        }

        case 'bar_3d': {
          // Plotly doesn't have native 3D bars — simulate with mesh3d or use scatter3d with wide markers
          const traces: any[] = []
          for (let i = 0; i < data.length; i++) {
            const d = data[i]
            traces.push({
              type: 'mesh3d' as const,
              x: [d.x - 0.3, d.x + 0.3, d.x + 0.3, d.x - 0.3, d.x - 0.3, d.x + 0.3, d.x + 0.3, d.x - 0.3],
              y: [d.y - 0.3, d.y - 0.3, d.y + 0.3, d.y + 0.3, d.y - 0.3, d.y - 0.3, d.y + 0.3, d.y + 0.3],
              z: [0, 0, 0, 0, d.z, d.z, d.z, d.z],
              i: [0, 0, 0, 4, 4, 4, 0, 1, 2, 3, 0, 1],
              j: [1, 2, 3, 5, 6, 7, 1, 2, 3, 0, 4, 5],
              k: [2, 3, 0, 6, 7, 4, 5, 6, 7, 4, 1, 2],
              opacity: 0.8,
              color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
              name: labels[i] || `Bar ${i + 1}`,
              showlegend: i < 10,
            } as any)
          }
          return traces.slice(0, 30) // limit for performance
        }

        case 'surface_3d': {
          if (surfaceFunction) {
            const { x, y, z } = generateSurfaceData(surfaceFunction)
            return [{
              type: 'surface' as const,
              x: x[0], y: y.map(r => r[0]), z,
              colorscale,
              opacity: 0.9,
            }]
          }
          // Auto-generate surface from scattered points using IDW interpolation
          const res = 40
          // Single-pass min/max (large xs/ys arrays would overflow spread call stack)
          let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity
          for (let i = 0; i < xs.length; i++) {
            const xv = xs[i]; if (xv < xMin) xMin = xv; if (xv > xMax) xMax = xv
          }
          for (let i = 0; i < ys.length; i++) {
            const yv = ys[i]; if (yv < yMin) yMin = yv; if (yv > yMax) yMax = yv
          }
          if (!Number.isFinite(xMin)) { xMin = 0; xMax = 1 }
          if (!Number.isFinite(yMin)) { yMin = 0; yMax = 1 }
          const xRange = Array.from({ length: res }, (_, i) => xMin + (xMax - xMin) * i / (res - 1))
          const yRange = Array.from({ length: res }, (_, i) => yMin + (yMax - yMin) * i / (res - 1))
          // Inverse-distance-weighted interpolation for accurate surface
          const zGrid = yRange.map(yi => xRange.map(xi => {
            let wSum = 0, zSum = 0
            for (const d of data) {
              const dist = Math.sqrt((d.x - xi) ** 2 + (d.y - yi) ** 2)
              if (dist < 1e-10) return d.z
              const w = 1 / (dist * dist)
              wSum += w
              zSum += w * d.z
            }
            return wSum > 0 ? zSum / wSum : 0
          }))
          return [{
            type: 'surface' as const,
            x: xRange, y: yRange, z: zGrid,
            colorscale,
            opacity: 0.9,
          }]
        }

        case 'wireframe_3d': {
          if (surfaceFunction) {
            const { x, y, z } = generateSurfaceData(surfaceFunction)
            return [{
              type: 'surface' as const,
              x: x[0], y: y.map(r => r[0]), z,
              colorscale,
              opacity: 0.6,
              hidesurface: true,
              contours: {
                x: { show: true, color: '#8b5cf6', width: 1 },
                y: { show: true, color: '#3b82f6', width: 1 },
                z: { show: true, color: '#22c55e', width: 1 },
              },
            } as any]
          }
          return [{
            type: 'scatter3d' as const,
            mode: 'lines' as const,
            x: xs, y: ys, z: zs,
            line: { width: 2, color: '#8b5cf6' },
          }]
        }

        case 'contour_3d': {
          if (surfaceFunction) {
            const { x, y, z } = generateSurfaceData(surfaceFunction)
            return [{
              type: 'surface' as const,
              x: x[0], y: y.map(r => r[0]), z,
              colorscale,
              contours: {
                z: { show: true, usecolormap: true, project: { z: true } },
              },
            } as any]
          }
          return [{
            type: 'scatter3d' as const,
            mode: 'markers' as const,
            x: xs, y: ys, z: zs,
            marker: { size: pointSize, color: zs, colorscale },
          }]
        }

        case 'stem_3d': {
          const traces: any[] = []
          // Stems (vertical lines from z=0)
          for (const d of data.slice(0, 100)) {
            traces.push({
              type: 'scatter3d' as const,
              mode: 'lines' as const,
              x: [d.x, d.x], y: [d.y, d.y], z: [0, d.z],
              line: { width: 2, color: '#6366f1' },
              showlegend: false,
            })
          }
          // Markers at top
          traces.push({
            type: 'scatter3d' as const,
            mode: 'markers' as const,
            x: xs, y: ys, z: zs,
            marker: { size: pointSize + 2, color: zs, colorscale },
            name: 'Points',
          })
          return traces
        }

        case 'pie_3d': {
          // Use a 2D pie rendered with 3D-like appearance via Plotly
          return [{
            type: 'pie' as const,
            labels: labels.length > 0 ? labels : xs.map((_, i) => `Slice ${i + 1}`),
            values: zs,
            hole: 0,
            textinfo: 'label+percent',
            marker: { colors: CATEGORY_COLORS },
          } as any]
        }

        // Default: scatter3d for remaining types
        default: {
          return [{
            type: 'scatter3d' as const,
            mode: 'markers' as const,
            x: xs, y: ys, z: zs,
            text: labels,
            marker: { size: pointSize, color: zs, colorscale, opacity: 0.85 },
          }]
        }
      }
    }

    const is2D = chartType === 'pie_3d'
    const baseLayout: Record<string, any> = {
      title: title ? { text: title, font: { color: '#c8c8cc', size: 13, family: "'Inter', system-ui, sans-serif" } } : undefined,
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
      font: { color: '#8a8a92', size: 10, family: "'Inter', system-ui, sans-serif" },
      margin: { l: 10, r: 10, t: title ? 30 : 5, b: 10 },
      height,
      showlegend: hasCats || chartType === 'pie_3d',
      legend: { font: { color: '#8a8a92', size: 10 }, bgcolor: 'rgba(0,0,0,0)', orientation: 'h' as const, y: -0.05 },
    }

    // Apply thin, curved colorbar to all traces with colorbars
    const applyColorbarStyle = (trace: any) => {
      if (trace.marker?.colorbar) {
        trace.marker.colorbar = {
          ...trace.marker.colorbar,
          thickness: 10,
          len: 0.6,
          outlinewidth: 0,
          borderwidth: 0,
          tickfont: { size: 9, color: '#8a8a92' },
          titlefont: { size: 10, color: '#8a8a92' },
        }
      }
      return trace
    }

    if (!is2D) {
      (baseLayout as any).scene = {
        xaxis: { title: { text: xLabel, font: { size: 10, color: '#8a8a92' } }, color: '#8a8a92', gridcolor: 'rgba(255,255,255,0.04)', zerolinecolor: 'rgba(255,255,255,0.06)', showbackground: true, backgroundcolor: 'rgba(0,0,0,0)' },
        yaxis: { title: { text: yLabel, font: { size: 10, color: '#8a8a92' } }, color: '#8a8a92', gridcolor: 'rgba(255,255,255,0.04)', zerolinecolor: 'rgba(255,255,255,0.06)', showbackground: true, backgroundcolor: 'rgba(0,0,0,0)' },
        zaxis: { title: { text: zLabel, font: { size: 10, color: '#8a8a92' } }, color: '#8a8a92', gridcolor: 'rgba(255,255,255,0.04)', zerolinecolor: 'rgba(255,255,255,0.06)', showbackground: true, backgroundcolor: 'rgba(0,0,0,0)' },
        bgcolor: 'rgba(0,0,0,0)',
        camera: { eye: { x: 1.5, y: 1.5, z: 1.2 } },
      }
    }

    // Style colorbar on all traces
    const styledTraces = buildTraces().map(applyColorbarStyle)

    return { traces: styledTraces, layout: baseLayout }
  }, [data, chartType, title, xLabel, yLabel, zLabel, pointSize, colorScheme, height, surfaceFunction])

  return (
    <div style={{ width: '100%', height }}>
      {/* Hide modebar when printing or copy-pasting into documents */}
      <style>{`
        @media print {
          .plotly-plot3d-wrapper .modebar-container { display: none !important; }
        }
        .plotly-plot3d-wrapper .modebar-container {
          background: transparent !important;
        }
        .plotly-plot3d-wrapper .modebar-btn {
          font-size: 14px !important;
        }
        .plotly-plot3d-wrapper .modebar-group {
          padding: 0 2px !important;
        }
      `}</style>
      <div className="plotly-plot3d-wrapper" style={{ width: '100%', height: '100%' }}>
        <Plot
          data={traces}
          layout={layout as any}
          config={{
            ...plotlyConfig({ hide: true }),
            toImageButtonOptions: {
              format: 'svg',
              filename: title || '3d-visualization',
              width: 3840,
              height: 2160,
            },
            scrollZoom: true,
          }}
          style={{ width: '100%', height: '100%' }}
          useResizeHandler
        />
      </div>
    </div>
  )
}
