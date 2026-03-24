/**
 * Plot3D — Interactive 3D scatter plot and surface visualization
 * Uses React Three Fiber for GPU-accelerated rendering
 * NOTE: Does NOT import @react-three/drei to avoid three.js LinearEncoding compat issue
 */
import { useRef, useState, useMemo, useEffect } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

interface DataPoint3D {
  x: number
  y: number
  z: number
  label?: string
  color?: string
  size?: number
  category?: string
}

interface Plot3DProps {
  data: DataPoint3D[]
  title?: string
  xLabel?: string
  yLabel?: string
  zLabel?: string
  pointSize?: number
  colorScheme?: 'viridis' | 'plasma' | 'categorical' | 'gradient'
  showGrid?: boolean
  showAxes?: boolean
  height?: number
  onPointClick?: (point: DataPoint3D, index: number) => void
}

const CATEGORY_COLORS = [
  '#8b5cf6', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444',
  '#ec4899', '#06b6d4', '#f97316', '#6366f1', '#14b8a6',
]

function viridisColor(t: number): string {
  const r = Math.round(255 * Math.max(0, Math.min(1, -0.75 + 3.75 * t - 4.5 * t * t + 2.5 * t * t * t)))
  const g = Math.round(255 * Math.max(0, Math.min(1, -0.12 + 1.6 * t - 0.7 * t * t)))
  const b = Math.round(255 * Math.max(0, Math.min(1, 0.28 + 1.0 * t - 2.4 * t * t + 1.9 * t * t * t)))
  return `rgb(${r},${g},${b})`
}

function normalizeData(data: DataPoint3D[]) {
  if (data.length === 0) return { normalized: [] as Array<DataPoint3D & { nx: number; ny: number; nz: number }> }
  const xs = data.map(d => d.x)
  const ys = data.map(d => d.y)
  const zs = data.map(d => d.z)
  const range = (arr: number[]) => {
    const min = Math.min(...arr)
    const max = Math.max(...arr)
    return { min, max, span: max - min || 1 }
  }
  const xr = range(xs), yr = range(ys), zr = range(zs)
  const maxSpan = Math.max(xr.span, yr.span, zr.span)
  const scale = 4
  const normalized = data.map(d => ({
    ...d,
    nx: ((d.x - xr.min) / maxSpan - 0.5) * scale,
    ny: ((d.y - yr.min) / maxSpan - 0.5) * scale,
    nz: ((d.z - zr.min) / maxSpan - 0.5) * scale,
  }))
  return { normalized }
}

// Simple orbit controls without drei
function SimpleOrbitControls() {
  const { camera, gl } = useThree()
  const isDragging = useRef(false)
  const prevMouse = useRef({ x: 0, y: 0 })
  const spherical = useRef({ theta: Math.PI / 4, phi: Math.PI / 4, radius: 8 })

  useEffect(() => {
    const el = gl.domElement
    const onDown = (e: PointerEvent) => { isDragging.current = true; prevMouse.current = { x: e.clientX, y: e.clientY } }
    const onUp = () => { isDragging.current = false }
    const onMove = (e: PointerEvent) => {
      if (!isDragging.current) return
      const dx = e.clientX - prevMouse.current.x
      const dy = e.clientY - prevMouse.current.y
      spherical.current.theta -= dx * 0.005
      spherical.current.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.current.phi - dy * 0.005))
      prevMouse.current = { x: e.clientX, y: e.clientY }
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      spherical.current.radius = Math.max(3, Math.min(20, spherical.current.radius + e.deltaY * 0.01))
    }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointerleave', onUp)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointerleave', onUp)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('wheel', onWheel)
    }
  }, [gl])

  useFrame(() => {
    const { theta, phi, radius } = spherical.current
    camera.position.set(
      radius * Math.sin(phi) * Math.cos(theta),
      radius * Math.cos(phi),
      radius * Math.sin(phi) * Math.sin(theta),
    )
    camera.lookAt(0, 0, 0)
  })

  return null
}

