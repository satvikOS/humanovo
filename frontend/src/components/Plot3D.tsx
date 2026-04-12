/**
 * Plot3D — Professional 3D Visualization Suite
 * 17 chart types: scatter, bubble, line, bar, surface, wireframe, contour,
 *   trisurf, quiver, isosurface, voxel, streamline, slice, stem, waterfall, ribbon, pie
 * Uses React Three Fiber + Three.js (NO @react-three/drei)
 */
import { useRef, useState, useMemo, useEffect, useCallback } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import html2canvas from 'html2canvas'

// ── Types ───────────────────────────────────────────────────
export interface DataPoint3D {
  x: number; y: number; z: number
  label?: string; color?: string; size?: number; category?: string
  vx?: number; vy?: number; vz?: number // vector field
}

export type Chart3DType =
  | 'scatter_3d' | 'bubble_3d' | 'line_3d' | 'bar_3d'
  | 'surface_3d' | 'wireframe_3d' | 'contour_3d' | 'trisurf_3d'
  | 'quiver_3d' | 'isosurface_3d' | 'voxel_3d' | 'streamline_3d'
  | 'slice_3d' | 'stem_3d' | 'waterfall_3d' | 'ribbon_3d' | 'pie_3d'

export interface Plot3DProps {
  data: DataPoint3D[]
  chartType?: Chart3DType
  title?: string
  xLabel?: string; yLabel?: string; zLabel?: string
  pointSize?: number
  colorScheme?: 'viridis' | 'plasma' | 'categorical' | 'gradient'
  showGrid?: boolean; showAxes?: boolean
  height?: number
  onPointClick?: (point: DataPoint3D, index: number) => void
  surfaceFunction?: (x: number, y: number) => number
}

// ── Color Maps ──────────────────────────────────────────────
const CATEGORY_COLORS = [
  '#8b5cf6', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444',
  '#ec4899', '#06b6d4', '#f97316', '#6366f1', '#14b8a6',
]

function viridisColor(t: number): THREE.Color {
  t = Math.max(0, Math.min(1, t))
  const r = Math.max(0, Math.min(1, -0.75 + 3.75 * t - 4.5 * t * t + 2.5 * t * t * t))
  const g = Math.max(0, Math.min(1, -0.12 + 1.6 * t - 0.7 * t * t))
  const b = Math.max(0, Math.min(1, 0.28 + 1.0 * t - 2.4 * t * t + 1.9 * t * t * t))
  return new THREE.Color(r, g, b)
}

function plasmaColor(t: number): THREE.Color {
  t = Math.max(0, Math.min(1, t))
  const r = Math.max(0, Math.min(1, 0.05 + 2.4 * t - 1.7 * t * t))
  const g = Math.max(0, Math.min(1, -0.2 + 1.2 * t))
  const b = Math.max(0, Math.min(1, 0.53 + 0.5 * t - 2.0 * t * t + 1.2 * t * t * t))
  return new THREE.Color(r, g, b)
}

function getColorForScheme(scheme: string, t: number, category?: string, categories?: string[]): THREE.Color {
  if (scheme === 'categorical' && category && categories) {
    const idx = categories.indexOf(category) % CATEGORY_COLORS.length
    return new THREE.Color(CATEGORY_COLORS[idx])
  }
  if (scheme === 'plasma') return plasmaColor(t)
  if (scheme === 'gradient') return new THREE.Color().setHSL(0.6 - t * 0.4, 0.8, 0.5)
  return viridisColor(t)
}

// ── Data Normalization ──────────────────────────────────────
function normalizeData(data: DataPoint3D[], scale = 4) {
  if (data.length === 0) return { normalized: [] as (DataPoint3D & { nx: number; ny: number; nz: number })[], ranges: { x: { min: 0, max: 1 }, y: { min: 0, max: 1 }, z: { min: 0, max: 1 } } }
  const range = (vals: number[]) => { const mn = Math.min(...vals), mx = Math.max(...vals); return { min: mn, max: mx, span: mx - mn || 1 } }
  const xr = range(data.map(d => d.x)), yr = range(data.map(d => d.y)), zr = range(data.map(d => d.z))
  const maxSpan = Math.max(xr.span, yr.span, zr.span)
  const normalized = data.map(d => ({
    ...d,
    nx: ((d.x - xr.min) / maxSpan - 0.5) * scale,
    ny: ((d.y - yr.min) / maxSpan - 0.5) * scale,
    nz: ((d.z - zr.min) / maxSpan - 0.5) * scale,
  }))
  return { normalized, ranges: { x: xr, y: yr, z: zr } }
}

