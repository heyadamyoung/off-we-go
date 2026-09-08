import { useEffect, useState } from 'react'
import type { Map as MapGL } from 'maplibre-gl'
import type { Bounds } from '../../../photo-cluster-core'

export interface Viewport {
  zoom: number
  bounds: Bounds | null
}

/* Where the map actually is, as opposed to where it was last asked to go.

   Clustering is a function of the screen — how much ground a pixel covers,
   and which corner of the world is in the window — so it has to read the map
   itself. The `view` prop describes an intent and lags a gesture by a whole
   move, which would leave stacks merged for a beat after somebody zoomed in
   precisely to separate them. */
export default function useViewport(map: MapGL | null, initialZoom = 12): Viewport {
  const [viewport, setViewport] = useState<Viewport>({ zoom: initialZoom, bounds: null })

  useEffect(() => {
    if (!map) return
    const settle = () => {
      const box = map.getBounds()
      setViewport({
        zoom: map.getZoom(),
        bounds: {
          west: box.getWest(),
          south: box.getSouth(),
          east: box.getEast(),
          north: box.getNorth(),
        },
      })
    }
    settle()
    /* Only once the movement has stopped. Re-clustering every frame of a
       pinch would spend the whole gesture rebuilding markers that are about
       to move again. */
    map.on('moveend', settle)
    map.on('zoomend', settle)
    return () => {
      map.off('moveend', settle)
      map.off('zoomend', settle)
    }
  }, [map])

  return viewport
}
