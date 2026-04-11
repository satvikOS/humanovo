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
import { parseMedicalFile, parsedToDataURL } from '../utils/medicalImaging'

type Modality = 'CT' | 'MRI' | 'X-Ray' | 'Ultrasound' | 'PET' | 'Microscopy' | 'Fundus' | 'OCT' | 'Mammography' | 'Endoscopy'
type Tool = 'pan' | 'window' | 'rect' | 'circle' | 'line' | 'point' | 'polygon' | 'measure' | 'ruler' | 'brush' | 'eraser'
type Filter = 'none' | 'invert' | 'sobel' | 'gaussian' | 'sharpen' | 'threshold' | 'histeq' | 'edge' | 'median' | 'bilateral' | 'speckle' | 'unsharp' | 'morphOpen' | 'morphClose' | 'canny'

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

interface LabelDef {
  id: string
  name: string
  color: string
  visible: boolean
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
  labels?: LabelDef[]
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

const FILTERS: { id: Filter; label: string; group: string }[] = [
  { id: 'none', label: 'Original', group: 'Basic' },
  { id: 'invert', label: 'Invert', group: 'Basic' },
  { id: 'gaussian', label: 'Gaussian Blur', group: 'Smoothing' },
  { id: 'median', label: 'Median Filter', group: 'Smoothing' },
  { id: 'bilateral', label: 'Bilateral', group: 'Smoothing' },
  { id: 'speckle', label: 'Lee Speckle', group: 'Smoothing' },
  { id: 'sharpen', label: 'Sharpen', group: 'Enhancement' },
  { id: 'unsharp', label: 'Unsharp Mask', group: 'Enhancement' },
  { id: 'histeq', label: 'Hist. Equalize', group: 'Enhancement' },
  { id: 'threshold', label: 'Otsu Threshold', group: 'Segmentation' },
  { id: 'sobel', label: 'Sobel Edge', group: 'Edge Detection' },
  { id: 'edge', label: 'Laplacian', group: 'Edge Detection' },
  { id: 'canny', label: 'Canny Edge', group: 'Edge Detection' },
  { id: 'morphOpen', label: 'Morph. Open', group: 'Morphology' },
  { id: 'morphClose', label: 'Morph. Close', group: 'Morphology' },
]

const WINDOW_PRESETS: { label: string; center: number; width: number; modalities: Modality[] }[] = [
  { label: 'Default', center: 128, width: 256, modalities: [] },
  { label: 'CT Bone', center: 300, width: 1500, modalities: ['CT'] },
  { label: 'CT Lung', center: -500, width: 1500, modalities: ['CT'] },
  { label: 'CT Brain', center: 40, width: 80, modalities: ['CT'] },
  { label: 'CT Abdomen', center: 40, width: 400, modalities: ['CT'] },
  { label: 'CT Soft Tissue', center: 50, width: 350, modalities: ['CT'] },
  { label: 'MRI Brain', center: 600, width: 1200, modalities: ['MRI'] },
  { label: 'MRI T1', center: 500, width: 1000, modalities: ['MRI'] },
  { label: 'Mammography', center: 2048, width: 4096, modalities: ['Mammography'] },
  { label: 'High Contrast', center: 128, width: 128, modalities: [] },
  { label: 'Low Contrast', center: 128, width: 512, modalities: [] },
  { label: 'Full Range', center: 128, width: 256, modalities: [] },
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
  } else if (filter === 'median') {
    // 3x3 median filter — great for speckle/salt-and-pepper noise
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const rArr: number[] = [], gArr: number[] = [], bArr: number[] = []
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const idx = ((y + ky) * width + (x + kx)) * 4
            rArr.push(data[idx]); gArr.push(data[idx + 1]); bArr.push(data[idx + 2])
          }
        }
        rArr.sort((a, b) => a - b); gArr.sort((a, b) => a - b); bArr.sort((a, b) => a - b)
        const o = (y * width + x) * 4
        out.data[o] = rArr[4]; out.data[o + 1] = gArr[4]; out.data[o + 2] = bArr[4]; out.data[o + 3] = 255
      }
    }
  } else if (filter === 'bilateral') {
    // Bilateral filter — edge-preserving smoothing (simplified 5x5)
    const sigmaS = 2, sigmaI = 30
    const r = 2
    for (let y = r; y < height - r; y++) {
      for (let x = r; x < width - r; x++) {
        const ci = (y * width + x) * 4
        const cLum = (data[ci] + data[ci + 1] + data[ci + 2]) / 3
        let wSum = 0, rSum = 0, gSum = 0, bSum = 0
        for (let ky = -r; ky <= r; ky++) {
          for (let kx = -r; kx <= r; kx++) {
            const idx = ((y + ky) * width + (x + kx)) * 4
            const lum = (data[idx] + data[idx + 1] + data[idx + 2]) / 3
            const spatial = Math.exp(-(ky * ky + kx * kx) / (2 * sigmaS * sigmaS))
            const intensity = Math.exp(-((lum - cLum) ** 2) / (2 * sigmaI * sigmaI))
            const w = spatial * intensity
            rSum += data[idx] * w; gSum += data[idx + 1] * w; bSum += data[idx + 2] * w
            wSum += w
          }
        }
        const o = (y * width + x) * 4
        out.data[o] = rSum / wSum; out.data[o + 1] = gSum / wSum; out.data[o + 2] = bSum / wSum; out.data[o + 3] = 255
      }
    }
  } else if (filter === 'speckle') {
    // Lee speckle filter — adaptive local statistics filter for ultrasound
    const r = 2
    for (let y = r; y < height - r; y++) {
      for (let x = r; x < width - r; x++) {
        for (let c = 0; c < 3; c++) {
          let sum = 0, sumSq = 0, n = 0
          for (let ky = -r; ky <= r; ky++) {
            for (let kx = -r; kx <= r; kx++) {
              const v = data[((y + ky) * width + (x + kx)) * 4 + c]
              sum += v; sumSq += v * v; n++
            }
          }
          const mean = sum / n
          const variance = Math.max(0, sumSq / n - mean * mean)
          const noiseVar = variance * 0.25 // assume noise variance ~ 25% of local variance
          const w = Math.max(0, Math.min(1, (variance - noiseVar) / Math.max(variance, 1e-6)))
          out.data[(y * width + x) * 4 + c] = Math.round(mean + w * (data[(y * width + x) * 4 + c] - mean))
        }
        out.data[(y * width + x) * 4 + 3] = 255
      }
    }
  } else if (filter === 'unsharp') {
    // Unsharp mask: original + alpha*(original - blurred)
    const alpha = 1.5
    const k = [[1, 2, 1], [2, 4, 2], [1, 2, 1]]
    const div = 16
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        for (let c = 0; c < 3; c++) {
          let blurred = 0
          for (let ky = -1; ky <= 1; ky++) {
            for (let kx = -1; kx <= 1; kx++) {
              blurred += data[((y + ky) * width + (x + kx)) * 4 + c] * k[ky + 1][kx + 1]
            }
          }
          blurred /= div
          const orig = data[(y * width + x) * 4 + c]
          out.data[(y * width + x) * 4 + c] = Math.max(0, Math.min(255, orig + alpha * (orig - blurred)))
        }
        out.data[(y * width + x) * 4 + 3] = 255
      }
    }
  } else if (filter === 'morphOpen' || filter === 'morphClose') {
    // Morphological open (erode then dilate) or close (dilate then erode)
    const getLum = (d: Uint8ClampedArray, x: number, y: number) => (d[(y * width + x) * 4] + d[(y * width + x) * 4 + 1] + d[(y * width + x) * 4 + 2]) / 3
    const setLum = (d: Uint8ClampedArray, x: number, y: number, v: number) => { d[(y * width + x) * 4] = d[(y * width + x) * 4 + 1] = d[(y * width + x) * 4 + 2] = v; d[(y * width + x) * 4 + 3] = 255 }
    const tmp = new Uint8ClampedArray(data.length)
    tmp.set(data)
    const r = 1
    const ops = filter === 'morphOpen' ? ['erode', 'dilate'] : ['dilate', 'erode']
    let src = tmp, dst = out.data
    for (const op of ops) {
      for (let y = r; y < height - r; y++) {
        for (let x = r; x < width - r; x++) {
          let val = op === 'erode' ? 255 : 0
          for (let ky = -r; ky <= r; ky++) {
            for (let kx = -r; kx <= r; kx++) {
              const l = getLum(src, x + kx, y + ky)
              val = op === 'erode' ? Math.min(val, l) : Math.max(val, l)
            }
          }
          setLum(dst, x, y, val)
        }
      }
      if (op === ops[0]) { src = new Uint8ClampedArray(dst); dst = out.data }
    }
  } else if (filter === 'canny') {
    // Simplified Canny: Gaussian blur -> Sobel gradient -> non-max suppression -> hysteresis
    // Step 1: Gaussian blur
    const blurred = new Float64Array(width * height)
    const gk = [[1, 2, 1], [2, 4, 2], [1, 2, 1]]
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        let s = 0
        for (let ky = -1; ky <= 1; ky++) for (let kx = -1; kx <= 1; kx++) {
          s += ((data[((y + ky) * width + (x + kx)) * 4] + data[((y + ky) * width + (x + kx)) * 4 + 1] + data[((y + ky) * width + (x + kx)) * 4 + 2]) / 3) * gk[ky + 1][kx + 1]
        }
        blurred[y * width + x] = s / 16
      }
    }
    // Step 2: Sobel gradient
    const mag = new Float64Array(width * height)
    const dir = new Float64Array(width * height)
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const gx = -blurred[(y - 1) * width + x - 1] + blurred[(y - 1) * width + x + 1] - 2 * blurred[y * width + x - 1] + 2 * blurred[y * width + x + 1] - blurred[(y + 1) * width + x - 1] + blurred[(y + 1) * width + x + 1]
        const gy = -blurred[(y - 1) * width + x - 1] - 2 * blurred[(y - 1) * width + x] - blurred[(y - 1) * width + x + 1] + blurred[(y + 1) * width + x - 1] + 2 * blurred[(y + 1) * width + x] + blurred[(y + 1) * width + x + 1]
        mag[y * width + x] = Math.sqrt(gx * gx + gy * gy)
        dir[y * width + x] = Math.atan2(gy, gx)
      }
    }
    // Step 3: Non-max suppression + double threshold
    const maxMag = Math.max(...Array.from(mag).filter(v => isFinite(v)))
    const hiT = maxMag * 0.15, loT = maxMag * 0.05
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const m = mag[y * width + x]
        const angle = ((dir[y * width + x] * 180 / Math.PI) + 180) % 180
        let n1 = 0, n2 = 0
        if (angle < 22.5 || angle >= 157.5) { n1 = mag[y * width + x - 1]; n2 = mag[y * width + x + 1] }
        else if (angle < 67.5) { n1 = mag[(y - 1) * width + x + 1]; n2 = mag[(y + 1) * width + x - 1] }
        else if (angle < 112.5) { n1 = mag[(y - 1) * width + x]; n2 = mag[(y + 1) * width + x] }
        else { n1 = mag[(y - 1) * width + x - 1]; n2 = mag[(y + 1) * width + x + 1] }
        const v = (m >= n1 && m >= n2 && m > loT) ? (m > hiT ? 255 : 128) : 0
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
  const [showPanel, setShowPanel] = useState<'tools' | 'analysis' | 'annotations' | 'labels' | 'register'>('tools')
  const [regRefId, setRegRefId] = useState<string | null>(null)
  const [regTransform, setRegTransform] = useState({ tx: 0, ty: 0, rotation: 0, scale: 1 })
  const [regMode, setRegMode] = useState<'translation' | 'rigid' | 'similarity' | 'affine'>('rigid')
  const [regOverlayOpacity, setRegOverlayOpacity] = useState(0.5)
  const [regShowOverlay, setRegShowOverlay] = useState(false)
  const [annotLabel, setAnnotLabel] = useState('Region')
  const [annotColor, setAnnotColor] = useState('#ef4444')
  const [drawing, setDrawing] = useState<{ start: { x: number; y: number }; current: { x: number; y: number } } | null>(null)
  const [viewLayout, setViewLayout] = useState<'single' | 'quad'>('single')
  const [slicePos, setSlicePos] = useState({ axial: 50, coronal: 50, sagittal: 50 })

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const coronalRef = useRef<HTMLCanvasElement>(null)
  const sagittalRef = useRef<HTMLCanvasElement>(null)
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

  // Render orthogonal views (coronal / sagittal) in quad mode
  useEffect(() => {
    if (viewLayout !== 'quad') return
    const img = imgCacheRef.current
    if (!img || !selected) return

    // Get processed image data
    const off = document.createElement('canvas')
    off.width = img.width; off.height = img.height
    const offCtx = off.getContext('2d')!
    offCtx.drawImage(img, 0, 0)
    let srcData = offCtx.getImageData(0, 0, img.width, img.height)
    srcData = applyWindow(srcData, selected.windowCenter, selected.windowWidth)
    if (selected.filter !== 'none') srcData = applyFilter(srcData, selected.filter)

    const W = img.width, H = img.height
    const sliceY = Math.round((slicePos.coronal / 100) * (H - 1))
    const sliceX = Math.round((slicePos.sagittal / 100) * (W - 1))

    // Coronal view: extract horizontal line at sliceY, simulate depth by stretching
    const coronalCanvas = coronalRef.current
    if (coronalCanvas) {
      const cW = coronalCanvas.parentElement?.clientWidth || 300
      const cH = coronalCanvas.parentElement?.clientHeight || 300
      coronalCanvas.width = cW; coronalCanvas.height = cH
      const cCtx = coronalCanvas.getContext('2d')!
      cCtx.fillStyle = '#000'; cCtx.fillRect(0, 0, cW, cH)

      // Build a "depth" image: for each column, stack rows vertically
      const depthH = H
      const scaleX = cW / W, scaleY = cH / depthH
      const sc = Math.min(scaleX, scaleY)
      const offX = (cW - W * sc) / 2, offY = (cH - depthH * sc) / 2
      const coronalImg = cCtx.createImageData(Math.ceil(W * sc), Math.ceil(depthH * sc))
      for (let dy = 0; dy < Math.ceil(depthH * sc); dy++) {
        const srcRow = Math.min(Math.floor(dy / sc), H - 1)
        for (let dx = 0; dx < Math.ceil(W * sc); dx++) {
          const srcCol = Math.min(Math.floor(dx / sc), W - 1)
          const si = (srcRow * W + srcCol) * 4
          const di = (dy * coronalImg.width + dx) * 4
          coronalImg.data[di] = srcData.data[si]
          coronalImg.data[di + 1] = srcData.data[si + 1]
          coronalImg.data[di + 2] = srcData.data[si + 2]
          coronalImg.data[di + 3] = 255
        }
      }
      cCtx.putImageData(coronalImg, Math.round(offX), Math.round(offY))

      // Draw crosshair lines
      const crossY = offY + sliceY * sc
      const crossX = offX + sliceX * sc
      cCtx.strokeStyle = '#22c55e'; cCtx.lineWidth = 1; cCtx.setLineDash([4, 4])
      cCtx.beginPath(); cCtx.moveTo(0, crossY); cCtx.lineTo(cW, crossY); cCtx.stroke()
      cCtx.strokeStyle = '#3b82f6'
      cCtx.beginPath(); cCtx.moveTo(crossX, 0); cCtx.lineTo(crossX, cH); cCtx.stroke()
      cCtx.setLineDash([])

      // Label
      cCtx.fillStyle = '#22c55e'; cCtx.font = 'bold 11px sans-serif'
      cCtx.fillText('CORONAL', 8, 16)
      cCtx.fillStyle = '#ffffff88'; cCtx.font = '10px sans-serif'
      cCtx.fillText(`Slice ${sliceY}/${H}`, 8, 30)
    }

    // Sagittal view: extract vertical column at sliceX, simulate depth
    const sagittalCanvas = sagittalRef.current
    if (sagittalCanvas) {
      const sW = sagittalCanvas.parentElement?.clientWidth || 300
      const sH = sagittalCanvas.parentElement?.clientHeight || 300
      sagittalCanvas.width = sW; sagittalCanvas.height = sH
      const sCtx = sagittalCanvas.getContext('2d')!
      sCtx.fillStyle = '#000'; sCtx.fillRect(0, 0, sW, sH)

      // Transpose image: columns become rows (sagittal rotation)
      const scaleXS = sW / H, scaleYS = sH / W
      const sc = Math.min(scaleXS, scaleYS)
      const offXS = (sW - H * sc) / 2, offYS = (sH - W * sc) / 2
      const sagImg = sCtx.createImageData(Math.ceil(H * sc), Math.ceil(W * sc))
      for (let dy = 0; dy < Math.ceil(W * sc); dy++) {
        const srcCol = Math.min(Math.floor(dy / sc), W - 1)
        for (let dx = 0; dx < Math.ceil(H * sc); dx++) {
          const srcRow = Math.min(Math.floor(dx / sc), H - 1)
          const si = (srcRow * W + srcCol) * 4
          const di = (dy * sagImg.width + dx) * 4
          sagImg.data[di] = srcData.data[si]
          sagImg.data[di + 1] = srcData.data[si + 1]
          sagImg.data[di + 2] = srcData.data[si + 2]
          sagImg.data[di + 3] = 255
        }
      }
      sCtx.putImageData(sagImg, Math.round(offXS), Math.round(offYS))

      // Draw crosshair lines
      const crossY = offYS + sliceX * sc
      const crossX = offXS + sliceY * sc
      sCtx.strokeStyle = '#ef4444'; sCtx.lineWidth = 1; sCtx.setLineDash([4, 4])
      sCtx.beginPath(); sCtx.moveTo(0, crossY); sCtx.lineTo(sW, crossY); sCtx.stroke()
      sCtx.strokeStyle = '#3b82f6'
      sCtx.beginPath(); sCtx.moveTo(crossX, 0); sCtx.lineTo(crossX, sH); sCtx.stroke()
      sCtx.setLineDash([])

      sCtx.fillStyle = '#ef4444'; sCtx.font = 'bold 11px sans-serif'
      sCtx.fillText('SAGITTAL', 8, 16)
      sCtx.fillStyle = '#ffffff88'; sCtx.font = '10px sans-serif'
      sCtx.fillText(`Slice ${sliceX}/${W}`, 8, 30)
    }
  })

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

    // Draw registration overlay
    if (regShowOverlay && regRefId) {
      const refStudy = studies.find(s => s.id === regRefId)
      if (refStudy) {
        const refImg = new Image()
        refImg.onload = () => {
          ctx.save()
          ctx.globalAlpha = regOverlayOpacity
          // Apply transform relative to center
          const cx = dispW / 2
          const cy = dispH / 2
          ctx.translate(cx + regTransform.tx * scale, cy + regTransform.ty * scale)
          ctx.rotate((regTransform.rotation * Math.PI) / 180)
          ctx.scale(regTransform.scale, regTransform.scale)
          const refScale = Math.min(dispW / refImg.width, dispH / refImg.height) * zoom
          const rw = refImg.width * refScale
          const rh = refImg.height * refScale
          // Tint the overlay with a color to distinguish it
          ctx.drawImage(refImg, -rw / 2, -rh / 2, rw, rh)
          ctx.restore()
          // Label
          ctx.fillStyle = '#f59e0b'
          ctx.font = 'bold 10px sans-serif'
          ctx.fillText(`REF: ${refStudy.title}`, 8, dispH - 8)
        }
        refImg.src = refStudy.imageData
      }
    }
  }, [selected, zoom, pan, drawing, tool, annotColor, regShowOverlay, regRefId, regTransform, regOverlayOpacity, studies])

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

  const [uploadError, setUploadError] = useState<string | null>(null)

  const inferModality = (filename: string): Modality => {
    const n = filename.toLowerCase()
    if (n.includes('ct')) return 'CT'
    if (n.includes('mr') || n.includes('mri')) return 'MRI'
    if (n.includes('xray') || n.includes('x-ray') || n.includes('cr_')) return 'X-Ray'
    if (n.includes('us') || n.includes('ultra')) return 'Ultrasound'
    if (n.includes('pet')) return 'PET'
    if (n.includes('mam')) return 'Mammography'
    if (n.includes('oct')) return 'OCT'
    if (n.includes('fundus') || n.includes('retin')) return 'Fundus'
    if (n.includes('micro') || n.includes('histo')) return 'Microscopy'
    if (n.includes('endo')) return 'Endoscopy'
    return 'CT'
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    setUploadError(null)

    for (const file of Array.from(files)) {
      try {
        // Try the medical-format parser first (DICOM, NIfTI, TIFF)
        const parsed = await parseMedicalFile(file)
        if (parsed) {
          const dataUrl = parsedToDataURL(parsed)
          const modality = parsed.meta.modality
            ? (parsed.meta.modality as Modality)
            : inferModality(file.name)
          const validModality: Modality = (MODALITIES.find(m => m.id === modality)?.id) || inferModality(file.name)
          const study: Study = {
            id: crypto.randomUUID(),
            title: file.name.replace(/\.[^.]+$/, ''),
            modality: validModality,
            bodyPart: '',
            patientId: '',
            acquiredAt: new Date().toISOString(),
            imageData: dataUrl,
            width: parsed.width,
            height: parsed.height,
            windowCenter: parsed.meta.windowCenter ?? 128,
            windowWidth: parsed.meta.windowWidth ?? 256,
            filter: 'none',
            annotations: [],
            notes: parsed.meta.format === 'dicom'
              ? `Loaded from DICOM (${parsed.width}×${parsed.height})`
              : parsed.meta.format === 'nifti'
                ? `NIfTI volume, ${parsed.meta.slices ?? 1} slice${(parsed.meta.slices ?? 1) > 1 ? 's' : ''}, showing slice ${parsed.meta.sliceIndex ?? 0}`
                : `Loaded from TIFF (${parsed.meta.bitsPerSample ?? 8}-bit)`,
          }
          setStudies(prev => [study, ...prev])
          setSelectedId(study.id)
          continue
        }

        // Fall through to native image loader for JPEG/PNG/WebP/BMP/GIF/SVG
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.onerror = () => reject(new Error('Unable to read file'))
          reader.readAsDataURL(file)
        })
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const el = new Image()
          el.onload = () => resolve(el)
          el.onerror = () => reject(new Error(`"${file.name}" is not a recognized image format`))
          el.src = dataUrl
        })
        const study: Study = {
          id: crypto.randomUUID(),
          title: file.name.replace(/\.[^.]+$/, ''),
          modality: inferModality(file.name),
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
      } catch (err: any) {
        setUploadError(err?.message || `Failed to load "${file.name}"`)
      }
    }
    // Reset the input so the same file can be re-uploaded after an error
    if (e.target) e.target.value = ''
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
              accept=".jpg,.jpeg,.png,.webp,.bmp,.gif,.svg,.tif,.tiff,.dcm,.dicom,.nii,.nii.gz,.nrrd,.hdr,.img,image/jpeg,image/png,image/webp,image/bmp,image/gif,image/svg+xml,image/tiff,application/dicom"
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

          {uploadError && (
            <div
              className="mt-2 px-2 py-1.5 rounded-md text-[11px] flex items-start gap-1.5"
              style={{
                background: 'rgba(239, 68, 68, 0.08)',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                color: 'var(--color-error)',
              }}
            >
              <FiX className="mt-[1px] flex-shrink-0" />
              <span className="flex-1 break-words">{uploadError}</span>
              <button
                onClick={() => setUploadError(null)}
                className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                title="Dismiss"
              >
                ×
              </button>
            </div>
          )}

          <div className="mt-2 text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
            DICOM, NIfTI (.nii/.nii.gz), NRRD, Analyze (.hdr/.img), TIFF, JPEG, PNG, WebP, BMP, GIF, SVG
          </div>
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
                <button
                  onClick={() => setViewLayout(v => v === 'single' ? 'quad' : 'single')}
                  className="p-1.5 rounded hover:bg-white/5"
                  style={{ color: viewLayout === 'quad' ? '#3b82f6' : undefined }}
                  title={viewLayout === 'quad' ? 'Single view' : 'Multi-view (Axial/Coronal/Sagittal)'}
                >
                  <FiMaximize2 className="text-xs" />
                </button>
                <button onClick={exportImage} className="p-1.5 rounded hover:bg-white/5" title="Export PNG"><FiDownload className="text-xs" /></button>
                <button onClick={exportStudy} className="p-1.5 rounded hover:bg-white/5" title="Export study JSON"><FiSave className="text-xs" /></button>
                <button onClick={() => deleteStudy(selected.id)} className="p-1.5 rounded hover:bg-white/5" style={{ color: '#ef4444' }} title="Delete"><FiTrash2 className="text-xs" /></button>
              </div>
            </>
          ) : (
            <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>No study selected — upload an image or pick one from the browser</div>
          )}
        </div>

        {/* Canvas / Multi-view */}
        <div className="flex-1 relative overflow-hidden" style={{ background: '#000' }}>
          {selected ? (
            viewLayout === 'quad' ? (
              /* ── Quad View: Axial + Coronal + Sagittal + Info ── */
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', width: '100%', height: '100%', gap: 2 }}>
                {/* Top-left: Axial (main) */}
                <div style={{ position: 'relative', overflow: 'hidden', borderRight: '1px solid #333', borderBottom: '1px solid #333' }}>
                  <canvas
                    ref={canvasRef}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={() => setDrawing(null)}
                    style={{ width: '100%', height: '100%', cursor: tool === 'pan' ? 'grab' : 'crosshair' }}
                  />
                  <div style={{ position: 'absolute', top: 6, left: 8, color: '#3b82f6', fontSize: 11, fontWeight: 700, textShadow: '0 1px 3px #000' }}>AXIAL</div>
                  <div style={{ position: 'absolute', bottom: 6, left: 8 }}>
                    <input type="range" min={0} max={100} value={slicePos.axial} onChange={e => setSlicePos(p => ({ ...p, axial: Number(e.target.value) }))}
                      style={{ width: 80, accentColor: '#3b82f6' }} title="Axial slice" />
                    <span style={{ color: '#fff8', fontSize: 9, marginLeft: 4 }}>Z:{slicePos.axial}%</span>
                  </div>
                </div>
                {/* Top-right: Coronal */}
                <div style={{ position: 'relative', overflow: 'hidden', borderBottom: '1px solid #333' }}>
                  <canvas ref={coronalRef} style={{ width: '100%', height: '100%' }} />
                  <div style={{ position: 'absolute', bottom: 6, left: 8 }}>
                    <input type="range" min={0} max={100} value={slicePos.coronal} onChange={e => setSlicePos(p => ({ ...p, coronal: Number(e.target.value) }))}
                      style={{ width: 80, accentColor: '#22c55e' }} title="Coronal slice" />
                    <span style={{ color: '#fff8', fontSize: 9, marginLeft: 4 }}>Y:{slicePos.coronal}%</span>
                  </div>
                </div>
                {/* Bottom-left: Sagittal */}
                <div style={{ position: 'relative', overflow: 'hidden', borderRight: '1px solid #333' }}>
                  <canvas ref={sagittalRef} style={{ width: '100%', height: '100%' }} />
                  <div style={{ position: 'absolute', bottom: 6, left: 8 }}>
                    <input type="range" min={0} max={100} value={slicePos.sagittal} onChange={e => setSlicePos(p => ({ ...p, sagittal: Number(e.target.value) }))}
                      style={{ width: 80, accentColor: '#ef4444' }} title="Sagittal slice" />
                    <span style={{ color: '#fff8', fontSize: 9, marginLeft: 4 }}>X:{slicePos.sagittal}%</span>
                  </div>
                </div>
                {/* Bottom-right: 3D Overview / Info */}
                <div style={{ position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#0a0a0f' }}>
                  <div style={{ color: '#fff6', fontSize: 10, textAlign: 'center', padding: 16 }}>
                    <FiLayers style={{ fontSize: 28, margin: '0 auto 8px', opacity: 0.3 }} />
                    <div style={{ fontWeight: 700, fontSize: 11, color: '#fff', marginBottom: 4 }}>Volume Info</div>
                    <div>Size: {selected.width} x {selected.height}</div>
                    <div>Modality: {selected.modality}</div>
                    <div>W/L: {selected.windowCenter}/{selected.windowWidth}</div>
                    <div>Filter: {selected.filter}</div>
                    {selected.pixelSpacing && <div>Spacing: {selected.pixelSpacing} mm/px</div>}
                    <div style={{ marginTop: 8, display: 'flex', gap: 12, justifyContent: 'center', fontSize: 10 }}>
                      <span style={{ color: '#3b82f6' }}>&#9632; Axial</span>
                      <span style={{ color: '#22c55e' }}>&#9632; Coronal</span>
                      <span style={{ color: '#ef4444' }}>&#9632; Sagittal</span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* ── Single View ── */
              <canvas
                ref={canvasRef}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={() => setDrawing(null)}
                style={{ width: '100%', height: '100%', cursor: tool === 'pan' ? 'grab' : 'crosshair' }}
              />
            )
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
              { id: 'tools' as const, label: 'Tools', icon: FiSliders },
              { id: 'analysis' as const, label: 'Analysis', icon: FiBarChart2 },
              { id: 'register' as const, label: 'Register', icon: FiCpu },
              { id: 'labels' as const, label: 'Labels', icon: FiLayers },
              { id: 'annotations' as const, label: 'Marks', icon: FiTarget },
            ]).map(t => {
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
                  <div className="text-[9px] font-medium mt-2 mb-1" style={{ color: 'var(--color-text-muted)', opacity: 0.7 }}>Presets</div>
                  <div className="flex flex-wrap gap-1">
                    {WINDOW_PRESETS
                      .filter(p => p.modalities.length === 0 || p.modalities.includes(selected.modality))
                      .map(p => (
                        <button
                          key={p.label}
                          onClick={() => updateStudy({ ...selected, windowCenter: p.center, windowWidth: p.width })}
                          className="px-1.5 py-0.5 text-[9px] rounded transition-all"
                          style={{
                            background: selected.windowCenter === p.center && selected.windowWidth === p.width
                              ? 'var(--color-accent-blue)' : 'transparent',
                            color: selected.windowCenter === p.center && selected.windowWidth === p.width
                              ? '#fff' : 'var(--color-text-muted)',
                            border: '1px solid var(--glass-border)',
                          }}
                        >
                          {p.label}
                        </button>
                      ))}
                  </div>
                </div>

                {/* Filters - grouped */}
                <div>
                  <div className="text-[10px] uppercase font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
                    <FiFilter className="inline mr-1" />
                    Preprocessing & Filters
                  </div>
                  {(() => {
                    const groups = [...new Set(FILTERS.map(f => f.group))]
                    return groups.map(group => (
                      <div key={group} style={{ marginBottom: 6 }}>
                        <div className="text-[9px] font-medium mb-1" style={{ color: 'var(--color-text-muted)', opacity: 0.7 }}>{group}</div>
                        <div className="grid grid-cols-2 gap-1">
                          {FILTERS.filter(f => f.group === group).map(f => (
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
                    ))
                  })()}
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
                    <div className="flex justify-between"><span style={{ color: 'var(--color-text-muted)' }}>SNR est.</span><span>{(analysisStats.mean / Math.max(analysisStats.std, 0.1)).toFixed(1)} dB</span></div>
                    <div className="flex justify-between"><span style={{ color: 'var(--color-text-muted)' }}>Entropy</span><span>{(() => {
                      const total = analysisStats.histogram.reduce((a, b) => a + b, 0)
                      let entropy = 0
                      for (const h of analysisStats.histogram) { if (h > 0) { const p = h / total; entropy -= p * Math.log2(p) } }
                      return entropy.toFixed(2)
                    })()} bits</span></div>
                    <div className="flex justify-between"><span style={{ color: 'var(--color-text-muted)' }}>Annotated regions</span><span>{selected.annotations.length}</span></div>
                    <div className="flex justify-between"><span style={{ color: 'var(--color-text-muted)' }}>Dimensions</span><span>{selected.width} x {selected.height}</span></div>
                    {selected.pixelSpacing && (
                      <div className="flex justify-between"><span style={{ color: 'var(--color-text-muted)' }}>Physical size</span><span>{(selected.width * selected.pixelSpacing).toFixed(1)} x {(selected.height * selected.pixelSpacing).toFixed(1)} mm</span></div>
                    )}
                  </div>
                </div>

                {/* ROI analysis for annotated rectangles */}
                {selected.annotations.filter(a => a.type === 'rect' && a.w && a.h).length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
                      <FiTarget className="inline mr-1" />
                      ROI Analysis
                    </div>
                    <div className="space-y-2">
                      {selected.annotations.filter(a => a.type === 'rect' && a.w && a.h).map(a => {
                        const img = imgCacheRef.current
                        if (!img) return null
                        const off = document.createElement('canvas')
                        off.width = img.width; off.height = img.height
                        const ctx = off.getContext('2d')!
                        ctx.drawImage(img, 0, 0)
                        const x1 = Math.max(0, Math.floor(a.x)), y1 = Math.max(0, Math.floor(a.y))
                        const w = Math.min(img.width - x1, Math.floor(a.w!)), h = Math.min(img.height - y1, Math.floor(a.h!))
                        if (w <= 0 || h <= 0) return null
                        const roiData = ctx.getImageData(x1, y1, w, h)
                        const roiStats = computeImageStats(roiData.data)
                        return (
                          <div key={a.id} className="p-1.5 rounded text-[10px]" style={{ background: 'var(--color-bg)', border: `1px solid ${a.color}40` }}>
                            <div className="flex items-center gap-1.5 mb-1">
                              <div className="w-2 h-2 rounded-sm" style={{ background: a.color }} />
                              <span className="font-medium">{a.label}</span>
                              <span style={{ color: 'var(--color-text-muted)' }}>{w}x{h} px</span>
                            </div>
                            <div className="grid grid-cols-2 gap-x-2 text-[9px]" style={{ color: 'var(--color-text-muted)' }}>
                              <span>Mean: {roiStats.mean.toFixed(1)}</span>
                              <span>Std: {roiStats.std.toFixed(1)}</span>
                              <span>Min: {roiStats.min.toFixed(0)}</span>
                              <span>Max: {roiStats.max.toFixed(0)}</span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </>
            )}

            {showPanel === 'labels' && (
              <div>
                <div className="text-[10px] uppercase font-semibold mb-2" style={{ color: 'var(--color-text-muted)' }}>
                  <FiLayers className="inline mr-1" />
                  Label Definitions
                </div>
                <p className="text-[10px] mb-3" style={{ color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
                  Define semantic labels for regions of interest. Labels appear as colored overlays during annotation.
                </p>

                {/* Existing labels */}
                <div className="space-y-1 mb-3">
                  {(selected.labels || []).map(label => (
                    <div key={label.id} className="flex items-center gap-2 p-1.5 rounded" style={{ background: 'var(--color-bg)', border: '1px solid var(--glass-border)' }}>
                      <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: label.color }} />
                      <span className="text-[11px] flex-1 truncate">{label.name}</span>
                      <button
                        onClick={() => {
                          const labels = (selected.labels || []).map(l => l.id === label.id ? { ...l, visible: !l.visible } : l)
                          updateStudy({ ...selected, labels })
                        }}
                        className="p-0.5"
                        title={label.visible ? 'Hide' : 'Show'}
                        style={{ color: label.visible ? 'var(--color-text)' : 'var(--color-text-muted)', opacity: label.visible ? 1 : 0.4 }}
                      >
                        <FiEye className="text-[10px]" />
                      </button>
                      <button
                        onClick={() => {
                          // Use label color for annotations
                          setAnnotColor(label.color)
                          setAnnotLabel(label.name)
                        }}
                        className="p-0.5"
                        title="Use for annotation"
                        style={{ color: 'var(--color-text-muted)' }}
                      >
                        <FiCrosshair className="text-[10px]" />
                      </button>
                      <button
                        onClick={() => {
                          const labels = (selected.labels || []).filter(l => l.id !== label.id)
                          updateStudy({ ...selected, labels })
                        }}
                        className="p-0.5 hover:text-red-500"
                        style={{ color: 'var(--color-text-muted)' }}
                      >
                        <FiX className="text-[10px]" />
                      </button>
                    </div>
                  ))}
                </div>

                {/* Create label */}
                <button
                  onClick={() => {
                    const defaultColors = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16']
                    const existing = (selected.labels || []).length
                    const newLabel: LabelDef = {
                      id: crypto.randomUUID(),
                      name: `Label ${existing + 1}`,
                      color: defaultColors[existing % defaultColors.length],
                      visible: true,
                    }
                    updateStudy({ ...selected, labels: [...(selected.labels || []), newLabel] })
                  }}
                  className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 text-[10px] rounded transition-all"
                  style={{ background: 'transparent', border: '1px dashed var(--glass-border)', color: 'var(--color-text-muted)' }}
                >
                  <FiPlus className="text-[10px]" /> Create Label Definition
                </button>

                {/* Segmentation info */}
                <div className="mt-4 p-2 rounded text-[10px]" style={{ background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.15)', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                  <strong style={{ color: 'var(--color-text)' }}>Segmentation Workflow:</strong><br />
                  1. Create labels for each region (e.g., Right_Lung, Left_Lung)<br />
                  2. Click the crosshair icon to activate a label<br />
                  3. Use Rectangle/Circle tools to mark regions<br />
                  4. Apply Otsu Threshold or Canny for edge-based segmentation<br />
                  5. Use morphological filters (Open/Close) to clean up
                </div>
              </div>
            )}

            {showPanel === 'register' && (
              <div className="space-y-3">
                <div className="text-[10px] uppercase font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
                  <FiCpu className="inline mr-1" />
                  Image Registration
                </div>

                {/* Registration mode */}
                <div>
                  <div className="text-[10px] mb-1" style={{ color: 'var(--color-text-muted)' }}>Transform Type</div>
                  <div className="grid grid-cols-2 gap-1">
                    {(['translation', 'rigid', 'similarity', 'affine'] as const).map(mode => (
                      <button
                        key={mode}
                        onClick={() => setRegMode(mode)}
                        className="px-2 py-1.5 text-[10px] rounded capitalize"
                        style={{
                          background: regMode === mode ? 'var(--color-accent-blue)22' : 'var(--color-bg)',
                          border: `1px solid ${regMode === mode ? 'var(--color-accent-blue)' : 'var(--glass-border)'}`,
                          color: regMode === mode ? 'var(--color-accent-blue)' : 'var(--color-text-muted)',
                        }}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                  <div className="text-[9px] mt-1" style={{ color: 'var(--color-text-muted)' }}>
                    {regMode === 'translation' && 'X/Y shift only (2 DOF)'}
                    {regMode === 'rigid' && 'Translation + rotation (3 DOF)'}
                    {regMode === 'similarity' && 'Translation + rotation + uniform scale (4 DOF)'}
                    {regMode === 'affine' && 'Full affine: translation + rotation + scale + shear (6 DOF)'}
                  </div>
                </div>

                {/* Reference image selection */}
                <div>
                  <div className="text-[10px] mb-1" style={{ color: 'var(--color-text-muted)' }}>Reference (Fixed) Image</div>
                  <select
                    value={regRefId || ''}
                    onChange={e => setRegRefId(e.target.value || null)}
                    className="w-full px-2 py-1.5 text-xs rounded outline-none"
                    style={{ background: 'var(--color-bg)', border: '1px solid var(--glass-border)', color: 'var(--color-text)' }}
                  >
                    <option value="">Select reference...</option>
                    {studies.filter(s => s.id !== selected.id).map(s => (
                      <option key={s.id} value={s.id}>{s.title}</option>
                    ))}
                  </select>
                  <div className="text-[9px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                    Current image = moving, reference = fixed target
                  </div>
                </div>

                {/* Transform controls */}
                <div>
                  <div className="text-[10px] uppercase font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>Transform Parameters</div>

                  <label className="text-[10px] block mb-0.5" style={{ color: 'var(--color-text-muted)' }}>
                    Translate X: {regTransform.tx.toFixed(1)} px
                  </label>
                  <input type="range" min={-200} max={200} step={1} value={regTransform.tx}
                    onChange={e => setRegTransform(t => ({ ...t, tx: Number(e.target.value) }))} className="w-full" />

                  <label className="text-[10px] block mb-0.5 mt-1.5" style={{ color: 'var(--color-text-muted)' }}>
                    Translate Y: {regTransform.ty.toFixed(1)} px
                  </label>
                  <input type="range" min={-200} max={200} step={1} value={regTransform.ty}
                    onChange={e => setRegTransform(t => ({ ...t, ty: Number(e.target.value) }))} className="w-full" />

                  {(regMode !== 'translation') && (
                    <>
                      <label className="text-[10px] block mb-0.5 mt-1.5" style={{ color: 'var(--color-text-muted)' }}>
                        Rotation: {regTransform.rotation.toFixed(1)}°
                      </label>
                      <input type="range" min={-180} max={180} step={0.5} value={regTransform.rotation}
                        onChange={e => setRegTransform(t => ({ ...t, rotation: Number(e.target.value) }))} className="w-full" />
                    </>
                  )}

                  {(regMode === 'similarity' || regMode === 'affine') && (
                    <>
                      <label className="text-[10px] block mb-0.5 mt-1.5" style={{ color: 'var(--color-text-muted)' }}>
                        Scale: {regTransform.scale.toFixed(2)}x
                      </label>
                      <input type="range" min={0.25} max={4} step={0.01} value={regTransform.scale}
                        onChange={e => setRegTransform(t => ({ ...t, scale: Number(e.target.value) }))} className="w-full" />
                    </>
                  )}
                </div>

                {/* Overlay controls */}
                <div>
                  <div className="text-[10px] uppercase font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>Overlay</div>
                  <label className="flex items-center gap-2 text-[10px] cursor-pointer mb-1" style={{ color: 'var(--color-text-muted)' }}>
                    <input type="checkbox" checked={regShowOverlay} onChange={e => setRegShowOverlay(e.target.checked)} className="rounded" />
                    Show reference overlay
                  </label>
                  {regShowOverlay && (
                    <>
                      <label className="text-[10px] block mb-0.5" style={{ color: 'var(--color-text-muted)' }}>
                        Opacity: {(regOverlayOpacity * 100).toFixed(0)}%
                      </label>
                      <input type="range" min={0} max={1} step={0.05} value={regOverlayOpacity}
                        onChange={e => setRegOverlayOpacity(Number(e.target.value))} className="w-full" />
                    </>
                  )}
                </div>

                {/* Action buttons */}
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => setRegTransform({ tx: 0, ty: 0, rotation: 0, scale: 1 })}
                    className="flex-1 px-2 py-1.5 text-[10px] rounded"
                    style={{ background: 'var(--color-bg)', border: '1px solid var(--glass-border)', color: 'var(--color-text-muted)' }}
                  >
                    Reset
                  </button>
                  <button
                    onClick={() => {
                      if (!selected) return
                      // Apply transform: re-render the image with the current transform baked in
                      const img = imgCacheRef.current
                      if (!img) return
                      const off = document.createElement('canvas')
                      off.width = img.width; off.height = img.height
                      const ctx = off.getContext('2d')!
                      ctx.fillStyle = '#000'
                      ctx.fillRect(0, 0, off.width, off.height)
                      const cx = img.width / 2, cy = img.height / 2
                      ctx.translate(cx + regTransform.tx, cy + regTransform.ty)
                      ctx.rotate((regTransform.rotation * Math.PI) / 180)
                      ctx.scale(regTransform.scale, regTransform.scale)
                      ctx.drawImage(img, -cx, -cy)
                      const dataUrl = off.toDataURL('image/png')
                      updateStudy({ ...selected, imageData: dataUrl })
                      setRegTransform({ tx: 0, ty: 0, rotation: 0, scale: 1 })
                    }}
                    className="flex-1 px-2 py-1.5 text-[10px] rounded font-medium"
                    style={{ background: 'var(--color-accent-blue)', color: '#fff' }}
                  >
                    Apply Transform
                  </button>
                </div>

                {/* Info */}
                <div className="text-[9px] p-2 rounded" style={{ background: 'var(--color-bg)', border: '1px solid var(--glass-border)', color: 'var(--color-text-muted)' }}>
                  <strong>Registration workflow:</strong><br />
                  1. Select a reference (fixed) image from another study<br />
                  2. Choose transform type (translation/rigid/similarity/affine)<br />
                  3. Adjust transform parameters using sliders<br />
                  4. Toggle overlay to compare alignment visually<br />
                  5. Click "Apply Transform" to bake the transform into the image
                </div>
              </div>
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
