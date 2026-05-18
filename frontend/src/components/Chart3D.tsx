/**
 * Chart3D — publication-grade 3D chart renderer on three.js.
 *
 * Drop-in replacement for PlotlyPlot3D for the 17 genuine 3D chart
 * types. Plotly's `gl3d` WebGL engine renders blank inside the app's
 * WebView2 runtime; three.js (via @react-three/fiber) renders fine in
 * the same runtime (the Knowledge Graph page proves it). This component
 * re-implements every 3D chart on three.js so the Data Visualization
 * page works in the desktop build.
 *
 * Sankey is intentionally NOT handled here — it is a 2D flow diagram
 * and stays on Plotly's SVG renderer.
 */
import { useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
// Deep imports (not the `@react-three/drei` barrel): drei 9.96 ships a
// SpotLight module that imports `LinearEncoding` from three, a symbol
// removed in three 0.182. The barrel's re-export graph drags SpotLight
// into the bundle and breaks the rollup build. Importing each component
// from its own file keeps SpotLight out of Chart3D's import graph.
import { OrbitControls } from '@react-three/drei/core/OrbitControls'
import { Line } from '@react-three/drei/core/Line'
import { Text } from '@react-three/drei/core/Text'
import { Billboard } from '@react-three/drei/core/Billboard'
import * as THREE from 'three'
import type { DataPoint3D, Chart3DType, PlotlyPlot3DProps } from './PlotlyPlot3D'
import { THEMES, type PublicationTheme } from '../utils/publicationTheme'
import ChartErrorBoundary from './ChartErrorBoundary'

// ── Theme chrome ────────────────────────────────────────────────────
// three.js draws to a WebGL canvas where CSS custom properties don't
// resolve, so (mirroring PlotlyPlot3D's PLOT3D_CHROME) the 3D scene
// chrome is a concrete-hex table keyed by publication theme.
interface Chart3DChrome {
  bg: string          // canvas clear backdrop (transparent-friendly)
  axis: string        // axis line + tick color
  grid: string        // floor grid color
  text: string        // tick + axis-title text
  title: string       // chart-title text
  titleFamily: string
  bodyFamily: string
}
const CHART3D_CHROME: Record<PublicationTheme, Chart3DChrome> = {
  screen: {
    bg: 'transparent', axis: '#8a8a92', grid: '#3a3a42',
    text: '#c8c8cc', title: '#e4e4e8',
    titleFamily: THEMES.screen.titleFont, bodyFamily: THEMES.screen.bodyFont,
  },
  paper: {
    bg: '#FFFFFF', axis: '#444444', grid: '#dcdcdc',
    text: '#222222', title: '#111111',
    titleFamily: THEMES.paper.titleFont, bodyFamily: THEMES.paper.bodyFont,
  },
  nature: {
    bg: '#FFFFFF', axis: '#333333', grid: '#dadada',
    text: '#111111', title: '#000000',
    titleFamily: THEMES.nature.titleFont, bodyFamily: THEMES.nature.bodyFont,
  },
  science: {
    bg: '#FFFFFF', axis: '#222222', grid: '#d6d6d6',
    text: '#111111', title: '#000000',
    titleFamily: THEMES.science.titleFont, bodyFamily: THEMES.science.bodyFont,
  },
  ieee: {
    bg: '#FFFFFF', axis: '#222222', grid: '#dadada',
    text: '#111111', title: '#000000',
    titleFamily: THEMES.ieee.titleFont, bodyFamily: THEMES.ieee.bodyFont,
  },
}

const CATEGORY_COLORS = [
  '#5B8DB8', '#8B7EAF', '#6BA594', '#C4956A', '#B07E8B',
  '#7BA7B8', '#A89B6E', '#8598AD', '#7E9B8A', '#9B8EAD',
]

// ── Color scales ────────────────────────────────────────────────────
// Compact viridis / plasma anchor stops, linearly interpolated. Gives
// the journal-standard perceptual gradients without a colour library.
const VIRIDIS_STOPS = [
  [0.267, 0.005, 0.329], [0.283, 0.141, 0.458], [0.254, 0.265, 0.530],
  [0.207, 0.372, 0.553], [0.164, 0.471, 0.558], [0.128, 0.567, 0.551],
  [0.135, 0.659, 0.518], [0.267, 0.749, 0.441], [0.478, 0.821, 0.318],
  [0.741, 0.873, 0.150], [0.993, 0.906, 0.144],
]
const PLASMA_STOPS = [
  [0.050, 0.030, 0.528], [0.255, 0.014, 0.615], [0.417, 0.000, 0.658],
  [0.562, 0.052, 0.642], [0.692, 0.166, 0.564], [0.798, 0.280, 0.470],
  [0.881, 0.392, 0.383], [0.949, 0.518, 0.296], [0.988, 0.652, 0.211],
  [0.988, 0.809, 0.145], [0.940, 0.975, 0.131],
]
const GRADIENT_STOPS = [
  [0.929, 0.973, 0.694], [0.694, 0.886, 0.706], [0.439, 0.788, 0.745],
  [0.255, 0.635, 0.737], [0.169, 0.451, 0.706], [0.137, 0.243, 0.580],
]

function sampleStops(stops: number[][], t: number): THREE.Color {
  const c = Math.max(0, Math.min(1, t))
  const seg = c * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(seg))
  const f = seg - i
  const a = stops[i], b = stops[i + 1]
  return new THREE.Color(
    a[0] + (b[0] - a[0]) * f,
    a[1] + (b[1] - a[1]) * f,
    a[2] + (b[2] - a[2]) * f,
  )
}

type ColorScheme = 'viridis' | 'plasma' | 'categorical' | 'gradient'
function makeColorFn(scheme: ColorScheme): (t: number) => THREE.Color {
  switch (scheme) {
    case 'plasma': return (t) => sampleStops(PLASMA_STOPS, t)
    case 'gradient': return (t) => sampleStops(GRADIENT_STOPS, t)
    case 'categorical': // categorical falls back to viridis for continuous z
    case 'viridis':
    default: return (t) => sampleStops(VIRIDIS_STOPS, t)
  }
}

