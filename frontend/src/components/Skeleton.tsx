/**
 * Skeleton — lightweight placeholder shown while async content loads.
 *
 * Why not use a library: adding a deps-bearing skeleton pulls in
 * animation primitives we already have via CSS. This is 40 lines,
 * tree-shakes to almost nothing, and matches the existing glass/muted
 * palette from index.css.
 */

import { forwardRef, type CSSProperties, type HTMLAttributes } from 'react'

type Variant = 'text' | 'rect' | 'circle'

interface SkeletonProps extends Omit<HTMLAttributes<HTMLDivElement>, 'style'> {
  variant?: Variant
  width?: number | string
  height?: number | string
  /** `lines=N` renders N stacked text-variant skeletons. */
  lines?: number
  style?: CSSProperties
}

/** Base shimmer style — animates opacity between 0.5 and 0.85. */
const BASE: CSSProperties = {
  background: 'var(--color-surface-raised, rgba(255,255,255,0.04))',
  borderRadius: 4,
  animation: 'humanovo-skeleton-pulse 1.6s ease-in-out infinite',
}

export const Skeleton = forwardRef<HTMLDivElement, SkeletonProps>(function Skeleton(
  { variant = 'text', width, height, lines, style, className, ...rest },
  ref,
) {
  if (lines && lines > 1) {
    return (
      <div ref={ref} className={className} {...rest}>
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            style={{
              ...BASE,
              height: height ?? 10,
              width:
                i === lines - 1
                  ? // Last line is shorter — feels like a natural paragraph end.
                    `${60 + ((i * 7) % 30)}%`
                  : width ?? '100%',
              marginBottom: i < lines - 1 ? 8 : 0,
              borderRadius: 4,
            }}
          />
        ))}
      </div>
    )
  }

  const finalStyle: CSSProperties = {
    ...BASE,
    width,
    height:
      height ?? (variant === 'text' ? 14 : variant === 'circle' ? 32 : 80),
    borderRadius:
      variant === 'circle' ? '50%' : variant === 'text' ? 3 : 6,
    ...style,
  }
  return <div ref={ref} style={finalStyle} className={className} {...rest} />
})

/**
 * Insert this once near the app root if the global animation isn't
 * already declared. Calling multiple times is harmless — the browser
 * deduplicates identical <style> nodes.
 */
export function SkeletonStyles() {
  return (
    <style>{`
      @keyframes humanovo-skeleton-pulse {
        0%, 100% { opacity: 0.5; }
        50% { opacity: 0.85; }
      }
    `}</style>
  )
}
