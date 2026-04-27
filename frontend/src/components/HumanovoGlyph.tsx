import type { CSSProperties } from 'react'

interface HumanovoGlyphProps {
  size?: number
  className?: string
  style?: CSSProperties
  title?: string
}

/**
 * Humanovo glyph — two overlapping discs forming a peanut / dumbbell silhouette.
 *
 * The mark is exactly two filled circles whose centres are placed close
 * enough that their outlines overlap into a smooth pinched waist (the
 * "metaball" effect at the boundary). Inheriting fill from `currentColor`
 * means the same component works on both light and dark themes — set the
 * parent text colour and the glyph follows.
 */
export default function HumanovoGlyph({
  size = 32,
  className,
  style,
  title = 'humanovo',
}: HumanovoGlyphProps) {
  // viewBox 80 × 40 centres a peanut with:
  //   left  disc: cx=24, cy=20, r=18  → x ∈ [6, 42]
  //   right disc: cx=56, cy=20, r=18  → x ∈ [38, 74]
  //   centre-to-centre = 32, sum of radii = 36, overlap = 4 px (10%) →
  //   produces the gentle waist visible in the brand mark.
  return (
    <svg
      width={size}
      height={size * 0.5}
      viewBox="0 0 80 40"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
      className={className}
      style={style}
    >
      <title>{title}</title>
      <circle cx="24" cy="20" r="18" fill="currentColor" />
      <circle cx="56" cy="20" r="18" fill="currentColor" />
    </svg>
  )
}
