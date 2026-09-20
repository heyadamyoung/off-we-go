import { useEffect, useRef, type MutableRefObject } from 'react'
import type {
  DataDrivenPropertyValueSpecification,
  GeoJSONSource,
  Map as MapGL,
  MapMouseEvent,
} from 'maplibre-gl'
import { markColourExpression, MIN_ZOOM_KEY, RANK_KEY } from '../../../place-marks-core'
import { whenStyleReady } from './style-ready'
import { nearestTap } from './tap-target'
import { EMPTY_FC } from './use-attractions'
import type { MapCanvasProps } from './map-props'

/* The places layer, drawn into the map document.
 *
 * Lifted out of use-map-layers when that file crossed the review boundary,
 * and it is the right seam: everything left there is the trip — the route
 * somebody drew, the trail they walked, the wash over the basemap — and this
 * is the scenery around it. The trip is a handful of features and every one
 * of them matters; this is three hundred and most of them are a café.
 *
 * Which is the whole of what this file has to get right. Three hundred dots
 * with no grammar is what a map looks like when nobody decided what deserves
 * to be seen from where, and "a cluster of dots" is what it was called when
 * it reached somebody looking at a city. The grammar is in three parts and
 * only the third is here:
 *
 *   which zoom      each place earns its own, from its category and from how
 *                   sure we are of the record. The server decides it — see
 *                   places/rank.js — and the filter below obeys.
 *   which wins      when two names want the same piece of screen, the better
 *                   place keeps it. The server ranks; symbol-sort-key spends
 *                   it. Without this the winner is whichever the source
 *                   listed second, which is how a café hides a cathedral.
 *   which colour    eight families, in place-marks-core, so a street with
 *                   three cafés and a museum on it does not read as four of
 *                   the same thing.
 */

export interface AttractionLayerOptions {
  map: MapGL | null
  attractions: MapCanvasProps['attractions']
  themeRef: MutableRefObject<MapCanvasProps['theme']>
  onPickAttraction: MapCanvasProps['onPickAttraction']
}