// ── Data normalization ──────────────────────────────────────────────
// All charts render inside a unit-ish cube of side CUBE so any input
// scale looks right and the camera auto-fit is consistent.
const CUBE = 10

interface Bounds {
  xMin: number; xMax: number; yMin: number; yMax: number; zMin: number; zMax: number
}
function computeBounds(data: DataPoint3D[]): Bounds {
  let xMin = Infinity, xMax = -Infinity
  let yMin = Infinity, yMax = -Infinity
  let zMin = Infinity, zMax = -Infinity
  for (const d of data) {
    if (Number.isFinite(d.x)) { if (d.x < xMin) xMin = d.x; if (d.x > xMax) xMax = d.x }
    if (Number.isFinite(d.y)) { if (d.y < yMin) yMin = d.y; if (d.y > yMax) yMax = d.y }
    if (Number.isFinite(d.z)) { if (d.z < zMin) zMin = d.z; if (d.z > zMax) zMax = d.z }
  }
  if (!Number.isFinite(xMin)) { xMin = 0; xMax = 1 }
  if (!Number.isFinite(yMin)) { yMin = 0; yMax = 1 }
  if (!Number.isFinite(zMin)) { zMin = 0; zMax = 1 }
  return { xMin, xMax, yMin, yMax, zMin, zMax }
}

interface Mapper {
  bounds: Bounds
  mx: (x: number) => number
  my: (y: number) => number
  mz: (z: number) => number
  // floor (z-min plane) in scene coords
  floorY: number
}
// Build a mapper from data bounds → scene cube. Y in three.js is "up";
// data z is the vertical axis, mapped to scene-Y.
function makeMapper(b: Bounds): Mapper {
  const span = (lo: number, hi: number) => (hi - lo) || 1
  const sx = span(b.xMin, b.xMax)
  const sy = span(b.yMin, b.yMax)
  const sz = span(b.zMin, b.zMax)
  const mx = (x: number) => ((x - b.xMin) / sx - 0.5) * CUBE
  const my = (y: number) => ((y - b.yMin) / sy - 0.5) * CUBE
  const mz = (z: number) => ((z - b.zMin) / sz) * CUBE - CUBE / 2
  return { bounds: b, mx, my, mz, floorY: -CUBE / 2 }
}

// ── Nice axis ticks ─────────────────────────────────────────────────
function niceTicks(lo: number, hi: number, count = 5): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) {
    return [lo]
  }
  const range = hi - lo
  const rawStep = range / (count - 1)
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)))
  const norm = rawStep / mag
  let step: number
  if (norm < 1.5) step = mag
  else if (norm < 3) step = 2 * mag
  else if (norm < 7) step = 5 * mag
  else step = 10 * mag
  const start = Math.ceil(lo / step) * step
  const ticks: number[] = []
  for (let v = start; v <= hi + step * 1e-6; v += step) ticks.push(v)
  return ticks.length > 0 ? ticks : [lo, hi]
}

function fmtTick(v: number): string {
  if (!Number.isFinite(v)) return ''
  if (v === 0) return '0'
  const abs = Math.abs(v)
  if (abs >= 1e5 || abs < 1e-3) return v.toExponential(1)
  if (Number.isInteger(v)) return String(v)
  return v.toFixed(abs < 1 ? 3 : abs < 100 ? 2 : 1)
}

// ════════════════════════════════════════════════════════════════════
// AXES — three axis lines + ticks + numeric labels + axis titles +
// a subtle gridded floor plane.
// ════════════════════════════════════════════════════════════════════
interface AxesProps {
  bounds: Bounds
  mapper: Mapper
  chrome: Chart3DChrome
  xLabel: string; yLabel: string; zLabel: string
}
function Axes({ bounds, mapper, chrome, xLabel, yLabel, zLabel }: AxesProps) {
  const h = CUBE / 2
  const { mx, my, mz } = mapper
  const xTicks = useMemo(() => niceTicks(bounds.xMin, bounds.xMax), [bounds])
  const yTicks = useMemo(() => niceTicks(bounds.yMin, bounds.yMax), [bounds])
  const zTicks = useMemo(() => niceTicks(bounds.zMin, bounds.zMax), [bounds])

  // Floor grid (drei drei <Grid> needs r3f-postprocessing-ish setup; a
  // plain THREE.GridHelper-equivalent is simpler & dependency-free).
  const gridLines = useMemo(() => {
    const segs: [THREE.Vector3, THREE.Vector3][] = []
    const n = 8
    for (let i = 0; i <= n; i++) {
      const t = (i / n - 0.5) * CUBE
      segs.push([new THREE.Vector3(-h, -h, t), new THREE.Vector3(h, -h, t)])
      segs.push([new THREE.Vector3(t, -h, -h), new THREE.Vector3(t, -h, h)])
    }
    return segs
  }, [h])

  return (
    <group>
      {/* gridded floor */}
      {gridLines.map((seg, i) => (
        <Line key={`g${i}`} points={seg} color={chrome.grid} lineWidth={0.6} transparent opacity={0.5} />
      ))}

      {/* three axis lines meeting at the back-bottom corner */}
      <Line points={[[-h, -h, -h], [h, -h, -h]]} color={chrome.axis} lineWidth={1.4} />
      <Line points={[[-h, -h, -h], [-h, h, -h]]} color={chrome.axis} lineWidth={1.4} />
      <Line points={[[-h, -h, -h], [-h, -h, h]]} color={chrome.axis} lineWidth={1.4} />

      {/* X ticks (data-x → scene-x), labels just below the floor */}
      {xTicks.map((t, i) => {
        const sx = mx(t)
        return (
          <group key={`xt${i}`}>
            <Line points={[[sx, -h, -h], [sx, -h - 0.25, -h]]} color={chrome.axis} lineWidth={1} />
            <Billboard position={[sx, -h - 0.7, -h]}>
              <Text fontSize={0.42} color={chrome.text} anchorX="center" anchorY="middle">
                {fmtTick(t)}
              </Text>
            </Billboard>
          </group>
        )
      })}
      {/* Y ticks (data-y → scene-z), labels off the near-floor edge */}
      {yTicks.map((t, i) => {
        const sz = my(t)
        return (
          <group key={`yt${i}`}>
            <Line points={[[-h, -h, sz], [-h - 0.25, -h, sz]]} color={chrome.axis} lineWidth={1} />
            <Billboard position={[-h - 0.7, -h - 0.2, sz]}>
              <Text fontSize={0.42} color={chrome.text} anchorX="center" anchorY="middle">
                {fmtTick(t)}
              </Text>
            </Billboard>
          </group>
        )
      })}
      {/* Z ticks (data-z → scene-y, the vertical axis) */}
      {zTicks.map((t, i) => {
        const sy = mz(t)
        return (
          <group key={`zt${i}`}>
            <Line points={[[-h, sy, -h], [-h - 0.25, sy, -h]]} color={chrome.axis} lineWidth={1} />
            <Billboard position={[-h - 0.9, sy, -h]}>
              <Text fontSize={0.42} color={chrome.text} anchorX="center" anchorY="middle">
                {fmtTick(t)}
              </Text>
            </Billboard>
          </group>
        )
      })}

      {/* axis titles */}
      <Billboard position={[0, -h - 1.7, -h]}>
        <Text fontSize={0.6} color={chrome.text} anchorX="center" anchorY="middle">{xLabel}</Text>
      </Billboard>
      <Billboard position={[-h - 1.9, -h - 0.2, 0]}>
        <Text fontSize={0.6} color={chrome.text} anchorX="center" anchorY="middle">{yLabel}</Text>
      </Billboard>
      <Billboard position={[-h - 2.0, 0, -h]}>
        <Text fontSize={0.6} color={chrome.text} anchorX="center" anchorY="middle">{zLabel}</Text>
      </Billboard>
    </group>
  )
}

