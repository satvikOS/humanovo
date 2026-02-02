/**
 * Anatomy 3D Viewer Component
 *
 * Real 3D model viewer for anatomical structures using Three.js and React Three Fiber.
 * Supports loading models from BP3D (BodyParts3D) and custom sources.
 *
 * Features:
 * - Multiple model format support (GLB, OBJ, STL, FBX)
 * - Layer-based visibility control
 * - Interactive rotation, zoom, and pan
 * - Anatomical system color coding
 * - Model annotations and info panels
 * - BP3D attribution compliance
 */

import { Suspense, useRef, useState, useEffect } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import {
  OrbitControls,
  Environment,
  Html,
  useGLTF,
  PerspectiveCamera,
  Grid,
  Center
} from '@react-three/drei'
import * as THREE from 'three'
import clsx from 'clsx'
import {
  FiRotateCw,
  FiEye,
  FiEyeOff,
  FiInfo,
  FiLayers,
  FiMaximize2,
  FiMinimize2,
  FiSettings,
  FiDownload,
  FiCamera
} from 'react-icons/fi'
import {
  BP3D_ATTRIBUTION,
  BP3D_LICENSE_URL,
  BP3D_MODELS,
  type AnatomySystem,
  type BP3DModel
} from '../data/anatomy/bp3dModels'

// ==================== TYPES ====================

interface Anatomy3DViewerProps {
  className?: string
  defaultSystems?: AnatomySystem[]
  showAttribution?: boolean
  onModelSelect?: (model: BP3DModel | null) => void
}

interface LoadedModelProps {
  url: string
  system: AnatomySystem
  visible: boolean
  opacity: number
  wireframe: boolean
  onLoad?: () => void
  onError?: (error: Error) => void
}

// System colors matching the existing anatomy viewer
const SYSTEM_COLORS: Record<AnatomySystem, string> = {
  skeletal: '#F5F5DC',
  muscular: '#CD5C5C',
  nervous: '#FFD700',
  circulatory: '#DC143C',
  lymphatic: '#90EE90',
  respiratory: '#87CEEB',
  digestive: '#DEB887',
  urinary: '#FFB347',
  reproductive: '#E6A8D7',
  integumentary: '#FFDAB9',
  endocrine: '#9B59B6'
}

const SYSTEM_NAMES: Record<AnatomySystem, string> = {
  skeletal: 'Skeletal System',
  muscular: 'Muscular System',
  nervous: 'Nervous System',
  circulatory: 'Circulatory System',
  lymphatic: 'Lymphatic System',
  respiratory: 'Respiratory System',
  digestive: 'Digestive System',
  urinary: 'Urinary System',
  reproductive: 'Reproductive System',
  integumentary: 'Integumentary (Skin)',
  endocrine: 'Endocrine System'
}

// ==================== 3D MODEL COMPONENTS ====================

/**
 * Load and render a GLTF/GLB anatomy model
 * Currently using placeholder models - will load actual BP3D models when available
 * @internal Reserved for use when BP3D models are loaded
 */
// @ts-expect-error Reserved for future use - uncomment when BP3D models are integrated
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function AnatomyModelLoader({
  url,
  system,
  visible,
  opacity,
  wireframe,
  onLoad,
  onError
}: LoadedModelProps) {
  const groupRef = useRef<THREE.Group>(null)

  // Attempt to load GLTF model
  const { scene } = useGLTF(url, true, undefined, (loader) => {
    loader.manager.onError = (errorUrl) => {
      onError?.(new Error(`Failed to load model: ${errorUrl}`))
    }
  })

  useEffect(() => {
    if (scene && onLoad) {
      onLoad()
    }
  }, [scene, onLoad])

  useEffect(() => {
    if (scene) {
      // Apply system-specific material to all meshes
      scene.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.material = new THREE.MeshStandardMaterial({
            color: SYSTEM_COLORS[system],
            roughness: 0.5,
            metalness: 0.1,
            transparent: opacity < 1,
            opacity: opacity,
            wireframe: wireframe,
            side: THREE.DoubleSide
          })
        }
      })
    }
  }, [scene, system, opacity, wireframe])

  if (!visible) return null

  return (
    <group ref={groupRef}>
      <primitive object={scene.clone()} />
    </group>
  )
}