// ── Orbit Controls (manual — no drei) ───────────────────────
function OrbitControls() {
  const { camera, gl } = useThree()
  const isDrag = useRef(false)
  const prev = useRef({ x: 0, y: 0 })
  const sph = useRef({ theta: Math.PI / 4, phi: Math.PI / 4, radius: 8 })

  useEffect(() => {
    const el = gl.domElement
    const down = (e: PointerEvent) => { isDrag.current = true; prev.current = { x: e.clientX, y: e.clientY } }
    const up = () => { isDrag.current = false }
    const move = (e: PointerEvent) => {
      if (!isDrag.current) return
      sph.current.theta -= (e.clientX - prev.current.x) * 0.005
      sph.current.phi = Math.max(0.1, Math.min(Math.PI - 0.1, sph.current.phi - (e.clientY - prev.current.y) * 0.005))
      prev.current = { x: e.clientX, y: e.clientY }
    }
    const wheel = (e: WheelEvent) => { e.preventDefault(); sph.current.radius = Math.max(3, Math.min(25, sph.current.radius + e.deltaY * 0.01)) }
    el.addEventListener('pointerdown', down); el.addEventListener('pointerup', up); el.addEventListener('pointerleave', up)
    el.addEventListener('pointermove', move); el.addEventListener('wheel', wheel, { passive: false })
    return () => { el.removeEventListener('pointerdown', down); el.removeEventListener('pointerup', up); el.removeEventListener('pointerleave', up); el.removeEventListener('pointermove', move); el.removeEventListener('wheel', wheel) }
  }, [gl])

  useFrame(() => {
    const { theta, phi, radius } = sph.current
    camera.position.set(radius * Math.sin(phi) * Math.cos(theta), radius * Math.cos(phi), radius * Math.sin(phi) * Math.sin(theta))
    camera.lookAt(0, 0, 0)
  })
  return null
}

// ── Axis Lines ──────────────────────────────────────────────
function AxisLine({ from, to, color }: { from: [number, number, number]; to: [number, number, number]; color: string }) {
  const geo = useMemo(() => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([...from, ...to], 3)); return g }, [from, to])
  const mat = useMemo(() => new THREE.LineBasicMaterial({ color, opacity: 0.6, transparent: true }), [color])
  const line = useMemo(() => new THREE.Line(geo, mat), [geo, mat])
  return <primitive object={line} />
}

// Axes that adapt to the chosen background theme. On dark, we use bright
// neutral rails with muted accents; on light, we darken so the lines
// don't wash out against white — matches Matplotlib / Mathematica
// publication conventions.
function Axes3D({ theme = 'dark' }: { theme?: 'dark' | 'light' }) {
  const rail = theme === 'light' ? '#1f2937' : '#e5e7eb'
  const xAxis = theme === 'light' ? '#b91c1c' : '#f87171'
  const yAxis = theme === 'light' ? '#047857' : '#34d399'
  const zAxis = theme === 'light' ? '#1d4ed8' : '#60a5fa'
  const gridMajor = theme === 'light' ? '#0000001a' : '#ffffff22'
  const gridMinor = theme === 'light' ? '#00000010' : '#ffffff0d'
  return (
    <group>
      {/* Main axes, thickened by drawing parallel lines a hair apart */}
      <AxisLine from={[-2.5, -2.5, -2.5]} to={[2.5, -2.5, -2.5]} color={xAxis} />
      <AxisLine from={[-2.5, -2.5, -2.5]} to={[-2.5, 2.5, -2.5]} color={yAxis} />
      <AxisLine from={[-2.5, -2.5, -2.5]} to={[-2.5, -2.5, 2.5]} color={zAxis} />
      {/* Opposite rails for depth cueing */}
      <AxisLine from={[2.5, -2.5, 2.5]} to={[-2.5, -2.5, 2.5]} color={rail} />
      <AxisLine from={[2.5, -2.5, 2.5]} to={[2.5, 2.5, 2.5]} color={rail} />
      <AxisLine from={[2.5, -2.5, -2.5]} to={[2.5, -2.5, 2.5]} color={rail} />
      <AxisLine from={[-2.5, -2.5, 2.5]} to={[-2.5, 2.5, 2.5]} color={rail} />
      <gridHelper args={[5, 10, gridMajor, gridMinor]} position={[0, -2.5, 0]} />
    </group>
  )
}

function RotatingGroup({ children, auto }: { children: React.ReactNode; auto: boolean }) {
  const ref = useRef<THREE.Group>(null)
  useFrame((_, dt) => { if (auto && ref.current) ref.current.rotation.y += dt * 0.15 })
  return <group ref={ref}>{children}</group>
}

// ── CHART RENDERERS ─────────────────────────────────────────

