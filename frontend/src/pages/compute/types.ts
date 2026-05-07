// Unified Compute Lab — shared type definitions

import type { ComponentType } from 'react'

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
  rawData?: unknown
}

// Each preset knows the concrete types of its own params. The compute()
// callback receives `Record<string, ParamValue>` but each preset
// internally treats values as the concrete type it expects (string for
// text inputs, number for sliders, etc.). Tightening this further would
// cascade into ~200 preset-specific narrowing calls; leave the contract
// permissive at this layer and rely on each preset's local invariants.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ParamValue = any

export interface PresetParam {
  key: string
  label: string
  type: 'number' | 'string' | 'select' | 'textarea'
  default?: ParamValue
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
  sampleData: Record<string, ParamValue>
  compute: (params: Record<string, ParamValue>) => ComputeResult
  workflowStage?: 'acquisition' | 'preprocessing' | 'analysis' | 'modeling' | 'visualization' | 'export'
}

export interface ToolboxCategory {
  id: string
  name: string
  icon: ComponentType<{ className?: string }>
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
  extra?: Record<string, unknown>
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

export type ComputeMode = 'workstation' | 'montecarlo' | 'equations'
