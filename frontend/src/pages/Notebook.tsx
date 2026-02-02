import { useState, useRef, useCallback, useEffect } from 'react'
import {
  FiMove,
  FiType,
  FiArrowRight,
  FiTrash2,
  FiZoomIn,
  FiZoomOut,
  FiMaximize2,
  FiPlus,
  FiFileText,
  FiDatabase,
  FiZap,
  FiSave
} from 'react-icons/fi'
import clsx from 'clsx'

// Types
interface Point {
  x: number
  y: number
}

interface NotebookNode {
  id: string
  type: 'text' | 'sticky' | 'shape' | 'image' | 'evidence' | 'hypothesis'
  position: Point
  size: { width: number; height: number }
  content: string
  style?: {
    color?: string
    backgroundColor?: string
    borderColor?: string
    fontSize?: number
  }
  metadata?: Record<string, unknown>
}

interface Connection {
  id: string
  from: string
  to: string
  label?: string
  style?: 'solid' | 'dashed' | 'dotted'
}

type Tool = 'select' | 'pan' | 'text' | 'sticky' | 'rectangle' | 'circle' | 'arrow' | 'evidence' | 'hypothesis'

const COLORS = [
  { name: 'Yellow', bg: 'bg-yellow-200', border: 'border-yellow-400', hex: '#fef08a' },
  { name: 'Green', bg: 'bg-green-200', border: 'border-green-400', hex: '#bbf7d0' },
  { name: 'Blue', bg: 'bg-blue-200', border: 'border-blue-400', hex: '#bfdbfe' },
  { name: 'Pink', bg: 'bg-pink-200', border: 'border-pink-400', hex: '#fbcfe8' },
  { name: 'Purple', bg: 'bg-purple-200', border: 'border-purple-400', hex: '#e9d5ff' },
  { name: 'Orange', bg: 'bg-orange-200', border: 'border-orange-400', hex: '#fed7aa' },
]

