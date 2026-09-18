import type { StyleSpecification } from 'maplibre-gl'

/* Whether the person asked their system for less motion. The stylesheet
   honours the preference by itself; the animations written in code — the
   trail drawing itself in, the map's paint fading between values — read it
   here, so one setting quietens everything. */
export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

/* A style document whose paint changes land at once instead of fading over
   three hundred milliseconds, for a person who asked for less motion. Applied
   as the map takes a style, so it holds through theme swaps; a fade is still
   a fade for everyone else. It is also what lets a page hold still: while a
   fade runs the map draws every frame, which in a software-rendered browser
   is the difference between a map that settles at once and one that keeps
   the machine busy for a second after every change. */
export const withoutTransitions = (
  _previous: StyleSpecification | undefined,
  next: StyleSpecification,
): StyleSpecification => ({ ...next, transition: { duration: 0, delay: 0 } })
