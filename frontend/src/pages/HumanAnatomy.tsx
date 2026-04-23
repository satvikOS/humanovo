import { useState, useRef, useEffect } from 'react'
import {
  FiRotateCw,
  FiZoomIn,
  FiZoomOut,
  FiEye,
  FiEyeOff,
  FiInfo,
  FiMaximize2,
  FiMinimize2,
  FiUser,
  FiCrosshair,
  FiSearch,
  FiChevronRight,
  FiChevronDown,
  FiPlay,
  FiPause,
  FiDownload,
  FiBookOpen
} from 'react-icons/fi'
import clsx from 'clsx'

// ==================== TYPES ====================

type Sex = 'male' | 'female'
type ViewMode = 'anterior' | 'posterior' | 'lateral_left' | 'lateral_right' | 'superior' | 'inferior'

type AnatomySystem =
  | 'integumentary'
  | 'skeletal'
  | 'muscular'
  | 'nervous'
  | 'circulatory'
  | 'lymphatic'
  | 'respiratory'
  | 'digestive'
  | 'urinary'
  | 'reproductive'
  | 'endocrine'

interface AnatomyLayerConfig {
  id: AnatomySystem
  name: string
  color: string
  description: string
  opacity: number
}

interface AnatomyElement {
  id: string
  name: string
  latinName?: string
  system: AnatomySystem
  region: string
  description: string
  function?: string
  clinicalNotes?: string[]
  relatedStructures?: string[]
}

// ==================== ANATOMY LAYER CONFIGURATIONS ====================

const anatomyLayers: AnatomyLayerConfig[] = [
  {
    id: 'integumentary',
    name: 'Integumentary (Skin)',
    color: '#FFDAB9',
    description: 'Skin, hair, nails - protective barrier',
    opacity: 0.3
  },
  {
    id: 'skeletal',
    name: 'Skeletal System',
    color: '#F5F5DC',
    description: '206 bones - structural framework',
    opacity: 1.0
  },
  {
    id: 'muscular',
    name: 'Muscular System',
    color: '#CD5C5C',
    description: '600+ muscles - movement and posture',
    opacity: 0.9
  },
  {
    id: 'nervous',
    name: 'Nervous System',
    color: '#FFD700',
    description: 'Brain, spinal cord, nerves - control center',
    opacity: 0.8
  },
  {
    id: 'circulatory',
    name: 'Circulatory System',
    color: '#DC143C',
    description: 'Heart, arteries, veins - nutrient transport',
    opacity: 0.85
  },
  {
    id: 'lymphatic',
    name: 'Lymphatic System',
    color: '#90EE90',
    description: 'Lymph nodes, vessels - immune defense',
    opacity: 0.7
  },
  {
    id: 'respiratory',
    name: 'Respiratory System',
    color: '#87CEEB',
    description: 'Lungs, airways - gas exchange',
    opacity: 0.8
  },
  {
    id: 'digestive',
    name: 'Digestive System',
    color: '#DEB887',
    description: 'GI tract - nutrient processing',
    opacity: 0.85
  },
  {
    id: 'urinary',
    name: 'Urinary System',
    color: '#FFB347',
    description: 'Kidneys, bladder - waste removal',
    opacity: 0.8
  },
  {
    id: 'reproductive',
    name: 'Reproductive System',
    color: '#E6A8D7',
    description: 'Reproductive organs',
    opacity: 0.75
  },
  {
    id: 'endocrine',
    name: 'Endocrine System',
    color: '#9B59B6',
    description: 'Glands - hormonal regulation',
    opacity: 0.7
  }
]

// ==================== SAMPLE ANATOMY ELEMENTS ====================

const anatomyElements: AnatomyElement[] = [
  // Skeletal
  { id: 'skull', name: 'Skull', latinName: 'Cranium', system: 'skeletal', region: 'Head', description: '22 bones protecting the brain', function: 'Protects brain, supports facial structures', clinicalNotes: ['Fractures may cause brain injury', 'Sutures allow growth in infants'] },
  { id: 'vertebral_column', name: 'Vertebral Column', latinName: 'Columna vertebralis', system: 'skeletal', region: 'Trunk', description: '33 vertebrae forming the spine', function: 'Protects spinal cord, supports body weight' },
  { id: 'rib_cage', name: 'Rib Cage', latinName: 'Thorax', system: 'skeletal', region: 'Trunk', description: '24 ribs protecting thoracic organs', function: 'Protects heart and lungs, assists breathing' },
  { id: 'pelvis', name: 'Pelvis', latinName: 'Pelvis', system: 'skeletal', region: 'Trunk', description: 'Hip bones supporting the spine', function: 'Supports body weight, protects pelvic organs' },
  { id: 'femur', name: 'Femur', latinName: 'Os femoris', system: 'skeletal', region: 'Lower Limb', description: 'Largest and strongest bone', function: 'Bears body weight, enables movement' },

  // Muscular
  { id: 'heart_muscle', name: 'Cardiac Muscle', latinName: 'Myocardium', system: 'muscular', region: 'Thorax', description: 'Specialized muscle of the heart', function: 'Pumps blood throughout the body' },
  { id: 'diaphragm', name: 'Diaphragm', latinName: 'Diaphragma', system: 'muscular', region: 'Trunk', description: 'Primary breathing muscle', function: 'Creates negative pressure for inspiration' },
  { id: 'quadriceps', name: 'Quadriceps', latinName: 'Quadriceps femoris', system: 'muscular', region: 'Lower Limb', description: 'Four muscles of the anterior thigh', function: 'Extends the knee, flexes the hip' },

  // Nervous
  { id: 'brain', name: 'Brain', latinName: 'Encephalon', system: 'nervous', region: 'Head', description: 'Central control organ ~86 billion neurons', function: 'Controls all body functions, consciousness' },
  { id: 'spinal_cord', name: 'Spinal Cord', latinName: 'Medulla spinalis', system: 'nervous', region: 'Trunk', description: 'Neural pathway from brain to body', function: 'Transmits signals, controls reflexes' },
  { id: 'sciatic_nerve', name: 'Sciatic Nerve', latinName: 'Nervus ischiadicus', system: 'nervous', region: 'Lower Limb', description: 'Largest nerve in the body', function: 'Innervates posterior thigh and lower leg' },

  // Circulatory
  { id: 'heart', name: 'Heart', latinName: 'Cor', system: 'circulatory', region: 'Thorax', description: '4-chambered pump, ~100,000 beats/day', function: 'Pumps blood through circulatory system' },
  { id: 'aorta', name: 'Aorta', latinName: 'Aorta', system: 'circulatory', region: 'Trunk', description: 'Largest artery in the body', function: 'Distributes oxygenated blood to body' },

  // Respiratory
  { id: 'lungs', name: 'Lungs', latinName: 'Pulmones', system: 'respiratory', region: 'Thorax', description: 'Primary respiratory organs, ~300M alveoli', function: 'Gas exchange - O2 in, CO2 out' },
  { id: 'trachea', name: 'Trachea', latinName: 'Trachea', system: 'respiratory', region: 'Neck', description: 'Windpipe connecting larynx to bronchi', function: 'Conducts air to and from lungs' },

  // Digestive
  { id: 'stomach', name: 'Stomach', latinName: 'Gaster', system: 'digestive', region: 'Abdomen', description: 'J-shaped muscular organ', function: 'Stores food, begins protein digestion' },
  { id: 'liver', name: 'Liver', latinName: 'Hepar', system: 'digestive', region: 'Abdomen', description: 'Largest internal organ', function: 'Metabolism, detoxification, bile production' },
  { id: 'intestines', name: 'Intestines', latinName: 'Intestinum', system: 'digestive', region: 'Abdomen', description: 'Small and large intestine', function: 'Nutrient absorption, waste processing' },

  // Urinary
  { id: 'kidneys', name: 'Kidneys', latinName: 'Renes', system: 'urinary', region: 'Abdomen', description: 'Bean-shaped filtration organs', function: 'Filter blood, produce urine, regulate BP' },
  { id: 'bladder', name: 'Urinary Bladder', latinName: 'Vesica urinaria', system: 'urinary', region: 'Pelvis', description: 'Muscular storage organ', function: 'Stores urine until excretion' },

  // Lymphatic
  { id: 'spleen', name: 'Spleen', latinName: 'Lien', system: 'lymphatic', region: 'Abdomen', description: 'Largest lymphoid organ', function: 'Filters blood, stores platelets' },
  { id: 'thymus', name: 'Thymus', latinName: 'Thymus', system: 'lymphatic', region: 'Thorax', description: 'Primary lymphoid organ', function: 'T-cell maturation' },

  // Endocrine
  { id: 'thyroid', name: 'Thyroid Gland', latinName: 'Glandula thyroidea', system: 'endocrine', region: 'Neck', description: 'Butterfly-shaped gland', function: 'Produces T3, T4 - regulates metabolism' },
  { id: 'adrenal', name: 'Adrenal Glands', latinName: 'Glandulae suprarenales', system: 'endocrine', region: 'Abdomen', description: 'Paired glands above kidneys', function: 'Produces cortisol, adrenaline' }
]

