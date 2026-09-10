/* Zooming a photograph, as arithmetic.
 *
 * All of it is the same two questions asked repeatedly — how big, and how far
 * across — and both have answers that are easy to get subtly wrong and
 * miserable to debug through a touchscreen. So they live here, where a test
 * can hold them still.
 *
 * The container is the screen the photograph is shown on. The photograph's
 * size at rest is whatever `object-fit: contain` gave it, which is why it is
 * passed in rather than assumed: a portrait picture on a landscape phone has
 * black either side, and how far it may be dragged depends on that.
 */

export interface Box {
  width: number
  height: number
}

export interface View {
  /** 1 is the photograph at rest, filling as much as it can without cropping. */
  scale: number
  /** How far the photograph has been dragged from the middle, in screen pixels. */
  x: number
  y: number
}

export const AT_REST: View = { scale: 1, x: 0, y: 0 }

export const MIN_SCALE = 1
export const MAX_SCALE = 6

export const clampScale = (scale: number, min = MIN_SCALE, max = MAX_SCALE) =>
  Math.min(Math.max(Number.isFinite(scale) ? scale : min, min), max)

/**
 * How far the photograph may be dragged before its edge comes inside the
 * screen. Zero while it still fits, which is what keeps a picture at rest from
 * sliding around under a finger that meant to turn the page.
 */
export function panLimit(shown: Box, screen: Box, scale: number): Box {
  return {
    width: Math.max(0, (shown.width * scale - screen.width) / 2),
    height: Math.max(0, (shown.height * scale - screen.height) / 2),
  }
}

/** The same, applied: a photograph can never be dragged off its own screen. */
export function clampPan(view: View, shown: Box, screen: Box): View {
  const limit = panLimit(shown, screen, view.scale)
  return {
    scale: view.scale,
    x: Math.min(Math.max(view.x, -limit.width), limit.width),
    y: Math.min(Math.max(view.y, -limit.height), limit.height),
  }
}

/**
 * Zoom about a point, so that whatever is under the fingers stays under them.
 *
 * Scaling about the middle instead is the thing that feels broken without
 * anybody being able to say why: you pinch on a face and the face swims away.
 *
 * `at` is measured from the centre of the screen, because that is where the
 * photograph's own origin is.
 */
export function zoomAbout(
  view: View,
  factor: number,
  at: { x: number; y: number },
  shown: Box,
  screen: Box,
  limits: { min?: number; max?: number } = {},
): View {
  const scale = clampScale(view.scale * factor, limits.min, limits.max)
  // The factor actually applied, once the ends of the range have had their say.
  const applied = scale / view.scale
  return clampPan(
    {
      scale,
      x: at.x - (at.x - view.x) * applied,
      y: at.y - (at.y - view.y) * applied,
    },
    shown,
    screen,
  )
}

/**
 * What a double tap does: in to a useful size about the spot tapped, and all
 * the way back out again from anywhere above rest.
 */
export function toggleZoom(
  view: View,
  at: { x: number; y: number },
  shown: Box,
  screen: Box,
  to = 2.5,
): View {
  if (view.scale > MIN_SCALE + 0.01) return AT_REST
  return zoomAbout(AT_REST, to, at, shown, screen)
}

/**
 * The size a photograph is drawn at when it is asked to fit without cropping —
 * `object-fit: contain`, in arithmetic. Needed because how far a picture may
 * be dragged depends on its own shape: a portrait photograph on a landscape
 * phone has black either side and nowhere sideways to go.
 */
export function fitInside(natural: Box, screen: Box): Box {
  if (!(natural.width > 0 && natural.height > 0)) return { ...screen }
  const scale = Math.min(screen.width / natural.width, screen.height / natural.height)
  return { width: natural.width * scale, height: natural.height * scale }
}

/** The distance between two fingers, which is all a pinch really is. */
export const spread = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y)

/**
 * Whether a one-finger drag belongs to the photograph or to the gallery.
 *
 * Zoomed in, a drag is panning and must never turn the page — reaching the
 * right-hand edge of a picture you are reading is not a request to leave it.
 * At rest there is nothing to pan, so the drag is a swipe.
 */
export const dragPans = (view: View) => view.scale > MIN_SCALE + 0.01
