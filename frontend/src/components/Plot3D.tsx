/**
 * Plot3D — Interactive 3D scatter plot and surface visualization
 * Uses React Three Fiber for GPU-accelerated rendering
 */
import { useRef, useState, useMemo } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Text, Html, Grid } from '@react-three/drei'
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
  if (data.length === 0) return { normalized: [], scale: { x: 1, y: 1, z: 1 }, offset: { x: 0, y: 0, z: 0 } }
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
  const scale = 4 // total axis size
  const normalized = data.map(d => ({
    ...d,
    nx: ((d.x - xr.min) / maxSpan - 0.5) * scale,
    ny: ((d.y - yr.min) / maxSpan - 0.5) * scale,
    nz: ((d.z - zr.min) / maxSpan - 0.5) * scale,
  }))
  return { normalized, scale: { x: xr.span, y: yr.span, z: zr.span }, offset: { x: xr.min, y: yr.min, z: zr.min }, ranges: { xr, yr, zr } }
}

function PointCloud({ data, pointSize, colorScheme, onPointClick }: {
  data: DataPoint3D[]
  pointSize: number
  colorScheme: string
  onPointClick?: (point: DataPoint3D, index: number) => void
}) {
  const [hovered, setHovered] = useState<number | null>(null)
  const { normalized } = useMemo(() => normalizeData(data), [data])
  const categories = useMemo(() => [...new Set(data.map(d => d.category || 'default'))], [data])

  const getColor = (point: DataPoint3D, idx: number) => {
    if (point.color) return point.color
    if (colorScheme === 'categorical' && point.category) {
      return CATEGORY_COLORS[categories.indexOf(point.category) % CATEGORY_COLORS.length]
    }
    if (colorScheme === 'viridis' || colorScheme === 'plasma') {
      const t = data.length > 1 ? idx / (data.length - 1) : 0.5
      return viridisColor(t)
    }
    return '#8b5cf6'
  }

  return (
    <group>
      {normalized.map((d, i) => {
        const color = getColor(data[i], i)
        const size = (data[i].size || pointSize) * (hovered === i ? 1.5 : 1)
        return (
          <group key={i}>
            <mesh
              position={[d.nx, d.ny, d.nz]}
              onPointerOver={() => setHovered(i)}
              onPointerOut={() => setHovered(null)}
              onClick={() => onPointClick?.(data[i], i)}
            >
              <sphereGeometry args={[size * 0.03, 16, 16]} />
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={hovered === i ? 0.5 : 0.1} />
            </mesh>
            {hovered === i && (
              <Html position={[d.nx, d.ny + 0.3, d.nz]} center>
                <div style={{
                  background: 'rgba(0,0,0,0.85)',
                  color: '#fff',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  whiteSpace: 'nowrap',
                  pointerEvents: 'none',
                  border: `1px solid ${color}40`,
                }}>
                  {data[i].label && <div style={{ fontWeight: 600 }}>{data[i].label}</div>}
                  <div>x: {data[i].x.toFixed(2)} | y: {data[i].y.toFixed(2)} | z: {data[i].z.toFixed(2)}</div>
                  {data[i].category && <div style={{ color: color }}>{data[i].category}</div>}
                </div>
              </Html>
            )}
          </group>
        )
      })}
    </group>
  )
}

function Axes({ xLabel, yLabel, zLabel }: { xLabel: string; yLabel: string; zLabel: string }) {
  return (
    <group>
      {/* X axis */}
      <line>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[new Float32Array([-2.5, -2.5, -2.5, 2.5, -2.5, -2.5]), 3]}
          />
        </bufferGeometry>
        <lineBasicMaterial color="#ef4444" opacity={0.6} transparent />
      </line>
      <Text position={[2.8, -2.5, -2.5]} fontSize={0.15} color="#ef4444" anchorX="left">{xLabel}</Text>

      {/* Y axis */}
      <line>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[new Float32Array([-2.5, -2.5, -2.5, -2.5, 2.5, -2.5]), 3]}
          />
        </bufferGeometry>
        <lineBasicMaterial color="#22c55e" opacity={0.6} transparent />
      </line>
      <Text position={[-2.5, 2.8, -2.5]} fontSize={0.15} color="#22c55e" anchorX="center">{yLabel}</Text>

      {/* Z axis */}
      <line>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[new Float32Array([-2.5, -2.5, -2.5, -2.5, -2.5, 2.5]), 3]}
          />
        </bufferGeometry>
        <lineBasicMaterial color="#3b82f6" opacity={0.6} transparent />
      </line>
      <Text position={[-2.5, -2.5, 2.8]} fontSize={0.15} color="#3b82f6" anchorX="center">{zLabel}</Text>
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
  xLabel = 'X',
  yLabel = 'Y',
  zLabel = 'Z',
  pointSize = 3,
  colorScheme = 'viridis',
  showGrid = true,
  showAxes = true,
  height = 400,
  onPointClick,
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
          <PointCloud data={data} pointSize={pointSize} colorScheme={colorScheme} onPointClick={onPointClick} />
          {showAxes && <Axes xLabel={xLabel} yLabel={yLabel} zLabel={zLabel} />}
          {showGrid && (
            <Grid
              args={[10, 10]}
              position={[0, -2.5, 0]}
              cellColor="#ffffff08"
              sectionColor="#ffffff15"
              fadeDistance={20}
              infiniteGrid
            />
          )}
        </RotatingGroup>

        <OrbitControls
          enableDamping
          dampingFactor={0.08}
          minDistance={3}
          maxDistance={20}
        />
      </Canvas>
      <div style={{ position: 'absolute', bottom: 8, left: 12, fontSize: '10px', color: 'var(--color-text-muted)' }}>
        {data.length} points | Drag to rotate, scroll to zoom
      </div>
    </div>
  )
}

export type { DataPoint3D, Plot3DProps }