// ==================== VIEW PRESETS ====================

const viewPresets: { id: ViewMode; name: string; rotation: { x: number; y: number } }[] = [
  { id: 'anterior', name: 'Anterior (Front)', rotation: { x: 0, y: 0 } },
  { id: 'posterior', name: 'Posterior (Back)', rotation: { x: 0, y: Math.PI } },
  { id: 'lateral_left', name: 'Left Lateral', rotation: { x: 0, y: -Math.PI / 2 } },
  { id: 'lateral_right', name: 'Right Lateral', rotation: { x: 0, y: Math.PI / 2 } },
  { id: 'superior', name: 'Superior (Top)', rotation: { x: -Math.PI / 2, y: 0 } },
  { id: 'inferior', name: 'Inferior (Bottom)', rotation: { x: Math.PI / 2, y: 0 } }
]

// ==================== 3D CANVAS RENDERER ====================

interface Anatomy3DViewerProps {
  visibleSystems: Set<AnatomySystem>
  sex: Sex
  rotation: { x: number; y: number }
  zoom: number
  onRotationChange: (rotation: { x: number; y: number }) => void
  selectedElement: AnatomyElement | null
  onElementSelect: (element: AnatomyElement | null) => void
  layerOpacities: Record<AnatomySystem, number>
}

function Anatomy3DViewer({
  visibleSystems,
  sex,
  rotation,
  zoom,
  onRotationChange,
  selectedElement,
  onElementSelect: _onElementSelect,
  layerOpacities
}: Anatomy3DViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [lastMouse, setLastMouse] = useState({ x: 0, y: 0 })
  const [hoveredElement] = useState<AnatomyElement | null>(null)
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })

  // Draw anatomy visualization
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const { width, height } = canvas
    const centerX = width / 2
    const centerY = height / 2

    // Clear canvas
    ctx.clearRect(0, 0, width, height)

    // Draw gradient background
    const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, height * 0.8)
    gradient.addColorStop(0, 'rgba(20, 30, 40, 1)')
    gradient.addColorStop(1, 'rgba(10, 15, 20, 1)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, width, height)

    // Draw grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)'
    ctx.lineWidth = 1
    const gridSize = 40 * zoom
    for (let x = 0; x < width; x += gridSize) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, height)
      ctx.stroke()
    }
    for (let y = 0; y < height; y += gridSize) {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(width, y)
      ctx.stroke()
    }

    // Calculate body dimensions
    const bodyHeight = height * 0.85 * zoom
    const bodyWidth = bodyHeight * 0.35
    const headRadius = bodyHeight * 0.08
    const headY = centerY - bodyHeight * 0.42

    // Draw each visible system layer
    anatomyLayers.forEach(layer => {
      if (!visibleSystems.has(layer.id)) return

      const opacity = layerOpacities[layer.id] ?? layer.opacity

      // Apply 3D rotation effect
      const cosY = Math.cos(rotation.y)

      ctx.save()
      ctx.globalAlpha = opacity

      switch (layer.id) {
        case 'integumentary':
          // Skin outline
          ctx.strokeStyle = layer.color
          ctx.lineWidth = 3
          ctx.setLineDash([])
          drawBodyOutline(ctx, centerX, headY, bodyWidth, bodyHeight, headRadius, sex, cosY)
          break

        case 'skeletal':
          drawSkeletalSystem(ctx, centerX, headY, bodyWidth, bodyHeight, headRadius, layer.color, cosY, selectedElement)
          break

        case 'muscular':
          drawMuscularSystem(ctx, centerX, headY, bodyWidth, bodyHeight, headRadius, layer.color, cosY, selectedElement)
          break

        case 'nervous':
          drawNervousSystem(ctx, centerX, headY, bodyWidth, bodyHeight, headRadius, layer.color, cosY)
          break

        case 'circulatory':
          drawCirculatorySystem(ctx, centerX, headY, bodyWidth, bodyHeight, headRadius, layer.color, cosY)
          break

        case 'respiratory':
          drawRespiratorySystem(ctx, centerX, headY, bodyWidth, bodyHeight, headRadius, layer.color, cosY)
          break

        case 'digestive':
          drawDigestiveSystem(ctx, centerX, headY, bodyWidth, bodyHeight, headRadius, layer.color, cosY)
          break

        case 'lymphatic':
          drawLymphaticSystem(ctx, centerX, headY, bodyWidth, bodyHeight, headRadius, layer.color, cosY)
          break

        case 'urinary':
          drawUrinarySystem(ctx, centerX, headY, bodyWidth, bodyHeight, headRadius, layer.color, cosY)
          break

        case 'endocrine':
          drawEndocrineSystem(ctx, centerX, headY, bodyWidth, bodyHeight, headRadius, layer.color, cosY)
          break
      }

      ctx.restore()
    })

    // Draw highlighted element (muted white highlight, consistent with
    // the rest of the app's palette — selection carries meaning via
    // position and label, not colour)
    if (selectedElement) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.18)'
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)'
      ctx.lineWidth = 2
      // Draw indicator for selected element
      const elementY = getElementPosition(selectedElement, centerY, bodyHeight)
      ctx.beginPath()
      ctx.arc(centerX, elementY, 15, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }

  }, [visibleSystems, sex, rotation, zoom, selectedElement, layerOpacities])

  // Get approximate Y position for an element
  function getElementPosition(element: AnatomyElement, centerY: number, bodyHeight: number): number {
    const regionPositions: Record<string, number> = {
      'Head': -0.42,
      'Neck': -0.35,
      'Thorax': -0.15,
      'Trunk': -0.05,
      'Abdomen': 0.1,
      'Pelvis': 0.25,
      'Upper Limb': -0.1,
      'Lower Limb': 0.5
    }
    const offset = regionPositions[element.region] ?? 0
    return centerY + bodyHeight * offset
  }

  // Mouse handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true)
    setLastMouse({ x: e.clientX, y: e.clientY })
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top })

    if (isDragging) {
      const dx = e.clientX - lastMouse.x
      const dy = e.clientY - lastMouse.y
      onRotationChange({
        x: Math.max(-Math.PI / 3, Math.min(Math.PI / 3, rotation.x + dy * 0.005)),
        y: rotation.y + dx * 0.005
      })
      setLastMouse({ x: e.clientX, y: e.clientY })
    }
  }

  const handleMouseUp = () => setIsDragging(false)

  return (
    <div className="relative w-full h-full">
      <canvas
        ref={canvasRef}
        width={1200}
        height={900}
        className="w-full h-full cursor-grab active:cursor-grabbing"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />

      {/* Hover tooltip */}
      {hoveredElement && (
        <div
          className="absolute pointer-events-none bg-[var(--color-surface)]/95 backdrop-blur border border-[var(--color-border)] rounded-lg p-3 shadow-lg z-10 max-w-xs"
          style={{ left: mousePos.x + 15, top: mousePos.y + 15 }}
        >
          <div className="font-medium text-sm">{hoveredElement.name}</div>
          {hoveredElement.latinName && (
            <div className="text-xs italic text-[var(--color-text-muted)]">{hoveredElement.latinName}</div>
          )}
          <div className="text-xs text-[var(--color-text-secondary)] mt-1">{hoveredElement.description}</div>
        </div>
      )}
    </div>
  )
}

