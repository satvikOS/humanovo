// ═══════════════════════════════════════════════════════════════════════
// Research Imaging — Biomedical Imaging Workstation
// Multi-modality viewer with windowing, filters, segmentation,
// measurements, annotations, ROI analysis, and AI-style classification.
// All processing client-side via Canvas API — no backend required.
// ═══════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  FiImage, FiUpload, FiDownload, FiTrash2, FiPlus, FiZoomIn, FiZoomOut,
  FiSquare, FiCircle, FiMaximize2, FiCpu, FiSliders, FiFilter,
  FiTarget, FiActivity, FiLayers, FiCrosshair, FiSearch, FiX, FiSave,
  FiRotateCw, FiEye, FiBarChart2,
} from 'react-icons/fi'
import clsx from 'clsx'

type Modality = 'CT' | 'MRI' | 'X-Ray' | 'Ultrasound' | 'PET' | 'Microscopy' | 'Fundus' | 'OCT' | 'Mammography' | 'Endoscopy'
type Tool = 'pan' | 'window' | 'rect' | 'circle' | 'line' | 'point' | 'polygon' | 'measure' | 'ruler'
type Filter = 'none' | 'invert' | 'sobel' | 'gaussian' | 'sharpen' | 'threshold' | 'histeq' | 'edge'

interface Annotation {
  id: string
  type: 'rect' | 'circle' | 'line' | 'point' | 'measure' | 'ruler'
  x: number; y: number
  w?: number; h?: number
  x2?: number; y2?: number
  label: string
  color: string
  notes?: string
}

interface Study {
  id: string
  title: string
  modality: Modality
  bodyPart: string
  patientId: string
  acquiredAt: string
  imageData: string  // base64 data URL
  width: number
  height: number
  windowCenter: number
  windowWidth: number
  filter: Filter
  annotations: Annotation[]
  notes: string
  pixelSpacing?: number  // mm/px for measurements
}

const STORAGE_KEY = 'research-imaging-studies'

const MODALITIES: { id: Modality; color: string; icon: typeof FiImage; description: string }[] = [
  { id: 'CT', color: '#3b82f6', icon: FiLayers, description: 'Computed Tomography' },
  { id: 'MRI', color: '#8b5cf6', icon: FiActivity, description: 'Magnetic Resonance Imaging' },
  { id: 'X-Ray', color: '#f59e0b', icon: FiEye, description: 'X-Ray Radiography' },
  { id: 'Ultrasound', color: '#06b6d4', icon: FiActivity, description: 'Ultrasonography' },
  { id: 'PET', color: '#ec4899', icon: FiTarget, description: 'Positron Emission Tomography' },
  { id: 'Microscopy', color: '#10b981', icon: FiSearch, description: 'Histology / Microscopy' },
  { id: 'Fundus', color: '#ef4444', icon: FiEye, description: 'Retinal Fundus Photography' },
  { id: 'OCT', color: '#6366f1', icon: FiLayers, description: 'Optical Coherence Tomography' },
  { id: 'Mammography', color: '#f97316', icon: FiImage, description: 'Mammographic Imaging' },
  { id: 'Endoscopy', color: '#84cc16', icon: FiCrosshair, description: 'Endoscopic Imaging' },
]

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'none', label: 'Original' },
  { id: 'invert', label: 'Invert' },
  { id: 'sobel', label: 'Sobel Edge' },
  { id: 'gaussian', label: 'Gaussian Blur' },
  { id: 'sharpen', label: 'Sharpen' },
  { id: 'threshold', label: 'Otsu Threshold' },
  { id: 'histeq', label: 'Hist. Equalization' },
  { id: 'edge', label: 'Laplacian Edge' },
]

function loadStudies(): Study[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') } catch { return [] }
}
function saveStudies(s: Study[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)) } catch {}
}

