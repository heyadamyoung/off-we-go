import type { Map as MapLibreMap } from 'maplibre-gl'
import type { PlaneOnMap } from '../../../plane-core'
import { MapMarker, useMapBearing } from './map-marker'

/* The aircraft, where the transponder network last heard it, pointing the
   way it is going. A bearing is in the world and the marker is glued to the
   screen, so in heading-up mode it counter-turns by the map's own bearing
   like the walkers' beams do. */

export default function PlaneMarker({ map, plane }: { map: MapLibreMap; plane: PlaneOnMap }) {
  const bearing = useMapBearing(map)
  const turn = plane.heading == null ? 0 : plane.heading - bearing
  return (
    <MapMarker map={map} lng={plane.lng} lat={plane.lat}>
      <div className={'mplane' + (plane.airborne ? ' up' : '')} title={plane.title}>
        <svg
          viewBox="0 0 24 24"
          width="26"
          height="26"
          style={{ transform: `rotate(${turn}deg)` }}
          aria-hidden="true">
          <path
            d="M12 1.5 14.2 8.6 22 12v2.2l-7.6-1.9-.5 5.8 2.6 2v1.6L12 20.6l-4.5 1.1v-1.6l2.6-2-.5-5.8L2 14.2V12l7.8-3.4z"
            fill="currentColor"
          />
        </svg>
        <span className="sr-only">{plane.title}</span>
      </div>
    </MapMarker>
  )
}