// ==================== DRAWING FUNCTIONS ====================

function drawBodyOutline(ctx: CanvasRenderingContext2D, cx: number, headY: number, bw: number, bh: number, hr: number, sex: Sex, cosY: number) {
  ctx.beginPath()

  // Head
  ctx.ellipse(cx, headY, hr * Math.abs(cosY) + hr * 0.3, hr, 0, 0, Math.PI * 2)
  ctx.stroke()

  // Neck
  const neckW = bw * 0.15
  ctx.beginPath()
  ctx.moveTo(cx - neckW, headY + hr)
  ctx.lineTo(cx - neckW, headY + hr + bh * 0.05)
  ctx.moveTo(cx + neckW, headY + hr)
  ctx.lineTo(cx + neckW, headY + hr + bh * 0.05)
  ctx.stroke()

  // Torso
  const shoulderY = headY + hr + bh * 0.05
  const shoulderW = bw * 0.5
  const waistY = shoulderY + bh * 0.35
  const waistW = sex === 'male' ? bw * 0.35 : bw * 0.38
  const hipY = waistY + bh * 0.1
  const hipW = sex === 'male' ? bw * 0.38 : bw * 0.45

  ctx.beginPath()
  ctx.moveTo(cx - shoulderW, shoulderY)
  ctx.quadraticCurveTo(cx - waistW - 10, waistY - 20, cx - waistW, waistY)
  ctx.quadraticCurveTo(cx - hipW, hipY - 10, cx - hipW, hipY)
  ctx.moveTo(cx + shoulderW, shoulderY)
  ctx.quadraticCurveTo(cx + waistW + 10, waistY - 20, cx + waistW, waistY)
  ctx.quadraticCurveTo(cx + hipW, hipY - 10, cx + hipW, hipY)
  ctx.stroke()

  // Arms
  const armLen = bh * 0.35
  ctx.beginPath()
  ctx.moveTo(cx - shoulderW, shoulderY)
  ctx.lineTo(cx - shoulderW - bw * 0.15, shoulderY + armLen)
  ctx.lineTo(cx - shoulderW - bw * 0.1, shoulderY + armLen + bh * 0.15)
  ctx.moveTo(cx + shoulderW, shoulderY)
  ctx.lineTo(cx + shoulderW + bw * 0.15, shoulderY + armLen)
  ctx.lineTo(cx + shoulderW + bw * 0.1, shoulderY + armLen + bh * 0.15)
  ctx.stroke()

  // Legs
  const legY = hipY + bh * 0.02
  const legLen = bh * 0.45
  ctx.beginPath()
  ctx.moveTo(cx - hipW * 0.5, legY)
  ctx.lineTo(cx - hipW * 0.4, legY + legLen)
  ctx.lineTo(cx - hipW * 0.35, legY + legLen + bh * 0.1)
  ctx.moveTo(cx + hipW * 0.5, legY)
  ctx.lineTo(cx + hipW * 0.4, legY + legLen)
  ctx.lineTo(cx + hipW * 0.35, legY + legLen + bh * 0.1)
  ctx.stroke()
}

