/* Fork CARTO's dark-matter basemap style into Off We Go's own night map.

   Stock dark-matter is the Bootstrap of dark maps, and the map is most of this
   app's pixels — so the ground becomes our black, the roads come up a step so
   the amber trail has streets to live in, the POI noise goes quiet, and the
   labels sit in our greys.

   The design is CARTO's dark-matter, which is CC-BY 4.0 — so the paint is
   theirs and ours, and the credit in the corner names them. The tiles, glyphs
   and sprites are OpenFreeMap's: same OpenMapTiles schema, so every layer
   below still finds its data, and unlike CARTO's service their terms allow the
   caching and bulk download that an offline map is made of.

   Regenerate after palette changes: `node scripts/make-map-style.mjs`
   Writes public/map-dark.json, which map-style.ts points the dark theme at. */
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const UPSTREAM = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
const TILES_HOST = 'tiles.openfreemap.org'
const SCHEME = 'offwego://'

/* CARTO paints in Montserrat, which OpenFreeMap does not carry. Noto at the
   matching weight is the closest face they serve. */
const FONT = {
  'Montserrat Medium': 'Noto Sans Bold',
  'Montserrat Regular': 'Noto Sans Regular',
  'Montserrat Regular Italic': 'Noto Sans Italic',
  'Montserrat Medium Italic': 'Noto Sans Italic',
}
const DAY_UPSTREAM = 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json'
const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const out = join(publicDir, 'map-dark.json')
const dayOut = join(publicDir, 'map-light.json')

const GROUND = '#0B0D11'
const LAND = '#0E1218'
const PARK = '#0D141A'
const WATER = '#0A1119'
const WATERWAY = '#122130'
const BUILDING = '#10141B'
const BUILDING_TOP = '#12161E'
const CASE = '#080A0E'

/* The road ladder: every class one legible step above the ground, minor roads
   quietest, motorways strongest — enough hierarchy to read a city, never
   enough to compete with the trail. */
const ROADS = [
  [/^(road|tunnel|bridge)_service_fill/, '#151A22'],
  [/^(road|tunnel|bridge)_minor_fill/, '#1B212C'],
  [/^(road|tunnel|bridge)_sec_(fill|case_noramp)$/, '#232A37'],
  [/^(road|tunnel|bridge)_pri_fill/, '#2A3341'],
  [/^(road|tunnel|bridge)_trunk_fill/, '#303A48'],
  [/^(road|tunnel|bridge)_mot_fill/, '#35404F'],
  [/^(road|tunnel|bridge)_path$/, '#141A22'],
]

const paint = (layer, key, value) => {
  layer.paint = { ...(layer.paint || {}), [key]: value }
}
const hide = layer => {
  layer.layout = { ...(layer.layout || {}), visibility: 'none' }
}

const response = await fetch(UPSTREAM)
if (!response.ok) throw new Error(`CARTO answered ${response.status} for the upstream style`)
const style = await response.json()

style.name = 'Off We Go Night'
style.metadata = {
  ...(style.metadata || {}),
  'offwego:derived-from': UPSTREAM,
  'offwego:note':
    "CARTO dark-matter (CC-BY 4.0), repainted, on OpenFreeMap's tiles. Regenerate with scripts/make-map-style.mjs.",
}