/* ── Image Processing Helpers ───────────────────────────────────────── */
function applyFilter(imageData: ImageData, filter: Filter): ImageData {
  const { data, width, height } = imageData
  const out = new ImageData(width, height)
  out.data.set(data)

  if (filter === 'invert') {
    for (let i = 0; i < out.data.length; i += 4) {
      out.data[i] = 255 - out.data[i]
      out.data[i + 1] = 255 - out.data[i + 1]
      out.data[i + 2] = 255 - out.data[i + 2]
    }
  } else if (filter === 'sobel') {
    const gx = [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]]
    const gy = [[-1, -2, -1], [0, 0, 0], [1, 2, 1]]
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        let sx = 0, sy = 0
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const idx = ((y + ky) * width + (x + kx)) * 4
            const lum = (data[idx] + data[idx + 1] + data[idx + 2]) / 3
            sx += lum * gx[ky + 1][kx + 1]
            sy += lum * gy[ky + 1][kx + 1]
          }
        }
        const mag = Math.min(255, Math.sqrt(sx * sx + sy * sy))
        const o = (y * width + x) * 4
        out.data[o] = out.data[o + 1] = out.data[o + 2] = mag
        out.data[o + 3] = 255
      }
    }
  } else if (filter === 'gaussian') {
    const k = [[1, 2, 1], [2, 4, 2], [1, 2, 1]]
    const div = 16
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        let r = 0, g = 0, b = 0
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const idx = ((y + ky) * width + (x + kx)) * 4
            const w = k[ky + 1][kx + 1]
            r += data[idx] * w
            g += data[idx + 1] * w
            b += data[idx + 2] * w
          }
        }
        const o = (y * width + x) * 4
        out.data[o] = r / div
        out.data[o + 1] = g / div
        out.data[o + 2] = b / div
        out.data[o + 3] = 255
      }
    }
  } else if (filter === 'sharpen') {
    const k = [[0, -1, 0], [-1, 5, -1], [0, -1, 0]]
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        let r = 0, g = 0, b = 0
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const idx = ((y + ky) * width + (x + kx)) * 4
            const w = k[ky + 1][kx + 1]
            r += data[idx] * w
            g += data[idx + 1] * w
            b += data[idx + 2] * w
          }
        }
        const o = (y * width + x) * 4
        out.data[o] = Math.max(0, Math.min(255, r))
        out.data[o + 1] = Math.max(0, Math.min(255, g))
        out.data[o + 2] = Math.max(0, Math.min(255, b))
        out.data[o + 3] = 255
      }
    }
  } else if (filter === 'threshold') {
    // Otsu
    const hist = new Array(256).fill(0)
    for (let i = 0; i < data.length; i += 4) {
      const lum = Math.round((data[i] + data[i + 1] + data[i + 2]) / 3)
      hist[lum]++
    }
    const total = (data.length / 4)
    let sum = 0
    for (let i = 0; i < 256; i++) sum += i * hist[i]
    let sumB = 0, wB = 0, maxVar = 0, threshold = 127
    for (let t = 0; t < 256; t++) {
      wB += hist[t]; if (wB === 0) continue
      const wF = total - wB; if (wF === 0) break
      sumB += t * hist[t]
      const mB = sumB / wB
      const mF = (sum - sumB) / wF
      const between = wB * wF * (mB - mF) * (mB - mF)
      if (between > maxVar) { maxVar = between; threshold = t }
    }
    for (let i = 0; i < out.data.length; i += 4) {
      const lum = (data[i] + data[i + 1] + data[i + 2]) / 3
      const v = lum > threshold ? 255 : 0
      out.data[i] = out.data[i + 1] = out.data[i + 2] = v
      out.data[i + 3] = 255
    }
  } else if (filter === 'histeq') {
    const hist = new Array(256).fill(0)
    for (let i = 0; i < data.length; i += 4) {
      const lum = Math.round((data[i] + data[i + 1] + data[i + 2]) / 3)
      hist[lum]++
    }
    const cdf = new Array(256).fill(0)
    cdf[0] = hist[0]
    for (let i = 1; i < 256; i++) cdf[i] = cdf[i - 1] + hist[i]
    const cdfMin = cdf.find(v => v > 0) || 0
    const total = data.length / 4
    const lut = cdf.map(v => Math.round(((v - cdfMin) / (total - cdfMin)) * 255))
    for (let i = 0; i < out.data.length; i += 4) {
      const lum = Math.round((data[i] + data[i + 1] + data[i + 2]) / 3)
      const eq = lut[lum]
      out.data[i] = out.data[i + 1] = out.data[i + 2] = eq
      out.data[i + 3] = 255
    }
  } else if (filter === 'edge') {
    // Laplacian
    const k = [[0, -1, 0], [-1, 4, -1], [0, -1, 0]]
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        let s = 0
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const idx = ((y + ky) * width + (x + kx)) * 4
            const lum = (data[idx] + data[idx + 1] + data[idx + 2]) / 3
            s += lum * k[ky + 1][kx + 1]
          }
        }
        const v = Math.min(255, Math.abs(s))
        const o = (y * width + x) * 4
        out.data[o] = out.data[o + 1] = out.data[o + 2] = v
        out.data[o + 3] = 255
      }
    }
  }
  return out
}

function applyWindow(imageData: ImageData, center: number, width: number): ImageData {
  const out = new ImageData(imageData.width, imageData.height)
  out.data.set(imageData.data)
  const lo = center - width / 2
  const hi = center + width / 2
  for (let i = 0; i < out.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const v = out.data[i + c]
      if (v <= lo) out.data[i + c] = 0
      else if (v >= hi) out.data[i + c] = 255
      else out.data[i + c] = ((v - lo) / (hi - lo)) * 255
    }
  }
  return out
}

