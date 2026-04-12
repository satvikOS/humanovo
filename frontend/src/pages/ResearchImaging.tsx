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
import VolumeViewer3D from '../components/VolumeViewer3D'
import { useAlertDialog } from '../components/AlertDialog'

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
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)) } catch { /* quota exceeded */ }
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
    let maxMag = 0
    for (let i = 0; i < mag.length; i++) { if (isFinite(mag[i]) && mag[i] > maxMag) maxMag = mag[i] }
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
  if (n === 0) return { mean: 0, std: 0, min: 0, max: 0, histogram: hist }
  const mean = sum / n
  const variance = sumSq / n - mean * mean
  return { mean, std: Math.sqrt(Math.max(0, variance)), min: mn, max: mx, histogram: hist }
}

/* ═══ Main Component ═══════════════════════════════════════════════════ */
export default function ResearchImaging() {
  const { showConfirm, AlertDialog } = useAlertDialog()
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
  const [brushSize, setBrushSize] = useState(8)
  const [segMask, setSegMask] = useState<Uint8Array | null>(null) // per-pixel label mask
  const [isPainting, setIsPainting] = useState(false)
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null)
  const [aiLoading, setAiLoading] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const coronalRef = useRef<HTMLCanvasElement>(null)
  const sagittalRef = useRef<HTMLCanvasElement>(null)
  const imgCacheRef = useRef<HTMLImageElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const studiesRef = useRef<Study[]>(studies)
  const segMaskRef = useRef<Uint8Array | null>(segMask)
  const renderingRef = useRef(false)

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

  // Persist studies + keep refs in sync (refs used inside renderCanvas to
  // avoid creating a new callback identity on every study mutation, which
  // combined with the render-canvas effect caused a render cascade that
  // could exhaust the JS stack during rapid interactions like a W/L drag).
  useEffect(() => { studiesRef.current = studies; saveStudies(studies) }, [studies])
  useEffect(() => { segMaskRef.current = segMask }, [segMask])

  // Track image-loaded generation to trigger re-render after img.onload
  const [imgGeneration, setImgGeneration] = useState(0)

  // Load image when selection changes
  useEffect(() => {
    if (!selected) { imgCacheRef.current = null; return }
    const img = new Image()
    img.onload = () => { imgCacheRef.current = img; setImgGeneration(g => g + 1) }
    img.src = selected.imageData
    setZoom(1); setPan({ x: 0, y: 0 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  // Viewer keyboard shortcuts — radiologist-style single-key tool swap
  // plus zoom / reset / study-nav. Swallowed while the user is typing
  // into a text input so it never fights with search / annotation labels.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
        (e.target as HTMLElement | null)?.isContentEditable
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return

      const key = e.key
      // Tool swap
      const toolMap: Record<string, Tool> = {
        p: 'pan', r: 'rect', c: 'circle', l: 'line',
        '.': 'point', m: 'measure', u: 'ruler',
        b: 'brush', x: 'eraser', w: 'window',
      }
      if (toolMap[key]) { e.preventDefault(); setTool(toolMap[key]); return }

      // Zoom / reset
      if (key === '+' || key === '=') { e.preventDefault(); setZoom(z => Math.min(8, z * 1.2)); return }
      if (key === '-' || key === '_') { e.preventDefault(); setZoom(z => Math.max(0.1, z / 1.2)); return }
      if (key === '0') { e.preventDefault(); setZoom(1); setPan({ x: 0, y: 0 }); return }

      // Layout toggle
      if (key === 'f' || key === 'F') {
        e.preventDefault()
        setViewLayout(v => v === 'single' ? 'quad' : 'single')
        return
      }

      // Study navigation within the filtered list
      if (key === '[' || key === ']') {
        if (filteredStudies.length === 0) return
        e.preventDefault()
        const curIdx = filteredStudies.findIndex(s => s.id === selectedId)
        const delta = key === ']' ? 1 : -1
        const nextIdx = curIdx < 0
          ? 0
          : (curIdx + delta + filteredStudies.length) % filteredStudies.length
        setSelectedId(filteredStudies[nextIdx].id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [filteredStudies, selectedId])

  // Render orthogonal views (coronal / sagittal) in quad mode
  useEffect(() => {
    if (viewLayout !== 'quad') return
    const img = imgCacheRef.current
    if (!img || !selected) return
    if (img.width <= 0 || img.height <= 0) return

    try {

    // Get processed image data
    const off = document.createElement('canvas')
    off.width = img.width; off.height = img.height
    const offCtx = off.getContext('2d')
    if (!offCtx) return
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
      const cCtx = coronalCanvas.getContext('2d')
      if (!cCtx) return
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
      const sCtx = sagittalCanvas.getContext('2d')
      if (!sCtx) return
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
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[ResearchImaging] orthogonal view render failed:', err)
    }
  }, [viewLayout, selected, slicePos, imgGeneration])

  const renderCanvas = useCallback(() => {
    // Re-entrancy guard: if a previous render is still in flight (e.g. a
    // synchronous state update triggered during canvas draw) bail out so
    // we don't recurse the call stack.
    if (renderingRef.current) return
    const canvas = canvasRef.current
    const img = imgCacheRef.current
    if (!canvas || !img || !selected) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    renderingRef.current = true
    try {

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
    const offCtx = off.getContext('2d')
    if (!offCtx) { renderingRef.current = false; return }
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

    // Draw segmentation mask overlay (read from ref to avoid triggering
    // renderCanvas recreation on every brush stroke)
    const segMaskLocal = segMaskRef.current
    if (segMaskLocal && selected) {
      const labels = selected.labels || []
      const maskCanvas = document.createElement('canvas')
      maskCanvas.width = img.width
      maskCanvas.height = img.height
      const mCtx = maskCanvas.getContext('2d')
      if (!mCtx) { renderingRef.current = false; return }
      const mData = mCtx.createImageData(img.width, img.height)
      for (let i = 0; i < segMaskLocal.length; i++) {
        const labelIdx = segMaskLocal[i]
        if (labelIdx === 0) continue
        const label = labels[labelIdx - 1]
        if (label && !label.visible) continue
        const hex = label?.color || annotColor
        const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16)
        const pi = i * 4
        mData.data[pi] = r; mData.data[pi + 1] = g; mData.data[pi + 2] = b; mData.data[pi + 3] = 100
      }
      mCtx.putImageData(mData, 0, 0)
      ctx.drawImage(maskCanvas, offsetX, offsetY, drawW, drawH)
    }

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

    // Draw registration overlay — use a synchronous approach to avoid
    // stale canvas context from async image loads.
    if (regShowOverlay && regRefId) {
      const refStudy = studiesRef.current.find(s => s.id === regRefId)
      if (refStudy) {
        try {
          // Re-use a pre-decoded image via an offscreen canvas to avoid
          // the async Image.onload problem that causes stale ctx usage.
          const refOff = document.createElement('canvas')
          const refTmpImg = new Image()
          refTmpImg.src = refStudy.imageData
          // Only draw if the image is already cached/decoded (width > 0)
          if (refTmpImg.complete && refTmpImg.naturalWidth > 0) {
            refOff.width = refTmpImg.naturalWidth
            refOff.height = refTmpImg.naturalHeight
            const rOffCtx = refOff.getContext('2d')
            if (rOffCtx) {
              rOffCtx.drawImage(refTmpImg, 0, 0)
              ctx.save()
              ctx.globalAlpha = regOverlayOpacity
              const cx = dispW / 2
              const cy = dispH / 2
              ctx.translate(cx + regTransform.tx * scale, cy + regTransform.ty * scale)
              ctx.rotate((regTransform.rotation * Math.PI) / 180)
              ctx.scale(regTransform.scale, regTransform.scale)
              const refScale = Math.min(dispW / refTmpImg.naturalWidth, dispH / refTmpImg.naturalHeight) * zoom
              const rw = refTmpImg.naturalWidth * refScale
              const rh = refTmpImg.naturalHeight * refScale
              ctx.drawImage(refOff, -rw / 2, -rh / 2, rw, rh)
              ctx.restore()
              ctx.fillStyle = '#f59e0b'
              ctx.font = 'bold 10px sans-serif'
              ctx.fillText(`REF: ${refStudy.title}`, 8, dispH - 8)
            }
          }
        } catch (e) {
          // Silently ignore registration overlay errors
        }
      }
    }
    } catch (err) {
      // Swallow canvas render errors (e.g. getImageData OOM on huge images,
      // tainted canvas from external data URLs) so a malformed study does
      // not crash the entire imaging page.
      // eslint-disable-next-line no-console
      console.warn('[ResearchImaging] renderCanvas failed:', err)
    } finally {
      renderingRef.current = false
    }
  }, [selected, zoom, pan, drawing, tool, annotColor, regShowOverlay, regRefId, regTransform, regOverlayOpacity])

  // Re-render when zoom/pan/window/filter/annotations or image load changes.
  // Also re-render on segMask generation so brush strokes paint live. The
  // segMask itself is read via ref inside renderCanvas to keep the callback
  // identity stable.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { renderCanvas() }, [renderCanvas, imgGeneration, segMask])

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

  // ── Brush / Eraser painting ──────────────────────────────────
  const paintAt = useCallback((px: number, py: number) => {
    if (!selected) return
    const w = selected.width, h = selected.height
    const mask = segMask || new Uint8Array(w * h)
    const radius = brushSize
    const isBrush = tool === 'brush'
    const labelIdx = isBrush ? ((selected.labels || []).findIndex(l => l.name === annotLabel) + 1) || 1 : 0
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy > radius * radius) continue
        const ix = Math.round(px + dx), iy = Math.round(py + dy)
        if (ix < 0 || ix >= w || iy < 0 || iy >= h) continue
        mask[iy * w + ix] = labelIdx
      }
    }
    setSegMask(new Uint8Array(mask))
  }, [selected, segMask, brushSize, tool, annotLabel])

  // ── Cursor position overlay for pixel info ───────────────────
  const [cursorInfo, setCursorInfo] = useState<{ x: number; y: number; intensity: number } | null>(null)

  // ── Drag state for pan and window/level ──────────────────────
  const dragStartRef = useRef<{ x: number; y: number; panX: number; panY: number; wc: number; ww: number; button: number } | null>(null)

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!selected) return
    // Right-button drag → window/level adjustment (standard DICOM interaction)
    if (e.button === 2) {
      e.preventDefault()
      dragStartRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y, wc: selected.windowCenter, ww: selected.windowWidth, button: 2 }
      return
    }
    // Middle-button or pan tool → drag to pan
    if (e.button === 1 || tool === 'pan') {
      e.preventDefault()
      dragStartRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y, wc: 0, ww: 0, button: 0 }
      return
    }
    const p = screenToImage(e)
    if (!p) return
    if (tool === 'brush' || tool === 'eraser') {
      setIsPainting(true)
      paintAt(p.x, p.y)
      return
    }
    if (tool === 'point') {
      const ann: Annotation = { id: crypto.randomUUID(), type: 'point', x: p.x, y: p.y, label: annotLabel, color: annotColor }
      updateStudy({ ...selected, annotations: [...selected.annotations, ann] })
    } else {
      setDrawing({ start: p, current: p })
    }
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    // Update cursor pixel info
    const imgP = screenToImage(e)
    if (imgP && selected) {
      const img = imgCacheRef.current
      if (img) {
        const px = Math.floor(imgP.x), py = Math.floor(imgP.y)
        if (px >= 0 && px < img.width && py >= 0 && py < img.height) {
          try {
            const off = document.createElement('canvas')
            off.width = img.width; off.height = img.height
            const ctx = off.getContext('2d')
            if (ctx) {
              ctx.drawImage(img, 0, 0)
              const pixel = ctx.getImageData(px, py, 1, 1).data
              setCursorInfo({ x: px, y: py, intensity: Math.round((pixel[0] + pixel[1] + pixel[2]) / 3) })
            }
          } catch { setCursorInfo(null) }
        } else {
          setCursorInfo(null)
        }
      }
    } else {
      setCursorInfo(null)
    }

    // Handle drag operations
    if (dragStartRef.current) {
      const ds = dragStartRef.current
      if (ds.button === 2 && selected) {
        // Right-drag: window/level (horizontal = width, vertical = center)
        const dx = e.clientX - ds.x
        const dy = e.clientY - ds.y
        updateStudy({ ...selected, windowWidth: Math.max(1, ds.ww + dx), windowCenter: ds.wc - dy })
      } else {
        // Pan drag
        setPan({ x: ds.panX + (e.clientX - ds.x), y: ds.panY + (e.clientY - ds.y) })
      }
      return
    }

    if (isPainting && (tool === 'brush' || tool === 'eraser')) {
      const p = screenToImage(e)
      if (p) paintAt(p.x, p.y)
      return
    }
    if (!drawing) return
    const p = screenToImage(e)
    if (!p) return
    setDrawing({ ...drawing, current: p })
  }

  const handleMouseUp = () => {
    dragStartRef.current = null
    if (isPainting) { setIsPainting(false); return }
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

  // ── Mouse wheel zoom (centered on cursor) ───────────────────
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? -0.15 : 0.15
    setZoom(z => Math.max(0.1, Math.min(10, z + delta * z)))
  }, [])

  const updateStudy = (s: Study) => {
    setStudies(prev => prev.map(x => x.id === s.id ? s : x))
  }

  const deleteStudy = async (id: string) => {
    const ok = await showConfirm('Delete this study? This cannot be undone.', 'Delete Study', 'Delete Permanently', 'Cancel')
    if (!ok) return
    setStudies(prev => prev.filter(s => s.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  const deleteAnnotation = (annId: string) => {
    if (!selected) return
    updateStudy({ ...selected, annotations: selected.annotations.filter(a => a.id !== annId) })
  }

  const [uploadError, setUploadError] = useState<string | null>(null)

  const inferModality = (filename: string, width?: number, height?: number, mimeType?: string): Modality => {
    const n = filename.toLowerCase()
    // Check filename patterns first
    if (n.includes('ct') || n.includes('scan')) return 'CT'
    if (n.includes('mr') || n.includes('mri') || n.includes('t1w') || n.includes('t2w') || n.includes('flair')) return 'MRI'
    if (n.includes('xray') || n.includes('x-ray') || n.includes('cr_') || n.includes('radiograph')) return 'X-Ray'
    if (n.includes('us') || n.includes('ultra') || n.includes('echo') || n.includes('sonogram')) return 'Ultrasound'
    if (n.includes('pet') || n.includes('fdg') || n.includes('spect')) return 'PET'
    if (n.includes('mam') || n.includes('breast') || n.includes('tomo')) return 'Mammography'
    if (n.includes('oct') || n.includes('optical_coherence')) return 'OCT'
    if (n.includes('fundus') || n.includes('retin') || n.includes('optic_disc')) return 'Fundus'
    if (n.includes('micro') || n.includes('histo') || n.includes('pathol') || n.includes('slide') || n.includes('biopsy')) return 'Microscopy'
    if (n.includes('endo') || n.includes('colon') || n.includes('gastro')) return 'Endoscopy'
    // Check file extension patterns
    if (n.endsWith('.dcm') || n.endsWith('.dicom')) return 'CT'
    if (n.endsWith('.nii') || n.endsWith('.nii.gz')) return 'MRI'
    // Check MIME type for DICOM
    if (mimeType === 'application/dicom') return 'CT'
    // Infer from image dimensions (heuristics)
    if (width && height) {
      const aspect = width / height
      // Mammography tends to be tall/narrow
      if (aspect < 0.6 && width > 1500) return 'Mammography'
      // Fundus images tend to be roughly square and high-res
      if (aspect > 0.9 && aspect < 1.1 && width > 2000) return 'Fundus'
      // Microscopy slides tend to be very high resolution
      if (width > 4000 || height > 4000) return 'Microscopy'
    }
    return 'X-Ray' // Default to X-Ray for generic images rather than CT
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
          const validModality: Modality = (MODALITIES.find(m => m.id === modality)?.id) || inferModality(file.name, parsed.width, parsed.height, file.type)
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
          modality: inferModality(file.name, img.width, img.height, file.type),
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
    const ctx = off.getContext('2d')
    if (!ctx) return null
    try {
      ctx.drawImage(img, 0, 0)
      const imgData = ctx.getImageData(0, 0, img.width, img.height)
      return computeImageStats(imgData.data)
    } catch {
      // Tainted canvas, zero-size image, or out-of-memory - fall back to null
      return null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, selected?.annotations.length, imgGeneration])

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

  const runAiAnalysis = async () => {
    if (!selected) return
    setAiLoading(true)
    setAiAnalysis(null)
    try {
      // Get the canvas as a base64 image (with current windowing/filter applied)
      const canvas = canvasRef.current
      if (!canvas) throw new Error('No canvas available')
      const dataUrl = canvas.toDataURL('image/png')
      const base64 = dataUrl.split(',')[1]

      const response = await fetch('/api/v1/imaging/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_base64: base64,
          modality: selected.modality,
          body_part: selected.bodyPart,
          width: selected.width,
          height: selected.height,
          window_center: selected.windowCenter,
          window_width: selected.windowWidth,
          filter_applied: selected.filter,
        }),
      })
      if (!response.ok) {
        const errData = await response.json().catch(() => ({ detail: response.statusText }))
        throw new Error(errData.detail || `Server error ${response.status}`)
      }
      const data = await response.json()
      if (data.analysis) {
        setAiAnalysis(data.analysis)
      } else {
        setAiAnalysis('No analysis returned. Please try again.')
      }
    } catch (err: any) {
      setAiAnalysis(`Analysis failed: ${err?.message || 'Unknown error'}`)
    }
    setAiLoading(false)
  }

  // `key` surfaces the single-key shortcut in the button title so users
  // discover it without hunting through a help dialog.
  const tools: { id: Tool; icon: typeof FiSquare; label: string; key: string }[] = [
    { id: 'pan', icon: FiMaximize2, label: 'Pan', key: 'P' },
    { id: 'rect', icon: FiSquare, label: 'Rectangle', key: 'R' },
    { id: 'circle', icon: FiCircle, label: 'Circle', key: 'C' },
    { id: 'line', icon: FiCrosshair, label: 'Line', key: 'L' },
    { id: 'point', icon: FiTarget, label: 'Point', key: '.' },
    { id: 'measure', icon: FiActivity, label: 'Measure', key: 'M' },
    { id: 'ruler', icon: FiSliders, label: 'Ruler', key: 'U' },
  ]

  const colors = ['#ef4444', '#f59e0b', '#10b981', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899']

  return (
    <div className="flex h-full" style={{ color: 'var(--color-text)' }}>
      <AlertDialog />
      {/* ── Left: Study Browser ── */}
      <div className="w-64 flex flex-col border-r flex-shrink-0" style={{ borderColor: 'var(--glass-border)', background: 'var(--glass-bg)' }}>
        <div className="p-3 border-b" style={{ borderColor: 'var(--glass-border)' }}>
          <div className="flex items-center gap-2 mb-3">
            <FiImage className="text-lg" style={{ color: 'var(--color-text)' }} />
            <h2 className="text-sm font-semibold" title="Use [ and ] to step between studies">Studies</h2>
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
        <div className="flex items-center gap-2 px-3 py-2 border-b flex-shrink-0" style={{ borderColor: 'var(--glass-border)', background: 'var(--glass-bg)', backdropFilter: 'blur(12px)' }}>
          {selected ? (
            <>
              <div className="text-xs font-semibold truncate max-w-[200px]">{selected.title}</div>
              <span className="text-[10px] px-1.5 py-0.5 rounded-md" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--color-text-muted)' }}>
                {selected.width}×{selected.height}
              </span>
              <div className="flex gap-1 ml-2">
                {tools.map(t => {
                  const Icon = t.icon
                  const active = tool === t.id
                  return (
                    <button
                      key={t.id}
                      onClick={() => setTool(t.id)}
                      className="transition-all active:scale-95"
                      style={{
                        padding: '5px 7px',
                        borderRadius: 12,
                        background: active ? 'rgba(91, 141, 184, 0.25)' : 'var(--glass-bg)',
                        border: `1px solid ${active ? 'rgba(91, 141, 184, 0.35)' : 'var(--glass-border)'}`,
                        color: active ? '#fff' : 'var(--color-text-muted)',
                        boxShadow: active ? '0 1px 4px rgba(91, 141, 184, 0.2)' : 'none',
                      }}
                      title={`${t.label} (${t.key})`}
                    >
                      <Icon className="text-xs" />
                    </button>
                  )
                })}
              </div>
              <div className="ml-auto flex items-center gap-1">
                <button onClick={() => setZoom(z => Math.max(0.2, z - 0.2))} className="btn-icon btn-ghost p-1.5 transition-all active:scale-95" title="Zoom out (-)" style={{ borderRadius: 8 }}><FiZoomOut className="text-xs" /></button>
                <span className="text-[10px] px-1.5 font-mono" style={{ color: 'var(--color-text-muted)' }}>{(zoom * 100).toFixed(0)}%</span>
                <button onClick={() => setZoom(z => Math.min(8, z + 0.2))} className="btn-icon btn-ghost p-1.5 transition-all active:scale-95" title="Zoom in (+)" style={{ borderRadius: 8 }}><FiZoomIn className="text-xs" /></button>
                <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }} className="btn-icon btn-ghost p-1.5 transition-all active:scale-95" title="Reset view (0)" style={{ borderRadius: 8 }}><FiRotateCw className="text-xs" /></button>
                <div style={{ width: 1, height: 16, background: 'var(--glass-border)', margin: '0 2px' }} />
                <button
                  onClick={() => setViewLayout(v => v === 'single' ? 'quad' : 'single')}
                  className="transition-all active:scale-95"
                  style={{
                    padding: '5px 7px', borderRadius: 12,
                    background: viewLayout === 'quad' ? 'rgba(91, 141, 184, 0.15)' : 'var(--glass-bg)',
                    border: `1px solid ${viewLayout === 'quad' ? 'rgba(91, 141, 184, 0.25)' : 'var(--glass-border)'}`,
                    color: viewLayout === 'quad' ? '#5B8DB8' : 'var(--color-text-muted)',
                  }}
                  title={viewLayout === 'quad' ? 'Single view (F)' : 'Multi-view — Axial/Coronal/Sagittal (F)'}
                >
                  <FiMaximize2 className="text-xs" />
                </button>
                <button onClick={exportImage} className="btn-icon btn-ghost p-1.5 transition-all active:scale-95" title="Export PNG" style={{ borderRadius: 8 }}><FiDownload className="text-xs" /></button>
                <button onClick={exportStudy} className="btn-icon btn-ghost p-1.5 transition-all active:scale-95" title="Export study JSON" style={{ borderRadius: 8 }}><FiSave className="text-xs" /></button>
                <button onClick={() => deleteStudy(selected.id)} className="transition-all active:scale-95" style={{ padding: '5px 7px', borderRadius: 12, background: 'rgba(176, 126, 139, 0.1)', border: '1px solid rgba(176, 126, 139, 0.15)', color: '#B07E8B' }} title="Delete"><FiTrash2 className="text-xs" /></button>
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
                    onMouseLeave={() => { setDrawing(null); setCursorInfo(null); dragStartRef.current = null }}
                    onWheel={handleWheel}
                    onContextMenu={e => e.preventDefault()}
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
                {/* Bottom-right: 3D Volume Viewer */}
                <div style={{ position: 'relative', overflow: 'hidden', background: '#06060a' }}>
                  <VolumeViewer3D
                    imageData={selected.imageData}
                    width={selected.width}
                    height={selected.height}
                    slicePos={slicePos}
                    modality={selected.modality}
                  />
                </div>
              </div>
            ) : (
              /* ── Single View ── */
              <>
                <canvas
                  ref={canvasRef}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={() => { setDrawing(null); setCursorInfo(null); dragStartRef.current = null }}
                  onWheel={handleWheel}
                  onContextMenu={e => e.preventDefault()}
                  style={{ width: '100%', height: '100%', cursor: tool === 'pan' ? 'grab' : 'crosshair' }}
                />
                {/* Pixel info overlay (bottom-left) */}
                {cursorInfo && (
                  <div style={{
                    position: 'absolute', bottom: 6, left: 8, pointerEvents: 'none',
                    background: 'rgba(0,0,0,0.7)', borderRadius: 8, padding: '3px 8px',
                    fontSize: 10, fontFamily: "'JetBrains Mono', monospace", color: '#ffffffcc',
                  }}>
                    ({cursorInfo.x}, {cursorInfo.y}) &nbsp; I={cursorInfo.intensity}
                  </div>
                )}
                {/* Window/level info overlay (bottom-right) */}
                {selected && (
                  <div style={{
                    position: 'absolute', bottom: 6, right: 8, pointerEvents: 'none',
                    background: 'rgba(0,0,0,0.7)', borderRadius: 8, padding: '3px 8px',
                    fontSize: 10, fontFamily: "'JetBrains Mono', monospace", color: '#ffffffcc',
                  }}>
                    W:{selected.windowWidth} C:{selected.windowCenter} &nbsp; {(zoom * 100).toFixed(0)}%
                  </div>
                )}
              </>
            )
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center max-w-md mx-auto">
                <FiImage className="text-6xl mx-auto mb-4 opacity-15" style={{ color: 'var(--color-text-muted)' }} />
                <p className="text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>Research Imaging Workstation</p>
                <p className="text-xs mb-4" style={{ color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
                  Upload medical images for analysis with windowing, filters, annotations,
                  segmentation, and AI-powered diagnostics via Constant AI.
                </p>
                <div className="flex flex-col items-center gap-2">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="px-5 py-2.5 rounded-md text-xs font-medium text-white transition-all hover:opacity-90"
                    style={{ background: '#5B8DB8' }}
                  >
                    <FiUpload className="inline mr-1.5" />
                    Upload Image
                  </button>
                  <p className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                    Supports DICOM, NIfTI, TIFF, JPEG, PNG, WebP, BMP, SVG
                  </p>
                </div>
                <div className="mt-6 grid grid-cols-3 gap-3 text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                  <div className="p-2 rounded" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
                    <FiSliders className="mx-auto mb-1 text-sm" />
                    <div>15 filters &amp; windowing presets</div>
                  </div>
                  <div className="p-2 rounded" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
                    <FiCpu className="mx-auto mb-1 text-sm" />
                    <div>AI analysis via Constant AI</div>
                  </div>
                  <div className="p-2 rounded" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
                    <FiLayers className="mx-auto mb-1 text-sm" />
                    <div>Multi-view &amp; 3D volume</div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Right: Tool Panel ── */}
      {selected && (
        <div className="w-72 flex flex-col border-l flex-shrink-0" style={{ borderColor: 'var(--glass-border)', background: 'var(--glass-bg)' }}>
          {/* Panel tabs */}
          <div className="flex gap-1 p-1.5" style={{ borderBottom: '1px solid var(--glass-border)' }}>
            {([
              { id: 'tools' as const, label: 'Tools', icon: FiSliders },
              { id: 'analysis' as const, label: 'Analysis', icon: FiBarChart2 },
              { id: 'register' as const, label: 'Register', icon: FiCpu },
              { id: 'labels' as const, label: 'Labels', icon: FiLayers },
              { id: 'annotations' as const, label: 'Marks', icon: FiTarget },
            ]).map(t => {
              const Icon = t.icon
              const active = showPanel === t.id
              return (
                <button
                  key={t.id}
                  onClick={() => setShowPanel(t.id)}
                  className="flex-1 flex items-center justify-center gap-1 text-[10px] font-medium transition-all active:scale-95"
                  style={{
                    padding: '5px 4px',
                    borderRadius: 10,
                    background: active ? 'rgba(91, 141, 184, 0.2)' : 'transparent',
                    border: `1px solid ${active ? 'rgba(91, 141, 184, 0.3)' : 'transparent'}`,
                    color: active ? '#5B8DB8' : 'var(--color-text-muted)',
                    boxShadow: active ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  }}
                >
                  <Icon className="text-[10px]" />
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
                      .map(p => {
                        const active = selected.windowCenter === p.center && selected.windowWidth === p.width
                        return (
                          <button
                            key={p.label}
                            onClick={() => updateStudy({ ...selected, windowCenter: p.center, windowWidth: p.width })}
                            className="px-2 py-1 text-[9px] rounded-lg transition-all active:scale-95"
                            style={{
                              background: active ? 'rgba(91, 141, 184, 0.25)' : 'var(--glass-bg)',
                              color: active ? '#fff' : 'var(--color-text-muted)',
                              border: `1px solid ${active ? 'rgba(91, 141, 184, 0.35)' : 'var(--glass-border)'}`,
                              boxShadow: active ? '0 1px 3px rgba(91, 141, 184, 0.15)' : 'none',
                            }}
                          >
                            {p.label}
                          </button>
                        )
                      })}
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
                          {FILTERS.filter(f => f.group === group).map(f => {
                            const active = selected.filter === f.id
                            return (
                              <button
                                key={f.id}
                                onClick={() => updateStudy({ ...selected, filter: f.id })}
                                className="px-2 py-1 text-[10px] rounded-lg transition-all active:scale-95"
                                style={{
                                  background: active ? 'rgba(91, 141, 184, 0.25)' : 'var(--glass-bg)',
                                  color: active ? '#fff' : 'var(--color-text-muted)',
                                  border: `1px solid ${active ? 'rgba(91, 141, 184, 0.35)' : 'var(--glass-border)'}`,
                                  boxShadow: active ? '0 1px 3px rgba(91, 141, 184, 0.15)' : 'none',
                                }}
                              >
                                {f.label}
                              </button>
                            )
                          })}
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

                {/* Brush / Eraser */}
                <div>
                  <div className="text-[10px] uppercase font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
                    Brush Segmentation
                  </div>
                  <div className="flex gap-1 mb-2">
                    <button
                      onClick={() => setTool('brush')}
                      className="flex-1 px-2 py-1.5 text-[10px] rounded"
                      style={{ background: tool === 'brush' ? 'rgba(255,255,255,0.15)' : 'transparent', color: tool === 'brush' ? '#fff' : 'var(--color-text-muted)', border: '1px solid var(--glass-border)' }}
                    >Paint</button>
                    <button
                      onClick={() => setTool('eraser')}
                      className="flex-1 px-2 py-1.5 text-[10px] rounded"
                      style={{ background: tool === 'eraser' ? '#ef4444' : 'transparent', color: tool === 'eraser' ? '#fff' : 'var(--color-text-muted)', border: '1px solid var(--glass-border)' }}
                    >Erase</button>
                  </div>
                  <label className="text-[10px] block mb-1" style={{ color: 'var(--color-text-muted)' }}>
                    Brush size: {brushSize}px
                  </label>
                  <input type="range" min={1} max={30} value={brushSize} onChange={e => setBrushSize(parseInt(e.target.value))} className="w-full" />
                  {segMask && (
                    <div className="flex gap-1 mt-2">
                      <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{segMask.filter(v => v > 0).length} pixels labeled</span>
                      <button onClick={() => setSegMask(null)} className="ml-auto text-[10px] px-1.5 py-0.5 rounded" style={{ color: '#ef4444', border: '1px solid var(--glass-border)' }}>Clear mask</button>
                    </div>
                  )}
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
                      let max = 0
                      for (const v of grouped) if (v > max) max = v
                      const safeMax = max > 0 ? max : 1
                      return grouped.map((c, i) => (
                        <div key={i} style={{
                          flex: 1,
                          height: `${(c / safeMax) * 100}%`,
                          background: 'var(--color-text)',
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
                      if (total <= 0) return '0.00'
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
                        const ctx = off.getContext('2d')
                        if (!ctx) return null
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

                {/* AI Analysis powered by Constant AI */}
                <div>
                  <div className="text-[10px] uppercase font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
                    <FiCpu className="inline mr-1" />
                    AI Analysis — Constant AI
                  </div>
                  <p className="text-[9px] mb-2" style={{ color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
                    Vision-based clinical analysis powered by Constant AI.
                    Analyzes the current view including windowing and filters.
                  </p>
                  <div className="space-y-2">
                    <button
                      onClick={runAiAnalysis}
                      disabled={aiLoading}
                      className="w-full px-3 py-2 rounded text-[11px] font-medium transition-all flex items-center justify-center gap-2"
                      style={{
                        background: aiLoading ? 'var(--glass-bg)' : '#5B8DB8',
                        color: aiLoading ? 'var(--color-text-muted)' : '#fff',
                        border: '1px solid transparent',
                        opacity: aiLoading ? 0.6 : 1,
                      }}
                    >
                      <FiCpu className="text-xs" />
                      {aiLoading ? 'Analyzing with Constant AI…' : 'Run AI Analysis'}
                    </button>
                    {aiAnalysis && (
                      <div className="p-2.5 rounded text-[10px] leading-relaxed whitespace-pre-wrap" style={{ background: 'var(--color-bg)', border: '1px solid var(--glass-border)', color: 'var(--color-text-secondary)' }}>
                        {aiAnalysis}
                      </div>
                    )}
                  </div>
                </div>
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
                          background: regMode === mode ? 'rgba(255,255,255,0.12)' : 'var(--color-bg)',
                          border: `1px solid ${regMode === mode ? 'var(--color-text)' : 'var(--glass-border)'}`,
                          color: regMode === mode ? 'var(--color-text)' : 'var(--color-text-muted)',
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
                      const ctx = off.getContext('2d')
                      if (!ctx) return
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
                    style={{ background: 'rgba(255,255,255,0.15)', color: '#fff' }}
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
