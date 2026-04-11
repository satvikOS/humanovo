import { useState, useCallback, useRef, useEffect } from 'react'
import {
  FiBarChart2, FiPlus, FiTrash2,
  FiDownload, FiUpload, FiSettings, FiX,
  FiMaximize2, FiMinimize2, FiEdit3, FiCopy, FiDroplet,
  FiClipboard, FiCheck, FiChevronDown,
  FiZoomIn, FiCrosshair,
} from 'react-icons/fi'
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  ScatterChart, Scatter, AreaChart, Area,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  FunnelChart, Funnel, LabelList,
  Treemap, ComposedChart, ErrorBar, ReferenceLine, ZAxis,
  RadialBarChart, RadialBar,
  Brush,
} from 'recharts'
import html2canvas from 'html2canvas'
import * as XLSX from 'xlsx'
import { persistGet, persistSet, formatDate, logActivity } from '../utils/persistence'
import PlotlyPlot3D, { type Chart3DType } from '../components/PlotlyPlot3D'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'

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
}

type ChartType =
  | 'bar' | 'horizontal_bar' | 'grouped_bar' | 'stacked_bar' | 'stacked_bar_100'
  | 'line' | 'multi_line' | 'step' | 'spline'
  | 'area' | 'stacked_area' | 'stream'
  | 'pie' | 'donut' | 'radial_bar'
  | 'scatter' | 'bubble'
  | 'radar'
  | 'funnel' | 'treemap'
  | 'histogram' | 'box_plot' | 'violin' | 'density'
  | 'waterfall' | 'error_bar' | 'candlestick'
  | 'heatmap' | 'stem' | 'band'
  | 'polar_area'
  | 'scatter_3d' | 'bubble_3d' | 'line_3d' | 'bar_3d'
  | 'surface_3d' | 'wireframe_3d' | 'contour_3d' | 'trisurf_3d'
  | 'quiver_3d' | 'isosurface_3d' | 'voxel_3d' | 'streamline_3d'
  | 'slice_3d' | 'stem_3d' | 'waterfall_3d' | 'ribbon_3d' | 'pie_3d'

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
  type: ChartType
  data: DataPoint[]
  options: ChartOptions
  annotations: ChartAnnotation[]
  createdAt: string
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
  const isTimeSeries = data.every(d => !isNaN(Number(d.label))) || data.every(d => /^\d{4}[-\/]/.test(d.label))
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
}

// ─── Palettes ───────────────────────────────────────────────────
const PALETTES: Record<string, string[]> = {
  default: ['#3b82f6', '#8b5cf6', '#22c55e', '#f97316', '#06b6d4', '#ef4444', '#eab308', '#ec4899', '#14b8a6', '#a855f7'],
  nature: ['#2d6a4f', '#40916c', '#52b788', '#74c69d', '#95d5b2', '#b7e4c7', '#d8f3dc', '#1b4332', '#081c15', '#344e41'],
  ocean: ['#03045e', '#023e8a', '#0077b6', '#0096c7', '#00b4d8', '#48cae4', '#90e0ef', '#ade8f4', '#caf0f8', '#264653'],
  warm: ['#d00000', '#dc2f02', '#e85d04', '#f48c06', '#faa307', '#ffba08', '#ffd60a', '#9d0208', '#6a040f', '#370617'],
  pastel: ['#ffd6ff', '#e7c6ff', '#c8b6ff', '#b8c0ff', '#bbd0ff', '#caffbf', '#fdffb6', '#ffd6a5', '#ffadad', '#a0c4ff'],
  scientific: ['#264653', '#2a9d8f', '#e9c46a', '#f4a261', '#e76f51', '#606c38', '#283618', '#dda15e', '#bc6c25', '#001219'],
  diverging: ['#d73027', '#f46d43', '#fdae61', '#fee08b', '#ffffbf', '#d9ef8b', '#a6d96a', '#66bd63', '#1a9850', '#006837'],
  monochrome: ['#0d1b2a', '#1b2838', '#2b3a4a', '#3c4d5e', '#4d6072', '#5e7388', '#70869e', '#8299b4', '#94acca', '#a6bfe0'],
}

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
  pie_3d: { required: ['Label', 'X', 'Y', 'Z'], optional: [], description: '3D pie chart' },
}

