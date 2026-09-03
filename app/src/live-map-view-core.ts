import type { Coordinates, MapView } from './shared/model/types'

const validPoint = (point: Coordinates) =>
  Number.isFinite(point?.[0]) &&
  Number.isFinite(point?.[1]) &&
  Math.abs(point[0]) <= 180 &&
  Math.abs(point[1]) <= 90

/* The first thing a trip shows. Averaging the stops put a two-country trip's
   opening view at street zoom over the sea between them — the literal middle
   of the ocean, with everything that matters off every edge. The whole
   itinerary fits instead; a lone stop is its own centre; and a trip with no
   stops yet opens where its map was pointed when it had nothing at all. */
export function initialTripView(stops: Array<{ lng: number; lat: number }>): MapView {
  const placed = stops.filter(stop => validPoint([stop.lng, stop.lat]))
  if (!placed.length) return { center: [4.876, 52.367], zoom: 13.9 }
  const lngs = placed.map(stop => stop.lng)
  const lats = placed.map(stop => stop.lat)
  const west = Math.min(...lngs),
    east = Math.max(...lngs)
  const south = Math.min(...lats),
    north = Math.max(...lats)
  if (placed.length === 1 || (east - west < 1e-6 && north - south < 1e-6)) {
    return { center: [west, south], zoom: 13.9, ms: 0 }
  }
  return {
    center: [(west + east) / 2, (south + north) / 2],
    zoom: 5,
    ms: 0,
    bounds: [
      [west, south],
      [east, north],
    ],
  }
}

export function liveFollowView(
  current: MapView,
  points: Coordinates[],
  { ready, duration }: { ready: boolean; duration: number },
): MapView | null {
  if (!ready) return null
  const valid = points.filter(validPoint)
  if (!valid.length) return null
  if (valid.length === 1) {
    return { center: valid[0], zoom: Math.max(current.zoom, 15), ms: duration, focus: true }
  }

  const lngs = valid.map(point => point[0])
  const lats = valid.map(point => point[1])
  const west = Math.min(...lngs),
    east = Math.max(...lngs)
  const south = Math.min(...lats),
    north = Math.max(...lats)
  return {
    center: [(west + east) / 2, (south + north) / 2],
    zoom: current.zoom,
    ms: duration,
    bounds: [
      [west, south],
      [east, north],
    ],
  }
}

/* The map fills the screen and the chrome floats on top of it, so fitting a
   trip into the container hides whatever lands under the bars — on a phone
   that is a third of the height. Fit into what can actually be seen instead,
   and centre on the middle of that band rather than the middle of the map. */
export interface MapPadding {
  top: number
  right: number
  bottom: number
  left: number
}

export function visibleMapPadding({
  width,
  panelOpen = false,
  barPeek = false,
}: {
  width: number
  panelOpen?: boolean
  /** the phone's bottom bar collapsed to its peek — the map owns that space */
  barPeek?: boolean
}): MapPadding {
  if (width < 640) return { top: 128, right: 20, bottom: barPeek ? 96 : 220, left: 20 }
  /* 104, not 40: the desktop toolbar floats at 24px and runs ~68px tall, and a
     fitted stop at 40 landed its pin and label underneath it. The bottom
     follows the bar height in styles.css (--trip-bar + margin). */
  return { top: 104, right: 40, bottom: 244, left: panelOpen ? 500 : 40 }
}

/* Where to put the thing being focused: the centre of the visible band, which
   is the container's centre shifted by half the difference in the padding. */
export function paddingOffset(padding: MapPadding): [number, number] {
  return [(padding.left - padding.right) / 2, (padding.top - padding.bottom) / 2]
}
