import { useState, useCallback, useRef, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  FiBarChart2, FiPlus, FiTrash2,
  FiDownload, FiUpload, FiSettings, FiX,
  FiMaximize2, FiMinimize2, FiCopy,
  FiClipboard, FiCheck, FiChevronDown,
} from 'react-icons/fi'
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  ScatterChart, Scatter, AreaChart, Area,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  FunnelChart, Funnel, LabelList,
  Treemap, ComposedChart, ErrorBar, ReferenceLine, ReferenceArea, ZAxis,
  RadialBarChart, RadialBar,
  Brush,
} from 'recharts'
import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import * as XLSX from 'xlsx'
import { getPlotBlob } from '../utils/plotExport'
import { persistGet, persistSet, formatDate, logActivity } from '../utils/persistence'
import PlotlyPlot3D, { type Chart3DType } from '../components/PlotlyPlot3D'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'
import { toast } from '../contexts/ToastContext'
import { modalBackdropProps } from '../utils/clickable'

// ─── Types ──────────────────────────────────────────────────────
interface DataPoint {
  label: string
  value: number
  category?: string
  value2?: number      // secondary series
  value3?: number      // tertiary series
  errorPlus?: number   // error bar upper
  errorMinus?: number  // error bar lower
  size?: number        // bubble size
  trend?: number       // trend line value
  ciLow?: number       // confidence-interval lower bound (computed by ciBand)
  ciHigh?: number      // confidence-interval upper bound (computed by ciBand)
}

type ChartType =
  | 'bar' | 'horizontal_bar' | 'grouped_bar' | 'stacked_bar' | 'stacked_bar_100'
  | 'line' | 'multi_line' | 'step' | 'spline'
  | 'area' | 'stacked_area' | 'stream'
  | 'pie' | 'donut' | 'radial_bar'
  | 'scatter' | 'bubble'
  | 'radar'
  | 'funnel' | 'treemap' | 'sankey'
  | 'histogram' | 'box_plot' | 'violin' | 'density'
  | 'waterfall' | 'error_bar' | 'candlestick'
  | 'heatmap' | 'stem' | 'band'
  | 'polar_area'
  | 'scatter_3d' | 'bubble_3d' | 'line_3d' | 'bar_3d'
  | 'surface_3d' | 'wireframe_3d' | 'contour_3d' | 'trisurf_3d'
  | 'quiver_3d' | 'isosurface_3d' | 'voxel_3d' | 'streamline_3d'
  | 'slice_3d' | 'stem_3d' | 'waterfall_3d' | 'ribbon_3d' | 'pie_3d'

// Publication theme presets — controls fonts, axis weight, gridline
// density, background, and tick formatting. `screen` keeps the in-app
// dark/glass aesthetic; `paper`/`nature`/`science`/`ieee` are
// journal-grade with white background, black axes, and optimized
// font metrics for column-width or full-width figures.
type PublicationTheme = 'screen' | 'paper' | 'nature' | 'science' | 'ieee'
type AspectPreset = 'free' | '16:9' | '4:3' | '3:2' | '1:1' | 'golden' | 'two-col'
type FontScale = 'small' | 'normal' | 'large' | 'huge'
type TickFormat = 'auto' | 'scientific' | 'percent' | 'currency' | 'compact' | 'plain'
type CBlindSim = 'none' | 'protanopia' | 'deuteranopia' | 'tritanopia' | 'achromatopsia'

interface ChartAnnotation {
  id: string
  axis: 'x' | 'y'
  value: number
  label: string
  color: string
  style: 'solid' | 'dashed' | 'dotted'
}

interface ChartConfig {
  id: string
  title: string
  subtitle?: string
  caption?: string
  source?: string
  type: ChartType
  data: DataPoint[]
  options: ChartOptions
  annotations: ChartAnnotation[]
  // Optional shaded reference regions (publication "highlight zones").
  // Each band shades a y-range or x-range with a label rendered at the
  // top edge — distinct from single-line annotations.
  referenceBands?: ReferenceBand[]
  // Custom palette overrides — when set, the chart uses these exact
  // hex colors regardless of which named palette is selected. Lets
  // authors hand-tune individual series colors after creating the
  // chart while preserving the muted-palette default policy.
  customPalette?: string[]
  createdAt: string
}

interface ReferenceBand {
  id: string
  axis: 'x' | 'y'
  from: number
  to: number
  label: string
  color: string  // accepts hex or var(--…)
  opacity: number
}

interface ChartOptions {
  color: string
  colorPalette: string
  xLabel: string
  yLabel: string
  zLabel?: string
  showGrid: boolean
  showLegend: boolean
  legendPosition: 'top' | 'bottom' | 'left' | 'right'
  logScaleX: boolean
  logScaleY: boolean
  lineWidth: number
  markerSize: number
  markerShape: 'circle' | 'square' | 'diamond' | 'triangle'
  fillOpacity: number
  showValues: boolean
  animate: boolean
  barGap: number
  innerRadius: number  // donut
  startAngle: number
  smooth: boolean
  showBrush: boolean
  showCrosshair: boolean
  trendLine: 'none' | 'linear' | 'movingAvg'
  showStats: boolean
  // ── Publication-grade controls ──
  pubTheme: PublicationTheme
  fontScale: FontScale
  aspect: AspectPreset
  tickFormatX: TickFormat
  tickFormatY: TickFormat
  tickCountX: number  // 0 = auto
  tickCountY: number  // 0 = auto
  decimalPlaces: number  // for tick formatting
  showTitle: boolean   // render title on the chart canvas
  showCaption: boolean // render caption + source below chart
  showCI: boolean      // confidence interval band (line / scatter / area)
  ciLevel: number      // 0.90, 0.95, 0.99
  cbSim: CBlindSim     // color-blind simulation overlay (preview only)
  watermark: string    // optional faint text overlay (e.g., DRAFT)
}

function smartDownsample(data: DataPoint[], maxPoints: number = 100): DataPoint[] {
  if (data.length <= maxPoints) return data

  // Check if data is purely numeric labels (time series)
  const isTimeSeries = data.every(d => !isNaN(Number(d.label)))

  if (isTimeSeries) {
    // Bin into groups and average
    const binSize = Math.ceil(data.length / maxPoints)
    const binned: DataPoint[] = []
    for (let i = 0; i < data.length; i += binSize) {
      const chunk = data.slice(i, i + binSize)
      const avgVal = chunk.reduce((s, d) => s + d.value, 0) / chunk.length
      const minLabel = chunk[0].label
      const maxLabel = chunk[chunk.length - 1].label
      binned.push({ label: chunk.length > 1 ? `${minLabel}-${maxLabel}` : minLabel, value: Math.round(avgVal * 100) / 100 })
    }
    return binned
  }

  // For categorical: take top N by value, aggregate rest into "Other"
  const sorted = [...data].sort((a, b) => b.value - a.value)
  const top = sorted.slice(0, maxPoints - 1)
  const rest = sorted.slice(maxPoints - 1)
  const otherVal = rest.reduce((s, d) => s + d.value, 0)
  return [...top, { label: `Other (${rest.length})`, value: Math.round(otherVal * 100) / 100 }]
}

function suggestChartType(data: DataPoint[]): ChartType {
  if (data.length === 0) return 'bar'

  const n = data.length
  const hasCategories = data.some(d => d.category)
  const isTimeSeries = data.every(d => !isNaN(Number(d.label))) || data.every(d => /^\d{4}[-/]/.test(d.label))
  const allPositive = data.every(d => d.value >= 0)
  const sumClose100 = Math.abs(data.reduce((s, d) => s + d.value, 0) - 100) < 5

  // Pie chart: small count, positive values, percentages
  if (n <= 8 && allPositive && (sumClose100 || n <= 5)) return 'pie'

  // Stacked bar: has categories
  if (hasCategories) return 'stacked_bar'

  // Area/Line: time series
  if (isTimeSeries && n > 5) return n > 50 ? 'area' : 'line'

  // Funnel: monotonically decreasing, small count
  const isDecreasing = data.every((d, i) => i === 0 || d.value <= data[i - 1].value)
  if (isDecreasing && n >= 3 && n <= 10) return 'funnel'

  // Treemap: many categories with sizes
  if (n > 10 && allPositive) return 'treemap'

  // Radar: small count, multiple dimensions
  if (n >= 3 && n <= 12) return 'radar'

  // Default: bar
  return 'bar'
}

const defaultOptions: ChartOptions = {
  color: 'var(--color-text-secondary)',
  colorPalette: 'default',
  xLabel: '', yLabel: '',
  showGrid: true, showLegend: true, legendPosition: 'bottom',
  logScaleX: false, logScaleY: false,
  lineWidth: 2, markerSize: 4, markerShape: 'circle',
  fillOpacity: 0.15, showValues: false, animate: true,
  barGap: 4, innerRadius: 60, startAngle: 90, smooth: true,
  showBrush: false, showCrosshair: true,
  trendLine: 'none',
  showStats: false,
  pubTheme: 'screen',
  fontScale: 'normal',
  aspect: 'free',
  tickFormatX: 'auto',
  tickFormatY: 'auto',
  tickCountX: 0,
  tickCountY: 0,
  decimalPlaces: 2,
  showTitle: true,
  showCaption: true,
  showCI: false,
  ciLevel: 0.95,
  cbSim: 'none',
  watermark: '',
}

// ─── Palettes ───────────────────────────────────────────────────
// Includes seven color-blind-safe palettes alongside the curated
// editorial palettes. The CB-safe sets (Wong, Okabe-Ito, Tol Bright,
// Tol Vibrant, IBM, Cividis, Viridis) come from the published
// references for protan/deutan/tritan accessibility — Wong (Nature
// Methods 2011) and Tol (SRON Tech Note 2018) are the de-facto
// journal standards.
//
// PLATFORM POLICY — muted only: every palette entry must stay
// within the muted register (~ <60% HSL saturation, lightness in
// the 40–75% band). The rest of humanovo's visual surface is in
// that register; bright primary-saturation hues would visually
// scream against the tonal language of the app. When adding a new
// palette: pick from a desaturated journal-style band, never
// from primary-color territory. Tests don't enforce this — it's
// a reviewer-eyeball check, but the comments here let the next
// reader know the constraint exists.
const PALETTES: Record<string, string[]> = {
  default: ['#5B8DB8', '#8B7EAF', '#6BA594', '#C4956A', '#7BA7B8', '#B07E8B', '#A89B6E', '#8598AD', '#7E9B8A', '#9B8EAD'],
  nature: ['#4A7C6F', '#5D9178', '#6FA583', '#81B792', '#94C7A2', '#749C76', '#5E8860', '#8CB186', '#6D9969', '#527E56'],
  ocean: ['#3D5A80', '#4D6D94', '#5E80A8', '#6E93BB', '#7FA6CE', '#8FB9E1', '#6997B8', '#5784A5', '#457192', '#335E7F'],
  warm: ['#B57170', '#C48A6F', '#CFA277', '#D4B481', '#DABD8B', '#C19068', '#B87E5E', '#CF9E72', '#D5AA7D', '#C2886A'],
  pastel: ['#B8C4D8', '#C2B8D6', '#BDC8CA', '#D1C4B8', '#C8BDC8', '#B8CDB8', '#D3D1B8', '#C8BAB8', '#B8BFD6', '#C4C8C2'],
  scientific: ['#4A6670', '#5C8A82', '#8FA96C', '#C4A05C', '#B87A5C', '#6C7C4A', '#4A5C3C', '#9C8258', '#7C5C3C', '#2A4048'],
  // Diverging palette — desaturated red↔green band that stays within
  // the platform's muted-only colour policy (every entry ≤ ~50%
  // saturation). The earlier #58A858 / #207828 / #B85450 were too
  // saturated and broke the visual register against the rest of the
  // app, where every other palette sits in the muted band.
  diverging: ['#A56560', '#B07E66', '#B89570', '#BFAB7C', '#C5BC8A', '#A8B888', '#88A87C', '#6E9670', '#5C8164', '#4A6E58'],
  monochrome: ['#2A3544', '#354252', '#404F60', '#4B5C6E', '#56697C', '#61768A', '#6C8398', '#7790A6', '#829DB4', '#8DAAC2'],
  // Color-blind-safe (CB) palettes — desaturated for the muted-only
  // platform palette policy. Each pair stays CB-distinguishable
  // (validated visually under protan/deutan/tritan filters) while
  // never crossing the 60% saturation line, so the page stays in the
  // same tonal register as the rest of the app.
  wong:        ['#3F4D5A', '#A88863', '#6E94AC', '#6FA289', '#B6AC7A', '#5A7896', '#A87560', '#8E7A8A', '#888888', '#5C638A'],
  okabe_ito:   ['#A88863', '#6E94AC', '#6FA289', '#B6AC7A', '#5A7896', '#A87560', '#8E7A8A', '#3F4D5A', '#888888', '#5C638A'],
  tol_bright:  ['#566E89', '#A06872', '#5C8267', '#A09766', '#7A9DAE', '#8B6680', '#9A9A9A', '#5C638A', '#587A6E', '#7A5C6E'],
  tol_vibrant: ['#496E89', '#6F94A0', '#5E8B85', '#A88164', '#9C5E55', '#9A6B7E', '#9A9A9A', '#5C638A', '#587A6E', '#7A5C6E'],
  ibm:         ['#6E7BA0', '#7A6F9E', '#9A6F86', '#A88164', '#A89668', '#3F4D5A', '#9A9A9A', '#5C638A', '#587A6E', '#7A5C6E'],
  cividis:     ['#293949', '#3A4866', '#4F5870', '#646672', '#7A7A78', '#8E867A', '#A19878', '#B0A678', '#BFB37A', '#C8BD7E'],
  viridis:     ['#3F3F62', '#414269', '#42476E', '#3F5570', '#3F6770', '#3F786C', '#5A8462', '#7A8E5C', '#9C9655', '#B79E50'],
}

const CB_SAFE_PALETTES = new Set(['wong', 'okabe_ito', 'tol_bright', 'tol_vibrant', 'ibm', 'cividis', 'viridis'])

const CHART_TYPES: { value: ChartType; label: string; group: string }[] = [
  // Bars
  { value: 'bar', label: 'Bar', group: 'Bar Charts' },
  { value: 'horizontal_bar', label: 'Horizontal Bar', group: 'Bar Charts' },
  { value: 'grouped_bar', label: 'Grouped Bar', group: 'Bar Charts' },
  { value: 'stacked_bar', label: 'Stacked Bar', group: 'Bar Charts' },
  { value: 'stacked_bar_100', label: 'Stacked Bar (100%)', group: 'Bar Charts' },
  { value: 'waterfall', label: 'Waterfall', group: 'Bar Charts' },
  // Lines
  { value: 'line', label: 'Line', group: 'Line Charts' },
  { value: 'multi_line', label: 'Multi-Line', group: 'Line Charts' },
  { value: 'step', label: 'Step', group: 'Line Charts' },
  { value: 'spline', label: 'Spline (Smooth)', group: 'Line Charts' },
  { value: 'stem', label: 'Stem (Lollipop)', group: 'Line Charts' },
  // Areas
  { value: 'area', label: 'Area', group: 'Area Charts' },
  { value: 'stacked_area', label: 'Stacked Area', group: 'Area Charts' },
  { value: 'stream', label: 'Streamgraph', group: 'Area Charts' },
  { value: 'band', label: 'Band / Range', group: 'Area Charts' },
  // Circular
  { value: 'pie', label: 'Pie', group: 'Circular Charts' },
  { value: 'donut', label: 'Donut', group: 'Circular Charts' },
  { value: 'radial_bar', label: 'Radial Bar', group: 'Circular Charts' },
  { value: 'polar_area', label: 'Polar Area', group: 'Circular Charts' },
  { value: 'radar', label: 'Radar / Spider', group: 'Circular Charts' },
  // Scatter
  { value: 'scatter', label: 'Scatter', group: 'Scatter / Bubble' },
  { value: 'bubble', label: 'Bubble', group: 'Scatter / Bubble' },
  { value: 'scatter_3d', label: '3D Scatter', group: '3D Charts' },
  { value: 'bubble_3d', label: '3D Bubble', group: '3D Charts' },
  { value: 'line_3d', label: '3D Line', group: '3D Charts' },
  { value: 'bar_3d', label: '3D Bar', group: '3D Charts' },
  { value: 'surface_3d', label: '3D Surface', group: '3D Charts' },
  { value: 'wireframe_3d', label: '3D Wireframe', group: '3D Charts' },
  { value: 'contour_3d', label: '3D Contour', group: '3D Charts' },
  { value: 'trisurf_3d', label: '3D Tri-Surface', group: '3D Charts' },
  { value: 'quiver_3d', label: '3D Quiver (Vectors)', group: '3D Charts' },
  { value: 'isosurface_3d', label: '3D Isosurface', group: '3D Charts' },
  { value: 'voxel_3d', label: '3D Voxel', group: '3D Charts' },
  { value: 'streamline_3d', label: '3D Streamline', group: '3D Charts' },
  { value: 'slice_3d', label: '3D Slice', group: '3D Charts' },
  { value: 'stem_3d', label: '3D Stem', group: '3D Charts' },
  { value: 'waterfall_3d', label: '3D Waterfall', group: '3D Charts' },
  { value: 'ribbon_3d', label: '3D Ribbon', group: '3D Charts' },
  { value: 'pie_3d', label: '3D Pie', group: '3D Charts' },
  // Statistical
  { value: 'histogram', label: 'Histogram', group: 'Statistical' },
  { value: 'box_plot', label: 'Box Plot', group: 'Statistical' },
  { value: 'violin', label: 'Violin Plot', group: 'Statistical' },
  { value: 'density', label: 'Density / KDE', group: 'Statistical' },
  { value: 'error_bar', label: 'Error Bars', group: 'Statistical' },
  { value: 'candlestick', label: 'Candlestick', group: 'Statistical' },
  // Other
  { value: 'heatmap', label: 'Heatmap', group: 'Other' },
  { value: 'funnel', label: 'Funnel', group: 'Other' },
  { value: 'treemap', label: 'Treemap', group: 'Other' },
  { value: 'sankey', label: 'Sankey (Flow)', group: 'Other' },
]