function computeImageStats(data: Uint8ClampedArray): { mean: number; std: number; min: number; max: number; histogram: number[] } {
  let sum = 0, sumSq = 0, mn = 255, mx = 0, n = 0
  const hist = new Array(256).fill(0)
  for (let i = 0; i < data.length; i += 4) {
    const lum = (data[i] + data[i + 1] + data[i + 2]) / 3
    sum += lum
    sumSq += lum * lum
    if (lum < mn) mn = lum
    if (lum > mx) mx = lum
    hist[Math.round(lum)]++
    n++
  }
  const mean = sum / n
  const variance = sumSq / n - mean * mean
  return { mean, std: Math.sqrt(Math.max(0, variance)), min: mn, max: mx, histogram: hist }
}

/* ═══ Main Component ═══════════════════════════════════════════════════ */
export default function ResearchImaging() {
  const [studies, setStudies] = useState<Study[]>(() => loadStudies())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filterModality, setFilterModality] = useState<Modality | 'all'>('all')
  const [tool, setTool] = useState<Tool>('pan')
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [showPanel, setShowPanel] = useState<'tools' | 'analysis' | 'annotations'>('tools')
  const [annotLabel, setAnnotLabel] = useState('Region')
  const [annotColor, setAnnotColor] = useState('#ef4444')
  const [drawing, setDrawing] = useState<{ start: { x: number; y: number }; current: { x: number; y: number } } | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgCacheRef = useRef<HTMLImageElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const selected = useMemo(() => studies.find(s => s.id === selectedId) || null, [studies, selectedId])

  const filteredStudies = useMemo(() => {
    return studies.filter(s => {
      if (filterModality !== 'all' && s.modality !== filterModality) return false
      if (search.trim()) {
        const q = search.toLowerCase()
        return s.title.toLowerCase().includes(q) ||
               s.bodyPart.toLowerCase().includes(q) ||
               s.patientId.toLowerCase().includes(q)
      }
      return true
    })
  }, [studies, search, filterModality])

  // Persist studies
  useEffect(() => { saveStudies(studies) }, [studies])

  // Load image when selection changes
  useEffect(() => {
    if (!selected) { imgCacheRef.current = null; return }
    const img = new Image()
    img.onload = () => { imgCacheRef.current = img; renderCanvas() }
    img.src = selected.imageData
    setZoom(1); setPan({ x: 0, y: 0 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  // Re-render when zoom/pan/window/filter/annotations change
  useEffect(() => { renderCanvas() })

  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current
    const img = imgCacheRef.current
    if (!canvas || !img || !selected) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Fit canvas to display size, draw at zoom
    const dispW = canvas.parentElement?.clientWidth || 800
    const dispH = canvas.parentElement?.clientHeight || 600
    canvas.width = dispW
    canvas.height = dispH

    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, dispW, dispH)

    // Draw image to offscreen canvas at native size, apply windowing/filter
    const off = document.createElement('canvas')
    off.width = img.width
    off.height = img.height
    const offCtx = off.getContext('2d')!
    offCtx.drawImage(img, 0, 0)
    let data = offCtx.getImageData(0, 0, img.width, img.height)
    data = applyWindow(data, selected.windowCenter, selected.windowWidth)
    if (selected.filter !== 'none') data = applyFilter(data, selected.filter)
    offCtx.putImageData(data, 0, 0)

    // Compute fit
    const baseScale = Math.min(dispW / img.width, dispH / img.height)
    const scale = baseScale * zoom
    const drawW = img.width * scale
    const drawH = img.height * scale
    const offsetX = (dispW - drawW) / 2 + pan.x
    const offsetY = (dispH - drawH) / 2 + pan.y

    ctx.imageSmoothingEnabled = true
    ctx.drawImage(off, offsetX, offsetY, drawW, drawH)

    // Draw annotations
    selected.annotations.forEach(a => {
      ctx.strokeStyle = a.color
      ctx.fillStyle = a.color
      ctx.lineWidth = 2
      const ax = offsetX + a.x * scale
      const ay = offsetY + a.y * scale
      if (a.type === 'rect' && a.w !== undefined && a.h !== undefined) {
        ctx.strokeRect(ax, ay, a.w * scale, a.h * scale)
        ctx.fillStyle = a.color
        ctx.font = '11px sans-serif'
        ctx.fillText(a.label, ax + 2, ay - 4)
      } else if (a.type === 'circle' && a.w !== undefined) {
        ctx.beginPath()
        ctx.arc(ax + (a.w * scale) / 2, ay + (a.w * scale) / 2, (a.w * scale) / 2, 0, Math.PI * 2)
        ctx.stroke()
        ctx.fillText(a.label, ax, ay - 4)
      } else if (a.type === 'point') {
        ctx.beginPath()
        ctx.arc(ax, ay, 4, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillText(a.label, ax + 6, ay + 4)
      } else if ((a.type === 'line' || a.type === 'measure' || a.type === 'ruler') && a.x2 !== undefined && a.y2 !== undefined) {
        const bx = offsetX + a.x2 * scale
        const by = offsetY + a.y2 * scale
        ctx.beginPath()
        ctx.moveTo(ax, ay)
        ctx.lineTo(bx, by)
        ctx.stroke()
        if (a.type === 'measure' || a.type === 'ruler') {
          const dpx = Math.sqrt((a.x2 - a.x) ** 2 + (a.y2 - a.y) ** 2)
          const mm = dpx * (selected.pixelSpacing || 1)
          ctx.fillText(`${mm.toFixed(2)} ${selected.pixelSpacing ? 'mm' : 'px'}`, (ax + bx) / 2, (ay + by) / 2 - 6)
        } else {
          ctx.fillText(a.label, (ax + bx) / 2, (ay + by) / 2 - 6)
        }
      }
    })

    // Draw current drawing
    if (drawing) {
      ctx.strokeStyle = annotColor
      ctx.lineWidth = 2
      ctx.setLineDash([4, 4])
      const sx = offsetX + drawing.start.x * scale
      const sy = offsetY + drawing.start.y * scale
      const cx = offsetX + drawing.current.x * scale
      const cy = offsetY + drawing.current.y * scale
      if (tool === 'rect') {
        ctx.strokeRect(sx, sy, cx - sx, cy - sy)
      } else if (tool === 'circle') {
        const w = Math.abs(cx - sx)
        ctx.beginPath()
        ctx.arc(sx + (cx - sx) / 2, sy + (cy - sy) / 2, w / 2, 0, Math.PI * 2)
        ctx.stroke()
      } else if (tool === 'line' || tool === 'measure' || tool === 'ruler') {
        ctx.beginPath()
        ctx.moveTo(sx, sy)
        ctx.lineTo(cx, cy)
        ctx.stroke()
      }
      ctx.setLineDash([])
    }
  }, [selected, zoom, pan, drawing, tool, annotColor])

  const screenToImage = useCallback((e: React.MouseEvent): { x: number; y: number } | null => {
    const canvas = canvasRef.current
    const img = imgCacheRef.current
    if (!canvas || !img) return null
    const rect = canvas.getBoundingClientRect()
    const dispW = canvas.width
    const dispH = canvas.height
    const baseScale = Math.min(dispW / img.width, dispH / img.height)
    const scale = baseScale * zoom
    const drawW = img.width * scale
    const drawH = img.height * scale
    const offsetX = (dispW - drawW) / 2 + pan.x
    const offsetY = (dispH - drawH) / 2 + pan.y
    const x = (e.clientX - rect.left - offsetX) / scale
    const y = (e.clientY - rect.top - offsetY) / scale
    return { x, y }
  }, [zoom, pan])

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!selected) return
    if (tool === 'pan') return
    const p = screenToImage(e)
    if (!p) return
    if (tool === 'point') {
      const ann: Annotation = { id: crypto.randomUUID(), type: 'point', x: p.x, y: p.y, label: annotLabel, color: annotColor }
      updateStudy({ ...selected, annotations: [...selected.annotations, ann] })
    } else {
      setDrawing({ start: p, current: p })
    }
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!drawing) return
    const p = screenToImage(e)
    if (!p) return
    setDrawing({ ...drawing, current: p })
  }

  const handleMouseUp = () => {
    if (!drawing || !selected) return
    const { start, current } = drawing
    let ann: Annotation | null = null
    if (tool === 'rect') {
      ann = {
        id: crypto.randomUUID(), type: 'rect',
        x: Math.min(start.x, current.x), y: Math.min(start.y, current.y),
        w: Math.abs(current.x - start.x), h: Math.abs(current.y - start.y),
        label: annotLabel, color: annotColor,
      }
    } else if (tool === 'circle') {
      ann = {
        id: crypto.randomUUID(), type: 'circle',
        x: Math.min(start.x, current.x), y: Math.min(start.y, current.y),
        w: Math.abs(current.x - start.x),
        label: annotLabel, color: annotColor,
      }
    } else if (tool === 'line' || tool === 'measure' || tool === 'ruler') {
      ann = {
        id: crypto.randomUUID(),
        type: tool === 'line' ? 'line' : tool === 'measure' ? 'measure' : 'ruler',
        x: start.x, y: start.y, x2: current.x, y2: current.y,
        label: annotLabel, color: annotColor,
      }
    }
    if (ann && (ann.w === undefined || ann.w > 2) && (ann.h === undefined || ann.h > 2)) {
      updateStudy({ ...selected, annotations: [...selected.annotations, ann] })
    }
    setDrawing(null)
  }

  const updateStudy = (s: Study) => {
    setStudies(prev => prev.map(x => x.id === s.id ? s : x))
  }

  const deleteStudy = (id: string) => {
    if (!confirm('Delete this study? This cannot be undone.')) return
    setStudies(prev => prev.filter(s => s.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  const deleteAnnotation = (annId: string) => {
    if (!selected) return
    updateStudy({ ...selected, annotations: selected.annotations.filter(a => a.id !== annId) })
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    Array.from(files).forEach(file => {
      const reader = new FileReader()
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string
        const img = new Image()
        img.onload = () => {
          const study: Study = {
            id: crypto.randomUUID(),
            title: file.name.replace(/\.[^.]+$/, ''),
            modality: 'CT',
            bodyPart: '',
            patientId: '',
            acquiredAt: new Date().toISOString(),
            imageData: dataUrl,
            width: img.width,
            height: img.height,
            windowCenter: 128,
            windowWidth: 256,
            filter: 'none',
            annotations: [],
            notes: '',
          }
          setStudies(prev => [study, ...prev])
          setSelectedId(study.id)
        }
        img.src = dataUrl
      }
      reader.readAsDataURL(file)
    })
  }

  // Compute analysis stats for selected
  const analysisStats = useMemo(() => {
    if (!selected) return null
    const img = imgCacheRef.current
    if (!img) return null
    const off = document.createElement('canvas')
    off.width = img.width
    off.height = img.height
    const ctx = off.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    const imgData = ctx.getImageData(0, 0, img.width, img.height)
    return computeImageStats(imgData.data)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, selected?.annotations.length])

  const exportImage = () => {
    const canvas = canvasRef.current
    if (!canvas || !selected) return
    const a = document.createElement('a')
    a.href = canvas.toDataURL('image/png')
    a.download = `${selected.title}-annotated.png`
    a.click()
  }

  const exportStudy = () => {
    if (!selected) return
    const blob = new Blob([JSON.stringify(selected, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${selected.title}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const tools: { id: Tool; icon: typeof FiSquare; label: string }[] = [
    { id: 'pan', icon: FiMaximize2, label: 'Pan' },
    { id: 'rect', icon: FiSquare, label: 'Rectangle' },
    { id: 'circle', icon: FiCircle, label: 'Circle' },
    { id: 'line', icon: FiCrosshair, label: 'Line' },
    { id: 'point', icon: FiTarget, label: 'Point' },
    { id: 'measure', icon: FiActivity, label: 'Measure' },
    { id: 'ruler', icon: FiSliders, label: 'Ruler' },
  ]

  const colors = ['#ef4444', '#f59e0b', '#10b981', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899']

  return (
    <div className="flex h-full" style={{ color: 'var(--color-text)' }}>
      {/* ── Left: Study Browser ── */}
      <div className="w-64 flex flex-col border-r flex-shrink-0" style={{ borderColor: 'var(--glass-border)', background: 'var(--glass-bg)' }}>
        <div className="p-3 border-b" style={{ borderColor: 'var(--glass-border)' }}>
          <div className="flex items-center gap-2 mb-3">
            <FiImage className="text-lg" style={{ color: 'var(--color-accent-blue)' }} />
            <h2 className="text-sm font-semibold">Studies</h2>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="ml-auto p-1.5 rounded hover:bg-white/5 transition-all"
              style={{ border: '1px solid var(--glass-border)', color: 'var(--color-text-muted)' }}
              title="Upload images"
            >
              <FiPlus className="text-xs" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleFileUpload}
              style={{ display: 'none' }}
            />
          </div>

          <div className="relative mb-2">
            <FiSearch className="absolute left-2 top-1/2 -translate-y-1/2 text-xs opacity-60" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search…"
              className="w-full pl-7 pr-2 py-1.5 text-xs rounded-md outline-none"
              style={{ background: 'var(--color-bg)', border: '1px solid var(--glass-border)', color: 'var(--color-text)' }}
            />
          </div>

          <select
            value={filterModality}
            onChange={e => setFilterModality(e.target.value as any)}
            className="w-full px-2 py-1.5 text-xs rounded-md outline-none"
            style={{ background: 'var(--color-bg)', border: '1px solid var(--glass-border)', color: 'var(--color-text)' }}
          >
            <option value="all">All modalities</option>
            {MODALITIES.map(m => <option key={m.id} value={m.id}>{m.id}</option>)}
          </select>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {filteredStudies.length === 0 && (
            <div className="text-center py-12 text-xs" style={{ color: 'var(--color-text-muted)' }}>
              No studies. Click + to upload.
            </div>
          )}
          {filteredStudies.map(s => {
            const mod = MODALITIES.find(m => m.id === s.modality)!
            const active = selectedId === s.id
            return (
              <button
                key={s.id}
                onClick={() => setSelectedId(s.id)}
                className={clsx('w-full text-left p-2 rounded-md transition-all flex gap-2', active ? 'shadow' : 'hover:bg-white/5')}
                style={{ background: active ? `${mod.color}22` : 'transparent', border: `1px solid ${active ? mod.color : 'var(--glass-border)'}` }}
              >
                <div className="w-12 h-12 rounded flex-shrink-0 overflow-hidden flex items-center justify-center" style={{ background: '#000' }}>
                  <img src={s.imageData} className="max-w-full max-h-full" alt="" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold truncate" style={{ color: 'var(--color-text)' }}>{s.title}</div>
                  <div className="text-[9px] mt-0.5" style={{ color: mod.color }}>{s.modality}</div>
                  <div className="text-[9px]" style={{ color: 'var(--color-text-muted)' }}>
                    {s.width}×{s.height} · {s.annotations.length} ann.
                  </div>
                </div>
              </button>
            )
          })}
        </div>

        {/* Modality legend */}
        <div className="p-2 border-t" style={{ borderColor: 'var(--glass-border)' }}>
          <div className="grid grid-cols-5 gap-1">
            {MODALITIES.map(m => (
              <div key={m.id} className="flex flex-col items-center gap-0.5" title={m.description}>
                <m.icon className="text-xs" style={{ color: m.color }} />
                <span className="text-[8px]" style={{ color: 'var(--color-text-muted)' }}>{m.id}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Center: Viewer ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-3 py-2 border-b flex-shrink-0" style={{ borderColor: 'var(--glass-border)', background: 'var(--glass-bg)' }}>
          {selected ? (
            <>
              <div className="text-xs font-semibold truncate max-w-[200px]">{selected.title}</div>
              <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--color-bg)', color: 'var(--color-text-muted)' }}>
                {selected.width}×{selected.height}
              </span>
              <div className="flex gap-0.5 ml-2">
                {tools.map(t => {
                  const Icon = t.icon
                  return (
                    <button
                      key={t.id}
                      onClick={() => setTool(t.id)}
                      className={clsx('p-1.5 rounded transition-all', tool === t.id ? 'shadow' : 'hover:bg-white/5')}
                      style={{
                        background: tool === t.id ? 'var(--color-accent-blue)' : 'transparent',
                        color: tool === t.id ? '#fff' : 'var(--color-text-muted)',
                      }}
                      title={t.label}
                    >
                      <Icon className="text-xs" />
                    </button>
                  )
                })}
              </div>
              <div className="ml-auto flex items-center gap-1">
                <button onClick={() => setZoom(z => Math.max(0.2, z - 0.2))} className="p-1.5 rounded hover:bg-white/5"><FiZoomOut className="text-xs" /></button>
                <span className="text-xs px-1" style={{ color: 'var(--color-text-muted)' }}>{(zoom * 100).toFixed(0)}%</span>
                <button onClick={() => setZoom(z => Math.min(8, z + 0.2))} className="p-1.5 rounded hover:bg-white/5"><FiZoomIn className="text-xs" /></button>
                <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }} className="p-1.5 rounded hover:bg-white/5" title="Reset"><FiRotateCw className="text-xs" /></button>
                <button onClick={exportImage} className="p-1.5 rounded hover:bg-white/5" title="Export PNG"><FiDownload className="text-xs" /></button>
                <button onClick={exportStudy} className="p-1.5 rounded hover:bg-white/5" title="Export study JSON"><FiSave className="text-xs" /></button>
                <button onClick={() => deleteStudy(selected.id)} className="p-1.5 rounded hover:bg-white/5" style={{ color: '#ef4444' }} title="Delete"><FiTrash2 className="text-xs" /></button>
              </div>
            </>
          ) : (
            <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>No study selected — upload an image or pick one from the browser</div>
          )}
        </div>

        {/* Canvas */}
        <div className="flex-1 relative overflow-hidden" style={{ background: '#000' }}>
          {selected ? (
            <canvas
              ref={canvasRef}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={() => setDrawing(null)}
              style={{ width: '100%', height: '100%', cursor: tool === 'pan' ? 'grab' : 'crosshair' }}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <FiImage className="text-6xl mx-auto mb-4 opacity-20" style={{ color: 'var(--color-text-muted)' }} />
                <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Upload a study to begin</p>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-4 px-4 py-2 rounded-md text-xs font-medium text-white"
                  style={{ background: 'var(--color-accent-blue)' }}
                >
                  <FiUpload className="inline mr-1.5" />
                  Upload Image
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Right: Tool Panel ── */}
      {selected && (
        <div className="w-72 flex flex-col border-l flex-shrink-0" style={{ borderColor: 'var(--glass-border)', background: 'var(--glass-bg)' }}>
          {/* Panel tabs */}
          <div className="flex border-b" style={{ borderColor: 'var(--glass-border)' }}>
            {([
              { id: 'tools', label: 'Tools', icon: FiSliders },
              { id: 'analysis', label: 'Analysis', icon: FiBarChart2 },
              { id: 'annotations', label: 'Marks', icon: FiTarget },
            ] as const).map(t => {
              const Icon = t.icon
              return (
                <button
                  key={t.id}
                  onClick={() => setShowPanel(t.id)}
                  className={clsx('flex-1 flex items-center justify-center gap-1 px-2 py-2 text-[10px] font-medium transition-all', showPanel === t.id ? 'border-b-2' : 'hover:bg-white/5')}
                  style={{
                    color: showPanel === t.id ? 'var(--color-accent-blue)' : 'var(--color-text-muted)',
                    borderColor: showPanel === t.id ? 'var(--color-accent-blue)' : 'transparent',
                  }}
                >
                  <Icon className="text-xs" />
                  {t.label}
                </button>
              )
            })}
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {showPanel === 'tools' && (
              <>
                {/* Metadata */}
                <div>
                  <div className="text-[10px] uppercase font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>Metadata</div>
                  <input
                    value={selected.title}
                    onChange={e => updateStudy({ ...selected, title: e.target.value })}
                    placeholder="Title"
                    className="w-full px-2 py-1.5 text-xs rounded mb-1.5 outline-none"
                    style={{ background: 'var(--color-bg)', border: '1px solid var(--glass-border)', color: 'var(--color-text)' }}
                  />
                  <select
                    value={selected.modality}
                    onChange={e => updateStudy({ ...selected, modality: e.target.value as Modality })}
                    className="w-full px-2 py-1.5 text-xs rounded mb-1.5 outline-none"
                    style={{ background: 'var(--color-bg)', border: '1px solid var(--glass-border)', color: 'var(--color-text)' }}
                  >
                    {MODALITIES.map(m => <option key={m.id} value={m.id}>{m.id} — {m.description}</option>)}
                  </select>
                  <input
                    value={selected.bodyPart}
                    onChange={e => updateStudy({ ...selected, bodyPart: e.target.value })}
                    placeholder="Body part / region"
                    className="w-full px-2 py-1.5 text-xs rounded mb-1.5 outline-none"
                    style={{ background: 'var(--color-bg)', border: '1px solid var(--glass-border)', color: 'var(--color-text)' }}
                  />
                  <input
                    value={selected.patientId}
                    onChange={e => updateStudy({ ...selected, patientId: e.target.value })}
                    placeholder="Patient ID"
                    className="w-full px-2 py-1.5 text-xs rounded mb-1.5 outline-none"
                    style={{ background: 'var(--color-bg)', border: '1px solid var(--glass-border)', color: 'var(--color-text)' }}
                  />
                </div>

                {/* Windowing */}
                <div>
                  <div className="text-[10px] uppercase font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>Window / Level</div>
                  <label className="text-[10px] block mb-1" style={{ color: 'var(--color-text-muted)' }}>
                    Center: {selected.windowCenter}
                  </label>
                  <input
                    type="range" min={0} max={255} value={selected.windowCenter}
                    onChange={e => updateStudy({ ...selected, windowCenter: parseInt(e.target.value) })}
                    className="w-full"
                  />
                  <label className="text-[10px] block mb-1 mt-2" style={{ color: 'var(--color-text-muted)' }}>
                    Width: {selected.windowWidth}
                  </label>
                  <input
                    type="range" min={1} max={512} value={selected.windowWidth}
                    onChange={e => updateStudy({ ...selected, windowWidth: parseInt(e.target.value) })}
                    className="w-full"
                  />
                  <button
                    onClick={() => updateStudy({ ...selected, windowCenter: 128, windowWidth: 256 })}
                    className="w-full mt-2 px-2 py-1 text-[10px] rounded"
                    style={{ background: 'var(--color-bg)', border: '1px solid var(--glass-border)', color: 'var(--color-text-muted)' }}
                  >
                    Reset
                  </button>
                </div>

                {/* Filters */}
                <div>
                  <div className="text-[10px] uppercase font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
                    <FiFilter className="inline mr-1" />
                    Filter
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    {FILTERS.map(f => (
                      <button
                        key={f.id}
                        onClick={() => updateStudy({ ...selected, filter: f.id })}
                        className="px-2 py-1 text-[10px] rounded transition-all"
                        style={{
                          background: selected.filter === f.id ? 'var(--color-accent-blue)' : 'transparent',
                          color: selected.filter === f.id ? '#fff' : 'var(--color-text-muted)',
                          border: '1px solid var(--glass-border)',
                        }}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Annotation styling */}
                <div>
                  <div className="text-[10px] uppercase font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>Annotation</div>
                  <input
                    value={annotLabel}
                    onChange={e => setAnnotLabel(e.target.value)}
                    placeholder="Label"
                    className="w-full px-2 py-1.5 text-xs rounded mb-1.5 outline-none"
                    style={{ background: 'var(--color-bg)', border: '1px solid var(--glass-border)', color: 'var(--color-text)' }}
                  />
                  <div className="flex gap-1">
                    {colors.map(c => (
                      <button
                        key={c}
                        onClick={() => setAnnotColor(c)}
                        className="w-6 h-6 rounded transition-all"
                        style={{
                          background: c,
                          border: annotColor === c ? '2px solid #fff' : '1px solid transparent',
                        }}
                      />
                    ))}
                  </div>
                </div>

                {/* Pixel spacing */}
                <div>
                  <div className="text-[10px] uppercase font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>Pixel Spacing</div>
                  <input
                    type="number"
                    step="0.01"
                    value={selected.pixelSpacing || ''}
                    onChange={e => updateStudy({ ...selected, pixelSpacing: parseFloat(e.target.value) || undefined })}
                    placeholder="mm/px (for measurements)"
                    className="w-full px-2 py-1.5 text-xs rounded outline-none"
                    style={{ background: 'var(--color-bg)', border: '1px solid var(--glass-border)', color: 'var(--color-text)' }}
                  />
                </div>
              </>
            )}

            {showPanel === 'analysis' && analysisStats && (
              <>
                <div>
                  <div className="text-[10px] uppercase font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
                    <FiBarChart2 className="inline mr-1" />
                    Image Statistics
                  </div>
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between"><span style={{ color: 'var(--color-text-muted)' }}>Mean intensity</span><span>{analysisStats.mean.toFixed(2)}</span></div>
                    <div className="flex justify-between"><span style={{ color: 'var(--color-text-muted)' }}>Std deviation</span><span>{analysisStats.std.toFixed(2)}</span></div>
                    <div className="flex justify-between"><span style={{ color: 'var(--color-text-muted)' }}>Min</span><span>{analysisStats.min.toFixed(0)}</span></div>
                    <div className="flex justify-between"><span style={{ color: 'var(--color-text-muted)' }}>Max</span><span>{analysisStats.max.toFixed(0)}</span></div>
                    <div className="flex justify-between"><span style={{ color: 'var(--color-text-muted)' }}>Dynamic range</span><span>{(analysisStats.max - analysisStats.min).toFixed(0)}</span></div>
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>Histogram</div>
                  <div className="h-24 flex items-end gap-px" style={{ background: 'var(--color-bg)', padding: 4, borderRadius: 4 }}>
                    {(() => {
                      const groups = 64
                      const groupSize = 256 / groups
                      const grouped: number[] = []
                      for (let g = 0; g < groups; g++) {
                        let s = 0
                        for (let i = 0; i < groupSize; i++) s += analysisStats.histogram[g * groupSize + i] || 0
                        grouped.push(s)
                      }
                      const max = Math.max(...grouped)
                      return grouped.map((c, i) => (
                        <div key={i} style={{
                          flex: 1,
                          height: `${(c / max) * 100}%`,
                          background: 'var(--color-accent-blue)',
                          opacity: 0.8,
                          minHeight: 1,
                        }} />
                      ))
                    })()}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
                    <FiCpu className="inline mr-1" />
                    AI Quality Heuristics
                  </div>
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between"><span style={{ color: 'var(--color-text-muted)' }}>Contrast</span><span>{analysisStats.std > 60 ? 'High' : analysisStats.std > 30 ? 'Medium' : 'Low'}</span></div>
                    <div className="flex justify-between"><span style={{ color: 'var(--color-text-muted)' }}>Exposure</span><span>{analysisStats.mean > 200 ? 'Over' : analysisStats.mean < 50 ? 'Under' : 'Normal'}</span></div>
                    <div className="flex justify-between"><span style={{ color: 'var(--color-text-muted)' }}>Annotated regions</span><span>{selected.annotations.length}</span></div>
                  </div>
                </div>
              </>
            )}

            {showPanel === 'annotations' && (
              <div>
                <div className="text-[10px] uppercase font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
                  <FiTarget className="inline mr-1" />
                  Annotations ({selected.annotations.length})
                </div>
                {selected.annotations.length === 0 && (
                  <div className="text-xs text-center py-8" style={{ color: 'var(--color-text-muted)' }}>
                    No annotations. Pick a tool from the toolbar.
                  </div>
                )}
                <div className="space-y-1">
                  {selected.annotations.map((a) => (
                    <div key={a.id} className="p-2 rounded flex items-center gap-2" style={{ background: 'var(--color-bg)', border: '1px solid var(--glass-border)' }}>
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: a.color }} />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs truncate">{a.label}</div>
                        <div className="text-[9px]" style={{ color: 'var(--color-text-muted)' }}>{a.type}</div>
                      </div>
                      <button onClick={() => deleteAnnotation(a.id)} className="p-1 hover:text-red-500"><FiX className="text-xs" /></button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