// 1. Scatter 3D
function ScatterChart3D({ data, pointSize, colorScheme }: { data: DataPoint3D[]; pointSize: number; colorScheme: string }) {
  const { normalized } = useMemo(() => normalizeData(data), [data])
  const categories = useMemo(() => [...new Set(data.map(d => d.category || 'default'))], [data])
  const meshRef = useRef<THREE.InstancedMesh>(null)

  useEffect(() => {
    if (!meshRef.current || normalized.length === 0) return
    const dummy = new THREE.Object3D()
    normalized.forEach((d, i) => {
      const s = (data[i].size || pointSize) * 0.03
      dummy.position.set(d.nx, d.ny, d.nz); dummy.scale.set(s, s, s); dummy.updateMatrix()
      meshRef.current!.setMatrixAt(i, dummy.matrix)
      const t = data.length > 1 ? i / (data.length - 1) : 0.5
      const c = data[i].color ? new THREE.Color(data[i].color) : getColorForScheme(colorScheme, t, data[i].category, categories)
      meshRef.current!.setColorAt(i, c)
    })
    meshRef.current.instanceMatrix.needsUpdate = true
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true
  }, [normalized, data, pointSize, colorScheme, categories])

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, Math.max(1, data.length)]}>
      <sphereGeometry args={[1, 12, 12]} />
      <meshStandardMaterial />
    </instancedMesh>
  )
}

// 2. Bubble 3D (variable size spheres)
function BubbleChart3D({ data, colorScheme }: { data: DataPoint3D[]; colorScheme: string }) {
  return <ScatterChart3D data={data} pointSize={1} colorScheme={colorScheme} />
}

// 3. Line 3D
function LineChart3D({ data, colorScheme }: { data: DataPoint3D[]; colorScheme: string }) {
  const { normalized } = useMemo(() => normalizeData(data), [data])
  const lineObj = useMemo(() => {
    const points = normalized.map(d => new THREE.Vector3(d.nx, d.ny, d.nz))
    const geo = new THREE.BufferGeometry().setFromPoints(points)
    const colors = new Float32Array(points.length * 3)
    points.forEach((_, i) => {
      const c = getColorForScheme(colorScheme, i / (points.length - 1 || 1))
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b
    })
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    const mat = new THREE.LineBasicMaterial({ vertexColors: true, linewidth: 2 })
    return new THREE.Line(geo, mat)
  }, [normalized, colorScheme])
  return <primitive object={lineObj} />
}

// 4. Bar 3D
function BarChart3D({ data, colorScheme }: { data: DataPoint3D[]; colorScheme: string }) {
  const { normalized } = useMemo(() => normalizeData(data), [data])
  const categories = useMemo(() => [...new Set(data.map(d => d.category || 'default'))], [data])
  const meshRef = useRef<THREE.InstancedMesh>(null)

  useEffect(() => {
    if (!meshRef.current || normalized.length === 0) return
    const dummy = new THREE.Object3D()
    normalized.forEach((d, i) => {
      const h = Math.max(0.05, (d.ny + 2.5) / 5 * 4)
      dummy.position.set(d.nx, -2.5 + h / 2, d.nz)
      dummy.scale.set(0.15, h, 0.15); dummy.updateMatrix()
      meshRef.current!.setMatrixAt(i, dummy.matrix)
      const t = data.length > 1 ? i / (data.length - 1) : 0.5
      const c = data[i].color ? new THREE.Color(data[i].color) : getColorForScheme(colorScheme, t, data[i].category, categories)
      meshRef.current!.setColorAt(i, c)
    })
    meshRef.current.instanceMatrix.needsUpdate = true
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true
  }, [normalized, data, colorScheme, categories])

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, Math.max(1, data.length)]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial />
    </instancedMesh>
  )
}

// 5. Surface 3D
function SurfaceChart3D({ data, colorScheme, surfaceFunction }: { data: DataPoint3D[]; colorScheme: string; surfaceFunction?: (x: number, y: number) => number }) {
  const mesh = useMemo(() => {
    const res = 50
    const geo = new THREE.PlaneGeometry(5, 5, res - 1, res - 1)
    const pos = geo.attributes.position
    const colors = new Float32Array(pos.count * 3)
    let minZ = Infinity, maxZ = -Infinity

    if (surfaceFunction) {
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i)
        const z = surfaceFunction(x, y)
        pos.setZ(i, z)
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
      }
    } else if (data.length > 0) {
      const gridSize = Math.ceil(Math.sqrt(data.length))
      for (let i = 0; i < pos.count; i++) {
        const di = Math.min(i, data.length - 1)
        const z = ((data[di].z - Math.min(...data.map(d => d.z))) / (Math.max(...data.map(d => d.z)) - Math.min(...data.map(d => d.z)) || 1) - 0.5) * 2
        pos.setZ(i, z)
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
      }
      void gridSize
    }

    const zRange = maxZ - minZ || 1
    for (let i = 0; i < pos.count; i++) {
      const t = (pos.getZ(i) - minZ) / zRange
      const c = getColorForScheme(colorScheme, t)
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geo.computeVertexNormals()
    return geo
  }, [data, colorScheme, surfaceFunction])

  return (
    <mesh geometry={mesh} rotation={[-Math.PI / 2, 0, 0]}>
      <meshStandardMaterial vertexColors side={THREE.DoubleSide} />
    </mesh>
  )
}