const TOOLTIP_STYLE = {
  background: 'var(--color-surface-solid)',
  border: '1px solid var(--color-border)',
  borderRadius: '8px',
  fontSize: '12px',
  color: 'var(--color-text)',
}

const AXIS_TICK = { fontSize: 11, fill: 'var(--color-text-muted)' }

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
  const mn = Math.min(...values), mx = Math.max(...values)
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
  let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0
  data.forEach((d, i) => {
    const x = i; const y = d.value
    sx += x; sy += y; sxx += x * x; sxy += x * y; syy += y * y
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
                      ? 'bg-[var(--color-accent-blue)]/10 text-[var(--color-accent-blue)]'
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
    const raw = persistGet<any[]>('charts', [])
    // Migrate old charts that lack the `options` field
    return raw.map((c: any) => ({
      ...c,
      annotations: c.annotations || [],
      options: c.options ? { ...defaultOptions, ...c.options } : { ...defaultOptions, color: c.color || defaultOptions.color },
    }))
  })
  const [showAdd, setShowAdd] = useState(false)
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
    const chart: ChartConfig = {
      id: `chart-${Date.now()}`,
      title: form.title,
      type: form.type,
      data: parseCSV(form.dataText),
      options: { ...form.options },
      annotations: [],
      createdAt: new Date().toISOString(),
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
    const ann: ChartAnnotation = { id: `ann-${Date.now()}`, axis: 'y', value: Math.round(mean * 100) / 100, label: 'Reference', color: '#f59e0b', style: 'dashed' }
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
      { id: `ann-mean-${Date.now()}`, axis: 'y', value: Math.round(mean * 100) / 100, label: `Mean: ${mean.toFixed(2)}`, color: '#3b82f6', style: 'dashed' },
      { id: `ann-median-${Date.now()}`, axis: 'y', value: Math.round(median * 100) / 100, label: `Median: ${median.toFixed(2)}`, color: '#22c55e', style: 'dotted' },
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
    try {
      const canvas = await html2canvas(el, {
        backgroundColor: '#0f0f14',
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
    try {
      const canvas = await html2canvas(el, {
        backgroundColor: '#0f0f14',
        scale: 2,
        useCORS: true,
        logging: false,
      })
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
      if (blob) {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        setCopiedChart(id)
        setTimeout(() => setCopiedChart(null), 2000)
      }
    } catch {
      setCopiedChart(id)
      setTimeout(() => setCopiedChart(null), 2000)
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
    const colors = getPalette(o.colorPalette)
    const gridEl = o.showGrid ? <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" /> : null
    const cursorStyle = o.showCrosshair ? { stroke: 'var(--color-text-muted)', strokeWidth: 1, strokeDasharray: '4 4' } : undefined
    const tooltipEl = <Tooltip contentStyle={TOOLTIP_STYLE} cursor={cursorStyle} />
    const hidden = hiddenSeries[chart.id] || new Set<string>()
    const handleLegendClick = (e: any) => { if (e?.dataKey) toggleSeries(chart.id, e.dataKey) }
    const legendEl = o.showLegend ? <Legend wrapperStyle={{ fontSize: 11, cursor: 'pointer' }} onClick={handleLegendClick} formatter={(value: string) => <span style={{ opacity: hidden.has(value) ? 0.3 : 1, textDecoration: hidden.has(value) ? 'line-through' : 'none' }}>{value}</span>} /> : null
    const brushEl = o.showBrush && data.length > 5 ? <Brush dataKey="label" height={20} stroke="var(--color-accent-blue)" fill="var(--glass-bg)" travellerWidth={8} /> : null
    const xAxisEl = <XAxis dataKey="label" tick={AXIS_TICK} label={o.xLabel ? { value: o.xLabel, position: 'insideBottom', offset: -5, style: { fontSize: 11, fill: 'var(--color-text-muted)' } } : undefined} scale={o.logScaleX ? 'log' : 'auto'} />
    const yAxisEl = <YAxis tick={AXIS_TICK} label={o.yLabel ? { value: o.yLabel, angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: 'var(--color-text-muted)' } } : undefined} scale={o.logScaleY ? 'log' : 'auto'} domain={o.logScaleY ? ['auto', 'auto'] : undefined} />
    const annotationEls = (chart.annotations || []).map(ann => (
      <ReferenceLine key={ann.id} y={ann.axis === 'y' ? ann.value : undefined} x={ann.axis === 'x' ? ann.value : undefined}
        stroke={ann.color} strokeDasharray={ann.style === 'dashed' ? '8 4' : ann.style === 'dotted' ? '2 4' : undefined}
        strokeWidth={1.5} label={{ value: ann.label, position: 'insideTopRight', style: { fontSize: 10, fill: ann.color, fontWeight: 600 } }} />
    ))

    const renderChartSwitch = (): React.ReactNode => { switch (type) {
      // ── BAR CHARTS ──────────────────────────────────────────
      case 'bar':
        return (
          <ResponsiveContainer width="100%" height={height}>
            {hasTrend ? (
              <ComposedChart data={data} barGap={o.barGap}>
                {gridEl}{xAxisEl}{yAxisEl}{tooltipEl}{legendEl}{brushEl}{annotationEls}
                <Bar dataKey="value" fill={colors[0]} radius={[4, 4, 0, 0]} animationDuration={o.animate ? 400 : 0} hide={hidden.has('value')}>
                  {o.showValues && <LabelList dataKey="value" position="top" style={{ fontSize: 10, fill: 'var(--color-text-muted)' }} />}
                </Bar>
                <Line type="monotone" dataKey="trend" name={o.trendLine === 'linear' ? 'Linear Trend' : 'Moving Avg'} stroke="#f59e0b" strokeWidth={2} strokeDasharray="6 3" dot={false} />
              </ComposedChart>
            ) : (
              <BarChart data={data} barGap={o.barGap}>
                {gridEl}{xAxisEl}{yAxisEl}{tooltipEl}{legendEl}{brushEl}{annotationEls}
                <Bar dataKey="value" fill={colors[0]} radius={[4, 4, 0, 0]} animationDuration={o.animate ? 400 : 0} hide={hidden.has('value')}>
                  {o.showValues && <LabelList dataKey="value" position="top" style={{ fontSize: 10, fill: 'var(--color-text-muted)' }} />}
                </Bar>
              </BarChart>
            )}
          </ResponsiveContainer>
        )

      case 'horizontal_bar':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <BarChart data={data} layout="vertical" barGap={o.barGap}>
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
              <BarChart data={data} barGap={o.barGap}>
                {gridEl}{xAxisEl}{yAxisEl}{tooltipEl}{legendEl}{annotationEls}
                <Bar dataKey="value" name="Series 1" fill={colors[0]} radius={[4, 4, 0, 0]} />
                {data.some(d => d.value2 !== undefined) && <Bar dataKey="value2" name="Series 2" fill={colors[1]} radius={[4, 4, 0, 0]} />}
                {data.some(d => d.value3 !== undefined) && <Bar dataKey="value3" name="Series 3" fill={colors[2]} radius={[4, 4, 0, 0]} />}
              </BarChart>
            </ResponsiveContainer>
          )
        }
        const labels = [...new Set(data.map(d => d.label))]
        const pivoted = labels.map(label => {
          const row: Record<string, any> = { label }
          cats.forEach(cat => { row[cat!] = data.find(d => d.label === label && d.category === cat)?.value || 0 })
          return row
        })
        return (
          <ResponsiveContainer width="100%" height={height}>
            <BarChart data={pivoted} barGap={o.barGap}>
              {gridEl}{xAxisEl}{yAxisEl}{tooltipEl}{legendEl}{annotationEls}
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
              <BarChart data={data}>
                {gridEl}{xAxisEl}{yAxisEl}{tooltipEl}{legendEl}{annotationEls}
                <Bar dataKey="value" stackId="a" fill={colors[0]} />
                {data.some(d => d.value2 !== undefined) && <Bar dataKey="value2" stackId="a" fill={colors[1]} />}
              </BarChart>
            </ResponsiveContainer>
          )
        }
        const labels = [...new Set(data.map(d => d.label))]
        let pivoted = labels.map(label => {
          const row: Record<string, any> = { label }
          cats.forEach(cat => { row[cat!] = data.find(d => d.label === label && d.category === cat)?.value || 0 })
          return row
        })
        if (type === 'stacked_bar_100') {
          pivoted = pivoted.map(row => {
            const total = cats.reduce((s, cat) => s + (row[cat!] || 0), 0)
            const normalized: Record<string, any> = { label: row.label }
            cats.forEach(cat => { normalized[cat!] = total > 0 ? Math.round((row[cat!] / total) * 100 * 10) / 10 : 0 })
            return normalized
          })
        }
        return (
          <ResponsiveContainer width="100%" height={height}>
            <BarChart data={pivoted}>
              {gridEl}{xAxisEl}{yAxisEl}{tooltipEl}{legendEl}{annotationEls}
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
          return { ...d, start, end: cumulative, fill: i === data.length - 1 ? colors[2] : d.value >= 0 ? colors[0] : colors[3] || '#ef4444' }
        })
        return (
          <ResponsiveContainer width="100%" height={height}>
            <BarChart data={waterfallData}>
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
            <LineChart data={data}>
              {gridEl}{xAxisEl}{yAxisEl}{tooltipEl}{legendEl}{brushEl}{annotationEls}
              <Line type={o.smooth ? 'monotone' : 'linear'} dataKey="value" stroke={colors[0]} strokeWidth={o.lineWidth} dot={{ r: o.markerSize, fill: colors[0] }} animationDuration={o.animate ? 400 : 0} hide={hidden.has('value')} />
              {hasTrend && <Line type="monotone" dataKey="trend" name={o.trendLine === 'linear' ? 'Linear Trend' : 'Moving Avg'} stroke="#f59e0b" strokeWidth={2} strokeDasharray="6 3" dot={false} />}
            </LineChart>
          </ResponsiveContainer>
        )

      case 'multi_line':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <LineChart data={data}>
              {gridEl}{xAxisEl}{yAxisEl}{tooltipEl}{legendEl}{brushEl}{annotationEls}
              <Line type="monotone" dataKey="value" name="Series 1" stroke={colors[0]} strokeWidth={o.lineWidth} dot={{ r: o.markerSize }} hide={hidden.has('value')} />
              {data.some(d => d.value2 !== undefined) && <Line type="monotone" dataKey="value2" name="Series 2" stroke={colors[1]} strokeWidth={o.lineWidth} dot={{ r: o.markerSize }} hide={hidden.has('value2')} />}
              {data.some(d => d.value3 !== undefined) && <Line type="monotone" dataKey="value3" name="Series 3" stroke={colors[2]} strokeWidth={o.lineWidth} dot={{ r: o.markerSize }} hide={hidden.has('value3')} />}
            </LineChart>
          </ResponsiveContainer>
        )

      case 'step':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <LineChart data={data}>
              {gridEl}{xAxisEl}{yAxisEl}{tooltipEl}{legendEl}{brushEl}{annotationEls}
              <Line type="stepAfter" dataKey="value" stroke={colors[0]} strokeWidth={o.lineWidth} dot={{ r: o.markerSize, fill: colors[0] }} hide={hidden.has('value')} />
            </LineChart>
          </ResponsiveContainer>
        )

      case 'spline':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <LineChart data={data}>
              {gridEl}{xAxisEl}{yAxisEl}{tooltipEl}{legendEl}{brushEl}{annotationEls}
              <Line type="natural" dataKey="value" stroke={colors[0]} strokeWidth={o.lineWidth} dot={{ r: o.markerSize, fill: colors[0] }} hide={hidden.has('value')} />
            </LineChart>
          </ResponsiveContainer>
        )

      case 'stem':
        // Lollipop chart: bars + dots
        return (
          <ResponsiveContainer width="100%" height={height}>
            <ComposedChart data={data}>
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
              <ComposedChart data={data}>
                {gridEl}{xAxisEl}{yAxisEl}{tooltipEl}{legendEl}{brushEl}{annotationEls}
                <Area type="monotone" dataKey="value" stroke={colors[0]} fill={colors[0]} fillOpacity={o.fillOpacity} strokeWidth={o.lineWidth} hide={hidden.has('value')} />
                <Line type="monotone" dataKey="trend" name={o.trendLine === 'linear' ? 'Linear Trend' : 'Moving Avg'} stroke="#f59e0b" strokeWidth={2} strokeDasharray="6 3" dot={false} />
              </ComposedChart>
            ) : (
              <AreaChart data={data}>
                {gridEl}{xAxisEl}{yAxisEl}{tooltipEl}{legendEl}{brushEl}{annotationEls}
                <Area type="monotone" dataKey="value" stroke={colors[0]} fill={colors[0]} fillOpacity={o.fillOpacity} strokeWidth={o.lineWidth} hide={hidden.has('value')} />
              </AreaChart>
            )}
          </ResponsiveContainer>
        )

      case 'stacked_area':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <AreaChart data={data}>
              {gridEl}{xAxisEl}{yAxisEl}{tooltipEl}{legendEl}{brushEl}{annotationEls}
              <Area type="monotone" dataKey="value" stackId="1" name="Series 1" stroke={colors[0]} fill={colors[0]} fillOpacity={o.fillOpacity} hide={hidden.has('value')} />
              {data.some(d => d.value2 !== undefined) && <Area type="monotone" dataKey="value2" stackId="1" name="Series 2" stroke={colors[1]} fill={colors[1]} fillOpacity={o.fillOpacity} hide={hidden.has('value2')} />}
              {data.some(d => d.value3 !== undefined) && <Area type="monotone" dataKey="value3" stackId="1" name="Series 3" stroke={colors[2]} fill={colors[2]} fillOpacity={o.fillOpacity} hide={hidden.has('value3')} />}
            </AreaChart>
          </ResponsiveContainer>
        )

      case 'stream':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <AreaChart data={data} stackOffset="silhouette">
              {gridEl}{xAxisEl}{yAxisEl}{tooltipEl}{legendEl}{annotationEls}
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
            <AreaChart data={data}>
              {gridEl}{xAxisEl}{yAxisEl}{tooltipEl}{legendEl}{annotationEls}
              <Area type="monotone" dataKey="value2" stroke="none" fill={colors[0]} fillOpacity={o.fillOpacity} name="Upper" />
              <Area type="monotone" dataKey="value" stroke="none" fill="var(--color-bg)" fillOpacity={1} name="Lower" />
              <Line type="monotone" dataKey="value" stroke={colors[0]} strokeWidth={o.lineWidth} dot={false} />
              <Line type="monotone" dataKey="value2" stroke={colors[0]} strokeWidth={o.lineWidth} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        )

      // ── CIRCULAR CHARTS ─────────────────────────────────────
      case 'pie':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="label" cx="50%" cy="50%" outerRadius={height / 3}
                label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`} startAngle={o.startAngle} endAngle={o.startAngle + 360}>
                {data.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
              </Pie>
              {tooltipEl}{legendEl}
            </PieChart>
          </ResponsiveContainer>
        )

      case 'donut':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="label" cx="50%" cy="50%"
                innerRadius={o.innerRadius} outerRadius={height / 3}
                label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`}
                startAngle={o.startAngle} endAngle={o.startAngle + 360}>
                {data.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
              </Pie>
              {tooltipEl}{legendEl}
            </PieChart>
          </ResponsiveContainer>
        )

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
            <ScatterChart>
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
            <ScatterChart>
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
            <BarChart data={hist}>
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
        // Render as bar chart with custom rendering
        return (
          <ResponsiveContainer width="100%" height={height}>
            <ComposedChart data={boxData}>
              {gridEl}
              <XAxis dataKey="name" tick={AXIS_TICK} />
              <YAxis tick={AXIS_TICK} />
              {tooltipEl}
              {/* IQR box */}
              <Bar dataKey="q3" fill="transparent" stackId="box" />
              <Bar dataKey="median" fill={colors[0]} opacity={0.3} stackId="box2" barSize={40} radius={[4, 4, 4, 4]} />
              {/* Whiskers */}
              <Line type="linear" dataKey="max" stroke={colors[0]} dot={{ r: 3 }} />
              <Line type="linear" dataKey="min" stroke={colors[0]} dot={{ r: 3 }} />
              <Line type="linear" dataKey="q1" stroke={colors[0]} dot={{ r: 5, fill: colors[0] }} strokeWidth={0} />
              <Line type="linear" dataKey="q3" stroke={colors[0]} dot={{ r: 5, fill: colors[0] }} strokeWidth={0} />
              <ReferenceLine y={0} stroke="var(--color-border)" />
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
        const allVals = data.map(d => d.value)
        const vMin = Math.min(...allVals), vMax = Math.max(...allVals)
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
                return <g key={i}><line x1={55} x2={svgW} y1={y} y2={y} stroke="var(--color-border)" strokeDasharray="2,2" /><text x={50} y={y + 4} textAnchor="end" fill="var(--color-text-muted)" fontSize={10}>{val.toFixed(1)}</text></g>
              })}
              {vEntries.map(([name, vals], gi) => {
                const sorted = [...vals].sort((a, b) => a - b)
                const cx = 65 + gi * groupW + groupW / 2
                const bw = (vals.length > 1 ? Math.sqrt(vals.length) : 1) * 0.4
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
                return (
                  <g key={name}>
                    <polygon points={`${pathR} ${pathL}`} fill={colors[gi % colors.length]} opacity={0.3} stroke={colors[gi % colors.length]} strokeWidth={1.5} />
                    {/* Median + quartile lines */}
                    <line x1={cx - halfW * 0.5} x2={cx + halfW * 0.5} y1={toY(stats.median)} y2={toY(stats.median)} stroke={colors[gi % colors.length]} strokeWidth={2} />
                    <line x1={cx - halfW * 0.3} x2={cx + halfW * 0.3} y1={toY(stats.q1)} y2={toY(stats.q1)} stroke={colors[gi % colors.length]} strokeWidth={1} opacity={0.6} />
                    <line x1={cx - halfW * 0.3} x2={cx + halfW * 0.3} y1={toY(stats.q3)} y2={toY(stats.q3)} stroke={colors[gi % colors.length]} strokeWidth={1} opacity={0.6} />
                    <text x={cx} y={height - 10} textAnchor="middle" fill="var(--color-text-muted)" fontSize={11}>{name}</text>
                  </g>
                )
              })}
            </svg>
          </div>
        )
      }

      case 'density': {
        // Kernel Density Estimation rendered as smooth AreaChart
        const vals = data.map(d => d.value).sort((a, b) => a - b)
        const dMin = vals[0], dMax = vals[vals.length - 1]
        const dRange = dMax - dMin || 1
        const bw = dRange / Math.max(Math.sqrt(vals.length), 2)
        const steps = 60
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
            <AreaChart data={kdeData}>
              {gridEl}
              <XAxis dataKey="x" tick={AXIS_TICK} />
              <YAxis tick={AXIS_TICK} />
              {tooltipEl}
              <Area type="monotone" dataKey="density" stroke={colors[0]} fill={colors[0]} fillOpacity={0.2} strokeWidth={2} dot={false} />
              {annotationEls}
            </AreaChart>
          </ResponsiveContainer>
        )
      }

      case 'error_bar':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <BarChart data={data}>
              {gridEl}{xAxisEl}{yAxisEl}{tooltipEl}
              <Bar dataKey="value" fill={colors[0]} radius={[4, 4, 0, 0]}>
                <ErrorBar dataKey="errorPlus" width={4} strokeWidth={2} stroke={colors[1] || '#ef4444'} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )

      case 'candlestick': {
        // value=open, value2=close, value3=high, errorPlus=low
        return (
          <ResponsiveContainer width="100%" height={height}>
            <ComposedChart data={data}>
              {gridEl}{xAxisEl}{yAxisEl}{tooltipEl}
              <Bar dataKey="value" fill="transparent" />
              {data.map((d, i) => {
                const open = d.value, close = d.value2 ?? d.value
                const color = close >= open ? '#22c55e' : '#ef4444'
                return <ReferenceLine key={i} y={close} stroke={color} strokeWidth={0} />
              })}
              <Bar dataKey="value2" barSize={12}>
                {data.map((d, i) => {
                  const open = d.value, close = d.value2 ?? d.value
                  return <Cell key={i} fill={close >= open ? '#22c55e' : '#ef4444'} />
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
        const maxVal = Math.max(...data.map(d => Math.abs(d.value)), 1)
        const cellH = Math.max(20, Math.min(40, (height - 40) / Math.max(labels.length, 1)))
        const cellW = Math.max(40, 500 / Math.max(cats.length || 1, 1))
        return (
          <div style={{ overflowX: 'auto', height }}>
            <svg width={Math.max(cats.length * cellW + 100, 300)} height={Math.max(labels.length * cellH + 40, 100)}>
              {labels.map((label, ri) =>
                (cats.length > 0 ? cats : ['']).map((cat, ci) => {
                  const d = data.find(d => d.label === label && (cat === '' || d.category === cat))
                  const v = d?.value ?? 0
                  const intensity = Math.abs(v) / maxVal
                  const color = v >= 0
                    ? `rgba(59, 130, 246, ${intensity * 0.9})`
                    : `rgba(239, 68, 68, ${intensity * 0.9})`
                  return (
                    <g key={`${ri}-${ci}`}>
                      <rect x={90 + ci * cellW} y={20 + ri * cellH} width={cellW - 2} height={cellH - 2} fill={color} rx={3}>
                        <title>{`${label}${cat ? ` / ${cat}` : ''}: ${v}`}</title>
                      </rect>
                      <text x={90 + ci * cellW + cellW / 2} y={20 + ri * cellH + cellH / 2} textAnchor="middle" dominantBaseline="central"
                        fill="var(--color-text)" fontSize={9} opacity={0.8}>{v.toFixed(1)}</text>
                    </g>
                  )
                })
              )}
              {labels.map((label, ri) => (
                <text key={ri} x={85} y={20 + ri * cellH + cellH / 2} textAnchor="end" dominantBaseline="central"
                  fill="var(--color-text-muted)" fontSize={10}>{label}</text>
              ))}
              {cats.length > 0 && cats.map((cat, ci) => (
                <text key={ci} x={90 + ci * cellW + cellW / 2} y={12} textAnchor="middle"
                  fill="var(--color-text-muted)" fontSize={10}>{cat}</text>
              ))}
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
              content={({ x, y, width, height: h, name, fill }: any) => (
                <g>
                  <rect x={x} y={y} width={width} height={h} fill={fill} stroke="var(--color-border)" strokeWidth={1} rx={4} />
                  {width > 40 && h > 20 && <text x={x + width / 2} y={y + h / 2} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={11}>{name}</text>}
                </g>
              )}
            />
          </ResponsiveContainer>
        )

      default:
        return <div className="text-center text-xs text-[var(--color-text-muted)] py-8">Chart type "{type}" not yet rendered</div>
    } }

    return (
      <>
        {wasDownsampled && (
          <div className="text-xxs text-[var(--color-text-muted)] bg-[var(--glass-bg)] border border-[var(--color-border)] rounded px-2 py-1 mb-2 flex items-center gap-1">
            <span>Downsampled from {chart.data.length} to {displayData.length} points for display</span>
          </div>
        )}
        {renderChartSwitch()}
      </>
    )
  }

  // ─── Settings Panel ─────────────────────────────────────────
  const renderSettingsPanel = (chart: ChartConfig) => (
    <div className="p-4 border-t border-[var(--color-border)] bg-[var(--glass-bg)] space-y-3 animate-slide-down">
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
          <label className="text-xxs text-[var(--color-text-muted)] block mb-0.5">Color Palette</label>
          <GlassSelect
            value={chart.options.colorPalette}
            onChange={val => updateChartOptions(chart.id, { colorPalette: val })}
            options={Object.keys(PALETTES).map(p => ({
              value: p,
              label: p.charAt(0).toUpperCase() + p.slice(1),
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
            onChange={val => updateChartOptions(chart.id, { legendPosition: val as any })}
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
          <FiZoomIn className="w-3 h-3" /> Brush
        </label>
        <span className="flex items-center gap-1.5 text-xs" title="Trend line overlay">
          Trend:
          <select
            value={chart.options.trendLine}
            onChange={e => updateChartOptions(chart.id, { trendLine: e.target.value as any })}
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
          <FiCrosshair className="w-3 h-3" /> Crosshair
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
          <span className="text-xxs text-[var(--color-text-muted)] font-medium">Annotations</span>
          <div className="flex gap-1">
            <button onClick={() => addStatsAnnotations(chart.id)} className="text-xxs px-1.5 py-0.5 rounded hover:bg-white/10" style={{ color: 'var(--color-accent-green)' }}>+ Mean/Median</button>
            <button onClick={() => addAnnotation(chart.id)} className="text-xxs px-1.5 py-0.5 rounded hover:bg-white/10" style={{ color: 'var(--color-accent-blue)' }}>+ Line</button>
          </div>
        </div>
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
            <button onClick={() => removeAnnotation(chart.id, ann.id)} className="text-xxs p-0.5 rounded hover:bg-white/10" style={{ color: '#ef4444' }}><FiX className="w-3 h-3" /></button>
          </div>
        ))}
      </div>
      {/* Palette preview */}
      <div className="flex items-center gap-1">
        <span className="text-xxs text-[var(--color-text-muted)] mr-1">Palette:</span>
        {getPalette(chart.options.colorPalette).slice(0, 10).map((c, i) => (
          <div key={i} className="w-4 h-4 rounded-sm" style={{ background: c }} />
        ))}
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
              {charts.length} chart{charts.length !== 1 ? 's' : ''} — {CHART_TYPES.length} types (2D + 3D), CSV/XLSX import &amp; export, annotations, trend lines, statistics
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowAdd(false)}>
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
                    onChange={val => setForm(f => ({ ...f, type: val as ChartType }))}
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
                className="btn-primary px-4 py-2 text-sm disabled:opacity-30 flex items-center gap-1.5" style={{ color: !form.title.trim() || !form.dataText.trim() ? undefined : 'var(--color-accent-blue)' }}>
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
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => updateChartOptions(chart.id, { showBrush: !chart.options.showBrush })}
                      className={`p-1.5 rounded hover:bg-[var(--glass-bg)] transition-colors ${chart.options.showBrush ? 'text-[var(--color-accent-blue)]' : 'text-[var(--color-text-muted)]'}`} title="Toggle brush zoom">
                      <FiZoomIn className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => updateChartOptions(chart.id, { showCrosshair: !chart.options.showCrosshair })}
                      className={`p-1.5 rounded hover:bg-[var(--glass-bg)] transition-colors ${chart.options.showCrosshair ? 'text-[var(--color-accent-cyan)]' : 'text-[var(--color-text-muted)]'}`} title="Toggle crosshair">
                      <FiCrosshair className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => setShowSettings(showSettings === chart.id ? null : chart.id)}
                      className="p-1.5 rounded hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)] hover:text-[var(--color-accent-purple)]" title="Settings">
                      <FiSettings className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => setExpandedChart(expandedChart === chart.id ? null : chart.id)}
                      className="p-1.5 rounded hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)] hover:text-[var(--color-accent-cyan)]"
                      title={expandedChart ? 'Collapse' : 'Expand'}>
                      {expandedChart === chart.id ? <FiMinimize2 className="w-3.5 h-3.5" /> : <FiMaximize2 className="w-3.5 h-3.5" />}
                    </button>
                    <button onClick={() => exportPng(chart.id, chart.title)}
                      className="p-1.5 rounded hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)] hover:text-[var(--color-accent-blue)]" title="PNG">
                      <FiDownload className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => exportSvg(chart.id, chart.title)}
                      className="p-1.5 rounded hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)] hover:text-[var(--color-accent-green)]" title="SVG">
                      <FiDroplet className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => exportCsv(chart)}
                      className="p-1.5 rounded hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)] hover:text-[var(--color-accent-orange)]" title="CSV">
                      <FiCopy className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => exportXlsx(chart)}
                      className="p-1.5 rounded hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)] hover:text-[var(--color-accent-purple)]" title="XLSX">
                      <FiUpload className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => copyChartToClipboard(chart.id)}
                      className="p-1.5 rounded hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)] hover:text-[var(--color-accent-cyan)]" title="Copy to clipboard">
                      {copiedChart === chart.id ? <FiCheck className="w-3.5 h-3.5 text-[var(--color-success)]" /> : <FiClipboard className="w-3.5 h-3.5" />}
                    </button>
                    <button onClick={() => duplicateChart(chart)}
                      className="p-1.5 rounded hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]" title="Duplicate">
                      <FiEdit3 className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => deleteChart(chart.id)}
                      className="p-1.5 rounded hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)] hover:text-[var(--color-error)]" title="Delete">
                      <FiTrash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Chart body */}
                <div className="p-4" ref={el => { chartRefs.current[chart.id] = el }}>
                  {renderChart(chart, expandedChart === chart.id ? 500 : 280)}
                </div>

                {/* Footer */}
                <div className="px-4 pb-3 flex flex-wrap items-center gap-3 text-xxs text-[var(--color-text-muted)]">
                  <span>{chart.data.length} pts</span>
                  <span>{chart.options.colorPalette}</span>
                  <span>{formatDate(chart.createdAt)}</span>
                  {chart.options.trendLine === 'linear' && chart.data.length >= 2 && (() => {
                    const { r2 } = computeLinearRegression(chart.data)
                    return <span style={{ color: '#f59e0b' }}>R²={r2.toFixed(3)}</span>
                  })()}
                  {(chart.annotations || []).length > 0 && <span>{chart.annotations.length} annotation{chart.annotations.length !== 1 ? 's' : ''}</span>}
                  {chart.options.showStats && chart.data.length >= 2 && (() => {
                    const s = computeStats(chart.data)
                    if (!s) return null
                    return (
                      <span className="flex items-center gap-2" style={{ color: 'var(--color-accent-cyan)' }}>
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
