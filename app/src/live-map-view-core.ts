import type { Coordinates, MapView } from './shared/model/types'

const validPoint = (point: Coordinates) => Number.isFinite(point?.[0]) && Number.isFinite(point?.[1])
  && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90

export function liveFollowView(
  current: MapView,
  points: Coordinates[],
  { ready, duration }: { ready: boolean; duration: number },
): MapView | null {
  if (!ready) return null
  const valid = points.filter(validPoint)
  if (!valid.length) return null
  if (valid.length === 1) {
    return { center: valid[0], zoom: Math.max(current.zoom, 15), ms: duration }
  }

  const lngs = valid.map(point => point[0])
  const lats = valid.map(point => point[1])
  const west = Math.min(...lngs), east = Math.max(...lngs)
  const south = Math.min(...lats), north = Math.max(...lats)
  return {
    center: [(west + east) / 2, (south + north) / 2],
    zoom: current.zoom,
    ms: duration,
    bounds: [[west, south], [east, north]],
  }
}