export default function useAttractionLayers({
  map,
  attractions,
  themeRef,
  onPickAttraction,
}: AttractionLayerOptions) {
  /* Attractions are drawn by the map itself rather than as DOM markers. There
   can be thousands of them across a country, and a thousand absolutely
   positioned elements re-laid-out on every frame is exactly the jank this
   map was rebuilt to be rid of. As a source and two layers they cost the GPU
   almost nothing and stay put during a gesture. */
  const pickRef = useRef(onPickAttraction)
  pickRef.current = onPickAttraction
  /* What the layer is holding, so a style load can put it back. Every other
     source here is re-added from a ref for exactly that reason; this one was
     re-added empty, and the only thing that ever refilled it was the next
     screenful of sights arriving — which, on a map nobody has panned since,
     is never. So switching to the night map made every sight on screen
     disappear, and a sight that is not drawn is a sight that cannot be
     tapped: queryRenderedFeatures answers about what is rendered. */
  const attrRef = useRef(attractions)
  attrRef.current = attractions
  useEffect(() => {
    if (!map) return
    const add = () => {
      if (map.getSource('attr')) return
      map.addSource('attr', { type: 'geojson', data: attrRef.current || EMPTY_FC })
      map.addLayer({
        id: 'attr-dot',
        type: 'circle',
        source: 'attr',
        // Below the route, so the trip always reads on top of the scenery.
        ...(map.getLayer('route-halo') ? { beforeId: 'route-halo' } : {}),
        /* Each place appears at the zoom it earns.
         *
         * This used to be `big OR zoom >= 11`, which is two tiers, and two
         * tiers over three hundred pins is one tier: from zoom 11 upward
         * everything drew at once. A city at zoom 12 was three hundred
         * identical grey dots, and the honest description of it was the one
         * it got.
         *
         * The server decides the zoom per place now — see places/rank.js,
         * which knows both the category and how sure we are of the record —
         * and this only obeys it. A cathedral from across the city, a
         * launderette from its own street. Nothing is hidden; things arrive
         * as you go in, which is the whole grammar of a map.
         *
         * `coalesce` because a client can outlive a server: a pin from
         * before this release carries no minzoom, and the old `big` rule is
         * the right thing to fall back to rather than drawing nothing. */
        filter: [
          '>=',
          ['zoom'],
          ['coalesce', ['get', MIN_ZOOM_KEY], ['case', ['get', 'big'], 11, 14]],
        ],
        /* Colour is the category's, from one of eight families — see
           place-marks-core for why eight and not twenty. The old comment
           here argued for monochrome on the grounds that a rainbow drowns
           the amber that means "your trip", and it was right about the
           amber and wrong about the cause: what drowned it was three hundred
           dots, not their colour. Amber is still spent only on the trip. */
        paint: {
          /* Smaller than before at every zoom, and much smaller when zoomed
             out: a dot is a dot, not a token. Only once you are in a street
             does it grow into something worth aiming a thumb at. */
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            11,
            2.2,
            14,
            3.2,
            16,
            4.6,
            18,
            6.5,
          ],
          'circle-color': markColourExpression(
            themeRef.current,
          ) as DataDrivenPropertyValueSpecification<string>,
          'circle-stroke-width': 1.2,
          'circle-stroke-color':
            themeRef.current === 'light' ? 'rgba(255,255,255,.85)' : 'rgba(8,11,16,.8)',
          /* A place fades in over the half zoom after it arrives rather than
             popping. Three hundred dots appearing at once is what a zoom step
             used to look like. */
          'circle-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.72, 14, 0.88, 16, 1],
        },
      })
      map.addLayer({
        id: 'attr-label',
        type: 'symbol',
        source: 'attr',
        ...(map.getLayer('route-halo') ? { beforeId: 'route-halo' } : {}),
        minzoom: 12.6,
        /* A name once the dot has earned one, and a step later than the dot:
           a place arrives as a mark you can see the colour of, and becomes a
           name you can read when you are close enough for the name to be
           worth the room. */
        filter: [
          '>=',
          ['zoom'],
          ['+', ['coalesce', ['get', MIN_ZOOM_KEY], ['case', ['get', 'big'], 11, 14]], 1.2],
        ],
        layout: {
          'text-field': ['get', 'n'],
          'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 12.6, 10, 16, 12.5],
          'text-offset': [0, 1.05],
          'text-anchor': 'top',
          'text-optional': true,
          'text-padding': 6,
          'text-max-width': 9,
          /* Which name survives when two want the same piece of screen.
           *
           * This is the half of the decluttering the zoom tiers cannot do.
           * Symbols collide and the loser is dropped, but until now the loser
           * was whichever the source happened to list second — which is how a
           * café hides the cathedral behind it. The server ranks every pin
           * (places/rank.js markRank) and this hands that ranking to the
           * collision: MapLibre places low sort keys first and first placed
           * is what survives, so the rank is negated. */
          'symbol-sort-key': ['-', 0, ['coalesce', ['get', RANK_KEY], 0]],
        },
        paint: {
          'text-color': themeRef.current === 'light' ? '#2a3140' : '#e8edf5',
          'text-halo-color':
            themeRef.current === 'light' ? 'rgba(255,255,255,.92)' : 'rgba(8,11,16,.85)',
          'text-halo-width': 1.3,
        },
      })
    }
    // The same race as the route layers above.
    const stopWatching = whenStyleReady(map, add)

    /* A whole-map click with a padded search, not a layer-scoped one: the
       layer-scoped kind fires only on a dot's exact rendered pixels, which
       made the layer feel dead under a thumb until you zoomed the dots big. */
    const hit = (e: MapMouseEvent) => {
      // A gate within the same thumb's reach is the more specific ask, and
      // its own handler in indoor-layers answers it.
      if (nearestTap(map, e.point, 'indoor-gate')) return
      const f = nearestTap(map, e.point, 'attr-dot')
      if (f?.geometry.type !== 'Point') return
      /* Feature properties round-trip through the GPU as plain JSON; this is
       the shape featureFor wrote into them. */
      const drawn = f.properties as {
        id: number
        n: string
        d?: string
        k?: string
        f?: string
        big?: boolean
      }
      pickRef.current?.({
        ...drawn,
        name: drawn.n,
        lng: f.geometry.coordinates[0],
        lat: f.geometry.coordinates[1],
      })
    }
    const enter = () => {
      map.getCanvas().style.cursor = 'pointer'
    }
    const leave = () => {
      map.getCanvas().style.cursor = ''
    }
    map.on('click', hit)
    map.on('mouseenter', 'attr-dot', enter)
    map.on('mouseleave', 'attr-dot', leave)
    return () => {
      stopWatching()
      map.off('click', hit)
      map.off('mouseenter', 'attr-dot', enter)
      map.off('mouseleave', 'attr-dot', leave)
    }
  }, [map, themeRef])

  useEffect(() => {
    if (!map || !attractions) return
    const src = map.getSource<GeoJSONSource>('attr')
    if (src) src.setData(attractions)
  }, [map, attractions])
}
