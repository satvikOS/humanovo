// Unified Compute Lab — shared type definitions

export interface ComputeResult {
  statistics?: { label: string; value: string }[]
  chartData?: { x: number; y: number; y2?: number; y3?: number; label?: string; group?: string }[]
  chartType?: 'line' | 'bar' | 'scatter' | 'area' | 'multi-line'
  chartTitle?: string
  xLabel?: string
  yLabel?: string
  seriesLabels?: string[]
  warnings?: string[]
  error?: string
  rawData?: any
}

export interface PresetParam {
  key: string
  label: string
  type: 'number' | 'string' | 'select' | 'textarea'
  default?: any
  description?: string
  min?: number
  max?: number
  step?: number
  options?: { value: string; label: string }[]
  group?: string
}

export interface Preset {
  id: string
  name: string
  referenceFn: string
  toolbox: string
  description: string
  referenceCode: string
  params: PresetParam[]
  sampleData: Record<string, any>
  compute: (params: Record<string, any>) => ComputeResult
  workflowStage?: 'acquisition' | 'preprocessing' | 'analysis' | 'modeling' | 'visualization' | 'export'
}

export interface ToolboxCategory {
  id: string
  name: string
  icon: any
  color: string
  presetCount?: number
}

export interface MCSimParam {
  key: string
  label: string
  min: number
  max: number
  default: number
  step?: number
}

export interface MCSimType {
  id: string
  name: string
  description: string
  params: MCSimParam[]
}

export interface MCResult {
  values: number[]
  stats: { mean: number; median: number; std: number; ci95: [number, number] }
  histogram: { bin: string; count: number }[]
  convergence: { iteration: number; runningMean: number }[]
  extra?: Record<string, any>
}

export interface SavedEquation {
  expr: string
  xMin: number
  xMax: number
  timestamp: number
}

export interface CodeTemplate {
  id: string
  name: string
  category: string
  code: string
}

export type ComputeMode = 'workstation' | 'presets' | 'montecarlo' | 'equations' | '3d'
