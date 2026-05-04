// Shared publication-grade theming primitives. Exposes the same five
// themes (screen / paper / nature / science / ieee), font scales,
// aspect presets, smart tick formatters, color-blind palettes, and CB
// simulation filters as DataVisualization, so any chart anywhere in
// the app (Compute Lab, MonteCarlo, Imaging, Workstation, etc.) can
// render journal-ready output.

export type PublicationTheme = 'screen' | 'paper' | 'nature' | 'science' | 'ieee'
export type AspectPreset = 'free' | '16:9' | '4:3' | '3:2' | '1:1' | 'golden' | 'two-col'
export type FontScale = 'small' | 'normal' | 'large' | 'huge'
export type TickFormat = 'auto' | 'scientific' | 'percent' | 'currency' | 'compact' | 'plain'
export type CBlindSim = 'none' | 'protanopia' | 'deuteranopia' | 'tritanopia' | 'achromatopsia'

export interface ThemeStyle {
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
}

export const THEMES: Record<PublicationTheme, ThemeStyle> = {
  screen: {
    bg: 'transparent',
    axisColor: 'var(--color-text-muted)',
    gridColor: 'var(--color-border)',
    textColor: 'var(--color-text)',
    mutedColor: 'var(--color-text-muted)',
    titleFont: "'Inter', system-ui, sans-serif",
    bodyFont: "'Inter', system-ui, sans-serif",
    axisStrokeWidth: 1,
    gridStrokeWidth: 1,
    gridDash: '3 3',
    tooltipBg: 'var(--color-surface-solid)',
  },
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
  },
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
  },
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
  },
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
  },
}

export const FONT_SCALE_MULT: Record<FontScale, number> = {
  small: 0.85, normal: 1, large: 1.15, huge: 1.4,
}

export const ASPECT_RATIO: Record<AspectPreset, number | null> = {
  free: null,
  '16:9': 16 / 9,
  '4:3': 4 / 3,
  '3:2': 3 / 2,
  '1:1': 1,
  golden: 1.618,
  'two-col': 2.0,
}

export const CB_SIM_FILTER: Record<CBlindSim, string> = {
  none: 'none',
  protanopia: 'url(#cb-protan)',
  deuteranopia: 'url(#cb-deuter)',
  tritanopia: 'url(#cb-tritan)',
  achromatopsia: 'grayscale(100%)',
}

// Muted color-blind-safe palettes (Wong-style, Tol-style, Cividis,
// Viridis, IBM, all desaturated) plus the original editorial
// palettes from DataVisualization. Single source of truth so every
// chart everywhere uses the same names.
export const PALETTES: Record<string, string[]> = {
  default:     ['#5B8DB8', '#8B7EAF', '#6BA594', '#C4956A', '#7BA7B8', '#B07E8B', '#A89B6E', '#8598AD', '#7E9B8A', '#9B8EAD'],
  nature:      ['#4A7C6F', '#5D9178', '#6FA583', '#81B792', '#94C7A2', '#749C76', '#5E8860', '#8CB186', '#6D9969', '#527E56'],
  ocean:       ['#3D5A80', '#4D6D94', '#5E80A8', '#6E93BB', '#7FA6CE', '#8FB9E1', '#6997B8', '#5784A5', '#457192', '#335E7F'],
  warm:        ['#B57170', '#C48A6F', '#CFA277', '#D4B481', '#DABD8B', '#C19068', '#B87E5E', '#CF9E72', '#D5AA7D', '#C2886A'],
  pastel:      ['#B8C4D8', '#C2B8D6', '#BDC8CA', '#D1C4B8', '#C8BDC8', '#B8CDB8', '#D3D1B8', '#C8BAB8', '#B8BFD6', '#C4C8C2'],
  scientific:  ['#4A6670', '#5C8A82', '#8FA96C', '#C4A05C', '#B87A5C', '#6C7C4A', '#4A5C3C', '#9C8258', '#7C5C3C', '#2A4048'],
  diverging:   ['#B85450', '#C87A5E', '#D8A870', '#E8D088', '#F0F0B8', '#B8D890', '#88C070', '#58A858', '#389038', '#207828'],
  monochrome:  ['#2A3544', '#354252', '#404F60', '#4B5C6E', '#56697C', '#61768A', '#6C8398', '#7790A6', '#829DB4', '#8DAAC2'],
  wong:        ['#3F4D5A', '#A88863', '#6E94AC', '#6FA289', '#B6AC7A', '#5A7896', '#A87560', '#8E7A8A', '#888888', '#5C638A'],
  okabe_ito:   ['#A88863', '#6E94AC', '#6FA289', '#B6AC7A', '#5A7896', '#A87560', '#8E7A8A', '#3F4D5A', '#888888', '#5C638A'],
  tol_bright:  ['#566E89', '#A06872', '#5C8267', '#A09766', '#7A9DAE', '#8B6680', '#9A9A9A', '#5C638A', '#587A6E', '#7A5C6E'],
  tol_vibrant: ['#496E89', '#6F94A0', '#5E8B85', '#A88164', '#9C5E55', '#9A6B7E', '#9A9A9A', '#5C638A', '#587A6E', '#7A5C6E'],
  ibm:         ['#6E7BA0', '#7A6F9E', '#9A6F86', '#A88164', '#A89668', '#3F4D5A', '#9A9A9A', '#5C638A', '#587A6E', '#7A5C6E'],
  cividis:     ['#293949', '#3A4866', '#4F5870', '#646672', '#7A7A78', '#8E867A', '#A19878', '#B0A678', '#BFB37A', '#C8BD7E'],
  viridis:     ['#3F3F62', '#414269', '#42476E', '#3F5570', '#3F6770', '#3F786C', '#5A8462', '#7A8E5C', '#9C9655', '#B79E50'],
}

export const CB_SAFE_PALETTES = new Set(['wong', 'okabe_ito', 'tol_bright', 'tol_vibrant', 'ibm', 'cividis', 'viridis'])

export function getPalette(name: string): string[] {
  return PALETTES[name] || PALETTES.default
}

export function makeTickFormatter(fmt: TickFormat, decimals: number): (v: unknown) => string {
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
        return n.toFixed(dp)
      }
  }
}

export function normalizeHex(c: string): string {
  if (!c) return '#888888'
  const t = c.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(t)) return t
  if (/^#[0-9a-fA-F]{3}$/.test(t)) {
    const h = t.slice(1)
    return '#' + h.split('').map(x => x + x).join('')
  }
  return '#888888'
}

export function hexToRgba(hex: string, alpha: number): string {
  if (hex.startsWith('rgba') || hex.startsWith('rgb')) return hex
  const h = hex.replace(/^#/, '')
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  if (full.length !== 6) return `rgba(120,120,120,${alpha})`
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

// Default publication options bundle — every chart anywhere in the
// app should be able to merge this on top of its own state.
export interface PublicationOptions {
  pubTheme: PublicationTheme
  fontScale: FontScale
  aspect: AspectPreset
  tickFormatX: TickFormat
  tickFormatY: TickFormat
  decimalPlaces: number
  showTitle: boolean
  showCaption: boolean
  cbSim: CBlindSim
  watermark: string
  colorPalette: string
  customPalette?: string[]
}

export const DEFAULT_PUB_OPTIONS: PublicationOptions = {
  pubTheme: 'screen',
  fontScale: 'normal',
  aspect: 'free',
  tickFormatX: 'auto',
  tickFormatY: 'auto',
  decimalPlaces: 2,
  showTitle: true,
  showCaption: true,
  cbSim: 'none',
  watermark: '',
  colorPalette: 'default',
}
