// ═══════════════════════════════════════════════════════════════════════
// Compute Lab — Imaging Panel
// Compact, embedded viewer for the Research Imaging studies stored in
// localStorage. Lets users pan/zoom, window/level, and flip quickly
// through the studies they already have without leaving Compute Lab.
// Imaging state mutations made by the script runtime (via the
// `imaging_*` builtins) land here through the shared `IMAGING_EVENT`
// custom event.
// ═══════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const STORAGE_KEY = 'research-imaging-studies'
export const IMAGING_EVENT = 'compute-imaging-update'

interface Study {
  id: string
  title: string
  modality: string
  bodyPart: string
  patientId: string
  acquiredAt: string
  imageData: string
  width: number
  height: number
  windowCenter: number
  windowWidth: number
  filter?: string
  annotations?: unknown[]
  notes?: string
}

function loadStudies(): Study[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') } catch { return [] }
}

function saveStudies(s: Study[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)) } catch { /* quota */ }
}

const presetsByModality: Record<string, { label: string; c: number; w: number }[]> = {
  CT: [
    { label: 'Bone', c: 300, w: 1500 },
    { label: 'Lung', c: -500, w: 1500 },
    { label: 'Brain', c: 40, w: 80 },
    { label: 'Abdomen', c: 40, w: 400 },
  ],
  MRI: [
    { label: 'Brain', c: 600, w: 1200 },
    { label: 'T1', c: 500, w: 1000 },
  ],
}

