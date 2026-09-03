import { AttributionControl } from 'maplibre-gl'
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

/* The credit both the data and the design require. The tile source names
   OpenFreeMap, OpenMapTiles and OpenStreetMap itself; CARTO is named here
   because the cartography is theirs, reused under CC-BY 4.0 — the paint, not
   the data. Compacts itself on a narrow map. */
const creditControl = () =>
  new AttributionControl({
    customAttribution: '<a href="https://carto.com/" target="_blank">CARTO</a>',
  })

const linesOf = (lines: Coordinates[][]): FeatureCollection<LineString> => ({
  type: 'FeatureCollection',
  features: lines.map(c => ({
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: c },
  })),
})

export { ACCENT, ACCENT_BRIGHT, creditControl, STYLE, linesOf }
