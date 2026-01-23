import { useState, useRef, useEffect } from 'react'
import {
  FiBox,
  FiZoomIn,
  FiZoomOut,
  FiRotateCw,
  FiMove,
  FiEye,
  FiEyeOff,
  FiTag,
  FiDownload,
  FiUpload,
  FiMaximize2,
  FiGrid,
  FiLayers,
  FiSettings,
  FiChevronRight,
  FiChevronDown,
  FiInfo,
  FiCrosshair
} from 'react-icons/fi'
import clsx from 'clsx'

interface MolecularComponent {
  id: string
  name: string
  type: 'dna' | 'rna' | 'protein' | 'drug' | 'pathway'
  visible: boolean
  color: string
  tags: string[]
  description?: string
}

const mockComponents: MolecularComponent[] = [
  { id: '1', name: 'TP53 Gene', type: 'dna', visible: true, color: '#3b82f6', tags: ['tumor suppressor', 'mutation hotspot'], description: 'Tumor protein p53, a crucial tumor suppressor gene' },
  { id: '2', name: 'mRNA Transcript', type: 'rna', visible: true, color: '#f97316', tags: ['transcript', 'coding'], description: 'Messenger RNA encoding p53 protein' },
  { id: '3', name: 'p53 Protein', type: 'protein', visible: true, color: '#8b5cf6', tags: ['transcription factor', 'DNA binding'], description: 'p53 protein tetramer structure' },
  { id: '4', name: 'Nutlin-3a', type: 'drug', visible: true, color: '#10b981', tags: ['MDM2 inhibitor', 'small molecule'], description: 'MDM2 antagonist that activates p53 pathway' },
  { id: '5', name: 'Apoptosis Pathway', type: 'pathway', visible: false, color: '#ec4899', tags: ['cell death', 'downstream'], description: 'p53-mediated apoptotic signaling cascade' },
]

const typeColors: Record<MolecularComponent['type'], string> = {
  dna: '#3b82f6',
  rna: '#f97316',
  protein: '#8b5cf6',
  drug: '#10b981',
  pathway: '#ec4899',
}

const typeLabels: Record<MolecularComponent['type'], string> = {
  dna: 'DNA',
  rna: 'RNA',
  protein: 'Protein',
  drug: 'Drug',
  pathway: 'Pathway',
}