// ── Sample Data Templates per Chart Type ──────────────────────────
// Each chart type has a pre-built sample dataset so users can see it immediately
const SAMPLE_DATA: Record<string, { data: string; title: string; columns: string }> = {
  bar: { title: 'Drug Response Rates', columns: 'label, value', data: 'Aspirin, 78\nIbuprofen, 65\nAcetaminophen, 72\nNaproxen, 58\nDiclofenac, 63' },
  horizontal_bar: { title: 'Gene Expression Levels', columns: 'label, value', data: 'BRCA1, 4.2\nTP53, 3.8\nEGFR, 5.1\nMYC, 2.9\nPIK3CA, 3.5\nKRAS, 4.7' },
  grouped_bar: { title: 'Treatment vs Control', columns: 'label, treatment, control', data: 'Week 1, 45, 42\nWeek 2, 52, 44\nWeek 3, 61, 43\nWeek 4, 68, 45' },
  stacked_bar: { title: 'Cell Type Distribution', columns: 'label, value, category', data: 'Sample A, 40, T-cells\nSample A, 30, B-cells\nSample A, 30, NK-cells\nSample B, 35, T-cells\nSample B, 45, B-cells\nSample B, 20, NK-cells' },
  stacked_bar_100: { title: 'Mutation Frequency', columns: 'label, value, category', data: 'Lung, 45, Missense\nLung, 30, Nonsense\nLung, 25, Silent\nBreast, 55, Missense\nBreast, 20, Nonsense\nBreast, 25, Silent' },
  waterfall: { title: 'Tumor Size Change', columns: 'label, value', data: 'Baseline, 100\nWeek 4, -15\nWeek 8, -22\nWeek 12, -8\nWeek 16, 5\nWeek 20, -18\nFinal, -58' },
  line: { title: 'Patient Vital Signs', columns: 'label, value', data: 'Day 1, 98.6\nDay 2, 99.1\nDay 3, 100.2\nDay 4, 101.5\nDay 5, 100.8\nDay 6, 99.4\nDay 7, 98.9' },
  multi_line: { title: 'Drug Concentration', columns: 'label, plasma, tissue', data: '0h, 0, 0\n1h, 85, 20\n2h, 72, 55\n4h, 48, 68\n8h, 22, 45\n12h, 10, 28\n24h, 3, 12' },
  step: { title: 'Dose Escalation', columns: 'label, value', data: 'Phase 1, 10\nPhase 2, 25\nPhase 3, 50\nPhase 4, 100\nPhase 5, 200' },
  spline: { title: 'Pharmacokinetic Curve', columns: 'label, value', data: '0, 0\n0.5, 42\n1, 85\n2, 72\n4, 48\n6, 30\n8, 18\n12, 8\n24, 2' },
  stem: { title: 'Peak Metabolite Levels', columns: 'label, value', data: 'Met-A, 3.2\nMet-B, 7.8\nMet-C, 1.5\nMet-D, 5.4\nMet-E, 9.1\nMet-F, 2.8' },
  area: { title: 'Viral Load Over Time', columns: 'label, value', data: 'Day 0, 1000000\nDay 3, 850000\nDay 7, 500000\nDay 14, 120000\nDay 21, 15000\nDay 28, 2000\nDay 35, 200' },
  stacked_area: { title: 'Immune Cell Populations', columns: 'label, cd4, cd8, nk', data: 'Baseline, 800, 400, 200\nWeek 1, 750, 450, 250\nWeek 2, 700, 550, 300\nWeek 4, 650, 700, 350\nWeek 8, 600, 850, 400' },
  stream: { title: 'Cytokine Dynamics', columns: 'label, il6, tnf, ifn', data: '0h, 10, 5, 2\n6h, 45, 38, 15\n12h, 82, 65, 55\n24h, 55, 40, 72\n48h, 25, 18, 45\n72h, 12, 8, 20' },
  band: { title: 'Confidence Intervals', columns: 'label, value, upper, lower', data: 'Week 1, 50, 55, 45\nWeek 2, 55, 62, 48\nWeek 3, 62, 70, 54\nWeek 4, 58, 68, 48\nWeek 5, 65, 75, 55' },
  pie: { title: 'Trial Enrollment by Site', columns: 'label, value', data: 'New York, 35\nLondon, 28\nTokyo, 22\nSydney, 15' },
  donut: { title: 'Adverse Events by Grade', columns: 'label, value', data: 'Grade 1, 45\nGrade 2, 30\nGrade 3, 15\nGrade 4, 8\nGrade 5, 2' },
  radial_bar: { title: 'Endpoint Achievement', columns: 'label, value', data: 'Primary, 85\nSecondary, 72\nExploratory, 58\nSafety, 95' },
  polar_area: { title: 'Biomarker Levels', columns: 'label, value', data: 'CRP, 75\nESR, 60\nIL-6, 85\nTNF-a, 45\nIFN-g, 70\nIL-10, 55' },
  radar: { title: 'Drug Profile Comparison', columns: 'label, value', data: 'Efficacy, 85\nSafety, 72\nTolerability, 68\nBioavailability, 90\nHalf-life, 55\nSelectivity, 78' },
  scatter: { title: 'IC50 vs Selectivity', columns: 'label, value, value2', data: 'Compound A, 2.5, 85\nCompound B, 5.1, 62\nCompound C, 0.8, 95\nCompound D, 12.3, 45\nCompound E, 3.2, 78\nCompound F, 7.8, 55' },
  bubble: { title: 'Clinical Trial Landscape', columns: 'label, value, value2, size', data: 'Phase I, 25, 80, 15\nPhase II, 50, 65, 30\nPhase III, 75, 45, 50\nPhase IV, 90, 30, 20' },
  histogram: { title: 'Patient Age Distribution', columns: 'label, value', data: '18, 5\n22, 12\n28, 18\n32, 25\n38, 30\n42, 28\n48, 22\n52, 18\n58, 15\n62, 10\n68, 8\n72, 5' },
  box_plot: { title: 'Biomarker Variability', columns: 'label, value, category', data: 'CRP, 2.1, Control\nCRP, 3.5, Control\nCRP, 1.8, Control\nCRP, 5.2, Treatment\nCRP, 4.8, Treatment\nCRP, 6.1, Treatment' },
  violin: { title: 'Gene Expression Distribution', columns: 'label, value, category', data: 'TP53, 2.1, Normal\nTP53, 2.5, Normal\nTP53, 2.3, Normal\nTP53, 3.0, Normal\nTP53, 2.8, Normal\nTP53, 5.2, Tumor\nTP53, 6.1, Tumor\nTP53, 4.8, Tumor\nTP53, 5.5, Tumor\nTP53, 7.0, Tumor' },
  density: { title: 'Patient BMI Distribution', columns: 'label, value', data: '18.5, 2\n20, 5\n21.5, 12\n23, 22\n24.5, 35\n26, 40\n27.5, 32\n29, 20\n30.5, 12\n32, 6\n33.5, 3\n35, 1' },
  error_bar: { title: 'Treatment Response', columns: 'label, value, errorPlus, errorMinus', data: 'Placebo, 20, 5, 5\nLow Dose, 35, 8, 6\nMed Dose, 55, 10, 8\nHigh Dose, 72, 12, 7' },
  candlestick: { title: 'Blood Glucose', columns: 'label, open, high, low, close', data: 'Mon, 95, 140, 80, 110\nTue, 110, 135, 90, 105\nWed, 105, 150, 85, 120\nThu, 120, 160, 95, 100\nFri, 100, 130, 75, 115' },
  heatmap: { title: 'Gene Co-expression', columns: 'label, value, category', data: 'TP53-BRCA1, 0.85, High\nTP53-EGFR, 0.42, Med\nBRCA1-EGFR, 0.68, Med\nTP53-MYC, 0.91, High\nBRCA1-MYC, 0.35, Low' },
  funnel: { title: 'Patient Screening Funnel', columns: 'label, value', data: 'Screened, 1000\nEligible, 450\nConsented, 320\nRandomized, 280\nCompleted, 220' },
  treemap: { title: 'Disease Taxonomy', columns: 'label, value', data: 'Oncology, 45\nCardiology, 30\nNeurology, 25\nImmunology, 20\nEndocrinology, 15\nHematology, 12' },
  scatter_3d: { title: '3D Protein Structure', columns: 'label, x, y, z', data: 'Residue 1, 2.5, 3.1, 1.8\nResidue 2, 4.2, 1.5, 3.2\nResidue 3, 1.8, 4.5, 2.1\nResidue 4, 3.5, 2.8, 4.5\nResidue 5, 5.1, 3.9, 1.2' },
  bubble_3d: { title: '3D Drug Space', columns: 'label, x, y, z, size', data: 'Drug A, 2.5, 3.1, 1.8, 10\nDrug B, 4.2, 1.5, 3.2, 25\nDrug C, 1.8, 4.5, 2.1, 15\nDrug D, 3.5, 2.8, 4.5, 30' },
  line_3d: { title: '3D Trajectory', columns: 'label, x, y, z', data: 'T0, 0, 0, 0\nT1, 1, 2, 1\nT2, 2, 3, 3\nT3, 3, 2, 5\nT4, 4, 4, 4\nT5, 5, 3, 6' },
  bar_3d: { title: '3D Expression Levels', columns: 'label, x, y, z', data: 'Gene A, 1, 1, 8\nGene B, 2, 1, 5\nGene C, 3, 1, 12\nGene D, 1, 2, 6\nGene E, 2, 2, 9' },
  surface_3d: { title: '3D Dose-Response Surface', columns: 'label, x, y, z', data: 'P1, -2, -2, 0.5\nP2, 0, -2, 1.2\nP3, 2, -2, 0.8\nP4, -2, 0, 1.5\nP5, 0, 0, 3.0\nP6, 2, 0, 1.8\nP7, -2, 2, 0.6\nP8, 0, 2, 1.4\nP9, 2, 2, 0.9' },
  wireframe_3d: { title: '3D Wireframe Model', columns: 'label, x, y, z', data: 'P1, -2, -2, 0.5\nP2, 0, -2, 1.2\nP3, 2, -2, 0.8\nP4, -2, 0, 1.5\nP5, 0, 0, 3.0\nP6, 2, 0, 1.8' },
  contour_3d: { title: '3D Contour Map', columns: 'label, x, y, z', data: 'P1, -2, -2, 0.5\nP2, 0, -2, 1.2\nP3, 2, -2, 0.8\nP4, -2, 0, 1.5\nP5, 0, 0, 3.0\nP6, 2, 0, 1.8' },
  trisurf_3d: { title: '3D Triangulated Surface', columns: 'label, x, y, z', data: 'V1, 0, 0, 0\nV2, 1, 0, 0.8\nV3, 0.5, 1, 1.2\nV4, 2, 0, 0.4\nV5, 1.5, 1.2, 1.6\nV6, 1, 2, 0.9\nV7, 2.5, 1.8, 1.1\nV8, 0.5, 2.2, 0.7\nV9, 2, 2.5, 1.4' },
  quiver_3d: { title: '3D Vector Field', columns: 'label, x, y, z', data: 'v1, -1, -1, 0\nv2, 0, -1, 0.5\nv3, 1, -1, 0.2\nv4, -1, 0, 0.8\nv5, 0, 0, 1.0\nv6, 1, 0, 0.6\nv7, -1, 1, 0.3\nv8, 0, 1, 0.9\nv9, 1, 1, 0.4' },
  isosurface_3d: { title: '3D Isosurface (Density)', columns: 'label, x, y, z', data: 'p1, -2, -2, 0.1\np2, 0, -2, 0.8\np3, 2, -2, 0.3\np4, -2, 0, 0.7\np5, 0, 0, 2.5\np6, 2, 0, 0.9\np7, -2, 2, 0.2\np8, 0, 2, 0.6\np9, 2, 2, 0.4\np10, -1, -1, 1.2\np11, 1, -1, 1.0\np12, -1, 1, 1.5\np13, 1, 1, 1.8' },
  voxel_3d: { title: '3D Voxel Grid', columns: 'label, x, y, z', data: 'v000, 0, 0, 1\nv100, 1, 0, 2\nv010, 0, 1, 1\nv110, 1, 1, 3\nv001, 0, 0, 2\nv101, 1, 0, 1\nv011, 0, 1, 3\nv111, 1, 1, 2' },
  streamline_3d: { title: '3D Streamlines', columns: 'label, x, y, z', data: 's1, 0, 0, 0\ns2, 0.5, 0.3, 0.2\ns3, 1.0, 0.7, 0.5\ns4, 1.4, 1.2, 0.9\ns5, 1.6, 1.8, 1.4\ns6, 1.7, 2.4, 2.0\ns7, 1.5, 2.9, 2.6\ns8, 1.1, 3.2, 3.1' },
  slice_3d: { title: '3D Volume Slice', columns: 'label, x, y, z', data: 'c1, -2, -2, 0.1\nc2, -1, -2, 0.3\nc3, 0, -2, 0.8\nc4, 1, -2, 0.4\nc5, 2, -2, 0.2\nc6, -2, 0, 0.5\nc7, 0, 0, 2.1\nc8, 2, 0, 0.6\nc9, -2, 2, 0.2\nc10, 0, 2, 0.7' },
  stem_3d: { title: '3D Stem Plot', columns: 'label, x, y, z', data: 'pk1, 0, 0, 2.1\npk2, 1, 0.5, 3.8\npk3, 2, 1, 1.5\npk4, 0.5, 1.5, 4.2\npk5, 1.5, 2, 2.9\npk6, 2.5, 2.5, 3.4' },
  waterfall_3d: { title: '3D Waterfall', columns: 'label, x, y, z', data: 'Q1, 1, 0, 100\nQ2, 2, 0, -15\nQ3, 3, 0, 25\nQ4, 4, 0, -8\nQ1, 1, 1, 80\nQ2, 2, 1, 20\nQ3, 3, 1, -12\nQ4, 4, 1, 18' },
  ribbon_3d: { title: '3D Ribbon Plot', columns: 'label, x, y, z', data: 'r1, 0, 0, 0.5\nr2, 1, 0, 1.2\nr3, 2, 0, 0.8\nr4, 3, 0, 1.5\nr5, 0, 1, 1.0\nr6, 1, 1, 2.5\nr7, 2, 1, 1.8\nr8, 3, 1, 2.2\nr9, 0, 2, 0.7\nr10, 1, 2, 1.4\nr11, 2, 2, 2.0\nr12, 3, 2, 1.1' },
  pie_3d: { title: '3D Enrollment Distribution', columns: 'label, x, y, z', data: 'Site A, 1, 1, 35\nSite B, 2, 2, 28\nSite C, 3, 3, 22\nSite D, 4, 4, 15' },
}

// Excel column mapping: describes expected columns per chart type
const COLUMN_MAPS: Record<string, { required: string[]; optional: string[]; description: string }> = {
  bar: { required: ['Label', 'Value'], optional: [], description: 'One value per category' },
  horizontal_bar: { required: ['Label', 'Value'], optional: [], description: 'One value per category' },
  grouped_bar: { required: ['Label', 'Value 1', 'Value 2'], optional: ['Value 3'], description: 'Multiple series per category' },
  stacked_bar: { required: ['Label', 'Value', 'Category'], optional: [], description: 'Values grouped by category' },
  stacked_bar_100: { required: ['Label', 'Value', 'Category'], optional: [], description: 'Percentages by category' },
  waterfall: { required: ['Label', 'Value'], optional: [], description: 'Sequential changes (positive/negative)' },
  line: { required: ['Label/X', 'Value/Y'], optional: [], description: 'Sequential data points' },
  multi_line: { required: ['Label', 'Series 1', 'Series 2'], optional: ['Series 3'], description: 'Multiple series over same x-axis' },
  step: { required: ['Label', 'Value'], optional: [], description: 'Discrete steps' },
  spline: { required: ['Label', 'Value'], optional: [], description: 'Smooth curve through points' },
  stem: { required: ['Label', 'Value'], optional: [], description: 'Discrete values with stems' },
  area: { required: ['Label', 'Value'], optional: [], description: 'Filled area under curve' },
  stacked_area: { required: ['Label', 'Series 1', 'Series 2'], optional: ['Series 3'], description: 'Stacked filled areas' },
  stream: { required: ['Label', 'Series 1', 'Series 2'], optional: ['Series 3'], description: 'Flowing stacked data' },
  band: { required: ['Label', 'Value', 'Upper', 'Lower'], optional: [], description: 'Value with confidence band' },
  pie: { required: ['Label', 'Value'], optional: [], description: 'Parts of a whole' },
  donut: { required: ['Label', 'Value'], optional: [], description: 'Parts of a whole (ring)' },
  radial_bar: { required: ['Label', 'Value'], optional: [], description: 'Circular progress bars' },
  polar_area: { required: ['Label', 'Value'], optional: [], description: 'Circular segments by area' },
  radar: { required: ['Label', 'Value'], optional: [], description: 'Multi-axis comparison' },
  scatter: { required: ['Label', 'X', 'Y'], optional: [], description: 'X-Y point distribution' },
  bubble: { required: ['Label', 'X', 'Y', 'Size'], optional: [], description: 'Scatter with size dimension' },
  histogram: { required: ['Label/Bin', 'Count'], optional: [], description: 'Frequency distribution' },
  box_plot: { required: ['Label', 'Value', 'Category'], optional: [], description: 'Distribution by group' },
  violin: { required: ['Label', 'Value', 'Category'], optional: [], description: 'Density-aware distribution by group' },
  density: { required: ['Label/Bin', 'Density'], optional: [], description: 'Smoothed frequency distribution' },
  error_bar: { required: ['Label', 'Value', 'Error+', 'Error-'], optional: [], description: 'Values with error margins' },
  candlestick: { required: ['Label', 'Open', 'High', 'Low', 'Close'], optional: [], description: 'OHLC data' },
  heatmap: { required: ['Label', 'Value', 'Category'], optional: [], description: 'Matrix intensity values' },
  funnel: { required: ['Label', 'Value'], optional: [], description: 'Sequential reduction (descending)' },
  treemap: { required: ['Label', 'Value'], optional: [], description: 'Hierarchical proportions' },
  scatter_3d: { required: ['Label', 'X', 'Y', 'Z'], optional: ['Category'], description: '3D point cloud' },
  bubble_3d: { required: ['Label', 'X', 'Y', 'Z', 'Size'], optional: [], description: '3D scatter with size' },
  line_3d: { required: ['Label', 'X', 'Y', 'Z'], optional: [], description: '3D line trajectory' },
  bar_3d: { required: ['Label', 'X', 'Y', 'Z'], optional: [], description: '3D bar columns' },
  surface_3d: { required: ['Label', 'X', 'Y', 'Z'], optional: [], description: '3D surface from grid points' },
  wireframe_3d: { required: ['Label', 'X', 'Y', 'Z'], optional: [], description: '3D wireframe mesh' },
  contour_3d: { required: ['Label', 'X', 'Y', 'Z'], optional: [], description: '3D contour projection' },
  trisurf_3d: { required: ['Label', 'X', 'Y', 'Z'], optional: [], description: 'Triangulated surface from scattered points' },
  quiver_3d: { required: ['Label', 'X', 'Y', 'Z'], optional: ['VX', 'VY', 'VZ'], description: '3D vector field (arrows)' },
  isosurface_3d: { required: ['Label', 'X', 'Y', 'Z'], optional: [], description: 'Volumetric isosurface (density)' },
  voxel_3d: { required: ['Label', 'X', 'Y', 'Z'], optional: [], description: 'Discrete voxel grid' },
  streamline_3d: { required: ['Label', 'X', 'Y', 'Z'], optional: [], description: 'Flow streamlines through space' },
  slice_3d: { required: ['Label', 'X', 'Y', 'Z'], optional: [], description: '2D slice of a 3D volume' },
  stem_3d: { required: ['Label', 'X', 'Y', 'Z'], optional: [], description: '3D vertical stems from base' },
  waterfall_3d: { required: ['Label', 'X', 'Y', 'Z'], optional: [], description: '3D waterfall / sequential deltas' },
  ribbon_3d: { required: ['Label', 'X', 'Y', 'Z'], optional: [], description: 'Ribbon surface along series' },
  pie_3d: { required: ['Label', 'X', 'Y', 'Z'], optional: [], description: '3D pie chart' },
}

const TOOLTIP_STYLE = {
  background: 'var(--color-surface-solid, rgba(10, 10, 10, 0.95))',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: '6px',
  fontSize: '11px',
  color: 'var(--color-text)',
  boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
  padding: '8px 12px',
  backdropFilter: 'blur(12px)',
  fontFamily: "'Inter', system-ui, sans-serif",
}

const AXIS_TICK = { fontSize: 10, fill: 'var(--color-text-muted)', fontFamily: "'Inter', system-ui, sans-serif" }

// ─── Publication theme presets ──────────────────────────────────
// Each preset is a complete style sheet for the chart canvas:
// background, font family/weight, axis stroke, gridline color/width,
// title/caption color. The screen preset preserves the existing
// glass-dark aesthetic; the others mimic style guides from major
// journals so charts can be exported without further tweaking.
interface ThemeStyle {
  bg: string
  axisColor: string
  gridColor: string
  textColor: string
  mutedColor: string
  titleFont: string
  bodyFont: string
  axisStrokeWidth: number
  gridStrokeWidth: number
  gridDash: string | undefined
  tooltipBg: string
  // Per-theme typography baselines, multiplied by FONT_SCALE_MULT at
  // render time. Journal themes use smaller baselines than `screen`
  // (Nature column figure conventions: 7pt tick, 8pt axis label,
  // 9pt legend; screen interactive convention: 10pt tick, 11pt axis
  // label, 11pt legend). Without these, every theme rendered with
  // screen-sized type, which made the journal preview look like a
  // screenshot of the screen view rather than a paper figure.
  tickFontSize: number
  axisLabelFontSize: number
  legendFontSize: number
  titleFontSize: number
  subtitleFontSize: number
  // Type weights — journal type is set heavier than browser default
  // (axis labels usually 500, body 400). Specifying explicitly so the
  // browser's font-substitution doesn't drop us to Helvetica Light or
  // similar inconsistencies.
  tickFontWeight: number
  axisLabelFontWeight: number
  titleFontWeight: number
  // Whether to suppress the gridline in this theme regardless of the
  // user's `showGrid` option. Nature/Science don't use gridlines on
  // most published figures; the user's `showGrid: true` default would
  // otherwise render them on every chart and immediately break the
  // visual contract of the chosen theme.
  forceHideGrid: boolean
}

