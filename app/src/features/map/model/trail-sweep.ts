import type { ExpressionSpecification, Map as MapLibreMap } from 'maplibre-gl'
import { ACCENT, ACCENT_BRIGHT } from './map-style'
import type { Coordinates } from '../../../shared/model/types'

/* The travelled line draws itself in the first time it appears — one
   choreographed moment, from the same easing family as the marker glide.
   Skipped for anyone who asked their OS for less motion. The factory closes
   over its own "already played" flag, so a theme swap re-adding the layers
   does not replay the moment. */
export default function makeTrailSweep({
  trailRef,
  interactive,
}: {
  trailRef: { current: Coordinates[][] }
  interactive: boolean
}) {
  let drawnIn = false
  return (m: MapLibreMap) => {
    if (drawnIn || !m.getLayer('trail-line') || !trailRef.current.length) return
    drawnIn = true
    if (
      !interactive ||
      (typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
    )
      return
    const t0 = performance.now()
    const ms = 1200
    const tick = () => {
      try {
        if (!m.getLayer('trail-line')) return
        const t = Math.min(1, (performance.now() - t0) / ms)
        const eased = 1 - (1 - t) ** 3
        const cut = (colour: string): ExpressionSpecification => [
          'step',
          ['line-progress'],
          colour,
          Math.max(eased, 0.002),
          'rgba(0,0,0,0)',
        ]
        m.setPaintProperty('trail-line', 'line-gradient', cut(ACCENT))
        m.setPaintProperty('trail-halo', 'line-gradient', cut(ACCENT_BRIGHT))
        if (t < 1) requestAnimationFrame(tick)
        else {
          // Unsetting the gradient hands the lines back to their line-color.
          m.setPaintProperty('trail-line', 'line-gradient', undefined)
          m.setPaintProperty('trail-halo', 'line-gradient', undefined)
        }
      } catch {
        /* the map went away mid-sweep */
      }
    }
    requestAnimationFrame(tick)
  }
}