function drawSkeletalSystem(ctx: CanvasRenderingContext2D, cx: number, headY: number, bw: number, bh: number, hr: number, color: string, _cosY: number, _selected: AnatomyElement | null) {
  ctx.strokeStyle = color
  ctx.fillStyle = color + '40'
  ctx.lineWidth = 2

  // Skull
  ctx.beginPath()
  ctx.ellipse(cx, headY, hr * 0.9, hr * 0.95, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()

  // Draw facial features
  ctx.beginPath()
  ctx.ellipse(cx - hr * 0.3, headY - hr * 0.1, hr * 0.15, hr * 0.2, 0, 0, Math.PI * 2)
  ctx.ellipse(cx + hr * 0.3, headY - hr * 0.1, hr * 0.15, hr * 0.2, 0, 0, Math.PI * 2)
  ctx.stroke()

  // Spine
  const spineTop = headY + hr
  const spineBottom = headY + bh * 0.55
  ctx.beginPath()
  ctx.moveTo(cx, spineTop)
  for (let i = 0; i < 24; i++) {
    const y = spineTop + (spineBottom - spineTop) * (i / 24)
    const w = i < 7 ? 8 : i < 19 ? 12 : 15
    ctx.moveTo(cx - w, y)
    ctx.lineTo(cx + w, y)
  }
  ctx.stroke()

  // Rib cage
  const ribTop = headY + hr + bh * 0.08
  ctx.beginPath()
  for (let i = 0; i < 12; i++) {
    const y = ribTop + i * (bh * 0.02)
    const ribW = bw * 0.35 * (1 - i * 0.03)
    ctx.moveTo(cx, y)
    ctx.quadraticCurveTo(cx - ribW * 0.5, y + 5, cx - ribW, y)
    ctx.moveTo(cx, y)
    ctx.quadraticCurveTo(cx + ribW * 0.5, y + 5, cx + ribW, y)
  }
  ctx.stroke()

  // Sternum
  ctx.beginPath()
  ctx.moveTo(cx, ribTop - 5)
  ctx.lineTo(cx, ribTop + bh * 0.18)
  ctx.lineWidth = 4
  ctx.stroke()
  ctx.lineWidth = 2

  // Pelvis
  const pelvisY = headY + bh * 0.48
  ctx.beginPath()
  ctx.ellipse(cx, pelvisY, bw * 0.35, bh * 0.08, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()

  // Clavicles
  const clavY = headY + hr + bh * 0.04
  ctx.beginPath()
  ctx.moveTo(cx, clavY)
  ctx.lineTo(cx - bw * 0.4, clavY + 5)
  ctx.moveTo(cx, clavY)
  ctx.lineTo(cx + bw * 0.4, clavY + 5)
  ctx.stroke()

  // Scapulae (shoulder blades)
  ctx.beginPath()
  ctx.ellipse(cx - bw * 0.35, clavY + bh * 0.08, bw * 0.12, bh * 0.08, -0.2, 0, Math.PI * 2)
  ctx.ellipse(cx + bw * 0.35, clavY + bh * 0.08, bw * 0.12, bh * 0.08, 0.2, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()

  // Upper arm bones (humerus)
  const shoulderY = clavY + 10
  ctx.beginPath()
  ctx.moveTo(cx - bw * 0.45, shoulderY)
  ctx.lineTo(cx - bw * 0.55, shoulderY + bh * 0.22)
  ctx.moveTo(cx + bw * 0.45, shoulderY)
  ctx.lineTo(cx + bw * 0.55, shoulderY + bh * 0.22)
  ctx.lineWidth = 6
  ctx.stroke()
  ctx.lineWidth = 2

  // Forearm bones (radius & ulna)
  ctx.beginPath()
  ctx.moveTo(cx - bw * 0.55, shoulderY + bh * 0.22)
  ctx.lineTo(cx - bw * 0.5, shoulderY + bh * 0.4)
  ctx.moveTo(cx - bw * 0.55, shoulderY + bh * 0.22)
  ctx.lineTo(cx - bw * 0.58, shoulderY + bh * 0.4)
  ctx.moveTo(cx + bw * 0.55, shoulderY + bh * 0.22)
  ctx.lineTo(cx + bw * 0.5, shoulderY + bh * 0.4)
  ctx.moveTo(cx + bw * 0.55, shoulderY + bh * 0.22)
  ctx.lineTo(cx + bw * 0.58, shoulderY + bh * 0.4)
  ctx.lineWidth = 4
  ctx.stroke()
  ctx.lineWidth = 2

  // Femurs (thigh bones)
  const hipY = pelvisY + bh * 0.05
  ctx.beginPath()
  ctx.moveTo(cx - bw * 0.2, hipY)
  ctx.lineTo(cx - bw * 0.18, hipY + bh * 0.28)
  ctx.moveTo(cx + bw * 0.2, hipY)
  ctx.lineTo(cx + bw * 0.18, hipY + bh * 0.28)
  ctx.lineWidth = 8
  ctx.stroke()
  ctx.lineWidth = 2

  // Patellae (kneecaps)
  ctx.beginPath()
  ctx.ellipse(cx - bw * 0.18, hipY + bh * 0.29, 8, 10, 0, 0, Math.PI * 2)
  ctx.ellipse(cx + bw * 0.18, hipY + bh * 0.29, 8, 10, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()

  // Lower leg bones (tibia & fibula)
  ctx.beginPath()
  ctx.moveTo(cx - bw * 0.18, hipY + bh * 0.3)
  ctx.lineTo(cx - bw * 0.15, hipY + bh * 0.52)
  ctx.moveTo(cx - bw * 0.18, hipY + bh * 0.3)
  ctx.lineTo(cx - bw * 0.22, hipY + bh * 0.52)
  ctx.moveTo(cx + bw * 0.18, hipY + bh * 0.3)
  ctx.lineTo(cx + bw * 0.15, hipY + bh * 0.52)
  ctx.moveTo(cx + bw * 0.18, hipY + bh * 0.3)
  ctx.lineTo(cx + bw * 0.22, hipY + bh * 0.52)
  ctx.lineWidth = 5
  ctx.stroke()
  ctx.lineWidth = 2

  // Feet
  ctx.beginPath()
  ctx.ellipse(cx - bw * 0.18, hipY + bh * 0.54, bw * 0.08, bh * 0.025, 0, 0, Math.PI * 2)
  ctx.ellipse(cx + bw * 0.18, hipY + bh * 0.54, bw * 0.08, bh * 0.025, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
}

function drawMuscularSystem(ctx: CanvasRenderingContext2D, cx: number, headY: number, bw: number, bh: number, hr: number, color: string, _cosY: number, _selected: AnatomyElement | null) {
  ctx.fillStyle = color + '60'
  ctx.strokeStyle = color
  ctx.lineWidth = 1

  // Facial muscles
  ctx.beginPath()
  ctx.ellipse(cx - hr * 0.35, headY + hr * 0.3, hr * 0.2, hr * 0.15, 0, 0, Math.PI * 2)
  ctx.ellipse(cx + hr * 0.35, headY + hr * 0.3, hr * 0.2, hr * 0.15, 0, 0, Math.PI * 2)
  ctx.fill()

  // Neck muscles (sternocleidomastoid)
  ctx.beginPath()
  ctx.moveTo(cx - hr * 0.3, headY + hr)
  ctx.quadraticCurveTo(cx - bw * 0.2, headY + hr + bh * 0.04, cx - bw * 0.1, headY + hr + bh * 0.08)
  ctx.moveTo(cx + hr * 0.3, headY + hr)
  ctx.quadraticCurveTo(cx + bw * 0.2, headY + hr + bh * 0.04, cx + bw * 0.1, headY + hr + bh * 0.08)
  ctx.stroke()

  // Trapezius
  const trapY = headY + hr + bh * 0.02
  ctx.beginPath()
  ctx.moveTo(cx, trapY)
  ctx.quadraticCurveTo(cx - bw * 0.25, trapY + bh * 0.05, cx - bw * 0.45, trapY + bh * 0.03)
  ctx.quadraticCurveTo(cx - bw * 0.35, trapY + bh * 0.15, cx, trapY + bh * 0.2)
  ctx.quadraticCurveTo(cx + bw * 0.35, trapY + bh * 0.15, cx + bw * 0.45, trapY + bh * 0.03)
  ctx.quadraticCurveTo(cx + bw * 0.25, trapY + bh * 0.05, cx, trapY)
  ctx.fill()

  // Deltoids
  const deltY = trapY + bh * 0.02
  ctx.beginPath()
  ctx.ellipse(cx - bw * 0.48, deltY + bh * 0.05, bw * 0.12, bh * 0.06, -0.3, 0, Math.PI * 2)
  ctx.ellipse(cx + bw * 0.48, deltY + bh * 0.05, bw * 0.12, bh * 0.06, 0.3, 0, Math.PI * 2)
  ctx.fill()

  // Pectorals
  const pecY = deltY + bh * 0.06
  ctx.beginPath()
  ctx.ellipse(cx - bw * 0.2, pecY + bh * 0.04, bw * 0.2, bh * 0.06, 0.2, 0, Math.PI * 2)
  ctx.ellipse(cx + bw * 0.2, pecY + bh * 0.04, bw * 0.2, bh * 0.06, -0.2, 0, Math.PI * 2)
  ctx.fill()

  // Biceps
  const bicepY = deltY + bh * 0.1
  ctx.beginPath()
  ctx.ellipse(cx - bw * 0.52, bicepY + bh * 0.08, bw * 0.06, bh * 0.08, 0.3, 0, Math.PI * 2)
  ctx.ellipse(cx + bw * 0.52, bicepY + bh * 0.08, bw * 0.06, bh * 0.08, -0.3, 0, Math.PI * 2)
  ctx.fill()

  // Rectus abdominis (six-pack)
  const absY = pecY + bh * 0.12
  for (let i = 0; i < 4; i++) {
    ctx.beginPath()
    ctx.ellipse(cx - bw * 0.08, absY + i * bh * 0.045, bw * 0.07, bh * 0.02, 0, 0, Math.PI * 2)
    ctx.ellipse(cx + bw * 0.08, absY + i * bh * 0.045, bw * 0.07, bh * 0.02, 0, 0, Math.PI * 2)
    ctx.fill()
  }

  // External obliques
  ctx.beginPath()
  ctx.ellipse(cx - bw * 0.28, absY + bh * 0.08, bw * 0.1, bh * 0.1, 0.5, 0, Math.PI * 2)
  ctx.ellipse(cx + bw * 0.28, absY + bh * 0.08, bw * 0.1, bh * 0.1, -0.5, 0, Math.PI * 2)
  ctx.fill()

  // Quadriceps
  const quadY = headY + bh * 0.52
  ctx.beginPath()
  ctx.ellipse(cx - bw * 0.18, quadY + bh * 0.12, bw * 0.1, bh * 0.12, 0, 0, Math.PI * 2)
  ctx.ellipse(cx + bw * 0.18, quadY + bh * 0.12, bw * 0.1, bh * 0.12, 0, 0, Math.PI * 2)
  ctx.fill()

  // Gastrocnemius (calves)
  const calfY = quadY + bh * 0.28
  ctx.beginPath()
  ctx.ellipse(cx - bw * 0.18, calfY + bh * 0.06, bw * 0.06, bh * 0.08, 0, 0, Math.PI * 2)
  ctx.ellipse(cx + bw * 0.18, calfY + bh * 0.06, bw * 0.06, bh * 0.08, 0, 0, Math.PI * 2)
  ctx.fill()
}

function drawNervousSystem(ctx: CanvasRenderingContext2D, cx: number, headY: number, bw: number, bh: number, hr: number, color: string, _cosY: number) {
  ctx.strokeStyle = color
  ctx.fillStyle = color + '80'
  ctx.lineWidth = 2

  // Brain
  ctx.beginPath()
  ctx.ellipse(cx, headY - hr * 0.1, hr * 0.7, hr * 0.6, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()

  // Brain convolutions
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let i = 0; i < 5; i++) {
    ctx.moveTo(cx - hr * 0.5 + i * hr * 0.25, headY - hr * 0.4)
    ctx.quadraticCurveTo(cx - hr * 0.4 + i * hr * 0.2, headY - hr * 0.1, cx - hr * 0.5 + i * hr * 0.25, headY + hr * 0.2)
  }
  ctx.stroke()
  ctx.lineWidth = 2

  // Spinal cord
  const spineTop = headY + hr * 0.9
  const spineBot = headY + bh * 0.48
  ctx.beginPath()
  ctx.moveTo(cx, spineTop)
  ctx.lineTo(cx, spineBot)
  ctx.lineWidth = 4
  ctx.stroke()
  ctx.lineWidth = 2

  // Spinal nerves
  for (let i = 0; i < 15; i++) {
    const y = spineTop + (spineBot - spineTop) * (i / 15)
    const len = bw * 0.3 + Math.sin(i * 0.5) * bw * 0.1
    ctx.beginPath()
    ctx.moveTo(cx - 3, y)
    ctx.lineTo(cx - len, y + 10)
    ctx.moveTo(cx + 3, y)
    ctx.lineTo(cx + len, y + 10)
    ctx.stroke()
  }

  // Brachial plexus (arm nerves)
  const brachialY = headY + hr + bh * 0.06
  ctx.beginPath()
  ctx.moveTo(cx - bw * 0.1, brachialY)
  ctx.quadraticCurveTo(cx - bw * 0.35, brachialY + bh * 0.05, cx - bw * 0.55, brachialY + bh * 0.35)
  ctx.moveTo(cx + bw * 0.1, brachialY)
  ctx.quadraticCurveTo(cx + bw * 0.35, brachialY + bh * 0.05, cx + bw * 0.55, brachialY + bh * 0.35)
  ctx.stroke()

  // Sciatic nerves (leg)
  const sciaticY = spineBot
  ctx.beginPath()
  ctx.moveTo(cx - bw * 0.1, sciaticY)
  ctx.lineTo(cx - bw * 0.18, sciaticY + bh * 0.4)
  ctx.moveTo(cx + bw * 0.1, sciaticY)
  ctx.lineTo(cx + bw * 0.18, sciaticY + bh * 0.4)
  ctx.stroke()
}

function drawCirculatorySystem(ctx: CanvasRenderingContext2D, cx: number, headY: number, bw: number, bh: number, hr: number, _color: string, _cosY: number) {
  // Arteries in red
  ctx.strokeStyle = '#DC143C'
  ctx.lineWidth = 2

  // Heart
  const heartY = headY + hr + bh * 0.15
  ctx.fillStyle = '#DC143C80'
  ctx.beginPath()
  ctx.ellipse(cx - bw * 0.05, heartY, bw * 0.12, bh * 0.06, -0.3, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()

  // Aorta
  ctx.beginPath()
  ctx.moveTo(cx, heartY - bh * 0.02)
  ctx.quadraticCurveTo(cx + bw * 0.1, heartY - bh * 0.06, cx + bw * 0.05, heartY - bh * 0.08)
  ctx.quadraticCurveTo(cx - bw * 0.05, heartY - bh * 0.08, cx - bw * 0.05, heartY + bh * 0.3)
  ctx.stroke()

  // Carotid arteries (neck)
  ctx.beginPath()
  ctx.moveTo(cx - bw * 0.08, heartY - bh * 0.08)
  ctx.lineTo(cx - bw * 0.08, headY + hr * 0.5)
  ctx.moveTo(cx + bw * 0.08, heartY - bh * 0.08)
  ctx.lineTo(cx + bw * 0.08, headY + hr * 0.5)
  ctx.stroke()

  // Arm arteries
  ctx.beginPath()
  ctx.moveTo(cx - bw * 0.1, heartY - bh * 0.06)
  ctx.lineTo(cx - bw * 0.55, heartY + bh * 0.25)
  ctx.moveTo(cx + bw * 0.1, heartY - bh * 0.06)
  ctx.lineTo(cx + bw * 0.55, heartY + bh * 0.25)
  ctx.stroke()

  // Abdominal aorta & iliac
  ctx.beginPath()
  ctx.moveTo(cx, heartY + bh * 0.3)
  ctx.lineTo(cx, heartY + bh * 0.38)
  ctx.moveTo(cx, heartY + bh * 0.38)
  ctx.lineTo(cx - bw * 0.15, heartY + bh * 0.42)
  ctx.moveTo(cx, heartY + bh * 0.38)
  ctx.lineTo(cx + bw * 0.15, heartY + bh * 0.42)
  ctx.stroke()

  // Femoral arteries
  ctx.beginPath()
  ctx.moveTo(cx - bw * 0.15, heartY + bh * 0.42)
  ctx.lineTo(cx - bw * 0.18, heartY + bh * 0.7)
  ctx.moveTo(cx + bw * 0.15, heartY + bh * 0.42)
  ctx.lineTo(cx + bw * 0.18, heartY + bh * 0.7)
  ctx.stroke()

  // Veins in blue
  ctx.strokeStyle = '#4169E1'
  ctx.setLineDash([5, 3])

  // Vena cava
  ctx.beginPath()
  ctx.moveTo(cx + bw * 0.05, heartY)
  ctx.lineTo(cx + bw * 0.05, heartY + bh * 0.35)
  ctx.stroke()

  // Jugular veins
  ctx.beginPath()
  ctx.moveTo(cx - bw * 0.12, headY + hr * 0.5)
  ctx.lineTo(cx - bw * 0.1, heartY)
  ctx.moveTo(cx + bw * 0.12, headY + hr * 0.5)
  ctx.lineTo(cx + bw * 0.1, heartY)
  ctx.stroke()

  ctx.setLineDash([])
}

function drawRespiratorySystem(ctx: CanvasRenderingContext2D, cx: number, headY: number, bw: number, bh: number, hr: number, color: string, _cosY: number) {
  ctx.strokeStyle = color
  ctx.fillStyle = color + '50'
  ctx.lineWidth = 2

  // Nasal cavity
  ctx.beginPath()
  ctx.ellipse(cx, headY + hr * 0.4, hr * 0.2, hr * 0.15, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()

  // Pharynx & Larynx
  const larynxY = headY + hr + bh * 0.02
  ctx.beginPath()
  ctx.ellipse(cx, larynxY, bw * 0.08, bh * 0.025, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()

  // Trachea
  const tracheaTop = larynxY + bh * 0.03
  const tracheaBot = headY + hr + bh * 0.12
  ctx.beginPath()
  ctx.moveTo(cx - bw * 0.04, tracheaTop)
  ctx.lineTo(cx - bw * 0.04, tracheaBot)
  ctx.lineTo(cx + bw * 0.04, tracheaBot)
  ctx.lineTo(cx + bw * 0.04, tracheaTop)
  ctx.stroke()

  // Tracheal rings
  for (let i = 0; i < 5; i++) {
    const y = tracheaTop + i * (tracheaBot - tracheaTop) / 5
    ctx.beginPath()
    ctx.ellipse(cx, y, bw * 0.04, bh * 0.008, 0, 0, Math.PI * 2)
    ctx.stroke()
  }

  // Bronchi
  ctx.beginPath()
  ctx.moveTo(cx, tracheaBot)
  ctx.lineTo(cx - bw * 0.15, tracheaBot + bh * 0.08)
  ctx.moveTo(cx, tracheaBot)
  ctx.lineTo(cx + bw * 0.15, tracheaBot + bh * 0.08)
  ctx.stroke()

  // Lungs
  const lungY = tracheaBot + bh * 0.02
  // Left lung (smaller due to heart)
  ctx.beginPath()
  ctx.ellipse(cx - bw * 0.22, lungY + bh * 0.08, bw * 0.18, bh * 0.12, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  // Right lung
  ctx.beginPath()
  ctx.ellipse(cx + bw * 0.22, lungY + bh * 0.08, bw * 0.2, bh * 0.12, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()

  // Lung lobes
  ctx.beginPath()
  ctx.moveTo(cx - bw * 0.1, lungY + bh * 0.04)
  ctx.lineTo(cx - bw * 0.35, lungY + bh * 0.1)
  ctx.moveTo(cx + bw * 0.08, lungY + bh * 0.04)
  ctx.lineTo(cx + bw * 0.38, lungY + bh * 0.1)
  ctx.moveTo(cx + bw * 0.08, lungY + bh * 0.08)
  ctx.lineTo(cx + bw * 0.38, lungY + bh * 0.14)
  ctx.stroke()

  // Diaphragm
  const diaY = lungY + bh * 0.2
  ctx.beginPath()
  ctx.moveTo(cx - bw * 0.4, diaY)
  ctx.quadraticCurveTo(cx, diaY - bh * 0.04, cx + bw * 0.4, diaY)
  ctx.stroke()
}

function drawDigestiveSystem(ctx: CanvasRenderingContext2D, cx: number, headY: number, bw: number, bh: number, hr: number, color: string, _cosY: number) {
  ctx.strokeStyle = color
  ctx.fillStyle = color + '50'
  ctx.lineWidth = 2

  // Esophagus
  const esophTop = headY + hr + bh * 0.05
  const esophBot = headY + hr + bh * 0.2
  ctx.beginPath()
  ctx.moveTo(cx - bw * 0.02, esophTop)
  ctx.lineTo(cx - bw * 0.02, esophBot)
  ctx.lineTo(cx + bw * 0.02, esophBot)
  ctx.lineTo(cx + bw * 0.02, esophTop)
  ctx.stroke()

  // Stomach
  const stomachY = esophBot
  ctx.beginPath()
  ctx.ellipse(cx - bw * 0.08, stomachY + bh * 0.04, bw * 0.15, bh * 0.05, -0.3, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()

  // Liver
  ctx.beginPath()
  ctx.ellipse(cx + bw * 0.12, stomachY - bh * 0.02, bw * 0.2, bh * 0.06, 0.2, 0, Math.PI * 2)
  ctx.fillStyle = '#8B4513' + '40'
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = color + '50'

  // Gallbladder
  ctx.beginPath()
  ctx.ellipse(cx + bw * 0.18, stomachY + bh * 0.03, bw * 0.03, bh * 0.02, 0.5, 0, Math.PI * 2)
  ctx.fillStyle = '#228B22' + '60'
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = color + '50'

  // Pancreas
  ctx.beginPath()
  ctx.ellipse(cx, stomachY + bh * 0.08, bw * 0.15, bh * 0.02, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()

  // Small intestine
  const siY = stomachY + bh * 0.12
  ctx.beginPath()
  for (let i = 0; i < 8; i++) {
    const y = siY + i * bh * 0.02
    const offset = (i % 2 === 0 ? -1 : 1) * bw * 0.08
    ctx.ellipse(cx + offset, y, bw * 0.12, bh * 0.01, 0, 0, Math.PI * 2)
  }
  ctx.fill()
  ctx.stroke()

  // Large intestine (colon)
  ctx.lineWidth = 6
  ctx.beginPath()
  // Ascending colon
  ctx.moveTo(cx + bw * 0.25, siY + bh * 0.16)
  ctx.lineTo(cx + bw * 0.25, siY)
  // Transverse colon
  ctx.lineTo(cx - bw * 0.25, siY)
  // Descending colon
  ctx.lineTo(cx - bw * 0.25, siY + bh * 0.16)
  ctx.stroke()
  ctx.lineWidth = 2
}

function drawLymphaticSystem(ctx: CanvasRenderingContext2D, cx: number, headY: number, bw: number, bh: number, hr: number, color: string, _cosY: number) {
  ctx.strokeStyle = color
  ctx.fillStyle = color + '60'
  ctx.lineWidth = 1

  // Lymph nodes as small circles
  const nodePositions = [
    // Cervical nodes
    { x: cx - bw * 0.12, y: headY + hr + bh * 0.02 },
    { x: cx + bw * 0.12, y: headY + hr + bh * 0.02 },
    // Axillary nodes
    { x: cx - bw * 0.4, y: headY + hr + bh * 0.1 },
    { x: cx + bw * 0.4, y: headY + hr + bh * 0.1 },
    // Thoracic duct area
    { x: cx, y: headY + hr + bh * 0.15 },
    // Inguinal nodes
    { x: cx - bw * 0.18, y: headY + bh * 0.5 },
    { x: cx + bw * 0.18, y: headY + bh * 0.5 },
  ]

  nodePositions.forEach(pos => {
    ctx.beginPath()
    ctx.arc(pos.x, pos.y, 6, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  })

  // Thymus
  const thymusY = headY + hr + bh * 0.08
  ctx.beginPath()
  ctx.ellipse(cx, thymusY, bw * 0.08, bh * 0.03, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()

  // Spleen
  const spleenY = headY + hr + bh * 0.22
  ctx.beginPath()
  ctx.ellipse(cx - bw * 0.32, spleenY, bw * 0.08, bh * 0.04, -0.3, 0, Math.PI * 2)
  ctx.fillStyle = '#800020' + '60'
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = color + '60'

  // Lymphatic vessels (dashed)
  ctx.setLineDash([3, 3])
  ctx.beginPath()
  // Thoracic duct
  ctx.moveTo(cx, headY + hr + bh * 0.45)
  ctx.lineTo(cx, headY + hr + bh * 0.15)
  ctx.lineTo(cx - bw * 0.1, headY + hr + bh * 0.02)
  ctx.stroke()
  ctx.setLineDash([])
}

function drawUrinarySystem(ctx: CanvasRenderingContext2D, cx: number, headY: number, bw: number, bh: number, hr: number, color: string, _cosY: number) {
  ctx.strokeStyle = color
  ctx.fillStyle = color + '60'
  ctx.lineWidth = 2

  // Kidneys
  const kidneyY = headY + hr + bh * 0.22
  ctx.beginPath()
  ctx.ellipse(cx - bw * 0.25, kidneyY, bw * 0.06, bh * 0.045, -0.2, 0, Math.PI * 2)
  ctx.ellipse(cx + bw * 0.25, kidneyY + bh * 0.01, bw * 0.06, bh * 0.045, 0.2, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()

  // Ureters
  ctx.beginPath()
  ctx.moveTo(cx - bw * 0.22, kidneyY + bh * 0.04)
  ctx.quadraticCurveTo(cx - bw * 0.15, kidneyY + bh * 0.15, cx - bw * 0.08, kidneyY + bh * 0.22)
  ctx.moveTo(cx + bw * 0.22, kidneyY + bh * 0.05)
  ctx.quadraticCurveTo(cx + bw * 0.15, kidneyY + bh * 0.15, cx + bw * 0.08, kidneyY + bh * 0.22)
  ctx.stroke()

  // Bladder
  const bladderY = kidneyY + bh * 0.23
  ctx.beginPath()
  ctx.ellipse(cx, bladderY, bw * 0.1, bh * 0.04, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()

  // Urethra
  ctx.beginPath()
  ctx.moveTo(cx, bladderY + bh * 0.04)
  ctx.lineTo(cx, bladderY + bh * 0.08)
  ctx.stroke()

  // Adrenal glands
  ctx.fillStyle = '#9B59B6' + '60'
  ctx.beginPath()
  ctx.ellipse(cx - bw * 0.25, kidneyY - bh * 0.05, bw * 0.04, bh * 0.015, 0, 0, Math.PI * 2)
  ctx.ellipse(cx + bw * 0.25, kidneyY - bh * 0.04, bw * 0.04, bh * 0.015, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
}

function drawEndocrineSystem(ctx: CanvasRenderingContext2D, cx: number, headY: number, bw: number, bh: number, hr: number, color: string, _cosY: number) {
  ctx.strokeStyle = color
  ctx.fillStyle = color + '70'
  ctx.lineWidth = 2

  // Pituitary gland (in brain)
  ctx.beginPath()
  ctx.arc(cx, headY + hr * 0.1, 5, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()

  // Pineal gland
  ctx.beginPath()
  ctx.arc(cx, headY - hr * 0.2, 4, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()

  // Thyroid
  const thyroidY = headY + hr + bh * 0.03
  ctx.beginPath()
  ctx.ellipse(cx - bw * 0.05, thyroidY, bw * 0.04, bh * 0.02, -0.3, 0, Math.PI * 2)
  ctx.ellipse(cx + bw * 0.05, thyroidY, bw * 0.04, bh * 0.02, 0.3, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  // Isthmus
  ctx.beginPath()
  ctx.moveTo(cx - bw * 0.02, thyroidY)
  ctx.lineTo(cx + bw * 0.02, thyroidY)
  ctx.stroke()

  // Parathyroids (4 small dots behind thyroid)
  ctx.beginPath()
  ctx.arc(cx - bw * 0.06, thyroidY - bh * 0.01, 2, 0, Math.PI * 2)
  ctx.arc(cx + bw * 0.06, thyroidY - bh * 0.01, 2, 0, Math.PI * 2)
  ctx.arc(cx - bw * 0.06, thyroidY + bh * 0.01, 2, 0, Math.PI * 2)
  ctx.arc(cx + bw * 0.06, thyroidY + bh * 0.01, 2, 0, Math.PI * 2)
  ctx.fill()

  // Pancreatic islets (represented by pancreas outline)
  const pancreasY = headY + hr + bh * 0.28
  ctx.beginPath()
  ctx.ellipse(cx, pancreasY, bw * 0.15, bh * 0.02, 0, 0, Math.PI * 2)
  ctx.setLineDash([2, 2])
  ctx.stroke()
  ctx.setLineDash([])

  // Gonads (general representation)
  const gonadY = headY + bh * 0.52
  ctx.beginPath()
  ctx.ellipse(cx - bw * 0.1, gonadY, bw * 0.03, bh * 0.02, 0, 0, Math.PI * 2)
  ctx.ellipse(cx + bw * 0.1, gonadY, bw * 0.03, bh * 0.02, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
}

// ==================== MAIN COMPONENT ====================

export default function HumanAnatomy() {
  // View state
  const [sex, setSex] = useState<Sex>('male')
  const [rotation, setRotation] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [currentView, setCurrentView] = useState<ViewMode>('anterior')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)

  // Layer state
  const [visibleSystems, setVisibleSystems] = useState<Set<AnatomySystem>>(
    new Set(['skeletal', 'muscular', 'circulatory'])
  )
  const [layerOpacities, setLayerOpacities] = useState<Record<AnatomySystem, number>>(
    Object.fromEntries(anatomyLayers.map(l => [l.id, l.opacity])) as Record<AnatomySystem, number>
  )
  const [expandedLayers, setExpandedLayers] = useState<Set<AnatomySystem>>(new Set())

  // Selection state
  const [selectedElement, setSelectedElement] = useState<AnatomyElement | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [showInfo, setShowInfo] = useState(true)

  // Animation for auto-rotate
  useEffect(() => {
    if (!isPlaying) return
    const interval = setInterval(() => {
      setRotation(prev => ({ ...prev, y: prev.y + 0.01 }))
    }, 16)
    return () => clearInterval(interval)
  }, [isPlaying])

  // Toggle layer visibility
  const toggleLayer = (layer: AnatomySystem) => {
    setVisibleSystems(prev => {
      const next = new Set(prev)
      if (next.has(layer)) next.delete(layer)
      else next.add(layer)
      return next
    })
  }

  // Update layer opacity
  const updateOpacity = (layer: AnatomySystem, opacity: number) => {
    setLayerOpacities(prev => ({ ...prev, [layer]: opacity }))
  }

  // Apply view preset
  const applyViewPreset = (preset: typeof viewPresets[0]) => {
    setRotation(preset.rotation)
    setCurrentView(preset.id)
  }

  // Reset view
  const resetView = () => {
    setRotation({ x: 0, y: 0 })
    setZoom(1)
    setCurrentView('anterior')
  }

  // Filter elements by search
  const filteredElements = searchQuery
    ? anatomyElements.filter(e =>
        e.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        e.latinName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        e.system.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : anatomyElements

  return (
    <div className={clsx(
      'flex flex-col h-full',
      isFullscreen && 'fixed inset-0 z-50 bg-[var(--color-bg)]'
    )}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-bg-elevated)]">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <FiUser className="w-5 h-5 text-primary-400" />
            <h1 className="text-lg font-semibold">3D Human Anatomy</h1>
          </div>

          {/* Sex toggle */}
          <div className="flex items-center gap-1 bg-[var(--color-surface)] rounded-lg p-0.5">
            <button
              onClick={() => setSex('male')}
              className={clsx(
                'px-3 py-1 text-xs rounded transition-colors',
                sex === 'male'
                  ? 'bg-white/10 text-[var(--color-text-secondary)]'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
              )}
            >
              Male
            </button>
            <button
              onClick={() => setSex('female')}
              className={clsx(
                'px-3 py-1 text-xs rounded transition-colors',
                sex === 'female'
                  ? 'bg-white/10 text-[var(--color-text-secondary)]'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
              )}
            >
              Female
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className={clsx(
              'p-2 rounded transition-colors',
              isPlaying ? 'bg-primary-500/20 text-primary-400' : 'hover:bg-[var(--color-surface)]'
            )}
            title={isPlaying ? 'Stop rotation' : 'Auto-rotate'}
          >
            {isPlaying ? <FiPause className="w-4 h-4" /> : <FiPlay className="w-4 h-4" />}
          </button>
          <button
            onClick={() => setShowInfo(!showInfo)}
            className={clsx(
              'p-2 rounded transition-colors',
              showInfo ? 'bg-primary-500/20 text-primary-400' : 'hover:bg-[var(--color-surface)]'
            )}
            title="Toggle info panel"
          >
            <FiInfo className="w-4 h-4" />
          </button>
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-2 rounded hover:bg-[var(--color-surface)] transition-colors"
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <FiMinimize2 className="w-4 h-4" /> : <FiMaximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel - Layers */}
        <div className="w-64 border-r border-[var(--color-border)] bg-[var(--color-bg-elevated)] flex flex-col">
          <div className="p-3 border-b border-[var(--color-border)]">
            <div className="text-xs font-medium text-[var(--color-text-muted)] mb-2">BODY SYSTEMS</div>
            <div className="flex gap-1">
              <button
                onClick={() => setVisibleSystems(new Set(anatomyLayers.map(l => l.id)))}
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
            {anatomyLayers.map(layer => (
              <div key={layer.id} className="rounded border border-[var(--color-border)] overflow-hidden">
                <button
                  onClick={() => toggleLayer(layer.id)}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-2 text-xs transition-colors',
                    visibleSystems.has(layer.id)
                      ? 'bg-[var(--color-surface)]'
                      : 'opacity-60 hover:opacity-80'
                  )}
                >
                  <span
                    className="w-3 h-3 rounded-full border-2"
                    style={{
                      backgroundColor: visibleSystems.has(layer.id) ? layer.color : 'transparent',
                      borderColor: layer.color
                    }}
                  />
                  <span className="flex-1 text-left font-medium">{layer.name}</span>
                  {visibleSystems.has(layer.id) ? (
                    <FiEye className="w-3.5 h-3.5 text-[var(--color-text-secondary)]" />
                  ) : (
                    <FiEyeOff className="w-3.5 h-3.5" />
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setExpandedLayers(prev => {
                        const next = new Set(prev)
                        if (next.has(layer.id)) next.delete(layer.id)
                        else next.add(layer.id)
                        return next
                      })
                    }}
                    className="p-0.5 hover:bg-[var(--color-border)] rounded"
                  >
                    {expandedLayers.has(layer.id) ? (
                      <FiChevronDown className="w-3 h-3" />
                    ) : (
                      <FiChevronRight className="w-3 h-3" />
                    )}
                  </button>
                </button>

                {expandedLayers.has(layer.id) && (
                  <div className="px-3 py-2 bg-[var(--color-bg)] border-t border-[var(--color-border)]">
                    <div className="text-xxs text-[var(--color-text-muted)] mb-2">{layer.description}</div>
                    <div className="flex items-center gap-2">
                      <span className="text-xxs">Opacity:</span>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.1"
                        value={layerOpacities[layer.id]}
                        onChange={(e) => updateOpacity(layer.id, parseFloat(e.target.value))}
                        className="flex-1 h-1"
                      />
                      <span className="text-xxs w-8">{Math.round(layerOpacities[layer.id] * 100)}%</span>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Quick presets */}
          <div className="p-3 border-t border-[var(--color-border)]">
            <div className="text-xxs font-medium text-[var(--color-text-muted)] mb-2">QUICK PRESETS</div>
            <div className="grid grid-cols-2 gap-1">
              <button
                onClick={() => setVisibleSystems(new Set(['skeletal']))}
                className="px-2 py-1 text-xxs bg-[var(--color-surface)] rounded hover:bg-[var(--color-border)]"
              >
                Skeletal Only
              </button>
              <button
                onClick={() => setVisibleSystems(new Set(['muscular']))}
                className="px-2 py-1 text-xxs bg-[var(--color-surface)] rounded hover:bg-[var(--color-border)]"
              >
                Muscular Only
              </button>
              <button
                onClick={() => setVisibleSystems(new Set(['nervous']))}
                className="px-2 py-1 text-xxs bg-[var(--color-surface)] rounded hover:bg-[var(--color-border)]"
              >
                Nervous Only
              </button>
              <button
                onClick={() => setVisibleSystems(new Set(['circulatory']))}
                className="px-2 py-1 text-xxs bg-[var(--color-surface)] rounded hover:bg-[var(--color-border)]"
              >
                Circulatory Only
              </button>
            </div>
          </div>
        </div>

        {/* Main Viewer */}
        <div className="flex-1 relative bg-[#0a0f14]">
          <Anatomy3DViewer
            visibleSystems={visibleSystems}
            sex={sex}
            rotation={rotation}
            zoom={zoom}
            onRotationChange={setRotation}
            selectedElement={selectedElement}
            onElementSelect={setSelectedElement}
            layerOpacities={layerOpacities}
          />

          {/* View controls overlay */}
          <div className="absolute top-4 left-4 flex flex-col gap-2">
            {/* View presets */}
            <div className="bg-[var(--color-surface)]/90 backdrop-blur rounded-lg border border-[var(--color-border)] p-2">
              <div className="text-xxs font-medium text-[var(--color-text-muted)] mb-2">VIEW</div>
              <div className="grid grid-cols-2 gap-1">
                {viewPresets.slice(0, 4).map(preset => (
                  <button
                    key={preset.id}
                    onClick={() => applyViewPreset(preset)}
                    className={clsx(
                      'px-2 py-1 text-xxs rounded transition-colors',
                      currentView === preset.id
                        ? 'bg-primary-500/20 text-primary-400'
                        : 'hover:bg-[var(--color-border)]'
                    )}
                  >
                    {preset.name.split(' ')[0]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Zoom controls */}
          <div className="absolute bottom-4 left-4 flex items-center gap-1 bg-[var(--color-surface)]/90 backdrop-blur rounded-lg border border-[var(--color-border)] p-1">
            <button
              onClick={() => setZoom(z => Math.min(2, z + 0.1))}
              className="p-1.5 hover:bg-[var(--color-border)] rounded transition-colors"
              title="Zoom In"
            >
              <FiZoomIn className="w-4 h-4" />
            </button>
            <span className="px-2 text-xs text-[var(--color-text-muted)] min-w-[3rem] text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => setZoom(z => Math.max(0.5, z - 0.1))}
              className="p-1.5 hover:bg-[var(--color-border)] rounded transition-colors"
              title="Zoom Out"
            >
              <FiZoomOut className="w-4 h-4" />
            </button>
            <div className="w-px h-4 bg-[var(--color-border)] mx-1" />
            <button
              onClick={resetView}
              className="p-1.5 hover:bg-[var(--color-border)] rounded transition-colors"
              title="Reset View" aria-label="Reset View"
            >
              <FiRotateCw className="w-4 h-4" />
            </button>
            <button
              className="p-1.5 hover:bg-[var(--color-border)] rounded transition-colors"
              title="Center" aria-label="Center"
            >
              <FiCrosshair className="w-4 h-4" />
            </button>
          </div>

          {/* Rotation indicator */}
          <div className="absolute bottom-4 right-4 text-xs text-[var(--color-text-muted)] bg-[var(--color-surface)]/90 backdrop-blur px-3 py-1.5 rounded-lg border border-[var(--color-border)]">
            <span className="mr-2">Rotation:</span>
            <span className="font-mono">{Math.round(rotation.y * (180 / Math.PI))}°</span>
          </div>
        </div>

        {/* Right Panel - Info & Search */}
        {showInfo && (
          <div className="w-80 border-l border-[var(--color-border)] bg-[var(--color-bg-elevated)] flex flex-col">
            {/* Search */}
            <div className="p-3 border-b border-[var(--color-border)]">
              <div className="relative">
                <FiSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search anatomy..."
                  className="w-full pl-8 pr-3 py-2 text-sm bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg focus:outline-none focus:border-primary-500"
                />
              </div>
            </div>

            {/* Selected element info */}
            {selectedElement ? (
              <div className="p-4 border-b border-[var(--color-border)]">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h3 className="font-semibold">{selectedElement.name}</h3>
                    {selectedElement.latinName && (
                      <p className="text-xs italic text-[var(--color-text-muted)]">{selectedElement.latinName}</p>
                    )}
                  </div>
                  <span
                    className="px-2 py-0.5 text-xxs rounded-full"
                    style={{
                      backgroundColor: anatomyLayers.find(l => l.id === selectedElement.system)?.color + '30',
                      color: anatomyLayers.find(l => l.id === selectedElement.system)?.color
                    }}
                  >
                    {selectedElement.system}
                  </span>
                </div>
                <p className="text-sm text-[var(--color-text-secondary)] mb-3">{selectedElement.description}</p>
                {selectedElement.function && (
                  <div className="mb-2">
                    <span className="text-xs font-medium text-[var(--color-text-muted)]">Function:</span>
                    <p className="text-xs text-[var(--color-text-secondary)]">{selectedElement.function}</p>
                  </div>
                )}
                {selectedElement.clinicalNotes && (
                  <div>
                    <span className="text-xs font-medium text-[var(--color-text-muted)]">Clinical Notes:</span>
                    <ul className="mt-1 space-y-1">
                      {selectedElement.clinicalNotes.map((note, i) => (
                        <li key={i} className="text-xs text-[var(--color-text-secondary)] flex items-start gap-1">
                          <span className="text-primary-400">•</span>
                          {note}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-4 text-center text-sm text-[var(--color-text-muted)]">
                Click on an anatomical structure to view details
              </div>
            )}

            {/* Elements list */}
            <div className="flex-1 overflow-y-auto">
              <div className="p-3">
                <div className="text-xs font-medium text-[var(--color-text-muted)] mb-2">
                  ANATOMICAL STRUCTURES ({filteredElements.length})
                </div>
                <div className="space-y-1">
                  {filteredElements.map(element => (
                    <button
                      key={element.id}
                      onClick={() => setSelectedElement(element)}
                      className={clsx(
                        'w-full text-left px-3 py-2 rounded-lg text-sm transition-colors',
                        selectedElement?.id === element.id
                          ? 'bg-primary-500/20 text-primary-400'
                          : 'hover:bg-[var(--color-surface)]'
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: anatomyLayers.find(l => l.id === element.system)?.color }}
                        />
                        <span className="flex-1 truncate">{element.name}</span>
                        <span className="text-xxs text-[var(--color-text-muted)]">{element.region}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="p-3 border-t border-[var(--color-border)]">
              <div className="flex gap-2">
                <button className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-xs bg-[var(--color-surface)] rounded-lg hover:bg-[var(--color-border)] transition-colors">
                  <FiDownload className="w-3.5 h-3.5" />
                  Export
                </button>
                <button className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-xs bg-[var(--color-surface)] rounded-lg hover:bg-[var(--color-border)] transition-colors">
                  <FiBookOpen className="w-3.5 h-3.5" />
                  Learn More
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
