import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph3D from 'react-force-graph-3d'
import type { ForceGraphMethods } from 'react-force-graph-3d'
import {
  FiRefreshCw,
  FiMaximize2,
  FiMinimize2,
  FiInfo,
  FiSettings,
  FiDownload,
} from 'react-icons/fi'
import clsx from 'clsx'
import { apiClient } from '../services/api'

// Shape matches the backend ProjectKGResponse in
// backend/app/api/v1/endpoints/project_kg.py
interface KGNode {
  id: string
  name: string
  kind: string
  scope: 'private' | 'common' | 'public_domain'
  group: string
  color: string
  shape: string
  size: number
  canonical_id?: string
  payload?: Record<string, any>
  // react-force-graph adds these at runtime
  x?: number; y?: number; z?: number
  vx?: number; vy?: number; vz?: number
}

interface KGLink {
  source: string | KGNode
  target: string | KGNode
  relation: string
  confidence: number
  color: string
  scope: 'private' | 'common' | 'public_domain'
}

interface KGStats {
  nodes: number
  edges: number
  project_private: number
  project_common: number
  public_domain: number
}

interface ProjectKGResponse {
  project_id: string
  nodes: KGNode[]
  links: KGLink[]
  stats: KGStats
}

interface ProjectKG3DProps {
  projectId: string
  userId?: string | null
  height?: number | string
}

