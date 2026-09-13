import { useEffect, useRef } from 'react'
import type { MapMouseEvent, Map as MapGL } from 'maplibre-gl'
import { nearestTap } from './tap-target'
import type { MapCanvasProps } from './map-props'

/* What a tap on the bare canvas means, while the itinerary is being worked on.

   Three kinds of thing can be under a thumb, and only one of them is a place.

   A stop's own pin is a DOM marker sitting above the canvas, so a tap on one
   never reaches the map at all — which is exactly right: tapping a pin edits
   the stop, tapping bare map makes a new one.

   A sight and an airport gate are not pins. They are drawn into the canvas as
   layers, so their taps do reach here, and for a while that meant tapping a
   sight while editing made a blank stop on top of the very thing somebody was
   asking about. It was patched by switching sights off for the whole of
   editing, which traded one wrong answer for another: editing is the mode you
   turn on to work on the itinerary, and a sight you can see is the thing you
   are most likely to want to add.

   So a tap that landed on one is left to the handler that knows what it is,
   found with the same padded query those handlers use — so the two always
   agree about what counts as a hit.

   Only while editing. Placing or moving a stop, a tap means "here" whatever
   happens to be drawn underneath it. */
export default function usePlaceTap(
  map: MapGL | null,
  {
    editing,
    placing,
    onMapClick,
  }: {
    editing: boolean
    placing: boolean
    onMapClick: MapCanvasProps['onMapClick']
  },
) {
  const clickRef = useRef(onMapClick)
  clickRef.current = onMapClick
  useEffect(() => {
    if (!map || (!editing && !placing)) return
    const h = (e: MapMouseEvent) => {
      if (
        !placing &&
        (nearestTap(map, e.point, 'attr-dot') || nearestTap(map, e.point, 'indoor-gate'))
      )
        return
      clickRef.current?.([e.lngLat.lng, e.lngLat.lat])
    }
    map.on('click', h)
    return () => {
      map.off('click', h)
    }
  }, [map, editing, placing])
}