export default function ImagingPanel({ visible }: { visible: boolean }) {
  const [studies, setStudies] = useState<Study[]>(loadStudies)
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const s = loadStudies()
    return s.length > 0 ? s[s.length - 1].id : null
  })
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState<{ x: number; y: number } | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)

  // Re-read studies when the window gains focus (Imaging page changed) and
  // when the compute runtime fires the custom IMAGING_EVENT (script set W/L,
  // selected a study, etc.).
  useEffect(() => {
    const refresh = () => {
      const next = loadStudies()
      setStudies(next)
      setSelectedId(prev => {
        if (prev && next.some(x => x.id === prev)) return prev
        return next.length > 0 ? next[next.length - 1].id : null
      })
    }
    const onEvent = (e: Event) => {
      refresh()
      const detail = (e as CustomEvent<{ selectId?: string }>).detail
      if (detail?.selectId) setSelectedId(detail.selectId)
    }
    window.addEventListener('focus', refresh)
    window.addEventListener('storage', refresh)
    window.addEventListener(IMAGING_EVENT, onEvent)
    return () => {
      window.removeEventListener('focus', refresh)
      window.removeEventListener('storage', refresh)
      window.removeEventListener(IMAGING_EVENT, onEvent)
    }
  }, [])

  const selected = useMemo(
    () => studies.find(s => s.id === selectedId) ?? null,
    [studies, selectedId],
  )

  // Load the image once per selection.
  useEffect(() => {
    if (!selected) { imgRef.current = null; return }
    const img = new Image()
    img.onload = () => { imgRef.current = img; render() }
    img.src = selected.imageData
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, selected?.imageData])

  const render = useCallback(() => {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img || !selected) return
    const parent = canvas.parentElement
    if (!parent) return
    const cw = parent.clientWidth
    const ch = parent.clientHeight
    canvas.width = cw
    canvas.height = ch
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#05060a'
    ctx.fillRect(0, 0, cw, ch)

    // Fit to panel + zoom + pan.
    const fit = Math.min(cw / img.width, ch / img.height)
    const scale = fit * zoom
    const drawW = img.width * scale
    const drawH = img.height * scale
    const dx = (cw - drawW) / 2 + pan.x
    const dy = (ch - drawH) / 2 + pan.y

    // Draw base image.
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(img, dx, dy, drawW, drawH)

    // Apply window/level via pixel manipulation on the drawn region.
    const wc = selected.windowCenter
    const ww = Math.max(1, selected.windowWidth)
    const isDefault = wc === 128 && ww === 256
    if (!isDefault) {
      try {
        const sx = Math.max(0, Math.floor(dx))
        const sy = Math.max(0, Math.floor(dy))
        const sw = Math.min(cw - sx, Math.ceil(drawW))
        const sh = Math.min(ch - sy, Math.ceil(drawH))
        if (sw > 0 && sh > 0) {
          const region = ctx.getImageData(sx, sy, sw, sh)
          const d = region.data
          const lo = wc - ww / 2
          const hi = wc + ww / 2
          const denom = hi - lo || 1
          for (let i = 0; i < d.length; i += 4) {
            for (let k = 0; k < 3; k++) {
              const v = d[i + k]
              const nv = ((v - lo) * 255) / denom
              d[i + k] = Math.max(0, Math.min(255, nv))
            }
          }
          ctx.putImageData(region, sx, sy)
        }
      } catch { /* cross-origin / out of bounds */ }
    }
  }, [selected, zoom, pan])

  useEffect(() => {
    if (!visible) return
    render()
  }, [render, visible])

  useEffect(() => {
    if (!visible) return
    const ro = new ResizeObserver(() => render())
    if (canvasRef.current?.parentElement) ro.observe(canvasRef.current.parentElement)
    return () => ro.disconnect()
  }, [render, visible])

  const updateWL = useCallback((wc: number, ww: number) => {
    if (!selected) return
    setStudies(prev => {
      const next = prev.map(s => s.id === selected.id ? { ...s, windowCenter: wc, windowWidth: ww } : s)
      saveStudies(next)
      return next
    })
  }, [selected])

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const delta = -e.deltaY / 500
    setZoom(z => Math.max(0.25, Math.min(8, z * (1 + delta))))
  }, [])

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    setDragging({ x: e.clientX - pan.x, y: e.clientY - pan.y })
  }, [pan])

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return
    setPan({ x: e.clientX - dragging.x, y: e.clientY - dragging.y })
  }, [dragging])

  const onMouseUp = useCallback(() => setDragging(null), [])

  const resetView = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }) }, [])

  if (!visible) return null

  if (studies.length === 0) {
    return (
      <div style={emptyWrap}>
        <div style={emptyCard}>
          <div style={{ fontSize: 32, lineHeight: 1, marginBottom: 10 }}>◈</div>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text)' }}>No imaging studies</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 6, maxWidth: 320, textAlign: 'center' }}>
            Upload DICOM / JPEG / PNG files on the Imaging page, or call{' '}
            <code style={codeMini}>imaging_upload(url)</code> from a script.
            New studies appear here automatically.
          </div>
          <a href="/imaging" style={linkBtn}>Open Imaging →</a>
        </div>
      </div>
    )
  }

  return (
    <div style={wrap}>
      {/* Toolbar */}
      <div style={toolbar}>
        <select
          value={selectedId ?? ''}
          onChange={e => setSelectedId(e.target.value || null)}
          style={selectStyle}
          title="Select study"
        >
          {studies.map(s => (
            <option key={s.id} value={s.id}>
              {s.title || s.modality} — {s.bodyPart || '–'} ({s.width}×{s.height})
            </option>
          ))}
        </select>
        <span style={sep} />
        <button type="button" style={chip} onClick={() => setZoom(z => Math.min(8, z * 1.25))} title="Zoom in">+</button>
        <button type="button" style={chip} onClick={() => setZoom(z => Math.max(0.25, z / 1.25))} title="Zoom out">−</button>
        <button type="button" style={chip} onClick={resetView} title="Reset view">1:1</button>
        <span style={zoomLbl}>{Math.round(zoom * 100)}%</span>
        <span style={{ flex: 1 }} />
        {selected && presetsByModality[selected.modality]?.map(p => (
          <button
            key={p.label}
            type="button"
            style={chip}
            onClick={() => updateWL(p.c, p.w)}
            title={`W/L preset: ${p.label} (C ${p.c} / W ${p.w})`}
          >{p.label}</button>
        ))}
        <a href="/imaging" style={openFull} title="Open full Imaging workstation">Full view →</a>
      </div>

      {/* Viewer */}
      <div
        style={viewer}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      >
        <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%', cursor: dragging ? 'grabbing' : 'grab' }} />
        {selected && (
          <div style={overlay}>
            <div style={{ fontSize: 11, fontWeight: 500 }}>{selected.title || selected.modality}</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)' }}>
              {selected.modality} · {selected.bodyPart || '–'} · {selected.width}×{selected.height}
            </div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)', marginTop: 4 }}>
              C {Math.round(selected.windowCenter)} / W {Math.round(selected.windowWidth)}
            </div>
          </div>
        )}
      </div>

      {/* W/L sliders */}
      {selected && (
        <div style={sliders}>
          <label style={sliderLbl}>
            <span>Center</span>
            <input
              type="range"
              min={-1024}
              max={3072}
              value={selected.windowCenter}
              onChange={e => updateWL(parseInt(e.target.value, 10), selected.windowWidth)}
              style={slider}
            />
            <span style={numVal}>{Math.round(selected.windowCenter)}</span>
          </label>
          <label style={sliderLbl}>
            <span>Width</span>
            <input
              type="range"
              min={1}
              max={4096}
              value={selected.windowWidth}
              onChange={e => updateWL(selected.windowCenter, parseInt(e.target.value, 10))}
              style={slider}
            />
            <span style={numVal}>{Math.round(selected.windowWidth)}</span>
          </label>
        </div>
      )}
    </div>
  )
}

