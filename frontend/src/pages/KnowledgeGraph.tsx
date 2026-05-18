import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import ForceGraph3D from 'react-force-graph-3d'
import type { ForceGraphMethods } from 'react-force-graph-3d'
import {
  FiSearch, FiX, FiRefreshCw, FiMaximize, FiCrosshair,
  FiInfo, FiShare2,
} from 'react-icons/fi'
import { api, apiClient } from '../services/api'

// ─── Entity palette ─────────────────────────────────────────────────
// Node colours by category — kept aligned with KnowledgeGraphView so a
// user moving between embeds and this page sees one colour language.
const ENTITY_COLORS: Record<string, { bg: string; text: string }> = {
  gene: { bg: '#3B82F6', text: 'Gene' },
  protein: { bg: '#8B5CF6', text: 'Protein' },
  disease: { bg: '#EF4444', text: 'Disease' },
  drug: { bg: '#10B981', text: 'Drug' },
  pathway: { bg: '#F59E0B', text: 'Pathway' },
  biomarker: { bg: '#EC4899', text: 'Biomarker' },
  adc: { bg: '#06B6D4', text: 'ADC' },
  antigen: { bg: '#14B8A6', text: 'Antigen' },
  cell_type: { bg: '#6366F1', text: 'Cell Type' },
  mutation: { bg: '#F97316', text: 'Mutation' },
}
const DEFAULT_COLOR = '#64748b'

const RELATION_COLORS: Record<string, string> = {
  treats: '#10B981', targets: '#3B82F6', inhibits: '#EF4444',
  activates: '#22C55E', causes: '#F97316', associates: '#8B5CF6',
  expresses: '#EC4899', resistance: '#F59E0B', modulates: '#06B6D4',
  biomarker_of: '#14B8A6',
}

type Scope = 'private' | 'common' | 'all'

// Backend shapes — /knowledge-graph/scope/{scope}
interface RawNode {
  id: string
  name: string
  type: string | null
  description?: string | null
  properties?: Record<string, unknown>
}
interface RawEdge {
  id: string
  source_id: string
  target_id: string
  source_name?: string | null
  target_name?: string | null
  relationship: string
  strength?: number | null
}
interface ScopePayload {
  nodes: RawNode[]
  edges: RawEdge[]
  total_nodes?: number
  total_edges?: number
}

// react-force-graph node — RawNode + runtime-assigned coordinates +
// our derived degree (drives node size).
interface GNode extends RawNode {
  degree: number
  x?: number; y?: number; z?: number
}
interface GLink {
  source: string | GNode
  target: string | GNode
  relationship: string
  strength: number
}

function colorOf(type: string | null | undefined): string {
  return ENTITY_COLORS[(type || '').toLowerCase()]?.bg || DEFAULT_COLOR
}

const NODE_LIMIT = 1200

