import { useState, useRef, useEffect, useCallback } from 'react'
import {
  FiRotateCw,
  FiZoomIn,
  FiZoomOut,
  FiEye,
  FiEyeOff,
  FiInfo,
  FiLayers,
  FiMaximize2,
  FiMinimize2,
  FiUser,
  FiMessageSquare,
  FiSend,
  FiChevronRight,
  FiChevronDown,
  FiSearch,
  FiCrosshair,
  FiActivity,
  FiHeart,
  FiCpu
} from 'react-icons/fi'
import clsx from 'clsx'

// Import Master Library for integration
import {
  completeSkeleton,
  completeMuscularSystem,
  cranialNerves,
  spinalPlexuses,
  allHistologicalTissues,
  findElementById,
  BiologicalElement
} from '../data/MasterHumanLibraryIndex'

// ==================== TYPES ====================

type Sex = 'male' | 'female'

type AnatomySystem =
  | 'skeletal'
  | 'muscular'
  | 'nervous'
  | 'circulatory'
  | 'lymphatic'
  | 'respiratory'
  | 'digestive'
  | 'integumentary'
  | 'organs'

interface AnatomyLayerConfig {
  id: AnatomySystem
  name: string
  color: string
  icon: React.ReactNode
  elements: BiologicalElement[]
}

interface AnatomyPoint {
  id: string
  name: string
  system: AnatomySystem
  x: number // Relative position 0-1
  y: number // Relative position 0-1
  z: number // Depth for 3D effect
  libraryId?: string // Link to Master Library element
  description?: string
}

interface HoveredPoint {
  point: AnatomyPoint
  screenX: number
  screenY: number
}

// ==================== ANATOMY DATA ====================

const anatomyLayers: AnatomyLayerConfig[] = [
  {
    id: 'skeletal',
    name: 'Skeletal System',
    color: '#F5F5DC',
    icon: <span className="text-xs">&#129460;</span>,
    elements: completeSkeleton
  },
  {
    id: 'muscular',
    name: 'Muscular System',
    color: '#CD5C5C',
    icon: <FiActivity className="w-3.5 h-3.5" />,
    elements: completeMuscularSystem
  },
  {
    id: 'nervous',
    name: 'Nervous System',
    color: '#FFD700',
    icon: <FiCpu className="w-3.5 h-3.5" />,
    elements: [...cranialNerves, ...spinalPlexuses]
  },
  {
    id: 'circulatory',
    name: 'Circulatory System',
    color: '#DC143C',
    icon: <FiHeart className="w-3.5 h-3.5" />,
    elements: []
  },
  {
    id: 'lymphatic',
    name: 'Lymphatic System',
    color: '#90EE90',
    icon: <FiActivity className="w-3.5 h-3.5" />,
    elements: []
  },
  {
    id: 'respiratory',
    name: 'Respiratory System',
    color: '#87CEEB',
    icon: <span className="text-xs">&#129729;</span>,
    elements: []
  },
  {
    id: 'digestive',
    name: 'Digestive System',
    color: '#DEB887',
    icon: <span className="text-xs">&#127829;</span>,
    elements: []
  },
  {
    id: 'organs',
    name: 'Internal Organs',
    color: '#E6A8D7',
    icon: <span className="text-xs">&#129728;</span>,
    elements: []
  },
  {
    id: 'integumentary',
    name: 'Integumentary (Skin)',
    color: '#FFDAB9',
    icon: <FiUser className="w-3.5 h-3.5" />,
    elements: allHistologicalTissues.filter(t => t.subcategory?.includes('Epithelial'))
  }
]

