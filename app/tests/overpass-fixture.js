/* Schiphol, as Overpass would answer it.
 *
 * The gates test used to query the real Overpass API — a free public good with
 * no funding, four mirrors deep in this app precisely because any one of them
 * may be down, slow or refusing. Asking it during a test suite is both unkind
 * and unreliable: it fails here every run, and on any machine without the open
 * internet.
 *
 * A terminal, its concourse and a handful of gates, in the element shape
 * airport-indoor-core reads. Real coordinates, so what the map draws sits over
 * the real airport.
 */

const at = (lon, lat) => ({ lon, lat })

/* A small ring around a point, in the winding Overpass returns geometry with.
   Big enough to be a polygon, small enough to sit inside the terminal. */
const ring = (lon, lat, size = 0.0006) => [
  at(lon - size, lat - size),
  at(lon + size, lat - size),
  at(lon + size, lat + size),
  at(lon - size, lat + size),
  at(lon - size, lat - size),
]

const GATES = [
  { ref: 'D4', lon: 4.7625, lat: 52.3095 },
  { ref: 'D6', lon: 4.7633, lat: 52.3099 },
  { ref: 'E18', lon: 4.7648, lat: 52.3107 },
  { ref: 'F5', lon: 4.7661, lat: 52.3113 },
  { ref: 'G9', lon: 4.7672, lat: 52.312 },
]

const ELEMENTS = [
  {
    type: 'way',
    id: 1,
    tags: { aeroway: 'terminal', name: 'Schiphol Terminal', building: 'yes' },
    geometry: ring(4.7639, 52.3105, 0.004),
  },
  ...GATES.map((gate, index) => ({
    type: 'node',
    id: 100 + index,
    lon: gate.lon,
    lat: gate.lat,
    tags: { aeroway: 'gate', ref: gate.ref, level: '2' },
  })),
  /* One gate drawn as an area rather than a point, because Schiphol has both
     and the reader has to cope with either. */
  {
    type: 'way',
    id: 200,
    tags: { aeroway: 'gate', ref: 'D8', level: '2' },
    geometry: ring(4.764, 52.3102),
  },
]

/** Answer every Overpass mirror in this page from the fixture above. */
export async function serveOverpass(page) {
  for (const mirror of [
    'https://overpass-api.de/**',
    'https://overpass.kumi.systems/**',
    'https://overpass.private.coffee/**',
    'https://maps.mail.ru/**',
  ]) {
    await page.route(mirror, route =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ version: 0.6, elements: ELEMENTS }),
      }),
    )
  }
}
