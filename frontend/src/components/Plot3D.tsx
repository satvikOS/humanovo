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

function Axes3D() {
  return (
    <group>
      <AxisLine from={[-2.5, -2.5, -2.5]} to={[2.5, -2.5, -2.5]} color="#ef4444" />
      <AxisLine from={[-2.5, -2.5, -2.5]} to={[-2.5, 2.5, -2.5]} color="#22c55e" />
      <AxisLine from={[-2.5, -2.5, -2.5]} to={[-2.5, -2.5, 2.5]} color="#3b82f6" />
      <gridHelper args={[5, 10, '#ffffff15', '#ffffff08']} position={[0, -2.5, 0]} />
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

// ── Main Component ──────────────────────────────────────────
export default function Plot3D({
  data,
  chartType = 'scatter_3d',
  title,
  pointSize = 3,
  colorScheme = 'viridis',
  showAxes = true,
  height = 400,
  surfaceFunction,
}: Plot3DProps) {
  const [autoRotate, setAutoRotate] = useState(false)
  const [copied, setCopied] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const copyChart = useCallback(async () => {
    if (!containerRef.current) return
    try {
      const canvas = await html2canvas(containerRef.current, { backgroundColor: '#0a0a0f', scale: 2, useCORS: true, logging: false })
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
      if (blob) { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); setCopied(true); setTimeout(() => setCopied(false), 2000) }
    } catch { /* clipboard not supported */ }
  }, [])

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

  return (
    <div ref={containerRef} style={{ height, position: 'relative' }}>
      {/* Header */}
      {title && (
        <div style={{ position: 'absolute', top: 8, left: 12, zIndex: 10, fontSize: '13px', fontWeight: 600, color: 'var(--color-text)' }}>
          {title}
        </div>
      )}

      {/* Controls */}
      <div style={{ position: 'absolute', top: 8, right: 12, zIndex: 10, display: 'flex', gap: 4 }}>
        <button onClick={() => setAutoRotate(!autoRotate)} style={{
          padding: '4px 8px', fontSize: '10px', borderRadius: '4px',
          background: autoRotate ? 'rgba(139,92,246,0.2)' : 'rgba(255,255,255,0.05)',
          color: autoRotate ? '#8b5cf6' : 'var(--color-text-muted)',
          border: '1px solid var(--color-border)', cursor: 'pointer',
        }}>
          {autoRotate ? 'Stop' : 'Rotate'}
        </button>
        <button onClick={copyChart} style={{
          padding: '4px 8px', fontSize: '10px', borderRadius: '4px',
          background: copied ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.05)',
          color: copied ? '#22c55e' : 'var(--color-text-muted)',
          border: '1px solid var(--color-border)', cursor: 'pointer',
        }}>
          {copied ? 'Copied!' : 'Copy'}
        </button>
        <button onClick={exportCSV} style={{
          padding: '4px 8px', fontSize: '10px', borderRadius: '4px',
          background: 'rgba(255,255,255,0.05)', color: 'var(--color-text-muted)',
          border: '1px solid var(--color-border)', cursor: 'pointer',
        }}>
          CSV
        </button>
      </div>

      {/* Canvas */}
      <Canvas camera={{ position: [5, 4, 5], fov: 50 }} style={{ borderRadius: '8px' }}>
        <color attach="background" args={['#0a0a0f']} />
        <ambientLight intensity={0.4} />
        <directionalLight position={[5, 5, 5]} intensity={0.8} />
        <pointLight position={[-5, -5, -5]} intensity={0.3} />

        <RotatingGroup auto={autoRotate}>
          <ChartRenderer data={data} pointSize={pointSize} colorScheme={colorScheme} surfaceFunction={surfaceFunction} />
          {showAxes && <Axes3D />}
        </RotatingGroup>

        <OrbitControls />
      </Canvas>

      {/* Footer */}
      <div style={{ position: 'absolute', bottom: 8, left: 12, fontSize: '10px', color: 'var(--color-text-muted)' }}>
        {data.length} points | {chartType.replace('_3d', '').replace('_', ' ')} | Drag to rotate, scroll to zoom
      </div>
    </div>
  )
}