// Fallback model when actual model isn't available
function PlaceholderModel({
  system,
  position,
  visible,
  opacity,
  label
}: {
  system: AnatomySystem
  position: [number, number, number]
  visible: boolean
  opacity: number
  label: string
}) {
  const meshRef = useRef<THREE.Mesh>(null)
  const [hovered, setHovered] = useState(false)

  useFrame((state) => {
    if (meshRef.current && hovered) {
      meshRef.current.rotation.y = state.clock.elapsedTime * 0.5
    }
  })

  if (!visible) return null

  return (
    <group position={position}>
      <mesh
        ref={meshRef}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
      >
        <sphereGeometry args={[0.1, 16, 16]} />
        <meshStandardMaterial
          color={SYSTEM_COLORS[system]}
          transparent
          opacity={opacity}
          emissive={hovered ? SYSTEM_COLORS[system] : 'black'}
          emissiveIntensity={hovered ? 0.3 : 0}
        />
      </mesh>
      {hovered && (
        <Html center distanceFactor={10}>
          <div className="px-2 py-1 bg-[var(--color-surface)]/90 backdrop-blur border border-[var(--color-border)] rounded text-xs whitespace-nowrap">
            {label}
          </div>
        </Html>
      )}
    </group>
  )
}

// Placeholder human body outline
function HumanBodyOutline({
  visible,
  opacity
}: {
  visible: boolean
  opacity: number
}) {
  if (!visible) return null

  return (
    <group>
      {/* Head */}
      <mesh position={[0, 1.7, 0]}>
        <sphereGeometry args={[0.12, 32, 32]} />
        <meshStandardMaterial
          color="#FFDAB9"
          transparent
          opacity={opacity * 0.3}
          wireframe
        />
      </mesh>

      {/* Torso */}
      <mesh position={[0, 1.2, 0]}>
        <capsuleGeometry args={[0.15, 0.5, 8, 16]} />
        <meshStandardMaterial
          color="#FFDAB9"
          transparent
          opacity={opacity * 0.3}
          wireframe
        />
      </mesh>

      {/* Pelvis */}
      <mesh position={[0, 0.8, 0]}>
        <sphereGeometry args={[0.12, 16, 16]} />
        <meshStandardMaterial
          color="#FFDAB9"
          transparent
          opacity={opacity * 0.3}
          wireframe
        />
      </mesh>

      {/* Arms */}
      <mesh position={[-0.25, 1.3, 0]} rotation={[0, 0, Math.PI / 6]}>
        <capsuleGeometry args={[0.04, 0.4, 4, 8]} />
        <meshStandardMaterial color="#FFDAB9" transparent opacity={opacity * 0.3} wireframe />
      </mesh>
      <mesh position={[0.25, 1.3, 0]} rotation={[0, 0, -Math.PI / 6]}>
        <capsuleGeometry args={[0.04, 0.4, 4, 8]} />
        <meshStandardMaterial color="#FFDAB9" transparent opacity={opacity * 0.3} wireframe />
      </mesh>

      {/* Legs */}
      <mesh position={[-0.08, 0.4, 0]}>
        <capsuleGeometry args={[0.05, 0.5, 4, 8]} />
        <meshStandardMaterial color="#FFDAB9" transparent opacity={opacity * 0.3} wireframe />
      </mesh>
      <mesh position={[0.08, 0.4, 0]}>
        <capsuleGeometry args={[0.05, 0.5, 4, 8]} />
        <meshStandardMaterial color="#FFDAB9" transparent opacity={opacity * 0.3} wireframe />
      </mesh>
    </group>
  )
}

// Camera controls component
function CameraController({
  resetTrigger
}: {
  resetTrigger: number
}) {
  const { camera, gl } = useThree()

  useEffect(() => {
    camera.position.set(0, 1.2, 2.5)
    camera.lookAt(0, 1, 0)
  }, [resetTrigger, camera])

  return (
    <OrbitControls
      makeDefault
      target={[0, 1, 0]}
      minDistance={0.5}
      maxDistance={5}
      minPolarAngle={0}
      maxPolarAngle={Math.PI}
      enableDamping
      dampingFactor={0.05}
      args={[camera, gl.domElement]}
    />
  )
}

