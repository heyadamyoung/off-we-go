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
 * the real airport. And enough of a floor plan for the walk on the day of the
 * flight: the check-in desks on the ground floor, the security filter beyond
 * them, the stairs up, and the pier the gates are on.
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
  { ref: 'E19', lon: 4.7652, lat: 52.3109 },
  { ref: 'F5', lon: 4.7661, lat: 52.3113 },
  { ref: 'G9', lon: 4.7672, lat: 52.312 },
]

/* The desk rows the board names by number, the way the sample flight's board
   names zone 3, desks 13–20. */
const DESKS = [
  { ref: '1-8', lon: 4.762, lat: 52.3091 },
  { ref: '9-12', lon: 4.7624, lat: 52.3094 },
  { ref: '13-20', lon: 4.7628, lat: 52.3098 },
  { ref: '21-30', lon: 4.7633, lat: 52.3101 },
]

const SECURITY = at(4.7638, 52.31)
const STAIRS = [at(4.7641, 52.3101), at(4.7642, 52.3102)]

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
  ...DESKS.map((desk, index) => ({
    type: 'node',
    id: 300 + index,
    lon: desk.lon,
    lat: desk.lat,
    tags: { aeroway: 'checkin', ref: desk.ref, level: '0' },
  })),
  { type: 'node', id: 400, ...SECURITY, tags: { aeroway: 'security_check', level: '0' } },
  // The ground floor's walkway: past the desks to security and the stairs.
  {
    type: 'way',
    id: 500,
    tags: { highway: 'footway', level: '0' },
    geometry: [
      at(4.7612, 52.3093),
      ...DESKS.map(desk => at(desk.lon, desk.lat)),
      SECURITY,
      STAIRS[0],
    ],
  },
  { type: 'way', id: 501, tags: { highway: 'steps', level: '0;2' }, geometry: STAIRS },
  // The pier, upstairs: the E, F and G gates one way, the D gates the other.
  {
    type: 'way',
    id: 502,
    tags: { highway: 'footway', level: '2' },
    geometry: [STAIRS[1], ...GATES.slice(2).map(gate => at(gate.lon, gate.lat))],
  },
  {
    type: 'way',
    id: 503,
    tags: { highway: 'footway', level: '2' },
    geometry: [STAIRS[1], at(4.764, 52.3102), at(4.7633, 52.3099), at(4.7625, 52.3095)],
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