const THEMES: Record<PublicationTheme, ThemeStyle> = {
  // Interactive in-app theme. Larger baselines + dashed gridlines so
  // the chart reads at viewport distance, not column-width distance.
  // Concrete hex values (no CSS vars) because SVG `fill` attributes
  // can't always resolve var(--…) — the heatmap text fills came out
  // invisible on white card backgrounds when textColor was
  // 'var(--color-text)' and the wrapper bg was flipped to white.
  // Using fixed dark-on-translucent values keeps text readable on
  // any wrapper background, not just the dark app shell.
  screen: {
    bg: 'transparent',
    axisColor: '#A8B0BA',
    gridColor: 'rgba(168, 176, 186, 0.25)',
    textColor: '#E5E7EB',
    mutedColor: '#A8B0BA',
    titleFont: "'Inter', system-ui, sans-serif",
    bodyFont: "'Inter', system-ui, sans-serif",
    axisStrokeWidth: 1,
    gridStrokeWidth: 1,
    gridDash: '3 3',
    tooltipBg: 'var(--color-surface-solid)',
    tickFontSize: 10,
    axisLabelFontSize: 11,
    legendFontSize: 11,
    titleFontSize: 16,
    subtitleFontSize: 11,
    tickFontWeight: 400,
    axisLabelFontWeight: 500,
    titleFontWeight: 600,
    forceHideGrid: false,
  },
  // Generic "paper" — neutral white background with restrained type.
  // Slightly larger than journal column-grade so it works for slide
  // decks too, where 7pt would be unreadable.
  paper: {
    bg: '#FFFFFF',
    axisColor: '#222222',
    gridColor: '#E5E5E5',
    textColor: '#111111',
    mutedColor: '#444444',
    titleFont: "'Inter', 'Helvetica Neue', Arial, sans-serif",
    bodyFont: "'Inter', 'Helvetica Neue', Arial, sans-serif",
    axisStrokeWidth: 1.25,
    gridStrokeWidth: 0.75,
    gridDash: undefined,
    tooltipBg: '#FFFFFF',
    tickFontSize: 9,
    axisLabelFontSize: 10,
    legendFontSize: 9,
    titleFontSize: 14,
    subtitleFontSize: 10,
    tickFontWeight: 400,
    axisLabelFontWeight: 500,
    titleFontWeight: 600,
    forceHideGrid: false,
  },
  // Nature column-figure conventions: 7pt tick, 8pt axis label, no
  // gridlines, slightly heavier axis stroke so the box reads cleanly
  // at column width (~3.5"). Helvetica matches Nature's house style.
  nature: {
    bg: '#FFFFFF',
    axisColor: '#000000',
    gridColor: '#EEEEEE',
    textColor: '#000000',
    mutedColor: '#333333',
    titleFont: "'Helvetica Neue', Helvetica, Arial, sans-serif",
    bodyFont: "'Helvetica Neue', Helvetica, Arial, sans-serif",
    axisStrokeWidth: 1.5,
    gridStrokeWidth: 0.5,
    gridDash: undefined,
    tooltipBg: '#FFFFFF',
    tickFontSize: 7,
    axisLabelFontSize: 8,
    legendFontSize: 7,
    titleFontSize: 10,
    subtitleFontSize: 8,
    tickFontWeight: 400,
    axisLabelFontWeight: 500,
    titleFontWeight: 600,
    forceHideGrid: true,
  },
  // Science: very similar to Nature but slightly larger type and
  // Inter (sans, near-Helvetica metrics) instead of Helvetica Neue.
  science: {
    bg: '#FFFFFF',
    axisColor: '#000000',
    gridColor: '#F0F0F0',
    textColor: '#000000',
    mutedColor: '#222222',
    titleFont: "'Inter', Arial, sans-serif",
    bodyFont: "'Inter', Arial, sans-serif",
    axisStrokeWidth: 1.25,
    gridStrokeWidth: 0.5,
    gridDash: undefined,
    tooltipBg: '#FFFFFF',
    tickFontSize: 8,
    axisLabelFontSize: 9,
    legendFontSize: 8,
    titleFontSize: 11,
    subtitleFontSize: 9,
    tickFontWeight: 400,
    axisLabelFontWeight: 500,
    titleFontWeight: 600,
    forceHideGrid: true,
  },
  // IEEE: serif type (Times) per IEEE figure house style; slightly
  // smaller again. Subtle gridlines acceptable in IEEE conference
  // papers, hence forceHideGrid: false.
  ieee: {
    bg: '#FFFFFF',
    axisColor: '#000000',
    gridColor: '#EAEAEA',
    textColor: '#000000',
    mutedColor: '#222222',
    titleFont: "'Times New Roman', Times, serif",
    bodyFont: "'Times New Roman', Times, serif",
    axisStrokeWidth: 1.25,
    gridStrokeWidth: 0.5,
    gridDash: undefined,
    tooltipBg: '#FFFFFF',
    tickFontSize: 8,
    axisLabelFontSize: 9,
    legendFontSize: 8,
    titleFontSize: 11,
    subtitleFontSize: 9,
    tickFontWeight: 400,
    axisLabelFontWeight: 500,
    titleFontWeight: 700, // IEEE titles are slightly heavier in print
    forceHideGrid: false,
  },
}

const FONT_SCALE_MULT: Record<FontScale, number> = {
  small: 0.85,
  normal: 1,
  large: 1.15,
  huge: 1.4,
}

const ASPECT_RATIO: Record<AspectPreset, number | null> = {
  free: null,
  '16:9': 16 / 9,
  '4:3': 4 / 3,
  '3:2': 3 / 2,
  '1:1': 1,
  golden: 1.618,
  'two-col': 2.0,  // common journal two-column figure ratio
}

// CSS filter strings to simulate common color-vision deficiencies.
// These are previews for the author — they do not modify exports.
const CB_SIM_FILTER: Record<CBlindSim, string> = {
  none: 'none',
  protanopia: 'url(#cb-protan)',
  deuteranopia: 'url(#cb-deuter)',
  tritanopia: 'url(#cb-tritan)',
  achromatopsia: 'grayscale(100%)',
}

// Smart tick formatter — picks scientific, percent, currency, compact,
// or plain notation based on the value and the user's preference. The
// `auto` mode flips to scientific notation when |v| >= 1e4 or
// 0 < |v| < 1e-3 so paper figures don't carry messy long numbers.
function makeTickFormatter(fmt: TickFormat, decimals: number): (v: unknown) => string {
  const dp = Math.max(0, Math.min(6, decimals))
  switch (fmt) {
    case 'scientific':
      return (v: unknown) => {
        const n = Number(v)
        if (!Number.isFinite(n)) return String(v ?? '')
        if (n === 0) return '0'
        return n.toExponential(dp)
      }
    case 'percent':
      return (v: unknown) => {
        const n = Number(v)
        if (!Number.isFinite(n)) return String(v ?? '')
        return `${(n * 100).toFixed(dp)}%`
      }
    case 'currency':
      return (v: unknown) => {
        const n = Number(v)
        if (!Number.isFinite(n)) return String(v ?? '')
        return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: dp }).format(n)
      }
    case 'compact':
      return (v: unknown) => {
        const n = Number(v)
        if (!Number.isFinite(n)) return String(v ?? '')
        return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: dp }).format(n)
      }
    case 'plain':
      return (v: unknown) => {
        const n = Number(v)
        if (!Number.isFinite(n)) return String(v ?? '')
        return n.toFixed(dp)
      }
    case 'auto':
    default:
      return (v: unknown) => {
        const n = Number(v)
        if (!Number.isFinite(n)) return String(v ?? '')
        const abs = Math.abs(n)
        if (n === 0) return '0'
        if (abs >= 1e4 || abs < 1e-3) return n.toExponential(Math.min(2, dp))
        // Drop trailing zeros so integer ticks render "80" not "80.00"
        // — the previous .toFixed(dp) ignored whether the value
        // actually carries fractional information. Visible in every
        // bar/line chart with integer Y-data; made the journal-theme
        // typography look sloppy.
        if (Number.isInteger(n) && dp > 0) return n.toFixed(0)
        return parseFloat(n.toFixed(dp)).toString()
      }
  }
}

// Z-scores for common confidence levels — saves a stats lib import.
const Z_SCORES: Record<string, number> = { '0.90': 1.6449, '0.95': 1.96, '0.99': 2.5758 }

function addCIBands(data: DataPoint[], level: number): DataPoint[] {
  if (data.length < 3) return data
  const vals = data.map(d => d.value).filter(v => Number.isFinite(v))
  if (vals.length < 3) return data
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length
  const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / (vals.length - 1)
  const sd = Math.sqrt(variance)
  const z = Z_SCORES[level.toFixed(2)] || 1.96
  const margin = z * sd / Math.sqrt(vals.length)
  return data.map(d => ({ ...d, ciLow: d.value - margin, ciHigh: d.value + margin }))
}

// ─── Helpers ────────────────────────────────────────────────────
function parseCSV(text: string): DataPoint[] {
  return text.split('\n').filter(l => l.trim()).map(line => {
    const parts = line.split(',').map(p => p.trim())
    const pt: DataPoint = { label: parts[0] || '', value: parseFloat(parts[1]) || 0 }
    if (parts[2] && !isNaN(parseFloat(parts[2]))) pt.value2 = parseFloat(parts[2])
    else if (parts[2]) pt.category = parts[2]
    if (parts[3] && !isNaN(parseFloat(parts[3]))) pt.value3 = parseFloat(parts[3])
    if (parts[4] && !isNaN(parseFloat(parts[4]))) pt.errorPlus = parseFloat(parts[4])
    if (parts[5] && !isNaN(parseFloat(parts[5]))) pt.errorMinus = parseFloat(parts[5])
    if (parts[6] && !isNaN(parseFloat(parts[6]))) pt.size = parseFloat(parts[6])
    return pt
  })
}

function getPalette(name: string): string[] {
  return PALETTES[name] || PALETTES.default
}

// Normalize any hex / CSS-var input to a 6-digit hex literal so the
// <input type="color"> element accepts it. CSS variables can't be
// fed directly to the native picker; fall back to a neutral gray
// when the resolved color isn't parseable.
function normalizeHex(c: string): string {
  if (!c) return '#888888'
  const t = c.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(t)) return t
  if (/^#[0-9a-fA-F]{3}$/.test(t)) {
    const h = t.slice(1)
    return '#' + h.split('').map(x => x + x).join('')
  }
  return '#888888'
}

function computeBoxStats(values: number[]): { min: number; q1: number; median: number; q3: number; max: number; outliers: number[] } {
  const s = [...values].sort((a, b) => a - b)
  const n = s.length
  const q1 = s[Math.floor(n * 0.25)]
  const median = n % 2 === 0 ? (s[n / 2 - 1] + s[n / 2]) / 2 : s[Math.floor(n / 2)]
  const q3 = s[Math.floor(n * 0.75)]
  const iqr = q3 - q1
  const lo = q1 - 1.5 * iqr
  const hi = q3 + 1.5 * iqr
  const outliers = s.filter(v => v < lo || v > hi)
  return { min: Math.max(s[0], lo), q1, median, q3, max: Math.min(s[n - 1], hi), outliers }
}

function computeHistogram(values: number[], bins = 15): { label: string; count: number }[] {
  if (!values.length) return []
  // Single-pass min/max so datasets with >100k points don't blow the JS
  // argument-list stack via Math.min(...values).
  let mn = Infinity, mx = -Infinity
  for (const v of values) {
    if (!Number.isFinite(v)) continue
    if (v < mn) mn = v
    if (v > mx) mx = v
  }
  if (!Number.isFinite(mn) || !Number.isFinite(mx)) return []
  const w = (mx - mn) / bins || 1
  const buckets = Array.from({ length: bins }, (_, i) => ({
    label: `${(mn + i * w).toFixed(1)}`,
    lo: mn + i * w,
    hi: mn + (i + 1) * w,
    count: 0,
  }))
  values.forEach(v => {
    const idx = Math.min(Math.floor((v - mn) / w), bins - 1)
    if (idx >= 0) buckets[idx].count++
  })
  return buckets.map(b => ({ label: b.label, count: b.count }))
}

// ─── Trend Line Helpers ─────────────────────────────────────────
function computeLinearRegression(data: DataPoint[]): { slope: number; intercept: number; r2: number } {
  const n = data.length
  if (n < 2) return { slope: 0, intercept: 0, r2: 0 }
  let sx = 0, sy = 0, sxx = 0, sxy = 0
  data.forEach((d, i) => {
    const x = i; const y = d.value
    sx += x; sy += y; sxx += x * x; sxy += x * y
  })
  const denom = n * sxx - sx * sx
  if (denom === 0) return { slope: 0, intercept: sy / n, r2: 0 }
  const slope = (n * sxy - sx * sy) / denom
  const intercept = (sy - slope * sx) / n
  const yMean = sy / n
  let ssRes = 0, ssTot = 0
  data.forEach((d, i) => {
    const predicted = slope * i + intercept
    ssRes += (d.value - predicted) ** 2
    ssTot += (d.value - yMean) ** 2
  })
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot
  return { slope, intercept, r2 }
}

function computeMovingAverage(data: DataPoint[], window = 3): number[] {
  return data.map((_, i) => {
    const start = Math.max(0, i - Math.floor(window / 2))
    const end = Math.min(data.length, i + Math.ceil(window / 2))
    const slice = data.slice(start, end)
    return slice.reduce((s, d) => s + d.value, 0) / slice.length
  })
}

function addTrendData(data: DataPoint[], trendType: string): DataPoint[] {
  if (trendType === 'none' || data.length < 2) return data
  if (trendType === 'linear') {
    const { slope, intercept } = computeLinearRegression(data)
    return data.map((d, i) => ({ ...d, trend: Math.round((slope * i + intercept) * 1000) / 1000 }))
  }
  if (trendType === 'movingAvg') {
    const window = Math.max(3, Math.round(data.length / 5))
    const ma = computeMovingAverage(data, window)
    return data.map((d, i) => ({ ...d, trend: Math.round(ma[i] * 1000) / 1000 }))
  }
  return data
}

// ─── Glassmorphic Select ────────────────────────────────────────
interface GlassSelectOption { value: string; label: string; group?: string; preview?: React.ReactNode }

