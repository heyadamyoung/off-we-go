import type { IControl } from 'maplibre-gl'
import type { FeatureCollection, LineString } from 'geojson'
import type { Coordinates } from '../../../shared/model/types'

/* One accent: amber is the journey. The travelled line, the live pulse and the
   active states all draw from it; the old mint trail green is gone. */
const ACCENT = '#F0A63C'
const ACCENT_BRIGHT = '#FFB454' // glows and halos only — never a fill

const STYLE = {
  // Our own fork of CARTO's dark-matter style, tuned so the night map is the
  // app's own black and the streets hold the trail without shouting over it.
  // Both themes draw OpenFreeMap's tiles. Regenerate with
  // `node scripts/make-map-style.mjs`.
  dark: '/map-dark.json',
  // Voyager rather than Positron for daytime: cream land (#fbf8f3) and muted
  // teal water instead of Positron's clinical grey-on-white, which read cold
  // and flat under a warm accent colour. Forked only to move the tiles.
  light: '/map-light.json',
}

/* The map's credit, cut to the one thing a licence puts on the map itself:
   the ODbL (per the OSMF attribution guidelines) wants "© OpenStreetMap"
   readable with no interaction. So that is all this is — inert text, nothing
   to tap, no link to mis-hit. The CC-BY credits (CARTO's cartography, the
   OpenMapTiles schema) allow "any reasonable manner", which /credits.html
   behind the More-tools menu is. Hand-rolled rather than MapLibre's
   AttributionControl so it stays this small, and so it still renders offline,
   where the TileJSON that would declare it never loads. */
const creditControl = (): IControl => {
  let el: HTMLDivElement
  return {
    onAdd() {
      el = document.createElement('div')
      el.className = 'maplibregl-ctrl map-credit'
      el.textContent = '© OpenStreetMap'
      return el
    },
    onRemove() {
      el.remove()
    },
  }
}

const linesOf = (lines: Coordinates[][]): FeatureCollection<LineString> => ({
  type: 'FeatureCollection',
  features: lines.map(c => ({
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: c },
  })),
})

export { ACCENT, ACCENT_BRIGHT, creditControl, STYLE, linesOf }
