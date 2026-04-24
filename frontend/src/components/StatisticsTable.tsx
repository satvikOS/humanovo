// StatisticsTable — publication-grade rendering for statistical results.
//
// Replaces the loose numeric vectors compute tools currently dump
// into the console (e.g. regress() returns [slope, intercept, r2, p])
// with a properly formatted table where:
//   * p-values render as italic *p* with proper thresholds
//     (p < 0.001, p < 0.01, p < 0.05, otherwise three decimals)
//   * confidence intervals format as [lower, upper] with the level
//   * effect sizes (η², r², β) get math italics
//   * scientific notation kicks in for |v|≥1e4 or 0<|v|<1e-3
//
// Designed to drop into the Compute Lab statistics panel; the
// `style` prop accepts publication theme overrides so it matches the
// surrounding figure.

export interface StatRow {
  label: string                  // statistic name (e.g. "Slope (β)")
  value?: number                 // raw numeric value
  formatted?: string             // pre-formatted display (overrides value)
  ci?: [number, number]          // 95% CI lower/upper
  ciLevel?: number               // 0.90 / 0.95 / 0.99 — defaults to 0.95
  pValue?: number                // p-value (handled specially)
  italic?: boolean               // render label in italics (Greek letters etc.)
  unit?: string                  // optional unit suffix on the value
  note?: string                  // small note rendered below value
}

export interface StatisticsTableProps {
  title?: string
  rows: StatRow[]
  // Apply the surrounding theme's text/border colors so the table
  // matches the parent figure when nested inside PublicationFigure.
  textColor?: string
  mutedColor?: string
  borderColor?: string
  fontFamily?: string
  // Compact mode for inline tables in cards.
  compact?: boolean
}

function formatPValue(p: number): string {
  if (!Number.isFinite(p)) return '—'
  if (p < 0.001) return 'p < 0.001'
  if (p < 0.01)  return `p = ${p.toFixed(3)}`
  if (p < 0.05)  return `p = ${p.toFixed(3)}`
  return `p = ${p.toFixed(3)}`
}

function formatNumber(v: number, decimals = 3): string {
  if (!Number.isFinite(v)) return '—'
  if (v === 0) return '0'
  const abs = Math.abs(v)
  if (abs >= 1e4 || abs < 1e-3) return v.toExponential(2)
  return v.toFixed(decimals)
}

export default function StatisticsTable({
  title,
  rows,
  textColor = 'var(--color-text)',
  mutedColor = 'var(--color-text-muted)',
  borderColor = 'var(--color-border)',
  fontFamily = "'Inter', system-ui, sans-serif",
  compact = false,
}: StatisticsTableProps) {
  return (
    <div style={{ fontFamily, color: textColor }}>
      {title && (
        <div style={{
          fontSize: compact ? 11 : 13, fontWeight: 600,
          marginBottom: 6, color: textColor,
          textTransform: 'uppercase', letterSpacing: '0.04em',
        }}>{title}</div>
      )}
      <table style={{
        width: '100%', borderCollapse: 'collapse',
        fontSize: compact ? 11 : 12, lineHeight: 1.4,
      }}>
        <tbody>
          {rows.map((r, i) => {
            const lvl = r.ciLevel || 0.95
            const valDisplay = r.formatted ?? (r.value !== undefined ? formatNumber(r.value) : '—')
            return (
              <tr key={i} style={{ borderBottom: `1px solid ${borderColor}` }}>
                <td style={{
                  padding: compact ? '4px 8px 4px 0' : '6px 10px 6px 0',
                  color: mutedColor,
                  fontStyle: r.italic ? 'italic' : undefined,
                  width: '50%',
                }}>{r.label}</td>
                <td style={{
                  padding: compact ? '4px 0' : '6px 0',
                  textAlign: 'right',
                  fontVariantNumeric: 'tabular-nums',
                  color: textColor,
                }}>
                  <span>{valDisplay}{r.unit ? <span style={{ color: mutedColor, marginLeft: 2 }}>{r.unit}</span> : null}</span>
                  {r.ci && (
                    <span style={{ marginLeft: 8, color: mutedColor, fontSize: '0.92em' }}>
                      [{formatNumber(r.ci[0])}, {formatNumber(r.ci[1])}] {Math.round(lvl * 100)}% CI
                    </span>
                  )}
                  {r.pValue !== undefined && (
                    <span style={{ marginLeft: 8, color: mutedColor, fontSize: '0.92em', fontStyle: 'italic' }}>
                      {formatPValue(r.pValue)}
                    </span>
                  )}
                  {r.note && (
                    <div style={{ color: mutedColor, fontSize: '0.85em', marginTop: 2 }}>{r.note}</div>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