function Canvas3D({ components, selectedId, onSelect: _onSelect }: {
  components: MolecularComponent[]
  selectedId: string | null
  onSelect: (id: string | null) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [rotation, setRotation] = useState({ x: 0.3, y: 0.5 })
  const [zoom, setZoom] = useState(1)
  const [isDragging, setIsDragging] = useState(false)
  const [lastMouse, setLastMouse] = useState({ x: 0, y: 0 })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const draw = () => {
      const { width, height } = canvas
      ctx.clearRect(0, 0, width, height)

      // Draw grid
      ctx.strokeStyle = 'rgba(6, 182, 212, 0.05)'
      ctx.lineWidth = 1
      const gridSize = 30 * zoom
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

      // Draw molecular representations
      const centerX = width / 2
      const centerY = height / 2
      const visibleComponents = components.filter(c => c.visible)

      visibleComponents.forEach((component, index) => {
        const angle = (index / visibleComponents.length) * Math.PI * 2 + rotation.y
        const radius = 120 * zoom
        const x = centerX + Math.cos(angle) * radius
        const y = centerY + Math.sin(angle) * radius * 0.5 + Math.sin(rotation.x) * 50

        // Draw connecting lines
        if (index > 0) {
          const prevAngle = ((index - 1) / visibleComponents.length) * Math.PI * 2 + rotation.y
          const prevX = centerX + Math.cos(prevAngle) * radius
          const prevY = centerY + Math.sin(prevAngle) * radius * 0.5 + Math.sin(rotation.x) * 50

          ctx.strokeStyle = 'rgba(6, 182, 212, 0.2)'
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(prevX, prevY)
          ctx.lineTo(x, y)
          ctx.stroke()
        }

        // Draw component
        const size = (30 + (component.type === 'protein' ? 15 : 0)) * zoom
        const isSelected = selectedId === component.id

        // Glow effect for selected
        if (isSelected) {
          ctx.shadowColor = component.color
          ctx.shadowBlur = 20
        }

        ctx.fillStyle = component.color + (isSelected ? 'ff' : '99')
        ctx.beginPath()

        if (component.type === 'dna') {
          // Double helix representation
          ctx.ellipse(x, y, size * 0.6, size, 0, 0, Math.PI * 2)
        } else if (component.type === 'rna') {
          // Single strand
          ctx.ellipse(x, y, size * 0.4, size * 0.8, Math.PI / 4, 0, Math.PI * 2)
        } else if (component.type === 'protein') {
          // Complex shape
          ctx.arc(x, y, size, 0, Math.PI * 2)
        } else if (component.type === 'drug') {
          // Small hexagon
          for (let i = 0; i < 6; i++) {
            const hx = x + Math.cos(i * Math.PI / 3) * size * 0.7
            const hy = y + Math.sin(i * Math.PI / 3) * size * 0.7
            if (i === 0) ctx.moveTo(hx, hy)
            else ctx.lineTo(hx, hy)
          }
          ctx.closePath()
        } else {
          // Pathway - network-like
          ctx.rect(x - size / 2, y - size / 2, size, size)
        }
        ctx.fill()

        ctx.shadowBlur = 0

        // Draw label
        ctx.fillStyle = 'var(--color-text)'
        ctx.font = '10px Inter'
        ctx.textAlign = 'center'
        ctx.fillText(component.name, x, y + size + 15)

        // Draw type badge
        ctx.fillStyle = component.color
        ctx.font = '8px Inter'
        ctx.fillText(typeLabels[component.type], x, y + size + 25)
      })

      // Draw center axis indicator
      ctx.strokeStyle = 'rgba(6, 182, 212, 0.3)'
      ctx.lineWidth = 1
      ctx.setLineDash([5, 5])
      ctx.beginPath()
      ctx.moveTo(centerX - 50, centerY)
      ctx.lineTo(centerX + 50, centerY)
      ctx.moveTo(centerX, centerY - 50)
      ctx.lineTo(centerX, centerY + 50)
      ctx.stroke()
      ctx.setLineDash([])
    }

    draw()
  }, [components, rotation, zoom, selectedId])

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true)
    setLastMouse({ x: e.clientX, y: e.clientY })
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return
    const dx = e.clientX - lastMouse.x
    const dy = e.clientY - lastMouse.y
    setRotation(prev => ({
      x: prev.x + dy * 0.01,
      y: prev.y + dx * 0.01,
    }))
    setLastMouse({ x: e.clientX, y: e.clientY })
  }

  const handleMouseUp = () => {
    setIsDragging(false)
  }

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    setZoom(prev => Math.max(0.5, Math.min(2, prev - e.deltaY * 0.001)))
  }

  return (
    <div className="relative w-full h-full canvas-container">
      <canvas
        ref={canvasRef}
        width={800}
        height={600}
        className="w-full h-full cursor-grab active:cursor-grabbing"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      />

      {/* Viewport controls */}
      <div className="absolute bottom-4 left-4 flex items-center gap-1 bg-[var(--color-surface)]/90 backdrop-blur rounded-lg border border-[var(--color-border)] p-1">
        <button
          onClick={() => setZoom(z => Math.min(2, z + 0.1))}
          className="p-1.5 hover:bg-[var(--color-border)] rounded transition-colors"
          title="Zoom In"
        >
          <FiZoomIn className="w-3.5 h-3.5" />
        </button>
        <span className="px-2 text-xs text-[var(--color-text-muted)]">{Math.round(zoom * 100)}%</span>
        <button
          onClick={() => setZoom(z => Math.max(0.5, z - 0.1))}
          className="p-1.5 hover:bg-[var(--color-border)] rounded transition-colors"
          title="Zoom Out"
        >
          <FiZoomOut className="w-3.5 h-3.5" />
        </button>
        <div className="w-px h-4 bg-[var(--color-border)] mx-1" />
        <button
          onClick={() => setRotation({ x: 0.3, y: 0.5 })}
          className="p-1.5 hover:bg-[var(--color-border)] rounded transition-colors"
          title="Reset View"
        >
          <FiRotateCw className="w-3.5 h-3.5" />
        </button>
        <button
          className="p-1.5 hover:bg-[var(--color-border)] rounded transition-colors"
          title="Center View"
        >
          <FiCrosshair className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* View mode indicator */}
      <div className="absolute top-4 left-4 flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
        <FiBox className="w-3.5 h-3.5" />
        <span>3D Molecular View</span>
      </div>
    </div>
  )
}

