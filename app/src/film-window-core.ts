/* The strip of thumbnails along the bottom of the viewer.
 *
 * It drew one button and one image for every photograph on the trip. On a trip
 * with a few hundred that is a thousand elements built every time the viewer
 * opens and reconciled again on every page turn — for a row that shows eight
 * of them. Below 640px the stylesheet hides it outright, which saves the
 * pixels and none of the work: `display: none` is not `do not build`.
 *
 * So it draws what is in view and a few either side, with the rest of the
 * trip's width held open by a spacer at each end. The scrollbar stays honest,
 * the scroll position means what it meant, and the arithmetic is here where it
 * can be argued with.
 */

/** A thumbnail and the gap after it, which is the distance between two. */
export const FILM_PITCH = 114

export interface FilmWindow {
  /** First photograph drawn. */
  from: number
  /** One past the last, so `to - from` is how many are drawn. */
  to: number
  /** Width held open before the first, in pixels. */
  before: number
  /** And after the last. */
  after: number
}

export interface FilmView {
  /** How far the strip has been scrolled. */
  scroll?: number
  /** How much of it is on screen. Nought when nothing has measured it yet. */
  width?: number
  /** The photograph being looked at, which is drawn whatever the scroll says. */
  keep?: number
  pitch?: number
  /** How many extra to draw each side, so a flick has something to land on. */
  spare?: number
}

/**
 * Which slice of the strip to draw.
 *
 * Anchored on the scroll once something has measured the strip, and on the
 * photograph being looked at before that — which is the first render, where
 * the width is not known yet and the one thing that certainly has to be drawn
 * is the one the viewer is on.
 */
export function filmWindow(count: number, view: FilmView = {}): FilmWindow {
  const { scroll = 0, width = 0, keep = 0, pitch = FILM_PITCH, spare = 4 } = view
  const total = Math.max(0, Math.floor(count))
  if (total < 1 || !(pitch > 0)) return { from: 0, to: 0, before: 0, after: 0 }

  const measured = width > 0
  const first = measured ? Math.floor(scroll / pitch) - spare : keep - spare
  const last = measured ? Math.ceil((scroll + width) / pitch) + spare : keep + spare + 1

  const from = Math.max(0, Math.min(total - 1, first))
  const to = Math.max(from + 1, Math.min(total, last))
  return { from, to, before: from * pitch, after: (total - to) * pitch }
}

/**
 * Where to scroll so the photograph being looked at is in the middle.
 *
 * Measured rather than asked of the element: scrollIntoView needs the element
 * to exist, and the whole point of a window is that it might not — paging from
 * the map to a photograph two hundred along lands outside whatever is drawn.
 * The pitch is fixed, so the answer is arithmetic and always available.
 */
export function filmScroll(index: number, width: number, pitch = FILM_PITCH): number {
  if (!(width > 0)) return 0
  return Math.max(0, index * pitch - (width - pitch) / 2)
}
