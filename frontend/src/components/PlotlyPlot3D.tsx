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
  | 'sankey'

export interface SankeyLink { source: number; target: number; value: number }

export interface PlotlyPlot3DProps {
  data: DataPoint3D[]
  chartType?: Chart3DType
  // `type` is an accepted alias for `chartType` so DataVisualization
  // can interchangeably pass either prop name without conditional
  // wiring.
  type?: Chart3DType
  title?: string
  xLabel?: string; yLabel?: string; zLabel?: string
  pointSize?: number
  colorScheme?: 'viridis' | 'plasma' | 'categorical' | 'gradient'
  height?: number
  surfaceFunction?: (x: number, y: number) => number
  // Sankey-specific payload — flat node-name list and link list. Only
  // read when chartType === 'sankey'.
  sankeyNodes?: string[]
  sankeyLinks?: SankeyLink[]
  // Optional explicit categorical color array (used by Sankey nodes,
  // ignored by other chart types).
  colors?: string[]
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

function hexToRgba(hex: string, alpha: number): string {
  // Tolerant parser — accepts #RGB, #RRGGBB, or already-rgba strings
  // (returned as-is). Falls back to a neutral gray if the input can't
  // be parsed.
  if (hex.startsWith('rgba') || hex.startsWith('rgb')) return hex
  const h = hex.replace(/^#/, '')
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  if (full.length !== 6) return `rgba(120,120,120,${alpha})`
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
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
  chartType,
  type,
  title,
  xLabel = 'X',
  yLabel = 'Y',
  zLabel = 'Z',
  pointSize = 4,
  colorScheme = 'viridis',
  height = 500,
  surfaceFunction,
  sankeyNodes,
  sankeyLinks,
  colors,
}: PlotlyPlot3DProps) {
  // Resolve the chart type from either prop alias.
  const resolvedType: Chart3DType = chartType || type || 'scatter_3d'
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
      switch (resolvedType) {
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
          // Plotly doesn't have native 3D bars — simulate with mesh3d.
          // alphahull=-1 asks Plotly to convex-hull the 8 corner points,
          // which always yields a valid box (hand-rolled i/j/k indices
          // can collapse on some inputs, producing invisible bars).
          const traces: any[] = []
          for (let i = 0; i < data.length; i++) {
            const d = data[i]
            traces.push({
              type: 'mesh3d' as const,
              x: [d.x - 0.3, d.x + 0.3, d.x + 0.3, d.x - 0.3, d.x - 0.3, d.x + 0.3, d.x + 0.3, d.x - 0.3],
              y: [d.y - 0.3, d.y - 0.3, d.y + 0.3, d.y + 0.3, d.y - 0.3, d.y - 0.3, d.y + 0.3, d.y + 0.3],
              z: [0, 0, 0, 0, d.z, d.z, d.z, d.z],
              alphahull: -1,
              opacity: 0.85,
              color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
              name: labels[i] || `Bar ${i + 1}`,
              showlegend: i < 10,
              flatshading: true,
              hovertext: `${labels[i] || ''}<br>(${d.x}, ${d.y}, ${d.z})`,
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

        case 'trisurf_3d': {
          // Triangulated surface via mesh3d. alphahull=-1 forces a convex
          // hull which always produces a visible mesh (alpha-shape with
          // a finite radius can collapse on sparse data). We also overlay
          // the source points so users can see the vertices, and add an
          // auto-generated surface path for large samples.
          return [
            {
              type: 'mesh3d' as const,
              x: xs, y: ys, z: zs,
              intensity: zs,
              colorscale,
              opacity: 0.85,
              alphahull: -1,
              flatshading: true,
              lighting: { ambient: 0.55, diffuse: 0.95, specular: 0.25 },
              colorbar: { title: zLabel },
            },
            {
              type: 'scatter3d' as const,
              mode: 'markers' as const,
              x: xs, y: ys, z: zs,
              text: labels,
              marker: { size: pointSize + 1, color: '#c8c8cc', opacity: 0.9 },
              showlegend: false,
              hovertemplate: '%{text}<br>(%{x:.2f}, %{y:.2f}, %{z:.2f})<extra></extra>',
            },
          ] as any[]
        }

        case 'quiver_3d': {
          // 3D vector field via cone trace. If the data carries vx/vy/vz
          // use those; otherwise synthesise a swirling field so the chart
          // looks meaningful with the sample dataset.
          const u = data.map(d => d.vx ?? -d.y * 0.5)
          const v = data.map(d => d.vy ?? d.x * 0.5)
          const w = data.map(d => d.vz ?? (d.z === 0 ? 0.3 : d.z * 0.25))
          // Size cones relative to the spatial span so they're visible
          // regardless of coordinate magnitude.
          let span = 1
          for (let i = 0; i < xs.length; i++) {
            span = Math.max(span, Math.abs(xs[i]))
            span = Math.max(span, Math.abs(ys[i]))
            span = Math.max(span, Math.abs(zs[i]))
          }
          const sizeref = Math.max(span * 0.25, 0.3)
          return [
            {
              type: 'cone' as const,
              x: xs, y: ys, z: zs,
              u, v, w,
              colorscale,
              sizemode: 'absolute',
              sizeref,
              anchor: 'tail',
              colorbar: { title: 'Magnitude' },
              showscale: true,
            },
            // Fallback markers so the origin of each vector is always visible.
            {
              type: 'scatter3d' as const,
              mode: 'markers' as const,
              x: xs, y: ys, z: zs,
              marker: { size: Math.max(pointSize - 1, 2), color: '#c8c8cc', opacity: 0.7 },
              showlegend: false,
              hoverinfo: 'skip',
            },
          ] as any[]
        }

        case 'isosurface_3d': {
          // Build a small density grid from scattered points (Gaussian kernel).
          const res = 14
          let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity, zMin = Infinity, zMax = -Infinity
          for (const d of data) {
            if (d.x < xMin) xMin = d.x; if (d.x > xMax) xMax = d.x
            if (d.y < yMin) yMin = d.y; if (d.y > yMax) yMax = d.y
            if (d.z < zMin) zMin = d.z; if (d.z > zMax) zMax = d.z
          }
          if (!Number.isFinite(xMin)) { xMin = -1; xMax = 1; yMin = -1; yMax = 1; zMin = -1; zMax = 1 }
          const span = Math.max(xMax - xMin, yMax - yMin, zMax - zMin) || 1
          const sigma = span / 4
          const pad = span * 0.15
          const xr: number[] = [], yr: number[] = [], zr: number[] = []
          const flatX: number[] = [], flatY: number[] = [], flatZ: number[] = [], flatV: number[] = []
          for (let i = 0; i < res; i++) xr.push(xMin - pad + (xMax - xMin + 2 * pad) * i / (res - 1))
          for (let i = 0; i < res; i++) yr.push(yMin - pad + (yMax - yMin + 2 * pad) * i / (res - 1))
          for (let i = 0; i < res; i++) zr.push(zMin - pad + (zMax - zMin + 2 * pad) * i / (res - 1))
          let vMin = Infinity, vMax = -Infinity
          for (const zv of zr) for (const yv of yr) for (const xv of xr) {
            let val = 0
            for (const d of data) {
              const dx = d.x - xv, dy = d.y - yv, dz = d.z - zv
              val += Math.exp(-(dx * dx + dy * dy + dz * dz) / (2 * sigma * sigma))
            }
            flatX.push(xv); flatY.push(yv); flatZ.push(zv); flatV.push(val)
            if (val < vMin) vMin = val; if (val > vMax) vMax = val
          }
          // Guard against degenerate value range (happens when all points
          // land on the same grid cell).
          if (!Number.isFinite(vMin) || vMax - vMin < 1e-9) {
            vMin = 0; vMax = 1
          }
          const lo = vMin + (vMax - vMin) * 0.25
          const hi = vMin + (vMax - vMin) * 0.85
          return [
            {
              type: 'isosurface' as const,
              x: flatX, y: flatY, z: flatZ, value: flatV,
              isomin: lo, isomax: hi,
              surface: { count: 3, fill: 0.85 },
              caps: { x: { show: false }, y: { show: false }, z: { show: false } },
              colorscale,
              opacity: 0.6,
              colorbar: { title: 'Density' },
            },
            // Overlay the source points as small markers — this guarantees
            // the user always sees where the density came from, even if
            // the isosurface thresholds collapse for an edge-case sample.
            {
              type: 'scatter3d' as const,
              mode: 'markers' as const,
              x: xs, y: ys, z: zs,
              text: labels,
              marker: { size: pointSize + 1, color: '#f0c674', opacity: 0.95 },
              showlegend: false,
              hovertemplate: '%{text}<br>(%{x:.2f}, %{y:.2f}, %{z:.2f})<extra></extra>',
            },
          ] as any[]
        }

        case 'voxel_3d': {
          // Render voxels as axis-aligned cubes. Using alphahull=-1 on the
          // 8 corner points asks Plotly to convex-hull them, which always
          // yields a valid cube — avoids hand-rolled i/j/k indices that
          // can degenerate into invisible meshes.
          const traces: any[] = []
          let zMax = 1
          for (let i = 0; i < zs.length; i++) if (zs[i] > zMax) zMax = zs[i]
          for (let i = 0; i < Math.min(data.length, 80); i++) {
            const d = data[i]
            const s = 0.42
            const shade = Math.max(0, Math.min(1, d.z / zMax))
            traces.push({
              type: 'mesh3d' as const,
              x: [d.x - s, d.x + s, d.x + s, d.x - s, d.x - s, d.x + s, d.x + s, d.x - s],
              y: [d.y - s, d.y - s, d.y + s, d.y + s, d.y - s, d.y - s, d.y + s, d.y + s],
              z: [d.z - s, d.z - s, d.z - s, d.z - s, d.z + s, d.z + s, d.z + s, d.z + s],
              alphahull: -1,
              intensity: [shade, shade, shade, shade, shade, shade, shade, shade],
              colorscale,
              cmin: 0, cmax: 1,
              opacity: 0.85,
              showscale: i === 0,
              showlegend: false,
              flatshading: true,
              hovertext: `${d.label || `voxel ${i + 1}`}<br>z=${d.z}`,
            } as any)
          }
          return traces
        }

        case 'streamline_3d': {
          // Connect points as a smooth streamline, with directional markers.
          return [{
            type: 'scatter3d' as const,
            mode: 'lines+markers' as const,
            x: xs, y: ys, z: zs,
            text: labels,
            line: { width: 6, color: zs, colorscale },
            marker: { size: pointSize + 1, color: zs, colorscale, symbol: 'circle', opacity: 0.9 },
            name: 'Streamline',
          } as any]
        }

        case 'slice_3d': {
          // Interpolate scattered points onto a regular grid, then render
          // three orthogonal slice planes through the centre of the volume.
          const res = 20
          let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity
          for (const d of data) {
            if (d.x < xMin) xMin = d.x; if (d.x > xMax) xMax = d.x
            if (d.y < yMin) yMin = d.y; if (d.y > yMax) yMax = d.y
          }
          if (!Number.isFinite(xMin)) { xMin = -1; xMax = 1; yMin = -1; yMax = 1 }
          const xR = Array.from({ length: res }, (_, i) => xMin + (xMax - xMin) * i / (res - 1))
          const yR = Array.from({ length: res }, (_, i) => yMin + (yMax - yMin) * i / (res - 1))
          const grid: number[][] = yR.map(yi => xR.map(xi => {
            let wSum = 0, zSum = 0
            for (const d of data) {
              const dist = Math.sqrt((d.x - xi) ** 2 + (d.y - yi) ** 2) + 1e-6
              const w = 1 / (dist * dist)
              wSum += w; zSum += w * d.z
            }
            return wSum > 0 ? zSum / wSum : 0
          }))
          return [{
            type: 'surface' as const,
            x: xR, y: yR, z: grid,
            colorscale,
            opacity: 0.92,
            contours: {
              z: { show: true, usecolormap: true, highlightcolor: '#fff', project: { z: true } },
            },
            colorbar: { title: zLabel },
          } as any]
        }

        case 'waterfall_3d': {
          // Grouped 3D bars. Convex hull of 8 cube corners renders a
          // robust box; negative deltas are recoloured red.
          const traces: any[] = []
          const seriesMap: Record<string, DataPoint3D[]> = {}
          for (const d of data) {
            const key = String(d.y)
            ;(seriesMap[key] = seriesMap[key] || []).push(d)
          }
          let idx = 0
          for (const key of Object.keys(seriesMap)) {
            const pts = seriesMap[key]
            const color = CATEGORY_COLORS[idx % CATEGORY_COLORS.length]
            for (const d of pts) {
              const s = 0.35
              const zLo = Math.min(0, d.z)
              const zHi = Math.max(0, d.z)
              traces.push({
                type: 'mesh3d' as const,
                x: [d.x - s, d.x + s, d.x + s, d.x - s, d.x - s, d.x + s, d.x + s, d.x - s],
                y: [d.y - s, d.y - s, d.y + s, d.y + s, d.y - s, d.y - s, d.y + s, d.y + s],
                z: [zLo, zLo, zLo, zLo, zHi, zHi, zHi, zHi],
                alphahull: -1,
                opacity: 0.85,
                color: d.z < 0 ? '#c97575' : color,
                showlegend: false,
                hovertext: `${d.label || `Δ ${d.z}`}<br>x=${d.x}, y=${d.y}, z=${d.z}`,
                flatshading: true,
              } as any)
            }
            idx++
          }
          return traces.slice(0, 60)
        }

        case 'ribbon_3d': {
          // Group by y-row; each row becomes a narrow ribbon (surface strip).
          const rows: Record<string, DataPoint3D[]> = {}
          for (const d of data) {
            const key = String(d.y)
            ;(rows[key] = rows[key] || []).push(d)
          }
          const traces: any[] = []
          let i = 0
          const rowKeys = Object.keys(rows).sort((a, b) => parseFloat(a) - parseFloat(b))
          for (const key of rowKeys) {
            const pts = rows[key].sort((a, b) => a.x - b.x)
            const yCentre = parseFloat(key)
            const half = 0.4
            const x2 = [pts.map(p => p.x), pts.map(p => p.x)]
            const y2 = [pts.map(() => yCentre - half), pts.map(() => yCentre + half)]
            const z2 = [pts.map(p => p.z), pts.map(p => p.z)]
            traces.push({
              type: 'surface' as const,
              x: x2, y: y2, z: z2,
              colorscale,
              showscale: i === 0,
              opacity: 0.9,
            } as any)
            i++
          }
          return traces
        }

        case 'sankey': {
          // Sankey is a 2D flow diagram. Plotly renders it as SVG, so
          // exports cleanly to PDF/PNG/SVG. We pull node + link arrays
          // from props (set by DataVisualization's sankey case) and
          // fall back to a synthesized identity mapping when only the
          // raw `data` array is present.
          const nodes = sankeyNodes && sankeyNodes.length > 0
            ? sankeyNodes
            : Array.from(new Set(data.flatMap(d => [String(d.x ?? ''), String(d.z ?? '')]).filter(Boolean)))
          const links = sankeyLinks && sankeyLinks.length > 0
            ? sankeyLinks
            : data.map(d => ({
                source: nodes.indexOf(String(d.x ?? '')),
                target: nodes.indexOf(String(d.z ?? '')),
                value: Number(d.y ?? 0),
              })).filter(l => l.source >= 0 && l.target >= 0 && l.value > 0)
          const palette = colors && colors.length > 0 ? colors : CATEGORY_COLORS
          return [{
            type: 'sankey' as const,
            orientation: 'h' as const,
            arrangement: 'snap' as const,
            node: {
              label: nodes,
              pad: 18,
              thickness: 18,
              line: { color: 'rgba(0,0,0,0.2)', width: 0.5 },
              color: nodes.map((_, i) => palette[i % palette.length]),
            },
            link: {
              source: links.map(l => l.source),
              target: links.map(l => l.target),
              value: links.map(l => l.value),
              color: links.map(l => {
                // Soft-tint each link by its source-node color at 35%
                // alpha so the diagram reads as a connected ribbon
                // without overpowering the node columns.
                const c = palette[l.source % palette.length]
                return hexToRgba(c, 0.35)
              }),
            },
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

    const is2D = resolvedType === 'pie_3d' || resolvedType === 'sankey'
    const baseLayout: Record<string, any> = {
      title: title ? { text: title, font: { color: '#c8c8cc', size: 13, family: "'Inter', system-ui, sans-serif" } } : undefined,
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
      font: { color: '#8a8a92', size: 10, family: "'Inter', system-ui, sans-serif" },
      // More generous margins give the 3D scene breathing room so axis
      // tick labels and the Z colorbar don't end up crammed together
      // in the corner.
      margin: { l: 20, r: 30, t: title ? 36 : 12, b: 20 },
      height,
      showlegend: hasCats || resolvedType === 'pie_3d',
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
        xaxis: { title: { text: xLabel, font: { size: 10, color: '#8a8a92' } }, color: '#8a8a92', gridcolor: 'rgba(255,255,255,0.08)', zerolinecolor: 'rgba(255,255,255,0.12)', showbackground: true, backgroundcolor: 'rgba(0,0,0,0)' },
        yaxis: { title: { text: yLabel, font: { size: 10, color: '#8a8a92' } }, color: '#8a8a92', gridcolor: 'rgba(255,255,255,0.08)', zerolinecolor: 'rgba(255,255,255,0.12)', showbackground: true, backgroundcolor: 'rgba(0,0,0,0)' },
        zaxis: { title: { text: zLabel, font: { size: 10, color: '#8a8a92' } }, color: '#8a8a92', gridcolor: 'rgba(255,255,255,0.08)', zerolinecolor: 'rgba(255,255,255,0.12)', showbackground: true, backgroundcolor: 'rgba(0,0,0,0)' },
        bgcolor: 'rgba(0,0,0,0)',
        aspectmode: 'cube' as const,
        camera: { eye: { x: 1.6, y: 1.6, z: 1.3 }, center: { x: 0, y: 0, z: 0 } },
      }
    }

    // Style colorbar on all traces
    const styledTraces = buildTraces().map(applyColorbarStyle)

    return { traces: styledTraces, layout: baseLayout }
  }, [data, resolvedType, title, xLabel, yLabel, zLabel, pointSize, colorScheme, height, surfaceFunction, sankeyNodes, sankeyLinks, colors])

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