function GlassSelect({ value, options, onChange, placeholder }: {
  value: string
  options: GlassSelectOption[]
  onChange: (val: string) => void
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const selected = options.find(o => o.value === value)
  const groups = options.reduce<Record<string, GlassSelectOption[]>>((acc, o) => {
    const g = o.group || ''
    if (!acc[g]) acc[g] = []
    acc[g].push(o)
    return acc
  }, {})

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="input w-full text-xs text-left flex items-center justify-between gap-2"
      >
        <span className="truncate">{selected?.label || placeholder || 'Select...'}</span>
        <FiChevronDown className={`w-3 h-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          className="absolute z-[99999] left-0 right-0 mt-1 max-h-64 overflow-y-auto rounded-xl border border-[var(--glass-border)]"
          style={{ background: 'var(--color-surface-solid)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', boxShadow: 'var(--glass-shadow)' }}
        >
          {Object.entries(groups).map(([group, items]) => (
            <div key={group}>
              {group && (
                <div className="px-3 py-1.5 text-xxs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] border-b border-[var(--glass-border)]">
                  {group}
                </div>
              )}
              {items.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => { onChange(opt.value); setOpen(false) }}
                  className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 transition-colors ${
                    opt.value === value
                      ? 'bg-white/10 text-[var(--color-text)]'
                      : 'text-[var(--color-text-secondary)] hover:bg-[var(--glass-bg-hover)] hover:text-[var(--color-text)]'
                  }`}
                >
                  {opt.preview}
                  <span className="truncate">{opt.label}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Component ──────────────────────────────────────────────────
export default function DataVisualization() {
  const [charts, setCharts] = useState<ChartConfig[]>(() => {
    const raw = persistGet<Partial<ChartConfig>[]>('charts', [])
    // Migrate old charts that lack the `options` field
    return raw.map((c) => ({
      ...c,
      annotations: c.annotations || [],
      options: c.options ? { ...defaultOptions, ...c.options } : { ...defaultOptions, color: (c as { color?: string }).color || defaultOptions.color },
    })) as ChartConfig[]
  })
  // Deep-link `?add=1` auto-opens the Add Chart dialog so dashboard
  // and cross-page links can drop users straight into the creation
  // flow. The query is consumed on mount and cleaned off the URL.
  const [searchParams] = useSearchParams()
  const [showAdd, setShowAdd] = useState(() => searchParams.get('add') === '1')
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    if (sp.has('add')) {
      sp.delete('add')
      const qs = sp.toString()
      const newUrl = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash
      window.history.replaceState(window.history.state, '', newUrl)
    }
     
  }, [])
  const [showSettings, setShowSettings] = useState<string | null>(null)
  const [expandedChart, setExpandedChart] = useState<string | null>(null)
  const chartRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ─── Interactivity state ────────────────────────────────────
  const [hiddenSeries, setHiddenSeries] = useState<Record<string, Set<string>>>({})
  const toggleSeries = useCallback((chartId: string, seriesKey: string) => {
    setHiddenSeries(prev => {
      const next = { ...prev }
      const set = new Set(prev[chartId] || [])
      if (set.has(seriesKey)) set.delete(seriesKey); else set.add(seriesKey)
      next[chartId] = set
      return next
    })
  }, [])

  // ─── Form state ─────────────────────────────────────────────
  const [form, setForm] = useState({
    title: '', type: 'bar' as ChartType, dataText: '',
    options: { ...defaultOptions },
  })

  const saveCharts = (updated: ChartConfig[]) => {
    setCharts(updated)
    persistSet('charts', updated)
  }

  const addChart = () => {
    if (!form.title.trim() || !form.dataText.trim()) return
    const parsed = parseCSV(form.dataText)
    const typeMeta = CHART_TYPES.find(t => t.value === form.type)
    // Publication-ready out of the box: every newly created chart
    // gets an auto-derived subtitle (chart-type · sample-count),
    // caption (figure-style descriptive sentence), and source line
    // (Humanovo Compute Lab + creation timestamp). Authors edit
    // these via the gear-icon panel; the defaults are good enough
    // for paper / poster export without further fiddling.
    const today = new Date()
    const stamp = today.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    const subtitle = `${typeMeta?.label || form.type} · n=${parsed.length}`
    const caption = `${typeMeta?.label || form.type} of ${form.title.toLowerCase()}. ${parsed.length} observation${parsed.length === 1 ? '' : 's'} plotted.`
    const source = `Humanovo Compute Lab · generated ${stamp}`
    const chart: ChartConfig = {
      id: `chart-${Date.now()}`,
      title: form.title,
      subtitle,
      caption,
      source,
      type: form.type,
      data: parsed,
      options: { ...form.options },
      annotations: [],
      createdAt: today.toISOString(),
    }
    saveCharts([chart, ...charts])
    logActivity({ type: 'discovery', action: 'created', title: `Created chart: ${chart.title} (${chart.type})` })
    setForm({ title: '', type: 'bar', dataText: '', options: { ...defaultOptions } })
    setShowAdd(false)
  }

  const deleteChart = (id: string) => setDeleteConfirmId(id)
  const confirmDeleteChart = () => { if (deleteConfirmId) { const deletedChart = charts.find(c => c.id === deleteConfirmId); saveCharts(charts.filter(c => c.id !== deleteConfirmId)); logActivity({ type: 'discovery', action: 'deleted', title: `Deleted chart: ${deletedChart?.title || deleteConfirmId}` }); setDeleteConfirmId(null) } }
  const duplicateChart = (c: ChartConfig) => {
    const dup = { ...c, id: `chart-${Date.now()}`, title: c.title + ' (copy)', annotations: [...(c.annotations || [])], createdAt: new Date().toISOString() }
    saveCharts([dup, ...charts])
  }
  const addAnnotation = (chartId: string) => {
    const chart = charts.find(c => c.id === chartId)
    if (!chart) return
    const values = chart.data.map(d => d.value)
    const mean = values.reduce((s, v) => s + v, 0) / values.length
    const ann: ChartAnnotation = { id: `ann-${Date.now()}`, axis: 'y', value: Math.round(mean * 100) / 100, label: 'Reference', color: '#C4956A', style: 'dashed' }
    saveCharts(charts.map(c => c.id === chartId ? { ...c, annotations: [...(c.annotations || []), ann] } : c))
  }
  const updateAnnotation = (chartId: string, annId: string, updates: Partial<ChartAnnotation>) => {
    saveCharts(charts.map(c => c.id === chartId ? { ...c, annotations: (c.annotations || []).map(a => a.id === annId ? { ...a, ...updates } : a) } : c))
  }
  const removeAnnotation = (chartId: string, annId: string) => {
    saveCharts(charts.map(c => c.id === chartId ? { ...c, annotations: (c.annotations || []).filter(a => a.id !== annId) } : c))
  }
  const addStatsAnnotations = (chartId: string) => {
    const chart = charts.find(c => c.id === chartId)
    if (!chart || chart.data.length < 2) return
    const vals = chart.data.map(d => d.value).sort((a, b) => a - b)
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length
    const median = vals.length % 2 === 0 ? (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2 : vals[Math.floor(vals.length / 2)]
    const anns: ChartAnnotation[] = [
      { id: `ann-mean-${Date.now()}`, axis: 'y', value: Math.round(mean * 100) / 100, label: `Mean: ${mean.toFixed(2)}`, color: '#5B8DB8', style: 'dashed' },
      { id: `ann-median-${Date.now()}`, axis: 'y', value: Math.round(median * 100) / 100, label: `Median: ${median.toFixed(2)}`, color: '#6BA594', style: 'dotted' },
    ]
    saveCharts(charts.map(c => c.id === chartId ? { ...c, annotations: [...(c.annotations || []), ...anns] } : c))
  }
  const updateChartOptions = (id: string, opts: Partial<ChartOptions>) => {
    saveCharts(charts.map(c => c.id === id ? { ...c, options: { ...c.options, ...opts } } : c))
  }

  // ─── File upload (CSV/TSV/XLSX) ────────────────────────────
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const title = file.name.replace(/\.(csv|tsv|xlsx?|txt)$/i, '').replace(/[-_]/g, ' ')
    const isExcel = /\.xlsx?$/i.test(file.name)

    if (isExcel) {
      const reader = new FileReader()
      reader.onload = (ev) => {
        try {
          const wb = XLSX.read(ev.target?.result, { type: 'array' })
          const ws = wb.Sheets[wb.SheetNames[0]]
          const rows: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1 }) as string[][]
          if (!rows.length) return
          const first = rows[0]
          const hasHeader = first.length >= 2 && isNaN(parseFloat(String(first[1])))
          const dataRows = hasHeader ? rows.slice(1) : rows
          const dataText = dataRows.map(r => r.map(c => String(c ?? '').trim()).join(', ')).join('\n')
          setForm(f => ({ ...f, title: title || f.title, dataText }))
          // Auto-suggest chart type
          const parsed = parseCSV(dataText)
          if (parsed.length > 0) setForm(f => ({ ...f, type: suggestChartType(parsed) }))
          setShowAdd(true)
        } catch (err) { console.error('XLSX parse error:', err) }
      }
      reader.readAsArrayBuffer(file)
    } else {
      const reader = new FileReader()
      reader.onload = (ev) => {
        const text = ev.target?.result as string
        if (!text) return
        const lines = text.split('\n').filter(l => l.trim())
        if (!lines.length) return
        const sep = text.includes('\t') ? /\t/ : /,/
        const first = lines[0].split(sep).map(p => p.trim().replace(/^["']|["']$/g, ''))
        const hasHeader = first.length >= 2 && isNaN(parseFloat(first[1]))
        const dataLines = hasHeader ? lines.slice(1) : lines
        const dataText = dataLines.map(l => l.split(sep).map(p => p.trim().replace(/^["']|["']$/g, '')).join(', ')).join('\n')
        setForm(f => ({ ...f, title: title || f.title, dataText }))
        // Auto-suggest chart type
        const parsed = parseCSV(dataText)
        if (parsed.length > 0) setForm(f => ({ ...f, type: suggestChartType(parsed) }))
        setShowAdd(true)
      }
      reader.readAsText(file)
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ─── Export ─────────────────────────────────────────────────
  const exportPng = useCallback(async (id: string, title: string) => {
    const el = chartRefs.current[id]
    if (!el) return
    // 3D charts render via Plotly (WebGL + SVG overlay). html2canvas
    // captures only the overlay — the main scene ends up blank. Route
    // those through plotExport which calls Plotly.toImage for a complete
    // raster. Recharts (2D) still uses html2canvas so we keep legend
    // click-states, custom tooltips, and any DOM decorators.
    const isPlotly = !!el.querySelector('.js-plotly-plot')
    try {
      if (isPlotly) {
        const blob = await getPlotBlob(el, 'png')
        if (blob) {
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.download = `${title.replace(/\s+/g, '-').toLowerCase()}.png`
          a.href = url
          a.click()
          URL.revokeObjectURL(url)
          return
        }
      }
      // Transparent background so the exported PNG drops cleanly into
      // slides / papers without the dark app shell bleeding through.
      const canvas = await html2canvas(el, {
        backgroundColor: null,
        scale: 2,
        useCORS: true,
        logging: false,
      })
      const a = document.createElement('a')
      a.download = `${title.replace(/\s+/g, '-').toLowerCase()}.png`
      a.href = canvas.toDataURL('image/png')
      a.click()
    } catch (err) { console.error('PNG export failed:', err) }
  }, [])

  const exportSvg = useCallback((id: string, title: string) => {
    const el = chartRefs.current[id]
    if (!el) return
    const svg = el.querySelector('svg')
    if (!svg) return
    const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' })
    const a = document.createElement('a')
    a.download = `${title.replace(/\s+/g, '-').toLowerCase()}.svg`
    a.href = URL.createObjectURL(blob); a.click(); URL.revokeObjectURL(a.href)
  }, [])

  const exportCsv = useCallback((chart: ChartConfig) => {
    const hdr = ['label', 'value', chart.data.some(d => d.category) ? 'category' : '', chart.data.some(d => d.value2 !== undefined) ? 'value2' : ''].filter(Boolean)
    const rows = [hdr.join(','), ...chart.data.map(d => {
      const parts = [`"${d.label}"`, d.value]
      if (hdr.includes('category')) parts.push(`"${d.category || ''}"`)
      if (hdr.includes('value2')) parts.push(d.value2 ?? '')
      return parts.join(',')
    })]
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.download = `${chart.title.replace(/\s+/g, '-').toLowerCase()}.csv`
    a.href = URL.createObjectURL(blob); a.click(); URL.revokeObjectURL(a.href)
  }, [])

  // Copy a ready-to-paste LaTeX figure environment to the clipboard.
  // The `\includegraphics` line points to a filename derived from the
  // chart title — the user is expected to drop the corresponding PDF
  // (from the Export → PDF action) into their TeX project alongside
  // the .tex file. Caption + label fields are pre-filled from the
  // chart's metadata so a paper author just pastes and edits.
  //
  // We don't embed the image data inline (LaTeX has no equivalent of
  // data: URIs for graphics) — this is a wrapper-only export. The
  // user runs Export → PDF first, then this, and ends up with both
  // the figure file and the snippet that references it.
  const exportLatex = useCallback(async (chart: ChartConfig) => {
    const slug = chart.title.replace(/\s+/g, '-').replace(/[^\w-]/g, '').toLowerCase()
    const caption = chart.caption || `${chart.title}.`
    const source = chart.source ? ` Source: ${chart.source}.` : ''
    const tex = [
      '\\begin{figure}[t]',
      '  \\centering',
      `  \\includegraphics[width=\\columnwidth]{${slug}.pdf}`,
      `  \\caption{${caption}${source}}`,
      `  \\label{fig:${slug}}`,
      '\\end{figure}',
      '',
    ].join('\n')
    try {
      await navigator.clipboard.writeText(tex)
      toast(
        'success',
        'LaTeX figure block copied. Paste into your .tex file; the matching PDF goes alongside as ' +
          `${slug}.pdf (use Export → PDF first).`,
      )
    } catch {
      toast('error', 'Clipboard write failed. Run Export → PDF and reconstruct the figure block manually.')
    }
  }, [])

  const exportXlsx = useCallback((chart: ChartConfig) => {
    const hasCat = chart.data.some(d => d.category)
    const hasV2 = chart.data.some(d => d.value2 !== undefined)
    const rows = chart.data.map(d => {
      const row: Record<string, string | number> = { label: d.label, value: d.value }
      if (hasCat) row.category = d.category || ''
      if (hasV2) row.value2 = d.value2 ?? ''
      return row
    })
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Data')
    XLSX.writeFile(wb, `${chart.title.replace(/\s+/g, '-').toLowerCase()}.xlsx`)
  }, [])

  // ── Publication-ready PDF export ─────────────────────────────
  // Renders the chart at 4× device-pixel-ratio, embeds it in a
  // letter-size PDF with title, caption, source attribution, and
  // generation timestamp footer. Suitable for direct submission to
  // poster sessions and supplementary figures.
  const exportPdf = useCallback(async (chart: ChartConfig) => {
    const el = chartRefs.current[chart.id]
    if (!el) return
    try {
      const isPlotly = !!el.querySelector('.js-plotly-plot')
      let dataUrl: string
      if (isPlotly) {
        const blob = await getPlotBlob(el, 'png')
        if (!blob) throw new Error('Plotly export failed')
        dataUrl = await new Promise<string>(res => {
          const r = new FileReader()
          r.onload = () => res(r.result as string)
          r.readAsDataURL(blob)
        })
      } else {
        // 4× scale gives ≥300 DPI on a typical print at 8" wide.
        const canvas = await html2canvas(el, { backgroundColor: '#FFFFFF', scale: 4, useCORS: true, logging: false })
        dataUrl = canvas.toDataURL('image/png')
      }
      const pdf = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' })
      const pageW = pdf.internal.pageSize.getWidth()
      const pageH = pdf.internal.pageSize.getHeight()
      const margin = 36
      // Title
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(16)
      pdf.setTextColor(20)
      const title = chart.title || 'Untitled Chart'
      pdf.text(title, margin, margin + 6)
      let y = margin + 22
      if (chart.subtitle) {
        pdf.setFont('helvetica', 'normal')
        pdf.setFontSize(11)
        pdf.setTextColor(80)
        pdf.text(chart.subtitle, margin, y)
        y += 14
      }
      // Image — centered, preserve aspect ratio
      const maxW = pageW - margin * 2
      const maxH = pageH - y - margin - 60  // reserve space for caption + footer
      const img = new Image()
      img.src = dataUrl
      await new Promise<void>(res => { img.onload = () => res() })
      const aspect = img.width / img.height
      let drawW = maxW
      let drawH = maxW / aspect
      if (drawH > maxH) { drawH = maxH; drawW = maxH * aspect }
      const drawX = margin + (maxW - drawW) / 2
      pdf.addImage(dataUrl, 'PNG', drawX, y, drawW, drawH)
      y += drawH + 18
      // Caption
      if (chart.caption) {
        pdf.setFont('helvetica', 'normal')
        pdf.setFontSize(10)
        pdf.setTextColor(40)
        const lines = pdf.splitTextToSize(chart.caption, maxW)
        pdf.text(lines, margin, y)
        y += lines.length * 12 + 4
      }
      if (chart.source) {
        pdf.setFont('helvetica', 'italic')
        pdf.setFontSize(9)
        pdf.setTextColor(100)
        pdf.text(`Source: ${chart.source}`, margin, y)
      }
      // Footer with generation metadata
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(8)
      pdf.setTextColor(140)
      const stamp = `Generated by Humanovo · ${new Date().toLocaleString()}`
      pdf.text(stamp, margin, pageH - 18)
      pdf.text(`n=${chart.data.length}`, pageW - margin, pageH - 18, { align: 'right' })
      pdf.save(`${chart.title.replace(/\s+/g, '-').toLowerCase()}.pdf`)
      toast('success', 'PDF exported')
    } catch (err) {
      toast('error', (err as { message?: string })?.message || 'PDF export failed', { title: 'Export failed' })
    }
  }, [])

  // ── High-DPI PNG export (4× / ~300 DPI print quality) ────────
  const exportHighDpiPng = useCallback(async (id: string, title: string) => {
    const el = chartRefs.current[id]
    if (!el) return
    const isPlotly = !!el.querySelector('.js-plotly-plot')
    try {
      if (isPlotly) {
        // Plotly's native exporter renders at the scene's actual
        // resolution; bump the dimensions for a 4K-equivalent image.
        const blob = await getPlotBlob(el, 'png')
        if (blob) {
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.download = `${title.replace(/\s+/g, '-').toLowerCase()}-hidpi.png`
          a.href = url; a.click(); URL.revokeObjectURL(url)
          toast('success', 'High-DPI PNG exported')
          return
        }
      }
      const canvas = await html2canvas(el, { backgroundColor: null, scale: 4, useCORS: true, logging: false })
      const a = document.createElement('a')
      a.download = `${title.replace(/\s+/g, '-').toLowerCase()}-hidpi.png`
      a.href = canvas.toDataURL('image/png'); a.click()
      toast('success', 'High-DPI PNG exported')
    } catch (err) {
      toast('error', (err as { message?: string })?.message || 'PNG export failed')
    }
  }, [])

  const computeStats = (data: DataPoint[]) => {
    const vals = data.map(d => d.value).sort((a, b) => a - b)
    const n = vals.length
    if (n === 0) return null
    const sum = vals.reduce((s, v) => s + v, 0)
    const mean = sum / n
    const median = n % 2 === 0 ? (vals[n / 2 - 1] + vals[n / 2]) / 2 : vals[Math.floor(n / 2)]
    const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / n
    const std = Math.sqrt(variance)
    const q1 = vals[Math.floor(n * 0.25)]
    const q3 = vals[Math.floor(n * 0.75)]
    return { n, mean, median, std, min: vals[0], max: vals[n - 1], sum, q1, q3, iqr: q3 - q1 }
  }

  // ─── Copy chart to clipboard as image ──────────────────────
  const [copiedChart, setCopiedChart] = useState<string | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const copyChartToClipboard = useCallback(async (id: string) => {
    const el = chartRefs.current[id]
    if (!el) return
    // 3D charts: bypass html2canvas and use Plotly's native rasterizer
    // so the WebGL scene actually comes through on the clipboard image.
    const isPlotly = !!el.querySelector('.js-plotly-plot')
    if (isPlotly) {
      try {
        const blob = await getPlotBlob(el, 'png')
        if (blob) {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
          setCopiedChart(id)
          setTimeout(() => setCopiedChart(null), 2000)
          return
        }
      } catch { /* fall through to html2canvas */ }
    }
    try {
      // Transparent clipboard copy: chart drops onto whatever surface
      // the user pastes into (paper, slide deck, whiteboard) without
      // dragging the app's dark chrome with it.
      const canvas = await html2canvas(el, {
        backgroundColor: null,
        scale: 2,
        useCORS: true,
        logging: false,
      })
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
      if (blob) {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        setCopiedChart(id)
        setTimeout(() => setCopiedChart(null), 2000)
      } else {
        toast('error', 'Could not encode the chart as a PNG. Try the export-PNG button instead.')
      }
    } catch (err) {
      // Don't fake the success state — clipboard.write failed and the
      // user has nothing to paste.
      console.error('chart copy failed', err)
      toast('error', 'Copy to clipboard failed. The chart was not copied; try the PNG export button.')
    }
  }, [])

  // ─── Render any chart ───────────────────────────────────────
  const renderChart = (chart: ChartConfig, height = 300) => {
    const { type, options: o } = chart
    const maxPoints = type === 'scatter' ? 500 : 100
    const displayData = smartDownsample(chart.data, maxPoints)
    const wasDownsampled = displayData.length < chart.data.length
    const data = o.trendLine !== 'none' ? addTrendData(displayData, o.trendLine) : displayData
    const hasTrend = o.trendLine !== 'none' && data.some(d => d.trend !== undefined)
    // ── Apply CI bands if requested ──
    let baseData = data
    if (o.showCI && (type === 'line' || type === 'multi_line' || type === 'area' || type === 'spline' || type === 'step')) {
      baseData = addCIBands(baseData, o.ciLevel || 0.95)
    }
    const finalData = baseData
    const hasCI = o.showCI && finalData.some((d) => d.ciLow !== undefined)
    // Resolve color palette. Custom overrides win over the named
    // palette so a user can hand-tune individual series colors via
    // the per-color picker without leaving the original palette
    // selection (preserves the CB-safe attribution if applicable).
    // Journal themes (paper / nature / science / ieee) automatically
    // upgrade to a colour-blind-safe palette (Okabe-Ito) when the user
    // is still on the generic `default` palette. Roughly 8 % of male
    // readers and 0.5 % of female readers can't distinguish standard
    // editorial palettes, and most journals (Nature, Science, JAMA,
    // PLOS) explicitly require CB-safe figures or call them out as
    // strongly preferred. Users who explicitly pick a non-default
    // palette keep their choice — we only override `default`.
    const isJournalTheme = o.pubTheme && o.pubTheme !== 'screen'
    const effectivePaletteName =
      isJournalTheme && o.colorPalette === 'default' ? 'okabe_ito' : o.colorPalette
    // Uniform margin applied to every chart wrapper. Recharts'
    // default `{ top: 5, right: 5, bottom: 5, left: 5 }` was too
    // tight: the X-axis label (`insideBottom, offset -5`) collided
    // with the bottom legend on every chart that had both. Padding
    // the bottom to 28 + left to 24 gives both axis labels +
    // legend room to coexist; right/top stay small so the plot
    // area still dominates the card. tickStyle's per-theme
    // baselines mean these absolute pixel values look proportional
    // at any theme.
    // Bottom margin grows when we have chrome there. Top margin
    // grows when the legend is forced to the top (the both-present
    // case escape valve — see legendVAlign computation below). Other
    // axis-specific tweaks: yLabel needs left padding so the rotated
    // label has somewhere to live without colliding with the y-tick
    // numbers.
    // Animation is suppressed on journal themes regardless of the
    // user's toggle — paper figures are static, animation can disrupt
    // PDF export rendering, and the user picking a journal theme
    // implicitly opts into static-figure semantics. They can still
    // see animation when on the screen theme.
    const isJournal = o.pubTheme && o.pubTheme !== 'screen'
    const effectiveAnimate = isJournal ? false : !!o.animate
    const animDur = effectiveAnimate ? 400 : 0
    const hasBottomLegend = o.showLegend && o.legendPosition === 'bottom'
    const legendForcedTop = o.xLabel && hasBottomLegend
    const chartMargin = {
      top: legendForcedTop || o.legendPosition === 'top' ? 36 : 12,
      right: 24,
      bottom: o.xLabel ? 36 : hasBottomLegend && !legendForcedTop ? 32 : 16,
      left: o.yLabel ? 24 : 8,
    }
    const namedPalette = getPalette(effectivePaletteName)
    const colors = (chart.customPalette && chart.customPalette.length > 0)
      ? namedPalette.map((c, i) => chart.customPalette![i] || c)
      : namedPalette
    // ── Apply publication theme ──
    const theme = THEMES[o.pubTheme || 'screen']
    const fs = FONT_SCALE_MULT[o.fontScale || 'normal']
    // Per-theme typography baselines (Nature: 7pt tick / 8pt label,
    // screen: 10/11). The user's fontScale option still scales them.
    const tickStyle = {
      fontSize: theme.tickFontSize * fs,
      fontWeight: theme.tickFontWeight,
      fill: theme.mutedColor,
      fontFamily: theme.bodyFont,
    }
    const labelStyle = {
      fontSize: theme.axisLabelFontSize * fs,
      fontWeight: theme.axisLabelFontWeight,
      fill: theme.textColor,
      fontFamily: theme.bodyFont,
    }
    const xTickFmt = makeTickFormatter(o.tickFormatX || 'auto', o.decimalPlaces ?? 2)
    const yTickFmt = makeTickFormatter(o.tickFormatY || 'auto', o.decimalPlaces ?? 2)
    const tooltipStyle = { ...TOOLTIP_STYLE, background: theme.tooltipBg, color: theme.textColor, border: `1px solid ${theme.gridColor}` }
    // Themes with `forceHideGrid: true` (Nature, Science) suppress
    // gridlines regardless of the user's `showGrid` option — without
    // this override the user's screen-mode default of showGrid=true
    // would render gridlines on Nature-themed charts and break the
    // visual contract of the chosen theme.
    const showGridEffective = o.showGrid && !theme.forceHideGrid
    const gridEl = showGridEffective ? <CartesianGrid strokeDasharray={theme.gridDash} stroke={theme.gridColor} strokeWidth={theme.gridStrokeWidth} /> : null
    // Hover cursor styling. Recharts picks the cursor type from the
    // chart variant: line / area / scatter use a vertical *stroke*,
    // bar / histogram / waterfall use a *fill* rectangle. The default
    // bar fill is rgba(204,204,204,0.1) — light gray — which on a
    // dark app shell renders as a white-ish flash behind the hovered
    // bar (user-reported on histograms). Setting both stroke and fill
    // explicitly, with muted-policy values, kills the flash on bars
    // and keeps the dashed crosshair on lines. Journal themes get a
    // fully disabled cursor since static figures have no hover.
    const cursorStyle = !o.showCrosshair || isJournal
      ? false as const
      : {
          stroke: theme.mutedColor,
          strokeWidth: 1,
          strokeDasharray: '4 4',
          fill: 'rgba(160, 160, 160, 0.06)',
        }
    const tooltipEl = <Tooltip contentStyle={tooltipStyle} cursor={cursorStyle} formatter={(v) => yTickFmt(Number(v ?? 0))} />
    const hidden = hiddenSeries[chart.id] || new Set<string>()
    const handleLegendClick = (e: { dataKey?: string | number | ((obj: unknown) => unknown) }) => {
      const k = e?.dataKey
      if (typeof k === 'string' || typeof k === 'number') toggleSeries(chart.id, String(k))
    }
    // When both an X-axis label and a bottom legend are present,
    // they compete for the same bottom margin band and partially
    // overlap. Recharts doesn't auto-stack them. Working around by
    // moving the legend to the TOP for that case — keeps both
    // visible without playing pixel-tetris with paddingTop. When
    // user explicitly picks legendPosition: 'top'/'left'/'right'
    // we honour it. Only the bottom-default case flips.
    const legendVAlign: 'top' | 'middle' | 'bottom' =
      o.xLabel && hasBottomLegend ? 'top'
      : o.legendPosition === 'top' ? 'top'
      : 'bottom'
    const legendAlign: 'left' | 'center' | 'right' =
      o.legendPosition === 'left' ? 'left'
      : o.legendPosition === 'right' ? 'right'
      : 'center'
    const legendWrapperStyle: React.CSSProperties = {
      fontSize: theme.legendFontSize * fs,
      cursor: 'pointer',
      fontFamily: theme.bodyFont,
      color: theme.textColor,
    }
    const legendEl = o.showLegend ? (
      <Legend
        verticalAlign={legendVAlign}
        align={legendAlign}
        wrapperStyle={legendWrapperStyle}
        onClick={handleLegendClick}
        formatter={(value: string) => (
          <span style={{
            opacity: hidden.has(value) ? 0.3 : 1,
            textDecoration: hidden.has(value) ? 'line-through' : 'none',
            color: theme.textColor,
          }}>{value}</span>
        )}
      />
    ) : null
    const brushEl = o.showBrush && data.length > 5 ? <Brush dataKey="label" height={20} stroke={theme.axisColor} fill={theme.bg === 'transparent' ? 'var(--glass-bg)' : '#F0F0F0'} travellerWidth={8} /> : null
    const xAxisProps: Record<string, unknown> = {
      dataKey: 'label',
      tick: tickStyle,
      stroke: theme.axisColor,
      strokeWidth: theme.axisStrokeWidth,
      tickFormatter: xTickFmt,
      // X-axis label sits outside the plot area (`position: 'bottom'`)
      // with a small dy to clear the tick labels. Earlier
      // `position: 'insideBottom', offset: -5` rendered the label
      // INSIDE the plot at the same y as the bottom legend, so they
      // visually collided. Outside-the-axis is the journal-figure
      // convention anyway.
      label: o.xLabel ? { value: o.xLabel, position: 'bottom', dy: 8, style: labelStyle } : undefined,
      scale: o.logScaleX ? 'log' : 'auto',
    }
    if (o.tickCountX && o.tickCountX > 0) xAxisProps.tickCount = o.tickCountX
    const xAxisEl = <XAxis {...xAxisProps} />
    const yAxisProps: Record<string, unknown> = {
      tick: tickStyle,
      stroke: theme.axisColor,
      strokeWidth: theme.axisStrokeWidth,
      tickFormatter: yTickFmt,
      label: o.yLabel ? { value: o.yLabel, angle: -90, position: 'insideLeft', style: labelStyle } : undefined,
      scale: o.logScaleY ? 'log' : 'auto',
      domain: o.logScaleY ? ['auto', 'auto'] : undefined,
    }
    if (o.tickCountY && o.tickCountY > 0) yAxisProps.tickCount = o.tickCountY
    const yAxisEl = <YAxis {...yAxisProps} />
    // Reference bands (shaded zones) render before annotation lines
    // so the lines layer on top of them.
    const bandEls = (chart.referenceBands || []).map(band => (
      <ReferenceArea
        key={band.id}
        x1={band.axis === 'x' ? band.from : undefined}
        x2={band.axis === 'x' ? band.to : undefined}
        y1={band.axis === 'y' ? band.from : undefined}
        y2={band.axis === 'y' ? band.to : undefined}
        fill={band.color}
        fillOpacity={band.opacity}
        stroke="none"
        label={band.label ? { value: band.label, position: 'insideTopLeft', style: { fontSize: 10 * fs, fill: theme.mutedColor, fontFamily: theme.bodyFont } } : undefined}
      />
    ))
    const annotationEls = (chart.annotations || []).map(ann => (
      <ReferenceLine key={ann.id} y={ann.axis === 'y' ? ann.value : undefined} x={ann.axis === 'x' ? ann.value : undefined}
        stroke={ann.color} strokeDasharray={ann.style === 'dashed' ? '8 4' : ann.style === 'dotted' ? '2 4' : undefined}
        strokeWidth={1.5} label={{ value: ann.label, position: 'insideTopRight', style: { fontSize: 10 * fs, fill: ann.color, fontWeight: 600, fontFamily: theme.bodyFont } }} />
    ))

    const renderChartSwitch = (): React.ReactNode => { switch (type) {
      // ── BAR CHARTS ──────────────────────────────────────────
      case 'bar':
        return (
          <ResponsiveContainer width="100%" height={height}>
            {hasTrend ? (
              <ComposedChart data={data} barGap={o.barGap} margin={chartMargin}>
                {gridEl}{xAxisEl}{yAxisEl}{tooltipEl}{legendEl}{brushEl}{bandEls}{annotationEls}
                <Bar dataKey="value" fill={colors[0]} radius={[4, 4, 0, 0]} animationDuration={animDur} hide={hidden.has('value')}>
                  {o.showValues && <LabelList dataKey="value" position="top" style={{ fontSize: 10, fill: 'var(--color-text-muted)' }} />}
                </Bar>
                <Line type="monotone" dataKey="trend" name={o.trendLine === 'linear' ? 'Linear Trend' : 'Moving Avg'} stroke="#C4956A" strokeWidth={2} strokeDasharray="6 3" dot={false} />
              </ComposedChart>
            ) : (
              <BarChart data={data} barGap={o.barGap} margin={chartMargin}>
                {gridEl}{xAxisEl}{yAxisEl}{tooltipEl}{legendEl}{brushEl}{bandEls}{annotationEls}
                <Bar dataKey="value" fill={colors[0]} radius={[4, 4, 0, 0]} animationDuration={animDur} hide={hidden.has('value')}>
                  {o.showValues && <LabelList dataKey="value" position="top" style={{ fontSize: 10, fill: 'var(--color-text-muted)' }} />}
                </Bar>
              </BarChart>
            )}
          </ResponsiveContainer>
        )

      case 'horizontal_bar':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <BarChart data={data} layout="vertical" barGap={o.barGap} margin={chartMargin}>
              {gridEl}
              <XAxis type="number" tick={AXIS_TICK} />
              <YAxis dataKey="label" type="category" tick={AXIS_TICK} width={90} />
              {tooltipEl}{legendEl}
              <Bar dataKey="value" fill={colors[0]} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )

      case 'grouped_bar': {
        const cats = [...new Set(data.map(d => d.category).filter(Boolean))]
        if (cats.length === 0) {
          // Use value + value2 as two series
          return (
            <ResponsiveContainer width="100%" height={height}>
              <BarChart data={data} barGap={o.barGap} margin={chartMargin}>
                {gridEl}{xAxisEl}{yAxisEl}{tooltipEl}{legendEl}{bandEls}{annotationEls}
                <Bar dataKey="value" name="Series 1" fill={colors[0]} radius={[4, 4, 0, 0]} />
                {data.some(d => d.value2 !== undefined) && <Bar dataKey="value2" name="Series 2" fill={colors[1]} radius={[4, 4, 0, 0]} />}
                {data.some(d => d.value3 !== undefined) && <Bar dataKey="value3" name="Series 3" fill={colors[2]} radius={[4, 4, 0, 0]} />}
              </BarChart>
            </ResponsiveContainer>
          )
        }
        const labels = [...new Set(data.map(d => d.label))]
        const pivoted = labels.map(label => {
          const row: Record<string, unknown> = { label }
          cats.forEach(cat => { row[cat!] = data.find(d => d.label === label && d.category === cat)?.value || 0 })
          return row
        })
        return (
          <ResponsiveContainer width="100%" height={height}>
            <BarChart data={pivoted} barGap={o.barGap} margin={chartMargin}>
              {gridEl}{xAxisEl}{yAxisEl}{tooltipEl}{legendEl}{bandEls}{annotationEls}
              {cats.map((cat, i) => <Bar key={cat} dataKey={cat!} fill={colors[i % colors.length]} radius={[4, 4, 0, 0]} />)}
            </BarChart>
          </ResponsiveContainer>
        )
      }

      case 'stacked_bar':
      case 'stacked_bar_100': {
        const cats = [...new Set(data.map(d => d.category).filter(Boolean))]
        if (cats.length === 0) {
          return (
            <ResponsiveContainer width="100%" height={height}>
              <BarChart data={data} margin={chartMargin}>
                {gridEl}{xAxisEl}{yAxisEl}{tooltipEl}{legendEl}{bandEls}{annotationEls}
                <Bar dataKey="value" stackId="a" fill={colors[0]} />
                {data.some(d => d.value2 !== undefined) && <Bar dataKey="value2" stackId="a" fill={colors[1]} />}
              </BarChart>
            </ResponsiveContainer>
          )
        }
        const labels = [...new Set(data.map(d => d.label))]
        let pivoted = labels.map(label => {
          const row: Record<string, unknown> = { label }
          cats.forEach(cat => { row[cat!] = data.find(d => d.label === label && d.category === cat)?.value || 0 })
          return row
        })
        if (type === 'stacked_bar_100') {
          pivoted = pivoted.map(row => {
            const total = cats.reduce((s, cat) => s + (Number(row[cat!]) || 0), 0)
            const normalized: Record<string, unknown> = { label: row.label }
            cats.forEach(cat => { normalized[cat!] = total > 0 ? Math.round((Number(row[cat!]) / total) * 100 * 10) / 10 : 0 })
            return normalized
          })
        }
        return (
          <ResponsiveContainer width="100%" height={height}>
            <BarChart data={pivoted} margin={chartMargin}>
              {gridEl}{xAxisEl}{yAxisEl}{tooltipEl}{legendEl}{bandEls}{annotationEls}
              {cats.map((cat, i) => <Bar key={cat} dataKey={cat!} stackId="a" fill={colors[i % colors.length]} />)}
            </BarChart>
          </ResponsiveContainer>
        )
      }

      case 'waterfall': {
        let cumulative = 0
        const waterfallData = data.map((d, i) => {
          const start = cumulative
          cumulative += d.value
          return { ...d, start, end: cumulative, fill: i === data.length - 1 ? colors[2] : d.value >= 0 ? colors[0] : colors[3] || '#B07E8B' }
        })
        return (
          <ResponsiveContainer width="100%" height={height}>
            <BarChart data={waterfallData} margin={chartMargin}>
              {gridEl}{xAxisEl}{yAxisEl}{tooltipEl}
              <Bar dataKey="end" fill="transparent" stackId="w">
                {waterfallData.map((_, i) => <Cell key={i} fill="transparent" />)}
              </Bar>
              <Bar dataKey="value" stackId="w2" radius={[3, 3, 0, 0]}>
                {waterfallData.map((d, i) => <Cell key={i} fill={d.fill} />)}
              </Bar>
              <ReferenceLine y={0} stroke="var(--color-text-muted)" strokeDasharray="3 3" />
            </BarChart>
          </ResponsiveContainer>
        )
      }

      // ── LINE CHARTS ─────────────────────────────────────────
      case 'line':
        return (
          <ResponsiveContainer width="100%" height={height}>
            {hasCI ? (
              <ComposedChart data={finalData} margin={chartMargin}>
                {gridEl}{xAxisEl}{yAxisEl}{tooltipEl}{legendEl}{brushEl}{bandEls}{annotationEls}
                {/* CI band — shaded high - low envelope rendered behind the main line. */}
                <Area type={o.smooth ? 'monotone' : 'linear'} dataKey="ciHigh" stroke="none" fill={colors[0]} fillOpacity={0.15} name={`+${Math.round(o.ciLevel * 100)}% CI`} />
                <Area type={o.smooth ? 'monotone' : 'linear'} dataKey="ciLow" stroke="none" fill={theme.bg === 'transparent' ? 'var(--color-bg)' : theme.bg} fillOpacity={1} legendType="none" />
                <Line type={o.smooth ? 'monotone' : 'linear'} dataKey="value" stroke={colors[0]} strokeWidth={o.lineWidth} dot={{ r: o.markerSize, fill: colors[0] }} animationDuration={animDur} hide={hidden.has('value')} />
                {hasTrend && <Line type="monotone" dataKey="trend" name={o.trendLine === 'linear' ? 'Linear Trend' : 'Moving Avg'} stroke="#C4956A" strokeWidth={2} strokeDasharray="6 3" dot={false} />}
              </ComposedChart>
            ) : (
              <LineChart data={finalData} margin={chartMargin}>
                {gridEl}{xAxisEl}{yAxisEl}{tooltipEl}{legendEl}{brushEl}{bandEls}{annotationEls}
                <Line type={o.smooth ? 'monotone' : 'linear'} dataKey="value" stroke={colors[0]} strokeWidth={o.lineWidth} dot={{ r: o.markerSize, fill: colors[0] }} animationDuration={animDur} hide={hidden.has('value')} />
                {hasTrend && <Line type="monotone" dataKey="trend" name={o.trendLine === 'linear' ? 'Linear Trend' : 'Moving Avg'} stroke="#C4956A" strokeWidth={2} strokeDasharray="6 3" dot={false} />}
              </LineChart>
            )}
          </ResponsiveContainer>
        )

      case 'multi_line':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <LineChart data={data} margin={chartMargin}>
              {gridEl}{xAxisEl}{yAxisEl}{tooltipEl}{legendEl}{brushEl}{bandEls}{annotationEls}
              <Line type="monotone" dataKey="value" name="Series 1" stroke={colors[0]} strokeWidth={o.lineWidth} dot={{ r: o.markerSize }} hide={hidden.has('value')} />
              {data.some(d => d.value2 !== undefined) && <Line type="monotone" dataKey="value2" name="Series 2" stroke={colors[1]} strokeWidth={o.lineWidth} dot={{ r: o.markerSize }} hide={hidden.has('value2')} />}
              {data.some(d => d.value3 !== undefined) && <Line type="monotone" dataKey="value3" name="Series 3" stroke={colors[2]} strokeWidth={o.lineWidth} dot={{ r: o.markerSize }} hide={hidden.has('value3')} />}
            </LineChart>
          </ResponsiveContainer>
        )

      case 'step':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <LineChart data={data} margin={chartMargin}>
              {gridEl}{xAxisEl}{yAxisEl}{tooltipEl}{legendEl}{brushEl}{bandEls}{annotationEls}
              <Line type="stepAfter" dataKey="value" stroke={colors[0]} strokeWidth={o.lineWidth} dot={{ r: o.markerSize, fill: colors[0] }} hide={hidden.has('value')} />
            </LineChart>
          </ResponsiveContainer>
        )

      case 'spline':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <LineChart data={data} margin={chartMargin}>
              {gridEl}{xAxisEl}{yAxisEl}{tooltipEl}{legendEl}{brushEl}{bandEls}{annotationEls}
              <Line type="natural" dataKey="value" stroke={colors[0]} strokeWidth={o.lineWidth} dot={{ r: o.markerSize, fill: colors[0] }} hide={hidden.has('value')} />
            </LineChart>
          </ResponsiveContainer>
        )

      case 'stem':
        // Lollipop chart: bars + dots
        return (
          <ResponsiveContainer width="100%" height={height}>
            <ComposedChart data={data} margin={chartMargin}>
              {gridEl}{xAxisEl}{yAxisEl}{tooltipEl}
              <Bar dataKey="value" fill={colors[0]} barSize={2} />
              <Line type="linear" dataKey="value" stroke="none" dot={{ r: o.markerSize + 2, fill: colors[0], strokeWidth: 0 }} />
            </ComposedChart>
          </ResponsiveContainer>
        )

      // ── AREA CHARTS ─────────────────────────────────────────
      case 'area':
        return (
          <ResponsiveContainer width="100%" height={height}>
            {hasTrend ? (
              <ComposedChart data={data} margin={chartMargin}>
                {gridEl}{xAxisEl}{yAxisEl}{tooltipEl}{legendEl}{brushEl}{bandEls}{annotationEls}
                <Area type="monotone" dataKey="value" stroke={colors[0]} fill={colors[0]} fillOpacity={o.fillOpacity} strokeWidth={o.lineWidth} hide={hidden.has('value')} />
                <Line type="monotone" dataKey="trend" name={o.trendLine === 'linear' ? 'Linear Trend' : 'Moving Avg'} stroke="#C4956A" strokeWidth={2} strokeDasharray="6 3" dot={false} />
              </ComposedChart>
            ) : (
              <AreaChart data={data} margin={chartMargin}>
                {gridEl}{xAxisEl}{yAxisEl}{tooltipEl}{legendEl}{brushEl}{bandEls}{annotationEls}
                <Area type="monotone" dataKey="value" stroke={colors[0]} fill={colors[0]} fillOpacity={o.fillOpacity} strokeWidth={o.lineWidth} hide={hidden.has('value')} />
              </AreaChart>
            )}
          </ResponsiveContainer>
        )

      case 'stacked_area':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <AreaChart data={data} margin={chartMargin}>
              {gridEl}{xAxisEl}{yAxisEl}{tooltipEl}{legendEl}{brushEl}{bandEls}{annotationEls}
              <Area type="monotone" dataKey="value" stackId="1" name="Series 1" stroke={colors[0]} fill={colors[0]} fillOpacity={o.fillOpacity} hide={hidden.has('value')} />
              {data.some(d => d.value2 !== undefined) && <Area type="monotone" dataKey="value2" stackId="1" name="Series 2" stroke={colors[1]} fill={colors[1]} fillOpacity={o.fillOpacity} hide={hidden.has('value2')} />}
              {data.some(d => d.value3 !== undefined) && <Area type="monotone" dataKey="value3" stackId="1" name="Series 3" stroke={colors[2]} fill={colors[2]} fillOpacity={o.fillOpacity} hide={hidden.has('value3')} />}
            </AreaChart>
          </ResponsiveContainer>
        )

      case 'stream':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <AreaChart data={data} stackOffset="silhouette" margin={chartMargin}>
              {gridEl}{xAxisEl}{yAxisEl}{tooltipEl}{legendEl}{bandEls}{annotationEls}
              <Area type="monotone" dataKey="value" stackId="1" stroke={colors[0]} fill={colors[0]} fillOpacity={0.6} />
              {data.some(d => d.value2 !== undefined) && <Area type="monotone" dataKey="value2" stackId="1" stroke={colors[1]} fill={colors[1]} fillOpacity={0.6} />}
              {data.some(d => d.value3 !== undefined) && <Area type="monotone" dataKey="value3" stackId="1" stroke={colors[2]} fill={colors[2]} fillOpacity={0.6} />}
            </AreaChart>
          </ResponsiveContainer>
        )

      case 'band':
        // Render as area between value (low) and value2 (high)
        return (
          <ResponsiveContainer width="100%" height={height}>
            <AreaChart data={data} margin={chartMargin}>
              {gridEl}{xAxisEl}{yAxisEl}{tooltipEl}{legendEl}{bandEls}{annotationEls}
              <Area type="monotone" dataKey="value2" stroke="none" fill={colors[0]} fillOpacity={o.fillOpacity} name="Upper" />
              <Area type="monotone" dataKey="value" stroke="none" fill="var(--color-bg)" fillOpacity={1} name="Lower" />
              <Line type="monotone" dataKey="value" stroke={colors[0]} strokeWidth={o.lineWidth} dot={false} />
              <Line type="monotone" dataKey="value2" stroke={colors[0]} strokeWidth={o.lineWidth} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        )

      // ── CIRCULAR CHARTS ─────────────────────────────────────
      case 'pie':
      case 'donut': {
        // Drop labels on slices smaller than 4 % — under that the
        // ${name} ${percent}% string overlaps neighbouring labels and
        // looks like a dropped pixel. The legend still carries the
        // full breakdown for those slices. Also: labelLine={false}
        // because journal convention is "no leader line", and outer
        // radius shrunk slightly to leave room for the labels we
        // DO render.
        const pieLabel = ({ name, percent }: { name?: string; percent?: number }) => {
          const p = (percent ?? 0) * 100
          if (p < 4) return ''
          return `${name ?? ''} ${p.toFixed(0)}%`
        }
        const pieOuter = Math.max(40, height / 3 - 18)
        const isPie = type === 'pie'
        return (
          <ResponsiveContainer width="100%" height={height}>
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="label"
                cx="50%"
                cy="50%"
                outerRadius={pieOuter}
                innerRadius={isPie ? 0 : o.innerRadius}
                label={pieLabel}
                labelLine={false}
                startAngle={o.startAngle}
                endAngle={o.startAngle + 360}
                animationDuration={animDur}
              >
                {data.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
              </Pie>
              {tooltipEl}{legendEl}
            </PieChart>
          </ResponsiveContainer>
        )
      }

      case 'radial_bar': {
        const rbData = data.map((d, i) => ({ ...d, fill: colors[i % colors.length] }))
        return (
          <ResponsiveContainer width="100%" height={height}>
            <RadialBarChart data={rbData} cx="50%" cy="50%" innerRadius="20%" outerRadius="90%" startAngle={180} endAngle={0}>
              <RadialBar dataKey="value" label={{ fill: 'var(--color-text-muted)', fontSize: 10 }} />
              {tooltipEl}{legendEl}
            </RadialBarChart>
          </ResponsiveContainer>
        )
      }

      case 'polar_area':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <RadarChart data={data} cx="50%" cy="50%" outerRadius="70%">
              <PolarGrid stroke="var(--color-border)" />
              <PolarAngleAxis dataKey="label" tick={AXIS_TICK} />
              <PolarRadiusAxis tick={AXIS_TICK} />
              <Radar dataKey="value" stroke={colors[0]} fill={colors[0]} fillOpacity={0.5} />
              {tooltipEl}
            </RadarChart>
          </ResponsiveContainer>
        )

      case 'radar':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <RadarChart data={data} cx="50%" cy="50%" outerRadius="70%">
              <PolarGrid stroke="var(--color-border)" />
              <PolarAngleAxis dataKey="label" tick={AXIS_TICK} />
              <PolarRadiusAxis tick={AXIS_TICK} />
              <Radar dataKey="value" name="Series 1" stroke={colors[0]} fill={colors[0]} fillOpacity={o.fillOpacity} strokeWidth={o.lineWidth} />
              {data.some(d => d.value2 !== undefined) && (
                <Radar dataKey="value2" name="Series 2" stroke={colors[1]} fill={colors[1]} fillOpacity={o.fillOpacity} strokeWidth={o.lineWidth} />
              )}
              {tooltipEl}{legendEl}
            </RadarChart>
          </ResponsiveContainer>
        )

      // ── SCATTER / BUBBLE ────────────────────────────────────
      case 'scatter':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <ScatterChart margin={chartMargin}>
              {gridEl}
              <XAxis dataKey="value" name={o.xLabel || 'X'} tick={AXIS_TICK} type="number" />
              <YAxis dataKey="value2" name={o.yLabel || 'Y'} tick={AXIS_TICK} type="number" />
              {tooltipEl}
              <Scatter data={data.map(d => ({ ...d, value2: d.value2 ?? d.value }))} fill={colors[0]}>
                {data.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        )

      case 'bubble':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <ScatterChart margin={chartMargin}>
              {gridEl}
              <XAxis dataKey="value" name="X" tick={AXIS_TICK} type="number" />
              <YAxis dataKey="value2" name="Y" tick={AXIS_TICK} type="number" />
              <ZAxis dataKey="size" range={[40, 400]} name="Size" />
              {tooltipEl}
              <Scatter data={data.map(d => ({ ...d, value2: d.value2 ?? d.value, size: d.size ?? d.value }))} fill={colors[0]}>
                {data.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} opacity={0.7} />)}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        )

      case 'scatter_3d': case 'bubble_3d': case 'line_3d': case 'bar_3d':
      case 'surface_3d': case 'wireframe_3d': case 'contour_3d': case 'trisurf_3d':
      case 'quiver_3d': case 'isosurface_3d': case 'voxel_3d': case 'streamline_3d':
      case 'slice_3d': case 'stem_3d': case 'waterfall_3d': case 'ribbon_3d':
      case 'pie_3d': {
        const points3d = data.map(d => ({
          x: d.value,
          y: d.value2 ?? d.value * 0.8,
          z: d.value3 ?? d.value * 0.5,
          label: d.label,
          category: d.category,
          size: d.size,
        }))
        return (
          <PlotlyPlot3D
            data={points3d}
            chartType={type as Chart3DType}
            title=""
            xLabel={o.xLabel || 'X'}
            yLabel={o.yLabel || 'Y'}
            zLabel={o.zLabel || 'Z'}
            height={height}
            colorScheme={data.some(d => d.category) ? 'categorical' : 'viridis'}
            pointSize={o.markerSize || 3}
            surfaceFunction={type.includes('surface') || type === 'wireframe_3d' || type === 'contour_3d'
              ? (x: number, y: number) => Math.sin(x * 2) * Math.cos(y * 2) * 1.5
              : undefined}
          />
        )
      }

      // ── STATISTICAL ─────────────────────────────────────────
      case 'histogram': {
        const hist = computeHistogram(data.map(d => d.value))
        return (
          <ResponsiveContainer width="100%" height={height}>
            <BarChart data={hist} margin={chartMargin}>
              {gridEl}
              <XAxis dataKey="label" tick={AXIS_TICK} />
              <YAxis tick={AXIS_TICK} />
              {tooltipEl}
              {brushEl}
              <Bar dataKey="count" fill={colors[0]} radius={[2, 2, 0, 0]}>
                {hist.map((_, i) => <Cell key={i} fill={colors[0]} opacity={0.8} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )
      }

      case 'box_plot': {
        // Group by category or treat all as one group
        const groups: Record<string, number[]> = {}
        data.forEach(d => {
          const grp = d.category || d.label || 'All'
          if (!groups[grp]) groups[grp] = []
          groups[grp].push(d.value)
        })
        const boxData = Object.entries(groups).map(([name, vals]) => {
          const stats = computeBoxStats(vals)
          return { name, ...stats, outlierCount: stats.outliers.length }
        })
        // Render as bar chart with custom rendering. Uses the
        // theme-aware tickStyle + theme.gridColor instead of the
        // hard-coded AXIS_TICK / var(--color-border) so paper /
        // nature / science themes don't get screen-token colours.
        return (
          <ResponsiveContainer width="100%" height={height}>
            <ComposedChart data={boxData} margin={chartMargin}>
              {gridEl}
              <XAxis dataKey="name" tick={tickStyle} stroke={theme.axisColor} strokeWidth={theme.axisStrokeWidth} />
              <YAxis tick={tickStyle} stroke={theme.axisColor} strokeWidth={theme.axisStrokeWidth} />
              {tooltipEl}
              {/* IQR box */}
              <Bar dataKey="q3" fill="transparent" stackId="box" />
              <Bar dataKey="median" fill={colors[0]} opacity={0.3} stackId="box2" barSize={40} radius={[4, 4, 4, 4]} />
              {/* Whiskers */}
              <Line type="linear" dataKey="max" stroke={colors[0]} dot={{ r: 3 }} />
              <Line type="linear" dataKey="min" stroke={colors[0]} dot={{ r: 3 }} />
              <Line type="linear" dataKey="q1" stroke={colors[0]} dot={{ r: 5, fill: colors[0] }} strokeWidth={0} />
              <Line type="linear" dataKey="q3" stroke={colors[0]} dot={{ r: 5, fill: colors[0] }} strokeWidth={0} />
              <ReferenceLine y={0} stroke={theme.gridColor} />
            </ComposedChart>
          </ResponsiveContainer>
        )
      }

      case 'violin': {
        // Group data by category, compute kernel density for each
        const vGroups: Record<string, number[]> = {}
        data.forEach(d => {
          const grp = d.category || d.label || 'All'
          if (!vGroups[grp]) vGroups[grp] = []
          vGroups[grp].push(d.value)
        })
        const vEntries = Object.entries(vGroups)
        // Single-pass — spread can overflow the argument list for large series.
        let vMin = Infinity, vMax = -Infinity
        for (const d of data) {
          const v = d.value
          if (!Number.isFinite(v)) continue
          if (v < vMin) vMin = v
          if (v > vMax) vMax = v
        }
        if (!Number.isFinite(vMin)) { vMin = 0; vMax = 1 }
        const vRange = vMax - vMin || 1
        const vPad = vRange * 0.1
        const ySteps = 40
        const groupW = Math.min(120, (600 / Math.max(vEntries.length, 1)))
        const svgW = vEntries.length * groupW + 80
        return (
          <div style={{ overflowX: 'auto', height }}>
            <svg width={svgW} height={height} style={{ fontFamily: 'var(--font-mono, monospace)' }}>
              {/* Y axis */}
              {Array.from({ length: 5 }, (_, i) => {
                const val = vMin - vPad + (vRange + 2 * vPad) * (i / 4)
                const y = height - 30 - ((i / 4) * (height - 50))
                return <g key={i}><line x1={55} x2={svgW} y1={y} y2={y} stroke={theme.gridColor} strokeDasharray="2,2" /><text x={50} y={y + 4} textAnchor="end" fill={theme.mutedColor} fontFamily={theme.bodyFont} fontSize={theme.tickFontSize * fs}>{val.toFixed(1)}</text></g>
              })}
              {vEntries.map(([name, vals], gi) => {
                const sorted = [...vals].sort((a, b) => a - b)
                const cx = 65 + gi * groupW + groupW / 2
                // Silverman's rule of thumb: h = 1.06 * sigma * n^(-1/5).
                // The previous bw grew with sample size, which over-smooths
                // the violin until it looks like a blob. Silverman narrows
                // bandwidth as data accumulates, preserving modes.
                const nV = vals.length
                let mean = 0
                for (const v of sorted) mean += v
                mean /= nV || 1
                let variance = 0
                for (const v of sorted) variance += (v - mean) ** 2
                const sigma = Math.sqrt(variance / Math.max(nV - 1, 1))
                const fallbackScale = (vMax - vMin) || 1
                const bw = Math.max(
                  (sigma > 0 ? 1.06 * sigma * Math.pow(nV, -1 / 5) : fallbackScale * 0.08),
                  fallbackScale * 0.02,
                )
                // KDE estimation
                const kde: { y: number; density: number }[] = []
                let maxD = 0
                for (let i = 0; i <= ySteps; i++) {
                  const v = (vMin - vPad) + (vRange + 2 * vPad) * (i / ySteps)
                  let d = 0
                  for (const sv of sorted) d += Math.exp(-0.5 * ((v - sv) / bw) ** 2) / (bw * 2.507)
                  d /= sorted.length
                  if (d > maxD) maxD = d
                  kde.push({ y: v, density: d })
                }
                const halfW = groupW * 0.4
                const toY = (v: number) => height - 30 - ((v - vMin + vPad) / (vRange + 2 * vPad)) * (height - 50)
                const pathR = kde.map(k => `${cx + (k.density / maxD) * halfW},${toY(k.y)}`).join(' ')
                const pathL = kde.map(k => `${cx - (k.density / maxD) * halfW},${toY(k.y)}`).reverse().join(' ')
                const stats = computeBoxStats(vals)
                const col = colors[gi % colors.length]
                return (
                  <g key={name}>
                    <polygon points={`${pathR} ${pathL}`} fill={col} opacity={0.28} stroke={col} strokeWidth={1.5} />
                    {/* IQR mini-box spanning q1..q3 */}
                    <rect x={cx - 3} y={toY(stats.q3)} width={6} height={toY(stats.q1) - toY(stats.q3)}
                      fill={col} opacity={0.55} rx={1.5} />
                    {/* Whisker line min..max */}
                    <line x1={cx} x2={cx} y1={toY(stats.max)} y2={toY(stats.min)} stroke={col} strokeWidth={1} opacity={0.7} />
                    {/* Median dot */}
                    <circle cx={cx} cy={toY(stats.median)} r={3} fill="#fff" stroke={col} strokeWidth={1.5} />
                    <text x={cx} y={height - 10} textAnchor="middle" fill={theme.mutedColor} fontFamily={theme.bodyFont} fontSize={theme.tickFontSize * fs}>{name}</text>
                  </g>
                )
              })}
            </svg>
          </div>
        )
      }

      case 'density': {
        // Kernel Density Estimation rendered as smooth AreaChart.
        // Silverman's rule: h = 1.06 * sigma * n^(-1/5). Previous rule
        // scaled bandwidth with sqrt(n) which oversmoothed for large
        // samples. This version preserves modes while still being
        // robust on small samples by clamping to 2 % of range.
        const vals = data.map(d => d.value).sort((a, b) => a - b)
        const dMin = vals[0], dMax = vals[vals.length - 1]
        const dRange = dMax - dMin || 1
        const nD = vals.length
        let meanD = 0
        for (const v of vals) meanD += v
        meanD /= nD || 1
        let varD = 0
        for (const v of vals) varD += (v - meanD) ** 2
        const sigmaD = Math.sqrt(varD / Math.max(nD - 1, 1))
        const bw = Math.max(
          sigmaD > 0 ? 1.06 * sigmaD * Math.pow(nD, -1 / 5) : dRange * 0.08,
          dRange * 0.02,
        )
        const steps = 80
        const kdeData: { x: number; density: number }[] = []
        for (let i = 0; i <= steps; i++) {
          const x = dMin - dRange * 0.1 + (dRange * 1.2) * (i / steps)
          let d = 0
          for (const v of vals) d += Math.exp(-0.5 * ((x - v) / bw) ** 2) / (bw * 2.507)
          d /= vals.length
          kdeData.push({ x: parseFloat(x.toFixed(2)), density: parseFloat(d.toFixed(6)) })
        }
        return (
          <ResponsiveContainer width="100%" height={height}>
            <AreaChart data={kdeData} margin={chartMargin}>
              {gridEl}
              <XAxis dataKey="x" tick={AXIS_TICK} />
              <YAxis tick={AXIS_TICK} />
              {tooltipEl}
              <Area type="monotone" dataKey="density" stroke={colors[0]} fill={colors[0]} fillOpacity={0.2} strokeWidth={2} dot={false} />
              {bandEls}{annotationEls}
            </AreaChart>
          </ResponsiveContainer>
        )
      }

      case 'error_bar':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <BarChart data={data} margin={chartMargin}>
              {gridEl}{xAxisEl}{yAxisEl}{tooltipEl}
              <Bar dataKey="value" fill={colors[0]} radius={[4, 4, 0, 0]}>
                <ErrorBar dataKey="errorPlus" width={4} strokeWidth={2} stroke={colors[1] || '#B07E8B'} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )

      case 'candlestick': {
        // value=open, value2=close, value3=high, errorPlus=low
        return (
          <ResponsiveContainer width="100%" height={height}>
            <ComposedChart data={data} margin={chartMargin}>
              {gridEl}{xAxisEl}{yAxisEl}{tooltipEl}
              <Bar dataKey="value" fill="transparent" />
              {data.map((d, i) => {
                const open = d.value, close = d.value2 ?? d.value
                const color = close >= open ? '#6BA594' : '#B07E8B'
                return <ReferenceLine key={i} y={close} stroke={color} strokeWidth={0} />
              })}
              <Bar dataKey="value2" barSize={12}>
                {data.map((d, i) => {
                  const open = d.value, close = d.value2 ?? d.value
                  return <Cell key={i} fill={close >= open ? '#6BA594' : '#B07E8B'} />
                })}
              </Bar>
              <Line type="linear" dataKey="value3" stroke="var(--color-text-muted)" strokeWidth={1} dot={{ r: 0 }} />
            </ComposedChart>
          </ResponsiveContainer>
        )
      }

      // ── HEATMAP ─────────────────────────────────────────────
      case 'heatmap': {
        const cats = [...new Set(data.map(d => d.category).filter(Boolean))]
        const labels = [...new Set(data.map(d => d.label))]
        // Single-pass max (spread blows arg-list stack on >10k datapoints)
        let maxVal = 1
        for (let i = 0; i < data.length; i++) {
          const av = Math.abs(data[i].value)
          if (av > maxVal) maxVal = av
        }
        const cellH = Math.max(20, Math.min(40, (height - 40) / Math.max(labels.length, 1)))
        const cellW = Math.max(40, 500 / Math.max(cats.length || 1, 1))
        // Muted-only palette policy: previous implementation used
        // saturated rgba(59,130,246) blue and rgba(239,68,68) red
        // which broke the platform's muted register. Now uses
        // theme-aware muted teal-blue and dusty-rose, intensity
        // mapped via the same alpha channel so 0 values stay near-
        // transparent and the largest values are still readable.
        // Cell-value text picks up theme.textColor too instead of
        // the var(--color-text) which is wrong in paper themes.
        const posColor = (a: number) => `rgba(91, 141, 184, ${a})`   // muted blue (#5B8DB8)
        const negColor = (a: number) => `rgba(181, 113, 112, ${a})` // muted dusty rose (#B57170)
        return (
          <div style={{ overflowX: 'auto', height }}>
            <svg width={Math.max(cats.length * cellW + 100, 300)} height={Math.max(labels.length * cellH + 40, 100)}>
              {labels.map((label, ri) =>
                (cats.length > 0 ? cats : ['']).map((cat, ci) => {
                  const d = data.find(d => d.label === label && (cat === '' || d.category === cat))
                  const v = d?.value ?? 0
                  const intensity = Math.abs(v) / maxVal
                  const color = v >= 0
                    ? posColor(intensity * 0.85)
                    : negColor(intensity * 0.85)
                  // Drop trailing zero on integers so cell labels
                  // read "50" not "50.0" — same convention as the
                  // axis tick formatter.
                  const cellLabel = Number.isInteger(v) ? String(v) : v.toFixed(1)
                  return (
                    <g key={`${ri}-${ci}`}>
                      <rect x={90 + ci * cellW} y={20 + ri * cellH} width={cellW - 2} height={cellH - 2} fill={color} rx={3}>
                        <title>{`${label}${cat ? ` / ${cat}` : ''}: ${v}`}</title>
                      </rect>
                      <text x={90 + ci * cellW + cellW / 2} y={20 + ri * cellH + cellH / 2} textAnchor="middle" dominantBaseline="central"
                        fill={theme.textColor} fontSize={theme.tickFontSize * fs} fontFamily={theme.bodyFont} opacity={0.8}>{cellLabel}</text>
                    </g>
                  )
                })
              )}
              {labels.map((label, ri) => (
                <text key={ri} x={85} y={20 + ri * cellH + cellH / 2} textAnchor="end" dominantBaseline="central"
                  fill={theme.mutedColor} fontSize={theme.tickFontSize * fs} fontFamily={theme.bodyFont}>{label}</text>
              ))}
              {cats.length > 0 && cats.map((cat, ci) => (
                <text key={ci} x={90 + ci * cellW + cellW / 2} y={12} textAnchor="middle"
                  fill={theme.mutedColor} fontSize={theme.tickFontSize * fs} fontFamily={theme.bodyFont}>{cat}</text>
              ))}
              {/* Intensity legend (vertical gradient bar on the right) */}
              {(() => {
                const gx = 90 + (cats.length || 1) * cellW + 12
                const gy = 20
                const gh = Math.min(120, labels.length * cellH)
                const gw = 10
                return (
                  <g>
                    <defs>
                      <linearGradient id="heatmap-legend" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="rgba(59,130,246,0.9)" />
                        <stop offset="50%" stopColor="rgba(180,180,180,0.15)" />
                        <stop offset="100%" stopColor="rgba(239,68,68,0.9)" />
                      </linearGradient>
                    </defs>
                    <rect x={gx} y={gy} width={gw} height={gh} fill="url(#heatmap-legend)" rx={2} />
                    <text x={gx + gw + 4} y={gy + 4} fill="var(--color-text-muted)" fontSize={9}>+{maxVal.toFixed(1)}</text>
                    <text x={gx + gw + 4} y={gy + gh / 2 + 3} fill="var(--color-text-muted)" fontSize={9}>0</text>
                    <text x={gx + gw + 4} y={gy + gh} fill="var(--color-text-muted)" fontSize={9}>−{maxVal.toFixed(1)}</text>
                  </g>
                )
              })()}
            </svg>
          </div>
        )
      }

      // ── FUNNEL / TREEMAP ────────────────────────────────────
      case 'funnel':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <FunnelChart>
              {tooltipEl}
              <Funnel dataKey="value" data={data.map((d, i) => ({ ...d, fill: colors[i % colors.length] }))} isAnimationActive={o.animate}>
                <LabelList position="right" fill="var(--color-text)" stroke="none" dataKey="label" fontSize={11} />
              </Funnel>
            </FunnelChart>
          </ResponsiveContainer>
        )

      case 'treemap':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <Treemap
              data={data.map((d, i) => ({ name: d.label, size: d.value, fill: colors[i % colors.length] }))}
              dataKey="size" aspectRatio={4 / 3} stroke="var(--color-border)"
              content={({ x, y, width, height: h, name, fill }: { x?: number; y?: number; width?: number; height?: number; name?: string; fill?: string }) => (
                <g>
                  <rect x={x} y={y} width={width} height={h} fill={fill} stroke="var(--color-border)" strokeWidth={1} rx={4} />
                  {(width ?? 0) > 40 && (h ?? 0) > 20 && <text x={(x ?? 0) + (width ?? 0) / 2} y={(y ?? 0) + (h ?? 0) / 2} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={11}>{name}</text>}
                </g>
              )}
            />
          </ResponsiveContainer>
        )

      case 'sankey': {
        // Sankey expects rows like: source, target (in `category`),
        // value. We dedupe nodes by name and emit Plotly's two-array
        // node + link format. Fall back to a friendly hint if the
        // user supplied non-flow data so the chart never silently
        // renders empty.
        const flowRows = data
          .filter(d => d.label && d.category && Number.isFinite(d.value) && d.value > 0)
          .map(d => ({ source: d.label, target: d.category!, value: d.value }))
        if (flowRows.length === 0) {
          return (
            <div className="text-center text-xs text-[var(--color-text-muted)] py-8">
              Sankey expects flow rows: <code>source, value, target</code>. Each row becomes a link from the
              source node to the target node weighted by value.
            </div>
          )
        }
        const nodeNames: string[] = []
        const seen = new Set<string>()
        for (const r of flowRows) {
          if (!seen.has(r.source)) { seen.add(r.source); nodeNames.push(r.source) }
          if (!seen.has(r.target)) { seen.add(r.target); nodeNames.push(r.target) }
        }
        const idxOf = (n: string) => nodeNames.indexOf(n)
        return (
          <PlotlyPlot3D
            type={'sankey' as Chart3DType}
            // PlotlyPlot3D consumes a flat DataPoint3D array; for
            // Sankey we provide a stub since the Sankey branch reads
            // `sankeyNodes` and `sankeyLinks` directly.
            data={[]}
            height={height}
            xLabel={o.xLabel || 'Source'}
            yLabel={o.yLabel || 'Flow'}
            zLabel={o.zLabel || 'Target'}
            colors={colors}
            sankeyNodes={nodeNames}
            sankeyLinks={flowRows.map(r => ({ source: idxOf(r.source), target: idxOf(r.target), value: r.value }))}
          />
        )
      }

      default:
        return <div className="text-center text-xs text-[var(--color-text-muted)] py-8">Chart type "{type}" not yet rendered</div>
    } }

    // Apply publication theme background + optional aspect ratio. The
    // wrapper carries the SVG color-blind simulator filter when the
    // user enables a CB preview, plus an optional watermark layer.
    const aspectRatio = ASPECT_RATIO[o.aspect || 'free']
    const wrapperStyle: React.CSSProperties = {
      background: theme.bg,
      color: theme.textColor,
      fontFamily: theme.bodyFont,
      padding: theme.bg === 'transparent' ? 0 : 16,
      borderRadius: theme.bg === 'transparent' ? 0 : 6,
      filter: o.cbSim && o.cbSim !== 'none' ? CB_SIM_FILTER[o.cbSim] : undefined,
      position: 'relative',
    }
    const containerStyle: React.CSSProperties = aspectRatio
      ? { aspectRatio: String(aspectRatio), width: '100%' }
      : { height }

    return (
      <div style={wrapperStyle}>
        {/* SVG filter defs for color-blind simulation. Standard daltonization
            matrices (Brettel/Vienot 1997) — preview only, not applied to exports. */}
        <svg width="0" height="0" style={{ position: 'absolute' }}>
          <defs>
            <filter id="cb-protan">
              <feColorMatrix type="matrix" values="0.567 0.433 0 0 0  0.558 0.442 0 0 0  0 0.242 0.758 0 0  0 0 0 1 0" />
            </filter>
            <filter id="cb-deuter">
              <feColorMatrix type="matrix" values="0.625 0.375 0 0 0  0.7 0.3 0 0 0  0 0.3 0.7 0 0  0 0 0 1 0" />
            </filter>
            <filter id="cb-tritan">
              <feColorMatrix type="matrix" values="0.95 0.05 0 0 0  0 0.433 0.567 0 0  0 0.475 0.525 0 0  0 0 0 1 0" />
            </filter>
          </defs>
        </svg>

        {/* Title block — typography from the per-theme baseline so a
            Nature-themed chart renders with a 10pt title not 16pt. */}
        {o.showTitle && (chart.title || chart.subtitle) && (
          <div style={{ marginBottom: 12 }}>
            {chart.title && (
              <h3 style={{
                margin: 0,
                fontSize: theme.titleFontSize * fs,
                fontWeight: theme.titleFontWeight,
                fontFamily: theme.titleFont,
                color: theme.textColor,
                letterSpacing: o.pubTheme === 'ieee' ? 0 : '-0.01em',
              }}>{chart.title}</h3>
            )}
            {chart.subtitle && (
              <p style={{
                margin: '2px 0 0',
                fontSize: theme.subtitleFontSize * fs,
                color: theme.mutedColor,
                fontFamily: theme.bodyFont,
              }}>
                {chart.subtitle}
              </p>
            )}
          </div>
        )}

        {wasDownsampled && (
          <div className="text-xxs mb-2 flex items-center gap-1" style={{
            color: theme.mutedColor,
            background: theme.bg === 'transparent' ? 'var(--glass-bg)' : '#F8F8F8',
            border: `1px solid ${theme.gridColor}`,
            borderRadius: 4,
            padding: '4px 8px',
          }}>
            <span>Downsampled from {chart.data.length} to {displayData.length} points for display</span>
          </div>
        )}

        <div style={containerStyle}>
          {renderChartSwitch()}
        </div>

        {/* Optional watermark — semitransparent text overlay, useful
            for "DRAFT", "PRELIMINARY", or institution attribution. */}
        {o.watermark && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none', userSelect: 'none',
            fontSize: 64 * fs, fontWeight: 700, opacity: 0.06,
            color: theme.textColor, transform: 'rotate(-22deg)',
            fontFamily: theme.titleFont, letterSpacing: '0.1em',
          }}>{o.watermark}</div>
        )}

        {/* Caption + source */}
        {o.showCaption && (chart.caption || chart.source) && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${theme.gridColor}` }}>
            {chart.caption && (
              <p style={{ margin: 0, fontSize: 11 * fs, lineHeight: 1.4, color: theme.textColor, fontFamily: theme.bodyFont }}>
                {chart.caption}
              </p>
            )}
            {chart.source && (
              <p style={{ margin: chart.caption ? '6px 0 0' : 0, fontSize: 10 * fs, fontStyle: 'italic', color: theme.mutedColor, fontFamily: theme.bodyFont }}>
                Source: {chart.source}
              </p>
            )}
          </div>
        )}
      </div>
    )
  }

  // ─── Settings Panel ─────────────────────────────────────────
  const renderSettingsPanel = (chart: ChartConfig) => (
    <div className="p-4 border-t border-[var(--color-border)] bg-[var(--glass-bg)] space-y-3 animate-slide-down">
      {/* ── Publication-grade controls ── */}
      <div className="border-b border-[var(--glass-border)] pb-3 mb-3">
        <div className="text-xxs uppercase tracking-wider text-[var(--color-text-muted)] mb-2 font-semibold">Publication</div>
        <div className="grid grid-cols-2 gap-3 mb-2">
          <div>
            <label className="text-xxs text-[var(--color-text-muted)] block mb-0.5">Subtitle</label>
            <input className="input text-xs w-full" value={chart.subtitle || ''} onChange={e => saveCharts(charts.map(c => c.id === chart.id ? { ...c, subtitle: e.target.value } : c))} placeholder="(optional)" />
          </div>
          <div>
            <label className="text-xxs text-[var(--color-text-muted)] block mb-0.5">Source attribution</label>
            <input className="input text-xs w-full" value={chart.source || ''} onChange={e => saveCharts(charts.map(c => c.id === chart.id ? { ...c, source: e.target.value } : c))} placeholder="e.g. Smith et al. 2024 Nature 612:45" />
          </div>
        </div>
        <div className="mb-2">
          <label className="text-xxs text-[var(--color-text-muted)] block mb-0.5">Caption (figure legend)</label>
          <textarea className="input text-xs w-full" rows={2} value={chart.caption || ''} onChange={e => saveCharts(charts.map(c => c.id === chart.id ? { ...c, caption: e.target.value } : c))} placeholder="Figure 1. Descriptive caption rendered with the chart…" />
        </div>
        <div className="grid grid-cols-4 gap-3">
          <div>
            <label className="text-xxs text-[var(--color-text-muted)] block mb-0.5">Theme</label>
            <GlassSelect
              value={chart.options.pubTheme}
              onChange={val => updateChartOptions(chart.id, { pubTheme: val as PublicationTheme })}
              options={[
                { value: 'screen', label: 'Screen (dark)' },
                { value: 'paper', label: 'Paper (white)' },
                { value: 'nature', label: 'Nature' },
                { value: 'science', label: 'Science' },
                { value: 'ieee', label: 'IEEE (serif)' },
              ]}
            />
          </div>
          <div>
            <label className="text-xxs text-[var(--color-text-muted)] block mb-0.5">Aspect</label>
            <GlassSelect
              value={chart.options.aspect}
              onChange={val => updateChartOptions(chart.id, { aspect: val as AspectPreset })}
              options={[
                { value: 'free', label: 'Free' },
                { value: '16:9', label: '16:9 (slide)' },
                { value: '4:3', label: '4:3' },
                { value: '3:2', label: '3:2 (photo)' },
                { value: '1:1', label: '1:1 (square)' },
                { value: 'golden', label: 'Golden φ' },
                { value: 'two-col', label: '2:1 (2-col)' },
              ]}
            />
          </div>
          <div>
            <label className="text-xxs text-[var(--color-text-muted)] block mb-0.5">Font scale</label>
            <GlassSelect
              value={chart.options.fontScale}
              onChange={val => updateChartOptions(chart.id, { fontScale: val as FontScale })}
              options={[
                { value: 'small', label: 'Small' },
                { value: 'normal', label: 'Normal' },
                { value: 'large', label: 'Large' },
                { value: 'huge', label: 'Huge' },
              ]}
            />
          </div>
          <div>
            <label className="text-xxs text-[var(--color-text-muted)] block mb-0.5">CB preview</label>
            <GlassSelect
              value={chart.options.cbSim}
              onChange={val => updateChartOptions(chart.id, { cbSim: val as CBlindSim })}
              options={[
                { value: 'none', label: 'No simulation' },
                { value: 'protanopia', label: 'Protanopia (red-blind)' },
                { value: 'deuteranopia', label: 'Deuteranopia (green-blind)' },
                { value: 'tritanopia', label: 'Tritanopia (blue-blind)' },
                { value: 'achromatopsia', label: 'Achromatopsia (gray)' },
              ]}
            />
          </div>
        </div>
        <div className="grid grid-cols-4 gap-3 mt-2">
          <div>
            <label className="text-xxs text-[var(--color-text-muted)] block mb-0.5">X tick format</label>
            <GlassSelect
              value={chart.options.tickFormatX}
              onChange={val => updateChartOptions(chart.id, { tickFormatX: val as TickFormat })}
              options={[
                { value: 'auto', label: 'Auto' },
                { value: 'plain', label: 'Plain' },
                { value: 'scientific', label: 'Scientific (1.0e3)' },
                { value: 'percent', label: 'Percent (%)' },
                { value: 'currency', label: 'Currency ($)' },
                { value: 'compact', label: 'Compact (1.2K)' },
              ]}
            />
          </div>
          <div>
            <label className="text-xxs text-[var(--color-text-muted)] block mb-0.5">Y tick format</label>
            <GlassSelect
              value={chart.options.tickFormatY}
              onChange={val => updateChartOptions(chart.id, { tickFormatY: val as TickFormat })}
              options={[
                { value: 'auto', label: 'Auto' },
                { value: 'plain', label: 'Plain' },
                { value: 'scientific', label: 'Scientific (1.0e3)' },
                { value: 'percent', label: 'Percent (%)' },
                { value: 'currency', label: 'Currency ($)' },
                { value: 'compact', label: 'Compact (1.2K)' },
              ]}
            />
          </div>
          <div>
            <label className="text-xxs text-[var(--color-text-muted)] block mb-0.5">Decimal places</label>
            <input type="number" min={0} max={6} className="input text-xs w-full"
              value={chart.options.decimalPlaces}
              onChange={e => updateChartOptions(chart.id, { decimalPlaces: Math.max(0, Math.min(6, parseInt(e.target.value) || 0)) })} />
          </div>
          <div>
            <label className="text-xxs text-[var(--color-text-muted)] block mb-0.5">Watermark</label>
            <input className="input text-xs w-full" value={chart.options.watermark} placeholder="(empty)"
              onChange={e => updateChartOptions(chart.id, { watermark: e.target.value })} />
          </div>
        </div>
        <div className="flex gap-3 mt-2 flex-wrap text-xxs">
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="checkbox" checked={chart.options.showTitle} onChange={e => updateChartOptions(chart.id, { showTitle: e.target.checked })} />
            <span>Render title</span>
          </label>
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="checkbox" checked={chart.options.showCaption} onChange={e => updateChartOptions(chart.id, { showCaption: e.target.checked })} />
            <span>Render caption + source</span>
          </label>
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="checkbox" checked={chart.options.showCI} onChange={e => updateChartOptions(chart.id, { showCI: e.target.checked })} />
            <span>Show CI band ({Math.round(chart.options.ciLevel * 100)}%)</span>
          </label>
          {chart.options.showCI && (
            <select className="input text-xxs"
              value={String(chart.options.ciLevel)}
              onChange={e => updateChartOptions(chart.id, { ciLevel: parseFloat(e.target.value) })}>
              <option value="0.90">90%</option>
              <option value="0.95">95%</option>
              <option value="0.99">99%</option>
            </select>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xxs text-[var(--color-text-muted)] block mb-0.5">X-Axis Label</label>
          <input className="input text-xs w-full" value={chart.options.xLabel} onChange={e => updateChartOptions(chart.id, { xLabel: e.target.value })} placeholder="X axis" />
        </div>
        <div>
          <label className="text-xxs text-[var(--color-text-muted)] block mb-0.5">Y-Axis Label</label>
          <input className="input text-xs w-full" value={chart.options.yLabel} onChange={e => updateChartOptions(chart.id, { yLabel: e.target.value })} placeholder="Y axis" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-xxs text-[var(--color-text-muted)] block mb-0.5">
            Color Palette
            {CB_SAFE_PALETTES.has(chart.options.colorPalette) && (
              <span className="ml-1.5 text-xxs px-1 py-0.5 rounded bg-[var(--glass-bg)] border border-[var(--glass-border)]">CB-safe</span>
            )}
          </label>
          <GlassSelect
            value={chart.options.colorPalette}
            onChange={val => updateChartOptions(chart.id, { colorPalette: val })}
            options={Object.keys(PALETTES).map(p => ({
              value: p,
              label: (p.charAt(0).toUpperCase() + p.slice(1).replace('_', ' ')) + (CB_SAFE_PALETTES.has(p) ? ' (CB-safe)' : ''),
              preview: (
                <span className="flex gap-0.5 shrink-0">
                  {PALETTES[p].slice(0, 5).map((c: string, i: number) => (
                    <span key={i} className="w-3 h-3 rounded-sm" style={{ background: c }} />
                  ))}
                </span>
              ),
            }))}
          />
        </div>
        <div>
          <label className="text-xxs text-[var(--color-text-muted)] block mb-0.5">Legend Position</label>
          <GlassSelect
            value={chart.options.legendPosition}
            onChange={val => updateChartOptions(chart.id, { legendPosition: val as 'top' | 'bottom' | 'left' | 'right' })}
            options={[
              { value: 'top', label: 'Top' },
              { value: 'bottom', label: 'Bottom' },
              { value: 'left', label: 'Left' },
              { value: 'right', label: 'Right' },
            ]}
          />
        </div>
        <div>
          <label className="text-xxs text-[var(--color-text-muted)] block mb-0.5">Line Width</label>
          <input type="range" min={1} max={5} step={0.5} value={chart.options.lineWidth} onChange={e => updateChartOptions(chart.id, { lineWidth: parseFloat(e.target.value) })} className="w-full" />
        </div>
      </div>
      <div className="grid grid-cols-4 gap-3">
        <div>
          <label className="text-xxs text-[var(--color-text-muted)] block mb-0.5">Marker Size</label>
          <input type="range" min={0} max={10} step={1} value={chart.options.markerSize} onChange={e => updateChartOptions(chart.id, { markerSize: parseInt(e.target.value) })} className="w-full" />
        </div>
        <div>
          <label className="text-xxs text-[var(--color-text-muted)] block mb-0.5">Fill Opacity</label>
          <input type="range" min={0} max={1} step={0.05} value={chart.options.fillOpacity} onChange={e => updateChartOptions(chart.id, { fillOpacity: parseFloat(e.target.value) })} className="w-full" />
        </div>
        <div>
          <label className="text-xxs text-[var(--color-text-muted)] block mb-0.5">Donut Inner R</label>
          <input type="range" min={20} max={100} step={5} value={chart.options.innerRadius} onChange={e => updateChartOptions(chart.id, { innerRadius: parseInt(e.target.value) })} className="w-full" />
        </div>
        <div>
          <label className="text-xxs text-[var(--color-text-muted)] block mb-0.5">Bar Gap</label>
          <input type="range" min={0} max={20} step={1} value={chart.options.barGap} onChange={e => updateChartOptions(chart.id, { barGap: parseInt(e.target.value) })} className="w-full" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-xs">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={chart.options.showGrid} onChange={e => updateChartOptions(chart.id, { showGrid: e.target.checked })} />
          Grid
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={chart.options.showLegend} onChange={e => updateChartOptions(chart.id, { showLegend: e.target.checked })} />
          Legend
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={chart.options.showValues} onChange={e => updateChartOptions(chart.id, { showValues: e.target.checked })} />
          Show Values
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={chart.options.logScaleX} onChange={e => updateChartOptions(chart.id, { logScaleX: e.target.checked })} />
          Log X
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={chart.options.logScaleY} onChange={e => updateChartOptions(chart.id, { logScaleY: e.target.checked })} />
          Log Y
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={chart.options.animate} onChange={e => updateChartOptions(chart.id, { animate: e.target.checked })} />
          Animate
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={chart.options.smooth} onChange={e => updateChartOptions(chart.id, { smooth: e.target.checked })} />
          Smooth
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer" title="Show range brush below chart for zooming">
          <input type="checkbox" checked={chart.options.showBrush} onChange={e => updateChartOptions(chart.id, { showBrush: e.target.checked })} />
          Brush
        </label>
        <span className="flex items-center gap-1.5 text-xs" title="Trend line overlay">
          Trend:
          <select
            value={chart.options.trendLine}
            onChange={e => updateChartOptions(chart.id, { trendLine: e.target.value as 'none' | 'linear' | 'movingAvg' })}
            className="text-xs rounded px-1 py-0.5"
            style={{ background: 'var(--color-bg)', border: '1px solid var(--glass-border)', color: 'var(--color-text)' }}
          >
            <option value="none">None</option>
            <option value="linear">Linear</option>
            <option value="movingAvg">Moving Avg</option>
          </select>
        </span>
        <label className="flex items-center gap-1.5 cursor-pointer" title="Show crosshair cursor on hover">
          <input type="checkbox" checked={chart.options.showCrosshair} onChange={e => updateChartOptions(chart.id, { showCrosshair: e.target.checked })} />
          Crosshair
        </label>
      </div>
      {/* Stats toggle */}
      <label className="flex items-center gap-1.5 cursor-pointer text-xs">
        <input type="checkbox" checked={chart.options.showStats} onChange={e => updateChartOptions(chart.id, { showStats: e.target.checked })} />
        Show Statistics
      </label>
      {/* Annotations */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xxs text-[var(--color-text-muted)] font-medium">Annotations & Reference Bands</span>
          <div className="flex gap-1">
            <button onClick={() => addStatsAnnotations(chart.id)} className="text-xxs px-1.5 py-0.5 rounded hover:bg-white/10" style={{ color: 'var(--color-text)' }}>+ Mean/Median</button>
            <button onClick={() => addAnnotation(chart.id)} className="text-xxs px-1.5 py-0.5 rounded hover:bg-white/10" style={{ color: 'var(--color-text)' }}>+ Line</button>
            <button
              onClick={() => {
                const vals = chart.data.map(d => d.value).filter(v => Number.isFinite(v))
                if (vals.length === 0) return
                const sorted = [...vals].sort((a, b) => a - b)
                const q1 = sorted[Math.floor(sorted.length * 0.25)]
                const q3 = sorted[Math.floor(sorted.length * 0.75)]
                const band: ReferenceBand = {
                  id: `band-${Date.now()}`, axis: 'y',
                  from: q1, to: q3,
                  label: 'IQR', color: 'var(--color-text)', opacity: 0.06,
                }
                saveCharts(charts.map(c => c.id === chart.id ? { ...c, referenceBands: [...(c.referenceBands || []), band] } : c))
              }}
              className="text-xxs px-1.5 py-0.5 rounded hover:bg-white/10"
              style={{ color: 'var(--color-text)' }}
              title="Shade the inter-quartile range as a reference band"
            >
              + Band (IQR)
            </button>
          </div>
        </div>
        {(chart.referenceBands || []).length > 0 && (
          <div className="mb-2 space-y-1">
            {(chart.referenceBands || []).map(band => (
              <div key={band.id} className="flex items-center gap-2">
                <input className="input text-xxs w-16" value={band.label}
                  onChange={e => saveCharts(charts.map(c => c.id === chart.id ? { ...c, referenceBands: (c.referenceBands || []).map(b => b.id === band.id ? { ...b, label: e.target.value } : b) } : c))} />
                <select value={band.axis}
                  onChange={e => saveCharts(charts.map(c => c.id === chart.id ? { ...c, referenceBands: (c.referenceBands || []).map(b => b.id === band.id ? { ...b, axis: e.target.value as 'x' | 'y' } : b) } : c))}
                  className="text-xxs rounded px-1 py-0.5" style={{ background: 'var(--color-bg)', border: '1px solid var(--glass-border)', color: 'var(--color-text)' }}>
                  <option value="y">Y</option><option value="x">X</option>
                </select>
                <input type="number" step="any" className="input text-xxs w-16" value={band.from}
                  onChange={e => saveCharts(charts.map(c => c.id === chart.id ? { ...c, referenceBands: (c.referenceBands || []).map(b => b.id === band.id ? { ...b, from: parseFloat(e.target.value) || 0 } : b) } : c))} />
                <input type="number" step="any" className="input text-xxs w-16" value={band.to}
                  onChange={e => saveCharts(charts.map(c => c.id === chart.id ? { ...c, referenceBands: (c.referenceBands || []).map(b => b.id === band.id ? { ...b, to: parseFloat(e.target.value) || 0 } : b) } : c))} />
                <input type="number" min={0} max={1} step={0.05} className="input text-xxs w-12" value={band.opacity}
                  onChange={e => saveCharts(charts.map(c => c.id === chart.id ? { ...c, referenceBands: (c.referenceBands || []).map(b => b.id === band.id ? { ...b, opacity: parseFloat(e.target.value) || 0 } : b) } : c))} />
                <button onClick={() => saveCharts(charts.map(c => c.id === chart.id ? { ...c, referenceBands: (c.referenceBands || []).filter(b => b.id !== band.id) } : c))}
                  className="text-xxs p-0.5 rounded hover:bg-white/10" style={{ color: '#B07E8B' }}><FiX className="w-3 h-3" /></button>
              </div>
            ))}
          </div>
        )}
        {(chart.annotations || []).map(ann => (
          <div key={ann.id} className="flex items-center gap-2 mb-1">
            <input className="input text-xxs w-16" value={ann.label} onChange={e => updateAnnotation(chart.id, ann.id, { label: e.target.value })} />
            <input type="number" className="input text-xxs w-16" value={ann.value} onChange={e => updateAnnotation(chart.id, ann.id, { value: parseFloat(e.target.value) || 0 })} step="any" />
            <select value={ann.axis} onChange={e => updateAnnotation(chart.id, ann.id, { axis: e.target.value as 'x' | 'y' })}
              className="text-xxs rounded px-1 py-0.5" style={{ background: 'var(--color-bg)', border: '1px solid var(--glass-border)', color: 'var(--color-text)' }}>
              <option value="y">Y</option><option value="x">X</option>
            </select>
            <input type="color" value={ann.color} onChange={e => updateAnnotation(chart.id, ann.id, { color: e.target.value })} className="w-5 h-5 rounded cursor-pointer" style={{ padding: 0, border: 'none' }} />
            <select value={ann.style} onChange={e => updateAnnotation(chart.id, ann.id, { style: e.target.value as 'solid' | 'dashed' | 'dotted' })}
              className="text-xxs rounded px-1 py-0.5" style={{ background: 'var(--color-bg)', border: '1px solid var(--glass-border)', color: 'var(--color-text)' }}>
              <option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option>
            </select>
            <button onClick={() => removeAnnotation(chart.id, ann.id)} className="text-xxs p-0.5 rounded hover:bg-white/10" style={{ color: '#B07E8B' }}><FiX className="w-3 h-3" /></button>
          </div>
        ))}
      </div>
      {/* Palette preview + per-color editor (RGB) */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xxs text-[var(--color-text-muted)] font-medium">
            Palette colors
            {chart.customPalette && chart.customPalette.length > 0 && (
              <span className="ml-1.5 text-xxs px-1 py-0.5 rounded bg-[var(--glass-bg)] border border-[var(--glass-border)]">customized</span>
            )}
          </span>
          {chart.customPalette && chart.customPalette.length > 0 && (
            <button
              onClick={() => saveCharts(charts.map(c => c.id === chart.id ? { ...c, customPalette: undefined } : c))}
              className="text-xxs px-1.5 py-0.5 rounded hover:bg-white/10"
              style={{ color: 'var(--color-text-muted)' }}
              title="Discard custom colors and revert to the named palette"
            >Reset to palette</button>
          )}
        </div>
        <div className="grid grid-cols-10 gap-1">
          {getPalette(chart.options.colorPalette).slice(0, 10).map((paletteColor, i) => {
            const current = chart.customPalette?.[i] || paletteColor
            return (
              <div key={i} className="flex flex-col items-center gap-0.5">
                <input
                  type="color"
                  value={normalizeHex(current)}
                  onChange={e => {
                    const next = [...(chart.customPalette || getPalette(chart.options.colorPalette).slice(0, 10))]
                    while (next.length < 10) next.push(getPalette(chart.options.colorPalette)[next.length] || '#888888')
                    next[i] = e.target.value
                    saveCharts(charts.map(c => c.id === chart.id ? { ...c, customPalette: next } : c))
                  }}
                  className="w-6 h-6 rounded cursor-pointer p-0 border-0 bg-transparent"
                  title={`Series ${i + 1}: ${current}`}
                />
                <span className="text-[9px] font-mono text-[var(--color-text-muted)]">{i + 1}</span>
              </div>
            )
          })}
        </div>
        <p className="text-xxs text-[var(--color-text-muted)] mt-1">
          Pick any color per series to override the palette. Stay in the muted/desaturated range to match the platform aesthetic.
        </p>
      </div>
    </div>
  )

  // ─── Layout ─────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-6 border-b border-[var(--color-border)]">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Data Visualization</h1>
            <p className="text-sm text-[var(--color-text-muted)] mt-1">
              {charts.length} chart{charts.length !== 1 ? 's' : ''} — {CHART_TYPES.length} types (2D + 3D + Sankey), publication-ready exports (PDF · 4× PNG · SVG), 5 themes (Screen / Paper / Nature / Science / IEEE), CB-safe palettes
            </p>
            <p className="text-xxs text-[var(--color-text-muted)] mt-1 opacity-80">
              Per-chart settings: gear icon → Publication panel for theme · subtitle · caption · source · CI bands · reference bands · custom colors · color-blind preview · watermark.
            </p>
          </div>
          <input ref={fileInputRef} type="file" accept=".csv,.tsv,.txt,.xlsx,.xls" onChange={handleFileUpload} className="hidden" />
          <button onClick={() => { setForm({ title: '', type: 'bar', dataText: '', options: { ...defaultOptions } }); setShowAdd(true) }} className="btn text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            <FiPlus className="w-4 h-4" /> Create Visualization
          </button>
        </div>
      </div>

      {/* ── Create Visualization Overlay ── */}
      {showAdd && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          aria-modal="true"
          aria-label="Create visualization"
          {...modalBackdropProps(() => setShowAdd(false))}
        >
          <div
            className="glass-card-static max-w-2xl w-full mx-4 max-h-[85vh] flex flex-col"
            style={{ backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', boxShadow: 'var(--glass-shadow)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-[var(--glass-border)] shrink-0">
              <div>
                <h2 className="text-sm font-semibold">Create Visualization</h2>
                <p className="text-xxs text-[var(--color-text-muted)] mt-0.5">Configure your chart and import data</p>
              </div>
              <button onClick={() => setShowAdd(false)} className="p-1 rounded hover:bg-[var(--glass-bg-hover)] text-[var(--color-text-muted)]">
                <FiX className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Title */}
              <div>
                <label className="block text-xs font-medium mb-1.5 text-[var(--color-text-secondary)]">Chart Title</label>
                <input type="text" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="e.g. Tumor Growth Curve, Patient Demographics..." className="input w-full text-sm" autoFocus />
              </div>

              {/* Chart type + palette */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1.5 text-[var(--color-text-secondary)]">Chart Type</label>
                  <GlassSelect
                    value={form.type}
                    onChange={val => setForm(f => {
                      const newType = val as ChartType
                      // Auto-swap sample data when the user changes chart
                      // type IF the dataText is empty or still matches the
                      // previous type's sample (i.e. they haven't edited it).
                      // This gives an immediate preview without asking them
                      // to click Load Sample again for every type.
                      const prevSample = SAMPLE_DATA[f.type]?.data
                      const nextSample = SAMPLE_DATA[newType]
                      const untouched = !f.dataText.trim() || (prevSample && f.dataText.trim() === prevSample.trim())
                      if (untouched && nextSample) {
                        return {
                          ...f,
                          type: newType,
                          title: f.title || nextSample.title,
                          dataText: nextSample.data,
                        }
                      }
                      return { ...f, type: newType }
                    })}
                    options={CHART_TYPES.map(ct => ({ value: ct.value, label: ct.label, group: ct.group }))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1.5 text-[var(--color-text-secondary)]">Color Palette</label>
                  <GlassSelect
                    value={form.options.colorPalette}
                    onChange={val => setForm(f => ({ ...f, options: { ...f.options, colorPalette: val } }))}
                    options={Object.keys(PALETTES).map(p => ({
                      value: p,
                      label: p.charAt(0).toUpperCase() + p.slice(1),
                      preview: (
                        <span className="flex gap-0.5 shrink-0">
                          {PALETTES[p].slice(0, 5).map((c, i) => (
                            <span key={i} className="w-3 h-3 rounded-sm" style={{ background: c }} />
                          ))}
                        </span>
                      ),
                    }))}
                  />
                </div>
              </div>

              {/* Column mapping info for selected chart type */}
              {COLUMN_MAPS[form.type] && (
                <div className="rounded-lg border border-[var(--glass-border)] p-3 bg-[var(--glass-bg)]">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xxs font-medium text-[var(--color-text-secondary)]">
                        Expected columns for {CHART_TYPES.find(c => c.value === form.type)?.label || form.type}
                      </p>
                      <p className="text-xxs text-[var(--color-text-muted)] mt-0.5">{COLUMN_MAPS[form.type].description}</p>
                    </div>
                    {SAMPLE_DATA[form.type] && (
                      <button
                        type="button"
                        onClick={() => {
                          const sample = SAMPLE_DATA[form.type]
                          setForm(f => ({ ...f, title: f.title || sample.title, dataText: sample.data }))
                        }}
                        className="text-xxs px-2.5 py-1 rounded border border-[var(--glass-border)] hover:border-[var(--color-border-strong)] transition-colors flex items-center gap-1 shrink-0"
                        style={{ color: 'var(--color-text-secondary)' }}
                      >
                        <FiClipboard className="w-3 h-3" /> Load Sample
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {COLUMN_MAPS[form.type].required.map(col => (
                      <span key={col} className="text-xxs px-1.5 py-0.5 rounded bg-[var(--glass-bg-hover)] text-[var(--color-text)]">{col}</span>
                    ))}
                    {COLUMN_MAPS[form.type].optional.map(col => (
                      <span key={col} className="text-xxs px-1.5 py-0.5 rounded bg-[var(--glass-bg-hover)] text-[var(--color-text-muted)] italic">{col} (opt)</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Data input */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-[var(--color-text-secondary)]">Data Input</label>
                  <div className="flex items-center gap-2">
                    {form.dataText.trim() && (
                      <button
                        type="button"
                        onClick={() => {
                          const data = parseCSV(form.dataText)
                          if (data.length > 0) setForm(f => ({ ...f, type: suggestChartType(data) }))
                        }}
                        className="text-xxs px-2 py-0.5 rounded border border-[var(--glass-border)] hover:border-[var(--color-border-strong)] transition-colors"
                        style={{ color: 'var(--color-text-secondary)' }}
                        title="Analyze your data and auto-select the best chart type"
                      >
                        Auto-suggest type
                      </button>
                    )}
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="text-xxs px-2 py-0.5 rounded border border-[var(--glass-border)] hover:border-[var(--color-border-strong)] transition-colors flex items-center gap-1"
                      style={{ color: 'var(--color-text-secondary)' }}
                    >
                      <FiUpload className="w-3 h-3" /> Import CSV/XLSX
                    </button>
                  </div>
                </div>
                <textarea value={form.dataText} onChange={e => setForm(f => ({ ...f, dataText: e.target.value }))}
                  placeholder={SAMPLE_DATA[form.type]
                    ? `Paste data or import a file. Columns: ${COLUMN_MAPS[form.type]?.required.join(', ') || 'label, value'}\n\nExample:\n${SAMPLE_DATA[form.type].data.split('\n').slice(0, 3).join('\n')}`
                    : "Paste data or import a file. One entry per line:\n\nSample A, 45\nSample B, 72"}
                  rows={8} className="input w-full text-xs font-mono resize-none" />
                <p className="text-xxs text-[var(--color-text-muted)] mt-1">
                  Format: <span className="font-mono">{COLUMN_MAPS[form.type]?.required.join(', ').toLowerCase() || 'label, value[, value2, value3, errorPlus, errorMinus, size]'}</span>
                </p>
              </div>

              {/* Advanced options */}
              <details className="group">
                <summary className="text-xs font-medium text-[var(--color-text-secondary)] cursor-pointer select-none flex items-center gap-1">
                  <FiSettings className="w-3 h-3" /> Advanced Options
                </summary>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xxs text-[var(--color-text-muted)] mb-1 block">X Axis Label</label>
                    <input type="text" value={form.options.xLabel} onChange={e => setForm(f => ({ ...f, options: { ...f.options, xLabel: e.target.value } }))} className="input w-full text-xs" placeholder="X axis" />
                  </div>
                  <div>
                    <label className="text-xxs text-[var(--color-text-muted)] mb-1 block">Y Axis Label</label>
                    <input type="text" value={form.options.yLabel} onChange={e => setForm(f => ({ ...f, options: { ...f.options, yLabel: e.target.value } }))} className="input w-full text-xs" placeholder="Y axis" />
                  </div>
                  <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)] cursor-pointer">
                    <input type="checkbox" checked={form.options.showGrid} onChange={e => setForm(f => ({ ...f, options: { ...f.options, showGrid: e.target.checked } }))} className="rounded" /> Show Grid
                  </label>
                  <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)] cursor-pointer">
                    <input type="checkbox" checked={form.options.showLegend} onChange={e => setForm(f => ({ ...f, options: { ...f.options, showLegend: e.target.checked } }))} className="rounded" /> Show Legend
                  </label>
                  <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)] cursor-pointer">
                    <input type="checkbox" checked={form.options.showValues} onChange={e => setForm(f => ({ ...f, options: { ...f.options, showValues: e.target.checked } }))} className="rounded" /> Show Values
                  </label>
                  <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)] cursor-pointer">
                    <input type="checkbox" checked={form.options.animate} onChange={e => setForm(f => ({ ...f, options: { ...f.options, animate: e.target.checked } }))} className="rounded" /> Animate
                  </label>
                  <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)] cursor-pointer">
                    <input type="checkbox" checked={form.options.showBrush} onChange={e => setForm(f => ({ ...f, options: { ...f.options, showBrush: e.target.checked } }))} className="rounded" /> Brush Zoom
                  </label>
                  <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)] cursor-pointer">
                    <input type="checkbox" checked={form.options.showCrosshair} onChange={e => setForm(f => ({ ...f, options: { ...f.options, showCrosshair: e.target.checked } }))} className="rounded" /> Crosshair
                  </label>
                </div>
              </details>
            </div>
            <div className="flex justify-end gap-2 p-4 border-t border-[var(--glass-border)] shrink-0">
              <button onClick={() => setShowAdd(false)} className="btn px-4 py-2 text-sm text-[var(--color-text-muted)]">
                Cancel
              </button>
              <button onClick={addChart} disabled={!form.title.trim() || !form.dataText.trim()}
                className="btn-primary px-4 py-2 text-sm disabled:opacity-30 flex items-center gap-1.5" style={{ color: !form.title.trim() || !form.dataText.trim() ? undefined : 'var(--color-text)' }}>
                <FiBarChart2 className="w-3.5 h-3.5" /> Create Visualization
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Charts Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        {charts.length === 0 ? (
          <div className="text-center py-16 text-[var(--color-text-muted)]">
            <FiBarChart2 className="w-12 h-12 mx-auto mb-4 opacity-20" />
            <p className="text-sm">No charts yet</p>
            <p className="text-xs mt-1">Create a visualization or upload a CSV file to get started</p>
            <div className="mt-6 max-w-md mx-auto text-left">
              <p className="text-xs font-medium mb-2">Supported chart types:</p>
              <div className="grid grid-cols-3 gap-1 text-xxs text-[var(--color-text-muted)]">
                {CHART_TYPES.map(ct => <span key={ct.value}>{ct.label}</span>)}
              </div>
            </div>
          </div>
        ) : (
          <div className={`max-w-7xl mx-auto ${expandedChart ? '' : 'grid grid-cols-1 lg:grid-cols-2 gap-6'}`}>
            {charts.filter(c => !expandedChart || c.id === expandedChart).map(chart => (
              <div key={chart.id} className="glass-card group">
                {/* Chart header */}
                <div className="flex items-center justify-between p-4 pb-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <FiBarChart2 className="w-4 h-4 flex-shrink-0 text-[var(--color-text-muted)]" />
                    <h3 className="text-sm font-medium truncate">{chart.title}</h3>
                    <span className="text-xxs px-1.5 py-0.5 rounded bg-[var(--glass-bg)] text-[var(--color-text-muted)]">
                      {CHART_TYPES.find(t => t.value === chart.type)?.label || chart.type}
                    </span>
                  </div>
                  {/* Card chrome — declutter pass:
                      Brush, Crosshair, Background-flip, and the
                      separate export buttons (PNG-1×, PNG-4×, SVG,
                      PDF, CSV, XLSX, Copy, Copy-inverted) used to
                      sit here as 13 individual icons, which the user
                      called out as visually overwhelming. They're
                      now collapsed into one Export <details>
                      dropdown; brush / crosshair / bg-flip moved
                      into the per-chart Settings panel which already
                      hosts the rest of the toggles. Top-level
                      buttons left visible: Settings, Expand, Export,
                      Duplicate, Delete (5 vs 13). */}
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => setShowSettings(showSettings === chart.id ? null : chart.id)}
                      className="p-1.5 rounded hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]" title="Settings">
                      <FiSettings className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => setExpandedChart(expandedChart === chart.id ? null : chart.id)}
                      className="p-1.5 rounded hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                      title={expandedChart ? 'Collapse' : 'Expand'}>
                      {expandedChart === chart.id ? <FiMinimize2 className="w-3.5 h-3.5" /> : <FiMaximize2 className="w-3.5 h-3.5" />}
                    </button>
                    <details className="relative">
                      <summary className="list-none p-1.5 rounded hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer" title="Export">
                        <FiDownload className="w-3.5 h-3.5" />
                      </summary>
                      <div className="absolute right-0 top-full mt-1 z-10 min-w-[180px] rounded-md shadow-lg border" style={{ background: 'var(--color-surface-solid)', borderColor: 'var(--color-border)' }}>
                        <button onClick={() => exportPng(chart.id, chart.title)} className="w-full text-left text-xs px-3 py-1.5 hover:bg-[var(--glass-bg)] flex items-center justify-between gap-3">
                          <span>PNG</span><span className="text-xxs text-[var(--color-text-muted)] font-mono">1×</span>
                        </button>
                        <button onClick={() => exportHighDpiPng(chart.id, chart.title)} className="w-full text-left text-xs px-3 py-1.5 hover:bg-[var(--glass-bg)] flex items-center justify-between gap-3">
                          <span>PNG (publication)</span><span className="text-xxs text-[var(--color-text-muted)] font-mono">4×</span>
                        </button>
                        <button onClick={() => exportSvg(chart.id, chart.title)} className="w-full text-left text-xs px-3 py-1.5 hover:bg-[var(--glass-bg)] flex items-center justify-between gap-3">
                          <span>SVG</span><span className="text-xxs text-[var(--color-text-muted)] font-mono">vector</span>
                        </button>
                        <button onClick={() => exportPdf(chart)} className="w-full text-left text-xs px-3 py-1.5 hover:bg-[var(--glass-bg)] flex items-center justify-between gap-3">
                          <span>PDF</span><span className="text-xxs text-[var(--color-text-muted)] font-mono">w/ caption</span>
                        </button>
                        <button onClick={() => exportLatex(chart)} className="w-full text-left text-xs px-3 py-1.5 hover:bg-[var(--glass-bg)] flex items-center justify-between gap-3">
                          <span>LaTeX figure</span><span className="text-xxs text-[var(--color-text-muted)] font-mono">snippet</span>
                        </button>
                        <div className="border-t" style={{ borderColor: 'var(--color-border)' }} />
                        <button onClick={() => exportCsv(chart)} className="w-full text-left text-xs px-3 py-1.5 hover:bg-[var(--glass-bg)] flex items-center justify-between gap-3">
                          <span>Data</span><span className="text-xxs text-[var(--color-text-muted)] font-mono">CSV</span>
                        </button>
                        <button onClick={() => exportXlsx(chart)} className="w-full text-left text-xs px-3 py-1.5 hover:bg-[var(--glass-bg)] flex items-center justify-between gap-3">
                          <span>Data</span><span className="text-xxs text-[var(--color-text-muted)] font-mono">XLSX</span>
                        </button>
                        <div className="border-t" style={{ borderColor: 'var(--color-border)' }} />
                        <button onClick={() => copyChartToClipboard(chart.id)} className="w-full text-left text-xs px-3 py-1.5 hover:bg-[var(--glass-bg)] flex items-center gap-2">
                          {copiedChart === chart.id ? <FiCheck className="w-3 h-3 text-[var(--color-success)]" /> : <FiClipboard className="w-3 h-3" />}
                          <span>Copy to clipboard</span>
                        </button>
                      </div>
                    </details>
                    <button onClick={() => duplicateChart(chart)}
                      className="p-1.5 rounded hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]" title="Duplicate">
                      <FiCopy className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => deleteChart(chart.id)}
                      className="p-1.5 rounded hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)] hover:text-[var(--color-error)]" title="Delete">
                      <FiTrash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Chart body — bg is controlled by the chart's own
                    pubTheme.bg now. The earlier chartBgTheme override
                    flipped only the wrapper background to white but
                    left the SVG text fills resolving to
                    var(--color-text) (white in dark mode), which
                    rendered the chart's text invisible on the white
                    background. Removed the override; users pick a
                    journal theme via Settings → Pub Theme to get a
                    paper background with matching dark text. */}
                <div
                  className="p-4 transition-colors"
                  ref={el => { chartRefs.current[chart.id] = el }}
                  style={{ borderRadius: 10 }}
                >
                  {renderChart(chart, expandedChart === chart.id ? 500 : 280)}
                </div>

                {/* Footer */}
                <div className="px-4 pb-3 flex flex-wrap items-center gap-3 text-xxs text-[var(--color-text-muted)]">
                  <span>{chart.data.length} pts</span>
                  <span>{chart.options.colorPalette}</span>
                  <span>{formatDate(chart.createdAt)}</span>
                  {chart.options.trendLine === 'linear' && chart.data.length >= 2 && (() => {
                    const { r2 } = computeLinearRegression(chart.data)
                    return <span style={{ color: '#C4956A' }}>R²={r2.toFixed(3)}</span>
                  })()}
                  {(chart.annotations || []).length > 0 && <span>{chart.annotations.length} annotation{chart.annotations.length !== 1 ? 's' : ''}</span>}
                  {chart.options.showStats && chart.data.length >= 2 && (() => {
                    const s = computeStats(chart.data)
                    if (!s) return null
                    return (
                      <span className="flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
                        μ={s.mean.toFixed(2)} · σ={s.std.toFixed(2)} · med={s.median.toFixed(2)} · [{s.min.toFixed(1)}, {s.max.toFixed(1)}]
                      </span>
                    )
                  })()}
                  {chart.options.showLegend && <span style={{ opacity: 0.5 }}>click legend to toggle series</span>}
                </div>

                {/* Settings panel */}
                {showSettings === chart.id && renderSettingsPanel(chart)}
              </div>
            ))}
          </div>
        )}
      </div>
      {deleteConfirmId && (
        <ConfirmDeleteDialog
          title="Delete Chart?"
          message="This will permanently delete this visualization. This action cannot be undone."
          onConfirm={confirmDeleteChart}
          onCancel={() => setDeleteConfirmId(null)}
        />
      )}
    </div>
  )
}
