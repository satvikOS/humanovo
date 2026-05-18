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
import { Canvas, useFrame, useThree } from '@react-three/fiber'
// Deep imports (not the `@react-three/drei` barrel): drei 9.96 ships a
// SpotLight module that imports `LinearEncoding` from three, a symbol
// removed in three 0.182. The barrel's re-export graph drags SpotLight
// into the bundle and breaks the rollup build. Importing each component
// from its own file keeps SpotLight out of Chart3D's import graph.
import { OrbitControls } from '@react-three/drei/core/OrbitControls'
import * as THREE from 'three'
import type { DataPoint3D, Chart3DType, PlotlyPlot3DProps } from './PlotlyPlot3D'
import { THEMES, type PublicationTheme } from '../utils/publicationTheme'
import ChartErrorBoundary from './ChartErrorBoundary'

// ── Theme chrome ────────────────────────────────────────────────────
// three.js draws to a WebGL canvas where CSS custom properties don't
// resolve, so (mirroring PlotlyPlot3D's PLOT3D_CHROME) the 3D scene
// chrome is a concrete-hex table keyed by publication theme.
interface Chart3DChrome {
  bg: string          // canvas clear backdrop — matches the figure card
  axis: string        // axis line + tick color
  grid: string        // floor grid color
  panel: string       // back/side wall panel fill
  text: string        // tick + axis-title text
  title: string       // chart-title text
  halo: string        // contrast outline behind 3D labels
  dark: boolean       // true for the screen (dark) theme
  titleFamily: string
  bodyFamily: string
}
const CHART3D_CHROME: Record<PublicationTheme, Chart3DChrome> = {
  screen: {
    bg: '#1c1c20', axis: '#9a9aa3', grid: '#3a3a42', panel: '#26262c',
    text: '#e8e8ec', title: '#f2f2f5', halo: '#1c1c20', dark: true,
    titleFamily: THEMES.screen.titleFont, bodyFamily: THEMES.screen.bodyFont,
  },
  paper: {
    bg: '#FFFFFF', axis: '#3a3a3a', grid: '#e2e2e2', panel: '#f6f6f6',
    text: '#1a1a1a', title: '#0a0a0a', halo: '#FFFFFF', dark: false,
    titleFamily: THEMES.paper.titleFont, bodyFamily: THEMES.paper.bodyFont,
  },
  nature: {
    bg: '#FFFFFF', axis: '#2c2c2c', grid: '#e0e0e0', panel: '#f5f5f5',
    text: '#0d0d0d', title: '#000000', halo: '#FFFFFF', dark: false,
    titleFamily: THEMES.nature.titleFont, bodyFamily: THEMES.nature.bodyFont,
  },
  science: {
    bg: '#FFFFFF', axis: '#1f1f1f', grid: '#dcdcdc', panel: '#f4f4f4',
    text: '#0a0a0a', title: '#000000', halo: '#FFFFFF', dark: false,
    titleFamily: THEMES.science.titleFont, bodyFamily: THEMES.science.bodyFont,
  },
  ieee: {
    bg: '#FFFFFF', axis: '#1f1f1f', grid: '#e0e0e0', panel: '#f5f5f5',
    text: '#0a0a0a', title: '#000000', halo: '#FFFFFF', dark: false,
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
// Core-three.js polyline — replaces drei's <Line>. drei's <Line> is a
// "fat line" built on three-stdlib's Line2 / LineMaterial, which
// reference three exports removed in three 0.182 and threw at render
// time for EVERY 3D chart (the Axes draw their grid + axis lines with
// it). A plain THREE.Line has no three-stdlib dependency. WebGL core
// lines are always 1px wide — `lineWidth` is accepted for drop-in
// parity but not honoured, which is fine for axes/grid/contour lines.
function PolyLine({
  points, color, opacity = 1,
}: {
  points: ([number, number, number] | THREE.Vector3)[]
  color: string
  opacity?: number
  lineWidth?: number
  transparent?: boolean
}) {
  // Built as a concrete THREE.Line + rendered via <primitive> — the
  // lowercase <line> JSX intrinsic collides with the SVG <line> element
  // in TS, so <primitive> is the unambiguous path for THREE.Line.
  const obj = useMemo(() => {
    const arr: number[] = []
    for (const p of points) {
      if (p instanceof THREE.Vector3) arr.push(p.x, p.y, p.z)
      else arr.push(p[0], p[1], p[2])
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3))
    const m = new THREE.LineBasicMaterial({
      color, transparent: opacity < 1, opacity,
    })
    return new THREE.Line(g, m)
  }, [points, color, opacity])
  return <primitive object={obj} />
}

// Sprite-based 3D text label — replaces drei's <Text>/<Billboard>.
// drei's <Text> is troika-three-text, which sets `customDepthMaterial`
// on its mesh; three 0.182 made that a getter-only property, so every
// <Text> threw ("Cannot set property customDepthMaterial") and took
// down every 3D chart (the axes are labelled with it). A THREE.Sprite
// with a canvas texture has no troika/three-stdlib dependency and a
// sprite always faces the camera, so <Billboard> isn't needed either.
//
// The canvas is rendered at high resolution (large fontPx + a device-
// pixel multiplier) with anisotropic filtering so the text stays crisp
// at 4K. A subtle contrasting halo keeps labels legible against either
// the surface mesh or the background, whichever the label happens to
// sit over.
function Label3D({
  position, text, color, fontSize = 0.5, weight = 600, halo,
}: {
  position: [number, number, number]
  text: string | number | undefined
  color: string
  fontSize?: number
  weight?: number
  halo?: string
}) {
  const sprite = useMemo(() => {
    const txt = String(text ?? '').trim()
    if (!txt) return null
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    // High-res glyph atlas: large base size keeps the texture sharp
    // when the camera is close.
    const fontPx = 128
    const pad = Math.round(fontPx * 0.5)
    const font = `${weight} ${fontPx}px Inter, "Helvetica Neue", Arial, sans-serif`
    ctx.font = font
    const w = Math.max(1, Math.ceil(ctx.measureText(txt).width))
    canvas.width = w + pad * 2
    canvas.height = fontPx + pad
    // resizing the canvas resets the 2D context — re-apply state.
    ctx.font = font
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const cx = canvas.width / 2
    const cy = canvas.height / 2
    // contrast halo so the label reads over any backdrop
    if (halo) {
      ctx.lineJoin = 'round'
      ctx.miterLimit = 2
      ctx.strokeStyle = halo
      ctx.lineWidth = Math.round(fontPx * 0.16)
      ctx.strokeText(txt, cx, cy)
    }
    ctx.fillStyle = color
    ctx.fillText(txt, cx, cy)
    const tex = new THREE.CanvasTexture(canvas)
    tex.minFilter = THREE.LinearMipmapLinearFilter
    tex.magFilter = THREE.LinearFilter
    tex.anisotropy = 8
    tex.generateMipmaps = true
    tex.needsUpdate = true
    const mat = new THREE.SpriteMaterial({
      map: tex, transparent: true, depthTest: false, depthWrite: false,
    })
    const s = new THREE.Sprite(mat)
    s.renderOrder = 999
    const aspect = canvas.width / canvas.height
    s.scale.set(fontSize * aspect, fontSize, 1)
    return s
  }, [text, color, fontSize, weight, halo])
  if (!sprite) return null
  return <primitive object={sprite} position={position} />
}

function Axes({ bounds, mapper, chrome, xLabel, yLabel, zLabel }: AxesProps) {
  const h = CUBE / 2
  const { mx, my, mz } = mapper
  const xTicks = useMemo(() => niceTicks(bounds.xMin, bounds.xMax), [bounds])
  const yTicks = useMemo(() => niceTicks(bounds.yMin, bounds.yMax), [bounds])
  const zTicks = useMemo(() => niceTicks(bounds.zMin, bounds.zMax), [bounds])

  // Floor + back/side wall grids — a three-walled "box" framing the
  // data (the journal-standard 3D plot enclosure). Grid lines on the
  // floor and the two far walls.
  const grids = useMemo(() => {
    const n = 8
    const floor: [THREE.Vector3, THREE.Vector3][] = []
    const backWall: [THREE.Vector3, THREE.Vector3][] = []
    const sideWall: [THREE.Vector3, THREE.Vector3][] = []
    for (let i = 0; i <= n; i++) {
      const t = (i / n - 0.5) * CUBE
      floor.push([new THREE.Vector3(-h, -h, t), new THREE.Vector3(h, -h, t)])
      floor.push([new THREE.Vector3(t, -h, -h), new THREE.Vector3(t, -h, h)])
      // back wall (z = -h plane): verticals + horizontals
      backWall.push([new THREE.Vector3(t, -h, -h), new THREE.Vector3(t, h, -h)])
      backWall.push([new THREE.Vector3(-h, t, -h), new THREE.Vector3(h, t, -h)])
      // side wall (x = -h plane)
      sideWall.push([new THREE.Vector3(-h, -h, t), new THREE.Vector3(-h, h, t)])
      sideWall.push([new THREE.Vector3(-h, t, -h), new THREE.Vector3(-h, t, h)])
    }
    return { floor, backWall, sideWall }
  }, [h])

  const tickFont = 0.92
  const titleFont = 1.3

  // The default camera looks from the +X,+Y,+Z octant, so the box's
  // FRONT edges are those at +x / +z. Tick labels are placed on those
  // front-facing edges (never occluded by the box panels) and the
  // numeric scale on a front vertical edge.
  return (
    <group>
      {/* solid panels behind the grid lines so the box reads as a
          contiguous figure surface, not floating wires */}
      <mesh position={[0, -h - 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[CUBE, CUBE]} />
        <meshBasicMaterial color={chrome.panel} side={THREE.DoubleSide} transparent opacity={chrome.dark ? 0.55 : 0.85} />
      </mesh>
      <mesh position={[0, 0, -h - 0.01]}>
        <planeGeometry args={[CUBE, CUBE]} />
        <meshBasicMaterial color={chrome.panel} side={THREE.DoubleSide} transparent opacity={chrome.dark ? 0.4 : 0.7} />
      </mesh>
      <mesh position={[-h - 0.01, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[CUBE, CUBE]} />
        <meshBasicMaterial color={chrome.panel} side={THREE.DoubleSide} transparent opacity={chrome.dark ? 0.4 : 0.7} />
      </mesh>

      {/* grid lines on the three enclosure walls */}
      {grids.floor.map((seg, i) => (
        <PolyLine key={`gf${i}`} points={seg} color={chrome.grid} transparent opacity={0.9} />
      ))}
      {grids.backWall.map((seg, i) => (
        <PolyLine key={`gb${i}`} points={seg} color={chrome.grid} transparent opacity={0.6} />
      ))}
      {grids.sideWall.map((seg, i) => (
        <PolyLine key={`gs${i}`} points={seg} color={chrome.grid} transparent opacity={0.6} />
      ))}

      {/* the three labelled axis lines, drawn on the front-facing edges */}
      {/* X axis — front-bottom edge (z = +h) */}
      <PolyLine points={[[-h, -h, h], [h, -h, h]]} color={chrome.axis} />
      {/* Y axis — right-bottom edge (x = +h) */}
      <PolyLine points={[[h, -h, -h], [h, -h, h]]} color={chrome.axis} />
      {/* Z axis — front-left vertical edge (x = -h, z = +h) */}
      <PolyLine points={[[-h, -h, h], [-h, h, h]]} color={chrome.axis} />

      {/* X ticks → scene-x, on the front-bottom edge, labels below */}
      {xTicks.map((t, i) => {
        const sx = mx(t)
        return (
          <group key={`xt${i}`}>
            <PolyLine points={[[sx, -h, h], [sx, -h - 0.34, h + 0.18]]} color={chrome.axis} />
            <Label3D position={[sx, -h - 1.0, h + 0.55]} text={fmtTick(t)} color={chrome.text} fontSize={tickFont} halo={chrome.halo} />
          </group>
        )
      })}
      {/* Y ticks → scene-z, on the right-bottom edge, labels outside */}
      {yTicks.map((t, i) => {
        const sz = my(t)
        return (
          <group key={`yt${i}`}>
            <PolyLine points={[[h, -h, sz], [h + 0.34, -h - 0.34, sz]]} color={chrome.axis} />
            <Label3D position={[h + 1.2, -h - 0.95, sz]} text={fmtTick(t)} color={chrome.text} fontSize={tickFont} halo={chrome.halo} />
          </group>
        )
      })}
      {/* Z ticks → scene-y, on the front-left vertical edge */}
      {zTicks.map((t, i) => {
        const sy = mz(t)
        return (
          <group key={`zt${i}`}>
            <PolyLine points={[[-h, sy, h], [-h - 0.34, sy, h + 0.18]]} color={chrome.axis} />
            <Label3D position={[-h - 1.25, sy, h + 0.55]} text={fmtTick(t)} color={chrome.text} fontSize={tickFont} halo={chrome.halo} />
          </group>
        )
      })}

      {/* axis titles — larger, bold, set well clear of the tick labels */}
      <Label3D position={[0, -h - 2.15, h + 1.0]} text={xLabel} color={chrome.title} fontSize={titleFont} weight={700} halo={chrome.halo} />
      <Label3D position={[h + 2.7, -h - 1.0, 0]} text={yLabel} color={chrome.title} fontSize={titleFont} weight={700} halo={chrome.halo} />
      <Label3D position={[-h - 2.9, 0, h + 1.0]} text={zLabel} color={chrome.title} fontSize={titleFont} weight={700} halo={chrome.halo} />
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
  const t = (d.z - b.zMin) / span
  return Number.isFinite(t) ? t : 0
}

// Drop points with non-finite coordinates. Every renderer runs its
// data through this so NaN/Infinity never reaches a BufferAttribute or
// a mesh transform (three.js can throw on a NaN matrix).
function finitePoints(data: DataPoint3D[]): DataPoint3D[] {
  return data.filter(
    d => d && Number.isFinite(d.x) && Number.isFinite(d.y) && Number.isFinite(d.z),
  )
}

// (hi - lo) guaranteed to be a finite, non-zero, positive span.
function safeSpan(lo: number, hi: number): number {
  const s = hi - lo
  return Number.isFinite(s) && s > 0 ? s : 1
}

// ── POINTS family: scatter / bubble / stem ──────────────────────────
function PointsRenderer({ data, mapper, colorFn, scheme, pointSize, chrome, kind }: RenderProps & { kind: 'scatter' | 'bubble' | 'stem' }) {
  const b = mapper.bounds
  const pts = useMemo(() => finitePoints(data), [data])
  const cats = useMemo(() => [...new Set(pts.map(d => d.category).filter(Boolean))] as string[], [pts])
  const catColor = (c?: string) => CATEGORY_COLORS[Math.max(0, cats.indexOf(c || '')) % CATEGORY_COLORS.length]
  const safePS = Number.isFinite(pointSize) && pointSize > 0 ? pointSize : 4
  const baseR = 0.12 + safePS * 0.03
  return (
    <group>
      {pts.map((d, i) => {
        const px = mapper.mx(d.x), py = mapper.mz(d.z), pz = mapper.my(d.y)
        const useCat = scheme === 'categorical' && cats.length > 1 && d.category
        const col = useCat ? new THREE.Color(catColor(d.category)) : colorFn(zNorm(d, b))
        const rawSize = Number.isFinite(d.size as number) ? (d.size as number) : safePS
        const r = kind === 'bubble'
          ? baseR * (0.6 + 1.6 * (rawSize / Math.max(safePS, 1)))
          : baseR
        return (
          <group key={i}>
            {kind === 'stem' && (
              <PolyLine
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
    () => finitePoints(data).map(d => new THREE.Vector3(mapper.mx(d.x), mapper.mz(d.z), mapper.my(d.y))),
    [data, mapper],
  )
  const tubeR = kind === 'streamline' ? 0.16 : 0.11
  // ALL hooks run unconditionally (no early return before them) — the
  // <2-point case is handled in the returned JSX, not by skipping hooks.
  // Catmull-Rom smoothing → a tube mesh (publication-grade vs a thin
  // polyline). streamline_3d gets a slightly fatter, glossier tube.
  const colors = useMemo(() => {
    if (pts.length < 2) return null
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5)
    const segs = Math.min(400, Math.max(40, pts.length * 8))
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
  }, [pts, tubeR, colorFn])

  if (pts.length < 2 || !colors) {
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
  const pts = useMemo(() => finitePoints(data), [data])
  const cats = useMemo(() => [...new Set(pts.map(d => d.category).filter(Boolean))] as string[], [pts])
  const catColor = (c?: string) => CATEGORY_COLORS[Math.max(0, cats.indexOf(c || '')) % CATEGORY_COLORS.length]

  // bar footprint sized to the typical x/y spacing
  const bw = useMemo(() => {
    const xs = [...new Set(pts.map(d => d.x))].sort((a, c) => a - c)
    let minGap = Infinity
    for (let i = 1; i < xs.length; i++) {
      const g = xs[i] - xs[i - 1]
      if (g > 0 && g < minGap) minGap = g
    }
    const span = safeSpan(b.xMin, b.xMax)
    const gapFrac = Number.isFinite(minGap) ? minGap / span : 0.12
    const w = gapFrac * CUBE * 0.6
    return Number.isFinite(w) ? Math.max(0.35, w) : 0.35
  }, [pts, b])

  if (kind === 'waterfall') {
    // running cumulative bars: each bar sits on top of the previous total
    let cum = 0
    return (
      <group>
        {pts.map((d, i) => {
          const lo = cum
          cum += d.z
          const hi = cum
          const yLo = mapper.mz(Math.min(lo, hi))
          const yHi = mapper.mz(Math.max(lo, hi))
          const ch = Math.max(0.02, yHi - yLo)
          const col = d.z < 0 ? new THREE.Color('#c97575') : colorFn(i / Math.max(1, pts.length - 1))
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
        {pts.map((d, i) => {
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
      {pts.map((d, i) => {
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
  const pts = useMemo(() => finitePoints(data), [data])

  // grid of data-space z values. Every cell is forced finite so a NaN
  // never propagates into a BufferAttribute.
  const grid = useMemo(() => {
    const clean = (v: number) => (Number.isFinite(v) ? v : 0)
    if (surfaceFunction) {
      const xR = Array.from({ length: res }, (_, i) => -3 + 6 * i / (res - 1))
      const yR = Array.from({ length: res }, (_, i) => -3 + 6 * i / (res - 1))
      return { z: yR.map(yi => xR.map(xi => clean(surfaceFunction(xi, yi)))), useFn: true }
    }
    const raw = idwGrid(pts, res, b.xMin, b.xMax, b.yMin, b.yMax)
    return { z: raw.map(row => row.map(clean)), useFn: false }
  }, [pts, b, surfaceFunction])

  // recompute z-bounds when using surfaceFunction (so colour spans data)
  const zb = useMemo(() => {
    if (!grid.useFn) return { lo: b.zMin, hi: b.zMax }
    let lo = Infinity, hi = -Infinity
    for (const row of grid.z) for (const v of row) { if (v < lo) lo = v; if (v > hi) hi = v }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { lo: 0, hi: 1 }
    return { lo, hi }
  }, [grid, b])

  // build the mesh geometry: vertices on the cube grid + vertex colours
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(CUBE, CUBE, res - 1, res - 1)
    const pos = g.attributes.position
    const span = safeSpan(zb.lo, zb.hi)
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

  // contour iso-lines via marching-squares. Each grid cell that an iso
  // level passes through emits an INDEPENDENT 2-point segment (a prior
  // version concatenated every crossing into one polyline, producing a
  // zig-zag scribble). Segments are drawn through THREE.LineSegments so
  // they stay disjoint, giving clean MATLAB-style contour rings.
  const contourSegments = useMemo(() => {
    if (kind !== 'contour') return null
    const span = safeSpan(zb.lo, zb.hi)
    const levels = 8
    const verts: number[] = []
    // scene-Y of a data-z value
    const sy = (z: number) => ((z - zb.lo) / span) * CUBE - CUBE / 2
    // edge interpolation: where on a cell edge value `iso` crosses
    const lerp = (za: number, zb2: number, iso: number) => {
      const d = zb2 - za
      return Math.abs(d) < 1e-9 ? 0.5 : (iso - za) / d
    }
    for (let l = 1; l < levels; l++) {
      const iso = zb.lo + (l / levels) * span
      const yL = sy(iso) + 0.04
      for (let row = 0; row < res - 1; row++) {
        for (let c = 0; c < res - 1; c++) {
          const v00 = grid.z[row][c]
          const v10 = grid.z[row][c + 1]
          const v11 = grid.z[row + 1][c + 1]
          const v01 = grid.z[row + 1][c]
          // scene coords of the four cell corners
          const x0 = (-0.5 + c / (res - 1)) * CUBE
          const x1 = (-0.5 + (c + 1) / (res - 1)) * CUBE
          const z0 = (-0.5 + row / (res - 1)) * CUBE
          const z1 = (-0.5 + (row + 1) / (res - 1)) * CUBE
          // marching-squares case index
          let idx = 0
          if (v00 > iso) idx |= 1
          if (v10 > iso) idx |= 2
          if (v11 > iso) idx |= 4
          if (v01 > iso) idx |= 8
          if (idx === 0 || idx === 15) continue
          // crossing point on each of the four edges (if any)
          const eB: [number, number] = [x0 + (x1 - x0) * lerp(v00, v10, iso), z0] // bottom
          const eR: [number, number] = [x1, z0 + (z1 - z0) * lerp(v10, v11, iso)] // right
          const eT: [number, number] = [x0 + (x1 - x0) * lerp(v01, v11, iso), z1] // top
          const eL: [number, number] = [x0, z0 + (z1 - z0) * lerp(v00, v01, iso)] // left
          const push = (a: [number, number], b: [number, number]) => {
            verts.push(a[0], yL, a[1], b[0], yL, b[1])
          }
          // segment(s) for each of the 16 cases (ambiguous saddles split)
          switch (idx) {
            case 1: case 14: push(eL, eB); break
            case 2: case 13: push(eB, eR); break
            case 3: case 12: push(eL, eR); break
            case 4: case 11: push(eR, eT); break
            case 5: push(eL, eT); push(eB, eR); break
            case 6: case 9: push(eB, eT); break
            case 7: case 8: push(eL, eT); break
            case 10: push(eL, eB); push(eR, eT); break
          }
        }
      }
    }
    if (verts.length === 0) return null
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
    return g
  }, [grid, zb, kind])

  if (kind === 'wireframe') {
    return (
      <lineSegments geometry={wireGeo}>
        <lineBasicMaterial color={chrome.dark ? '#7FA8C9' : '#3D5A80'} />
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
        {pts.map((d, i) => (
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
          <lineBasicMaterial
            color={chrome.dark ? '#000000' : '#1a1a1a'}
            transparent
            opacity={chrome.dark ? 0.28 : 0.16}
          />
        </lineSegments>
      )}
      {kind === 'contour' && contourSegments && (
        <lineSegments geometry={contourSegments}>
          <lineBasicMaterial
            color={chrome.dark ? '#f0f0f0' : '#101010'}
            transparent
            opacity={chrome.dark ? 0.85 : 0.7}
          />
        </lineSegments>
      )}
    </group>
  )
}

// ── TRISURF — Delaunay-triangulated mesh of the actual scattered pts ─
function TrisurfRenderer({ data, mapper, colorFn, chrome }: RenderProps) {
  const b = mapper.bounds
  const pts = useMemo(() => finitePoints(data), [data])
  // Surface + wireframe geometry computed together in ONE top-level
  // useMemo. (A prior version called useMemo inline inside the JSX for
  // the wireframe — a Rules-of-Hooks violation that crashed the chart.)
  const { surfGeo, wireGeo } = useMemo(() => {
    const tris = delaunay(pts.map(d => ({ x: d.x, y: d.y })))
    const g = new THREE.BufferGeometry()
    const verts: number[] = []
    const cols: number[] = []
    const span = safeSpan(b.zMin, b.zMax)
    for (const t of tris) {
      for (const idx of t) {
        const p = pts[idx]
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
  }, [pts, mapper, b, colorFn])
  return (
    <group>
      <mesh geometry={surfGeo}>
        <meshStandardMaterial vertexColors roughness={0.45} metalness={0.06} side={THREE.DoubleSide} />
      </mesh>
      <lineSegments geometry={wireGeo}>
        <lineBasicMaterial
          color={chrome.dark ? '#000000' : '#1a1a1a'}
          transparent
          opacity={chrome.dark ? 0.32 : 0.2}
        />
      </lineSegments>
      {/* vertex markers */}
      {pts.map((d, i) => (
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
  // All ribbon-strip geometries are built ONCE in a top-level useMemo
  // (a prior shape created `new THREE.BufferGeometry()` inside the JSX
  // `.map()`, churning GPU buffers every render).
  const geos = useMemo(() => {
    const pts = finitePoints(data)
    const rows: Record<string, DataPoint3D[]> = {}
    for (const d of pts) {
      const k = String(d.y)
      ;(rows[k] = rows[k] || []).push(d)
    }
    const ribbons = Object.keys(rows)
      .sort((a, c) => parseFloat(a) - parseFloat(c))
      .map(k => rows[k].slice().sort((a, c) => a.x - c.x))
    const halfW = CUBE / Math.max(ribbons.length, 1) * 0.32
    const span = safeSpan(b.zMin, b.zMax)
    return ribbons.map(row => {
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
      return g
    })
  }, [data, mapper, b, colorFn])
  return (
    <group>
      {geos.map((g, ri) => g && (
        <mesh key={ri} geometry={g}>
          <meshStandardMaterial vertexColors roughness={0.4} metalness={0.08} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  )
}

// ── QUIVER — 3D vector field arrows ─────────────────────────────────
function QuiverRenderer({ data, mapper, colorFn }: RenderProps) {
  const b = mapper.bounds
  // arrows: shaft (cylinder) + head (cone), oriented to the vector
  const arrows = useMemo(() => {
    const fin = (v: number, fallback: number) => (Number.isFinite(v) ? v : fallback)
    return finitePoints(data).map((d) => {
      const vx = fin(d.vx ?? -d.y * 0.5, 0)
      const vy = fin(d.vy ?? d.x * 0.5, 0)
      const vz = fin(d.vz ?? (d.z === 0 ? 0.3 : d.z * 0.25), 0)
      const rawMag = Math.sqrt(vx * vx + vy * vy + vz * vz)
      const mag = Number.isFinite(rawMag) && rawMag > 0 ? rawMag : 1
      // map vector into scene space (data x→sx, y→sz, z→sy)
      const dir = new THREE.Vector3(
        vx / safeSpan(b.xMin, b.xMax),
        vz / safeSpan(b.zMin, b.zMax),
        vy / safeSpan(b.yMin, b.yMax),
      )
      if (!Number.isFinite(dir.lengthSq()) || dir.lengthSq() < 1e-9) dir.set(0, 1, 0)
      dir.normalize()
      return {
        origin: new THREE.Vector3(mapper.mx(d.x), mapper.mz(d.z), mapper.my(d.y)),
        dir,
        mag,
      }
    })
  }, [data, mapper, b])
  // reduce (not spread) — spreading a large array into Math.max can
  // overflow the call stack with RangeError.
  const maxMag = arrows.reduce((m, a) => Math.max(m, a.mag), 1e-6)
  // arrows scaled to be clearly legible inside the 10-unit cube
  const len = 3.2
  return (
    <group>
      {arrows.map((a, i) => {
        const t = a.mag / maxMag
        const col = colorFn(t)
        const L = len * (0.5 + 0.5 * t)
        const headLen = L * 0.34
        const shaftLen = L - headLen
        const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), a.dir)
        // arrow grows out FROM the data point along the vector
        const shaftMid = a.origin.clone().add(a.dir.clone().multiplyScalar(shaftLen * 0.5))
        const headPos = a.origin.clone().add(a.dir.clone().multiplyScalar(shaftLen + headLen * 0.5))
        return (
          <group key={i}>
            <mesh position={shaftMid} quaternion={quat}>
              <cylinderGeometry args={[0.085, 0.085, shaftLen, 12]} />
              <meshStandardMaterial color={col} roughness={0.45} metalness={0.05} />
            </mesh>
            <mesh position={headPos} quaternion={quat}>
              <coneGeometry args={[0.26, headLen, 16]} />
              <meshStandardMaterial color={col} roughness={0.45} metalness={0.05} />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}

// ── PIE3D — extruded pie wedges ─────────────────────────────────────
function Pie3DRenderer({ data, colorFn, chrome }: RenderProps) {
  const R = CUBE * 0.42
  const depth = CUBE * 0.18
  // Slice metadata AND extruded geometry are built together in ONE
  // top-level useMemo — geometry must not be rebuilt every render, and
  // every value fed to it is forced finite (a NaN `z`/`size` would
  // otherwise corrupt the wedge angles).
  const slices = useMemo(() => {
    const finVal = (v: unknown) => {
      const n = typeof v === 'number' && Number.isFinite(v) ? v : 0
      return Math.max(0, n)
    }
    const vals = data.map(d => finVal(d.z) || finVal(d.size))
    const total = vals.reduce((s, v) => s + v, 0) || 1
    let acc = 0
    return data.map((d, i) => {
      const frac = vals[i] / total
      const start = acc * Math.PI * 2
      acc += frac
      const end = acc * Math.PI * 2
      // build a wedge shape and extrude it
      const shape = new THREE.Shape()
      shape.moveTo(0, 0)
      const segs = Math.max(2, Math.ceil((end - start) / 0.15))
      for (let j = 0; j <= segs; j++) {
        const a = start + (end - start) * (j / segs)
        shape.lineTo(Math.cos(a) * R, Math.sin(a) * R)
      }
      shape.lineTo(0, 0)
      const geo = new THREE.ExtrudeGeometry(shape, {
        depth, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.12, bevelSegments: 2,
      })
      geo.rotateX(-Math.PI / 2) // lay flat, extrude up
      return {
        start, end, frac, geo,
        label: d.label || `Slice ${i + 1}`, color: d.color, idx: i,
      }
    })
  }, [data, R, depth])

  return (
    <group rotation={[0, 0, 0]}>
      {slices.map((s) => {
        const mid = (s.start + s.end) / 2
        const explode = 0.4
        const col = s.color ? new THREE.Color(s.color) : colorFn(s.idx / Math.max(1, slices.length - 1))
        // Labels sit on a single ring well clear of the pie rim, all
        // lifted to a common height above the pie plane — at a large
        // radius the 12 labels separate cleanly around the circle. A
        // thin leader line ties each label back to its wedge edge.
        const labelR = R + 3.0
        const labelY = depth + 3.0
        const edge: [number, number, number] = [Math.cos(mid) * R, depth, -Math.sin(mid) * R]
        const labelPos: [number, number, number] = [
          Math.cos(mid) * labelR, labelY, -Math.sin(mid) * labelR,
        ]
        return (
          <group key={s.idx} position={[Math.cos(mid) * explode, 0, -Math.sin(mid) * explode]}>
            <mesh geometry={s.geo} position={[0, -depth / 2, 0]}>
              <meshStandardMaterial color={col} roughness={0.42} metalness={0.04} />
            </mesh>
            <PolyLine
              points={[edge, labelPos]}
              color={chrome.axis}
              transparent
              opacity={0.5}
            />
            <Label3D
              position={labelPos}
              text={`${s.label}  ${(s.frac * 100).toFixed(0)}%`}
              color={chrome.title}
              fontSize={1.05}
              weight={600}
              halo={chrome.halo}
            />
          </group>
        )
      })}
    </group>
  )
}

// ════════════════════════════════════════════════════════════════════
// CAMERA RIG — frames the whole figure (geometry box + axis labels)
// so nothing is clipped and the default view is a pleasing 3/4 angle.
// Runs once after mount: the scene extent is deterministic (the CUBE
// plus a fixed label margin), so a single fit is exact and stable.
// ════════════════════════════════════════════════════════════════════
function CameraRig({
  hasAxes, controls,
}: {
  hasAxes: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  controls: React.MutableRefObject<any>
}) {
  const { camera, size } = useThree()
  const fitted = useRef(false)
  useFrame(() => {
    if (fitted.current) return
    fitted.current = true
    const cam = camera as THREE.PerspectiveCamera
    // Tight framing — the chart should fill the figure area, not float
    // in a sea of white. The figure's payload is the CUBE; the axis
    // tick labels + titles hang ≈3u off the bottom + the two FRONT
    // (+x / +z) faces. Centring a touch low and toward +x/+z balances
    // that overhang so the box sits centred and large in the viewport.
    // pie (no axes) needs room for its outer stagger of leader labels.
    const halfExtent = hasAxes ? CUBE / 2 + 2.4 : CUBE * 0.82
    const center = new THREE.Vector3(
      hasAxes ? 0.9 : 0,
      hasAxes ? -1.6 : 0,
      hasAxes ? 0.9 : 0,
    )
    const radius = halfExtent * Math.SQRT2
    const aspect = size.width / Math.max(1, size.height)
    const vFov = (cam.fov * Math.PI) / 180
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.min(1, aspect))
    const fitFov = Math.min(vFov, hFov)
    const dist = (radius / Math.sin(fitFov / 2)) * 1.02
    // axis charts: pleasing 3/4 isometric (azimuth ~45°, modest
    // elevation). pie (no axes): a steeper near-overhead tilt so the
    // ring of slice labels projects to a wide, well-separated ellipse.
    const dir = hasAxes
      ? new THREE.Vector3(0.82, 0.6, 1.0).normalize()
      : new THREE.Vector3(0.32, 1.15, 0.62).normalize()
    cam.position.copy(center).addScaledVector(dir, dist)
    cam.near = Math.max(0.1, dist - radius * 2.2)
    cam.far = dist + radius * 3
    cam.lookAt(center)
    cam.updateProjectionMatrix()
    // hand the same target to OrbitControls so orbiting pivots about
    // the figure centre, not the world origin.
    if (controls.current) {
      controls.current.target.copy(center)
      controls.current.update()
    }
  })
  return null
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const controls = useRef<any>(null)

  return (
    <>
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
      <CameraRig hasAxes={showAxes} controls={controls} />
      <OrbitControls
        ref={controls}
        makeDefault
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.7}
        enablePan={false}
        minDistance={CUBE * 0.7}
        maxDistance={CUBE * 6}
      />
    </>
  )
}

// ════════════════════════════════════════════════════════════════════
// LEGENDS (HTML overlay — crisper text than WebGL sprites)
//
// A legend is shown ONLY when it carries meaning:
//  • category swatch legend — scatter/bubble/stem/bar/voxel when the
//    points carry ≥2 distinct `category` values AND the colour scheme
//    is categorical (otherwise colour encodes z, not category).
//  • z-value colour-bar — surface-family + trisurf/ribbon/line/quiver,
//    where colour is a continuous mapping of the z axis.
// Nothing is drawn otherwise. Both sit clear of the plot in the
// top-right gutter, inside a translucent card, never overlapping the
// geometry (the camera fit leaves a comfortable margin there).
// ════════════════════════════════════════════════════════════════════

// chart families whose colour is a continuous z encoding → colour-bar
const COLORBAR_TYPES = new Set<string>([
  'surface_3d', 'wireframe_3d', 'contour_3d', 'slice_3d', 'isosurface_3d',
  'trisurf_3d', 'ribbon_3d', 'line_3d', 'streamline_3d', 'quiver_3d',
])
// chart families that can carry a discrete category swatch legend
const CATEGORY_TYPES = new Set<string>([
  'scatter_3d', 'bubble_3d', 'stem_3d', 'bar_3d', 'voxel_3d',
])

function legendCardStyle(chrome: Chart3DChrome): React.CSSProperties {
  return {
    position: 'absolute', top: 12, right: 12,
    background: chrome.dark ? 'rgba(40,40,46,0.82)' : 'rgba(255,255,255,0.9)',
    border: `1px solid ${chrome.dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)'}`,
    borderRadius: 7, padding: '8px 10px',
    fontFamily: chrome.bodyFamily, pointerEvents: 'none',
    boxShadow: chrome.dark ? 'none' : '0 1px 4px rgba(0,0,0,0.08)',
    zIndex: 3,
  }
}

function CategoryLegend({ cats, chrome }: { cats: string[]; chrome: Chart3DChrome }) {
  return (
    <div style={{ ...legendCardStyle(chrome), display: 'flex', flexDirection: 'column', gap: 5 }}>
      {cats.map((c, i) => (
        <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{
            width: 12, height: 12, borderRadius: 3, flexShrink: 0,
            background: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
          }} />
          <span style={{ color: chrome.text, fontSize: 11.5, fontWeight: 500 }}>{c}</span>
        </div>
      ))}
    </div>
  )
}

function ColorBar({
  scheme, zMin, zMax, zLabel, chrome,
}: {
  scheme: ColorScheme; zMin: number; zMax: number; zLabel: string; chrome: Chart3DChrome
}) {
  const colorFn = useMemo(() => makeColorFn(scheme), [scheme])
  // CSS gradient sampled from the same stops the mesh uses
  const stops = useMemo(() => {
    const n = 12
    return Array.from({ length: n }, (_, i) => {
      const c = colorFn(i / (n - 1))
      const pct = (i / (n - 1)) * 100
      return `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)}) ${pct}%`
    }).join(', ')
  }, [colorFn])
  const lo = Number.isFinite(zMin) ? zMin : 0
  const hi = Number.isFinite(zMax) ? zMax : 1
  const mid = (lo + hi) / 2
  return (
    <div style={{ ...legendCardStyle(chrome), display: 'flex', alignItems: 'stretch', gap: 8 }}>
      <div style={{
        width: 16, borderRadius: 3,
        background: `linear-gradient(to top, ${stops})`,
        border: `1px solid ${chrome.dark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)'}`,
      }} />
      <div style={{
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        fontSize: 10.5, color: chrome.text, minHeight: 96, fontWeight: 500,
      }}>
        <span>{fmtTick(hi)}</span>
        <span style={{ fontWeight: 600, color: chrome.title }}>{zLabel}</span>
        <span>{fmtTick(mid)}</span>
        <span>{fmtTick(lo)}</span>
      </div>
    </div>
  )
}

function Legend({
  data, chrome, resolvedType, colorScheme, zLabel,
}: {
  data: DataPoint3D[]; chrome: Chart3DChrome; resolvedType: Chart3DType
  colorScheme: ColorScheme; zLabel: string
}) {
  const cats = useMemo(
    () => [...new Set(data.map(d => d.category).filter(Boolean))] as string[],
    [data],
  )
  const zRange = useMemo(() => {
    let lo = Infinity, hi = -Infinity
    for (const d of data) {
      if (Number.isFinite(d.z)) { if (d.z < lo) lo = d.z; if (d.z > hi) hi = d.z }
    }
    return { lo, hi }
  }, [data])

  // category legend wins when the chart type supports it AND colour
  // actually encodes category (categorical scheme + ≥2 categories)
  if (
    CATEGORY_TYPES.has(resolvedType) &&
    colorScheme === 'categorical' &&
    cats.length >= 2
  ) {
    return <CategoryLegend cats={cats} chrome={chrome} />
  }
  // colour-bar for continuous-z chart families with a valid z span
  if (
    COLORBAR_TYPES.has(resolvedType) &&
    Number.isFinite(zRange.lo) && Number.isFinite(zRange.hi) &&
    zRange.hi > zRange.lo
  ) {
    return (
      <ColorBar
        scheme={colorScheme}
        zMin={zRange.lo}
        zMax={zRange.hi}
        zLabel={zLabel}
        chrome={chrome}
      />
    )
  }
  return null
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
  const [ready] = useState(true)

  return (
    <div
      style={{
        width: '100%', height, position: 'relative',
        // the canvas is alpha:true, so this fill IS the figure ground —
        // white for journal themes, dark for screen — making the chart
        // read as one figure inside the card, not a box on white.
        background: chrome.bg,
        borderRadius: 4, overflow: 'hidden',
      }}
    >
      <ChartErrorBoundary resetKey={`${title}:${data.length}:${resolvedType}:${theme}`}>
        {title && (
          <div
            style={{
              position: 'absolute', top: 8, left: 0, right: 0, textAlign: 'center',
              fontFamily: chrome.titleFamily, fontSize: 14, fontWeight: 600,
              letterSpacing: '0.01em',
              color: chrome.title, pointerEvents: 'none', zIndex: 2,
            }}
          >
            {title}
          </div>
        )}
        <Legend
          data={data}
          chrome={chrome}
          resolvedType={resolvedType}
          colorScheme={colorScheme}
          zLabel={zLabel}
        />
        {ready && (
          <Canvas
            // crisp at 4K: render up to 3× device pixels, AA on
            dpr={[1, 3]}
            gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
            camera={{ position: [16, 13, 20], fov: 38, near: 0.1, far: 1000 }}
            style={{ width: '100%', height: '100%' }}
          >
            {/* journal-grade lighting: bright even ambient fill + a
                soft key + gentle fill + rim — no harsh speculars, the
                materials are matte so highlights stay tasteful */}
            <ambientLight intensity={chrome.dark ? 0.85 : 1.05} />
            <hemisphereLight
              args={[chrome.dark ? '#5a5a66' : '#ffffff', chrome.dark ? '#101014' : '#d8d8dc', chrome.dark ? 0.5 : 0.7]}
            />
            <directionalLight position={[16, 24, 12]} intensity={chrome.dark ? 0.7 : 0.55} />
            <directionalLight position={[-14, 12, -10]} intensity={0.28} />
            <directionalLight position={[-8, 6, 18]} intensity={0.22} />
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
          </Canvas>
        )}
      </ChartErrorBoundary>
    </div>
  )
}