/* ── Styles (iOS-glass aesthetic, matches Workstation styles) ──────── */

const wrap: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  minHeight: 0,
  gap: 10,
  padding: 12,
  boxSizing: 'border-box',
}

const toolbar: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flexWrap: 'wrap',
  padding: '8px 10px',
  background: 'var(--glass-bg)',
  border: '1px solid var(--glass-border)',
  borderRadius: 12,
  backdropFilter: 'blur(10px)',
  WebkitBackdropFilter: 'blur(10px)',
}

const selectStyle: React.CSSProperties = {
  minWidth: 240,
  padding: '5px 10px',
  fontSize: 12,
  background: 'rgba(255,255,255,0.04)',
  color: 'var(--color-text)',
  border: '1px solid var(--glass-border)',
  borderRadius: 8,
  outline: 'none',
}

const chip: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: 11,
  fontWeight: 500,
  background: 'rgba(255,255,255,0.04)',
  color: 'var(--color-text)',
  border: '1px solid var(--glass-border)',
  borderRadius: 8,
  cursor: 'pointer',
}

const sep: React.CSSProperties = {
  width: 1,
  height: 16,
  background: 'var(--glass-border)',
  margin: '0 4px',
}

const zoomLbl: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--color-text-muted)',
  minWidth: 38,
  textAlign: 'center',
}

const openFull: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: 11,
  color: 'var(--color-text-muted)',
  textDecoration: 'none',
  border: '1px solid var(--glass-border)',
  borderRadius: 8,
}

const viewer: React.CSSProperties = {
  position: 'relative',
  flex: 1,
  minHeight: 0,
  background: '#05060a',
  border: '1px solid var(--glass-border)',
  borderRadius: 12,
  overflow: 'hidden',
  userSelect: 'none',
}

const overlay: React.CSSProperties = {
  position: 'absolute',
  top: 10,
  left: 12,
  padding: '6px 10px',
  background: 'rgba(0,0,0,0.55)',
  color: '#fff',
  borderRadius: 8,
  pointerEvents: 'none',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
}

const sliders: React.CSSProperties = {
  display: 'flex',
  gap: 16,
  padding: '8px 10px',
  background: 'var(--glass-bg)',
  border: '1px solid var(--glass-border)',
  borderRadius: 12,
  backdropFilter: 'blur(10px)',
  WebkitBackdropFilter: 'blur(10px)',
}

const sliderLbl: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 11,
  color: 'var(--color-text-muted)',
  flex: 1,
}

const slider: React.CSSProperties = {
  flex: 1,
  accentColor: 'var(--color-text)',
}

const numVal: React.CSSProperties = {
  minWidth: 40,
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
  color: 'var(--color-text)',
}

const emptyWrap: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  padding: 24,
}

const emptyCard: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 6,
  padding: '28px 32px',
  background: 'var(--glass-bg)',
  border: '1px solid var(--glass-border)',
  borderRadius: 14,
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
}

const codeMini: React.CSSProperties = {
  fontFamily: 'var(--font-mono, ui-monospace, monospace)',
  fontSize: 11,
  padding: '1px 6px',
  borderRadius: 4,
  background: 'rgba(255,255,255,0.06)',
  color: 'var(--color-text)',
}

const linkBtn: React.CSSProperties = {
  marginTop: 14,
  padding: '7px 16px',
  fontSize: 12,
  color: 'var(--color-text)',
  textDecoration: 'none',
  border: '1px solid var(--glass-border)',
  borderRadius: 10,
  background: 'rgba(255,255,255,0.04)',
}