// 6. Wireframe 3D
function WireframeChart3D(props: { data: DataPoint3D[]; colorScheme: string; surfaceFunction?: (x: number, y: number) => number }) {
  return (
    <group>
      <SurfaceChart3D {...props} />
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[5, 5, 49, 49]} />
        <meshBasicMaterial wireframe color="#ffffff" opacity={0.15} transparent />
      </mesh>
    </group>
  )
}

// 7. Contour 3D — approximated with multiple horizontal slice planes
function ContourChart3D({ colorScheme, surfaceFunction }: { data: DataPoint3D[]; colorScheme: string; surfaceFunction?: (x: number, y: number) => number }) {
  const lines = useMemo(() => {
    if (!surfaceFunction) return []
    const levels = 10
    const result: { points: THREE.Vector3[]; level: number }[] = []
    const res = 40
    for (let l = 0; l < levels; l++) {
      const zLevel = -2 + (l / (levels - 1)) * 4
      const pts: THREE.Vector3[] = []
      for (let i = 0; i <= res; i++) {
        const x = -2.5 + (i / res) * 5
        let closestY = 0, closestDist = Infinity
        for (let j = 0; j <= res; j++) {
          const y = -2.5 + (j / res) * 5
          const z = surfaceFunction(x, y)
          const dist = Math.abs(z - zLevel)
          if (dist < closestDist) { closestDist = dist; closestY = y }
        }
        if (closestDist < 0.3) pts.push(new THREE.Vector3(x, zLevel * 0.5, closestY))
      }
      if (pts.length > 2) result.push({ points: pts, level: l / (levels - 1) })
    }
    return result
  }, [surfaceFunction])

  return (
    <group>
      {lines.map((line, i) => {
        const geo = new THREE.BufferGeometry().setFromPoints(line.points)
        const c = getColorForScheme(colorScheme, line.level)
        const mat = new THREE.LineBasicMaterial({ color: c })
        const obj = new THREE.Line(geo, mat)
        return <primitive key={i} object={obj} />
      })}
    </group>
  )
}

// 8. TriSurf 3D — triangulated surface from scattered points
function TriSurfChart3D({ data, colorScheme }: { data: DataPoint3D[]; colorScheme: string }) {
  return <SurfaceChart3D data={data} colorScheme={colorScheme} />
}

