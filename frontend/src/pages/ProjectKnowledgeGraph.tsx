import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import {
  FiSearch, FiZoomIn, FiZoomOut, FiMaximize2,
  FiDownload, FiX, FiExternalLink, FiInfo,
  FiChevronRight, FiRefreshCw,
} from 'react-icons/fi'
import clsx from 'clsx'
import cytoscape, { Core, EventObject, NodeSingular } from 'cytoscape'
// @ts-expect-error no type declarations for cytoscape-cola
import cola from 'cytoscape-cola'

// Register cola layout
cytoscape.use(cola)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface KGNode {
  id: string
  label: string
  type: 'gene' | 'protein' | 'drug' | 'disease' | 'pathway'
  properties?: Record<string, string>
  externalLinks?: { label: string; url: string }[]
}

interface KGEdge {
  id: string
  source: string
  target: string
  relation: string
  confidence: number
}

interface GraphPayload {
  nodes: KGNode[]
  edges: KGEdge[]
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NODE_COLORS: Record<string, string> = {
  gene: '#3b82f6',
  protein: '#22c55e',
  drug: '#f97316',
  disease: '#ef4444',
  pathway: '#a855f7',
}

const NODE_BORDER_COLORS: Record<string, string> = {
  gene: '#2563eb',
  protein: '#16a34a',
  drug: '#ea580c',
  disease: '#dc2626',
  pathway: '#9333ea',
}

const TYPE_LABELS: Record<string, string> = {
  gene: 'Gene',
  protein: 'Protein',
  drug: 'Drug',
  disease: 'Disease',
  pathway: 'Pathway',
}

const ENTITY_TYPES = Object.keys(NODE_COLORS) as Array<keyof typeof NODE_COLORS>

// ---------------------------------------------------------------------------
// External-link helpers
// ---------------------------------------------------------------------------

function defaultExternalLinks(type: string, label: string): { label: string; url: string }[] {
  const encoded = encodeURIComponent(label)
  switch (type) {
    case 'gene':
      return [
        { label: 'NCBI Gene', url: `https://www.ncbi.nlm.nih.gov/gene/?term=${encoded}` },
        { label: 'UniProt', url: `https://www.uniprot.org/uniprotkb?query=${encoded}` },
      ]
    case 'protein':
      return [
        { label: 'UniProt', url: `https://www.uniprot.org/uniprotkb?query=${encoded}` },
        { label: 'PDB', url: `https://www.rcsb.org/search?q=${encoded}` },
      ]
    case 'drug':
      return [
        { label: 'DrugBank', url: `https://go.drugbank.com/unearth/q?query=${encoded}` },
        { label: 'PubChem', url: `https://pubchem.ncbi.nlm.nih.gov/#query=${encoded}` },
      ]
    case 'disease':
      return [
        { label: 'OMIM', url: `https://omim.org/search?search=${encoded}` },
        { label: 'MeSH', url: `https://meshb.nlm.nih.gov/search?searchInField=allFields&sort=&size=&searchType=exact&searchMethod=FullWord&q=${encoded}` },
      ]
    case 'pathway':
      return [
        { label: 'Reactome', url: `https://reactome.org/content/query?q=${encoded}` },
        { label: 'KEGG', url: `https://www.genome.jp/dbget-bin/www_bfind?pathway+${encoded}` },
      ]
    default:
      return []
  }
}

// No mock data — all graph data comes from the API

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ProjectKnowledgeGraph() {
  const { id: projectId } = useParams<{ id: string }>()

  // Graph data
  const [graphData, setGraphData] = useState<GraphPayload>({ nodes: [], edges: [] })
  const [loading, setLoading] = useState(true)

  // Search & filters
  const [searchQuery, setSearchQuery] = useState('')
  const [visibleTypes, setVisibleTypes] = useState<Set<string>>(new Set(ENTITY_TYPES))

  // Selection
  const [selectedNode, setSelectedNode] = useState<KGNode | null>(null)
  const [connectedEntities, setConnectedEntities] = useState<KGNode[]>([])

  // Cytoscape
  const cyRef = useRef<Core | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // -----------------------------------------------------------------------
  // Fetch data
  // -----------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false

    async function fetchGraph() {
      setLoading(true)
      try {
        const res = await fetch(`/api/v1/projects/${projectId}/knowledge-graph`)
        if (!res.ok) throw new Error('API unavailable')
        const payload: GraphPayload = await res.json()
        if (!cancelled) setGraphData(payload)
      } catch {
        // API unavailable — show empty graph
        if (!cancelled) setGraphData({ nodes: [], edges: [] })
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchGraph()
    return () => { cancelled = true }
  }, [projectId])

  // -----------------------------------------------------------------------
  // Filter helpers
  // -----------------------------------------------------------------------

  const toggleType = useCallback((type: string) => {
    setVisibleTypes(prev => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }, [])

  const filteredNodes = useMemo(() => {
    return graphData.nodes.filter(n => {
      if (!visibleTypes.has(n.type)) return false
      if (searchQuery) {
        const q = searchQuery.toLowerCase()
        return n.label.toLowerCase().includes(q) || n.type.toLowerCase().includes(q)
      }
      return true
    })
  }, [graphData.nodes, visibleTypes, searchQuery])

  const filteredNodeIds = useMemo(() => new Set(filteredNodes.map(n => n.id)), [filteredNodes])

  const filteredEdges = useMemo(() => {
    return graphData.edges.filter(
      e => filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target),
    )
  }, [graphData.edges, filteredNodeIds])

  // -----------------------------------------------------------------------
  // Initialize / update Cytoscape
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (!containerRef.current) return

    // Destroy previous instance
    if (cyRef.current) {
      cyRef.current.destroy()
      cyRef.current = null
    }

    if (filteredNodes.length === 0) return

    const elements = [
      ...filteredNodes.map(n => ({
        data: {
          id: n.id,
          label: n.label,
          type: n.type,
          bgColor: NODE_COLORS[n.type] || '#64748b',
          borderColor: NODE_BORDER_COLORS[n.type] || '#475569',
        },
      })),
      ...filteredEdges.map(e => ({
        data: {
          id: e.id,
          source: e.source,
          target: e.target,
          label: `${e.relation} (${(e.confidence * 100).toFixed(0)}%)`,
          relation: e.relation,
          confidence: e.confidence,
        },
      })),
    ]

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      minZoom: 0.3,
      maxZoom: 3,
      style: [
        {
          selector: 'node',
          style: {
            label: 'data(label)',
            'background-color': 'data(bgColor)',
            'border-color': 'data(borderColor)',
            'border-width': 2,
            color: '#e2e8f0',
            'font-size': '11px',
            'font-family': 'Inter, system-ui, sans-serif',
            'text-valign': 'bottom',
            'text-halign': 'center',
            'text-margin-y': 6,
            width: 40,
            height: 40,
            'text-outline-width': 2,
            'text-outline-color': '#0f172a',
            'text-wrap': 'ellipsis',
            'text-max-width': '80px',
          } as any,
        },
        {
          selector: 'node:selected',
          style: {
            'border-width': 4,
            'border-color': '#ffffff',
            width: 50,
            height: 50,
          },
        },
        {
          selector: 'node.highlighted',
          style: {
            'border-width': 3,
            'border-color': '#facc15',
          },
        },
        {
          selector: 'edge',
          style: {
            width: 1.5,
            'line-color': '#475569',
            'target-arrow-color': '#475569',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            label: 'data(label)',
            color: '#94a3b8',
            'font-size': '9px',
            'font-family': 'Inter, system-ui, sans-serif',
            'text-rotation': 'autorotate',
            'text-margin-y': -8,
            'text-outline-width': 2,
            'text-outline-color': '#0f172a',
          } as any,
        },
        {
          selector: 'edge:selected',
          style: {
            width: 3,
            'line-color': '#60a5fa',
            'target-arrow-color': '#60a5fa',
          },
        },
      ],
      layout: {
        name: 'cola',
        animate: true,
        randomize: false,
        maxSimulationTime: 3000,
        nodeSpacing: 30,
        edgeLength: 150,
        fit: true,
        padding: 40,
      } as any,
    })

    // Node click handler
    cy.on('tap', 'node', (evt: EventObject) => {
      const node = evt.target as NodeSingular
      const nodeId = node.id()
      const kgNode = graphData.nodes.find(n => n.id === nodeId) || null
      setSelectedNode(kgNode)

      // Compute connected entities
      if (kgNode) {
        const neighborIds = new Set<string>()
        graphData.edges.forEach(e => {
          if (e.source === nodeId) neighborIds.add(e.target)
          if (e.target === nodeId) neighborIds.add(e.source)
        })
        setConnectedEntities(graphData.nodes.filter(n => neighborIds.has(n.id)))
      }
    })

    // Background click clears selection
    cy.on('tap', (evt: EventObject) => {
      if (evt.target === cy) {
        setSelectedNode(null)
        setConnectedEntities([])
      }
    })

    cyRef.current = cy

    return () => {
      cy.destroy()
      cyRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredNodes, filteredEdges])

  // -----------------------------------------------------------------------
  // Expand neighborhood
  // -----------------------------------------------------------------------

  const expandNeighborhood = useCallback(async (nodeId: string) => {
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/knowledge-graph/neighbors/${nodeId}`)
      if (!res.ok) throw new Error('Expand failed')
      const payload: GraphPayload = await res.json()
      setGraphData(prev => {
        const existingNodeIds = new Set(prev.nodes.map(n => n.id))
        const existingEdgeIds = new Set(prev.edges.map(e => e.id))
        return {
          nodes: [
            ...prev.nodes,
            ...payload.nodes.filter(n => !existingNodeIds.has(n.id)),
          ],
          edges: [
            ...prev.edges,
            ...payload.edges.filter(e => !existingEdgeIds.has(e.id)),
          ],
        }
      })
    } catch {
      // Silently fail -- graph stays as-is
    }
  }, [projectId])

  // -----------------------------------------------------------------------
  // Controls
  // -----------------------------------------------------------------------

  const handleZoomIn = useCallback(() => {
    cyRef.current?.zoom({ level: (cyRef.current.zoom() || 1) * 1.2, renderedPosition: { x: (containerRef.current?.offsetWidth || 0) / 2, y: (containerRef.current?.offsetHeight || 0) / 2 } })
  }, [])

  const handleZoomOut = useCallback(() => {
    cyRef.current?.zoom({ level: (cyRef.current.zoom() || 1) / 1.2, renderedPosition: { x: (containerRef.current?.offsetWidth || 0) / 2, y: (containerRef.current?.offsetHeight || 0) / 2 } })
  }, [])

  const handleFit = useCallback(() => {
    cyRef.current?.fit(undefined, 40)
  }, [])

  const handleExportPng = useCallback(() => {
    if (!cyRef.current) return
    const png = cyRef.current.png({ output: 'blob', bg: '#0f172a', full: true, scale: 2 })
    const url = URL.createObjectURL(png as Blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `project-${projectId}-knowledge-graph.png`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [projectId])

  // -----------------------------------------------------------------------
  // Search highlighting
  // -----------------------------------------------------------------------

  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    cy.nodes().removeClass('highlighted')
    if (!searchQuery) return
    const q = searchQuery.toLowerCase()
    cy.nodes().forEach(node => {
      const label = (node.data('label') || '').toLowerCase()
      const type = (node.data('type') || '').toLowerCase()
      if (label.includes(q) || type.includes(q)) {
        node.addClass('highlighted')
      }
    })
  }, [searchQuery])

  // -----------------------------------------------------------------------
  // Detail panel external links
  // -----------------------------------------------------------------------

  const externalLinks = useMemo(() => {
    if (!selectedNode) return []
    return selectedNode.externalLinks ?? defaultExternalLinks(selectedNode.type, selectedNode.label)
  }, [selectedNode])

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className="h-full flex flex-col bg-[var(--color-bg)]">
      {/* Header */}
      <div className="shrink-0 p-4 border-b border-[var(--color-border)] bg-[var(--color-bg-elevated)]">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-xl font-bold text-[var(--color-text)]">Project Knowledge Graph</h1>
            <p className="text-[var(--color-text-muted)] text-sm">
              Explore entities and relationships for this project
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--color-text-muted)]">
              {filteredNodes.length} nodes &middot; {filteredEdges.length} edges
            </span>
          </div>
        </div>

        {/* Search bar */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] w-4 h-4" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search by name or type..."
              className="w-full bg-[var(--glass-bg)] border border-[var(--color-border)] rounded-lg py-2 pl-10 pr-9 text-sm text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-blue-500"
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

          {/* Type filter checkboxes */}
          <div className="flex items-center gap-3">
            {ENTITY_TYPES.map(type => (
              <label
                key={type}
                className="flex items-center gap-1.5 cursor-pointer select-none group"
              >
                <input
                  type="checkbox"
                  checked={visibleTypes.has(type)}
                  onChange={() => toggleType(type)}
                  className="rounded border-[var(--color-border-strong)] focus:ring-blue-500"
                  style={{ accentColor: NODE_COLORS[type] }}
                />
                <span
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: NODE_COLORS[type] }}
                />
                <span className="text-xs text-[var(--color-text-secondary)] group-hover:text-[var(--color-text)]">
                  {TYPE_LABELS[type]}
                </span>
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Main area */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Graph container */}
        <div className="flex-1 relative">
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--color-bg)]/80 backdrop-blur-sm">
              <div className="flex items-center gap-3 text-[var(--color-text-muted)]">
                <FiRefreshCw className="w-5 h-5 animate-spin" />
                <span className="text-sm">Loading knowledge graph...</span>
              </div>
            </div>
          )}

          {!loading && filteredNodes.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-[var(--color-text-muted)]">
              <FiInfo className="w-8 h-8 mb-2" />
              <p className="text-sm">No entities match the current filters.</p>
            </div>
          )}

          <div ref={containerRef} className="w-full h-full" />

          {/* Zoom / Pan / Export controls */}
          <div className="absolute bottom-4 right-4 flex flex-col gap-2 z-10">
            <button
              onClick={handleZoomIn}
              className="p-2 bg-[var(--glass-bg)] border border-[var(--color-border)] rounded-lg hover:bg-[var(--glass-bg-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
              title="Zoom in"
            >
              <FiZoomIn className="w-5 h-5" />
            </button>
            <button
              onClick={handleZoomOut}
              className="p-2 bg-[var(--glass-bg)] border border-[var(--color-border)] rounded-lg hover:bg-[var(--glass-bg-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
              title="Zoom out"
            >
              <FiZoomOut className="w-5 h-5" />
            </button>
            <button
              onClick={handleFit}
              className="p-2 bg-[var(--glass-bg)] border border-[var(--color-border)] rounded-lg hover:bg-[var(--glass-bg-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
              title="Fit to view"
            >
              <FiMaximize2 className="w-5 h-5" />
            </button>
            <button
              onClick={handleExportPng}
              className="p-2 bg-[var(--glass-bg)] border border-[var(--color-border)] rounded-lg hover:bg-[var(--glass-bg-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
              title="Export as PNG"
            >
              <FiDownload className="w-5 h-5" />
            </button>
          </div>

          {/* Legend */}
          <div className="absolute top-4 left-4 bg-[var(--color-bg-elevated)] backdrop-blur-sm border border-[var(--color-border)] rounded-lg p-3 z-10">
            <h4 className="text-xs font-semibold text-[var(--color-text-secondary)] mb-2">Legend</h4>
            <div className="flex flex-col gap-1.5">
              {ENTITY_TYPES.map(type => (
                <div key={type} className="flex items-center gap-2">
                  <span
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: NODE_COLORS[type] }}
                  />
                  <span className="text-xs text-[var(--color-text-muted)]">{TYPE_LABELS[type]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Detail panel (right sidebar) */}
        {selectedNode && (
          <div className="w-80 shrink-0 border-l border-[var(--color-border)] bg-[var(--color-bg-elevated)] overflow-y-auto">
            <div className="p-4">
              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-[var(--color-text)]">Entity Details</h2>
                <button
                  onClick={() => { setSelectedNode(null); setConnectedEntities([]) }}
                  className="p-1 rounded hover:bg-white/5 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                >
                  <FiX className="w-4 h-4" />
                </button>
              </div>

              {/* Entity name + type badge */}
              <div className="flex items-center gap-3 mb-5">
                <div
                  className="w-11 h-11 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
                  style={{ backgroundColor: NODE_COLORS[selectedNode.type] }}
                >
                  {selectedNode.label.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <h3 className="text-[var(--color-text)] font-semibold truncate">
                    {selectedNode.label}
                  </h3>
                  <span
                    className="inline-block mt-0.5 px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide"
                    style={{
                      backgroundColor: NODE_COLORS[selectedNode.type] + '20',
                      color: NODE_COLORS[selectedNode.type],
                    }}
                  >
                    {TYPE_LABELS[selectedNode.type]}
                  </span>
                </div>
              </div>

              {/* Properties */}
              {selectedNode.properties && Object.keys(selectedNode.properties).length > 0 && (
                <div className="mb-5">
                  <h4 className="text-xs font-medium text-[var(--color-text-muted)] mb-2">Properties</h4>
                  <div className="space-y-1.5">
                    {Object.entries(selectedNode.properties).map(([key, value]) => (
                      <div
                        key={key}
                        className="flex items-center justify-between bg-[var(--glass-bg)] rounded px-3 py-1.5"
                      >
                        <span className="text-xs text-[var(--color-text-muted)] capitalize">{key}</span>
                        <span className="text-xs text-[var(--color-text-secondary)] font-medium">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Connected entities */}
              {connectedEntities.length > 0 && (
                <div className="mb-5">
                  <h4 className="text-xs font-medium text-[var(--color-text-muted)] mb-2">
                    Connected Entities ({connectedEntities.length})
                  </h4>
                  <div className="space-y-1.5 max-h-52 overflow-y-auto">
                    {connectedEntities.map(entity => {
                      // Find the connecting edge
                      const edge = graphData.edges.find(
                        e =>
                          (e.source === selectedNode.id && e.target === entity.id) ||
                          (e.target === selectedNode.id && e.source === entity.id),
                      )
                      return (
                        <button
                          key={entity.id}
                          className="w-full flex items-center gap-2 bg-[var(--glass-bg)] rounded px-3 py-2 text-left hover:bg-[var(--glass-bg-hover)] transition-colors group"
                          onClick={() => {
                            // Select this node in cytoscape
                            const cy = cyRef.current
                            if (cy) {
                              cy.nodes().unselect()
                              const target = cy.getElementById(entity.id)
                              if (target.length) {
                                target.select()
                                cy.animate({ center: { eles: target }, duration: 300 })
                              }
                            }
                            setSelectedNode(entity)
                            // Recompute connected
                            const neighborIds = new Set<string>()
                            graphData.edges.forEach(e => {
                              if (e.source === entity.id) neighborIds.add(e.target)
                              if (e.target === entity.id) neighborIds.add(e.source)
                            })
                            setConnectedEntities(graphData.nodes.filter(n => neighborIds.has(n.id)))
                          }}
                        >
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: NODE_COLORS[entity.type] }}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs text-[var(--color-text)] truncate group-hover:text-white">
                              {entity.label}
                            </p>
                            {edge && (
                              <p className="text-[10px] text-[var(--color-text-muted)]">
                                {edge.relation} &middot; {(edge.confidence * 100).toFixed(0)}%
                              </p>
                            )}
                          </div>
                          <FiChevronRight className="w-3 h-3 text-[var(--color-text-muted)] opacity-0 group-hover:opacity-100 shrink-0" />
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Expand neighborhood */}
              <button
                onClick={() => expandNeighborhood(selectedNode.id)}
                className="w-full mb-5 flex items-center justify-center gap-2 bg-[var(--glass-bg)] border border-[var(--color-border)] rounded-lg py-2 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--glass-bg-hover)] transition-colors"
              >
                <FiRefreshCw className="w-3.5 h-3.5" />
                Expand Neighborhood
              </button>

              {/* External database links */}
              <div>
                <h4 className="text-xs font-medium text-[var(--color-text-muted)] mb-2">External Links</h4>
                <div className="flex flex-wrap gap-2">
                  {externalLinks.map((link, i) => (
                    <a
                      key={i}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={clsx(
                        'inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs',
                        'bg-[var(--glass-bg)] border border-[var(--color-border)]',
                        'text-[var(--color-text)] hover:bg-[var(--glass-bg-hover)] transition-colors',
                      )}
                    >
                      <FiExternalLink className="w-3 h-3" />
                      {link.label}
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