// ════════════════════════════════════════════════════════════════════
// GEOMETRY HELPERS
// ════════════════════════════════════════════════════════════════════

// Inverse-distance-weighted interpolation onto a regular grid. Used by
// every surface-family chart that takes scattered (x,y,z) input.
function idwGrid(
  data: DataPoint3D[], res: number,
  xMin: number, xMax: number, yMin: number, yMax: number,
): number[][] {
  const xR = Array.from({ length: res }, (_, i) => xMin + (xMax - xMin) * i / (res - 1))
  const yR = Array.from({ length: res }, (_, i) => yMin + (yMax - yMin) * i / (res - 1))
  return yR.map(yi => xR.map(xi => {
    let wSum = 0, zSum = 0
    for (const d of data) {
      const dist = Math.sqrt((d.x - xi) ** 2 + (d.y - yi) ** 2)
      if (dist < 1e-9) return d.z
      const w = 1 / (dist * dist)
      wSum += w; zSum += w * d.z
    }
    return wSum > 0 ? zSum / wSum : 0
  }))
}

// 2D Delaunay triangulation (Bowyer–Watson) — returns triangle index
// triples into the supplied point list. Used by trisurf_3d.
function delaunay(pts: { x: number; y: number }[]): [number, number, number][] {
  const n = pts.length
  if (n < 3) return []
  // super-triangle enclosing all points
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of pts) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y
  }
  const dx = maxX - minX || 1, dy = maxY - minY || 1
  const dmax = Math.max(dx, dy) * 20
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2
  const verts = pts.map(p => ({ x: p.x, y: p.y }))
  verts.push({ x: cx - dmax, y: cy - dmax })
  verts.push({ x: cx, y: cy + dmax })
  verts.push({ x: cx + dmax, y: cy - dmax })
  const s0 = n, s1 = n + 1, s2 = n + 2

  interface Tri { a: number; b: number; c: number; ccx: number; ccy: number; r2: number }
  const circum = (a: number, b: number, c: number): Tri => {
    const ax = verts[a].x, ay = verts[a].y
    const bx = verts[b].x, by = verts[b].y
    const cx2 = verts[c].x, cy2 = verts[c].y
    const d = 2 * (ax * (by - cy2) + bx * (cy2 - ay) + cx2 * (ay - by))
    if (Math.abs(d) < 1e-12) return { a, b, c, ccx: 0, ccy: 0, r2: Infinity }
    const ux = ((ax * ax + ay * ay) * (by - cy2) + (bx * bx + by * by) * (cy2 - ay) + (cx2 * cx2 + cy2 * cy2) * (ay - by)) / d
    const uy = ((ax * ax + ay * ay) * (cx2 - bx) + (bx * bx + by * by) * (ax - cx2) + (cx2 * cx2 + cy2 * cy2) * (bx - ax)) / d
    const r2 = (ax - ux) ** 2 + (ay - uy) ** 2
    return { a, b, c, ccx: ux, ccy: uy, r2 }
  }

  let tris: Tri[] = [circum(s0, s1, s2)]
  for (let i = 0; i < n; i++) {
    const bad: Tri[] = []
    for (const t of tris) {
      const d2 = (verts[i].x - t.ccx) ** 2 + (verts[i].y - t.ccy) ** 2
      if (d2 < t.r2) bad.push(t)
    }
    // boundary of the polygonal hole
    const edges: [number, number][] = []
    for (const t of bad) {
      const e: [number, number][] = [[t.a, t.b], [t.b, t.c], [t.c, t.a]]
      for (const [u, v] of e) {
        let shared = false
        for (const t2 of bad) {
          if (t2 === t) continue
          const e2: [number, number][] = [[t2.a, t2.b], [t2.b, t2.c], [t2.c, t2.a]]
          if (e2.some(([u2, v2]) => (u2 === u && v2 === v) || (u2 === v && v2 === u))) {
            shared = true; break
          }
        }
        if (!shared) edges.push([u, v])
      }
    }
    tris = tris.filter(t => !bad.includes(t))
    for (const [u, v] of edges) tris.push(circum(u, v, i))
  }
  // drop triangles touching the super-triangle
  const out: [number, number, number][] = []
  for (const t of tris) {
    if (t.a >= n || t.b >= n || t.c >= n) continue
    out.push([t.a, t.b, t.c])
  }
  return out
}