export default function Notebook() {
  const canvasRef = useRef<HTMLDivElement>(null)
  const [nodes, setNodes] = useState<NotebookNode[]>([
    {
      id: '1',
      type: 'sticky',
      position: { x: 100, y: 100 },
      size: { width: 200, height: 150 },
      content: 'Research Question:\nHow does TP53 mutation affect drug response?',
      style: { backgroundColor: '#fef08a' }
    },
    {
      id: '2',
      type: 'sticky',
      position: { x: 350, y: 100 },
      size: { width: 200, height: 150 },
      content: 'Key Finding:\nMDM2 overexpression correlates with resistance',
      style: { backgroundColor: '#bbf7d0' }
    },
    {
      id: '3',
      type: 'evidence',
      position: { x: 100, y: 300 },
      size: { width: 250, height: 100 },
      content: 'PubMed: PMID 12345678',
      metadata: { title: 'TP53 mutations in cancer therapy', citations: 234 }
    },
    {
      id: '4',
      type: 'hypothesis',
      position: { x: 400, y: 300 },
      size: { width: 250, height: 100 },
      content: 'MDM2 inhibitors may restore TP53 function',
      metadata: { confidence: 0.78, status: 'testing' }
    }
  ])
  const [connections, setConnections] = useState<Connection[]>([
    { id: 'c1', from: '1', to: '2', style: 'solid' },
    { id: 'c2', from: '2', to: '4', style: 'dashed' },
    { id: 'c3', from: '3', to: '4', label: 'supports', style: 'solid' }
  ])
  const [selectedTool, setSelectedTool] = useState<Tool>('select')
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState<Point>({ x: 0, y: 0 })
  const [dragNode, setDragNode] = useState<{ id: string; offset: Point } | null>(null)
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null)
  const [stickyColor, setStickyColor] = useState(COLORS[0])

  // Generate unique ID
  const generateId = () => `node-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

  // Handle canvas click to create new nodes
  const handleCanvasClick = useCallback((e: React.MouseEvent) => {
    if (dragNode || isPanning) return

    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return

    const x = (e.clientX - rect.left - pan.x) / zoom
    const y = (e.clientY - rect.top - pan.y) / zoom

    if (selectedTool === 'select') {
      setSelectedNode(null)
      return
    }

    if (selectedTool === 'text') {
      const newNode: NotebookNode = {
        id: generateId(),
        type: 'text',
        position: { x, y },
        size: { width: 200, height: 40 },
        content: 'Click to edit...',
        style: { fontSize: 14 }
      }
      setNodes(prev => [...prev, newNode])
      setSelectedNode(newNode.id)
    } else if (selectedTool === 'sticky') {
      const newNode: NotebookNode = {
        id: generateId(),
        type: 'sticky',
        position: { x, y },
        size: { width: 200, height: 150 },
        content: '',
        style: { backgroundColor: stickyColor.hex }
      }
      setNodes(prev => [...prev, newNode])
      setSelectedNode(newNode.id)
    } else if (selectedTool === 'evidence') {
      const newNode: NotebookNode = {
        id: generateId(),
        type: 'evidence',
        position: { x, y },
        size: { width: 250, height: 100 },
        content: 'New Evidence',
        metadata: { source: '', citations: 0 }
      }
      setNodes(prev => [...prev, newNode])
      setSelectedNode(newNode.id)
    } else if (selectedTool === 'hypothesis') {
      const newNode: NotebookNode = {
        id: generateId(),
        type: 'hypothesis',
        position: { x, y },
        size: { width: 250, height: 100 },
        content: 'New Hypothesis',
        metadata: { confidence: 0, status: 'draft' }
      }
      setNodes(prev => [...prev, newNode])
      setSelectedNode(newNode.id)
    }
  }, [selectedTool, pan, zoom, dragNode, isPanning, stickyColor])

  // Handle node drag
  const handleNodeMouseDown = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation()
    if (selectedTool === 'arrow') {
      setConnectingFrom(nodeId)
      return
    }
    const node = nodes.find(n => n.id === nodeId)
    if (!node) return
    setSelectedNode(nodeId)
    setDragNode({
      id: nodeId,
      offset: {
        x: e.clientX / zoom - node.position.x,
        y: e.clientY / zoom - node.position.y
      }
    })
  }, [nodes, selectedTool, zoom])

  const handleNodeMouseUp = useCallback((_e: React.MouseEvent, nodeId: string) => {
    if (connectingFrom && connectingFrom !== nodeId) {
      const newConnection: Connection = {
        id: `conn-${Date.now()}`,
        from: connectingFrom,
        to: nodeId,
        style: 'solid'
      }
      setConnections(prev => [...prev, newConnection])
    }
    setConnectingFrom(null)
  }, [connectingFrom])

  // Handle mouse move for dragging and panning
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (dragNode) {
        setNodes(prev => prev.map(node => {
          if (node.id === dragNode.id) {
            return {
              ...node,
              position: {
                x: e.clientX / zoom - dragNode.offset.x,
                y: e.clientY / zoom - dragNode.offset.y
              }
            }
          }
          return node
        }))
      }
      if (isPanning) {
        setPan({
          x: e.clientX - panStart.x,
          y: e.clientY - panStart.y
        })
      }
    }

    const handleMouseUp = () => {
      setDragNode(null)
      setIsPanning(false)
      setConnectingFrom(null)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [dragNode, isPanning, panStart, zoom])

  // Handle pan start
  const handlePanStart = useCallback((e: React.MouseEvent) => {
    if (selectedTool === 'pan' || e.button === 1 || (e.button === 0 && e.altKey)) {
      setIsPanning(true)
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y })
    }
  }, [selectedTool, pan])

  // Handle zoom with wheel
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        const delta = e.deltaY > 0 ? 0.9 : 1.1
        setZoom(prev => Math.min(Math.max(prev * delta, 0.25), 3))
      }
    }
    const canvas = canvasRef.current
    canvas?.addEventListener('wheel', handleWheel, { passive: false })
    return () => canvas?.removeEventListener('wheel', handleWheel)
  }, [])

  // Delete selected node
  const deleteSelected = useCallback(() => {
    if (selectedNode) {
      setNodes(prev => prev.filter(n => n.id !== selectedNode))
      setConnections(prev => prev.filter(c => c.from !== selectedNode && c.to !== selectedNode))
      setSelectedNode(null)
    }
  }, [selectedNode])

  // Update node content
  const updateNodeContent = useCallback((nodeId: string, content: string) => {
    setNodes(prev => prev.map(node =>
      node.id === nodeId ? { ...node, content } : node
    ))
  }, [])

  // Render connection lines
  const renderConnections = () => {
    return connections.map(conn => {
      const fromNode = nodes.find(n => n.id === conn.from)
      const toNode = nodes.find(n => n.id === conn.to)
      if (!fromNode || !toNode) return null

      const fromCenter = {
        x: fromNode.position.x + fromNode.size.width / 2,
        y: fromNode.position.y + fromNode.size.height / 2
      }
      const toCenter = {
        x: toNode.position.x + toNode.size.width / 2,
        y: toNode.position.y + toNode.size.height / 2
      }

      const strokeDasharray = conn.style === 'dashed' ? '8,4' : conn.style === 'dotted' ? '2,2' : undefined

      return (
        <g key={conn.id}>
          <line
            x1={fromCenter.x}
            y1={fromCenter.y}
            x2={toCenter.x}
            y2={toCenter.y}
            stroke="var(--color-border-strong)"
            strokeWidth={2}
            strokeDasharray={strokeDasharray}
            markerEnd="url(#arrowhead)"
          />
          {conn.label && (
            <text
              x={(fromCenter.x + toCenter.x) / 2}
              y={(fromCenter.y + toCenter.y) / 2 - 8}
              textAnchor="middle"
              className="text-xs fill-[var(--color-text-muted)]"
            >
              {conn.label}
            </text>
          )}
        </g>
      )
    })
  }

  // Render node based on type
  const renderNode = (node: NotebookNode) => {
    const isSelected = selectedNode === node.id
    const baseClasses = clsx(
      'absolute cursor-move transition-shadow',
      isSelected && 'ring-2 ring-primary-500 ring-offset-2 ring-offset-[var(--color-bg-elevated)]'
    )

    switch (node.type) {
      case 'sticky':
        return (
          <div
            key={node.id}
            className={clsx(baseClasses, 'rounded-lg shadow-lg p-3')}
            style={{
              left: node.position.x,
              top: node.position.y,
              width: node.size.width,
              minHeight: node.size.height,
              backgroundColor: node.style?.backgroundColor || '#fef08a'
            }}
            onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
            onMouseUp={(e) => handleNodeMouseUp(e, node.id)}
          >
            <textarea
              className="w-full h-full bg-transparent resize-none outline-none text-sm text-gray-800 placeholder-gray-500"
              value={node.content}
              onChange={(e) => updateNodeContent(node.id, e.target.value)}
              placeholder="Type here..."
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )

      case 'text':
        return (
          <div
            key={node.id}
            className={clsx(baseClasses, 'bg-transparent')}
            style={{
              left: node.position.x,
              top: node.position.y,
              minWidth: node.size.width
            }}
            onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
            onMouseUp={(e) => handleNodeMouseUp(e, node.id)}
          >
            <input
              type="text"
              className="w-full bg-transparent outline-none text-[var(--color-text)] border-b border-transparent focus:border-primary-500"
              style={{ fontSize: node.style?.fontSize || 14 }}
              value={node.content}
              onChange={(e) => updateNodeContent(node.id, e.target.value)}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )

      case 'evidence':
        return (
          <div
            key={node.id}
            className={clsx(
              baseClasses,
              'rounded-lg border-2 border-primary-500 bg-primary-500/10 p-3'
            )}
            style={{
              left: node.position.x,
              top: node.position.y,
              width: node.size.width,
              minHeight: node.size.height
            }}
            onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
            onMouseUp={(e) => handleNodeMouseUp(e, node.id)}
          >
            <div className="flex items-center gap-2 mb-2">
              <FiDatabase className="w-4 h-4 text-primary-400" />
              <span className="text-xs font-semibold text-primary-400">Evidence</span>
            </div>
            <input
              type="text"
              className="w-full bg-transparent outline-none text-sm text-[var(--color-text)] mb-1"
              value={node.content}
              onChange={(e) => updateNodeContent(node.id, e.target.value)}
              onClick={(e) => e.stopPropagation()}
            />
            {node.metadata?.title && (
              <div className="text-xs text-[var(--color-text-muted)]">
                {String(node.metadata.title)}
              </div>
            )}
          </div>
        )

      case 'hypothesis':
        return (
          <div
            key={node.id}
            className={clsx(
              baseClasses,
              'rounded-lg border-2 border-warning-500 bg-warning-500/10 p-3'
            )}
            style={{
              left: node.position.x,
              top: node.position.y,
              width: node.size.width,
              minHeight: node.size.height
            }}
            onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
            onMouseUp={(e) => handleNodeMouseUp(e, node.id)}
          >
            <div className="flex items-center gap-2 mb-2">
              <FiZap className="w-4 h-4 text-warning-400" />
              <span className="text-xs font-semibold text-warning-400">Hypothesis</span>
              {node.metadata?.status && (
                <span className="text-xxs px-1.5 py-0.5 rounded bg-warning-500/20 text-warning-300">
                  {node.metadata.status as string}
                </span>
              )}
            </div>
            <input
              type="text"
              className="w-full bg-transparent outline-none text-sm text-[var(--color-text)]"
              value={node.content}
              onChange={(e) => updateNodeContent(node.id, e.target.value)}
              onClick={(e) => e.stopPropagation()}
            />
            {node.metadata?.confidence !== undefined && (
              <div className="mt-2 flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-[var(--color-border)] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-warning-500 rounded-full"
                    style={{ width: `${(node.metadata.confidence as number) * 100}%` }}
                  />
                </div>
                <span className="text-xxs text-[var(--color-text-muted)]">
                  {Math.round((node.metadata.confidence as number) * 100)}%
                </span>
              </div>
            )}
          </div>
        )

      default:
        return null
    }
  }

  const tools: { tool: Tool; icon: typeof FiMove; label: string }[] = [
    { tool: 'select', icon: FiMove, label: 'Select' },
    { tool: 'pan', icon: FiMaximize2, label: 'Pan' },
    { tool: 'text', icon: FiType, label: 'Text' },
    { tool: 'sticky', icon: FiFileText, label: 'Sticky Note' },
    { tool: 'arrow', icon: FiArrowRight, label: 'Connect' },
    { tool: 'evidence', icon: FiDatabase, label: 'Evidence' },
    { tool: 'hypothesis', icon: FiZap, label: 'Hypothesis' },
  ]

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-bg-elevated)]">
        <div className="flex items-center gap-1">
          {tools.map(({ tool, icon: Icon, label }) => (
            <button
              key={tool}
              onClick={() => setSelectedTool(tool)}
              className={clsx(
                'p-2 rounded hover:bg-[var(--color-border)] transition-colors',
                selectedTool === tool && 'bg-primary-500/20 text-primary-400'
              )}
              title={label}
            >
              <Icon className="w-4 h-4" />
            </button>
          ))}

          <div className="w-px h-6 bg-[var(--color-border)] mx-2" />

          {/* Color picker for sticky notes */}
          {selectedTool === 'sticky' && (
            <div className="flex items-center gap-1">
              {COLORS.map(color => (
                <button
                  key={color.name}
                  onClick={() => setStickyColor(color)}
                  className={clsx(
                    'w-5 h-5 rounded border-2',
                    color.bg,
                    stickyColor.name === color.name ? 'border-gray-800' : 'border-transparent'
                  )}
                  title={color.name}
                />
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setZoom(prev => Math.max(prev * 0.9, 0.25))}
            className="p-2 rounded hover:bg-[var(--color-border)]"
            title="Zoom Out"
          >
            <FiZoomOut className="w-4 h-4" />
          </button>
          <span className="text-xs text-[var(--color-text-muted)] w-12 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom(prev => Math.min(prev * 1.1, 3))}
            className="p-2 rounded hover:bg-[var(--color-border)]"
            title="Zoom In"
          >
            <FiZoomIn className="w-4 h-4" />
          </button>

          <div className="w-px h-6 bg-[var(--color-border)] mx-2" />

          {selectedNode && (
            <button
              onClick={deleteSelected}
              className="p-2 rounded hover:bg-error-500/20 text-error-400"
              title="Delete"
            >
              <FiTrash2 className="w-4 h-4" />
            </button>
          )}

          <button
            className="btn btn-sm bg-primary-500/20 text-primary-400"
            title="Save"
          >
            <FiSave className="w-3.5 h-3.5" />
            Save
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={canvasRef}
        className={clsx(
          'flex-1 overflow-hidden relative',
          selectedTool === 'pan' && 'cursor-grab',
          isPanning && 'cursor-grabbing'
        )}
        style={{
          backgroundImage: `
            radial-gradient(circle, var(--color-border) 1px, transparent 1px)
          `,
          backgroundSize: `${20 * zoom}px ${20 * zoom}px`,
          backgroundPosition: `${pan.x}px ${pan.y}px`
        }}
        onClick={handleCanvasClick}
        onMouseDown={handlePanStart}
      >
        {/* SVG layer for connections */}
        <svg
          className="absolute inset-0 pointer-events-none"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: '0 0'
          }}
        >
          <defs>
            <marker
              id="arrowhead"
              markerWidth="10"
              markerHeight="7"
              refX="9"
              refY="3.5"
              orient="auto"
            >
              <polygon
                points="0 0, 10 3.5, 0 7"
                fill="var(--color-border-strong)"
              />
            </marker>
          </defs>
          {renderConnections()}
        </svg>

        {/* Nodes layer */}
        <div
          className="absolute inset-0"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: '0 0'
          }}
        >
          {nodes.map(renderNode)}
        </div>

        {/* Instructions overlay */}
        {nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center">
              <FiPlus className="w-12 h-12 text-[var(--color-border)] mx-auto mb-4" />
              <p className="text-[var(--color-text-muted)]">
                Select a tool and click on the canvas to add elements
              </p>
              <p className="text-xs text-[var(--color-text-muted)] mt-2">
                Use Ctrl/Cmd + scroll to zoom, Alt + drag to pan
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="px-4 py-1.5 border-t border-[var(--color-border)] bg-[var(--color-bg-elevated)] flex items-center justify-between text-xs text-[var(--color-text-muted)]">
        <div className="flex items-center gap-4">
          <span>{nodes.length} elements</span>
          <span>{connections.length} connections</span>
        </div>
        <div className="flex items-center gap-2">
          <span>Tip: Use arrow tool to connect elements</span>
        </div>
      </div>
    </div>
  )
}
