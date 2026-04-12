/**
 * Shared Plotly configuration presets.
 *
 * Plotly's default modebar ships with ~12 buttons, most of which add
 * noise rather than value inside Humanovo — for example `sendDataToCloud`,
 * `toggleSpikelines`, `resetScale2d`, `autoScale2d` and the various
 * hover-mode toggles. The platform also offers its own native
 * "Copy PNG" / "Export PNG" buttons via `plotExport.ts`, so Plotly's
 * built-in `toImage` snapshot (which ignores our transparent-bg defaults)
 * is redundant and actively misleading.
 *
 * This file centralises a single `plotlyConfig()` factory so every
 * Plotly mount across the platform strips the same noisy buttons,
 * keeping only the essentials (zoom / pan / reset camera). Downstream
 * callers can pass `{ hide: true }` to suppress the modebar entirely
 * (3D surfaces use this for a clean canvas) or override any fields.
 */

type ModeBarMode = boolean | 'hover'

export interface PlotlyConfigOptions {
  /** If true, hide the modebar entirely. Default: false (show on hover). */
  hide?: boolean
  /** Override the baseline `displayModeBar` flag. */
  displayModeBar?: ModeBarMode
  /** Additional buttons to strip on top of the non-essential defaults. */
  extraRemove?: string[]
}

/**
 * Plotly modebar buttons we always strip. These are either noisy,
 * duplicated by the platform's own toolbar, or interact badly with the
 * dark theme (Plotly's toImage button ignores our transparent-bg
 * plotExport path).
 */
const NON_ESSENTIAL_BUTTONS: string[] = [
  'sendDataToCloud',
  'toggleSpikelines',
  'hoverClosestCartesian',
  'hoverCompareCartesian',
  'toggleHover',
  'lasso2d',
  'select2d',
  'autoScale2d',
  'resetScale2d',
  'zoomIn2d',
  'zoomOut2d',
  'hoverClosest3d',
  'resetCameraLastSave3d',
  'orbitRotation',
  'tableRotation',
  'toImage', // superseded by Humanovo's own Copy PNG / Export PNG
  'resetViewMapbox',
  'resetViewSankey',
]

export function plotlyConfig(opts: PlotlyConfigOptions = {}): Record<string, unknown> {
  const { hide = false, displayModeBar, extraRemove = [] } = opts
  const display: ModeBarMode = displayModeBar ?? (hide ? false : 'hover')
  return {
    responsive: true,
    displaylogo: false,
    displayModeBar: display,
    modeBarButtonsToRemove: [...NON_ESSENTIAL_BUTTONS, ...extraRemove],
  }
}
