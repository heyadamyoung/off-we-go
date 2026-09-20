import { useEffect } from 'react'
import type { Map as MapGL } from 'maplibre-gl'
import { streetNamePlan } from '../../../map-labels-core'
import { whenStyleReady } from './style-ready'

/* The basemap's own street names, turned up or off.

   Applied rather than baked into the style document for two reasons. The
   switch has to reach a map that is already drawn, and setStyle throws the
   whole document away — so whatever this does has to be done again on every
   style load, which is exactly the shape the sights were missing when the
   night map swallowed them. One place owns how much the basemap says, and it
   says it again every time there is a basemap to say it to. */
export default function useMapLabels(map: MapGL | null, streetNames: boolean) {
  useEffect(() => {
    if (!map) return
    const apply = () => {
      for (const change of streetNamePlan(streetNames)) {
        // A style that does not carry the layer is not an error: the fork can
        // be regenerated from an upstream that names its layers differently.
        if (!map.getLayer(change.id)) continue
        map.setLayoutProperty(change.id, 'visibility', change.visibility)
        map.setLayerZoomRange(change.id, change.minzoom, change.maxzoom)
      }
    }
    return whenStyleReady(map, apply)
  }, [map, streetNames])
}
