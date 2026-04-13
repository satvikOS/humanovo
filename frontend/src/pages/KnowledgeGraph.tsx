import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  FiSearch, FiZoomIn, FiZoomOut, FiMaximize, FiFilter,
  FiDownload, FiShare2, FiLayers,
  FiChevronRight, FiChevronDown, FiExternalLink, FiX,
  FiInfo, FiBook, FiLink, FiCheck
} from 'react-icons/fi'
import { api, Entity } from '../services/api'

// Entity type colors and configurations
const ENTITY_COLORS = {
  gene: { bg: '#3B82F6', border: '#1D4ED8', text: 'Gene' },
  protein: { bg: '#8B5CF6', border: '#6D28D9', text: 'Protein' },
  disease: { bg: '#EF4444', border: '#B91C1C', text: 'Disease' },
  drug: { bg: '#10B981', border: '#047857', text: 'Drug' },
  pathway: { bg: '#F59E0B', border: '#B45309', text: 'Pathway' },
  biomarker: { bg: '#EC4899', border: '#BE185D', text: 'Biomarker' },
  adc: { bg: '#06B6D4', border: '#0891B2', text: 'ADC' },
  antigen: { bg: '#14B8A6', border: '#0D9488', text: 'Antigen' },
  cell_type: { bg: '#6366F1', border: '#4338CA', text: 'Cell Type' },
  mutation: { bg: '#F97316', border: '#C2410C', text: 'Mutation' },
}

// Relation type configurations
const RELATION_TYPES = {
  treats: { color: '#10B981', label: 'Treats' },
  targets: { color: '#3B82F6', label: 'Targets' },
  inhibits: { color: '#EF4444', label: 'Inhibits' },
  activates: { color: '#22C55E', label: 'Activates' },
  causes: { color: '#F97316', label: 'Causes' },
  associates: { color: '#8B5CF6', label: 'Associates' },
  expresses: { color: '#EC4899', label: 'Expresses' },
  resistance: { color: '#F59E0B', label: 'Resistance' },
  modulates: { color: '#06B6D4', label: 'Modulates' },
  biomarker_of: { color: '#14B8A6', label: 'Biomarker Of' },
}

// Context categories
const CONTEXT_CATEGORIES = [
  { id: 'drug_context', label: 'Drug/Treatment', color: '#10B981' },
  { id: 'indication_context', label: 'Disease/Indication', color: '#EF4444' },
  { id: 'resistance_context', label: 'Resistance', color: '#F59E0B' },
  { id: 'biomarker_context', label: 'Biomarker', color: '#EC4899' },
  { id: 'outcome_context', label: 'Clinical Outcome', color: '#3B82F6' },
  { id: 'mechanism_context', label: 'Mechanism', color: '#8B5CF6' },
]

// Confidence levels
const CONFIDENCE_LEVELS = [
  { id: 'very_high', label: 'Very High (>0.8)', min: 0.8, color: '#22C55E' },
  { id: 'high', label: 'High (0.6-0.8)', min: 0.6, color: '#3B82F6' },
  { id: 'moderate', label: 'Moderate (0.4-0.6)', min: 0.4, color: '#F59E0B' },
  { id: 'low', label: 'Low (<0.4)', min: 0, color: '#EF4444' },
]

interface GraphNode {
  id: string
  label: string
  type: string
  x?: number
  y?: number
  confidence?: number
  sources?: number
  metadata?: Record<string, unknown>
}

interface GraphEdge {
  id: string
  source: string
  target: string
  relation: string
  confidence: number
  evidenceCount: number
  evidence?: Array<{
    text: string
    source: string
    confidence: number
  }>
}

interface FilterState {
  entityTypes: string[]
  relationTypes: string[]
  contexts: string[]
  minConfidence: number
  showOrphans: boolean
}

