/**
 * PlotlyPlot3D — 3D Visualization using Plotly.js
 * Renders as SVG/HTML (copy-pasteable, embeddable in documents).
 * Supports: scatter, bubble, line, bar, surface, wireframe, contour,
 *   trisurf, quiver, isosurface, voxel, streamline, slice, stem, waterfall, ribbon, pie
 */
import { useMemo } from 'react'
import createPlotlyComponent from 'react-plotly.js/factory'
import Plotly from 'plotly.js-dist-min'

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
  '#8b5cf6', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444',
  '#ec4899', '#06b6d4', '#f97316', '#6366f1', '#14b8a6',
]

const PLOTLY_COLORSCALE: Record<string, string> = {
  viridis: 'Viridis',
  plasma: 'Plasma',
  categorical: 'Viridis',
  gradient: 'YlGnBu',
}

function generateSurfaceData(
  fn: (x: number, y: number) => number,
  resolution = 30
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

    const buildTraces = (): Plotly.Data[] => {
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
          const traces: Plotly.Data[] = []
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
          // Auto-generate surface from scattered points
          const res = 20
          const xMin = Math.min(...xs), xMax = Math.max(...xs)
          const yMin = Math.min(...ys), yMax = Math.max(...ys)
          const xRange = Array.from({ length: res }, (_, i) => xMin + (xMax - xMin) * i / (res - 1))
          const yRange = Array.from({ length: res }, (_, i) => yMin + (yMax - yMin) * i / (res - 1))
          const zGrid = yRange.map(yi => xRange.map(xi => {
            const nearby = data.filter(d => Math.abs(d.x - xi) < (xMax - xMin) / res * 2 && Math.abs(d.y - yi) < (yMax - yMin) / res * 2)
            return nearby.length > 0 ? nearby.reduce((s, d) => s + d.z, 0) / nearby.length : 0
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
          const traces: Plotly.Data[] = []
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
    const baseLayout: Partial<Plotly.Layout> = {
      title: title ? { text: title, font: { color: '#e5e5e5', size: 14 } } : undefined,
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
      font: { color: '#a1a1aa', size: 11 },
      margin: { l: 40, r: 20, t: title ? 40 : 20, b: 40 },
      height,
      showlegend: hasCats || chartType === 'pie_3d',
      legend: { font: { color: '#a1a1aa' }, bgcolor: 'rgba(0,0,0,0)' },
    }

    if (!is2D) {
      (baseLayout as any).scene = {
        xaxis: { title: xLabel, color: '#a1a1aa', gridcolor: 'rgba(255,255,255,0.06)', zerolinecolor: 'rgba(255,255,255,0.1)' },
        yaxis: { title: yLabel, color: '#a1a1aa', gridcolor: 'rgba(255,255,255,0.06)', zerolinecolor: 'rgba(255,255,255,0.1)' },
        zaxis: { title: zLabel, color: '#a1a1aa', gridcolor: 'rgba(255,255,255,0.06)', zerolinecolor: 'rgba(255,255,255,0.1)' },
        bgcolor: 'rgba(0,0,0,0)',
      }
    }

    return { traces: buildTraces(), layout: baseLayout }
  }, [data, chartType, title, xLabel, yLabel, zLabel, pointSize, colorScheme, height, surfaceFunction])

  return (
    <div style={{ width: '100%', height }}>
      <Plot
        data={traces}
        layout={layout as any}
        config={{
          responsive: true,
          displayModeBar: true,
          modeBarButtonsToAdd: ['toImage'],
          toImageButtonOptions: {
            format: 'svg',
            filename: title || '3d-visualization',
            width: 1200,
            height: 800,
          },
          displaylogo: false,
        }}
        style={{ width: '100%', height: '100%' }}
        useResizeHandler
      />
    </div>
  )
}