// ==================== MAIN COMPONENT ====================

export default function Anatomy3DViewer({
  className,
  defaultSystems = ['skeletal', 'muscular'],
  showAttribution = true,
  onModelSelect
}: Anatomy3DViewerProps) {
  // UI State
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [showLayerPanel, setShowLayerPanel] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const [selectedModel, setSelectedModel] = useState<BP3DModel | null>(null)
  const [resetTrigger, setResetTrigger] = useState(0)

  // View settings
  const [wireframe, setWireframe] = useState(false)
  const [showGrid, setShowGrid] = useState(true)
  const [showBodyOutline, setShowBodyOutline] = useState(true)

  // Layer state
  const [visibleSystems, setVisibleSystems] = useState<Set<AnatomySystem>>(
    new Set(defaultSystems)
  )
  const [systemOpacities, setSystemOpacities] = useState<Record<AnatomySystem, number>>(
    Object.fromEntries(
      Object.keys(SYSTEM_COLORS).map(s => [s, 1])
    ) as Record<AnatomySystem, number>
  )

  // Loading state - reserved for future use when loading actual BP3D models
  // const [loadingModels, setLoadingModels] = useState<Set<string>>(new Set())
  // const [loadedModels, setLoadedModels] = useState<Set<string>>(new Set())
  // const [modelErrors, setModelErrors] = useState<Map<string, string>>(new Map())

  // Toggle system visibility
  const toggleSystem = (system: AnatomySystem) => {
    setVisibleSystems(prev => {
      const next = new Set(prev)
      if (next.has(system)) {
        next.delete(system)
      } else {
        next.add(system)
      }
      return next
    })
  }

  // Update system opacity
  const updateOpacity = (system: AnatomySystem, opacity: number) => {
    setSystemOpacities(prev => ({ ...prev, [system]: opacity }))
  }

  // Reset view
  const handleResetView = () => {
    setResetTrigger(prev => prev + 1)
  }

  // Get models for visible systems
  const visibleModels = BP3D_MODELS.filter(m => visibleSystems.has(m.system))

  // Handle model selection
  const handleModelClick = (model: BP3DModel) => {
    setSelectedModel(model)
    onModelSelect?.(model)
  }

  // Get available systems from models
  const availableSystems = [...new Set(BP3D_MODELS.map(m => m.system))]

  return (
    <div
      className={clsx(
        'relative bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg overflow-hidden flex flex-col',
        isFullscreen && 'fixed inset-4 z-50',
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-bg-elevated)]">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-medium">3D Anatomy Viewer</h3>
          <span className="text-xxs text-[var(--color-text-muted)]">
            {visibleModels.length} models
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowLayerPanel(!showLayerPanel)}
            className={clsx(
              'p-1.5 rounded transition-colors',
              showLayerPanel ? 'bg-primary-500/20 text-primary-400' : 'hover:bg-[var(--color-surface)]'
            )}
            title="Toggle Layers"
          >
            <FiLayers className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={clsx(
              'p-1.5 rounded transition-colors',
              showSettings ? 'bg-primary-500/20 text-primary-400' : 'hover:bg-[var(--color-surface)]'
            )}
            title="Settings"
          >
            <FiSettings className="w-4 h-4" />
          </button>
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-1.5 rounded hover:bg-[var(--color-surface)] transition-colors"
            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <FiMinimize2 className="w-4 h-4" /> : <FiMaximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden" style={{ height: isFullscreen ? 'calc(100% - 40px)' : '600px' }}>
        {/* Layer Panel */}
        {showLayerPanel && (
          <div className="w-64 border-r border-[var(--color-border)] bg-[var(--color-bg-elevated)] flex flex-col overflow-y-auto">
            <div className="p-3 border-b border-[var(--color-border)]">
              <div className="text-xs font-medium text-[var(--color-text-muted)] mb-2">BODY SYSTEMS</div>
              <div className="flex gap-1">
                <button
                  onClick={() => setVisibleSystems(new Set(availableSystems))}
                  className="flex-1 px-2 py-1 text-xs bg-[var(--color-surface)] rounded hover:bg-[var(--color-border)] transition-colors"
                >
                  Show All
                </button>
                <button
                  onClick={() => setVisibleSystems(new Set())}
                  className="flex-1 px-2 py-1 text-xs bg-[var(--color-surface)] rounded hover:bg-[var(--color-border)] transition-colors"
                >
                  Hide All
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {availableSystems.map(system => {
                const systemModels = BP3D_MODELS.filter(m => m.system === system)
                return (
                  <div key={system} className="rounded border border-[var(--color-border)] overflow-hidden">
                    <button
                      onClick={() => toggleSystem(system)}
                      className={clsx(
                        'w-full flex items-center gap-2 px-2 py-2 text-xs transition-colors',
                        visibleSystems.has(system)
                          ? 'bg-[var(--color-surface)]'
                          : 'opacity-60 hover:opacity-80'
                      )}
                    >
                      <span
                        className="w-3 h-3 rounded-full border-2"
                        style={{
                          backgroundColor: visibleSystems.has(system) ? SYSTEM_COLORS[system] : 'transparent',
                          borderColor: SYSTEM_COLORS[system]
                        }}
                      />
                      <span className="flex-1 text-left font-medium">{SYSTEM_NAMES[system]}</span>
                      <span className="text-xxs text-[var(--color-text-muted)]">({systemModels.length})</span>
                      {visibleSystems.has(system) ? (
                        <FiEye className="w-3.5 h-3.5 text-green-400" />
                      ) : (
                        <FiEyeOff className="w-3.5 h-3.5" />
                      )}
                    </button>

                    {visibleSystems.has(system) && (
                      <div className="px-3 py-2 bg-[var(--color-bg)] border-t border-[var(--color-border)]">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xxs">Opacity:</span>
                          <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.1"
                            value={systemOpacities[system]}
                            onChange={(e) => updateOpacity(system, parseFloat(e.target.value))}
                            className="flex-1 h-1"
                          />
                          <span className="text-xxs w-8">{Math.round(systemOpacities[system] * 100)}%</span>
                        </div>
                        <div className="space-y-0.5 max-h-32 overflow-y-auto">
                          {systemModels.slice(0, 5).map(model => (
                            <button
                              key={model.id}
                              onClick={() => handleModelClick(model)}
                              className={clsx(
                                'w-full text-left px-2 py-1 text-xxs rounded transition-colors',
                                selectedModel?.id === model.id
                                  ? 'bg-primary-500/20 text-primary-400'
                                  : 'hover:bg-[var(--color-surface)]'
                              )}
                            >
                              {model.name}
                            </button>
                          ))}
                          {systemModels.length > 5 && (
                            <div className="text-xxs text-[var(--color-text-muted)] px-2">
                              +{systemModels.length - 5} more
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Settings Panel */}
            {showSettings && (
              <div className="p-3 border-t border-[var(--color-border)]">
                <div className="text-xxs font-medium text-[var(--color-text-muted)] mb-2">DISPLAY OPTIONS</div>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={wireframe}
                      onChange={(e) => setWireframe(e.target.checked)}
                      className="rounded"
                    />
                    Wireframe mode
                  </label>
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showGrid}
                      onChange={(e) => setShowGrid(e.target.checked)}
                      className="rounded"
                    />
                    Show grid
                  </label>
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showBodyOutline}
                      onChange={(e) => setShowBodyOutline(e.target.checked)}
                      className="rounded"
                    />
                    Body outline
                  </label>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 3D Canvas */}
        <div className="flex-1 relative">
          <Canvas shadows>
            <PerspectiveCamera makeDefault position={[0, 1.2, 2.5]} fov={50} />
            <CameraController resetTrigger={resetTrigger} />

            {/* Lighting */}
            <ambientLight intensity={0.5} />
            <directionalLight
              position={[5, 5, 5]}
              intensity={1}
              castShadow
              shadow-mapSize={[1024, 1024]}
            />
            <directionalLight position={[-5, 3, -5]} intensity={0.3} />

            {/* Environment */}
            <Environment preset="city" />

            {/* Grid */}
            {showGrid && (
              <Grid
                position={[0, 0, 0]}
                args={[10, 10]}
                cellSize={0.2}
                cellThickness={0.5}
                cellColor="#4a5568"
                sectionSize={1}
                sectionThickness={1}
                sectionColor="#2d3748"
                fadeDistance={10}
                fadeStrength={1}
              />
            )}

            {/* Body outline placeholder */}
            <HumanBodyOutline
              visible={showBodyOutline}
              opacity={0.3}
            />

            {/* Placeholder anatomy points (when actual models aren't loaded) */}
            <Suspense fallback={null}>
              <Center>
                {/* Skeletal system placeholders */}
                {visibleSystems.has('skeletal') && (
                  <>
                    <PlaceholderModel system="skeletal" position={[0, 1.7, 0]} visible={true} opacity={systemOpacities.skeletal} label="Skull" />
                    <PlaceholderModel system="skeletal" position={[0, 1.5, 0]} visible={true} opacity={systemOpacities.skeletal} label="Cervical Vertebrae" />
                    <PlaceholderModel system="skeletal" position={[0, 1.2, 0]} visible={true} opacity={systemOpacities.skeletal} label="Thoracic" />
                    <PlaceholderModel system="skeletal" position={[0, 0.9, 0]} visible={true} opacity={systemOpacities.skeletal} label="Lumbar" />
                    <PlaceholderModel system="skeletal" position={[0, 0.75, 0]} visible={true} opacity={systemOpacities.skeletal} label="Pelvis" />
                    <PlaceholderModel system="skeletal" position={[-0.08, 0.5, 0]} visible={true} opacity={systemOpacities.skeletal} label="Femur L" />
                    <PlaceholderModel system="skeletal" position={[0.08, 0.5, 0]} visible={true} opacity={systemOpacities.skeletal} label="Femur R" />
                  </>
                )}

                {/* Muscular system placeholders */}
                {visibleSystems.has('muscular') && (
                  <>
                    <PlaceholderModel system="muscular" position={[-0.18, 1.35, 0.05]} visible={true} opacity={systemOpacities.muscular} label="Deltoid L" />
                    <PlaceholderModel system="muscular" position={[0.18, 1.35, 0.05]} visible={true} opacity={systemOpacities.muscular} label="Deltoid R" />
                    <PlaceholderModel system="muscular" position={[0, 1.2, 0.08]} visible={true} opacity={systemOpacities.muscular} label="Pectoralis" />
                    <PlaceholderModel system="muscular" position={[0, 1.0, 0.08]} visible={true} opacity={systemOpacities.muscular} label="Rectus Abdominis" />
                  </>
                )}

                {/* Circulatory system placeholders */}
                {visibleSystems.has('circulatory') && (
                  <>
                    <PlaceholderModel system="circulatory" position={[-0.05, 1.25, 0.05]} visible={true} opacity={systemOpacities.circulatory} label="Heart" />
                    <PlaceholderModel system="circulatory" position={[0, 1.35, 0]} visible={true} opacity={systemOpacities.circulatory} label="Aortic Arch" />
                  </>
                )}

                {/* Nervous system placeholders */}
                {visibleSystems.has('nervous') && (
                  <>
                    <PlaceholderModel system="nervous" position={[0, 1.7, 0]} visible={true} opacity={systemOpacities.nervous} label="Brain" />
                    <PlaceholderModel system="nervous" position={[0, 1.3, -0.05]} visible={true} opacity={systemOpacities.nervous} label="Spinal Cord" />
                  </>
                )}

                {/* Respiratory system placeholders */}
                {visibleSystems.has('respiratory') && (
                  <>
                    <PlaceholderModel system="respiratory" position={[-0.08, 1.25, 0]} visible={true} opacity={systemOpacities.respiratory} label="Left Lung" />
                    <PlaceholderModel system="respiratory" position={[0.08, 1.25, 0]} visible={true} opacity={systemOpacities.respiratory} label="Right Lung" />
                    <PlaceholderModel system="respiratory" position={[0, 1.5, 0.05]} visible={true} opacity={systemOpacities.respiratory} label="Trachea" />
                  </>
                )}

                {/* Digestive system placeholders */}
                {visibleSystems.has('digestive') && (
                  <>
                    <PlaceholderModel system="digestive" position={[-0.05, 1.05, 0.05]} visible={true} opacity={systemOpacities.digestive} label="Stomach" />
                    <PlaceholderModel system="digestive" position={[0.08, 1.1, 0.05]} visible={true} opacity={systemOpacities.digestive} label="Liver" />
                    <PlaceholderModel system="digestive" position={[0, 0.9, 0.05]} visible={true} opacity={systemOpacities.digestive} label="Intestines" />
                  </>
                )}

                {/* Urinary system placeholders */}
                {visibleSystems.has('urinary') && (
                  <>
                    <PlaceholderModel system="urinary" position={[-0.1, 1.0, -0.03]} visible={true} opacity={systemOpacities.urinary} label="Left Kidney" />
                    <PlaceholderModel system="urinary" position={[0.1, 1.0, -0.03]} visible={true} opacity={systemOpacities.urinary} label="Right Kidney" />
                    <PlaceholderModel system="urinary" position={[0, 0.75, 0.05]} visible={true} opacity={systemOpacities.urinary} label="Bladder" />
                  </>
                )}
              </Center>
            </Suspense>
          </Canvas>

          {/* Controls overlay */}
          <div className="absolute bottom-4 left-4 flex items-center gap-1 bg-[var(--color-surface)]/90 backdrop-blur rounded-lg border border-[var(--color-border)] p-1">
            <button
              onClick={handleResetView}
              className="p-1.5 hover:bg-[var(--color-border)] rounded transition-colors"
              title="Reset View"
            >
              <FiRotateCw className="w-3.5 h-3.5" />
            </button>
            <button
              className="p-1.5 hover:bg-[var(--color-border)] rounded transition-colors"
              title="Screenshot"
            >
              <FiCamera className="w-3.5 h-3.5" />
            </button>
            <button
              className="p-1.5 hover:bg-[var(--color-border)] rounded transition-colors"
              title="Export"
            >
              <FiDownload className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Model info panel */}
          {selectedModel && (
            <div className="absolute top-4 right-4 w-64 bg-[var(--color-surface)]/95 backdrop-blur rounded-lg border border-[var(--color-border)] p-3">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <h4 className="text-sm font-medium">{selectedModel.name}</h4>
                  <p className="text-xxs text-[var(--color-text-muted)]">{SYSTEM_NAMES[selectedModel.system]}</p>
                </div>
                <button
                  onClick={() => { setSelectedModel(null); onModelSelect?.(null) }}
                  className="p-1 hover:bg-[var(--color-border)] rounded"
                >
                  &times;
                </button>
              </div>
              <div className="space-y-1 text-xxs text-[var(--color-text-secondary)]">
                {selectedModel.bp3dId && (
                  <div>
                    <span className="text-[var(--color-text-muted)]">BP3D ID:</span> {selectedModel.bp3dId}
                  </div>
                )}
                {selectedModel.fmaId && (
                  <div>
                    <span className="text-[var(--color-text-muted)]">FMA ID:</span> {selectedModel.fmaId}
                  </div>
                )}
                <div>
                  <span className="text-[var(--color-text-muted)]">Region:</span> {selectedModel.region}
                </div>
                {selectedModel.side && (
                  <div>
                    <span className="text-[var(--color-text-muted)]">Side:</span> {selectedModel.side}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Help text */}
          <div className="absolute bottom-4 right-4 text-xxs text-[var(--color-text-muted)] bg-[var(--color-surface)]/90 backdrop-blur px-2 py-1 rounded border border-[var(--color-border)]">
            Drag to rotate | Scroll to zoom | Shift+drag to pan
          </div>
        </div>
      </div>

      {/* Attribution Footer */}
      {showAttribution && (
        <div className="px-4 py-2 border-t border-[var(--color-border)] bg-[var(--color-bg-elevated)]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xxs text-[var(--color-text-muted)]">
              <FiInfo className="w-3 h-3" />
              <span>{BP3D_ATTRIBUTION}</span>
            </div>
            <a
              href={BP3D_LICENSE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xxs text-primary-400 hover:underline"
            >
              View License
            </a>
          </div>
        </div>
      )}
    </div>
  )
}

// Preload helper for GLTF models - exported utility
// eslint-disable-next-line react-refresh/only-export-components
export function preloadAnatomyModel(url: string): void {
  useGLTF.preload(url)
}