export default function KnowledgeGraph() {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedEntity, setSelectedEntity] = useState<Entity | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null)
  const [showFilters, setShowFilters] = useState(true)
  const [, setShowEvidencePanel] = useState(false)
  const [expandedSections, setExpandedSections] = useState({
    entityTypes: true,
    relationTypes: true,
    contexts: false,
    confidence: true,
  })
  const [filters, setFilters] = useState<FilterState>({
    entityTypes: Object.keys(ENTITY_COLORS),
    relationTypes: Object.keys(RELATION_TYPES),
    contexts: [],
    minConfidence: 0,
    showOrphans: false,
  })
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [connectMode, setConnectMode] = useState(false)
  const [connectSource, setConnectSource] = useState<GraphNode | null>(null)
  const [connectRelation, setConnectRelation] = useState<string>('associates')
  const [showConnectDialog, setShowConnectDialog] = useState<{ source: GraphNode; target: GraphNode } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Graph data - fetched from backend knowledge graph API
  const [graphData, setGraphData] = useState<{ nodes: GraphNode[], edges: GraphEdge[] }>({
    nodes: [],
    edges: [],
  })
  const [, setGraphLoading] = useState(true)

  // Fetch graph data from API on mount
  useEffect(() => {
    const fetchGraph = async () => {
      setGraphLoading(true)
      try {
        const res = await fetch('/api/v1/knowledge-graph/full')
        if (res.ok) {
          const data = await res.json()
          const nodes: GraphNode[] = (data.nodes || []).map((n: any) => ({
            id: n.id,
            label: n.name || n.label || n.id,
            type: n.entity_type || n.type || 'gene',
            confidence: n.confidence || 0.5,
            sources: n.source_count || 0,
          }))
          const edges: GraphEdge[] = (data.edges || data.relations || []).map((e: any) => ({
            id: e.id,
            source: e.source_id || e.source,
            target: e.target_id || e.target,
            relation: e.relation_type || e.relation || 'associates',
            confidence: e.confidence || 0.5,
            evidenceCount: e.evidence_count || 0,
          }))
          setGraphData({ nodes, edges })
        }
      } catch (err) {
        console.warn('Failed to fetch knowledge graph data:', err)
      }
      setGraphLoading(false)
    }
    fetchGraph()
  }, [])

  const { data: searchResults } = useQuery({
    queryKey: ['entities', 'search', searchQuery],
    queryFn: () => api.searchEntities(searchQuery, { limit: 20 }),
    enabled: searchQuery.length >= 2,
  })

  const { data: neighborhood } = useQuery({
    queryKey: ['entity', 'neighborhood', selectedEntity?.id],
    queryFn: () => api.getEntityNeighbors(selectedEntity!.id, { depth: 1, limit: 50 }),
    enabled: !!selectedEntity,
  })

  const { data: stats } = useQuery({
    queryKey: ['knowledge', 'stats'],
    queryFn: () => api.getGraphStats(),
  })

  // Filter graph data based on current filters
  const filteredGraph = useMemo(() => {
    const visibleNodes = graphData.nodes.filter(node => {
      if (!filters.entityTypes.includes(node.type)) return false
      if (node.confidence && node.confidence < filters.minConfidence) return false
      return true
    })
    const visibleNodeIds = new Set(visibleNodes.map(n => n.id))

    const visibleEdges = graphData.edges.filter(edge => {
      if (!visibleNodeIds.has(edge.source) || !visibleNodeIds.has(edge.target)) return false
      if (!filters.relationTypes.includes(edge.relation)) return false
      if (edge.confidence < filters.minConfidence) return false
      return true
    })

    return { nodes: visibleNodes, edges: visibleEdges }
  }, [graphData, filters])

  // Position nodes in a force-directed layout (simplified)
  const positionedNodes = useMemo(() => {
    const centerX = 400
    const centerY = 300
    const radius = 200

    return filteredGraph.nodes.map((node, i) => {
      const angle = (2 * Math.PI * i) / filteredGraph.nodes.length
      return {
        ...node,
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle),
      }
    })
  }, [filteredGraph.nodes])

  // Draw the graph
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Set canvas size
    canvas.width = canvas.offsetWidth * window.devicePixelRatio
    canvas.height = canvas.offsetHeight * window.devicePixelRatio
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio)

    // Clear canvas
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim() || '#000000'
    ctx.fillRect(0, 0, canvas.offsetWidth, canvas.offsetHeight)

    // Apply zoom and pan
    ctx.save()
    ctx.translate(pan.x, pan.y)
    ctx.scale(zoom, zoom)

    // Draw edges as curved bezier lines
    filteredGraph.edges.forEach(edge => {
      const sourceNode = positionedNodes.find(n => n.id === edge.source)
      const targetNode = positionedNodes.find(n => n.id === edge.target)
      if (!sourceNode || !targetNode) return

      const relationConfig = RELATION_TYPES[edge.relation as keyof typeof RELATION_TYPES]
      const color = relationConfig?.color || '#64748b'
      const alpha = Math.max(0.3, edge.confidence)

      // Calculate control point for quadratic bezier curve
      const midX = (sourceNode.x! + targetNode.x!) / 2
      const midY = (sourceNode.y! + targetNode.y!) / 2
      const dx = targetNode.x! - sourceNode.x!
      const dy = targetNode.y! - sourceNode.y!
      const dist = Math.sqrt(dx * dx + dy * dy)
      // Perpendicular offset for curve — scales with distance
      const curvature = Math.min(dist * 0.2, 40)
      const nx = -dy / dist  // normal x
      const ny = dx / dist   // normal y
      const cpX = midX + nx * curvature
      const cpY = midY + ny * curvature

      ctx.beginPath()
      ctx.moveTo(sourceNode.x!, sourceNode.y!)
      ctx.quadraticCurveTo(cpX, cpY, targetNode.x!, targetNode.y!)
      ctx.strokeStyle = color
      ctx.globalAlpha = alpha
      ctx.lineWidth = selectedEdge?.id === edge.id ? 3 : 1.5
      ctx.stroke()
      ctx.globalAlpha = 1

      // Draw arrow at the target end, tangent to the curve
      const t = 0.92  // point near the end of the curve to compute tangent
      const bx = (1 - t) * (1 - t) * sourceNode.x! + 2 * (1 - t) * t * cpX + t * t * targetNode.x!
      const by = (1 - t) * (1 - t) * sourceNode.y! + 2 * (1 - t) * t * cpY + t * t * targetNode.y!
      const angle = Math.atan2(targetNode.y! - by, targetNode.x! - bx)
      const arrowSize = 8
      const arrowX = targetNode.x! - 25 * Math.cos(angle)
      const arrowY = targetNode.y! - 25 * Math.sin(angle)

      ctx.beginPath()
      ctx.moveTo(arrowX, arrowY)
      ctx.lineTo(
        arrowX - arrowSize * Math.cos(angle - Math.PI / 6),
        arrowY - arrowSize * Math.sin(angle - Math.PI / 6)
      )
      ctx.lineTo(
        arrowX - arrowSize * Math.cos(angle + Math.PI / 6),
        arrowY - arrowSize * Math.sin(angle + Math.PI / 6)
      )
      ctx.closePath()
      ctx.fillStyle = color
      ctx.fill()
    })

    // Draw in-progress connection line when in connect mode
    if (connectMode && connectSource) {
      const srcNode = positionedNodes.find(n => n.id === connectSource.id)
      if (srcNode) {
        ctx.beginPath()
        ctx.setLineDash([6, 4])
        ctx.moveTo(srcNode.x!, srcNode.y!)
        // Draw to cursor position (approximate center if no mouse tracking)
        ctx.strokeStyle = '#3B82F6'
        ctx.globalAlpha = 0.6
        ctx.lineWidth = 2
        ctx.stroke()
        ctx.setLineDash([])
        ctx.globalAlpha = 1
      }
    }

    // Draw nodes
    positionedNodes.forEach(node => {
      const entityConfig = ENTITY_COLORS[node.type as keyof typeof ENTITY_COLORS]
      const bgColor = entityConfig?.bg || '#64748b'
      const borderColor = entityConfig?.border || '#475569'
      const isSelected = selectedEntity?.id === node.id

      // Node circle
      ctx.beginPath()
      ctx.arc(node.x!, node.y!, isSelected ? 28 : 22, 0, 2 * Math.PI)
      ctx.fillStyle = bgColor
      ctx.fill()
      ctx.strokeStyle = isSelected ? '#ffffff' : borderColor
      ctx.lineWidth = isSelected ? 3 : 2
      ctx.stroke()

      // Node label
      ctx.fillStyle = '#ffffff'
      ctx.font = 'bold 11px Inter, system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const label = node.label.length > 8 ? node.label.slice(0, 7) + '...' : node.label
      ctx.fillText(label, node.x!, node.y!)

      // Confidence indicator
      if (node.confidence) {
        const confLevel = CONFIDENCE_LEVELS.find(l => node.confidence! >= l.min)
        if (confLevel) {
          ctx.beginPath()
          ctx.arc(node.x! + 18, node.y! - 18, 6, 0, 2 * Math.PI)
          ctx.fillStyle = confLevel.color
          ctx.fill()
        }
      }
    })

    ctx.restore()
  }, [filteredGraph, positionedNodes, zoom, pan, selectedEntity, selectedEdge])

  // Add a new edge between two nodes
  const addEdge = useCallback((source: GraphNode, target: GraphNode, relation: string) => {
    const newEdge: GraphEdge = {
      id: `e-custom-${Date.now()}`,
      source: source.id,
      target: target.id,
      relation,
      confidence: 0.75,
      evidenceCount: 0,
    }
    setGraphData(prev => ({
      ...prev,
      edges: [...prev.edges, newEdge],
    }))
  }, [])

  // Handle canvas click
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const x = (e.clientX - rect.left - pan.x) / zoom
    const y = (e.clientY - rect.top - pan.y) / zoom

    // Check if clicked on a node
    for (const node of positionedNodes) {
      const dist = Math.sqrt((x - node.x!) ** 2 + (y - node.y!) ** 2)
      if (dist < 25) {
        // Connect mode: select source then target
        if (connectMode) {
          if (!connectSource) {
            setConnectSource(node)
          } else if (node.id !== connectSource.id) {
            // Show dialog to pick relation type
            setShowConnectDialog({ source: connectSource, target: node })
          }
          return
        }
        setSelectedEntity({
          id: node.id,
          name: node.label,
          entity_type: node.type,
        } as Entity)
        setSelectedEdge(null)
        return
      }
    }

    // Check if clicked on an edge
    for (const edge of filteredGraph.edges) {
      const sourceNode = positionedNodes.find(n => n.id === edge.source)
      const targetNode = positionedNodes.find(n => n.id === edge.target)
      if (!sourceNode || !targetNode) continue

      const dist = pointToLineDistance(x, y, sourceNode.x!, sourceNode.y!, targetNode.x!, targetNode.y!)
      if (dist < 10) {
        setSelectedEdge(edge)
        setShowEvidencePanel(true)
        return
      }
    }

    // Clicked on empty space
    if (connectMode) {
      setConnectSource(null)
    }
    setSelectedEntity(null)
    setSelectedEdge(null)
  }, [positionedNodes, filteredGraph.edges, zoom, pan, connectMode, connectSource])

  // Helper function for point-to-line distance
  function pointToLineDistance(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
    const A = px - x1
    const B = py - y1
    const C = x2 - x1
    const D = y2 - y1
    const dot = A * C + B * D
    const lenSq = C * C + D * D
    let param = -1
    if (lenSq !== 0) param = dot / lenSq
    let xx, yy
    if (param < 0) { xx = x1; yy = y1 }
    else if (param > 1) { xx = x2; yy = y2 }
    else { xx = x1 + param * C; yy = y1 + param * D }
    return Math.sqrt((px - xx) ** 2 + (py - yy) ** 2)
  }

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }))
  }

  const toggleEntityType = (type: string) => {
    setFilters(prev => ({
      ...prev,
      entityTypes: prev.entityTypes.includes(type)
        ? prev.entityTypes.filter(t => t !== type)
        : [...prev.entityTypes, type]
    }))
  }

  const toggleRelationType = (type: string) => {
    setFilters(prev => ({
      ...prev,
      relationTypes: prev.relationTypes.includes(type)
        ? prev.relationTypes.filter(t => t !== type)
        : [...prev.relationTypes, type]
    }))
  }

  const toggleContext = (context: string) => {
    setFilters(prev => ({
      ...prev,
      contexts: prev.contexts.includes(context)
        ? prev.contexts.filter(c => c !== context)
        : [...prev.contexts, context]
    }))
  }

  const getConfidenceBadge = (confidence: number) => {
    const level = CONFIDENCE_LEVELS.find(l => confidence >= l.min)
    return (
      <span
        className="px-2 py-0.5 rounded text-xs font-medium"
        style={{ backgroundColor: level?.color + '20', color: level?.color }}
      >
        {(confidence * 100).toFixed(0)}%
      </span>
    )
  }

  return (
    <div className="h-full flex flex-col bg-[var(--color-bg)]">
      {/* Header */}
      <div className="p-4 border-b border-[var(--color-border)] bg-[var(--color-bg-elevated)]">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-xl font-bold text-[var(--color-text)]">Knowledge Graph Explorer</h1>
            <p className="text-[var(--color-text-muted)] text-sm">
              Interactive visualization with evidence drill-down
            </p>
          </div>
          <div className="flex items-center space-x-4">
            {stats && (
              <div className="flex space-x-4 text-sm mr-4">
                <div className="flex items-center space-x-1">
                  <div className="w-2 h-2 bg-white/15 rounded-full"></div>
                  <span className="text-[var(--color-text-muted)]">Entities:</span>
                  <span className="text-[var(--color-text)] font-medium">{stats.total_entities?.toLocaleString() || filteredGraph.nodes.length}</span>
                </div>
                <div className="flex items-center space-x-1">
                  <div className="w-2 h-2 bg-white/15 rounded-full"></div>
                  <span className="text-[var(--color-text-muted)]">Relations:</span>
                  <span className="text-[var(--color-text)] font-medium">{stats.total_relations?.toLocaleString() || filteredGraph.edges.length}</span>
                </div>
              </div>
            )}
            <button
              onClick={() => {
                setConnectMode(!connectMode)
                setConnectSource(null)
                setShowConnectDialog(null)
              }}
              className={`p-2 rounded-lg transition-colors flex items-center gap-1.5 text-sm ${connectMode ? 'bg-white/15 text-white' : 'bg-[var(--glass-bg)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}
              title="Connect two nodes"
            >
              <FiLink className="w-5 h-5" />
              {connectMode && <span className="text-xs font-medium">{connectSource ? 'Select target' : 'Select source'}</span>}
            </button>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`p-2 rounded-lg transition-colors ${showFilters ? 'bg-white/15 text-[var(--color-text)]' : 'bg-[var(--glass-bg)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}
            >
              <FiFilter className="w-5 h-5" />
            </button>
            <button className="p-2 bg-[var(--glass-bg)] rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
              <FiDownload className="w-5 h-5" />
            </button>
            <button className="p-2 bg-[var(--glass-bg)] rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
              <FiShare2 className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative max-w-xl">
          <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] w-4 h-4" />
          <input
            type="text"
            className="w-full bg-[var(--glass-bg)] border border-[var(--color-border)] rounded-lg py-2 pl-10 pr-4 text-[var(--color-text)] text-sm placeholder-secondary-500 focus:outline-none focus:border-[var(--color-border-strong)]"
            placeholder="Search genes, proteins, diseases, drugs, pathways..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              <FiX className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Search Results Dropdown */}
        {searchQuery.length >= 2 && searchResults && searchResults.length > 0 && (
          <div className="absolute z-20 mt-1 w-full max-w-xl bg-[var(--glass-bg)] border border-[var(--color-border)] rounded-lg shadow-xl max-h-72 overflow-auto">
            {searchResults.map((entity) => (
              <button
                key={entity.id}
                className="w-full px-4 py-2.5 text-left hover:bg-[var(--glass-bg-hover)] transition-colors flex items-center justify-between"
                onClick={() => {
                  setSelectedEntity(entity)
                  setSearchQuery('')
                }}
              >
                <div className="flex items-center space-x-3">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-[var(--color-text)] text-xs font-bold"
                    style={{ backgroundColor: ENTITY_COLORS[entity.entity_type as keyof typeof ENTITY_COLORS]?.bg || '#64748b' }}
                  >
                    {entity.name.slice(0, 2)}
                  </div>
                  <div>
                    <p className="text-[var(--color-text)] font-medium text-sm">{entity.name}</p>
                    <p className="text-[var(--color-text-muted)] text-xs capitalize">{entity.entity_type}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Filters Panel */}
        {showFilters && (
          <div className="w-64 border-r border-[var(--color-border)] bg-[var(--color-bg-elevated)] overflow-y-auto">
            <div className="p-3">
              <h3 className="text-sm font-semibold text-[var(--color-text)] mb-3 flex items-center">
                <FiLayers className="w-4 h-4 mr-2" />
                Filters & Layers
              </h3>

              {/* Entity Types */}
              <div className="mb-4">
                <button
                  onClick={() => toggleSection('entityTypes')}
                  className="w-full flex items-center justify-between text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text)] py-1"
                >
                  <span>Entity Types</span>
                  {expandedSections.entityTypes ? <FiChevronDown className="w-4 h-4" /> : <FiChevronRight className="w-4 h-4" />}
                </button>
                {expandedSections.entityTypes && (
                  <div className="mt-2 space-y-1">
                    {Object.entries(ENTITY_COLORS).map(([type, config]) => (
                      <label key={type} className="flex items-center space-x-2 py-1 cursor-pointer group">
                        <input
                          type="checkbox"
                          checked={filters.entityTypes.includes(type)}
                          onChange={() => toggleEntityType(type)}
                          className="rounded border-[var(--color-border-strong)] text-[var(--color-text)] focus:ring-blue-500"
                        />
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: config.bg }}
                        />
                        <span className="text-sm text-[var(--color-text-secondary)] group-hover:text-[var(--color-text)] capitalize">
                          {config.text}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* Relation Types */}
              <div className="mb-4">
                <button
                  onClick={() => toggleSection('relationTypes')}
                  className="w-full flex items-center justify-between text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text)] py-1"
                >
                  <span>Relation Types</span>
                  {expandedSections.relationTypes ? <FiChevronDown className="w-4 h-4" /> : <FiChevronRight className="w-4 h-4" />}
                </button>
                {expandedSections.relationTypes && (
                  <div className="mt-2 space-y-1">
                    {Object.entries(RELATION_TYPES).map(([type, config]) => (
                      <label key={type} className="flex items-center space-x-2 py-1 cursor-pointer group">
                        <input
                          type="checkbox"
                          checked={filters.relationTypes.includes(type)}
                          onChange={() => toggleRelationType(type)}
                          className="rounded border-[var(--color-border-strong)] text-[var(--color-text)] focus:ring-blue-500"
                        />
                        <div
                          className="w-3 h-0.5 rounded"
                          style={{ backgroundColor: config.color }}
                        />
                        <span className="text-sm text-[var(--color-text-secondary)] group-hover:text-[var(--color-text)]">
                          {config.label}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* Context Toggles */}
              <div className="mb-4">
                <button
                  onClick={() => toggleSection('contexts')}
                  className="w-full flex items-center justify-between text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text)] py-1"
                >
                  <span>Context Categories</span>
                  {expandedSections.contexts ? <FiChevronDown className="w-4 h-4" /> : <FiChevronRight className="w-4 h-4" />}
                </button>
                {expandedSections.contexts && (
                  <div className="mt-2 space-y-1">
                    {CONTEXT_CATEGORIES.map((ctx) => (
                      <label key={ctx.id} className="flex items-center space-x-2 py-1 cursor-pointer group">
                        <input
                          type="checkbox"
                          checked={filters.contexts.includes(ctx.id)}
                          onChange={() => toggleContext(ctx.id)}
                          className="rounded border-[var(--color-border-strong)] text-[var(--color-text)] focus:ring-blue-500"
                        />
                        <div
                          className="w-3 h-3 rounded"
                          style={{ backgroundColor: ctx.color }}
                        />
                        <span className="text-sm text-[var(--color-text-secondary)] group-hover:text-[var(--color-text)]">
                          {ctx.label}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* Confidence Threshold */}
              <div className="mb-4">
                <button
                  onClick={() => toggleSection('confidence')}
                  className="w-full flex items-center justify-between text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text)] py-1"
                >
                  <span>Confidence Threshold</span>
                  {expandedSections.confidence ? <FiChevronDown className="w-4 h-4" /> : <FiChevronRight className="w-4 h-4" />}
                </button>
                {expandedSections.confidence && (
                  <div className="mt-2">
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={filters.minConfidence * 100}
                      onChange={(e) => setFilters(prev => ({ ...prev, minConfidence: parseInt(e.target.value) / 100 }))}
                      className="w-full h-2 bg-secondary-700 rounded-lg appearance-none cursor-pointer"
                    />
                    <div className="flex justify-between text-xs text-[var(--color-text-muted)] mt-1">
                      <span>0%</span>
                      <span className="text-[var(--color-text)]">{(filters.minConfidence * 100).toFixed(0)}%</span>
                      <span>100%</span>
                    </div>
                    <div className="mt-2 space-y-1">
                      {CONFIDENCE_LEVELS.map((level) => (
                        <div key={level.id} className="flex items-center space-x-2 text-xs">
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: level.color }} />
                          <span className="text-[var(--color-text-muted)]">{level.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Graph Canvas */}
        <div className="flex-1 relative" ref={containerRef}>
          <canvas
            ref={canvasRef}
            className="w-full h-full cursor-grab active:cursor-grabbing"
            onClick={handleCanvasClick}
            style={{ width: '100%', height: '100%' }}
          />

          {/* Zoom Controls */}
          <div className="absolute bottom-4 right-4 flex flex-col space-y-2">
            <button
              onClick={() => setZoom(z => Math.min(2, z + 0.1))}
              className="p-2 bg-[var(--glass-bg)] rounded-lg hover:bg-[var(--glass-bg-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
            >
              <FiZoomIn className="w-5 h-5" />
            </button>
            <button
              onClick={() => setZoom(z => Math.max(0.5, z - 0.1))}
              className="p-2 bg-[var(--glass-bg)] rounded-lg hover:bg-[var(--glass-bg-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
            >
              <FiZoomOut className="w-5 h-5" />
            </button>
            <button
              onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }}
              className="p-2 bg-[var(--glass-bg)] rounded-lg hover:bg-[var(--glass-bg-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
            >
              <FiMaximize className="w-5 h-5" />
            </button>
          </div>

          {/* Legend */}
          <div className="absolute top-4 left-4 bg-[var(--color-bg-elevated)] backdrop-blur-sm rounded-lg p-3 max-w-xs">
            <h4 className="text-xs font-semibold text-[var(--color-text-secondary)] mb-2">Legend</h4>
            <div className="grid grid-cols-2 gap-1">
              {Object.entries(ENTITY_COLORS).slice(0, 6).map(([type, config]) => (
                <div key={type} className="flex items-center space-x-1.5">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: config.bg }} />
                  <span className="text-xs text-[var(--color-text-muted)]">{config.text}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Stats */}
          <div className="absolute top-4 right-4 bg-[var(--color-bg-elevated)] backdrop-blur-sm rounded-lg px-3 py-2">
            <div className="flex items-center space-x-4 text-xs">
              <span className="text-[var(--color-text-muted)]">
                Showing: <span className="text-[var(--color-text)] font-medium">{filteredGraph.nodes.length}</span> nodes
              </span>
              <span className="text-[var(--color-text-muted)]">
                <span className="text-[var(--color-text)] font-medium">{filteredGraph.edges.length}</span> edges
              </span>
            </div>
          </div>
        </div>

        {/* Entity/Edge Details Panel */}
        {(selectedEntity || selectedEdge) && (
          <div className="w-80 border-l border-[var(--color-border)] bg-[var(--color-bg-elevated)] overflow-y-auto">
            <div className="p-4">
              {selectedEntity && !selectedEdge && (
                <>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-[var(--color-text)]">Entity Details</h2>
                    <button
                      onClick={() => setSelectedEntity(null)}
                      className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                    >
                      <FiX className="w-5 h-5" />
                    </button>
                  </div>

                  <div className="flex items-center space-x-3 mb-4">
                    <div
                      className="w-12 h-12 rounded-full flex items-center justify-center text-[var(--color-text)] text-lg font-bold"
                      style={{ backgroundColor: ENTITY_COLORS[selectedEntity.entity_type as keyof typeof ENTITY_COLORS]?.bg || '#64748b' }}
                    >
                      {selectedEntity.name.slice(0, 2)}
                    </div>
                    <div>
                      <h3 className="text-[var(--color-text)] font-semibold">{selectedEntity.name}</h3>
                      <p className="text-[var(--color-text-muted)] text-sm capitalize">{selectedEntity.entity_type}</p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {selectedEntity.description && (
                      <div>
                        <label className="text-[var(--color-text-muted)] text-xs font-medium">Description</label>
                        <p className="text-[var(--color-text-secondary)] text-sm mt-1">{selectedEntity.description}</p>
                      </div>
                    )}

                    {selectedEntity.properties?.confidence !== undefined && (
                      <div>
                        <label className="text-[var(--color-text-muted)] text-xs font-medium">Confidence</label>
                        <div className="mt-1">
                          {getConfidenceBadge(Number(selectedEntity.properties.confidence))}
                        </div>
                      </div>
                    )}

                    {selectedEntity.aliases && selectedEntity.aliases.length > 0 && (
                      <div>
                        <label className="text-[var(--color-text-muted)] text-xs font-medium">Aliases</label>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {selectedEntity.aliases.map((alias, i) => (
                            <span key={i} className="px-2 py-0.5 bg-[var(--glass-bg)] rounded text-xs text-[var(--color-text-secondary)]">
                              {alias}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    <div>
                      <label className="text-[var(--color-text-muted)] text-xs font-medium">External Links</label>
                      <div className="flex flex-wrap gap-2 mt-1">
                        <a href="#" className="flex items-center space-x-1 text-xs text-[var(--color-text)] hover:text-white">
                          <FiExternalLink className="w-3 h-3" />
                          <span>PubMed</span>
                        </a>
                        <a href="#" className="flex items-center space-x-1 text-xs text-[var(--color-text)] hover:text-white">
                          <FiExternalLink className="w-3 h-3" />
                          <span>UniProt</span>
                        </a>
                        <a href="#" className="flex items-center space-x-1 text-xs text-[var(--color-text)] hover:text-white">
                          <FiExternalLink className="w-3 h-3" />
                          <span>DrugBank</span>
                        </a>
                      </div>
                    </div>

                    {neighborhood && neighborhood.relations && neighborhood.relations.length > 0 && (
                      <div>
                        <label className="text-[var(--color-text-muted)] text-xs font-medium mb-2 block">
                          Relationships ({neighborhood.relations.length})
                        </label>
                        <div className="space-y-2 max-h-48 overflow-auto">
                          {neighborhood.relations.slice(0, 10).map((rel, i) => (
                            <div key={i} className="p-2 bg-[var(--glass-bg)] rounded text-xs">
                              <div className="flex items-center justify-between">
                                <span className="text-[var(--color-text)]">{rel.source_name}</span>
                                <span className="text-[var(--color-text-muted)] mx-1">→</span>
                                <span className="text-[var(--color-text)]">{rel.target_name}</span>
                              </div>
                              <div className="flex items-center justify-between mt-1">
                                <span className="text-[var(--color-text-muted)]">{rel.relation_type}</span>
                                {getConfidenceBadge(rel.confidence || 0.7)}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}

              {selectedEdge && (
                <>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-[var(--color-text)]">Relationship Evidence</h2>
                    <button
                      onClick={() => { setSelectedEdge(null); setShowEvidencePanel(false) }}
                      className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                    >
                      <FiX className="w-5 h-5" />
                    </button>
                  </div>

                  <div className="bg-[var(--glass-bg)] rounded-lg p-3 mb-4">
                    <div className="flex items-center justify-center space-x-2 text-sm">
                      <span className="text-[var(--color-text)] font-medium">
                        {positionedNodes.find(n => n.id === selectedEdge.source)?.label}
                      </span>
                      <div className="flex items-center space-x-1">
                        <div
                          className="w-8 h-0.5 rounded"
                          style={{ backgroundColor: RELATION_TYPES[selectedEdge.relation as keyof typeof RELATION_TYPES]?.color }}
                        />
                        <span className="text-[var(--color-text-muted)] text-xs">
                          {RELATION_TYPES[selectedEdge.relation as keyof typeof RELATION_TYPES]?.label}
                        </span>
                        <div
                          className="w-8 h-0.5 rounded"
                          style={{ backgroundColor: RELATION_TYPES[selectedEdge.relation as keyof typeof RELATION_TYPES]?.color }}
                        />
                      </div>
                      <span className="text-[var(--color-text)] font-medium">
                        {positionedNodes.find(n => n.id === selectedEdge.target)?.label}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="bg-[var(--glass-bg)] rounded p-2 text-center">
                      <p className="text-[var(--color-text-muted)] text-xs">Confidence</p>
                      <p className="text-[var(--color-text)] font-semibold">{(selectedEdge.confidence * 100).toFixed(0)}%</p>
                    </div>
                    <div className="bg-[var(--glass-bg)] rounded p-2 text-center">
                      <p className="text-[var(--color-text-muted)] text-xs">Evidence</p>
                      <p className="text-[var(--color-text)] font-semibold">{selectedEdge.evidenceCount}</p>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-[var(--color-text-muted)] text-xs font-medium">Supporting Evidence</label>
                      <FiBook className="w-4 h-4 text-[var(--color-text-muted)]" />
                    </div>
                    <div className="space-y-2">
                      {selectedEdge.evidence && selectedEdge.evidence.length > 0 ? (
                        selectedEdge.evidence.map((ev, i) => (
                          <div key={i} className="bg-[var(--glass-bg)] rounded-lg p-3">
                            <p className="text-[var(--color-text-secondary)] text-sm mb-2">"{ev.text}"</p>
                            <div className="flex items-center justify-between">
                              <span className="text-[var(--color-text)] text-xs">{ev.source}</span>
                              {getConfidenceBadge(ev.confidence)}
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="bg-[var(--glass-bg)] rounded-lg p-3 text-center">
                          <FiInfo className="w-5 h-5 text-[var(--color-text-muted)] mx-auto mb-1" />
                          <p className="text-[var(--color-text-muted)] text-xs">Evidence details not loaded</p>
                          <button className="text-[var(--color-text)] text-xs mt-1 hover:underline">
                            Load evidence
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mt-4">
                    <label className="text-[var(--color-text-muted)] text-xs font-medium mb-2 block">Confidence Breakdown</label>
                    <div className="text-center text-[var(--color-text-muted)] text-xs py-4">
                      No confidence breakdown available
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Connect Nodes Dialog */}
      {showConnectDialog && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => { setShowConnectDialog(null); setConnectSource(null) }}>
          <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-xl w-full max-w-sm mx-4 p-0 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-[var(--color-border)]">
              <h2 className="text-sm font-semibold text-[var(--color-text)]">Connect Nodes</h2>
              <button onClick={() => { setShowConnectDialog(null); setConnectSource(null) }} className="p-1 rounded hover:bg-white/5 text-[var(--color-text-muted)]">
                <FiX className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4">
              <div className="flex items-center justify-center gap-3 mb-4">
                <div className="px-3 py-1.5 rounded-lg text-sm font-medium" style={{ backgroundColor: ENTITY_COLORS[showConnectDialog.source.type as keyof typeof ENTITY_COLORS]?.bg + '30', color: ENTITY_COLORS[showConnectDialog.source.type as keyof typeof ENTITY_COLORS]?.bg }}>
                  {showConnectDialog.source.label}
                </div>
                <span className="text-[var(--color-text-muted)]">→</span>
                <div className="px-3 py-1.5 rounded-lg text-sm font-medium" style={{ backgroundColor: ENTITY_COLORS[showConnectDialog.target.type as keyof typeof ENTITY_COLORS]?.bg + '30', color: ENTITY_COLORS[showConnectDialog.target.type as keyof typeof ENTITY_COLORS]?.bg }}>
                  {showConnectDialog.target.label}
                </div>
              </div>
              <label className="text-xs text-[var(--color-text-muted)] font-medium block mb-2">Relation Type</label>
              <select
                value={connectRelation}
                onChange={e => setConnectRelation(e.target.value)}
                className="w-full bg-[var(--glass-bg)] border border-[var(--color-border)] rounded-lg py-2 px-3 text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-border-strong)] mb-4"
              >
                {Object.entries(RELATION_TYPES).map(([key, config]) => (
                  <option key={key} value={key}>{config.label}</option>
                ))}
              </select>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    addEdge(showConnectDialog.source, showConnectDialog.target, connectRelation)
                    setShowConnectDialog(null)
                    setConnectSource(null)
                    setConnectMode(false)
                  }}
                  className="flex-1 py-2 px-3 bg-white/15 text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity flex items-center justify-center gap-1.5"
                >
                  <FiCheck className="w-4 h-4" /> Create Connection
                </button>
                <button
                  onClick={() => { setShowConnectDialog(null); setConnectSource(null) }}
                  className="py-2 px-3 bg-[var(--glass-bg)] text-[var(--color-text-muted)] rounded-lg text-sm hover:bg-[var(--glass-bg-hover)] transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
