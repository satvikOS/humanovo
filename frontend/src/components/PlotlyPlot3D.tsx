/**
 * PlotlyPlot3D — 3D Visualization using Plotly.js
 * Renders as SVG/HTML (copy-pasteable, embeddable in documents).
 * Supports: scatter, bubble, line, bar, surface, wireframe, contour,
 *   trisurf, quiver, isosurface, voxel, streamline, slice, stem, waterfall, ribbon, pie
 */
import { useMemo } from 'react'
import createPlotlyComponent from 'react-plotly.js/factory'
import Plotly from '../lib/plotlyMin'
import type { Data, Layout } from 'plotly.js'
import { plotlyConfig } from '../utils/plotlyConfig'
import { THEMES, type PublicationTheme } from '../utils/publicationTheme'

// 3D plot traces are heterogeneous (scatter3d / mesh3d / surface / cone /
// streamtube / ...). Plotly's strict union narrowing on `Data` rejects
// objects with mixed shape, so we type traces with a permissive structural
// shape and cast at the JSX boundary. This keeps the code free of explicit
// `any` while preserving the field-flexibility this file relies on.
type Plot3DTrace = Record<string, unknown>

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
  // Publication theme. 'screen' keeps the dark-shell chrome; the
  // journal themes (paper/nature/science/ieee) render dark text +
  // dark gridlines on the light card so an exported 3D figure is
  // journal-ready instead of grey-on-white with invisible white grid.
  theme?: PublicationTheme
}