for (const layer of style.layers) {
  const id = layer.id
  if (id === 'background') {
    paint(layer, 'background-color', GROUND)
    continue
  }
  if (id === 'landcover' || id.startsWith('landuse')) {
    paint(layer, 'fill-color', LAND)
    continue
  }
  if (id.startsWith('park')) {
    paint(layer, 'fill-color', PARK)
    continue
  }
  if (id === 'water' || id === 'water_shadow') {
    paint(layer, 'fill-color', WATER)
    continue
  }
  if (id === 'waterway') {
    paint(layer, 'line-color', WATERWAY)
    continue
  }
  if (id === 'building') {
    paint(layer, 'fill-color', BUILDING)
    continue
  }
  if (id === 'building-top') {
    paint(layer, 'fill-color', BUILDING_TOP)
    continue
  }
  if (id.startsWith('boundary')) {
    paint(layer, 'line-color', id.includes('country') ? '#2A3444' : '#202836')
    continue
  }
  if (id.startsWith('aeroway')) {
    paint(layer, 'line-color', '#161B23')
    continue
  }
  if (id === 'rail' || id === 'tunnel_rail') {
    paint(layer, 'line-color', '#171D26')
    continue
  }
  if (id.endsWith('rail_dash')) {
    paint(layer, 'line-color', '#232B38')
    continue
  }
  if (/^(road|tunnel|bridge)_.*case/.test(id) && !/sec_case_noramp/.test(id)) {
    paint(layer, 'line-color', CASE)
    continue
  }
  const road = ROADS.find(([match]) => match.test(id))
  if (road) {
    paint(layer, 'line-color', road[1])
    continue
  }
  if (id === 'housenumber' || id.startsWith('poi_')) {
    hide(layer)
    continue
  }
  if (id.startsWith('roadname')) {
    paint(layer, 'text-color', '#4C5665')
    paint(layer, 'text-halo-color', GROUND)
    continue
  }
  if (id.startsWith('watername') || id === 'waterway_label') {
    paint(layer, 'text-color', '#31465C')
    paint(layer, 'text-halo-color', GROUND)
    continue
  }
  if (id.startsWith('place_')) {
    const big = /city|town/.test(id)
    const wide = /state|country|continent/.test(id)
    paint(layer, 'text-color', big ? '#8A93A3' : wide ? '#6A7482' : '#5F6875')
    paint(layer, 'text-halo-color', GROUND)
  }
}

/* Off CARTO's tile service and onto OpenFreeMap's, which serves the same
   OpenMapTiles schema. Their glyph server answers for one face at a time
   rather than compositing a stack, so each text-font keeps only its first, and
   their sprite sheet is not CARTO's — so the icon-bearing POI layers go, which
   is where we were taking them anyway. */
const onOpenFreeMap = style => {
  /* Under our own scheme rather than https, so every basemap request passes
     through the offline store on its way out — see offline-tiles-core.ts. The
     sprite stays on https: it is one small sheet, and MapLibre decodes sprite
     images itself rather than through a protocol handler. */
  style.sources = { openmaptiles: { type: 'vector', url: `${SCHEME}${TILES_HOST}/planet` } }
  style.glyphs = `${SCHEME}${TILES_HOST}/fonts/{fontstack}/{range}.pbf`
  style.sprite = `https://${TILES_HOST}/sprites/ofm_f384/ofm`
  style.layers = style.layers.filter(layer => !/^(poi|housenumber)/.test(layer.id))
  for (const layer of style.layers) {
    if (layer.source) layer.source = 'openmaptiles'
    const stack = layer.layout?.['text-font']
    if (stack) layer.layout['text-font'] = [FONT[stack[0]] || 'Noto Sans Regular']
  }
  return style
}

await writeFile(out, JSON.stringify(onOpenFreeMap(style)))
console.log(`wrote ${out} (${style.layers.length} layers)`)

/* Daytime is CARTO's Voyager, kept as they drew it — cream land and muted teal
   water, rather than Positron's clinical grey-on-white, which reads cold under
   a warm accent. Only the tiles underneath it change. */
const dayResponse = await fetch(DAY_UPSTREAM)
if (!dayResponse.ok) throw new Error(`CARTO answered ${dayResponse.status} for the day style`)
const day = await dayResponse.json()
day.name = 'Off We Go Day'
day.metadata = {
  ...(day.metadata || {}),
  'offwego:derived-from': DAY_UPSTREAM,
  'offwego:note': "CARTO Voyager (CC-BY 4.0), unrepainted, on OpenFreeMap's tiles.",
}
await writeFile(dayOut, JSON.stringify(onOpenFreeMap(day)))
console.log(`wrote ${dayOut} (${day.layers.length} layers)`)