export default function ProjectKG3D({
  projectId,
  userId,
  height = 640,
}: ProjectKG3DProps) {
  const fgRef = useRef<ForceGraphMethods | undefined>(undefined)
  const [data, setData] = useState<ProjectKGResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedNode, setSelectedNode] = useState<KGNode | null>(null)
  const [filters, setFilters] = useState({
    privatE: true,
    common: true,
    public_domain: true,
  })
  const [fullscreen, setFullscreen] = useState(false)
  const [showControls, setShowControls] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params: Record<string, any> = { max_nodes: 500 }
      if (userId) params.user_id = userId
      const { data: resp } = await apiClient.get(
        `/projects/${encodeURIComponent(projectId)}/kg`,
        { params },
      )
      setData(resp)
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || 'Failed to load KG')
    } finally {
      setLoading(false)
    }
  }, [projectId, userId])

  useEffect(() => { load() }, [load])

  // Filter nodes/links by scope
  const filtered = useMemo(() => {
    if (!data) return { nodes: [], links: [] }
    const nodes = data.nodes.filter(n =>
      (filters.privatE && n.scope === 'private') ||
      (filters.common && n.scope === 'common') ||
      (filters.public_domain && n.scope === 'public_domain'),
    )
    const ids = new Set(nodes.map(n => n.id))
    const links = data.links.filter(l => {
      const s = typeof l.source === 'string' ? l.source : l.source.id
      const t = typeof l.target === 'string' ? l.target : l.target.id
      return ids.has(s) && ids.has(t)
    })
    return { nodes, links }
  }, [data, filters])

  const handleNodeClick = useCallback((raw: any) => {
    const node = raw as KGNode
    setSelectedNode(node)
    const fg = fgRef.current
    if (fg && node.x !== undefined && node.y !== undefined && node.z !== undefined) {
      const distance = 120
      const distRatio = 1 + distance / Math.hypot(node.x, node.y, node.z || 1)
      fg.cameraPosition(
        { x: node.x * distRatio, y: node.y * distRatio, z: (node.z || 1) * distRatio },
        { x: node.x, y: node.y, z: node.z },
        1500,
      )
    }
  }, [])

  const exportJSON = () => {
    if (!data) return
    const blob = new Blob([JSON.stringify(data, null, 2)],
      { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `project-${projectId}-kg.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (error) {
    return (
      <div className="glass-card p-6 text-sm text-red-300">
        <div className="flex items-center gap-2 mb-2">
          <FiInfo className="w-4 h-4" />
          <span className="font-medium">Unable to load project KG</span>
        </div>
        <p className="text-xs text-[var(--color-text-muted)]">{error}</p>
        <button onClick={load} className="mt-3 btn btn-secondary text-xs">
          <FiRefreshCw className="w-3 h-3" /> Retry
        </button>
      </div>
    )
  }

  return (
    <div className={clsx(
      'relative rounded-lg overflow-hidden border border-[var(--color-border)] bg-[var(--color-bg)]',
      fullscreen && 'fixed inset-4 z-50 shadow-2xl',
    )}
         style={fullscreen ? undefined : { height }}>
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm z-10">
          <div className="text-xs text-[var(--color-text-muted)]">
            Loading project knowledge graph…
          </div>
        </div>
      )}

      {/* 3D viewport */}
      <ForceGraph3D
        ref={fgRef}
        graphData={filtered}
        backgroundColor="#0b0f14"
        nodeLabel={(n: any) => `
          <div style="background:#14181f;color:#e8eef5;padding:6px 10px;
            border:1px solid #2a3240;border-radius:6px;font-size:11px">
            <b>${escapeHtml(n.name)}</b><br/>
            <span style="color:#8a99b3">${n.kind} · ${n.scope}</span>
          </div>
        `}
        nodeColor={(n: any) => n.color}
        nodeVal={(n: any) => n.size || 4}
        nodeRelSize={4}
        nodeOpacity={0.92}
        linkColor={(l: any) => l.color}
        linkWidth={(l: any) => Math.max(1, (l.confidence || 0.5) * 2)}
        linkOpacity={0.55}
        linkDirectionalParticles={1}
        linkDirectionalParticleWidth={1.2}
        linkDirectionalParticleSpeed={0.005}
        onNodeClick={handleNodeClick}
        enableNodeDrag
        enableNavigationControls
        showNavInfo={false}
      />

      {/* Top-right controls */}
      <div className="absolute top-3 right-3 flex flex-col gap-2 z-20">
        <button
          onClick={() => setFullscreen(f => !f)}
          title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          className="p-2 rounded-md bg-white/5 hover:bg-white/15 text-[var(--color-text)]"
        >
          {fullscreen ? <FiMinimize2 className="w-3.5 h-3.5" /> : <FiMaximize2 className="w-3.5 h-3.5" />}
        </button>
        <button
          onClick={load}
          title="Reload"
          className="p-2 rounded-md bg-white/5 hover:bg-white/15 text-[var(--color-text)]"
        >
          <FiRefreshCw className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={exportJSON}
          title="Export JSON"
          className="p-2 rounded-md bg-white/5 hover:bg-white/15 text-[var(--color-text)]"
        >
          <FiDownload className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => setShowControls(s => !s)}
          title="Settings"
          className="p-2 rounded-md bg-white/5 hover:bg-white/15 text-[var(--color-text)]"
        >
          <FiSettings className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Stats strip */}
      {data && (
        <div className="absolute top-3 left-3 flex gap-2 z-20 text-[10px]">
          <StatChip label="nodes" value={data.stats.nodes} />
          <StatChip label="edges" value={data.stats.edges} />
          <StatChip label="private" value={data.stats.project_private} dot="#E69F00" />
          <StatChip label="common" value={data.stats.project_common} dot="#CC79A7" />
          <StatChip label="public" value={data.stats.public_domain} dot="#56B4E9" />
        </div>
      )}

      {/* Filter controls */}
      {showControls && data && (
        <div className="absolute bottom-3 left-3 bg-[var(--color-bg-elevated)]/95 backdrop-blur-sm rounded-lg px-3 py-2 z-20 text-xs border border-[var(--color-border)]">
          <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] mb-1">
            Scope
          </div>
          <div className="flex gap-3">
            {([
              ['privatE',       'Private',    '#E69F00'],
              ['common',        'Common',     '#CC79A7'],
              ['public_domain', 'Public',     '#56B4E9'],
            ] as const).map(([k, l, c]) => (
              <label key={k} className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={(filters as any)[k]}
                  onChange={e =>
                    setFilters(f => ({ ...f, [k]: e.target.checked }))
                  }
                />
                <span className="w-2 h-2 rounded-full" style={{ background: c }} />
                <span>{l}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Selected-node drawer */}
      {selectedNode && (
        <div className="absolute bottom-3 right-3 w-80 max-h-[50%] overflow-y-auto bg-[var(--color-bg-elevated)]/95 backdrop-blur-sm rounded-lg p-3 z-20 text-xs border border-[var(--color-border)]">
          <div className="flex justify-between items-start mb-2">
            <div>
              <div className="font-semibold text-[var(--color-text)] text-sm">
                {selectedNode.name}
              </div>
              <div className="flex gap-2 mt-1 text-[10px] text-[var(--color-text-muted)]">
                <span className="px-1.5 py-0.5 rounded bg-white/10">
                  {selectedNode.kind}
                </span>
                <span className="px-1.5 py-0.5 rounded bg-white/10">
                  {selectedNode.scope}
                </span>
              </div>
            </div>
            <button
              onClick={() => setSelectedNode(null)}
              className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              ✕
            </button>
          </div>
          {selectedNode.canonical_id && (
            <div className="text-[10px] text-[var(--color-text-muted)] mb-2 font-mono break-all">
              {selectedNode.canonical_id}
            </div>
          )}
          {selectedNode.payload && Object.keys(selectedNode.payload).length > 0 && (
            <div className="space-y-1">
              {Object.entries(selectedNode.payload).slice(0, 12).map(([k, v]) => (
                <div key={k} className="text-[10px]">
                  <span className="text-[var(--color-text-muted)]">{k}:</span>{' '}
                  <span className="text-[var(--color-text)] break-words">
                    {typeof v === 'object' ? JSON.stringify(v).slice(0, 120) : String(v).slice(0, 200)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function StatChip({
  label, value, dot,
}: { label: string; value: number; dot?: string }) {
  return (
    <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--color-bg-elevated)]/80 backdrop-blur-sm border border-[var(--color-border)]">
      {dot && <span className="w-1.5 h-1.5 rounded-full" style={{ background: dot }} />}
      <span className="text-[var(--color-text-muted)]">{label}</span>
      <span className="text-[var(--color-text)] font-medium tabular-nums">{value}</span>
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