function ComponentTree({ components, selectedId, onSelect, onToggleVisibility }: {
  components: MolecularComponent[]
  selectedId: string | null
  onSelect: (id: string) => void
  onToggleVisibility: (id: string) => void
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    dna: true,
    rna: true,
    protein: true,
    drug: true,
    pathway: true,
  })

  const groupedComponents = components.reduce((acc, comp) => {
    if (!acc[comp.type]) acc[comp.type] = []
    acc[comp.type].push(comp)
    return acc
  }, {} as Record<string, MolecularComponent[]>)

  return (
    <div className="space-y-1">
      {Object.entries(groupedComponents).map(([type, comps]) => (
        <div key={type}>
          <button
            onClick={() => setExpanded(e => ({ ...e, [type]: !e[type] }))}
            className="flex items-center gap-1.5 w-full px-2 py-1 text-xs hover:bg-[var(--color-border)] rounded transition-colors"
          >
            {expanded[type] ? <FiChevronDown className="w-3 h-3" /> : <FiChevronRight className="w-3 h-3" />}
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: typeColors[type as MolecularComponent['type']] }}
            />
            <span className="flex-1 text-left">{typeLabels[type as MolecularComponent['type']]}</span>
            <span className="text-[var(--color-text-muted)]">{comps.length}</span>
          </button>
          {expanded[type] && (
            <div className="ml-4 space-y-0.5">
              {comps.map(comp => (
                <div
                  key={comp.id}
                  onClick={() => onSelect(comp.id)}
                  className={clsx(
                    'flex items-center gap-1.5 px-2 py-1 text-xs rounded cursor-pointer transition-colors',
                    selectedId === comp.id
                      ? 'bg-primary-500/20 text-primary-400'
                      : 'hover:bg-[var(--color-border)] text-[var(--color-text-secondary)]'
                  )}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onToggleVisibility(comp.id)
                    }}
                    className="p-0.5 hover:bg-[var(--color-surface)] rounded"
                  >
                    {comp.visible ? (
                      <FiEye className="w-3 h-3" />
                    ) : (
                      <FiEyeOff className="w-3 h-3 text-[var(--color-text-muted)]" />
                    )}
                  </button>
                  <span className={clsx(!comp.visible && 'text-[var(--color-text-muted)]')}>
                    {comp.name}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function PropertiesPanel({ component }: { component: MolecularComponent | null }) {
  if (!component) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-[var(--color-text-muted)] text-xs">
        <FiInfo className="w-6 h-6 mb-2" />
        <span>Select a component to view properties</span>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div>
        <div className="text-xxs text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Name</div>
        <div className="text-sm font-medium">{component.name}</div>
      </div>

      <div>
        <div className="text-xxs text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Type</div>
        <div className="flex items-center gap-1.5">
          <span
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: component.color }}
          />
          <span className="text-xs">{typeLabels[component.type]}</span>
        </div>
      </div>

      {component.description && (
        <div>
          <div className="text-xxs text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Description</div>
          <p className="text-xs text-[var(--color-text-secondary)]">{component.description}</p>
        </div>
      )}

      <div>
        <div className="text-xxs text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Tags</div>
        <div className="flex flex-wrap gap-1">
          {component.tags.map(tag => (
            <span key={tag} className="badge badge-neutral">{tag}</span>
          ))}
        </div>
      </div>

      <div>
        <div className="text-xxs text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Color</div>
        <div className="flex items-center gap-2">
          <div
            className="w-6 h-6 rounded border border-[var(--color-border)]"
            style={{ backgroundColor: component.color }}
          />
          <span className="text-xs font-mono">{component.color}</span>
        </div>
      </div>
    </div>
  )
}

export default function Workbench() {
  const [components, setComponents] = useState<MolecularComponent[]>(mockComponents)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showGrid, setShowGrid] = useState(true)
  const [showLabels, setShowLabels] = useState(true)

  const selectedComponent = components.find(c => c.id === selectedId) || null

  const toggleVisibility = (id: string) => {
    setComponents(prev =>
      prev.map(c => c.id === id ? { ...c, visible: !c.visible } : c)
    )
  }

  return (
    <div className="flex h-full">
      {/* Left panel - Component Tree */}
      <div className="w-56 border-r border-[var(--color-border)] bg-[var(--color-bg-elevated)] flex flex-col">
        <div className="p-3 border-b border-[var(--color-border)]">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium">Components</h3>
            <button className="p-1 hover:bg-[var(--color-surface)] rounded transition-colors" title="Add Component">
              <FiUpload className="w-3.5 h-3.5" />
            </button>
          </div>
          <input
            type="text"
            placeholder="Filter components..."
            className="input w-full text-xs"
          />
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          <ComponentTree
            components={components}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onToggleVisibility={toggleVisibility}
          />
        </div>
      </div>

      {/* Main viewport */}
      <div className="flex-1 flex flex-col">
        {/* Toolbar */}
        <div className="h-10 flex items-center justify-between px-3 border-b border-[var(--color-border)] bg-[var(--color-bg-elevated)]">
          <div className="flex items-center gap-1">
            <button className="btn btn-sm btn-secondary">
              <FiMove className="w-3 h-3" />
              Pan
            </button>
            <button className="btn btn-sm btn-secondary">
              <FiRotateCw className="w-3 h-3" />
              Rotate
            </button>
            <button className="btn btn-sm btn-secondary">
              <FiZoomIn className="w-3 h-3" />
              Zoom
            </button>
            <div className="w-px h-5 bg-[var(--color-border)] mx-2" />
            <button
              onClick={() => setShowGrid(!showGrid)}
              className={clsx('btn btn-sm', showGrid ? 'btn-primary' : 'btn-secondary')}
            >
              <FiGrid className="w-3 h-3" />
            </button>
            <button
              onClick={() => setShowLabels(!showLabels)}
              className={clsx('btn btn-sm', showLabels ? 'btn-primary' : 'btn-secondary')}
            >
              <FiTag className="w-3 h-3" />
            </button>
            <button className="btn btn-sm btn-secondary">
              <FiLayers className="w-3 h-3" />
            </button>
          </div>
          <div className="flex items-center gap-1">
            <button className="btn btn-sm btn-secondary">
              <FiDownload className="w-3 h-3" />
              Export
            </button>
            <button className="btn btn-sm btn-secondary">
              <FiMaximize2 className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* 3D Canvas */}
        <div className="flex-1 relative">
          <Canvas3D
            components={components}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </div>
      </div>

      {/* Right panel - Properties */}
      <div className="w-64 border-l border-[var(--color-border)] bg-[var(--color-bg-elevated)] flex flex-col">
        <div className="p-3 border-b border-[var(--color-border)]">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Properties</h3>
            <button className="p-1 hover:bg-[var(--color-surface)] rounded transition-colors">
              <FiSettings className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <PropertiesPanel component={selectedComponent} />
        </div>

        {/* Tag input */}
        {selectedComponent && (
          <div className="p-3 border-t border-[var(--color-border)]">
            <div className="text-xxs text-[var(--color-text-muted)] uppercase tracking-wider mb-2">Add Tag</div>
            <div className="flex gap-1">
              <input
                type="text"
                placeholder="New tag..."
                className="input flex-1 text-xs"
              />
              <button className="btn btn-sm btn-primary">
                <FiTag className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