// Anatomical landmark points for visualization
const anatomyPoints: AnatomyPoint[] = [
  // Skeletal System Points
  { id: 'skull', name: 'Skull (Cranium)', system: 'skeletal', x: 0.5, y: 0.08, z: 0.5, libraryId: 'bone_frontal', description: 'Protects brain, comprises 22 bones' },
  { id: 'cervical', name: 'Cervical Vertebrae', system: 'skeletal', x: 0.5, y: 0.15, z: 0.3, libraryId: 'bone_cervical_vertebrae', description: 'C1-C7, supports head' },
  { id: 'clavicle_l', name: 'Left Clavicle', system: 'skeletal', x: 0.35, y: 0.18, z: 0.6, libraryId: 'bone_clavicle', description: 'Collarbone' },
  { id: 'clavicle_r', name: 'Right Clavicle', system: 'skeletal', x: 0.65, y: 0.18, z: 0.6, libraryId: 'bone_clavicle', description: 'Collarbone' },
  { id: 'scapula_l', name: 'Left Scapula', system: 'skeletal', x: 0.28, y: 0.22, z: 0.2, libraryId: 'bone_scapula', description: 'Shoulder blade' },
  { id: 'scapula_r', name: 'Right Scapula', system: 'skeletal', x: 0.72, y: 0.22, z: 0.2, libraryId: 'bone_scapula', description: 'Shoulder blade' },
  { id: 'sternum', name: 'Sternum', system: 'skeletal', x: 0.5, y: 0.25, z: 0.7, libraryId: 'bone_sternum', description: 'Breastbone' },
  { id: 'ribs', name: 'Rib Cage', system: 'skeletal', x: 0.5, y: 0.30, z: 0.5, libraryId: 'bone_ribs', description: '24 ribs protect thoracic organs' },
  { id: 'humerus_l', name: 'Left Humerus', system: 'skeletal', x: 0.22, y: 0.32, z: 0.5, libraryId: 'bone_humerus', description: 'Upper arm bone' },
  { id: 'humerus_r', name: 'Right Humerus', system: 'skeletal', x: 0.78, y: 0.32, z: 0.5, libraryId: 'bone_humerus', description: 'Upper arm bone' },
  { id: 'spine_thoracic', name: 'Thoracic Vertebrae', system: 'skeletal', x: 0.5, y: 0.32, z: 0.2, libraryId: 'bone_thoracic_vertebrae', description: 'T1-T12' },
  { id: 'spine_lumbar', name: 'Lumbar Vertebrae', system: 'skeletal', x: 0.5, y: 0.42, z: 0.25, libraryId: 'bone_lumbar_vertebrae', description: 'L1-L5, lower back' },
  { id: 'radius_l', name: 'Left Radius', system: 'skeletal', x: 0.18, y: 0.44, z: 0.55, libraryId: 'bone_radius', description: 'Lateral forearm bone' },
  { id: 'ulna_l', name: 'Left Ulna', system: 'skeletal', x: 0.20, y: 0.44, z: 0.45, libraryId: 'bone_ulna', description: 'Medial forearm bone' },
  { id: 'pelvis', name: 'Pelvis (Hip Bone)', system: 'skeletal', x: 0.5, y: 0.48, z: 0.5, libraryId: 'bone_hip', description: 'Supports trunk, protects pelvic organs' },
  { id: 'sacrum', name: 'Sacrum', system: 'skeletal', x: 0.5, y: 0.50, z: 0.3, libraryId: 'bone_sacrum', description: 'Fused vertebrae at spine base' },
  { id: 'femur_l', name: 'Left Femur', system: 'skeletal', x: 0.38, y: 0.62, z: 0.5, libraryId: 'bone_femur', description: 'Thigh bone - longest bone' },
  { id: 'femur_r', name: 'Right Femur', system: 'skeletal', x: 0.62, y: 0.62, z: 0.5, libraryId: 'bone_femur', description: 'Thigh bone - longest bone' },
  { id: 'patella_l', name: 'Left Patella', system: 'skeletal', x: 0.40, y: 0.72, z: 0.7, libraryId: 'bone_patella', description: 'Kneecap' },
  { id: 'patella_r', name: 'Right Patella', system: 'skeletal', x: 0.60, y: 0.72, z: 0.7, libraryId: 'bone_patella', description: 'Kneecap' },
  { id: 'tibia_l', name: 'Left Tibia', system: 'skeletal', x: 0.40, y: 0.82, z: 0.55, libraryId: 'bone_tibia', description: 'Shinbone' },
  { id: 'fibula_l', name: 'Left Fibula', system: 'skeletal', x: 0.36, y: 0.82, z: 0.45, libraryId: 'bone_fibula', description: 'Lateral lower leg bone' },
  { id: 'foot_l', name: 'Left Foot', system: 'skeletal', x: 0.40, y: 0.95, z: 0.5, libraryId: 'bone_metatarsals', description: 'Tarsals, metatarsals, phalanges' },
  { id: 'foot_r', name: 'Right Foot', system: 'skeletal', x: 0.60, y: 0.95, z: 0.5, libraryId: 'bone_metatarsals', description: 'Tarsals, metatarsals, phalanges' },

  // Muscular System Points
  { id: 'frontalis', name: 'Frontalis', system: 'muscular', x: 0.5, y: 0.05, z: 0.7, libraryId: 'muscle_frontalis', description: 'Raises eyebrows' },
  { id: 'temporalis', name: 'Temporalis', system: 'muscular', x: 0.42, y: 0.08, z: 0.6, libraryId: 'muscle_temporalis', description: 'Jaw closure' },
  { id: 'masseter', name: 'Masseter', system: 'muscular', x: 0.42, y: 0.11, z: 0.7, libraryId: 'muscle_masseter', description: 'Jaw closure - chewing' },
  { id: 'scm', name: 'Sternocleidomastoid', system: 'muscular', x: 0.42, y: 0.14, z: 0.65, libraryId: 'muscle_sternocleidomastoid', description: 'Head rotation and flexion' },
  { id: 'trapezius', name: 'Trapezius', system: 'muscular', x: 0.5, y: 0.18, z: 0.25, libraryId: 'muscle_trapezius', description: 'Shoulder elevation' },
  { id: 'deltoid_l', name: 'Left Deltoid', system: 'muscular', x: 0.25, y: 0.22, z: 0.6, libraryId: 'muscle_deltoid', description: 'Shoulder abduction' },
  { id: 'deltoid_r', name: 'Right Deltoid', system: 'muscular', x: 0.75, y: 0.22, z: 0.6, libraryId: 'muscle_deltoid', description: 'Shoulder abduction' },
  { id: 'pec_major', name: 'Pectoralis Major', system: 'muscular', x: 0.5, y: 0.26, z: 0.8, libraryId: 'muscle_pectoralis_major', description: 'Arm adduction' },
  { id: 'biceps_l', name: 'Left Biceps Brachii', system: 'muscular', x: 0.22, y: 0.32, z: 0.65, libraryId: 'muscle_biceps', description: 'Elbow flexion' },
  { id: 'triceps_l', name: 'Left Triceps Brachii', system: 'muscular', x: 0.22, y: 0.32, z: 0.35, libraryId: 'muscle_triceps', description: 'Elbow extension' },
  { id: 'latissimus', name: 'Latissimus Dorsi', system: 'muscular', x: 0.5, y: 0.35, z: 0.15, libraryId: 'muscle_latissimus_dorsi', description: 'Arm adduction' },
  { id: 'rectus_abdominis', name: 'Rectus Abdominis', system: 'muscular', x: 0.5, y: 0.40, z: 0.8, libraryId: 'muscle_rectus_abdominis', description: 'Core flexion' },
  { id: 'external_oblique', name: 'External Oblique', system: 'muscular', x: 0.40, y: 0.42, z: 0.7, libraryId: 'muscle_external_oblique', description: 'Trunk rotation' },
  { id: 'glute_max', name: 'Gluteus Maximus', system: 'muscular', x: 0.5, y: 0.52, z: 0.2, libraryId: 'muscle_gluteus_maximus', description: 'Hip extension' },
  { id: 'quadriceps_l', name: 'Left Quadriceps', system: 'muscular', x: 0.40, y: 0.62, z: 0.7, libraryId: 'muscle_quadriceps', description: 'Knee extension' },
  { id: 'hamstrings_l', name: 'Left Hamstrings', system: 'muscular', x: 0.40, y: 0.62, z: 0.25, libraryId: 'muscle_hamstrings', description: 'Knee flexion' },
  { id: 'gastrocnemius_l', name: 'Left Gastrocnemius', system: 'muscular', x: 0.40, y: 0.80, z: 0.35, libraryId: 'muscle_gastrocnemius', description: 'Plantar flexion' },
  { id: 'tibialis_ant_l', name: 'Left Tibialis Anterior', system: 'muscular', x: 0.40, y: 0.80, z: 0.65, libraryId: 'muscle_tibialis_anterior', description: 'Dorsiflexion' },

  // Nervous System Points
  { id: 'brain', name: 'Brain', system: 'nervous', x: 0.5, y: 0.06, z: 0.5, description: 'Central control organ' },
  { id: 'cn_ii', name: 'Optic Nerve (CN II)', system: 'nervous', x: 0.48, y: 0.09, z: 0.75, libraryId: 'cn_ii_optic', description: 'Vision pathway' },
  { id: 'cn_vii', name: 'Facial Nerve (CN VII)', system: 'nervous', x: 0.44, y: 0.10, z: 0.7, libraryId: 'cn_vii_facial', description: 'Facial expression' },
  { id: 'cn_x', name: 'Vagus Nerve (CN X)', system: 'nervous', x: 0.45, y: 0.14, z: 0.55, libraryId: 'cn_x_vagus', description: 'Parasympathetic - longest CN' },
  { id: 'brachial_plexus', name: 'Brachial Plexus', system: 'nervous', x: 0.35, y: 0.20, z: 0.5, libraryId: 'plexus_brachial', description: 'Upper limb innervation' },
  { id: 'spinal_cord', name: 'Spinal Cord', system: 'nervous', x: 0.5, y: 0.35, z: 0.2, description: 'Neural highway' },
  { id: 'lumbar_plexus', name: 'Lumbar Plexus', system: 'nervous', x: 0.45, y: 0.46, z: 0.4, libraryId: 'plexus_lumbar', description: 'L1-L4 - thigh innervation' },
  { id: 'sciatic', name: 'Sciatic Nerve', system: 'nervous', x: 0.42, y: 0.55, z: 0.3, libraryId: 'nerve_sciatic', description: 'Largest nerve in body' },
  { id: 'femoral_nerve', name: 'Femoral Nerve', system: 'nervous', x: 0.42, y: 0.55, z: 0.6, libraryId: 'nerve_femoral', description: 'Knee extension' },

  // Circulatory System Points
  { id: 'heart', name: 'Heart', system: 'circulatory', x: 0.48, y: 0.28, z: 0.6, description: 'Cardiac pump - 4 chambers' },
  { id: 'aortic_arch', name: 'Aortic Arch', system: 'circulatory', x: 0.5, y: 0.24, z: 0.5, description: 'Main arterial trunk' },
  { id: 'carotid_l', name: 'Left Carotid Artery', system: 'circulatory', x: 0.45, y: 0.14, z: 0.6, description: 'Brain blood supply' },
  { id: 'subclavian_l', name: 'Left Subclavian Artery', system: 'circulatory', x: 0.35, y: 0.20, z: 0.5, description: 'Upper limb supply' },
  { id: 'abdominal_aorta', name: 'Abdominal Aorta', system: 'circulatory', x: 0.5, y: 0.40, z: 0.4, description: 'Abdominal blood supply' },
  { id: 'iliac_l', name: 'Left Iliac Artery', system: 'circulatory', x: 0.42, y: 0.50, z: 0.5, description: 'Lower limb supply' },
  { id: 'femoral_art_l', name: 'Left Femoral Artery', system: 'circulatory', x: 0.42, y: 0.58, z: 0.6, description: 'Thigh blood supply' },

  // Respiratory System Points
  { id: 'nasal_cavity', name: 'Nasal Cavity', system: 'respiratory', x: 0.5, y: 0.09, z: 0.85, description: 'Air warming and filtering' },
  { id: 'pharynx', name: 'Pharynx', system: 'respiratory', x: 0.5, y: 0.13, z: 0.5, description: 'Throat passage' },
  { id: 'larynx', name: 'Larynx', system: 'respiratory', x: 0.5, y: 0.15, z: 0.65, description: 'Voice box' },
  { id: 'trachea', name: 'Trachea', system: 'respiratory', x: 0.5, y: 0.20, z: 0.6, description: 'Windpipe' },
  { id: 'lung_l', name: 'Left Lung', system: 'respiratory', x: 0.38, y: 0.30, z: 0.5, description: 'Gas exchange - 2 lobes' },
  { id: 'lung_r', name: 'Right Lung', system: 'respiratory', x: 0.62, y: 0.30, z: 0.5, description: 'Gas exchange - 3 lobes' },
  { id: 'diaphragm', name: 'Diaphragm', system: 'respiratory', x: 0.5, y: 0.38, z: 0.5, description: 'Primary breathing muscle' },

  // Digestive System Points
  { id: 'oral_cavity', name: 'Oral Cavity', system: 'digestive', x: 0.5, y: 0.11, z: 0.8, description: 'Food intake, initial digestion' },
  { id: 'esophagus', name: 'Esophagus', system: 'digestive', x: 0.5, y: 0.22, z: 0.35, description: 'Food passage to stomach' },
  { id: 'stomach', name: 'Stomach', system: 'digestive', x: 0.45, y: 0.38, z: 0.6, description: 'Chemical digestion' },
  { id: 'liver', name: 'Liver', system: 'digestive', x: 0.58, y: 0.36, z: 0.6, description: 'Metabolism, detoxification' },
  { id: 'gallbladder', name: 'Gallbladder', system: 'digestive', x: 0.56, y: 0.38, z: 0.65, description: 'Bile storage' },
  { id: 'pancreas', name: 'Pancreas', system: 'digestive', x: 0.52, y: 0.40, z: 0.45, description: 'Digestive enzymes, insulin' },
  { id: 'small_intestine', name: 'Small Intestine', system: 'digestive', x: 0.5, y: 0.46, z: 0.6, description: 'Nutrient absorption' },
  { id: 'large_intestine', name: 'Large Intestine', system: 'digestive', x: 0.5, y: 0.50, z: 0.55, description: 'Water absorption' },

  // Organs
  { id: 'kidney_l', name: 'Left Kidney', system: 'organs', x: 0.38, y: 0.40, z: 0.3, description: 'Blood filtration' },
  { id: 'kidney_r', name: 'Right Kidney', system: 'organs', x: 0.62, y: 0.41, z: 0.3, description: 'Blood filtration' },
  { id: 'spleen', name: 'Spleen', system: 'organs', x: 0.35, y: 0.38, z: 0.4, description: 'Blood filtering, immune function' },
  { id: 'bladder', name: 'Urinary Bladder', system: 'organs', x: 0.5, y: 0.54, z: 0.7, description: 'Urine storage' },

  // Lymphatic System Points
  { id: 'cervical_nodes', name: 'Cervical Lymph Nodes', system: 'lymphatic', x: 0.45, y: 0.13, z: 0.55, description: 'Head/neck drainage' },
  { id: 'axillary_nodes', name: 'Axillary Lymph Nodes', system: 'lymphatic', x: 0.30, y: 0.25, z: 0.5, description: 'Upper limb drainage' },
  { id: 'thymus', name: 'Thymus', system: 'lymphatic', x: 0.5, y: 0.23, z: 0.6, description: 'T cell maturation' },
  { id: 'thoracic_duct', name: 'Thoracic Duct', system: 'lymphatic', x: 0.48, y: 0.35, z: 0.3, description: 'Main lymphatic vessel' },
  { id: 'inguinal_nodes', name: 'Inguinal Lymph Nodes', system: 'lymphatic', x: 0.42, y: 0.52, z: 0.65, description: 'Lower limb drainage' }
]