function PointCloud({ data, pointSize, colorScheme }: {
  data: DataPoint3D[]
  pointSize: number
  colorScheme: string
}) {
  const { normalized } = useMemo(() => normalizeData(data), [data])
  const categories = useMemo(() => [...new Set(data.map(d => d.category || 'default'))], [data])

  const getColor = (point: DataPoint3D, idx: number) => {
    if (point.color) return point.color
    if (colorScheme === 'categorical' && point.category) {
      return CATEGORY_COLORS[categories.indexOf(point.category) % CATEGORY_COLORS.length]
    }
    const t = data.length > 1 ? idx / (data.length - 1) : 0.5
    return viridisColor(t)
  }

  // Use instanced mesh for performance
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const colorArray = useMemo(() => {
    const arr = new Float32Array(data.length * 3)
    data.forEach((point, i) => {
      const c = new THREE.Color(getColor(point, i))
      arr[i * 3] = c.r
      arr[i * 3 + 1] = c.g
      arr[i * 3 + 2] = c.b
    })
    return arr
  }, [data, colorScheme]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!meshRef.current) return
    const dummy = new THREE.Object3D()
    normalized.forEach((d, i) => {
      const s = (data[i].size || pointSize) * 0.03
      dummy.position.set(d.nx, d.ny, d.nz)
      dummy.scale.set(s, s, s)
      dummy.updateMatrix()
      meshRef.current!.setMatrixAt(i, dummy.matrix)
      meshRef.current!.setColorAt(i, new THREE.Color().setRGB(colorArray[i * 3], colorArray[i * 3 + 1], colorArray[i * 3 + 2]))
    })
    meshRef.current.instanceMatrix.needsUpdate = true
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true
  }, [normalized, data, pointSize, colorArray])

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, data.length]}>
      <sphereGeometry args={[1, 12, 12]} />
      <meshStandardMaterial />
    </instancedMesh>
  )
}

function AxisLine({ from, to, color }: { from: [number, number, number]; to: [number, number, number]; color: string }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute([...from, ...to], 3))
    return g
  }, [from, to])
  const material = useMemo(() => new THREE.LineBasicMaterial({ color, opacity: 0.6, transparent: true }), [color])
  const line = useMemo(() => new THREE.Line(geometry, material), [geometry, material])
  return <primitive object={line} />
}

function Axes() {
  return (
    <group>
      <AxisLine from={[-2.5, -2.5, -2.5]} to={[2.5, -2.5, -2.5]} color="#ef4444" />
      <AxisLine from={[-2.5, -2.5, -2.5]} to={[-2.5, 2.5, -2.5]} color="#22c55e" />
      <AxisLine from={[-2.5, -2.5, -2.5]} to={[-2.5, -2.5, 2.5]} color="#3b82f6" />
      <gridHelper args={[5, 10, '#ffffff15', '#ffffff08']} position={[0, -2.5, 0]} />
    </group>
  )
}

function RotatingGroup({ children, autoRotate }: { children: React.ReactNode; autoRotate: boolean }) {
  const ref = useRef<THREE.Group>(null)
  useFrame((_, delta) => {
    if (autoRotate && ref.current) {
      ref.current.rotation.y += delta * 0.15
    }
  })
  return <group ref={ref}>{children}</group>
}

export default function Plot3D({
  data,
  title,
  xLabel: _xLabel = 'X',
  yLabel: _yLabel = 'Y',
  zLabel: _zLabel = 'Z',
  pointSize = 3,
  colorScheme = 'viridis',
  showAxes = true,
  height = 400,
}: Plot3DProps) {
  const [autoRotate, setAutoRotate] = useState(false)

  if (data.length === 0) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)' }}>
        No data points to visualize
      </div>
    )
  }

  return (
    <div style={{ height, position: 'relative' }}>
      {title && (
        <div style={{ position: 'absolute', top: 8, left: 12, zIndex: 10, fontSize: '13px', fontWeight: 600, color: 'var(--color-text)' }}>
          {title}
        </div>
      )}
      <div style={{ position: 'absolute', top: 8, right: 12, zIndex: 10, display: 'flex', gap: 4 }}>
        <button
          onClick={() => setAutoRotate(!autoRotate)}
          style={{
            padding: '4px 8px', fontSize: '10px', borderRadius: '4px',
            background: autoRotate ? 'rgba(139,92,246,0.2)' : 'rgba(255,255,255,0.05)',
            color: autoRotate ? '#8b5cf6' : 'var(--color-text-muted)',
            border: '1px solid var(--color-border)', cursor: 'pointer',
          }}
        >
          {autoRotate ? 'Stop' : 'Rotate'}
        </button>
      </div>
      <Canvas camera={{ position: [5, 4, 5], fov: 50 }} style={{ borderRadius: '8px' }}>
        <color attach="background" args={['#0a0a0f']} />
        <ambientLight intensity={0.4} />
        <directionalLight position={[5, 5, 5]} intensity={0.8} />
        <pointLight position={[-5, -5, -5]} intensity={0.3} />

        <RotatingGroup autoRotate={autoRotate}>
          <PointCloud data={data} pointSize={pointSize} colorScheme={colorScheme} />
          {showAxes && <Axes />}
        </RotatingGroup>

        <SimpleOrbitControls />
      </Canvas>
      <div style={{ position: 'absolute', bottom: 8, left: 12, fontSize: '10px', color: 'var(--color-text-muted)' }}>
        {data.length} points | Drag to rotate, scroll to zoom
      </div>
    </div>
  )
}

export type { DataPoint3D, Plot3DProps }
