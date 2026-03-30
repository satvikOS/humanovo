import { useState, useEffect, useRef, useCallback } from 'react'
import {
  FiSearch, FiPlus, FiTrash2, FiZoomIn, FiZoomOut, FiMaximize2,
  FiLink,
} from 'react-icons/fi'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'
import { logActivity } from '../utils/persistence'

interface GNode { id: string; name: string; type: string; description: string; created_at: string }
interface GEdge { id: string; source: string; target: string; source_name: string; target_name: string; relationship: string; strength: number; evidence: string }

const TYPE_COLORS: Record<string, string> = {
  gene: '#3b82f6', protein: '#22c55e', pathway: '#8b5cf6',
  disease: '#ef4444', drug: '#f97316',
}

const API = '/api/v1/knowledge-graph'

export default function KnowledgeGraphViewer() {
  const [nodes, setNodes] = useState<GNode[]>([])
  const [edges, setEdges] = useState<GEdge[]>([])
  const [selected, setSelected] = useState<GNode | null>(null)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [newNode, setNewNode] = useState({ name: '', type: 'gene', description: '' })
  const [stats, setStats] = useState<any>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [nodePositions, setNodePositions] = useState<Map<string, { x: number; y: number }>>(new Map())
  const dragRef = useRef<{ id: string; ox: number; oy: number } | null>(null)
  const panRef = useRef(false)
  const lastRef = useRef({ x: 0, y: 0 })

  const load = async () => {
    try {
      const [nR, eR, sR] = await Promise.all([fetch(`${API}/nodes`), fetch(`${API}/edges`), fetch(`${API}/stats`)])
      if (nR.ok) setNodes((await nR.json()).items || [])
      if (eR.ok) setEdges((await eR.json()).items || [])
      if (sR.ok) setStats(await sR.json())
    } catch { /* ignore */ }
  }
  useEffect(() => { load() }, [])

  useEffect(() => {
    if (nodes.length === 0) return
    const positions = new Map<string, { x: number; y: number }>()
    const groups: Record<string, GNode[]> = {}
    nodes.forEach(n => { (groups[n.type] = groups[n.type] || []).push(n) })
    const types = Object.keys(groups)
    const cx = 400, cy = 300
    types.forEach((type, ti) => {
      const angle = (2 * Math.PI * ti) / types.length
      const gcx = cx + Math.cos(angle) * 180
      const gcy = cy + Math.sin(angle) * 150
      groups[type].forEach((node, ni) => {
        const a2 = (2 * Math.PI * ni) / groups[type].length
        const r = 40 + groups[type].length * 8
        positions.set(node.id, { x: gcx + Math.cos(a2) * r, y: gcy + Math.sin(a2) * r })
      })
    })
    setNodePositions(positions)
  }, [nodes])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * 2; canvas.height = rect.height * 2
    ctx.scale(2, 2); ctx.clearRect(0, 0, rect.width, rect.height)
    ctx.save(); ctx.translate(pan.x, pan.y); ctx.scale(zoom, zoom)

    const filtered = typeFilter ? nodes.filter(n => n.type === typeFilter) : nodes
    const fIds = new Set(filtered.map(n => n.id))

    edges.forEach(e => {
      if (!fIds.has(e.source) && !fIds.has(e.target)) return
      const f = nodePositions.get(e.source), t = nodePositions.get(e.target)
      if (!f || !t) return
      ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(t.x, t.y)
      ctx.strokeStyle = `rgba(148,163,184,${0.2 + e.strength * 0.4})`
      ctx.lineWidth = 1 + e.strength; ctx.stroke()
      ctx.fillStyle = 'rgba(148,163,184,0.6)'; ctx.font = '8px sans-serif'; ctx.textAlign = 'center'
      ctx.fillText(e.relationship, (f.x + t.x) / 2, (f.y + t.y) / 2 - 4)
    })

    filtered.forEach(node => {
      const pos = nodePositions.get(node.id)
      if (!pos) return
      const color = TYPE_COLORS[node.type] || '#94a3b8'
      const isSel = selected?.id === node.id
      const r = isSel ? 16 : 12
      ctx.beginPath(); ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2)
      ctx.fillStyle = color + (isSel ? 'ff' : '99'); ctx.fill()
      if (isSel) { ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke() }
      ctx.fillStyle = '#e2e8f0'; ctx.font = `${isSel ? 10 : 9}px sans-serif`; ctx.textAlign = 'center'
      ctx.fillText(node.name, pos.x, pos.y + r + 12)
    })
    ctx.restore()
  }, [nodes, edges, nodePositions, zoom, pan, selected, typeFilter])

  useEffect(() => { draw() }, [draw])

  const getWorldPos = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: (e.clientX - rect.left - pan.x) / zoom, y: (e.clientY - rect.top - pan.y) / zoom }
  }

  const findNodeAt = (wx: number, wy: number) => {
    for (const n of nodes) {
      const p = nodePositions.get(n.id)
      if (p && (p.x - wx) ** 2 + (p.y - wy) ** 2 < 256) return n
    }
    return null
  }

  const handleClick = (e: React.MouseEvent) => { const w = getWorldPos(e); setSelected(findNodeAt(w.x, w.y)) }
  const handleDown = (e: React.MouseEvent) => {
    const w = getWorldPos(e)
    const n = findNodeAt(w.x, w.y)
    if (n) { const p = nodePositions.get(n.id)!; dragRef.current = { id: n.id, ox: p.x - w.x, oy: p.y - w.y }; return }
    panRef.current = true; lastRef.current = { x: e.clientX, y: e.clientY }
  }
  const handleMove = (e: React.MouseEvent) => {
    if (dragRef.current) {
      const w = getWorldPos(e)
      setNodePositions(prev => { const m = new Map(prev); m.set(dragRef.current!.id, { x: w.x + dragRef.current!.ox, y: w.y + dragRef.current!.oy }); return m })
    } else if (panRef.current) {
      setPan(p => ({ x: p.x + e.clientX - lastRef.current.x, y: p.y + e.clientY - lastRef.current.y }))
      lastRef.current = { x: e.clientX, y: e.clientY }
    }
  }
  const handleUp = () => { dragRef.current = null; panRef.current = false }
  const handleWheel = (e: React.WheelEvent) => { e.preventDefault(); setZoom(z => Math.max(0.3, Math.min(3, z - e.deltaY * 0.001))) }

  const addNode = async () => {
    if (!newNode.name.trim()) return
    const res = await fetch(`${API}/nodes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newNode) })
    if (res.ok) { logActivity({ type: 'discovery', action: 'created', title: `Added node: ${newNode.name} (${newNode.type})` }); setNewNode({ name: '', type: 'gene', description: '' }); setShowAdd(false); load() }
  }

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const deleteNode = (id: string) => { setDeleteConfirmId(id) }

  const confirmDeleteNode = async () => {
    if (!deleteConfirmId) return
    const deletedNode = nodes.find(n => n.id === deleteConfirmId)
    await fetch(`${API}/nodes/${deleteConfirmId}`, { method: 'DELETE' })
    if (selected?.id === deleteConfirmId) setSelected(null)
    logActivity({ type: 'discovery', action: 'deleted', title: `Deleted node: ${deletedNode?.name || deleteConfirmId}` })
    setDeleteConfirmId(null)
    load()
  }

  const searchNodes = async () => {
    if (!search.trim()) { load(); return }
    const res = await fetch(`${API}/nodes?search=${encodeURIComponent(search)}`)
    if (res.ok) setNodes((await res.json()).items || [])
  }

  const connEdges = selected ? edges.filter(e => e.source === selected.id || e.target === selected.id) : []

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="p-6 border-b border-[var(--color-border)]">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Knowledge Graph</h1>
            <p className="text-sm text-[var(--color-text-muted)] mt-1">
              Explore biomedical entities and relationships
              {stats && <span className="ml-2">({stats.total_nodes} nodes, {stats.total_edges} edges)</span>}
            </p>
          </div>
          <button onClick={() => setShowAdd(!showAdd)} className="btn text-sm" style={{ color: 'var(--color-accent-blue)' }}><FiPlus className="w-4 h-4" /> Add Node</button>
        </div>
        <div className="flex gap-2 mt-3">
          <div className="relative flex-1 max-w-xs">
            <FiSearch className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-[var(--color-text-muted)]" />
            <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && searchNodes()} placeholder="Search nodes..." className="input w-full text-xs pl-8" />
          </div>
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="input text-xs w-32">
            <option value="">All Types</option>
            {Object.keys(TYPE_COLORS).map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <div className="flex gap-1 ml-2">
            <button onClick={() => setZoom(z => Math.min(3, z + 0.2))} className="btn text-xs"><FiZoomIn className="w-3.5 h-3.5" /></button>
            <button onClick={() => setZoom(z => Math.max(0.3, z - 0.2))} className="btn text-xs"><FiZoomOut className="w-3.5 h-3.5" /></button>
            <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }} className="btn text-xs"><FiMaximize2 className="w-3.5 h-3.5" /></button>
          </div>
        </div>
      </div>

      {showAdd && (
        <div className="p-4 border-b border-[var(--color-border)] bg-[var(--glass-bg)]">
          <div className="max-w-xl mx-auto flex gap-2">
            <input value={newNode.name} onChange={e => setNewNode(n => ({ ...n, name: e.target.value }))} placeholder="Node name *" className="input flex-1 text-xs" />
            <select value={newNode.type} onChange={e => setNewNode(n => ({ ...n, type: e.target.value }))} className="input text-xs w-28">
              {Object.keys(TYPE_COLORS).map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <input value={newNode.description} onChange={e => setNewNode(n => ({ ...n, description: e.target.value }))} placeholder="Description" className="input flex-1 text-xs" />
            <button onClick={addNode} disabled={!newNode.name.trim()} className="btn text-xs" style={{ color: 'var(--color-success)' }}>Add</button>
            <button onClick={() => setShowAdd(false)} className="btn text-xs text-[var(--color-text-muted)]">Cancel</button>
          </div>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 relative">
          <canvas ref={canvasRef} className="w-full h-full cursor-grab active:cursor-grabbing"
            onClick={handleClick} onMouseDown={handleDown} onMouseMove={handleMove} onMouseUp={handleUp} onMouseLeave={handleUp} onWheel={handleWheel} />
          <div className="absolute bottom-4 left-4 glass-card p-3 flex gap-3">
            {Object.entries(TYPE_COLORS).map(([type, color]) => (
              <div key={type} className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-full" style={{ background: color }} /><span className="text-xxs capitalize">{type}</span></div>
            ))}
          </div>
        </div>

        {selected && (
          <div className="w-72 border-l border-[var(--color-border)] overflow-y-auto p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded-full" style={{ background: TYPE_COLORS[selected.type] || '#94a3b8' }} />
                <span className="text-xs font-medium capitalize">{selected.type}</span>
              </div>
              <button onClick={() => deleteNode(selected.id)} className="p-1.5 rounded hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)] hover:text-[var(--color-error)]">
                <FiTrash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <h3 className="text-sm font-semibold">{selected.name}</h3>
            {selected.description && <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">{selected.description}</p>}
            <div>
              <h4 className="text-xs font-medium text-[var(--color-text-muted)] mb-2 flex items-center gap-1"><FiLink className="w-3 h-3" /> Relationships ({connEdges.length})</h4>
              <div className="space-y-1.5">
                {connEdges.map(e => (
                  <div key={e.id} className="p-2 rounded bg-[var(--glass-bg)] text-xxs">
                    <div className="font-medium">{e.source === selected.id ? e.target_name : e.source_name}</div>
                    <div className="text-[var(--color-text-muted)]">{e.source === selected.id ? '→' : '←'} {e.relationship} (strength: {e.strength})</div>
                    {e.evidence && <div className="text-[var(--color-text-muted)] mt-0.5 italic">{e.evidence}</div>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {deleteConfirmId && (
        <ConfirmDeleteDialog
          title="Delete Graph Node?"
          message="This will permanently delete this node and all its connections. This action cannot be undone."
          onConfirm={confirmDeleteNode}
          onCancel={() => setDeleteConfirmId(null)}
        />
      )}
    </div>
  )
}
