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
  FiSave,
  FiEdit3,
  FiCircle,
  FiMinus,
  FiRotateCcw,
  FiRotateCw,
  FiChevronLeft,
  FiChevronRight,
  FiDownload,
  FiLayers,
  FiCopy,
  FiGrid,
  FiDroplet
} from 'react-icons/fi'
import clsx from 'clsx'
import { usePersistentState, logActivity } from '../utils/persistence'

// Types
interface Point {
  x: number
  y: number
  pressure?: number
}

interface Stroke {
  id: string
  points: Point[]
  color: string
  width: number
  opacity: number
  tool: 'pen' | 'pencil' | 'highlighter' | 'eraser'
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

interface Page {
  id: string
  name: string
  nodes: NotebookNode[]
  connections: Connection[]
  strokes: Stroke[]
  tags: string[]
  createdAt: Date
  modifiedAt: Date
}

type Tool = 'select' | 'pan' | 'text' | 'sticky' | 'rectangle' | 'circle' | 'line' | 'arrow' | 'evidence' | 'hypothesis' | 'pen' | 'pencil' | 'highlighter' | 'eraser' | 'image'

const COLORS = [
  { name: 'Yellow', bg: 'bg-yellow-200', border: 'border-yellow-400', hex: '#fef08a' },
  { name: 'Green', bg: 'bg-green-200', border: 'border-green-400', hex: '#bbf7d0' },
  { name: 'Blue', bg: 'bg-blue-200', border: 'border-blue-400', hex: '#bfdbfe' },
  { name: 'Pink', bg: 'bg-pink-200', border: 'border-pink-400', hex: '#fbcfe8' },
  { name: 'Purple', bg: 'bg-purple-200', border: 'border-purple-400', hex: '#e9d5ff' },
  { name: 'Orange', bg: 'bg-orange-200', border: 'border-orange-400', hex: '#fed7aa' },
]

const STROKE_COLORS = [
  '#000000', '#374151', '#6B7280', '#EF4444', '#F97316', '#EAB308',
  '#22C55E', '#06B6D4', '#3B82F6', '#8B5CF6', '#EC4899', '#FFFFFF'
]

const STROKE_WIDTHS = [1, 2, 4, 8, 12, 16, 24]

// Page templates
const PAGE_TEMPLATES = [
  { name: 'Blank', nodes: [], strokes: [] },
  { name: 'Research Notes', nodes: [
    { type: 'text', position: { x: 50, y: 30 }, size: { width: 400, height: 40 }, content: 'Research Notes - [Topic]', style: { fontSize: 24 } },
    { type: 'sticky', position: { x: 50, y: 100 }, size: { width: 200, height: 150 }, content: 'Key Questions:', style: { backgroundColor: '#fef08a' } },
    { type: 'sticky', position: { x: 280, y: 100 }, size: { width: 200, height: 150 }, content: 'Findings:', style: { backgroundColor: '#bbf7d0' } },
    { type: 'sticky', position: { x: 510, y: 100 }, size: { width: 200, height: 150 }, content: 'Next Steps:', style: { backgroundColor: '#bfdbfe' } },
  ]},
  { name: 'Experiment Log', nodes: [
    { type: 'text', position: { x: 50, y: 30 }, size: { width: 400, height: 40 }, content: 'Experiment Log', style: { fontSize: 24 } },
    { type: 'text', position: { x: 50, y: 80 }, size: { width: 300, height: 30 }, content: 'Date: ', style: { fontSize: 14 } },
    { type: 'sticky', position: { x: 50, y: 130 }, size: { width: 300, height: 120 }, content: 'Hypothesis:', style: { backgroundColor: '#fed7aa' } },
    { type: 'sticky', position: { x: 50, y: 270 }, size: { width: 300, height: 120 }, content: 'Methods:', style: { backgroundColor: '#e9d5ff' } },
    { type: 'sticky', position: { x: 380, y: 130 }, size: { width: 300, height: 260 }, content: 'Observations:', style: { backgroundColor: '#bbf7d0' } },
  ]},
  { name: 'Literature Review', nodes: [
    { type: 'text', position: { x: 50, y: 30 }, size: { width: 400, height: 40 }, content: 'Literature Review', style: { fontSize: 24 } },
    { type: 'evidence', position: { x: 50, y: 100 }, size: { width: 280, height: 100 }, content: 'Source 1', metadata: {} },
    { type: 'evidence', position: { x: 50, y: 220 }, size: { width: 280, height: 100 }, content: 'Source 2', metadata: {} },
    { type: 'hypothesis', position: { x: 400, y: 160 }, size: { width: 280, height: 100 }, content: 'Synthesis/Insight', metadata: { confidence: 0, status: 'draft' } },
  ]},
]

export default function Notebook() {
  const canvasRef = useRef<HTMLDivElement>(null)
  const drawingCanvasRef = useRef<HTMLCanvasElement>(null)

  // Page management — persisted to localStorage
  const [pages, setPages] = usePersistentState<Page[]>('notebook-pages', [
    {
      id: 'page-1',
      name: 'Untitled Page',
      nodes: [],
      connections: [],
      strokes: [],
      tags: [],
      createdAt: new Date(),
      modifiedAt: new Date()
    }
  ])
  const [currentPageIndex, setCurrentPageIndex] = usePersistentState<number>('notebook-current-page', 0)

  // Current page data
  const currentPage = pages[currentPageIndex]
  const nodes = currentPage?.nodes || []
  const connections = currentPage?.connections || []
  const strokes = currentPage?.strokes || []

  // Tools and state
  const [selectedTool, setSelectedTool] = useState<Tool>('select')
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState<Point>({ x: 0, y: 0 })
  const [dragNode, setDragNode] = useState<{ id: string; offset: Point } | null>(null)
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null)
  const [stickyColor, setStickyColor] = useState(COLORS[0])

