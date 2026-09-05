import { MapCanvas } from '../../map'
import type useTripPage from '../model/use-trip-page'
import type { Coordinates } from '../../../shared/model/types'

/* The trip's map, fed entirely from the page bag: the one place the thirty
   props meet the canvas, so the page itself stays about composition. */
export default function TripMap({
  page,
  measure,
  patch,
  onContextMenu,
}: {
  page: ReturnType<typeof useTripPage>
  measure: Coordinates[] | null
  patch: (changes: Record<string, unknown>) => void
  onContextMenu: (point: Coordinates) => void
}) {
  // biome-ignore format: one bag of names; the grouped lines scan better than one name per line
  const {
    mapTheme, sun, mapView, onMapView, mapPadding, routeDraft, track, liveStops, photos,
    markers, trail, trailFaded, selected, pickStop, openViewer, liveStop, editing, placing,
    onMapClicked, onStopMove, places, pickPlace, attractions, setAttractionCard, indoor,
  } = page
  return (
    <MapCanvas
      theme={mapTheme}
      tint={sun}
      view={mapView}
      onView={onMapView}
      padding={mapPadding}
      route={routeDraft || track}
      stops={liveStops}
      photos={photos}
      markers={markers}
      trail={trail}
      trailFaded={trailFaded}
      measure={measure}
      onContextMenu={onContextMenu}
      selectedStop={selected}
      labels={mapView.zoom > 13}
      onStop={pickStop}
      onPhoto={openViewer}
      onLive={() => liveStop && patch({ sel: liveStop.id })}
      editing={editing}
      placing={!!placing}
      onMapClick={onMapClicked}
      onStopMove={onStopMove}
      places={editing && !routeDraft ? places : []}
      onPickPlace={pickPlace}
      attractions={attractions}
      onPickAttraction={setAttractionCard}
      indoor={indoor.mapData}
      onPickGate={indoor.toGate}
    />
  )
}