export default function KnowledgeGraph() {
  const [scope, setScope] = useState<Scope>('all')
  const [payload, setPayload] = useState<ScopePayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<GNode | null>(null)

  const fgRef = useRef<ForceGraphMethods | undefined>(undefined)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [dims, setDims] = useState({ w: 800, h: 600 })

  // ── Fetch the scoped graph (nodes + edges in one round-trip) ──
  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data } = await apiClient.get<ScopePayload>(
        `/knowledge-graph/scope/${scope}`,
        { params: { limit: NODE_LIMIT } },
      )
      setPayload({
        nodes: Array.isArray(data.nodes) ? data.nodes : [],
        edges: Array.isArray(data.edges) ? data.edges : [],
        total_nodes: data.total_nodes,
        total_edges: data.total_edges,
      })
    } catch (e) {
      const err = e as { message?: string }
      setError(err?.message || 'Failed to load knowledge graph')
      setPayload(null)
    } finally {
      setLoading(false)
    }
  }, [scope])

  useEffect(() => { load() }, [load])

  // Aggregate counts for the header (full KB totals, not the page slice)
  const { data: stats } = useQuery({
    queryKey: ['knowledge', 'stats'],
    queryFn: () => api.getGraphStats(),
  })

  // ── Size the 3D viewport to its container ──
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setDims({
        w: Math.max(320, el.clientWidth),
        h: Math.max(320, el.clientHeight),
      })
    })
    ro.observe(el)
    setDims({ w: Math.max(320, el.clientWidth), h: Math.max(320, el.clientHeight) })
    return () => ro.disconnect()
  }, [])

  // ── Build graph data (filtered by entity-type toggles) ──
  // Degree drives node size; rebuilt only when payload / filters change
  // so search highlighting never re-runs the physics simulation.
  const graphData = useMemo(() => {
    if (!payload) return { nodes: [] as GNode[], links: [] as GLink[] }
    const nodes: GNode[] = payload.nodes
      .filter(n => !hiddenTypes.has((n.type || 'other').toLowerCase()))
      .map(n => ({ ...n, degree: 0 }))
    const byId = new Map(nodes.map(n => [n.id, n]))
    const links: GLink[] = []
    for (const e of payload.edges) {
      const s = byId.get(e.source_id)
      const t = byId.get(e.target_id)
      if (!s || !t) continue
      s.degree += 1
      t.degree += 1
      links.push({
        source: e.source_id,
        target: e.target_id,
        relationship: e.relationship,
        strength: e.strength ?? 0.5,
      })
    }
    return { nodes, links }
  }, [payload, hiddenTypes])

  // ── Search — matched node ids (highlighted, not filtered out) ──
  const matchedIds = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (q.length < 2) return new Set<string>()
    return new Set(
      graphData.nodes
        .filter(n => n.name.toLowerCase().includes(q))
        .map(n => n.id),
    )
  }, [searchQuery, graphData.nodes])

  const searchResults = useMemo(() => {
    if (matchedIds.size === 0) return []
    return graphData.nodes.filter(n => matchedIds.has(n.id)).slice(0, 12)
  }, [matchedIds, graphData.nodes])

  // Entity types actually present, for the filter row
  const presentTypes = useMemo(() => {
    const s = new Set<string>()
    for (const n of payload?.nodes || []) s.add((n.type || 'other').toLowerCase())
    return [...s].sort()
  }, [payload])

  // Fly the camera to a node and select it.
  const focusNode = useCallback((node: GNode) => {
    setSelected(node)
    const fg = fgRef.current
    if (fg && node.x != null && node.y != null && node.z != null) {
      const dist = 90
      const ratio = 1 + dist / Math.hypot(node.x, node.y, node.z || 1)
      fg.cameraPosition(
        { x: node.x * ratio, y: node.y * ratio, z: (node.z || 1) * ratio },
        { x: node.x, y: node.y, z: node.z || 0 },
        1400,
      )
    }
  }, [])

  const toggleType = (t: string) =>
    setHiddenTypes(prev => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })

  // Connections for the detail drawer — from the pristine edge list.
  const connections = useMemo(() => {
    if (!selected || !payload) return []
    const out: { relationship: string; otherId: string; otherName: string; dir: '→' | '←' }[] = []
    for (const e of payload.edges) {
      if (e.source_id === selected.id) {
        out.push({ relationship: e.relationship, otherId: e.target_id, otherName: e.target_name || e.target_id, dir: '→' })
      } else if (e.target_id === selected.id) {
        out.push({ relationship: e.relationship, otherId: e.source_id, otherName: e.source_name || e.source_id, dir: '←' })
      }
    }
    return out.slice(0, 60)
  }, [selected, payload])

  const searchActive = matchedIds.size > 0

  return (
    <div className="h-full flex flex-col bg-[var(--color-bg)]">
      {/* ── Header ── */}
      <div className="px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-bg-elevated)] flex-shrink-0">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="mr-auto">
            <h1 className="text-lg font-bold text-[var(--color-text)] leading-tight">
              Knowledge Graph
            </h1>
            <p className="text-xs text-[var(--color-text-muted)]">
              {stats
                ? `${stats.total_entities?.toLocaleString() ?? 0} entities · ${stats.total_relations?.toLocaleString() ?? 0} relations`
                : 'Interactive 3D exploration with evidence drill-down'}
            </p>
          </div>

          {/* Scope toggle */}
          <div className="flex items-center gap-1">
            {(['private', 'common', 'all'] as const).map(s => (
              <button
                key={s}
                onClick={() => setScope(s)}
                className="text-xs px-3 py-1.5 rounded-md capitalize transition-colors"
                style={{
                  background: scope === s ? 'var(--color-text)' : 'transparent',
                  color: scope === s ? 'var(--color-bg)' : 'var(--color-text-muted)',
                  border: '1px solid var(--color-border)',
                  fontWeight: scope === s ? 600 : 400,
                }}
              >
                {s === 'all' ? 'All visible' : s}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative">
            <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] w-4 h-4" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search genes, proteins, diseases…"
              className="w-72 bg-[var(--glass-bg)] border border-[var(--color-border)] rounded-lg py-2 pl-9 pr-8 text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-border-strong)]"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              >
                <FiX className="w-4 h-4" />
              </button>
            )}
            {searchResults.length > 0 && (
              <div className="absolute z-30 mt-1 w-72 bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-lg shadow-2xl max-h-72 overflow-auto">
                {searchResults.map(n => (
                  <button
                    key={n.id}
                    onClick={() => { focusNode(n); setSearchQuery('') }}
                    className="w-full px-3 py-2 text-left hover:bg-[var(--glass-bg-hover)] flex items-center gap-2.5"
                  >
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: colorOf(n.type) }} />
                    <span className="text-sm text-[var(--color-text)] truncate">{n.name}</span>
                    <span className="text-xs text-[var(--color-text-muted)] ml-auto capitalize">{n.type || 'other'}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={() => fgRef.current?.zoomToFit(800, 60)}
            title="Fit to view"
            className="p-2 rounded-lg bg-[var(--glass-bg)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            <FiMaximize className="w-4 h-4" />
          </button>
          <button
            onClick={load}
            title="Reload"
            className="p-2 rounded-lg bg-[var(--glass-bg)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            <FiRefreshCw className="w-4 h-4" />
          </button>
        </div>

        {/* Entity-type filter row */}
        {presentTypes.length > 0 && (
          <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
            {presentTypes.map(t => {
              const on = !hiddenTypes.has(t)
              const c = colorOf(t)
              return (
                <button
                  key={t}
                  onClick={() => toggleType(t)}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs capitalize transition-opacity"
                  style={{
                    background: 'var(--glass-bg)',
                    border: '1px solid var(--color-border)',
                    color: on ? 'var(--color-text)' : 'var(--color-text-muted)',
                    opacity: on ? 1 : 0.45,
                  }}
                >
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: c }} />
                  {ENTITY_COLORS[t]?.text || t.replace('_', ' ')}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* ── 3D viewport ── */}
      <div ref={wrapRef} className="flex-1 relative overflow-hidden">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center z-20 bg-black/40 backdrop-blur-sm">
            <div className="text-sm text-[var(--color-text-muted)] flex items-center gap-2">
              <FiRefreshCw className="w-4 h-4 animate-spin" />
              Loading knowledge graph…
            </div>
          </div>
        )}

        {error && !loading && (
          <div className="absolute inset-0 flex items-center justify-center z-20">
            <div className="text-center">
              <FiInfo className="w-6 h-6 text-[var(--color-text-muted)] mx-auto mb-2" />
              <p className="text-sm text-[var(--color-text)]">{error}</p>
              <button onClick={load} className="mt-3 text-xs px-3 py-1.5 rounded-lg bg-[var(--glass-bg)] border border-[var(--color-border)] text-[var(--color-text)]">
                Retry
              </button>
            </div>
          </div>
        )}

        {!loading && !error && graphData.nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center z-20">
            <p className="text-sm text-[var(--color-text-muted)] max-w-sm text-center">
              {scope === 'private'
                ? 'No private entities yet — write a hypothesis or save a paper to start populating your graph.'
                : 'No entities found in this scope yet.'}
            </p>
          </div>
        )}

        <ForceGraph3D
          ref={fgRef}
          width={dims.w}
          height={dims.h}
          graphData={graphData}
          backgroundColor="#070a0f"
          showNavInfo={false}
          nodeRelSize={4}
          nodeResolution={12}
          nodeOpacity={0.95}
          nodeVal={(n) => {
            const node = n as GNode
            return Math.min(14, 3 + node.degree * 0.7)
          }}
          nodeColor={(n) => {
            const node = n as GNode
            if (searchActive) {
              return matchedIds.has(node.id) ? colorOf(node.type) : '#1f2a38'
            }
            return colorOf(node.type)
          }}
          nodeLabel={(n) => {
            const node = n as GNode
            return `<div style="background:#11161f;color:#e8eef5;padding:6px 10px;
              border:1px solid #2a3240;border-radius:6px;font-size:11px;max-width:240px">
              <b>${escapeHtml(node.name)}</b><br/>
              <span style="color:#8a99b3">${node.type || 'entity'} · ${node.degree} link${node.degree === 1 ? '' : 's'}</span>
            </div>`
          }}
          linkColor={(l) => {
            const link = l as GLink
            if (searchActive) return 'rgba(120,140,165,0.10)'
            return RELATION_COLORS[link.relationship] || 'rgba(140,160,185,0.32)'
          }}
          linkWidth={(l) => Math.max(0.4, ((l as GLink).strength || 0.5) * 1.6)}
          linkOpacity={0.55}
          linkDirectionalParticles={graphData.links.length < 500 ? 2 : 0}
          linkDirectionalParticleWidth={1.4}
          linkDirectionalParticleSpeed={0.006}
          enableNodeDrag={false}
          enableNavigationControls
          cooldownTicks={180}
          warmupTicks={40}
          onEngineStop={() => fgRef.current?.zoomToFit(700, 60)}
          onNodeClick={(n) => focusNode(n as GNode)}
          onBackgroundClick={() => setSelected(null)}
        />

        {/* Legend */}
        {graphData.nodes.length > 0 && (
          <div className="absolute top-3 left-3 bg-[var(--color-bg-elevated)]/90 backdrop-blur-sm rounded-lg p-3 z-10 border border-[var(--color-border)]">
            <h4 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">Legend</h4>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              {presentTypes.slice(0, 10).map(t => (
                <div key={t} className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: colorOf(t) }} />
                  <span className="text-[11px] text-[var(--color-text-muted)] capitalize">
                    {ENTITY_COLORS[t]?.text || t.replace('_', ' ')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Stats chip */}
        {payload && (
          <div className="absolute bottom-3 left-3 bg-[var(--color-bg-elevated)]/90 backdrop-blur-sm rounded-lg px-3 py-1.5 z-10 border border-[var(--color-border)] flex items-center gap-3 text-xs">
            <span className="text-[var(--color-text-muted)]">
              Showing <span className="text-[var(--color-text)] font-medium">{graphData.nodes.length}</span> nodes
            </span>
            <span className="text-[var(--color-text-muted)]">
              <span className="text-[var(--color-text)] font-medium">{graphData.links.length}</span> edges
            </span>
            {searchActive && (
              <span className="text-[var(--color-text)]">· {matchedIds.size} match{matchedIds.size === 1 ? '' : 'es'}</span>
            )}
          </div>
        )}

        {/* Selected-node detail drawer */}
        {selected && (
          <div className="absolute top-3 right-3 bottom-3 w-80 bg-[var(--color-bg-elevated)]/95 backdrop-blur-sm rounded-lg z-10 border border-[var(--color-border)] flex flex-col">
            <div className="p-4 border-b border-[var(--color-border)] flex items-start justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
                  style={{ background: colorOf(selected.type) }}
                >
                  {selected.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <h3 className="text-[var(--color-text)] font-semibold text-sm truncate">{selected.name}</h3>
                  <p className="text-[var(--color-text-muted)] text-xs capitalize">{selected.type || 'entity'}</p>
                </div>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] flex-shrink-0"
              >
                <FiX className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto flex-1 space-y-4">
              {selected.description && (
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] font-medium">Description</label>
                  <p className="text-sm text-[var(--color-text-secondary)] mt-1">{selected.description}</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div className="bg-[var(--glass-bg)] rounded-lg p-2 text-center">
                  <p className="text-[10px] text-[var(--color-text-muted)]">Connections</p>
                  <p className="text-[var(--color-text)] font-semibold">{selected.degree}</p>
                </div>
                <div className="bg-[var(--glass-bg)] rounded-lg p-2 text-center">
                  <p className="text-[10px] text-[var(--color-text-muted)]">Type</p>
                  <p className="text-[var(--color-text)] font-semibold text-xs capitalize truncate">{selected.type || 'entity'}</p>
                </div>
              </div>

              {connections.length > 0 && (
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] font-medium flex items-center gap-1.5">
                    <FiShare2 className="w-3 h-3" /> Relationships ({connections.length})
                  </label>
                  <div className="mt-2 space-y-1.5">
                    {connections.map((c, i) => {
                      const target = graphData.nodes.find(n => n.id === c.otherId)
                      return (
                        <button
                          key={i}
                          disabled={!target}
                          onClick={() => target && focusNode(target)}
                          className="w-full text-left p-2 bg-[var(--glass-bg)] rounded-lg text-xs hover:bg-[var(--glass-bg-hover)] transition-colors disabled:opacity-50"
                        >
                          <div className="flex items-center gap-1.5">
                            <span
                              className="px-1.5 py-0.5 rounded text-[10px]"
                              style={{
                                background: (RELATION_COLORS[c.relationship] || '#64748b') + '22',
                                color: RELATION_COLORS[c.relationship] || '#94a3b8',
                              }}
                            >
                              {c.dir} {c.relationship}
                            </span>
                          </div>
                          <p className="text-[var(--color-text)] mt-1 truncate">{c.otherName}</p>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {connections.length === 0 && (
                <div className="text-center py-6">
                  <FiCrosshair className="w-5 h-5 text-[var(--color-text-muted)] mx-auto mb-1" />
                  <p className="text-xs text-[var(--color-text-muted)]">No relationships in this scope</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