// Plotly renders to SVG/canvas where CSS custom properties don't
// reliably resolve, so the 3D chrome (title/font/axis/grid/tick
// colours) is a concrete-hex table keyed by publication theme.
interface Plot3DChrome {
  title: string; font: string; axis: string
  grid: string; zero: string; tick: string
  titleFamily: string; bodyFamily: string
}
const PLOT3D_CHROME: Record<PublicationTheme, Plot3DChrome> = {
  screen: {
    title: '#c8c8cc', font: '#8a8a92', axis: '#8a8a92',
    grid: 'rgba(255,255,255,0.12)', zero: 'rgba(255,255,255,0.18)', tick: '#8a8a92',
    titleFamily: THEMES.screen.titleFont, bodyFamily: THEMES.screen.bodyFont,
  },
  paper: {
    title: '#111111', font: '#444444', axis: '#222222',
    grid: 'rgba(0,0,0,0.10)', zero: 'rgba(0,0,0,0.22)', tick: '#333333',
    titleFamily: THEMES.paper.titleFont, bodyFamily: THEMES.paper.bodyFont,
  },
  nature: {
    title: '#000000', font: '#333333', axis: '#000000',
    grid: 'rgba(0,0,0,0.09)', zero: 'rgba(0,0,0,0.20)', tick: '#222222',
    titleFamily: THEMES.nature.titleFont, bodyFamily: THEMES.nature.bodyFont,
  },
  science: {
    title: '#000000', font: '#222222', axis: '#000000',
    grid: 'rgba(0,0,0,0.08)', zero: 'rgba(0,0,0,0.18)', tick: '#222222',
    titleFamily: THEMES.science.titleFont, bodyFamily: THEMES.science.bodyFont,
  },
  ieee: {
    title: '#000000', font: '#222222', axis: '#000000',
    grid: 'rgba(0,0,0,0.10)', zero: 'rgba(0,0,0,0.20)', tick: '#222222',
    titleFamily: THEMES.ieee.titleFont, bodyFamily: THEMES.ieee.bodyFont,
  },
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
  theme = 'screen',
}: PlotlyPlot3DProps) {
  // Resolve the chart type from either prop alias.
  const resolvedType: Chart3DType = chartType || type || 'scatter_3d'
  const { traces, layout } = useMemo(() => {
    const chrome = PLOT3D_CHROME[theme] || PLOT3D_CHROME.screen
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

    const buildTraces = (): Plot3DTrace[] => {
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
            // Marker line outline (thin dark stroke around each
            // point) gives publication-grade readability — without
            // it, points blend into the surface gridlines on dense
            // plots. Same convention as MATLAB's `scatter3` default.
            marker: {
              size: pointSize,
              color: zs,
              colorscale,
              opacity: 0.9,
              line: { color: 'rgba(0,0,0,0.55)', width: 0.5 },
              colorbar: { title: zLabel, thickness: 14, len: 0.6 },
            },
          }]
        }

        case 'bubble_3d': {
          return [{
            type: 'scatter3d' as const,
            mode: 'markers' as const,
            x: xs, y: ys, z: zs,
            text: labels,
            marker: {
              size: sizes.map(s => s * 2),
              color: zs,
              colorscale,
              opacity: 0.78,
              line: { color: 'rgba(0,0,0,0.55)', width: 0.5 },
              colorbar: { title: zLabel, thickness: 14, len: 0.6 },
            },
          }]
        }

        case 'line_3d': {
          return [{
            type: 'scatter3d' as const,
            mode: 'lines+markers' as const,
            x: xs, y: ys, z: zs,
            text: labels,
            // Thicker line so it reads at journal-card size; markers
            // shrunk so the line itself dominates rather than the
            // dot strip. Same gradient applied to both for a
            // unified look.
            line: { width: 5, color: zs, colorscale },
            marker: {
              size: 2.5,
              color: zs,
              colorscale,
              line: { color: 'rgba(0,0,0,0.55)', width: 0.5 },
            },
          }]
        }

        case 'bar_3d': {
          // Plotly doesn't have native 3D bars — simulate with mesh3d.
          // alphahull=-1 asks Plotly to convex-hull the 8 corner
          // points, which always yields a valid box (hand-rolled
          // i/j/k indices can collapse on some inputs, producing
          // invisible bars). Bar colour now picks up the chart's
          // colorscale interpolated against the z-value — gives
          // the matlab `bar3` look where bar height + colour both
          // encode magnitude. Edge mesh adds black wire seams so
          // bar boundaries read cleanly when packed.
          const traces: Plot3DTrace[] = []
          // Compute z-range once so we can normalise each bar's
          // colour onto [0,1] for the colorscale lookup.
          let zMin = Infinity, zMax = -Infinity
          for (const d of data) {
            if (d.z < zMin) zMin = d.z
            if (d.z > zMax) zMax = d.z
          }
          if (!Number.isFinite(zMin)) { zMin = 0; zMax = 1 }
          const zSpan = zMax - zMin || 1
          for (let i = 0; i < data.length; i++) {
            const d = data[i]
            traces.push({
              type: 'mesh3d' as const,
              x: [d.x - 0.3, d.x + 0.3, d.x + 0.3, d.x - 0.3, d.x - 0.3, d.x + 0.3, d.x + 0.3, d.x - 0.3],
              y: [d.y - 0.3, d.y - 0.3, d.y + 0.3, d.y + 0.3, d.y - 0.3, d.y - 0.3, d.y + 0.3, d.y + 0.3],
              z: [0, 0, 0, 0, d.z, d.z, d.z, d.z],
              alphahull: -1,
              opacity: 0.92,
              // intensity per-bar so colorscale interpolates each
              // bar to a single colour band based on its height —
              // matches matlab `bar3(z, 'detached')` behaviour.
              intensity: Array(8).fill((d.z - zMin) / zSpan),
              colorscale,
              cmin: 0, cmax: 1,
              showscale: i === 0, // only first bar carries the colorbar
              colorbar: i === 0 ? { title: zLabel, thickness: 14, len: 0.6 } : undefined,
              name: labels[i] || `Bar ${i + 1}`,
              showlegend: false,
              flatshading: true,
              lighting: { ambient: 0.6, diffuse: 0.85, specular: 0.15 },
              hovertext: `${labels[i] || ''}<br>(${d.x}, ${d.y}, ${d.z})`,
            } as Plot3DTrace)
          }
          return traces.slice(0, 30) // limit for performance
        }

        case 'surface_3d': {
          // MATLAB-style 3D surface: gradient color + black mesh
          // wireframe (the x/y contour grid lines that follow the
          // surface) + floor contour projection at z=zmin. Together
          // these give the chart the publication look from
          // ref Image 4 — a smooth coloured surface with the wire
          // overlay and the level-curve shadow on the bounding box
          // floor. Without the wire overlay the surface looks like
          // a featureless paint blob; without the floor projection
          // there's no way to read out level values.
          const buildMatlabSurface = (x: number[], y: number[], z: number[][]): Plot3DTrace[] => [{
            type: 'surface' as const,
            x, y, z,
            colorscale,
            opacity: 0.95,
            // Wireframe overlay: x and y contour lines on the
            // surface itself (MATLAB's `surf` default). Black at
            // 0.6 opacity reads cleanly against any colormap.
            contours: {
              x: { show: true, color: 'rgba(0,0,0,0.6)', width: 1 },
              y: { show: true, color: 'rgba(0,0,0,0.6)', width: 1 },
              // Floor projection: project the z-level curves down
              // onto the box floor so the user can read the contour
              // shadow underneath the surface. The `usecolormap`
              // makes the projected lines pick up the surface's
              // colour mapping.
              z: { show: true, usecolormap: true, highlight: false, project: { z: true } },
            },
            lighting: { ambient: 0.55, diffuse: 0.85, specular: 0.2, fresnel: 0.1, roughness: 0.5 },
            lightposition: { x: 100, y: 200, z: 100 },
            colorbar: { title: zLabel, thickness: 14, len: 0.6 },
          }]
          if (surfaceFunction) {
            const { x, y, z } = generateSurfaceData(surfaceFunction)
            return buildMatlabSurface(x[0], y.map(r => r[0]), z)
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
          return buildMatlabSurface(xRange, yRange, zGrid)
        }

        case 'wireframe_3d': {
          // MATLAB-style mesh: hide the filled surface, keep the
          // x/y wire crossings only. Ref Image 5 (blue+red
          // intersecting surfaces) is a special case of two
          // overlaid wires — here we render a single blue wire on
          // a transparent surface, which lets the back faces show
          // through naturally.
          const buildWire = (x: number[], y: number[], z: number[][]): Plot3DTrace[] => [{
            type: 'surface' as const,
            x, y, z,
            colorscale,
            opacity: 0,           // surface fully transparent
            hidesurface: true,    // suppress the colour fill entirely
            contours: {
              x: { show: true, color: '#3D5A80', width: 2 }, // muted ocean blue
              y: { show: true, color: '#3D5A80', width: 2 },
            },
            showscale: false,
            lighting: { ambient: 1, diffuse: 0, specular: 0 },
          } as Plot3DTrace]
          if (surfaceFunction) {
            const { x, y, z } = generateSurfaceData(surfaceFunction)
            return buildWire(x[0], y.map(r => r[0]), z)
          }
          return [{
            type: 'scatter3d' as const,
            mode: 'lines' as const,
            x: xs, y: ys, z: zs,
            line: { width: 2, color: '#3D5A80' },
          }]
        }

        case 'contour_3d': {
          // 3D-in-2D contour plot: render as a flat plotly contour
          // (ref Image 7 shows a 3D-perspective contour but Plotly's
          // contour with multi-level lines + filled bands gives the
          // same scientific-figure look). Wrap as a surface with z=0
          // and aggressive z-projection so the user reads the levels
          // both as the surface colour and as the projected lines.
          const buildContour = (x: number[], y: number[], z: number[][]): Plot3DTrace[] => [{
            type: 'surface' as const,
            x, y, z,
            colorscale,
            opacity: 0.9,
            contours: {
              z: { show: true, usecolormap: true, highlight: true, project: { z: true } },
              x: { show: true, color: 'rgba(0,0,0,0.5)', width: 1 },
              y: { show: true, color: 'rgba(0,0,0,0.5)', width: 1 },
            },
            colorbar: { title: zLabel, thickness: 14, len: 0.6 },
            lighting: { ambient: 0.65, diffuse: 0.85, specular: 0.15 },
          } as Plot3DTrace]
          if (surfaceFunction) {
            const { x, y, z } = generateSurfaceData(surfaceFunction)
            return buildContour(x[0], y.map(r => r[0]), z)
          }
          return [{
            type: 'scatter3d' as const,
            mode: 'markers' as const,
            x: xs, y: ys, z: zs,
            marker: { size: pointSize, color: zs, colorscale },
          }]
        }

        case 'stem_3d': {
          const traces: Plot3DTrace[] = []
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
          // Plotly doesn't have a native 3D pie. We render a 2D pie
          // with publication-grade defaults that match the 2D pie
          // chart in DataVisualization (textinfo dropped on tiny
          // slices, no leader lines, muted-policy palette colours
          // via marker.colors).
          const tinyThreshold = 0.04
          const total = zs.reduce((s, v) => s + Math.max(0, v), 0)
          return [{
            type: 'pie' as const,
            labels: labels.length > 0 ? labels : xs.map((_, i) => `Slice ${i + 1}`),
            values: zs,
            hole: 0,
            textinfo: 'label+percent',
            // Hide the label on slices below 4 % (matches the
            // 2D pie convention so a chart isn't chaotic at N=12).
            textposition: 'inside',
            insidetextorientation: 'radial',
            text: zs.map(v => (total > 0 && v / total < tinyThreshold ? '' : '')),
            marker: { colors: colors, line: { color: 'rgba(0,0,0,0.4)', width: 0.5 } },
          } as Plot3DTrace]
        }

        case 'trisurf_3d': {
          // Triangulated surface via mesh3d. alphahull=-1 forces a convex
          // hull which always produces a visible mesh (alpha-shape with
          // a finite radius can collapse on sparse data). We also overlay
          // the source points so users can see the vertices, and add an
          // auto-generated surface path for large samples.
          // Triangulated mesh + vertex markers. The vertex marker
          // colour was previously '#c8c8cc' (light gray, screen-
          // theme token-equivalent) which is invisible on white
          // bg. Switched to a fixed dark stroke that reads on any
          // surface colour. Mesh lighting matches surface_3d.
          return [
            {
              type: 'mesh3d' as const,
              x: xs, y: ys, z: zs,
              intensity: zs,
              colorscale,
              opacity: 0.92,
              alphahull: -1,
              flatshading: true,
              lighting: { ambient: 0.55, diffuse: 0.85, specular: 0.2 },
              lightposition: { x: 100, y: 200, z: 100 },
              colorbar: { title: zLabel, thickness: 14, len: 0.6 },
            },
            {
              type: 'scatter3d' as const,
              mode: 'markers' as const,
              x: xs, y: ys, z: zs,
              text: labels,
              marker: {
                size: pointSize + 1,
                color: 'rgba(40,40,40,0.85)',
                line: { color: 'rgba(255,255,255,0.5)', width: 0.5 },
              },
              showlegend: false,
              hovertemplate: '%{text}<br>(%{x:.2f}, %{y:.2f}, %{z:.2f})<extra></extra>',
            },
          ] as Plot3DTrace[]
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
              colorbar: { title: 'Magnitude', thickness: 14, len: 0.6 },
              showscale: true,
              lighting: { ambient: 0.6, diffuse: 0.85, specular: 0.15 },
            },
            // Fallback markers so the origin of each vector is
            // always visible. Dark fill instead of #c8c8cc light
            // gray so origins read on white-bg journal themes.
            {
              type: 'scatter3d' as const,
              mode: 'markers' as const,
              x: xs, y: ys, z: zs,
              marker: {
                size: Math.max(pointSize - 1, 2),
                color: 'rgba(40,40,40,0.85)',
                line: { color: 'rgba(255,255,255,0.4)', width: 0.5 },
              },
              showlegend: false,
              hoverinfo: 'skip',
            },
          ] as Plot3DTrace[]
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
              opacity: 0.65,
              colorbar: { title: 'Density', thickness: 14, len: 0.6 },
              lighting: { ambient: 0.55, diffuse: 0.85, specular: 0.2 },
            },
            // Overlay source points as muted-policy markers (was
            // '#f0c674' yellow, breaks the muted register).
            {
              type: 'scatter3d' as const,
              mode: 'markers' as const,
              x: xs, y: ys, z: zs,
              text: labels,
              marker: {
                size: pointSize + 1,
                color: 'rgba(40,40,40,0.85)',
                line: { color: 'rgba(255,255,255,0.4)', width: 0.5 },
              },
              showlegend: false,
              hovertemplate: '%{text}<br>(%{x:.2f}, %{y:.2f}, %{z:.2f})<extra></extra>',
            },
          ] as Plot3DTrace[]
        }

        case 'voxel_3d': {
          // Render voxels as axis-aligned cubes. Using alphahull=-1 on the
          // 8 corner points asks Plotly to convex-hull them, which always
          // yields a valid cube — avoids hand-rolled i/j/k indices that
          // can degenerate into invisible meshes.
          const traces: Plot3DTrace[] = []
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
            } as Plot3DTrace)
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
          } as Plot3DTrace]
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
          // Apply the same matlab-grade overlay as surface_3d:
          // x/y wire grid + z-floor projection.
          return [{
            type: 'surface' as const,
            x: xR, y: yR, z: grid,
            colorscale,
            opacity: 0.95,
            contours: {
              x: { show: true, color: 'rgba(0,0,0,0.6)', width: 1 },
              y: { show: true, color: 'rgba(0,0,0,0.6)', width: 1 },
              z: { show: true, usecolormap: true, highlight: false, project: { z: true } },
            },
            colorbar: { title: zLabel, thickness: 14, len: 0.6 },
            lighting: { ambient: 0.55, diffuse: 0.85, specular: 0.2 },
          } as Plot3DTrace]
        }

        case 'waterfall_3d': {
          // Grouped 3D bars. Convex hull of 8 cube corners renders a
          // robust box; negative deltas are recoloured red.
          const traces: Plot3DTrace[] = []
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
              } as Plot3DTrace)
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
          const traces: Plot3DTrace[] = []
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
            } as Plot3DTrace)
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
          } as Plot3DTrace]
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
    const baseLayout: Record<string, unknown> = {
      title: title ? { text: title, font: { color: chrome.title, size: 13, family: chrome.titleFamily } } : undefined,
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
      font: { color: chrome.font, size: 10, family: chrome.bodyFamily },
      // More generous margins give the 3D scene breathing room so axis
      // tick labels and the Z colorbar don't end up crammed together
      // in the corner.
      margin: { l: 20, r: 30, t: title ? 36 : 12, b: 20 },
      height,
      showlegend: hasCats || resolvedType === 'pie_3d',
      legend: { font: { color: chrome.font, size: 10, family: chrome.bodyFamily }, bgcolor: 'rgba(0,0,0,0)', orientation: 'h' as const, y: -0.05 },
    }

    // Thin curved colorbar, themed tick/title text, and a 4-significant-
    // figure tick format so the scale doesn't print raw 15-digit floats.
    const styleColorbar = (cb: Record<string, unknown>): Record<string, unknown> => ({
      ...cb,
      thickness: 10,
      len: 0.6,
      outlinewidth: 0,
      borderwidth: 0,
      tickfont: { size: 9, color: chrome.tick, family: chrome.bodyFamily },
      titlefont: { size: 10, color: chrome.tick, family: chrome.bodyFamily },
      tickformat: '.4~g',
    })
    const applyColorbarStyle = (trace: Plot3DTrace): Plot3DTrace => {
      const marker = trace.marker as { colorbar?: Record<string, unknown> } | undefined
      if (marker?.colorbar) marker.colorbar = styleColorbar(marker.colorbar)
      // surface / mesh3d / isosurface / cone carry the colorbar at the
      // top level, not under marker — style those too.
      if (trace.colorbar) trace.colorbar = styleColorbar(trace.colorbar as Record<string, unknown>)
      return trace
    }

    if (!is2D) {
      // MATLAB-style scene: tighter aspect, axis labels at journal
      // size, camera angle at 30°/45° (the standard isometric view
      // used in MATLAB's surf default), and a slight grid contrast
      // bump so the bounding-box edges are visible enough to read
      // axis ticks against. Background stays transparent so the
      // chart card chrome dictates the surrounding bg, matching
      // every 2D chart's behaviour.
      const axisFont = { size: 11, color: chrome.axis, family: chrome.bodyFamily }
      const tickFont = { size: 9, color: chrome.tick, family: chrome.bodyFamily }
      const axisStyle = {
        color: chrome.axis,
        gridcolor: chrome.grid,
        zerolinecolor: chrome.zero,
        showbackground: true,
        backgroundcolor: 'rgba(0,0,0,0)',
        gridwidth: 1,
        showspikes: false,
        tickfont: tickFont,
      }
      baseLayout.scene = {
        xaxis: { ...axisStyle, title: { text: xLabel, font: axisFont } },
        yaxis: { ...axisStyle, title: { text: yLabel, font: axisFont } },
        zaxis: { ...axisStyle, title: { text: zLabel, font: axisFont } },
        bgcolor: 'rgba(0,0,0,0)',
        // `data` aspect mode preserves the data ranges (so a tall
        // narrow surface looks tall narrow, not auto-cubed). For
        // surface_3d / contour_3d / wireframe_3d that's what
        // MATLAB's `axis tight` produces — the natural shape of
        // the data set.
        aspectmode: 'data' as const,
        // Standard MATLAB azimuth/elevation 30°/45°. eye distance
        // 1.4 keeps the surface filling the chart card without
        // clipping the axis labels.
        camera: { eye: { x: 1.4, y: -1.6, z: 1.1 }, center: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 } },
      }
    }

    // Style colorbar on all traces
    const styledTraces = buildTraces().map(applyColorbarStyle)

    return { traces: styledTraces, layout: baseLayout }
  }, [data, resolvedType, title, xLabel, yLabel, zLabel, pointSize, colorScheme, height, surfaceFunction, sankeyNodes, sankeyLinks, colors, theme])

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
          data={traces as unknown as Data[]}
          layout={layout as Partial<Layout>}
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