  // Drawing state
  const [strokeColor, setStrokeColor] = useState('#000000')
  const [strokeWidth, setStrokeWidth] = useState(4)
  const [strokeOpacity] = useState(1)
  const [isDrawing, setIsDrawing] = useState(false)
  const [currentStroke, setCurrentStroke] = useState<Point[]>([])

  // UI state
  const [showPagePanel, setShowPagePanel] = useState(true)
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)
  const [showGrid, setShowGrid] = useState(true)

  // History for undo/redo
  const [history, setHistory] = useState<Page[][]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)

  // Generate unique ID
  const generateId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

  // Save history for undo
  const saveToHistory = useCallback(() => {
    const newHistory = history.slice(0, historyIndex + 1)
    newHistory.push(JSON.parse(JSON.stringify(pages)))
    setHistory(newHistory.slice(-50)) // Keep last 50 states
    setHistoryIndex(newHistory.length - 1)
  }, [history, historyIndex, pages])

  // Undo
  const undo = useCallback(() => {
    if (historyIndex > 0) {
      setHistoryIndex(historyIndex - 1)
      setPages(JSON.parse(JSON.stringify(history[historyIndex - 1])))
    }
  }, [history, historyIndex])

  // Redo
  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex(historyIndex + 1)
      setPages(JSON.parse(JSON.stringify(history[historyIndex + 1])))
    }
  }, [history, historyIndex])

  // Update page data
  const updateCurrentPage = useCallback((updates: Partial<Page>) => {
    setPages(prev => prev.map((page, index) =>
      index === currentPageIndex
        ? { ...page, ...updates, modifiedAt: new Date() }
        : page
    ))
  }, [currentPageIndex])

  // Set nodes for current page
  const setNodes = useCallback((updater: (prev: NotebookNode[]) => NotebookNode[]) => {
    updateCurrentPage({ nodes: updater(nodes) })
  }, [nodes, updateCurrentPage])

  // Set connections for current page
  const setConnections = useCallback((updater: (prev: Connection[]) => Connection[]) => {
    updateCurrentPage({ connections: updater(connections) })
  }, [connections, updateCurrentPage])

  // Set strokes for current page
  const setStrokes = useCallback((updater: (prev: Stroke[]) => Stroke[]) => {
    updateCurrentPage({ strokes: updater(strokes) })
  }, [strokes, updateCurrentPage])

  // Add new page
  const addPage = useCallback((template?: typeof PAGE_TEMPLATES[0]) => {
    const newPage: Page = {
      id: `page-${generateId()}`,
      name: `Page ${pages.length + 1}`,
      nodes: template?.nodes?.map((n, i) => ({ ...n, id: `node-${generateId()}-${i}` } as NotebookNode)) || [],
      connections: [],
      strokes: [],
      tags: [],
      createdAt: new Date(),
      modifiedAt: new Date()
    }
    setPages(prev => [...prev, newPage])
    setCurrentPageIndex(pages.length)
    setShowTemplates(false)
  }, [pages.length])

  // Delete page
  const deletePage = useCallback((pageId: string) => {
    if (pages.length <= 1) return
    const index = pages.findIndex(p => p.id === pageId)
    setPages(prev => prev.filter(p => p.id !== pageId))
    if (currentPageIndex >= index && currentPageIndex > 0) {
      setCurrentPageIndex(currentPageIndex - 1)
    }
  }, [pages, currentPageIndex])

  // Drawing functions
  const getPointerPosition = useCallback((e: React.PointerEvent | PointerEvent): Point => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return {
      x: (e.clientX - rect.left - pan.x) / zoom,
      y: (e.clientY - rect.top - pan.y) / zoom,
      pressure: e.pressure || 0.5
    }
  }, [pan, zoom])

  const startDrawing = useCallback((e: React.PointerEvent) => {
    if (!['pen', 'pencil', 'highlighter', 'eraser'].includes(selectedTool)) return
    saveToHistory()
    setIsDrawing(true)
    const point = getPointerPosition(e)
    setCurrentStroke([point])
  }, [selectedTool, getPointerPosition, saveToHistory])

  const continueDrawing = useCallback((e: React.PointerEvent) => {
    if (!isDrawing) return
    const point = getPointerPosition(e)
    setCurrentStroke(prev => [...prev, point])
  }, [isDrawing, getPointerPosition])

  const endDrawing = useCallback(() => {
    if (!isDrawing || currentStroke.length < 2) {
      setIsDrawing(false)
      setCurrentStroke([])
      return
    }

    const newStroke: Stroke = {
      id: `stroke-${generateId()}`,
      points: currentStroke,
      color: selectedTool === 'eraser' ? 'transparent' : strokeColor,
      width: selectedTool === 'highlighter' ? strokeWidth * 3 : strokeWidth,
      opacity: selectedTool === 'highlighter' ? 0.4 : strokeOpacity,
      tool: selectedTool as Stroke['tool']
    }

    setStrokes(prev => [...prev, newStroke])
    setIsDrawing(false)
    setCurrentStroke([])
  }, [isDrawing, currentStroke, selectedTool, strokeColor, strokeWidth, strokeOpacity, setStrokes])

  // Render strokes to canvas
  useEffect(() => {
    const canvas = drawingCanvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Set canvas size
    canvas.width = canvas.offsetWidth * window.devicePixelRatio
    canvas.height = canvas.offsetHeight * window.devicePixelRatio
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio)

    // Clear canvas
    ctx.clearRect(0, 0, canvas.offsetWidth, canvas.offsetHeight)

    // Draw all strokes
    const allStrokes = [...strokes]
    if (currentStroke.length > 0) {
      allStrokes.push({
        id: 'current',
        points: currentStroke,
        color: selectedTool === 'eraser' ? '#ffffff' : strokeColor,
        width: selectedTool === 'highlighter' ? strokeWidth * 3 : strokeWidth,
        opacity: selectedTool === 'highlighter' ? 0.4 : strokeOpacity,
        tool: selectedTool as Stroke['tool']
      })
    }

    allStrokes.forEach(stroke => {
      if (stroke.points.length < 2) return

      ctx.beginPath()
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = stroke.color
      ctx.lineWidth = stroke.width
      ctx.globalAlpha = stroke.opacity

      if (stroke.tool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out'
      } else {
        ctx.globalCompositeOperation = 'source-over'
      }

      const points = stroke.points
      ctx.moveTo(points[0].x, points[0].y)

      for (let i = 1; i < points.length; i++) {
        const p0 = points[i - 1]
        const p1 = points[i]

        // Use pressure for variable width if available
        if (p1.pressure) {
          ctx.lineWidth = stroke.width * (0.5 + p1.pressure * 0.5)
        }

        // Smooth curves using quadratic bezier
        const midX = (p0.x + p1.x) / 2
        const midY = (p0.y + p1.y) / 2
        ctx.quadraticCurveTo(p0.x, p0.y, midX, midY)
      }

      ctx.stroke()
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'
    })
  }, [strokes, currentStroke, selectedTool, strokeColor, strokeWidth, strokeOpacity])

  // Handle canvas click to create new nodes
  const handleCanvasClick = useCallback((e: React.MouseEvent) => {
    if (dragNode || isPanning || isDrawing) return
    if (['pen', 'pencil', 'highlighter', 'eraser'].includes(selectedTool)) return

    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return

    const x = (e.clientX - rect.left - pan.x) / zoom
    const y = (e.clientY - rect.top - pan.y) / zoom

    if (selectedTool === 'select') {
      setSelectedNode(null)
      return
    }

    saveToHistory()

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
  }, [selectedTool, pan, zoom, dragNode, isPanning, isDrawing, stickyColor, saveToHistory, setNodes])

  // Handle node drag
  const handleNodeMouseDown = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation()
    if (selectedTool === 'arrow') {
      setConnectingFrom(nodeId)
      return
    }
    const node = nodes.find(n => n.id === nodeId)
    if (!node) return
    saveToHistory()
    setSelectedNode(nodeId)
    setDragNode({
      id: nodeId,
      offset: {
        x: e.clientX / zoom - node.position.x,
        y: e.clientY / zoom - node.position.y
      }
    })
  }, [nodes, selectedTool, zoom, saveToHistory])

  const handleNodeMouseUp = useCallback((_e: React.MouseEvent, nodeId: string) => {
    if (connectingFrom && connectingFrom !== nodeId) {
      const newConnection: Connection = {
        id: `conn-${generateId()}`,
        from: connectingFrom,
        to: nodeId,
        style: 'solid'
      }
      setConnections(prev => [...prev, newConnection])
    }
    setConnectingFrom(null)
  }, [connectingFrom, setConnections])

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
  }, [dragNode, isPanning, panStart, zoom, setNodes])

  // Handle pan start
  const handlePanStart = useCallback((e: React.MouseEvent) => {
    if (['pen', 'pencil', 'highlighter', 'eraser'].includes(selectedTool)) return
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

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault()
        if (e.shiftKey) {
          redo()
        } else {
          undo()
        }
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedNode) {
          deleteSelected()
        }
      }
      if (e.key === 'Escape') {
        setSelectedNode(null)
        setSelectedTool('select')
      }
      // Tool shortcuts
      if (e.key === 'v') setSelectedTool('select')
      if (e.key === 'h') setSelectedTool('pan')
      if (e.key === 'p') setSelectedTool('pen')
      if (e.key === 'e') setSelectedTool('eraser')
      if (e.key === 't') setSelectedTool('text')
      if (e.key === 's') setSelectedTool('sticky')
      if (e.key === 'a') setSelectedTool('arrow')
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [undo, redo, selectedNode])

  // Delete selected node
  const deleteSelected = useCallback(() => {
    if (selectedNode) {
      saveToHistory()
      setNodes(prev => prev.filter(n => n.id !== selectedNode))
      setConnections(prev => prev.filter(c => c.from !== selectedNode && c.to !== selectedNode))
      setSelectedNode(null)
    }
  }, [selectedNode, saveToHistory, setNodes, setConnections])

  // Update node content
  const updateNodeContent = useCallback((nodeId: string, content: string) => {
    setNodes(prev => prev.map(node =>
      node.id === nodeId ? { ...node, content } : node
    ))
  }, [setNodes])

  // Clear all drawings
  const clearDrawings = useCallback(() => {
    saveToHistory()
    setStrokes(() => [])
  }, [saveToHistory, setStrokes])

  // Export page as PNG
  const exportPage = useCallback(async () => {
    const canvas = drawingCanvasRef.current
    if (!canvas) return

    const link = document.createElement('a')
    link.download = `${currentPage.name || 'notebook'}-${new Date().toISOString().split('T')[0]}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
  }, [currentPage])

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
            {node.metadata?.title ? (
              <div className="text-xs text-[var(--color-text-muted)]">
                {String(node.metadata.title)}
              </div>
            ) : null}
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
              {node.metadata?.status ? (
                <span className="text-xxs px-1.5 py-0.5 rounded bg-warning-500/20 text-warning-300">
                  {String(node.metadata.status)}
                </span>
              ) : null}
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

  // Tool groups
  const selectionTools: { tool: Tool; icon: typeof FiMove; label: string; shortcut?: string }[] = [
    { tool: 'select', icon: FiMove, label: 'Select', shortcut: 'V' },
    { tool: 'pan', icon: FiMaximize2, label: 'Pan', shortcut: 'H' },
  ]

  const drawingTools: { tool: Tool; icon: typeof FiEdit3; label: string; shortcut?: string }[] = [
    { tool: 'pen', icon: FiEdit3, label: 'Pen', shortcut: 'P' },
    { tool: 'pencil', icon: FiMinus, label: 'Pencil' },
    { tool: 'highlighter', icon: FiDroplet, label: 'Highlighter' },
    { tool: 'eraser', icon: FiCircle, label: 'Eraser', shortcut: 'E' },
  ]

  const nodeTools: { tool: Tool; icon: typeof FiType; label: string; shortcut?: string }[] = [
    { tool: 'text', icon: FiType, label: 'Text', shortcut: 'T' },
    { tool: 'sticky', icon: FiFileText, label: 'Sticky Note', shortcut: 'S' },
    { tool: 'arrow', icon: FiArrowRight, label: 'Connect', shortcut: 'A' },
  ]

  const researchTools: { tool: Tool; icon: typeof FiDatabase; label: string }[] = [
    { tool: 'evidence', icon: FiDatabase, label: 'Evidence' },
    { tool: 'hypothesis', icon: FiZap, label: 'Hypothesis' },
  ]

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Top Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-bg-elevated)]">
        <div className="flex items-center gap-1">
          {/* Selection Tools */}
          {selectionTools.map(({ tool, icon: Icon, label, shortcut }) => (
            <button
              key={tool}
              onClick={() => setSelectedTool(tool)}
              className={clsx(
                'p-2 rounded hover:bg-[var(--color-border)] transition-colors',
                selectedTool === tool && 'bg-primary-500/20 text-primary-400'
              )}
              title={`${label}${shortcut ? ` (${shortcut})` : ''}`}
            >
              <Icon className="w-4 h-4" />
            </button>
          ))}

          <div className="w-px h-6 bg-[var(--color-border)] mx-1" />

          {/* Drawing Tools */}
          {drawingTools.map(({ tool, icon: Icon, label, shortcut }) => (
            <button
              key={tool}
              onClick={() => setSelectedTool(tool)}
              className={clsx(
                'p-2 rounded hover:bg-[var(--color-border)] transition-colors',
                selectedTool === tool && 'bg-primary-500/20 text-primary-400'
              )}
              title={`${label}${shortcut ? ` (${shortcut})` : ''}`}
            >
              <Icon className="w-4 h-4" />
            </button>
          ))}

          <div className="w-px h-6 bg-[var(--color-border)] mx-1" />

          {/* Node Tools */}
          {nodeTools.map(({ tool, icon: Icon, label, shortcut }) => (
            <button
              key={tool}
              onClick={() => setSelectedTool(tool)}
              className={clsx(
                'p-2 rounded hover:bg-[var(--color-border)] transition-colors',
                selectedTool === tool && 'bg-primary-500/20 text-primary-400'
              )}
              title={`${label}${shortcut ? ` (${shortcut})` : ''}`}
            >
              <Icon className="w-4 h-4" />
            </button>
          ))}

          <div className="w-px h-6 bg-[var(--color-border)] mx-1" />

          {/* Research Tools */}
          {researchTools.map(({ tool, icon: Icon, label }) => (
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

          {/* Drawing Options (when drawing tool selected) */}
          {['pen', 'pencil', 'highlighter', 'eraser'].includes(selectedTool) && (
            <div className="flex items-center gap-2">
              {/* Color picker */}
              <div className="relative">
                <button
                  onClick={() => setShowColorPicker(!showColorPicker)}
                  className="w-6 h-6 rounded border-2 border-[var(--color-border)]"
                  style={{ backgroundColor: strokeColor }}
                  title="Stroke Color"
                />
                {showColorPicker && (
                  <div className="absolute top-full left-0 mt-1 p-2 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-lg z-50">
                    <div className="grid grid-cols-6 gap-1">
                      {STROKE_COLORS.map(color => (
                        <button
                          key={color}
                          onClick={() => { setStrokeColor(color); setShowColorPicker(false) }}
                          className={clsx(
                            'w-6 h-6 rounded',
                            strokeColor === color && 'ring-2 ring-primary-500'
                          )}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Stroke width */}
              <select
                value={strokeWidth}
                onChange={(e) => setStrokeWidth(Number(e.target.value))}
                className="text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1"
              >
                {STROKE_WIDTHS.map(w => (
                  <option key={w} value={w}>{w}px</option>
                ))}
              </select>

              {/* Clear drawings */}
              <button
                onClick={clearDrawings}
                className="p-1.5 rounded hover:bg-error-500/20 text-error-400"
                title="Clear Drawings"
              >
                <FiTrash2 className="w-4 h-4" />
              </button>
            </div>
          )}

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
          {/* Undo/Redo */}
          <button
            onClick={undo}
            disabled={historyIndex <= 0}
            className="p-2 rounded hover:bg-[var(--color-border)] disabled:opacity-30"
            title="Undo (Ctrl+Z)"
          >
            <FiRotateCcw className="w-4 h-4" />
          </button>
          <button
            onClick={redo}
            disabled={historyIndex >= history.length - 1}
            className="p-2 rounded hover:bg-[var(--color-border)] disabled:opacity-30"
            title="Redo (Ctrl+Shift+Z)"
          >
            <FiRotateCw className="w-4 h-4" />
          </button>

          <div className="w-px h-6 bg-[var(--color-border)] mx-1" />

          {/* Zoom controls */}
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

          <div className="w-px h-6 bg-[var(--color-border)] mx-1" />

          {/* Grid toggle */}
          <button
            onClick={() => setShowGrid(!showGrid)}
            className={clsx(
              'p-2 rounded hover:bg-[var(--color-border)]',
              showGrid && 'bg-primary-500/20 text-primary-400'
            )}
            title="Toggle Grid"
          >
            <FiGrid className="w-4 h-4" />
          </button>

          {/* Page panel toggle */}
          <button
            onClick={() => setShowPagePanel(!showPagePanel)}
            className={clsx(
              'p-2 rounded hover:bg-[var(--color-border)]',
              showPagePanel && 'bg-primary-500/20 text-primary-400'
            )}
            title="Pages"
          >
            <FiLayers className="w-4 h-4" />
          </button>

          <div className="w-px h-6 bg-[var(--color-border)] mx-1" />

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
            onClick={exportPage}
            className="btn btn-sm bg-[var(--color-border)] hover:bg-[var(--color-border-strong)]"
            title="Export"
          >
            <FiDownload className="w-3.5 h-3.5" />
            Export
          </button>

          <button
            className="btn btn-sm bg-primary-500/20 text-primary-400"
            title="Save"
            onClick={() => logActivity({ type: 'notebook', action: 'updated', title: `Saved notebook: ${currentPage?.name || 'Untitled'}` })}
          >
            <FiSave className="w-3.5 h-3.5" />
            Saved
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Page panel */}
        {showPagePanel && (
          <div className="w-56 border-r border-[var(--color-border)] bg-[var(--color-bg-elevated)] flex flex-col">
            <div className="p-3 border-b border-[var(--color-border)]">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-medium text-[var(--color-text-muted)] uppercase">Pages</h3>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setShowTemplates(!showTemplates)}
                    className="p-1 rounded hover:bg-[var(--color-border)]"
                    title="Templates"
                  >
                    <FiCopy className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => addPage()}
                    className="p-1 rounded hover:bg-[var(--color-border)]"
                    title="New Page"
                  >
                    <FiPlus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Templates dropdown */}
            {showTemplates && (
              <div className="p-2 border-b border-[var(--color-border)] bg-[var(--color-bg)]">
                <p className="text-xxs text-[var(--color-text-muted)] mb-2">Choose a template:</p>
                <div className="space-y-1">
                  {PAGE_TEMPLATES.map(template => (
                    <button
                      key={template.name}
                      onClick={() => addPage(template)}
                      className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-[var(--color-border)] transition-colors"
                    >
                      {template.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Page list */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {pages.map((page, index) => (
                <button
                  key={page.id}
                  onClick={() => setCurrentPageIndex(index)}
                  className={clsx(
                    'w-full text-left p-2 rounded transition-colors group',
                    currentPageIndex === index
                      ? 'bg-primary-500/20 text-primary-400'
                      : 'hover:bg-[var(--color-border)]'
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium truncate">{page.name}</span>
                    {pages.length > 1 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); deletePage(page.id) }}
                        className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-error-500/20 rounded text-error-400"
                      >
                        <FiTrash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  <div className="text-xxs text-[var(--color-text-muted)] mt-0.5">
                    {page.nodes.length} elements • {page.strokes.length} strokes
                  </div>
                </button>
              ))}
            </div>

            {/* Page navigation */}
            <div className="p-2 border-t border-[var(--color-border)] flex items-center justify-between">
              <button
                onClick={() => setCurrentPageIndex(Math.max(0, currentPageIndex - 1))}
                disabled={currentPageIndex === 0}
                className="p-1.5 rounded hover:bg-[var(--color-border)] disabled:opacity-30"
              >
                <FiChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-xs text-[var(--color-text-muted)]">
                {currentPageIndex + 1} / {pages.length}
              </span>
              <button
                onClick={() => setCurrentPageIndex(Math.min(pages.length - 1, currentPageIndex + 1))}
                disabled={currentPageIndex === pages.length - 1}
                className="p-1.5 rounded hover:bg-[var(--color-border)] disabled:opacity-30"
              >
                <FiChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Canvas */}
        <div
          ref={canvasRef}
          className={clsx(
            'flex-1 overflow-hidden relative',
            selectedTool === 'pan' && 'cursor-grab',
            isPanning && 'cursor-grabbing',
            ['pen', 'pencil', 'highlighter'].includes(selectedTool) && 'cursor-crosshair',
            selectedTool === 'eraser' && 'cursor-cell'
          )}
          style={{
            backgroundImage: showGrid ? `
              radial-gradient(circle, var(--color-border) 1px, transparent 1px)
            ` : 'none',
            backgroundSize: `${20 * zoom}px ${20 * zoom}px`,
            backgroundPosition: `${pan.x}px ${pan.y}px`
          }}
          onClick={handleCanvasClick}
          onMouseDown={handlePanStart}
          onPointerDown={startDrawing}
          onPointerMove={continueDrawing}
          onPointerUp={endDrawing}
          onPointerLeave={endDrawing}
        >
          {/* Drawing canvas layer */}
          <canvas
            ref={drawingCanvasRef}
            className="absolute inset-0 pointer-events-none"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: '0 0',
              width: '3000px',
              height: '2000px'
            }}
          />

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
          {nodes.length === 0 && strokes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center">
                <FiEdit3 className="w-12 h-12 text-[var(--color-border)] mx-auto mb-4" />
                <p className="text-[var(--color-text-muted)]">
                  Start drawing with pen tools or add elements
                </p>
                <p className="text-xs text-[var(--color-text-muted)] mt-2">
                  Ctrl/Cmd + scroll to zoom • Alt + drag to pan • Touch/stylus supported
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Status bar */}
      <div className="px-4 py-1.5 border-t border-[var(--color-border)] bg-[var(--color-bg-elevated)] flex items-center justify-between text-xs text-[var(--color-text-muted)]">
        <div className="flex items-center gap-4">
          <span>{currentPage?.name}</span>
          <span>{nodes.length} elements</span>
          <span>{connections.length} connections</span>
          <span>{strokes.length} strokes</span>
        </div>
        <div className="flex items-center gap-2">
          <span>Tool: {selectedTool}</span>
          <span>•</span>
          <span>Press V for select, P for pen, E for eraser</span>
        </div>
      </div>
    </div>
  )
}