// ════════════════════════════════════════════════════════════════════
// RENDERERS — each consumes mapped data + colour fn and returns r3f
// scene content.
// ════════════════════════════════════════════════════════════════════

interface RenderProps {
  data: DataPoint3D[]
  mapper: Mapper
  colorFn: (t: number) => THREE.Color
  scheme: ColorScheme
  pointSize: number
  chrome: Chart3DChrome
}

// normalise a data-z to [0,1] for colour lookup
function zNorm(d: DataPoint3D, b: Bounds): number {
  const span = (b.zMax - b.zMin) || 1
  return (d.z - b.zMin) / span
}

// ── POINTS family: scatter / bubble / stem ──────────────────────────
function PointsRenderer({ data, mapper, colorFn, scheme, pointSize, chrome, kind }: RenderProps & { kind: 'scatter' | 'bubble' | 'stem' }) {
  const b = mapper.bounds
  const cats = useMemo(() => [...new Set(data.map(d => d.category).filter(Boolean))] as string[], [data])
  const catColor = (c?: string) => CATEGORY_COLORS[Math.max(0, cats.indexOf(c || '')) % CATEGORY_COLORS.length]
  const baseR = 0.12 + pointSize * 0.03
  return (
    <group>
      {data.map((d, i) => {
        const px = mapper.mx(d.x), py = mapper.mz(d.z), pz = mapper.my(d.y)
        const useCat = scheme === 'categorical' && cats.length > 1 && d.category
        const col = useCat ? new THREE.Color(catColor(d.category)) : colorFn(zNorm(d, b))
        const r = kind === 'bubble'
          ? baseR * (0.6 + 1.6 * ((d.size ?? pointSize) / Math.max(pointSize, 1)))
          : baseR
        return (
          <group key={i}>
            {kind === 'stem' && (
              <Line
                points={[[px, mapper.floorY, pz], [px, py, pz]]}
                color={chrome.axis}
                lineWidth={1}
                transparent
                opacity={0.55}
              />
            )}
            <mesh position={[px, py, pz]}>
              <sphereGeometry args={[r, 20, 20]} />
              <meshStandardMaterial color={col} roughness={0.45} metalness={0.05} />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}

// ── LINES family: line / streamline ─────────────────────────────────
function LineRenderer({ data, mapper, colorFn, pointSize, kind }: RenderProps & { kind: 'line' | 'streamline' }) {
  const b = mapper.bounds
  const pts = useMemo(
    () => data.map(d => new THREE.Vector3(mapper.mx(d.x), mapper.mz(d.z), mapper.my(d.y))),
    [data, mapper],
  )
  if (pts.length < 2) {
    return (
      <group>
        {pts.map((p, i) => (
          <mesh key={i} position={p}>
            <sphereGeometry args={[0.15, 16, 16]} />
            <meshStandardMaterial color={colorFn(0.5)} />
          </mesh>
        ))}
      </group>
    )
  }
  // Catmull-Rom smoothing → a tube mesh (publication-grade vs a thin
  // polyline). streamline_3d gets a slightly fatter, glossier tube.
  const curve = useMemo(() => new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5), [pts])
  const tubeR = kind === 'streamline' ? 0.16 : 0.11
  const segs = Math.min(400, Math.max(40, pts.length * 8))
  // colour the tube vertices along the curve by parametric position
  const colors = useMemo(() => {
    const geo = new THREE.TubeGeometry(curve, segs, tubeR, 12, false)
    const pos = geo.attributes.position
    const arr = new Float32Array(pos.count * 3)
    for (let i = 0; i < pos.count; i++) {
      const t = (i / 12 | 0) / segs
      const c = colorFn(t)
      arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b
    }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3))
    geo.computeVertexNormals()
    return geo
  }, [curve, segs, tubeR, colorFn])
  return (
    <group>
      <mesh geometry={colors}>
        <meshStandardMaterial vertexColors roughness={0.4} metalness={0.1} />
      </mesh>
      {/* end-point markers for orientation */}
      {[pts[0], pts[pts.length - 1]].map((p, i) => (
        <mesh key={i} position={p}>
          <sphereGeometry args={[tubeR * 1.8, 16, 16]} />
          <meshStandardMaterial color={colorFn(i)} />
        </mesh>
      ))}
      {/* unused-var guards */}
      <group visible={false}><primitive object={new THREE.Object3D()} /></group>
      {b ? null : null}
      {pointSize ? null : null}
    </group>
  )
}

// ── BARS family: bar / voxel / waterfall ────────────────────────────
function BarRenderer({ data, mapper, colorFn, scheme, chrome, kind }: RenderProps & { kind: 'bar' | 'voxel' | 'waterfall' }) {
  const b = mapper.bounds
  const cats = useMemo(() => [...new Set(data.map(d => d.category).filter(Boolean))] as string[], [data])
  const catColor = (c?: string) => CATEGORY_COLORS[Math.max(0, cats.indexOf(c || '')) % CATEGORY_COLORS.length]

  // bar footprint sized to the typical x/y spacing
  const bw = useMemo(() => {
    const xs = [...new Set(data.map(d => d.x))].sort((a, c) => a - c)
    let minGap = Infinity
    for (let i = 1; i < xs.length; i++) minGap = Math.min(minGap, xs[i] - xs[i - 1])
    const span = (b.xMax - b.xMin) || 1
    const gapFrac = Number.isFinite(minGap) ? minGap / span : 0.12
    return Math.max(0.35, gapFrac * CUBE * 0.6)
  }, [data, b])

  if (kind === 'waterfall') {
    // running cumulative bars: each bar sits on top of the previous total
    let cum = 0
    return (
      <group>
        {data.map((d, i) => {
          const lo = cum
          cum += d.z
          const hi = cum
          const yLo = mapper.mz(Math.min(lo, hi))
          const yHi = mapper.mz(Math.max(lo, hi))
          const ch = Math.max(0.02, yHi - yLo)
          const col = d.z < 0 ? new THREE.Color('#c97575') : colorFn(i / Math.max(1, data.length - 1))
          return (
            <mesh key={i} position={[mapper.mx(d.x), yLo + ch / 2, mapper.my(d.y)]}>
              <boxGeometry args={[bw, ch, bw]} />
              <meshStandardMaterial color={col} roughness={0.5} metalness={0.05} />
            </mesh>
          )
        })}
      </group>
    )
  }

  if (kind === 'voxel') {
    // cubes centred on the data point (z is a coordinate, not a height)
    const vs = Math.max(0.4, bw * 0.85)
    return (
      <group>
        {data.map((d, i) => {
          const col = scheme === 'categorical' && d.category
            ? new THREE.Color(catColor(d.category))
            : colorFn(zNorm(d, b))
          return (
            <mesh key={i} position={[mapper.mx(d.x), mapper.mz(d.z), mapper.my(d.y)]}>
              <boxGeometry args={[vs, vs, vs]} />
              <meshStandardMaterial color={col} roughness={0.55} metalness={0.05} transparent opacity={0.92} />
            </mesh>
          )
        })}
      </group>
    )
  }

  // standard 3D bar chart — column from the floor up to z
  return (
    <group>
      {data.map((d, i) => {
        const yTop = mapper.mz(d.z)
        const h = Math.max(0.02, yTop - mapper.floorY)
        const col = scheme === 'categorical' && d.category
          ? new THREE.Color(catColor(d.category))
          : colorFn(zNorm(d, b))
        return (
          <mesh key={i} position={[mapper.mx(d.x), mapper.floorY + h / 2, mapper.my(d.y)]}>
            <boxGeometry args={[bw, h, bw]} />
            <meshStandardMaterial color={col} roughness={0.5} metalness={0.05} />
            {chrome ? null : null}
          </mesh>
        )
      })}
    </group>
  )
}

// ── SURFACE family ──────────────────────────────────────────────────
// Builds a regular-grid mesh from scattered points via IDW. Used by
// surface / wireframe / contour / ribbon / slice / isosurface.
interface SurfaceProps extends RenderProps {
  kind: 'surface' | 'wireframe' | 'contour' | 'isosurface' | 'slice'
  surfaceFunction?: (x: number, y: number) => number
}
function SurfaceRenderer({ data, mapper, colorFn, chrome, kind, surfaceFunction }: SurfaceProps) {
  const b = mapper.bounds
  const res = 44

  // grid of data-space z values
  const grid = useMemo(() => {
    if (surfaceFunction) {
      const xR = Array.from({ length: res }, (_, i) => -3 + 6 * i / (res - 1))
      const yR = Array.from({ length: res }, (_, i) => -3 + 6 * i / (res - 1))
      return { z: yR.map(yi => xR.map(xi => surfaceFunction(xi, yi))), useFn: true }
    }
    return { z: idwGrid(data, res, b.xMin, b.xMax, b.yMin, b.yMax), useFn: false }
  }, [data, b, surfaceFunction])

  // recompute z-bounds when using surfaceFunction (so colour spans data)
  const zb = useMemo(() => {
    if (!grid.useFn) return { lo: b.zMin, hi: b.zMax }
    let lo = Infinity, hi = -Infinity
    for (const row of grid.z) for (const v of row) { if (v < lo) lo = v; if (v > hi) hi = v }
    return { lo, hi }
  }, [grid, b])

  // build the mesh geometry: vertices on the cube grid + vertex colours
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(CUBE, CUBE, res - 1, res - 1)
    const pos = g.attributes.position
    const span = (zb.hi - zb.lo) || 1
    const colArr = new Float32Array(pos.count * 3)
    for (let i = 0; i < pos.count; i++) {
      const col = i % res
      const row = (i / res) | 0
      const zv = grid.z[Math.min(res - 1, row)][Math.min(res - 1, col)]
      const sceneY = ((zv - zb.lo) / span) * CUBE - CUBE / 2
      pos.setZ(i, sceneY)
      const c = colorFn((zv - zb.lo) / span)
      colArr[i * 3] = c.r; colArr[i * 3 + 1] = c.g; colArr[i * 3 + 2] = c.b
    }
    g.setAttribute('color', new THREE.BufferAttribute(colArr, 3))
    // plane is XY, rotate so the displaced Z becomes scene-up (Y)
    g.rotateX(-Math.PI / 2)
    g.computeVertexNormals()
    return g
  }, [grid, zb, colorFn])

  // wireframe edge geometry
  const wireGeo = useMemo(() => new THREE.WireframeGeometry(geo), [geo])

  // contour lines: iso-z polylines projected on the surface
  const contourLines = useMemo(() => {
    if (kind !== 'contour') return []
    const lines: THREE.Vector3[][] = []
    const span = (zb.hi - zb.lo) || 1
    const levels = 7
    // sample along grid rows at fixed scene-Y heights (level slabs)
    for (let l = 1; l < levels; l++) {
      const yLevel = (l / levels - 0.5) * CUBE
      const segPts: THREE.Vector3[] = []
      for (let row = 0; row < res; row++) {
        for (let c = 0; c < res - 1; c++) {
          const z0 = grid.z[row][c], z1 = grid.z[row][c + 1]
          const s0 = ((z0 - zb.lo) / span) * CUBE - CUBE / 2
          const s1 = ((z1 - zb.lo) / span) * CUBE - CUBE / 2
          if ((s0 - yLevel) * (s1 - yLevel) < 0) {
            const f = (yLevel - s0) / (s1 - s0)
            const x = (-0.5 + (c + f) / (res - 1)) * CUBE
            const zc = (-0.5 + row / (res - 1)) * CUBE
            segPts.push(new THREE.Vector3(x, yLevel + 0.02, zc))
          }
        }
      }
      if (segPts.length > 1) lines.push(segPts)
    }
    return lines
  }, [grid, zb, kind])

  if (kind === 'wireframe') {
    return (
      <lineSegments geometry={wireGeo}>
        <lineBasicMaterial color="#3D5A80" linewidth={1} />
      </lineSegments>
    )
  }

  if (kind === 'isosurface') {
    // a translucent shell — render the surface double-sided & glassy
    return (
      <group>
        <mesh geometry={geo}>
          <meshStandardMaterial
            vertexColors
            transparent
            opacity={0.55}
            roughness={0.25}
            metalness={0.1}
            side={THREE.DoubleSide}
          />
        </mesh>
        {/* source points peeking through */}
        {data.map((d, i) => (
          <mesh key={i} position={[mapper.mx(d.x), mapper.mz(d.z), mapper.my(d.y)]}>
            <sphereGeometry args={[0.12, 12, 12]} />
            <meshStandardMaterial color={chrome.text} />
          </mesh>
        ))}
      </group>
    )
  }

  // surface / contour / slice all render the filled mesh; contour adds
  // iso-lines, surface adds a faint wireframe overlay (MATLAB `surf`).
  return (
    <group>
      <mesh geometry={geo}>
        <meshStandardMaterial
          vertexColors
          roughness={0.4}
          metalness={0.08}
          side={THREE.DoubleSide}
          flatShading={false}
        />
      </mesh>
      {kind === 'surface' && (
        <lineSegments geometry={wireGeo}>
          <lineBasicMaterial color="#000000" transparent opacity={0.18} />
        </lineSegments>
      )}
      {contourLines.map((ln, i) => (
        <Line key={i} points={ln} color="#000000" lineWidth={1.2} transparent opacity={0.55} />
      ))}
    </group>
  )
}