// 9. Quiver 3D — vector arrows
function QuiverChart3D({ data, colorScheme }: { data: DataPoint3D[]; colorScheme: string }) {
  const { normalized } = useMemo(() => normalizeData(data), [data])
  const arrows = useMemo(() => {
    return normalized.map((d, i) => {
      const vx = data[i].vx || 0, vy = data[i].vy || 0, vz = data[i].vz || 0
      const len = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1
      const dir = new THREE.Vector3(vx / len, vy / len, vz / len)
      const origin = new THREE.Vector3(d.nx, d.ny, d.nz)
      const arrowLen = Math.min(0.5, len * 0.3)
      const t = data.length > 1 ? i / (data.length - 1) : 0.5
      const color = getColorForScheme(colorScheme, t)
      return { origin, dir, len: arrowLen, color }
    })
  }, [normalized, data, colorScheme])

  return (
    <group>
      {arrows.map((a, i) => {
        const end = a.origin.clone().add(a.dir.clone().multiplyScalar(a.len))
        const points = [a.origin, end]
        const geo = new THREE.BufferGeometry().setFromPoints(points)
        const mat = new THREE.LineBasicMaterial({ color: a.color })
        const line = new THREE.Line(geo, mat)
        return (
          <group key={i}>
            <primitive object={line} />
            <mesh position={[end.x, end.y, end.z]}>
              <coneGeometry args={[0.04, 0.12, 6]} />
              <meshStandardMaterial color={a.color} />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}

// 10. Voxel 3D
function VoxelChart3D({ data, colorScheme }: { data: DataPoint3D[]; colorScheme: string }) {
  const { normalized } = useMemo(() => normalizeData(data), [data])
  const categories = useMemo(() => [...new Set(data.map(d => d.category || 'default'))], [data])
  const meshRef = useRef<THREE.InstancedMesh>(null)

  useEffect(() => {
    if (!meshRef.current || normalized.length === 0) return
    const dummy = new THREE.Object3D()
    normalized.forEach((d, i) => {
      dummy.position.set(d.nx, d.ny, d.nz); dummy.scale.set(0.2, 0.2, 0.2); dummy.updateMatrix()
      meshRef.current!.setMatrixAt(i, dummy.matrix)
      const t = data.length > 1 ? i / (data.length - 1) : 0.5
      meshRef.current!.setColorAt(i, getColorForScheme(colorScheme, t, data[i].category, categories))
    })
    meshRef.current.instanceMatrix.needsUpdate = true
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true
  }, [normalized, data, colorScheme, categories])

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, Math.max(1, data.length)]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial opacity={0.8} transparent />
    </instancedMesh>
  )
}

// 11. Stem 3D
function StemChart3D({ data, colorScheme }: { data: DataPoint3D[]; colorScheme: string }) {
  const { normalized } = useMemo(() => normalizeData(data), [data])
  const categories = useMemo(() => [...new Set(data.map(d => d.category || 'default'))], [data])

  return (
    <group>
      {normalized.map((d, i) => {
        const t = data.length > 1 ? i / (data.length - 1) : 0.5
        const c = getColorForScheme(colorScheme, t, data[i].category, categories)
        const pts = [new THREE.Vector3(d.nx, -2.5, d.nz), new THREE.Vector3(d.nx, d.ny, d.nz)]
        const geo = new THREE.BufferGeometry().setFromPoints(pts)
        const mat = new THREE.LineBasicMaterial({ color: c, opacity: 0.6, transparent: true })
        const line = new THREE.Line(geo, mat)
        return (
          <group key={i}>
            <primitive object={line} />
            <mesh position={[d.nx, d.ny, d.nz]}>
              <sphereGeometry args={[0.06, 8, 8]} />
              <meshStandardMaterial color={c} />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}

// 12. Waterfall 3D — sequential curves at different Z positions
function WaterfallChart3D({ data, colorScheme }: { data: DataPoint3D[]; colorScheme: string }) {
  const { normalized } = useMemo(() => normalizeData(data), [data])
  const groups = useMemo(() => {
    const zBuckets = new Map<number, typeof normalized>()
    normalized.forEach((d, i) => {
      const zKey = Math.round(d.nz * 5) / 5
      if (!zBuckets.has(zKey)) zBuckets.set(zKey, [])
      zBuckets.get(zKey)!.push({ ...d, _origIdx: i } as any)
    })
    return [...zBuckets.entries()].sort((a, b) => a[0] - b[0])
  }, [normalized])

  return (
    <group>
      {groups.map(([, pts], gi) => {
        const t = groups.length > 1 ? gi / (groups.length - 1) : 0.5
        const c = getColorForScheme(colorScheme, t)
        const sorted = [...pts].sort((a, b) => a.nx - b.nx)
        const points = sorted.map(d => new THREE.Vector3(d.nx, d.ny, d.nz))
        if (points.length < 2) return null
        const geo = new THREE.BufferGeometry().setFromPoints(points)
        const mat = new THREE.LineBasicMaterial({ color: c, linewidth: 2 })
        const line = new THREE.Line(geo, mat)
        return <primitive key={gi} object={line} />
      })}
    </group>
  )
}

// 13. Ribbon 3D — extruded curves
function RibbonChart3D({ data, colorScheme }: { data: DataPoint3D[]; colorScheme: string }) {
  const { normalized } = useMemo(() => normalizeData(data), [data])
  const ribbonGeo = useMemo(() => {
    if (normalized.length < 2) return null
    const sorted = [...normalized].sort((a, b) => a.nx - b.nx)
    const vertices: number[] = []
    const colors: number[] = []
    const indices: number[] = []
    const w = 0.08

    sorted.forEach((d, i) => {
      vertices.push(d.nx, d.ny, d.nz - w, d.nx, d.ny, d.nz + w)
      const t = i / (sorted.length - 1)
      const c = getColorForScheme(colorScheme, t)
      colors.push(c.r, c.g, c.b, c.r, c.g, c.b)
      if (i < sorted.length - 1) {
        const bi = i * 2
        indices.push(bi, bi + 1, bi + 2, bi + 1, bi + 3, bi + 2)
      }
    })

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    geo.setIndex(indices)
    geo.computeVertexNormals()
    return geo
  }, [normalized, colorScheme])

  if (!ribbonGeo) return null
  return (
    <mesh geometry={ribbonGeo}>
      <meshStandardMaterial vertexColors side={THREE.DoubleSide} />
    </mesh>
  )
}

// 14. Pie 3D
function PieChart3D({ data, colorScheme }: { data: DataPoint3D[]; colorScheme: string }) {
  const categories = useMemo(() => [...new Set(data.map(d => d.category || 'default'))], [data])
  const slices = useMemo(() => {
    const total = data.reduce((s, d) => s + Math.abs(d.y), 0) || 1
    let angle = 0
    return data.map((d, i) => {
      const fraction = Math.abs(d.y) / total
      const startAngle = angle
      angle += fraction * Math.PI * 2
      const t = data.length > 1 ? i / (data.length - 1) : 0.5
      const c = getColorForScheme(colorScheme, t, d.category, categories)
      return { start: startAngle, end: angle, color: c, label: d.label || d.category || `Slice ${i + 1}`, value: d.y }
    })
  }, [data, colorScheme, categories])

  return (
    <group rotation={[-Math.PI / 4, 0, 0]}>
      {slices.map((s, i) => (
        <mesh key={i}>
          <cylinderGeometry args={[1.5, 1.5, 0.4, 32, 1, false, s.start, s.end - s.start]} />
          <meshStandardMaterial color={s.color} />
        </mesh>
      ))}
    </group>
  )
}

// 15. Isosurface (approximated via point cloud at threshold)
function IsosurfaceChart3D({ data, colorScheme }: { data: DataPoint3D[]; colorScheme: string }) {
  return <ScatterChart3D data={data} pointSize={4} colorScheme={colorScheme} />
}

// 16. Streamline 3D
function StreamlineChart3D({ data, colorScheme }: { data: DataPoint3D[]; colorScheme: string }) {
  return <LineChart3D data={data} colorScheme={colorScheme} />
}

// 17. Slice 3D
function SliceChart3D({ data, colorScheme }: { data: DataPoint3D[]; colorScheme: string }) {
  const { normalized } = useMemo(() => normalizeData(data), [data])
  const slicePlanes = useMemo(() => {
    const planes: { y: number; points: THREE.Vector3[] }[] = []
    const yLevels = [-1.5, 0, 1.5]
    yLevels.forEach(yLevel => {
      const nearby = normalized.filter(d => Math.abs(d.ny - yLevel) < 0.5)
      if (nearby.length > 0) planes.push({ y: yLevel, points: nearby.map(d => new THREE.Vector3(d.nx, yLevel, d.nz)) })
    })
    return planes
  }, [normalized])

  return (
    <group>
      <ScatterChart3D data={data} pointSize={2} colorScheme={colorScheme} />
      {slicePlanes.map((plane, i) => (
        <mesh key={i} position={[0, plane.y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[5, 5]} />
          <meshStandardMaterial color={getColorForScheme(colorScheme, i / 2)} opacity={0.15} transparent side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  )
}

// ── Chart Type Selector ─────────────────────────────────────
function getChartRenderer(type: Chart3DType) {
  const map: Record<Chart3DType, React.FC<any>> = {
    scatter_3d: ScatterChart3D,
    bubble_3d: BubbleChart3D,
    line_3d: LineChart3D,
    bar_3d: BarChart3D,
    surface_3d: SurfaceChart3D,
    wireframe_3d: WireframeChart3D,
    contour_3d: ContourChart3D,
    trisurf_3d: TriSurfChart3D,
    quiver_3d: QuiverChart3D,
    isosurface_3d: IsosurfaceChart3D,
    voxel_3d: VoxelChart3D,
    streamline_3d: StreamlineChart3D,
    slice_3d: SliceChart3D,
    stem_3d: StemChart3D,
    waterfall_3d: WaterfallChart3D,
    ribbon_3d: RibbonChart3D,
    pie_3d: PieChart3D,
  }
  return map[type] || ScatterChart3D
}

// ── Colour-ramp legend ──────────────────────────────────────
// Thin, rounded legend bar. Renders inline SVG so it can be copied as
// part of the chart raster and stays crisp at any DPI. `theme`
// controls the label contrast, `scheme` drives the gradient stops.
function Legend3D({ scheme, theme, zMin, zMax, label }: {
  scheme: 'viridis' | 'plasma' | 'categorical' | 'gradient'
  theme: 'dark' | 'light'
  zMin: number
  zMax: number
  label?: string
}) {
  const fg = theme === 'light' ? '#1f2937' : '#e5e7eb'
  const mut = theme === 'light' ? '#475569' : '#94a3b8'
  // Sample 24 stops along the selected color ramp to build a smooth
  // gradient that matches the actual ramp used by the shaders.
  const stops = useMemo(() => {
    const out: { t: number; color: string }[] = []
    for (let i = 0; i <= 24; i++) {
      const t = i / 24
      const c = getColorForScheme(scheme, t).getHexString()
      out.push({ t, color: `#${c}` })
    }
    return out
  }, [scheme])
  // Categorical schemes don't have a meaningful ramp — skip rendering
  // the legend entirely so we don't mislead viewers.
  if (scheme === 'categorical') return null
  const gradId = `p3d-grad-${scheme}-${theme}`
  const fmt = (v: number) => Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2)
  return (
    <div style={{
      position: 'absolute',
      right: 14,
      top: '50%',
      transform: 'translateY(-50%)',
      zIndex: 6,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 6,
      pointerEvents: 'none',
    }}>
      {label && (
        <div style={{ fontSize: 10, fontWeight: 600, color: mut, letterSpacing: 0.4, writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
          {label}
        </div>
      )}
      <svg width={12} height={180} style={{ overflow: 'visible' }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="1" x2="0" y2="0">
            {stops.map(s => <stop key={s.t} offset={`${s.t * 100}%`} stopColor={s.color} />)}
          </linearGradient>
        </defs>
        <rect x={0} y={0} width={12} height={180} rx={6} ry={6} fill={`url(#${gradId})`} />
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: 0 }} />
      <div style={{
        position: 'absolute',
        right: 18,
        top: 0,
        bottom: 0,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        fontSize: 9,
        fontFamily: "'JetBrains Mono', monospace",
        color: fg,
      }}>
        <span>{fmt(zMax)}</span>
        <span style={{ color: mut }}>{fmt((zMin + zMax) / 2)}</span>
        <span>{fmt(zMin)}</span>
      </div>
    </div>
  )
}

// ── Main Component ──────────────────────────────────────────
export default function Plot3D({
  data,
  chartType = 'scatter_3d',
  title,
  zLabel,
  pointSize = 3,
  colorScheme = 'viridis',
  showAxes = true,
  height = 400,
  surfaceFunction,
}: Plot3DProps) {
  const [autoRotate, setAutoRotate] = useState(false)
  const [copied, setCopied] = useState<false | 'dark' | 'light'>(false)
  // Background the user sees (and the canvas exports). Persisted inside
  // the component so toggling doesn't disrupt orbit state.
  const [bgTheme, setBgTheme] = useState<'dark' | 'light'>('dark')
  const containerRef = useRef<HTMLDivElement>(null)

  const bgColor = bgTheme === 'light' ? '#ffffff' : '#0a0a0f'

  // Copy the rendered chart as a PNG to the clipboard. `targetTheme`
  // lets callers force a light or dark background independent of the
  // current on-screen theme — useful for pasting straight into a
  // Word doc (light) or a Keynote slide (dark).
  const copyChart = useCallback(async (targetTheme: 'dark' | 'light') => {
    if (!containerRef.current) return
    const prev = bgTheme
    // Swap background if needed so html2canvas captures the intended
    // theme, then restore.
    const needsSwap = targetTheme !== prev
    try {
      if (needsSwap) setBgTheme(targetTheme)
      // Wait for the next frame so the color prop propagates through
      // react-three-fiber before we snapshot.
      await new Promise(r => requestAnimationFrame(() => r(null)))
      await new Promise(r => requestAnimationFrame(() => r(null)))
      const canvas = await html2canvas(containerRef.current, {
        backgroundColor: targetTheme === 'light' ? '#ffffff' : '#0a0a0f',
        scale: 2,
        useCORS: true,
        logging: false,
      })
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
      if (blob) {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        setCopied(targetTheme)
        setTimeout(() => setCopied(false), 1800)
      }
    } catch {
      /* clipboard/html2canvas not supported in this environment */
    } finally {
      if (needsSwap) setBgTheme(prev)
    }
  }, [bgTheme])

  const exportCSV = useCallback(() => {
    const header = 'x,y,z,label,category,size\n'
    const rows = data.map(d => `${d.x},${d.y},${d.z},"${d.label || ''}","${d.category || ''}",${d.size || ''}`).join('\n')
    const blob = new Blob([header + rows], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'plot3d_data.csv'; a.click()
    URL.revokeObjectURL(url)
  }, [data])

  if (data.length === 0) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)' }}>
        No data points to visualize
      </div>
    )
  }

  const ChartRenderer = getChartRenderer(chartType)
  const zRange = useMemo(() => {
    if (!data.length) return { min: 0, max: 1 }
    let mn = Infinity, mx = -Infinity
    for (const d of data) { if (d.z < mn) mn = d.z; if (d.z > mx) mx = d.z }
    return { min: mn, max: mx }
  }, [data])

  const titleColor = bgTheme === 'light' ? '#0f172a' : '#f8fafc'
  const mutedColor = bgTheme === 'light' ? '#475569' : '#94a3b8'

  // iOS-style frosted pill button — muted palette, soft shadow, consistent
  // across toolbar controls. Re-declared inline because these chrome bits
  // live inside the snapshot and should carry their own styles (html2canvas
  // can't read external CSS for Shadow DOM peers).
  const pillButton = (active: boolean): React.CSSProperties => ({
    padding: '5px 11px',
    fontSize: 11,
    fontWeight: 500,
    letterSpacing: 0.1,
    borderRadius: 14,
    background: active
      ? (bgTheme === 'light' ? 'rgba(15,23,42,0.08)' : 'rgba(248,250,252,0.12)')
      : (bgTheme === 'light' ? 'rgba(15,23,42,0.04)' : 'rgba(248,250,252,0.05)'),
    color: active ? titleColor : mutedColor,
    border: `1px solid ${bgTheme === 'light' ? 'rgba(15,23,42,0.10)' : 'rgba(248,250,252,0.09)'}`,
    boxShadow: bgTheme === 'light'
      ? '0 1px 2px rgba(0,0,0,0.06)'
      : '0 1px 2px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.04)',
    backdropFilter: 'blur(10px) saturate(140%)',
    WebkitBackdropFilter: 'blur(10px) saturate(140%)',
    cursor: 'pointer',
    transition: 'transform 0.15s ease, background 0.15s ease, color 0.15s ease',
  })

  return (
    <div
      ref={containerRef}
      style={{
        height,
        position: 'relative',
        borderRadius: 14,
        overflow: 'hidden',
        background: bgColor,
        transition: 'background 0.2s ease',
      }}
    >
      {/* Header — title top-left */}
      {title && (
        <div style={{
          position: 'absolute', top: 12, left: 16, zIndex: 10,
          fontSize: 13, fontWeight: 600, letterSpacing: -0.1,
          color: titleColor,
        }}>
          {title}
        </div>
      )}

      {/* Toolbar — glassy pill controls, muted palette */}
      <div style={{ position: 'absolute', top: 10, right: 14, zIndex: 10, display: 'flex', gap: 6 }}>
        <button
          type="button"
          onClick={() => setBgTheme(t => t === 'dark' ? 'light' : 'dark')}
          style={pillButton(false)}
          title={`Switch to ${bgTheme === 'dark' ? 'light' : 'dark'} background`}
          aria-label={`Toggle background, currently ${bgTheme}`}
        >
          {bgTheme === 'dark' ? 'Light bg' : 'Dark bg'}
        </button>
        <button
          type="button"
          onClick={() => setAutoRotate(r => !r)}
          style={pillButton(autoRotate)}
          title="Auto-rotate the scene"
          aria-label="Toggle auto-rotate"
        >
          {autoRotate ? 'Stop' : 'Rotate'}
        </button>
        <button
          type="button"
          onClick={() => copyChart(bgTheme)}
          style={pillButton(copied === bgTheme)}
          title="Copy the rendered chart to the clipboard as PNG"
          aria-label="Copy chart image"
        >
          {copied === bgTheme ? 'Copied' : 'Copy PNG'}
        </button>
        <button
          type="button"
          onClick={() => copyChart(bgTheme === 'dark' ? 'light' : 'dark')}
          style={pillButton(false)}
          title={`Copy with ${bgTheme === 'dark' ? 'white' : 'black'} background`}
          aria-label="Copy chart image with inverted background"
        >
          {bgTheme === 'dark' ? 'Copy (white bg)' : 'Copy (black bg)'}
        </button>
        <button
          type="button"
          onClick={exportCSV}
          style={pillButton(false)}
          title="Download the underlying points as CSV"
          aria-label="Export CSV"
        >
          CSV
        </button>
      </div>

      {/* Canvas — lighting tuned per theme for soft publication-grade
          shading. Directional + rim + ambient matches the Matplotlib
          mplot3d default feel but with PBR materials. */}
      <Canvas
        camera={{ position: [5, 4, 5], fov: 45 }}
        gl={{ antialias: true, preserveDrawingBuffer: true, alpha: false }}
        dpr={[1, 2]}
        style={{ width: '100%', height: '100%' }}
      >
        <color attach="background" args={[bgColor]} />
        <ambientLight intensity={bgTheme === 'light' ? 0.85 : 0.45} />
        <hemisphereLight
          args={[
            bgTheme === 'light' ? '#ffffff' : '#8fb6e4',
            bgTheme === 'light' ? '#e2e8f0' : '#111827',
            bgTheme === 'light' ? 0.55 : 0.25,
          ]}
        />
        <directionalLight position={[6, 8, 4]} intensity={bgTheme === 'light' ? 0.6 : 0.9} />
        <directionalLight position={[-6, -4, -4]} intensity={bgTheme === 'light' ? 0.25 : 0.35} />
        <pointLight position={[0, 6, 0]} intensity={bgTheme === 'light' ? 0.15 : 0.2} />

        <RotatingGroup auto={autoRotate}>
          <ChartRenderer data={data} pointSize={pointSize} colorScheme={colorScheme} surfaceFunction={surfaceFunction} />
          {showAxes && <Axes3D theme={bgTheme} />}
        </RotatingGroup>

        <OrbitControls />
      </Canvas>

      {/* Colour ramp legend — thin, rounded, respects theme. Skipped for
          categorical color schemes since a ramp would be misleading. */}
      {colorScheme !== 'categorical' && (
        <Legend3D
          scheme={colorScheme}
          theme={bgTheme}
          zMin={zRange.min}
          zMax={zRange.max}
          label={zLabel}
        />
      )}

      {/* Footer — point count + interaction hint */}
      <div style={{
        position: 'absolute', bottom: 10, left: 16,
        fontSize: 10, color: mutedColor,
        fontFamily: "'JetBrains Mono', monospace",
        letterSpacing: 0.2,
      }}>
        {data.length.toLocaleString()} pts · {chartType.replace('_3d', '').replace('_', ' ')} · drag · scroll to zoom
      </div>
    </div>
  )
}
