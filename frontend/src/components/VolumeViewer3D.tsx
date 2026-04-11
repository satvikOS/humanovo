/**
 * VolumeViewer3D — 3D Orthogonal Slice Viewer for Medical Imaging
 * Renders three intersecting planes (axial, coronal, sagittal) in 3D space
 * with orbit controls. Uses React Three Fiber + Three.js directly.
 */
import { useRef, useMemo, useEffect } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

interface VolumeViewer3DProps {
  imageData: string           // base64 data URL
  width: number
  height: number
  slicePos: { axial: number; coronal: number; sagittal: number }  // 0-100
  modality: string
}

/* ── Orbit Controls (manual — no @react-three/drei) ─── */
function OrbitController() {
  const { camera, gl } = useThree()
  const isDown = useRef(false)
  const prev = useRef({ x: 0, y: 0 })
  const spherical = useRef({ theta: Math.PI / 4, phi: Math.PI / 3, radius: 3.2 })

  useEffect(() => {
    const el = gl.domElement
    const onDown = (e: PointerEvent) => { isDown.current = true; prev.current = { x: e.clientX, y: e.clientY }; el.setPointerCapture(e.pointerId) }
    const onUp = () => { isDown.current = false }
    const onMove = (e: PointerEvent) => {
      if (!isDown.current) return
      const dx = e.clientX - prev.current.x
      const dy = e.clientY - prev.current.y
      prev.current = { x: e.clientX, y: e.clientY }
      spherical.current.theta -= dx * 0.008
      spherical.current.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.current.phi - dy * 0.008))
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      spherical.current.radius = Math.max(1.5, Math.min(8, spherical.current.radius + e.deltaY * 0.005))
    }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointerup', onUp)
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

/* ── Wireframe bounding box ─── */
function BoundingBox() {
  const ref = useRef<THREE.LineSegments>(null)
  const geometry = useMemo(() => new THREE.BoxGeometry(2, 2, 2), [])
  const edges = useMemo(() => new THREE.EdgesGeometry(geometry), [geometry])
  return (
    <lineSegments ref={ref}>
      <primitive object={edges} attach="geometry" />
      <lineBasicMaterial color="#ffffff" opacity={0.15} transparent />
    </lineSegments>
  )
}

/* ── Axis labels ─── */
function AxisIndicators() {
  return (
    <group>
      {/* X axis */}
      <line>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[new Float32Array([-1.2, -1.2, -1.2, 1.2, -1.2, -1.2]), 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#ef4444" opacity={0.5} transparent />
      </line>
      {/* Y axis */}
      <line>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[new Float32Array([-1.2, -1.2, -1.2, -1.2, 1.2, -1.2]), 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#22c55e" opacity={0.5} transparent />
      </line>
      {/* Z axis */}
      <line>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[new Float32Array([-1.2, -1.2, -1.2, -1.2, -1.2, 1.2]), 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#3b82f6" opacity={0.5} transparent />
      </line>
    </group>
  )
}

/* ── Textured slice planes ─── */
function SlicePlanes({ imageData, width, height, slicePos }: {
  imageData: string; width: number; height: number
  slicePos: { axial: number; coronal: number; sagittal: number }
}) {
  const texture = useMemo(() => {
    const tex = new THREE.TextureLoader().load(imageData)
    tex.minFilter = THREE.LinearFilter
    tex.magFilter = THREE.LinearFilter
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
  }, [imageData])

  // Compute aspect ratio for proper plane proportions
  const aspect = width / height

  // Axial plane: horizontal at Y position (blue)
  const axialY = (slicePos.axial / 50 - 1)  // -1 to 1
  // Coronal plane: vertical front-back at Z position (green)
  const coronalZ = (slicePos.coronal / 50 - 1)
  // Sagittal plane: vertical left-right at X position (red)
  const sagittalX = (slicePos.sagittal / 50 - 1)

  return (
    <group>
      {/* Axial — XZ plane at Y */}
      <mesh position={[0, axialY, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[2, 2 / aspect]} />
        <meshBasicMaterial map={texture} side={THREE.DoubleSide} opacity={0.85} transparent />
      </mesh>
      {/* Axial border */}
      <lineLoop position={[0, axialY, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[new Float32Array([
            -1, -1 / aspect, 0, 1, -1 / aspect, 0, 1, 1 / aspect, 0, -1, 1 / aspect, 0
          ]), 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#3b82f6" linewidth={2} />
      </lineLoop>

      {/* Coronal — XY plane at Z */}
      <mesh position={[0, 0, coronalZ]}>
        <planeGeometry args={[2, 2]} />
        <meshBasicMaterial map={texture} side={THREE.DoubleSide} opacity={0.55} transparent />
      </mesh>
      <lineLoop position={[0, 0, coronalZ]}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[new Float32Array([
            -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0
          ]), 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#22c55e" linewidth={2} />
      </lineLoop>

      {/* Sagittal — YZ plane at X */}
      <mesh position={[sagittalX, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[2 / aspect, 2]} />
        <meshBasicMaterial map={texture} side={THREE.DoubleSide} opacity={0.55} transparent />
      </mesh>
      <lineLoop position={[sagittalX, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[new Float32Array([
            -1 / aspect, -1, 0, 1 / aspect, -1, 0, 1 / aspect, 1, 0, -1 / aspect, 1, 0
          ]), 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#ef4444" linewidth={2} />
      </lineLoop>

      {/* Crosshair lines at slice intersections */}
      {/* Axial-Coronal intersection */}
      <line>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[new Float32Array([
            -1, axialY, coronalZ, 1, axialY, coronalZ
          ]), 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#f59e0b" opacity={0.6} transparent />
      </line>
      {/* Axial-Sagittal intersection */}
      <line>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[new Float32Array([
            sagittalX, axialY, -1, sagittalX, axialY, 1
          ]), 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#f59e0b" opacity={0.6} transparent />
      </line>
      {/* Coronal-Sagittal intersection */}
      <line>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[new Float32Array([
            sagittalX, -1, coronalZ, sagittalX, 1, coronalZ
          ]), 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#f59e0b" opacity={0.6} transparent />
      </line>
    </group>
  )
}

/* ── Main Viewer ─── */
export default function VolumeViewer3D({ imageData, width, height, slicePos, modality }: VolumeViewer3DProps) {
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Canvas
        camera={{ position: [2.3, 1.8, 2.3], fov: 45, near: 0.1, far: 100 }}
        gl={{ antialias: true, alpha: true }}
        style={{ background: '#06060a' }}
      >
        <ambientLight intensity={0.8} />
        <directionalLight position={[3, 5, 3]} intensity={0.4} />
        <OrbitController />
        <BoundingBox />
        <AxisIndicators />
        <SlicePlanes imageData={imageData} width={width} height={height} slicePos={slicePos} />
      </Canvas>
      {/* Overlay labels */}
      <div style={{ position: 'absolute', top: 6, left: 8, color: '#fff', fontSize: 10, fontWeight: 700, textShadow: '0 1px 4px #000', pointerEvents: 'none' }}>
        3D VIEW
      </div>
      <div style={{ position: 'absolute', bottom: 6, left: 8, fontSize: 9, color: '#fff6', pointerEvents: 'none' }}>
        {modality} &middot; {width}&times;{height} &middot; Drag to rotate
      </div>
      <div style={{ position: 'absolute', bottom: 6, right: 8, display: 'flex', gap: 8, fontSize: 9, pointerEvents: 'none' }}>
        <span style={{ color: '#3b82f6' }}>&#9632; Axial</span>
        <span style={{ color: '#22c55e' }}>&#9632; Coronal</span>
        <span style={{ color: '#ef4444' }}>&#9632; Sagittal</span>
      </div>
    </div>
  )
}