// ── TRISURF — Delaunay-triangulated mesh of the actual scattered pts ─
function TrisurfRenderer({ data, mapper, colorFn, chrome }: RenderProps) {
  const b = mapper.bounds
  // Surface + wireframe geometry computed together in ONE top-level
  // useMemo. (A prior version called useMemo inline inside the JSX for
  // the wireframe — a Rules-of-Hooks violation that crashed the chart.)
  const { surfGeo, wireGeo } = useMemo(() => {
    const tris = delaunay(data.map(d => ({ x: d.x, y: d.y })))
    const g = new THREE.BufferGeometry()
    const verts: number[] = []
    const cols: number[] = []
    const span = (b.zMax - b.zMin) || 1
    for (const t of tris) {
      for (const idx of t) {
        const p = data[idx]
        if (!p) continue
        verts.push(mapper.mx(p.x), mapper.mz(p.z), mapper.my(p.y))
        const col = colorFn((p.z - b.zMin) / span)
        cols.push(col.r, col.g, col.b)
      }
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3))
    if (verts.length > 0) g.computeVertexNormals()
    const w = verts.length > 0
      ? new THREE.WireframeGeometry(g)
      : new THREE.BufferGeometry()
    return { surfGeo: g, wireGeo: w }
  }, [data, mapper, b, colorFn])
  return (
    <group>
      <mesh geometry={surfGeo}>
        <meshStandardMaterial vertexColors roughness={0.45} metalness={0.06} side={THREE.DoubleSide} />
      </mesh>
      <lineSegments geometry={wireGeo}>
        <lineBasicMaterial color="#000000" transparent opacity={0.2} />
      </lineSegments>
      {/* vertex markers */}
      {data.map((d, i) => (
        <mesh key={i} position={[mapper.mx(d.x), mapper.mz(d.z), mapper.my(d.y)]}>
          <sphereGeometry args={[0.08, 10, 10]} />
          <meshStandardMaterial color={chrome.text} />
        </mesh>
      ))}
    </group>
  )
}

