import type { Map as MapGL, MapGeoJSONFeature, PointLike } from 'maplibre-gl'
import type { Point } from 'geojson'

/* Half a fingertip, in pixels. The tappable things drawn into the canvas —
   attraction dots, gates — render three to seven pixels wide, and a
   layer-scoped click fires only on their exact pixels: fine for a cursor,
   hopeless for a thumb. Every canvas tap target goes through here instead. */
export const TAP_PAD = 14

/** Index of the candidate nearest the tap, -1 for none. Pure, and pinned. */
export function nearestOf(
  point: { x: number; y: number },
  candidates: Array<{ x: number; y: number }>,
) {
  let best = -1
  let bestDistance = Infinity
  candidates.forEach((candidate, i) => {
    const d = (candidate.x - point.x) ** 2 + (candidate.y - point.y) ** 2
    if (d < bestDistance) {
      bestDistance = d
      best = i
    }
  })
  return best
}

/* The layer's nearest rendered point within a thumb of the tap. The render
   engine has already culled by zoom and layer filter, so what comes back is
   exactly what the person could see when they aimed. */
export function nearestTap(map: MapGL, point: { x: number; y: number }, layerId: string) {
  if (!map.getLayer(layerId)) return null
  const box: [PointLike, PointLike] = [
    [point.x - TAP_PAD, point.y - TAP_PAD],
    [point.x + TAP_PAD, point.y + TAP_PAD],
  ]
  const dots = map
    .queryRenderedFeatures(box, { layers: [layerId] })
    .filter(f => f.geometry.type === 'Point')
  const nearest = nearestOf(
    point,
    dots.map(f => map.project((f.geometry as Point).coordinates as [number, number])),
  )
  return nearest < 0 ? null : (dots[nearest] as MapGeoJSONFeature)
}
