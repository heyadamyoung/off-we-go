import type { ReactNode } from 'react'
import type { FeatureCollection } from 'geojson'
import type { MapPadding } from '../../../live-map-view-core'
import type { PhoneMarker } from '../../../live-markers-core'
import type {
  Attraction,
  Coordinates,
  Id,
  MapView,
  Stop,
  TripPhoto,
} from '../../../shared/model/types'
import type { IndoorGate } from './indoor-layers'

/* The map component's whole contract, kept beside the other map models so the
   component file itself stays under the review boundary. */

/** The wash the time of day lays over the basemap. */
export interface MapTint {
  color: string
  alpha: number
}

export interface MapCanvasProps {
  view: MapView
  onView: (view: MapView, options?: { user?: boolean }) => void
  theme: string
  tint?: MapTint | null
  interactive?: boolean
  route?: Coordinates[]
  /** the measured way from the person to the stop they asked about */
  measure?: Coordinates[] | null
  /** right-click or long-press: ask about a place rather than a feature */
  onContextMenu?: (point: Coordinates) => void
  stops?: Stop[]
  photos?: TripPhoto[]
  markers?: PhoneMarker[]
  trail?: Coordinates[][]
  /** the walked line older than the recency window, drawn as a ghost */
  trailFaded?: Coordinates[][]
  selectedStop?: Id | null
  onStop?: (id: Id) => void
  onPhoto?: (photos: TripPhoto[], index: number) => void
  onLive?: () => void
  labels?: boolean
  highlight?: Id | null
  padding?: MapPadding | null
  editing?: boolean
  placing?: boolean
  onMapClick?: (point: Coordinates) => void
  onStopMove?: (id: Id, point: Coordinates) => void
  places?: Attraction[]
  onPickPlace?: (place: Attraction) => void
  attractions?: FeatureCollection | null
  onPickAttraction?: (poi: Attraction) => void
  indoor?: FeatureCollection | null
  onPickGate?: (gate: IndoorGate) => void
  children?: ReactNode
}
