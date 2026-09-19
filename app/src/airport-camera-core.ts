/* The camera and the terminal. Whether the map is looking at an airport at
   all — close enough, and zoomed in enough, to want its floor plan — and so
   whether the terminal opens on its own, and when it folds again: by the
   camera leaving, zooming out or panning away, and never while a walk
   through it is up. Pure, so the thresholds can be tested without a map. */

import { isAirportStop } from './airport-indoor-core'
import { stepMetres } from './airport-route-core'
import type { Coordinates, Stop } from './shared/model/types'

export interface Screen {
  width: number
  height: number
}

/** The screen the map is on, for how far a pan carries; a test rig has none. */
const screenNow = (): Screen => ({
  width: globalThis.innerWidth || 390,
  height: globalThis.innerHeight || 844,
})

/** Metres to a pixel of the map at this zoom and latitude (512-pixel tiles). */
const metresPerPixel = (zoom: number, lat: number) =>
  (78271.517 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom

/* How far from an airport's pin the camera may be and still be looking at
   the airport: a couple of kilometres, or half again what the screen shows
   when it shows more than that. Panning away from the terminal used to keep
   it open for four kilometres at every zoom — screens and screens of city at
   street level — while zooming out closed it at once. */
export function terminalReach(view: { zoom: number; center: Coordinates }, screen: Screen) {
  const half =
    (metresPerPixel(view.zoom, view.center[1]) * Math.hypot(screen.width, screen.height)) / 2
  return Math.max(2000, 1.5 * half)
}

/** Whether the camera has left this airport: zoomed out past the terminal,
    or panned beyond its reach — either is leaving. */
export function cameraAwayFrom(
  view: { center: Coordinates; zoom: number },
  stop: Stop,
  screen: Screen = screenNow(),
): boolean {
  return (
    view.zoom < 13.8 || stepMetres(view.center, [stop.lng, stop.lat]) > terminalReach(view, screen)
  )
}

/* Zooming into an airport is asking to see inside it; no button needed. The
   thresholds are apart on purpose — open past one zoom, close below a lower
   one — so the terminal does not flicker at the boundary. A terminal closes
   only the way it opened, by the camera leaving — zooming out or panning
   away — and never while a line to somewhere in it is up or a walk through
   it is on. */
export function autoIndoorMove({
  view,
  stops,
  active,
  routing,
  keep = false,
  screen = screenNow(),
}: {
  view: { center: Coordinates; zoom: number } | null
  stops?: Stop[]
  /** the stop whose terminal is open, if any */
  active: Stop | null
  routing: boolean
  /** the walk on the day of a flight wants this terminal, wherever the camera is */
  keep?: boolean
  /** the screen the map is on, for how far a pan carries */
  screen?: Screen
}): { open: Stop } | { close: true } | null {
  if (!view) return null
  if (!active) {
    if (view.zoom < 14.6) return null
    const stop = (stops || []).find(
      s => isAirportStop(s) && stepMetres(view.center, [s.lng, s.lat]) < 1800,
    )
    return stop ? { open: stop } : null
  }
  if (routing || keep) return null
  return cameraAwayFrom(view, active, screen) ? { close: true } : null
}

/* Whether the camera is over this terminal at all, by the same thresholds
   that would fold it. The walk keeps a terminal open wherever the camera
   goes, because its line and its words want the floor plan; the floor
   picker is another matter — a control for floors nobody can see is a
   control in the way of the map — so it follows the camera even when the
   terminal does not. */
export function cameraOverTerminal(
  view: { center: Coordinates; zoom: number } | null | undefined,
  stop: Stop | null | undefined,
  screen: Screen = screenNow(),
): boolean {
  if (!view || !stop) return false
  return !cameraAwayFrom(view, stop, screen)
}