// ==================== COMPONENT ====================

interface HumanAnatomyViewerProps {
  className?: string
  onElementSelect?: (element: BiologicalElement | null) => void
}

export default function HumanAnatomyViewer({ className, onElementSelect }: HumanAnatomyViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // View state
  const [sex, setSex] = useState<Sex>('male')
  const [rotation, setRotation] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [isDragging, setIsDragging] = useState(false)
  const [lastMouse, setLastMouse] = useState({ x: 0, y: 0 })
  const [isFullscreen, setIsFullscreen] = useState(false)

  // Layer visibility
  const [visibleLayers, setVisibleLayers] = useState<Set<AnatomySystem>>(
    new Set(['skeletal', 'muscular', 'organs'])
  )

  // Interaction state
  const [hoveredPoint, setHoveredPoint] = useState<HoveredPoint | null>(null)
  const [selectedPoint, setSelectedPoint] = useState<AnatomyPoint | null>(null)
  const [showLayerPanel, setShowLayerPanel] = useState(true)

  // AI Prompt state
  const [aiPrompt, setAiPrompt] = useState('')
  const [showAiPanel, setShowAiPanel] = useState(false)

  // Toggle layer visibility
  const toggleLayer = (layer: AnatomySystem) => {
    setVisibleLayers(prev => {
      const next = new Set(prev)
      if (next.has(layer)) {
        next.delete(layer)
      } else {
        next.add(layer)
      }
      return next
    })
  }

  // Get visible anatomy points
  const visiblePoints = anatomyPoints.filter(p => visibleLayers.has(p.system))

  // Calculate 3D to 2D projection
  const project3D = useCallback((x: number, y: number, z: number, width: number, height: number) => {
    const centerX = width / 2
    const centerY = height / 2
    const scale = Math.min(width, height) * 0.4 * zoom

    // Apply rotation
    const cosY = Math.cos(rotation.y)
    const sinY = Math.sin(rotation.y)
    const cosX = Math.cos(rotation.x * 0.3) // Limit vertical rotation

    const x3d = (x - 0.5) * 2
    const y3d = (y - 0.5) * 2
    const z3d = (z - 0.5) * 2

    // Rotate around Y axis
    const rotatedX = x3d * cosY - z3d * sinY
    const rotatedZ = x3d * sinY + z3d * cosY

    // Rotate around X axis (limited)
    const rotatedY = y3d * cosX - rotatedZ * (1 - cosX) * 0.3

    // Project to 2D with perspective
    const perspective = 3
    const projectedScale = perspective / (perspective + rotatedZ * 0.5)

    return {
      x: centerX + rotatedX * scale * projectedScale,
      y: centerY + rotatedY * scale * projectedScale,
      scale: projectedScale,
      depth: rotatedZ
    }
  }, [rotation, zoom])

  // Draw the anatomy visualization
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const { width, height } = canvas

    // Clear canvas
    ctx.clearRect(0, 0, width, height)

    // Draw background gradient
    const gradient = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, height)
    gradient.addColorStop(0, 'rgba(6, 182, 212, 0.03)')
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, width, height)

    // Draw body outline
    const bodyColor = sex === 'male' ? 'rgba(100, 150, 180, 0.3)' : 'rgba(180, 140, 160, 0.3)'
    drawBodyOutline(ctx, width, height, bodyColor)

    // Sort points by depth for proper rendering
    const sortedPoints = [...visiblePoints]
      .map(point => ({
        ...point,
        projected: project3D(point.x, point.y, point.z, width, height)
      }))
      .sort((a, b) => a.projected.depth - b.projected.depth)

    // Draw connection lines between related points
    sortedPoints.forEach(point => {
      const layerConfig = anatomyLayers.find(l => l.id === point.system)
      if (!layerConfig) return

      const { x, y, scale } = point.projected
      const isHovered = hoveredPoint?.point.id === point.id
      const isSelected = selectedPoint?.id === point.id

      // Draw point
      const baseSize = 6 * scale * zoom
      const size = isHovered || isSelected ? baseSize * 1.5 : baseSize

      ctx.beginPath()
      ctx.arc(x, y, size, 0, Math.PI * 2)

      if (isSelected) {
        ctx.fillStyle = layerConfig.color
        ctx.shadowColor = layerConfig.color
        ctx.shadowBlur = 15
      } else if (isHovered) {
        ctx.fillStyle = layerConfig.color + 'dd'
        ctx.shadowColor = layerConfig.color
        ctx.shadowBlur = 10
      } else {
        ctx.fillStyle = layerConfig.color + '99'
        ctx.shadowBlur = 0
      }
      ctx.fill()
      ctx.shadowBlur = 0

      // Draw label if selected
      if (isSelected && !showAiPanel) {
        ctx.fillStyle = 'var(--color-text)'
        ctx.font = `${12 * zoom}px Inter, sans-serif`
        ctx.textAlign = 'center'
        ctx.fillText(point.name, x, y - size - 8)
      }
    })
  }, [visiblePoints, rotation, zoom, sex, hoveredPoint, selectedPoint, project3D, showAiPanel])

  // Draw body outline helper
  const drawBodyOutline = (ctx: CanvasRenderingContext2D, width: number, height: number, color: string) => {
    const centerX = width / 2
    const scale = Math.min(width, height) * 0.35 * zoom

    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.setLineDash([5, 5])

    // Simple body outline
    ctx.beginPath()

    // Head
    ctx.ellipse(centerX, height * 0.1, scale * 0.15, scale * 0.18, 0, 0, Math.PI * 2)
    ctx.stroke()

    // Torso
    ctx.beginPath()
    ctx.moveTo(centerX - scale * 0.25, height * 0.18)
    ctx.lineTo(centerX - scale * 0.35, height * 0.25)
    ctx.lineTo(centerX - scale * 0.30, height * 0.45)
    ctx.lineTo(centerX - scale * 0.20, height * 0.52)
    ctx.lineTo(centerX + scale * 0.20, height * 0.52)
    ctx.lineTo(centerX + scale * 0.30, height * 0.45)
    ctx.lineTo(centerX + scale * 0.35, height * 0.25)
    ctx.lineTo(centerX + scale * 0.25, height * 0.18)
    ctx.closePath()
    ctx.stroke()

    ctx.setLineDash([])
  }

  // Mouse interaction handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true)
    setLastMouse({ x: e.clientX, y: e.clientY })
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top

    if (isDragging) {
      const dx = e.clientX - lastMouse.x
      const dy = e.clientY - lastMouse.y
      setRotation(prev => ({
        x: Math.max(-0.5, Math.min(0.5, prev.x + dy * 0.005)),
        y: prev.y + dx * 0.005
      }))
      setLastMouse({ x: e.clientX, y: e.clientY })
    } else {
      // Check for hover
      const { width, height } = canvas
      let found: HoveredPoint | null = null

      for (const point of visiblePoints) {
        const projected = project3D(point.x, point.y, point.z, width, height)
        const distance = Math.sqrt(
          Math.pow(mouseX - projected.x, 2) + Math.pow(mouseY - projected.y, 2)
        )
        if (distance < 15 * zoom) {
          found = { point, screenX: projected.x, screenY: projected.y }
          break
        }
      }

      setHoveredPoint(found)
    }
  }

  const handleMouseUp = () => {
    setIsDragging(false)
  }

  const handleClick = (e: React.MouseEvent) => {
    if (hoveredPoint) {
      setSelectedPoint(hoveredPoint.point)
      setShowAiPanel(true)

      // Find linked Master Library element
      if (hoveredPoint.point.libraryId && onElementSelect) {
        const element = findElementById(hoveredPoint.point.libraryId)
        if (element) {
          onElementSelect(element)
        }
      }
    } else {
      setSelectedPoint(null)
      setShowAiPanel(false)
    }
  }

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    setZoom(prev => Math.max(0.5, Math.min(3, prev - e.deltaY * 0.001)))
  }

  // Reset view
  const resetView = () => {
    setRotation({ x: 0, y: 0 })
    setZoom(1)
  }

  return (
    <div
      ref={containerRef}
      className={clsx(
        'relative bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg overflow-hidden',
        isFullscreen && 'fixed inset-4 z-50',
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-bg-elevated)]">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-medium">3D Human Anatomy</h3>
          <div className="flex items-center gap-1 bg-[var(--color-surface)] rounded-lg p-0.5">
            <button
              onClick={() => setSex('male')}
              className={clsx(
                'px-2 py-1 text-xs rounded transition-colors',
                sex === 'male'
                  ? 'bg-blue-500/20 text-blue-400'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
              )}
            >
              Male
            </button>
            <button
              onClick={() => setSex('female')}
              className={clsx(
                'px-2 py-1 text-xs rounded transition-colors',
                sex === 'female'
                  ? 'bg-pink-500/20 text-pink-400'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
              )}
            >
              Female
            </button>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowLayerPanel(!showLayerPanel)}
            className={clsx(
              'p-1.5 rounded transition-colors',
              showLayerPanel ? 'bg-primary-500/20 text-primary-400' : 'hover:bg-[var(--color-surface)]'
            )}
            title="Toggle Layers Panel"
          >
            <FiLayers className="w-4 h-4" />
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

      <div className="flex h-[500px]">
        {/* Layer Panel */}
        {showLayerPanel && (
          <div className="w-56 border-r border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3 overflow-y-auto">
            <div className="text-xs font-medium text-[var(--color-text-muted)] mb-2">System Layers</div>
            <div className="space-y-1">
              {anatomyLayers.map(layer => (
                <button
                  key={layer.id}
                  onClick={() => toggleLayer(layer.id)}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors',
                    visibleLayers.has(layer.id)
                      ? 'bg-[var(--color-surface)]'
                      : 'opacity-50 hover:opacity-75'
                  )}
                >
                  <span
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: layer.color }}
                  />
                  <span className="flex-1 text-left">{layer.name}</span>
                  {visibleLayers.has(layer.id) ? (
                    <FiEye className="w-3.5 h-3.5 text-green-400" />
                  ) : (
                    <FiEyeOff className="w-3.5 h-3.5" />
                  )}
                </button>
              ))}
            </div>

            <div className="mt-4 pt-3 border-t border-[var(--color-border)]">
              <div className="text-xs font-medium text-[var(--color-text-muted)] mb-2">Quick Actions</div>
              <div className="space-y-1">
                <button
                  onClick={() => setVisibleLayers(new Set(anatomyLayers.map(l => l.id)))}
                  className="w-full text-left px-2 py-1.5 text-xs hover:bg-[var(--color-surface)] rounded transition-colors"
                >
                  Show All Layers
                </button>
                <button
                  onClick={() => setVisibleLayers(new Set())}
                  className="w-full text-left px-2 py-1.5 text-xs hover:bg-[var(--color-surface)] rounded transition-colors"
                >
                  Hide All Layers
                </button>
                <button
                  onClick={() => setVisibleLayers(new Set(['skeletal']))}
                  className="w-full text-left px-2 py-1.5 text-xs hover:bg-[var(--color-surface)] rounded transition-colors"
                >
                  Skeletal Only
                </button>
                <button
                  onClick={() => setVisibleLayers(new Set(['muscular']))}
                  className="w-full text-left px-2 py-1.5 text-xs hover:bg-[var(--color-surface)] rounded transition-colors"
                >
                  Muscular Only
                </button>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-[var(--color-border)]">
              <div className="text-xxs text-[var(--color-text-muted)]">
                <strong>{visiblePoints.length}</strong> anatomy points visible
              </div>
            </div>
          </div>
        )}

        {/* Canvas Area */}
        <div className="flex-1 relative">
          <canvas
            ref={canvasRef}
            width={800}
            height={500}
            className="w-full h-full cursor-grab active:cursor-grabbing"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onClick={handleClick}
            onWheel={handleWheel}
          />

          {/* Hover Tooltip */}
          {hoveredPoint && !selectedPoint && (
            <div
              className="absolute pointer-events-none bg-[var(--color-surface)]/95 backdrop-blur border border-[var(--color-border)] rounded-lg p-2 shadow-lg z-10"
              style={{
                left: hoveredPoint.screenX + 15,
                top: hoveredPoint.screenY - 10,
                transform: 'translateY(-50%)'
              }}
            >
              <div className="text-xs font-medium">{hoveredPoint.point.name}</div>
              <div className="text-xxs text-[var(--color-text-muted)]">
                {hoveredPoint.point.description || 'Click for details'}
              </div>
            </div>
          )}

          {/* Zoom Controls */}
          <div className="absolute bottom-4 left-4 flex items-center gap-1 bg-[var(--color-surface)]/90 backdrop-blur rounded-lg border border-[var(--color-border)] p-1">
            <button
              onClick={() => setZoom(z => Math.min(3, z + 0.2))}
              className="p-1.5 hover:bg-[var(--color-border)] rounded transition-colors"
              title="Zoom In"
            >
              <FiZoomIn className="w-3.5 h-3.5" />
            </button>
            <span className="px-2 text-xs text-[var(--color-text-muted)]">{Math.round(zoom * 100)}%</span>
            <button
              onClick={() => setZoom(z => Math.max(0.5, z - 0.2))}
              className="p-1.5 hover:bg-[var(--color-border)] rounded transition-colors"
              title="Zoom Out"
            >
              <FiZoomOut className="w-3.5 h-3.5" />
            </button>
            <div className="w-px h-4 bg-[var(--color-border)] mx-1" />
            <button
              onClick={resetView}
              className="p-1.5 hover:bg-[var(--color-border)] rounded transition-colors"
              title="Reset View"
            >
              <FiRotateCw className="w-3.5 h-3.5" />
            </button>
            <button
              className="p-1.5 hover:bg-[var(--color-border)] rounded transition-colors"
              title="Center"
            >
              <FiCrosshair className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Rotation indicator */}
          <div className="absolute bottom-4 right-4 text-xxs text-[var(--color-text-muted)] bg-[var(--color-surface)]/90 backdrop-blur px-2 py-1 rounded border border-[var(--color-border)]">
            Rotation: {Math.round(rotation.y * 57.3)}°
          </div>
        </div>

        {/* AI Panel (when point selected) */}
        {showAiPanel && selectedPoint && (
          <div className="w-72 border-l border-[var(--color-border)] bg-[var(--color-bg-elevated)] flex flex-col">
            <div className="p-3 border-b border-[var(--color-border)]">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium">{selectedPoint.name}</h4>
                <button
                  onClick={() => { setShowAiPanel(false); setSelectedPoint(null) }}
                  className="p-1 hover:bg-[var(--color-surface)] rounded"
                >
                  &times;
                </button>
              </div>
              <div className="text-xxs text-[var(--color-text-muted)] mt-1">
                {anatomyLayers.find(l => l.id === selectedPoint.system)?.name}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3">
              <div className="text-xs text-[var(--color-text-secondary)] mb-3">
                {selectedPoint.description}
              </div>

              {selectedPoint.libraryId && (
                <div className="mb-3 p-2 bg-green-500/10 rounded border border-green-500/20">
                  <div className="flex items-center gap-1 text-xxs text-green-400 mb-1">
                    <FiInfo className="w-3 h-3" />
                    Linked to Master Library
                  </div>
                  <div className="text-xs font-mono text-green-300">{selectedPoint.libraryId}</div>
                </div>
              )}

              <div className="space-y-2">
                <div className="text-xxs font-medium text-[var(--color-text-muted)]">Related Elements</div>
                {anatomyLayers.find(l => l.id === selectedPoint.system)?.elements.slice(0, 5).map(elem => (
                  <div
                    key={elem.id}
                    className="text-xs p-2 bg-[var(--color-surface)] rounded hover:bg-[var(--color-border)] cursor-pointer transition-colors"
                    onClick={() => onElementSelect?.(elem)}
                  >
                    {elem.name}
                  </div>
                ))}
              </div>
            </div>

            {/* AI Prompt Bar */}
            <div className="p-3 border-t border-[var(--color-border)]">
              <div className="text-xxs font-medium text-[var(--color-text-muted)] mb-2">
                <FiMessageSquare className="w-3 h-3 inline mr-1" />
                Ask AI about {selectedPoint.name}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="Ask a question..."
                  className="input flex-1 text-xs"
                />
                <button className="btn btn-primary btn-sm">
                  <FiSend className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="mt-2 space-y-1">
                <button className="w-full text-left text-xxs text-primary-400 hover:underline">
                  What diseases affect the {selectedPoint.name}?
                </button>
                <button className="w-full text-left text-xxs text-primary-400 hover:underline">
                  How does the {selectedPoint.name} function?
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