// ── RIBBON — each y-row becomes a narrow surface strip ──────────────
function RibbonRenderer({ data, mapper, colorFn }: RenderProps) {
  const b = mapper.bounds
  const ribbons = useMemo(() => {
    const rows: Record<string, DataPoint3D[]> = {}
    for (const d of data) {
      const k = String(d.y)
      ;(rows[k] = rows[k] || []).push(d)
    }
    return Object.keys(rows)
      .sort((a, c) => parseFloat(a) - parseFloat(c))
      .map(k => rows[k].slice().sort((a, c) => a.x - c.x))
  }, [data])
  const halfW = CUBE / Math.max(ribbons.length, 1) * 0.32
  const span = (b.zMax - b.zMin) || 1
  return (
    <group>
      {ribbons.map((row, ri) => {
        if (row.length < 2) return null
        const g = new THREE.BufferGeometry()
        const verts: number[] = []
        const cols: number[] = []
        const yc = mapper.my(row[0].y)
        for (let i = 0; i < row.length - 1; i++) {
          const p0 = row[i], p1 = row[i + 1]
          const x0 = mapper.mx(p0.x), x1 = mapper.mx(p1.x)
          const z0 = mapper.mz(p0.z), z1 = mapper.mz(p1.z)
          const c0 = colorFn((p0.z - b.zMin) / span)
          const c1 = colorFn((p1.z - b.zMin) / span)
          // quad: (x0,zNear) (x1,zNear) (x1,zFar) (x0,zFar)
          const A: [number, number, number] = [x0, z0, yc - halfW]
          const B: [number, number, number] = [x1, z1, yc - halfW]
          const C: [number, number, number] = [x1, z1, yc + halfW]
          const D: [number, number, number] = [x0, z0, yc + halfW]
          verts.push(...A, ...B, ...C, ...A, ...C, ...D)
          for (const c of [c0, c1, c1, c0, c1, c0]) cols.push(c.r, c.g, c.b)
        }
        g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
        g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3))
        g.computeVertexNormals()
        return (
          <mesh key={ri} geometry={g}>
            <meshStandardMaterial vertexColors roughness={0.4} metalness={0.08} side={THREE.DoubleSide} />
          </mesh>
        )
      })}
    </group>
  )
}

