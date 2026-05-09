/**
 * KnowledgeGraphView — embeddable visual KG widget.
 *
 * The full /knowledge-graph page (KnowledgeGraph.tsx, ~1100 lines)
 * carries the heavy filter/search/inspector chrome. This component
 * is the lightweight rendering primitive — drop it anywhere we want
 * a compact subgraph view. Used in three places per the visual-KG
 * integration:
 *
 *   1. /knowledge-graph page — scope toggle (Private / Common /
 *      All) by passing `fetchScope`.
 *   2. HypothesisReview — `fetchHypothesisId` shows the hypothesis
 *      subgraph (entities mentioned in statement + mechanism + tags).
 *   3. Saved-paper detail — `fetchPaperId` shows the paper subgraph.
 *
 * Renders to canvas via a deterministic circular layout + edge
 * lines. Node colour per `type` (gene / protein / disease / drug /
 * pathway / etc.). Click a node to call `onSelectNode`.
 *
 * Why deterministic circular instead of force-directed: force layout
 * needs an animation loop and a heavier physics solver; we want this
 * widget cheap to mount inside other pages without a frame budget.
 * The full /knowledge-graph page can keep its richer layout.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { apiClient } from '../services'

// Mirrors the backend KnowledgeGraphNode shape (returned by
// /api/v1/knowledge-graph/scope/* and the subgraph endpoints).
export interface KGViewNode {
  id: string
  name: string
  type: string | null
  description?: string | null
  properties?: Record<string, unknown>
}

// Mirrors the backend KnowledgeGraphEdge.
export interface KGViewEdge {
  id: string
  source_id: string
  target_id: string
  source_name?: string | null
  target_name?: string | null
  relationship: string
  strength?: number | null
}

interface KGViewPayload {
  nodes: KGViewNode[]
  edges: KGViewEdge[]
  total_nodes?: number
  total_edges?: number
}

// Three input modes — exactly one of these props should be provided.
type FetchProps =
  | { fetchScope: 'private' | 'common' | 'all' }
  | { fetchHypothesisId: string }
  | { fetchPaperId: string }
  | { nodes: KGViewNode[]; edges: KGViewEdge[] }

type KnowledgeGraphViewProps = FetchProps & {
  height?: number
  className?: string
  onSelectNode?: (node: KGViewNode) => void
  // Optional empty-state copy override.
  emptyLabel?: string
}

// Node fill colours by type — kept aligned with the full
// KnowledgeGraph page's palette so a user moving between the two
// views sees a consistent colour language.
const NODE_FILL: Record<string, string> = {
  gene: '#3B82F6',
  protein: '#8B5CF6',
  disease: '#EF4444',
  drug: '#10B981',
  pathway: '#F59E0B',
  biomarker: '#EC4899',
  adc: '#06B6D4',
  antigen: '#14B8A6',
  cell_type: '#6366F1',
  mutation: '#F97316',
}

const DEFAULT_FILL = '#64748b'


function buildLayout(nodes: KGViewNode[], width: number, height: number) {
  // Deterministic circular layout — node i lands at angle
  // 2π * i / N. Cheap, predictable, and good enough for ≤100-ish
  // node embeds. Falls back to a single centred dot for N=1.
  const cx = width / 2
  const cy = height / 2
  const r = Math.min(width, height) * 0.38
  return nodes.map((node, i) => {
    if (nodes.length === 1) return { node, x: cx, y: cy }
    const angle = (2 * Math.PI * i) / nodes.length - Math.PI / 2
    return {
      node,
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    }
  })
}


export default function KnowledgeGraphView(props: KnowledgeGraphViewProps) {
  const { height = 360, className, onSelectNode, emptyLabel } = props
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [data, setData] = useState<KGViewPayload | null>(null)
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const [width, setWidth] = useState<number>(640)

  // Build the request URL from whichever fetch prop is set; the
  // direct-data variant skips the request entirely.
  const requestUrl = useMemo<string | null>(() => {
    if ('fetchScope' in props) {
      return `/knowledge-graph/scope/${props.fetchScope}`
    }
    if ('fetchHypothesisId' in props) {
      return `/knowledge-graph/hypothesis/${props.fetchHypothesisId}`
    }
    if ('fetchPaperId' in props) {
      return `/knowledge-graph/paper/${props.fetchPaperId}`
    }
    return null
  }, [props])

  // Direct-data mode: skip fetch, render the prop-supplied graph.
  // The dep array references the supplied arrays so the canvas
  // re-renders when the parent updates them. Both deps extracted to
  // local consts so eslint's react-hooks/exhaustive-deps can read them.
  const directNodes = 'nodes' in props ? props.nodes : null
  const directEdges = 'edges' in props ? props.edges : null
  useEffect(() => {
    if (directNodes && directEdges) {
      setData({ nodes: directNodes, edges: directEdges })
      setLoading(false)
      setError(null)
    }
  }, [directNodes, directEdges])

  // Fetch mode: hit the backend whenever the URL changes.
  useEffect(() => {
    if (!requestUrl) return
    let cancelled = false
    setLoading(true)
    setError(null)
    apiClient
      .get<KGViewPayload>(requestUrl)
      .then(resp => {
        if (cancelled) return
        // Normalise shape — backend has been seen returning a partial
        // payload (e.g. `{ total_nodes: 0 }` with no nodes/edges keys)
        // when the scope is empty. Without this guard the downstream
        // useMemo crashed with "Cannot read properties of undefined
        // (reading 'map')" the moment we tried to lay out data.nodes.
        const raw = resp.data ?? ({} as Partial<KGViewPayload>)
        setData({
          nodes: Array.isArray(raw.nodes) ? raw.nodes : [],
          edges: Array.isArray(raw.edges) ? raw.edges : [],
          total_nodes: raw.total_nodes,
          total_edges: raw.total_edges,
        })
      })
      .catch(err => {
        if (cancelled) return
        // 404 on hypothesis/paper subgraph means no matches — render
        // the empty state, not an error banner.
        if (err?.response?.status === 404) {
          setData({ nodes: [], edges: [] })
          setError(null)
        } else {
          setError(err instanceof Error ? err.message : 'Failed to load graph')
          setData(null)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [requestUrl])

  // ResizeObserver so the canvas reflows when the host changes width.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const w = Math.max(200, Math.floor(entry.contentRect.width))
        setWidth(w)
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const positions = useMemo(() => {
    if (!data) return []
    return buildLayout(data.nodes, width, height)
  }, [data, width, height])

  // Re-paint on every change to data, layout, or hover.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Hi-DPI: render at devicePixelRatio for crispness, then scale.
    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = height * dpr
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)

    if (!data) return

    const idToPos = new Map(positions.map(p => [p.node.id, p]))

    // Edges first so nodes paint over their endpoints.
    ctx.lineWidth = 1.25
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)'
    for (const e of data.edges) {
      const src = idToPos.get(e.source_id)
      const tgt = idToPos.get(e.target_id)
      if (!src || !tgt) continue
      ctx.beginPath()
      ctx.moveTo(src.x, src.y)
      ctx.lineTo(tgt.x, tgt.y)
      ctx.stroke()
    }

    // Nodes.
    positions.forEach((p, i) => {
      const isHover = hoverIdx === i
      const fill = NODE_FILL[p.node.type ?? ''] ?? DEFAULT_FILL
      ctx.beginPath()
      ctx.arc(p.x, p.y, isHover ? 11 : 8, 0, Math.PI * 2)
      ctx.fillStyle = fill
      ctx.fill()
      ctx.lineWidth = isHover ? 2 : 1
      ctx.strokeStyle = '#0f172a'
      ctx.stroke()

      // Label below the node — truncate long names.
      ctx.fillStyle = isHover ? '#f1f5f9' : '#cbd5e1'
      ctx.font = '11px ui-sans-serif, system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      const label = p.node.name.length > 18
        ? p.node.name.slice(0, 17) + '…'
        : p.node.name
      ctx.fillText(label, p.x, p.y + 14)
    })
  }, [data, positions, width, height, hoverIdx])

  // Click + hover hit-testing — proximity to the painted node centre.
  const onCanvasMove = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = ev.clientX - rect.left
    const y = ev.clientY - rect.top
    let best = -1
    let bestDist = 14 * 14 // hit radius squared
    for (let i = 0; i < positions.length; i++) {
      const p = positions[i]
      const dx = x - p.x
      const dy = y - p.y
      const d2 = dx * dx + dy * dy
      if (d2 < bestDist) {
        bestDist = d2
        best = i
      }
    }
    setHoverIdx(best === -1 ? null : best)
  }

  const onCanvasClick = () => {
    if (hoverIdx == null || !data) return
    const node = positions[hoverIdx]?.node
    if (node && onSelectNode) onSelectNode(node)
  }

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: '100%', position: 'relative' }}
    >
      <canvas
        ref={canvasRef}
        onMouseMove={onCanvasMove}
        onMouseLeave={() => setHoverIdx(null)}
        onClick={onCanvasClick}
        style={{
          display: 'block',
          background: 'var(--glass-bg)',
          border: '1px solid var(--color-border)',
          borderRadius: 12,
          cursor: hoverIdx != null ? 'pointer' : 'default',
        }}
      />
      {loading && (
        <Overlay>
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Loading graph…
          </span>
        </Overlay>
      )}
      {!loading && error && (
        <Overlay>
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {error}
          </span>
        </Overlay>
      )}
      {!loading && !error && data && data.nodes.length === 0 && (
        <Overlay>
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {emptyLabel ?? 'No entities found in this scope yet.'}
          </span>
        </Overlay>
      )}
      {hoverIdx != null && data && positions[hoverIdx] && (
        <div
          className="absolute pointer-events-none px-2 py-1 rounded text-xs"
          style={{
            left: positions[hoverIdx].x + 12,
            top: positions[hoverIdx].y - 6,
            background: 'var(--color-surface-solid)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text)',
            maxWidth: 220,
          }}
        >
          <div style={{ fontWeight: 500 }}>{positions[hoverIdx].node.name}</div>
          {positions[hoverIdx].node.type && (
            <div style={{ color: 'var(--color-text-muted)', fontSize: 10 }}>
              {positions[hoverIdx].node.type}
            </div>
          )}
        </div>
      )}
      {data && data.nodes.length > 0 && (
        <div
          className="absolute right-2 bottom-2 text-xxs px-2 py-1 rounded"
          style={{
            background: 'var(--color-surface-solid)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-muted)',
          }}
        >
          {data.nodes.length} {data.nodes.length === 1 ? 'node' : 'nodes'} · {data.edges.length} {data.edges.length === 1 ? 'edge' : 'edges'}
        </div>
      )}
    </div>
  )
}


function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="absolute inset-0 flex items-center justify-center pointer-events-none"
      style={{ borderRadius: 12 }}
    >
      {children}
    </div>
  )
}
