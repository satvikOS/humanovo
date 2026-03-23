import { useState, useEffect, useRef } from 'react'
import { FiImage, FiPlus, FiTrash2, FiZoomIn, FiZoomOut, FiCpu, FiSquare, FiCircle, FiType } from 'react-icons/fi'

interface Study { id: string; title: string; modality: string; body_part: string; findings: string; status: string; annotations: Annotation[]; ai_analysis: any; width: number; height: number }
interface Annotation { id: string; type: string; x: number; y: number; width: number; height: number; label: string; color: string; notes: string }

const API = '/api/v1/imaging'

export default function ResearchImaging() {
  const [studies, setStudies] = useState<Study[]>([])
  const [selected, setSelected] = useState<Study | null>(null)
  const [analysis, setAnalysis] = useState<any>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ title: '', modality: 'CT', body_part: '', findings: '' })
  const [annotTool, setAnnotTool] = useState<'rectangle' | 'circle' | 'label'>('rectangle')
  const [annotLabel, setAnnotLabel] = useState('')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [zoom, setZoom] = useState(1)

  const load = async () => { try { const r = await fetch(`${API}/studies`); if (r.ok) setStudies((await r.json()).items || []) } catch {} }
  useEffect(() => { load() }, [])

  const selectStudy = (s: Study) => { setSelected(s); setAnalysis(null) }

  const createStudy = async () => {
    if (!form.title.trim()) return
    const r = await fetch(`${API}/studies`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    if (r.ok) { load(); setShowAdd(false); setForm({ title: '', modality: 'CT', body_part: '', findings: '' }) }
  }

  const deleteStudy = async (id: string) => {
    await fetch(`${API}/studies/${id}`, { method: 'DELETE' })
    if (selected?.id === id) setSelected(null); load()
  }

  const runAnalysis = async () => {
    if (!selected) return
    const r = await fetch(`${API}/studies/${selected.id}/analysis`)
    if (r.ok) setAnalysis(await r.json())
  }

  const addAnnotation = async (e: React.MouseEvent) => {
    if (!selected || !canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    const x = (e.clientX - rect.left) / zoom
    const y = (e.clientY - rect.top) / zoom
    const data = { type: annotTool, x, y, width: annotTool === 'label' ? 0 : 50, height: annotTool === 'label' ? 0 : 50, label: annotLabel || annotTool, color: '#ef4444', notes: '' }
    const r = await fetch(`${API}/studies/${selected.id}/annotate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
    if (r.ok) {
      const annot = await r.json()
      setSelected(prev => prev ? { ...prev, annotations: [...prev.annotations, annot] } : null)
    }
  }

  // Draw canvas
  useEffect(() => {
    if (!canvasRef.current || !selected) return
    const ctx = canvasRef.current.getContext('2d')
    if (!ctx) return
    const w = 512, h = 512
    canvasRef.current.width = w; canvasRef.current.height = h

    // Dark background with grid (simulated image)
    ctx.fillStyle = '#1a1a2e'; ctx.fillRect(0, 0, w, h)
    ctx.strokeStyle = '#ffffff10'; ctx.lineWidth = 0.5
    for (let i = 0; i < w; i += 32) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, h); ctx.stroke() }
    for (let i = 0; i < h; i += 32) { ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(w, i); ctx.stroke() }

    // Simulated anatomical shapes
    ctx.fillStyle = '#ffffff15'; ctx.beginPath(); ctx.ellipse(256, 256, 150, 200, 0, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#ffffff08'; ctx.beginPath(); ctx.ellipse(200, 200, 40, 50, 0, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.ellipse(312, 200, 40, 50, 0, 0, Math.PI * 2); ctx.fill()

    // Draw annotations
    selected.annotations.forEach(a => {
      ctx.strokeStyle = a.color; ctx.lineWidth = 2
      if (a.type === 'rectangle') { ctx.strokeRect(a.x, a.y, a.width, a.height) }
      else if (a.type === 'circle') { ctx.beginPath(); ctx.ellipse(a.x + a.width / 2, a.y + a.height / 2, a.width / 2, a.height / 2, 0, 0, Math.PI * 2); ctx.stroke() }
      if (a.label) { ctx.fillStyle = a.color; ctx.font = '11px sans-serif'; ctx.fillText(a.label, a.x, a.y - 4) }
    })
  }, [selected, zoom])

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="p-6 border-b border-[var(--color-border)]">
        <div className="flex items-center justify-between mb-2">
          <div><h1 className="text-2xl font-semibold tracking-tight">Research Imaging</h1><p className="text-sm text-[var(--color-text-muted)] mt-1">Image viewer, annotations, and AI-assisted analysis</p></div>
          <button onClick={() => setShowAdd(!showAdd)} className="btn text-sm" style={{ color: 'var(--color-accent-blue)' }}><FiPlus className="w-4 h-4" /> New Study</button>
        </div>
      </div>

      {showAdd && (
        <div className="p-4 border-b border-[var(--color-border)] bg-[var(--glass-bg)]">
          <div className="max-w-xl mx-auto flex gap-2">
            <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Study title *" className="input flex-1 text-xs" />
            <select value={form.modality} onChange={e => setForm(f => ({ ...f, modality: e.target.value }))} className="input text-xs w-32">
              {['CT', 'MRI', 'X-Ray', 'Ultrasound', 'Mammography', 'Histopathology', 'PET'].map(m => <option key={m}>{m}</option>)}
            </select>
            <input value={form.body_part} onChange={e => setForm(f => ({ ...f, body_part: e.target.value }))} placeholder="Body part" className="input w-28 text-xs" />
            <button onClick={createStudy} disabled={!form.title.trim()} className="btn text-xs" style={{ color: 'var(--color-success)' }}>Create</button>
            <button onClick={() => setShowAdd(false)} className="btn text-xs text-[var(--color-text-muted)]">Cancel</button>
          </div>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        <div className="w-64 border-r border-[var(--color-border)] overflow-y-auto p-3 space-y-1">
          {studies.map(s => (
            <div key={s.id} onClick={() => selectStudy(s)}
              className={`p-3 rounded-lg cursor-pointer group transition-colors ${selected?.id === s.id ? 'bg-[var(--glass-bg)] border border-[var(--color-border)]' : 'hover:bg-[var(--glass-bg)]'}`}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium truncate">{s.title}</span>
                <button onClick={e => { e.stopPropagation(); deleteStudy(s.id) }} className="opacity-0 group-hover:opacity-100 p-1"><FiTrash2 className="w-3 h-3" /></button>
              </div>
              <div className="text-xxs text-[var(--color-text-muted)] mt-0.5">{s.modality} | {s.body_part}</div>
            </div>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {!selected ? (
            <div className="text-center py-16 text-[var(--color-text-muted)]"><FiImage className="w-12 h-12 mx-auto mb-4 opacity-20" /><p className="text-sm">Select a study</p></div>
          ) : (
            <div className="max-w-4xl mx-auto">
              <div className="flex items-center justify-between mb-4">
                <div><h2 className="text-lg font-semibold">{selected.title}</h2><p className="text-xs text-[var(--color-text-muted)]">{selected.modality} | {selected.body_part} | {selected.annotations.length} annotations</p></div>
                <div className="flex gap-1">
                  <button onClick={() => setZoom(z => Math.min(3, z + 0.2))} className="btn text-xs"><FiZoomIn className="w-3.5 h-3.5" /></button>
                  <button onClick={() => setZoom(z => Math.max(0.5, z - 0.2))} className="btn text-xs"><FiZoomOut className="w-3.5 h-3.5" /></button>
                  <button onClick={runAnalysis} className="btn text-xs" style={{ color: 'var(--color-accent-blue)' }}><FiCpu className="w-3.5 h-3.5" /> AI Analysis</button>
                </div>
              </div>

              {/* Annotation toolbar */}
              <div className="flex gap-2 mb-3">
                {([['rectangle', FiSquare, 'Rectangle'], ['circle', FiCircle, 'Circle'], ['label', FiType, 'Label']] as [string, any, string][]).map(([tool, Icon, label]) => (
                  <button key={tool} onClick={() => setAnnotTool(tool as any)}
                    className={`flex items-center gap-1 px-2 py-1 rounded text-xxs ${annotTool === tool ? 'bg-[var(--glass-bg)] border border-[var(--color-border)]' : 'text-[var(--color-text-muted)]'}`}>
                    <Icon className="w-3 h-3" /> {label}
                  </button>
                ))}
                <input value={annotLabel} onChange={e => setAnnotLabel(e.target.value)} placeholder="Label text" className="input text-xxs w-32 ml-2" />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2">
                  <div className="glass-card p-2 overflow-hidden" style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}>
                    <canvas ref={canvasRef} className="w-full cursor-crosshair" onClick={addAnnotation} style={{ imageRendering: 'pixelated' }} />
                  </div>
                </div>

                <div className="space-y-3">
                  {selected.findings && (
                    <div className="glass-card p-3"><h4 className="text-xs font-medium mb-1">Findings</h4><p className="text-xxs text-[var(--color-text-muted)] leading-relaxed">{selected.findings}</p></div>
                  )}

                  {analysis && (
                    <div className="glass-card p-3">
                      <h4 className="text-xs font-medium mb-2">AI Analysis</h4>
                      <p className="text-xxs text-[var(--color-text-muted)] mb-2">Model: {analysis.model} | Confidence: {(analysis.confidence * 100).toFixed(0)}%</p>
                      {analysis.findings?.map((f: any, i: number) => (
                        <div key={i} className={`p-2 rounded mb-1 text-xxs ${f.severity === 'high' ? 'bg-red-500/10 border border-red-500/20' : f.severity === 'moderate' ? 'bg-yellow-500/10 border border-yellow-500/20' : 'bg-[var(--glass-bg)]'}`}>
                          <div className="font-medium">{f.region}: {f.finding}</div>
                          <div className="text-[var(--color-text-muted)]">Confidence: {(f.confidence * 100).toFixed(0)}% | Severity: {f.severity}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {selected.annotations.length > 0 && (
                    <div className="glass-card p-3">
                      <h4 className="text-xs font-medium mb-2">Annotations</h4>
                      {selected.annotations.map(a => (
                        <div key={a.id} className="flex items-center justify-between py-1 text-xxs">
                          <span><span className="w-2 h-2 rounded-full inline-block mr-1" style={{ background: a.color }} />{a.label || a.type}</span>
                          <span className="text-[var(--color-text-muted)]">({Math.round(a.x)},{Math.round(a.y)})</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