// ── QUIVER — 3D vector field arrows ─────────────────────────────────
function QuiverRenderer({ data, mapper, colorFn }: RenderProps) {
  const b = mapper.bounds
  // arrows: shaft (cylinder) + head (cone), oriented to the vector
  const arrows = useMemo(() => {
    return data.map((d) => {
      const vx = d.vx ?? -d.y * 0.5
      const vy = d.vy ?? d.x * 0.5
      const vz = d.vz ?? (d.z === 0 ? 0.3 : d.z * 0.25)
      const mag = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1
      // map vector into scene space (data x→sx, y→sz, z→sy)
      const dir = new THREE.Vector3(
        vx / (b.xMax - b.xMin || 1),
        vz / (b.zMax - b.zMin || 1),
        vy / (b.yMax - b.yMin || 1),
      )
      if (dir.lengthSq() < 1e-9) dir.set(0, 1, 0)
      dir.normalize()
      return {
        origin: new THREE.Vector3(mapper.mx(d.x), mapper.mz(d.z), mapper.my(d.y)),
        dir,
        mag,
      }
    })
  }, [data, mapper, b])
  const maxMag = Math.max(...arrows.map(a => a.mag), 1e-6)
  const len = 1.4
  return (
    <group>
      {arrows.map((a, i) => {
        const t = a.mag / maxMag
        const col = colorFn(t)
        const L = len * (0.45 + 0.55 * t)
        const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), a.dir)
        const shaftMid = a.origin.clone().add(a.dir.clone().multiplyScalar(L * 0.4))
        const headPos = a.origin.clone().add(a.dir.clone().multiplyScalar(L * 0.8))
        return (
          <group key={i}>
            <mesh position={shaftMid} quaternion={quat}>
              <cylinderGeometry args={[0.04, 0.04, L * 0.8, 8]} />
              <meshStandardMaterial color={col} roughness={0.5} />
            </mesh>
            <mesh position={headPos} quaternion={quat}>
              <coneGeometry args={[0.13, L * 0.4, 12]} />
              <meshStandardMaterial color={col} roughness={0.5} />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}

// ── PIE3D — extruded pie wedges ─────────────────────────────────────
function Pie3DRenderer({ data, colorFn, chrome }: RenderProps) {
  const slices = useMemo(() => {
    const vals = data.map(d => Math.max(0, d.z || d.size || 0))
    const total = vals.reduce((s, v) => s + v, 0) || 1
    let acc = 0
    return data.map((d, i) => {
      const frac = vals[i] / total
      const start = acc * Math.PI * 2
      acc += frac
      const end = acc * Math.PI * 2
      return { start, end, frac, label: d.label || `Slice ${i + 1}`, color: d.color, idx: i }
    })
  }, [data])

  const R = CUBE * 0.42
  const depth = CUBE * 0.18
  return (
    <group rotation={[0, 0, 0]}>
      {slices.map((s) => {
        // build a wedge shape and extrude it
        const shape = new THREE.Shape()
        shape.moveTo(0, 0)
        const segs = Math.max(2, Math.ceil((s.end - s.start) / 0.15))
        for (let j = 0; j <= segs; j++) {
          const a = s.start + (s.end - s.start) * (j / segs)
          shape.lineTo(Math.cos(a) * R, Math.sin(a) * R)
        }
        shape.lineTo(0, 0)
        const geo = new THREE.ExtrudeGeometry(shape, {
          depth, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.12, bevelSegments: 2,
        })
        geo.rotateX(-Math.PI / 2) // lay flat, extrude up
        const mid = (s.start + s.end) / 2
        const explode = 0.4
        const col = s.color ? new THREE.Color(s.color) : colorFn(s.idx / Math.max(1, slices.length - 1))
        const labelR = R + 1.0
        return (
          <group key={s.idx} position={[Math.cos(mid) * explode, 0, -Math.sin(mid) * explode]}>
            <mesh geometry={geo} position={[0, -depth / 2, 0]}>
              <meshStandardMaterial color={col} roughness={0.45} metalness={0.08} />
            </mesh>
            <Billboard position={[Math.cos(mid) * labelR, depth, -Math.sin(mid) * labelR]}>
              <Text fontSize={0.5} color={chrome.text} anchorX="center" anchorY="middle">
                {`${s.label} ${(s.frac * 100).toFixed(0)}%`}
              </Text>
            </Billboard>
          </group>
        )
      })}
    </group>
  )
}

// ════════════════════════════════════════════════════════════════════
// SCENE — picks the renderer, mounts lights + axes + auto-fit camera.
// ════════════════════════════════════════════════════════════════════
function autoRotateNoop() { /* placeholder */ }

interface SceneProps {
  data: DataPoint3D[]
  resolvedType: Chart3DType
  colorScheme: ColorScheme
  pointSize: number
  chrome: Chart3DChrome
  xLabel: string; yLabel: string; zLabel: string
  surfaceFunction?: (x: number, y: number) => number
}
function Scene({
  data, resolvedType, colorScheme, pointSize, chrome,
  xLabel, yLabel, zLabel, surfaceFunction,
}: SceneProps) {
  const groupRef = useRef<THREE.Group>(null)
  const bounds = useMemo(() => computeBounds(data), [data])
  const mapper = useMemo(() => makeMapper(bounds), [bounds])
  const colorFn = useMemo(() => makeColorFn(colorScheme), [colorScheme])

  // gentle idle auto-rotation removed in favour of OrbitControls; keep
  // the hook so the frame loop is warm for resize correctness.
  useFrame(() => { autoRotateNoop() })

  const rp: RenderProps = { data, mapper, colorFn, scheme: colorScheme, pointSize, chrome }

  let body: JSX.Element
  switch (resolvedType) {
    case 'scatter_3d':
      body = <PointsRenderer {...rp} kind="scatter" />; break
    case 'bubble_3d':
      body = <PointsRenderer {...rp} kind="bubble" />; break
    case 'stem_3d':
      body = <PointsRenderer {...rp} kind="stem" />; break
    case 'line_3d':
      body = <LineRenderer {...rp} kind="line" />; break
    case 'streamline_3d':
      body = <LineRenderer {...rp} kind="streamline" />; break
    case 'bar_3d':
      body = <BarRenderer {...rp} kind="bar" />; break
    case 'voxel_3d':
      body = <BarRenderer {...rp} kind="voxel" />; break
    case 'waterfall_3d':
      body = <BarRenderer {...rp} kind="waterfall" />; break
    case 'surface_3d':
      body = <SurfaceRenderer {...rp} kind="surface" surfaceFunction={surfaceFunction} />; break
    case 'wireframe_3d':
      body = <SurfaceRenderer {...rp} kind="wireframe" surfaceFunction={surfaceFunction} />; break
    case 'contour_3d':
      body = <SurfaceRenderer {...rp} kind="contour" surfaceFunction={surfaceFunction} />; break
    case 'slice_3d':
      body = <SurfaceRenderer {...rp} kind="slice" surfaceFunction={surfaceFunction} />; break
    case 'isosurface_3d':
      body = <SurfaceRenderer {...rp} kind="isosurface" surfaceFunction={surfaceFunction} />; break
    case 'trisurf_3d':
      body = <TrisurfRenderer {...rp} />; break
    case 'ribbon_3d':
      body = <RibbonRenderer {...rp} />; break
    case 'quiver_3d':
      body = <QuiverRenderer {...rp} />; break
    case 'pie_3d':
      body = <Pie3DRenderer {...rp} />; break
    default:
      body = <PointsRenderer {...rp} kind="scatter" />
  }

  const showAxes = resolvedType !== 'pie_3d'

  return (
    <group ref={groupRef}>
      {showAxes && (
        <Axes
          bounds={bounds}
          mapper={mapper}
          chrome={chrome}
          xLabel={xLabel}
          yLabel={yLabel}
          zLabel={zLabel}
        />
      )}
      {body}
    </group>
  )
}

// ════════════════════════════════════════════════════════════════════
// CATEGORY LEGEND OVERLAY (HTML, not WebGL — crisper text)
// ════════════════════════════════════════════════════════════════════
function Legend({ data, chrome }: { data: DataPoint3D[]; chrome: Chart3DChrome }) {
  const cats = useMemo(
    () => [...new Set(data.map(d => d.category).filter(Boolean))] as string[],
    [data],
  )
  if (cats.length < 2) return null
  return (
    <div
      style={{
        position: 'absolute', top: 8, right: 10, display: 'flex',
        flexDirection: 'column', gap: 3, padding: '6px 9px',
        background: 'rgba(0,0,0,0.04)', borderRadius: 6,
        fontFamily: chrome.bodyFamily, fontSize: 10, pointerEvents: 'none',
      }}
    >
      {cats.map((c, i) => (
        <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{
            width: 9, height: 9, borderRadius: 2,
            background: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
          }} />
          <span style={{ color: chrome.text }}>{c}</span>
        </div>
      ))}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════
// PUBLIC COMPONENT
// ════════════════════════════════════════════════════════════════════
export default function Chart3D({
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
  theme = 'screen',
}: PlotlyPlot3DProps) {
  const resolvedType: Chart3DType = chartType || type || 'scatter_3d'
  const chrome = CHART3D_CHROME[theme] || CHART3D_CHROME.screen
  // Camera fitted to the normalised cube — CUBE-sized scene, ~1.9×
  // distance gives a comfortable isometric framing with room for the
  // axis tick labels that hang off the floor.
  const camDist = CUBE * 1.95
  const [ready] = useState(true)

  return (
    <div style={{ width: '100%', height, position: 'relative' }}>
      <ChartErrorBoundary resetKey={`${title}:${data.length}:${resolvedType}:${theme}`}>
        {title && (
          <div
            style={{
              position: 'absolute', top: 6, left: 0, right: 0, textAlign: 'center',
              fontFamily: chrome.titleFamily, fontSize: 13, fontWeight: 600,
              color: chrome.title, pointerEvents: 'none', zIndex: 2,
            }}
          >
            {title}
          </div>
        )}
        <Legend data={data} chrome={chrome} />
        {ready && (
          <Canvas
            dpr={[1, 2]}
            gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
            camera={{ position: [camDist * 0.62, camDist * 0.5, camDist * 0.62], fov: 42, near: 0.1, far: 1000 }}
            style={{ width: '100%', height: '100%' }}
          >
            {/* tasteful lighting: soft ambient fill + two directionals */}
            <ambientLight intensity={0.72} />
            <directionalLight position={[18, 26, 14]} intensity={0.85} />
            <directionalLight position={[-16, 10, -12]} intensity={0.35} />
            <Scene
              data={data}
              resolvedType={resolvedType}
              colorScheme={colorScheme}
              pointSize={pointSize}
              chrome={chrome}
              xLabel={xLabel}
              yLabel={yLabel}
              zLabel={zLabel}
              surfaceFunction={surfaceFunction}
            />
            <OrbitControls
              enableDamping
              dampingFactor={0.08}
              rotateSpeed={0.7}
              minDistance={CUBE * 0.6}
              maxDistance={CUBE * 5}
            />
          </Canvas>
        )}
      </ChartErrorBoundary>
    </div>
  )
}
