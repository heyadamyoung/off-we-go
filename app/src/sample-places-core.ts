import type { Place } from './places-core'
import type { AttractionPoi } from './shared/model/types'

/* The sample trip's pins.
 *
 * The demo has no server, so the places layer cannot answer it — and before
 * this the map filled itself by walking Wikipedia from the browser, which is
 * the thing the places layer exists to stop doing. A canned set instead, the
 * way every other part of the sample trip is canned: the same twenty
 * categories, the same shape the server sends, so the map draws the demo and
 * the real thing through one code path.
 *
 * Amsterdam, because that is where the sample trip goes. Real places at real
 * coordinates, and the categories are the ones the server would give them.
 */
/* How sight-like each kind is — the same ordering places/rank.js ranks by,
   and the only part of the server's taxonomy the demo needs. There is no
   table of zooms here because there is no table of zooms anywhere any more:
   a mark earns its zoom from where it comes among its neighbours, and the
   twenty-two below run through that same rule rather than through a copy of
   a table that would drift the moment the real one changed. */
const SAMPLE_WEIGHT: Record<string, number> = {
  sights: 1,
  viewpoint: 1,
  museum: 0.95,
  historic: 0.9,
  gallery: 0.9,
  nature: 0.85,
  beach: 0.85,
  entertainment: 0.7,
  religious: 0.65,
  market: 0.65,
  food: 0.6,
  cafe: 0.55,
  bar: 0.5,
  lodging: 0.35,
  shopping: 0.35,
  sport: 0.3,
  transit: 0.3,
  services: 0.15,
  health: 0.15,
  other: 0.1,
}

/* The zooms the server thins at, and the one it does not. Kept in step with
   places/rank.js LABEL_ZOOMS and LABEL_PER_TILE by the test beside this file,
   which reads both and fails when they part. */
const SAMPLE_ZOOMS = { from: 11, to: 16, floor: 17 }
const SAMPLE_PER_TILE = 24

/** Which slippy square a point is in — the server's tileX and tileY. */
const squareOf = (lng: number, lat: number, z: number) => {
  const side = 2 ** z
  const x = Math.floor(((lng + 180) / 360) * side)
  const radians = (lat * Math.PI) / 180
  const y = Math.floor(
    ((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) * side,
  )
  return `${z}/${x}/${y}`
}

/**
 * The zoom each of these earns among the others, by the server's rule.
 *
 * Twenty-two places in one city will not fill a square, so in practice they
 * all land on the first zoom — which is the right answer and is arrived at
 * rather than asserted. The point of running the rule instead of copying a
 * table is that the demo cannot quietly start behaving differently from the
 * app it demonstrates.
 */
function zoomsFor(places: { lng: number; lat: number; category: string; confidence: number }[]) {
  const worth = (place: { category: string; confidence: number }) =>
    (SAMPLE_WEIGHT[place.category] ?? SAMPLE_WEIGHT.other) *
    (0.4 + 0.6 * Math.min(1, Math.max(0, place.confidence)))
  const order = places
    .map((place, at) => ({ at, place, worth: worth(place) }))
    .sort((left, right) => right.worth - left.worth || left.at - right.at)
  const earned = new Map<number, number>()
  for (let z = SAMPLE_ZOOMS.from; z <= SAMPLE_ZOOMS.to; z += 1) {
    const taken = new Map<string, number>()
    for (const { at, place } of order) {
      if (earned.has(at)) continue
      const square = squareOf(place.lng, place.lat, z)
      const already = taken.get(square) ?? 0
      if (already >= SAMPLE_PER_TILE) continue
      taken.set(square, already + 1)
      earned.set(at, z)
    }
  }
  return places.map((_, at) => earned.get(at) ?? SAMPLE_ZOOMS.floor)
}

export const SAMPLE_PINS: AttractionPoi[] = [
  ['Rijksmuseum', 'museum', 4.8852, 52.36, 1],
  ['Van Gogh Museum', 'museum', 4.8811, 52.3584, 0.99],
  ['Anne Frank House', 'museum', 4.8839, 52.3752, 0.98],
  ['Stedelijk Museum', 'gallery', 4.8797, 52.358, 0.96],
  ['Moco Museum', 'museum', 4.8817, 52.3591, 0.93],
  ['Het Scheepvaartmuseum', 'museum', 4.9166, 52.3717, 0.94],
  ['NEMO Science Museum', 'museum', 4.9125, 52.3738, 0.95],
  ['Royal Palace of Amsterdam', 'historic', 4.8912, 52.3731, 0.97],
  ['Oude Kerk', 'religious', 4.8981, 52.3742, 0.92],
  ['Westerkerk', 'religious', 4.8837, 52.3747, 0.91],
  ['Vondelpark', 'nature', 4.8686, 52.3579, 0.95],
  ['Artis', 'nature', 4.9145, 52.3667, 0.93],
  ['Hortus Botanicus', 'nature', 4.9082, 52.366, 0.88],
  ['Concertgebouw', 'entertainment', 4.8792, 52.3562, 0.94],
  ['Heineken Experience', 'museum', 4.8918, 52.3577, 0.9],
  ["A'DAM Lookout", 'viewpoint', 4.9022, 52.3842, 0.9],
  ['Albert Cuyp Market', 'market', 4.8931, 52.3556, 0.89],
  ['Foodhallen', 'market', 4.8693, 52.3665, 0.85],
  ['Amsterdam Centraal', 'transit', 4.9003, 52.379, 0.99],
  ['Winkel 43', 'cafe', 4.8828, 52.3799, 0.82],
  ['Café Papeneiland', 'bar', 4.8843, 52.3811, 0.8],
  ['De Bijenkorf', 'shopping', 4.8918, 52.3729, 0.87],
].map(
  ([name, category, lng, lat, confidence]) =>
    ({
      id: `sample-${String(name)
        .toLowerCase()
        .replaceAll(/[^a-z0-9]+/g, '-')}`,
      name: String(name),
      category: String(category),
      lng: Number(lng),
      lat: Number(lat),
      confidence: Number(confidence),
      /* The same rule the server applies, stated once here: the named kinds
         survive a zoom out, the catch-all and the everyday ones do not. */
      big: !['cafe', 'bar', 'shopping', 'services', 'other', 'sights'].includes(String(category)),
      /* Filled in below, by the same rule the server applies: a mark earns
         its zoom from where it comes among its neighbours. */
      minzoom: 0,
      /* Ranked by the confidence above, which for canned data is the order
         they deserve on screen. */
      rank: Math.round(Number(confidence) * 1000),
    }) satisfies AttractionPoi,
)

/* And the zooms, worked out over the whole set rather than per place, because
   a place's zoom is a fact about its neighbours. Written back in place so the
   exported array is the finished shape a caller expects. */
for (const [at, zoom] of zoomsFor(SAMPLE_PINS).entries()) {
  SAMPLE_PINS[at].minzoom = zoom
}

/** The demo's own attribution line, naming the same sources a real answer
    would. The sample data is a handful of landmarks anybody could list, but
    the line is what the app shows in both modes and it should not appear
    only in one. */
export const SAMPLE_ATTRIBUTION = [
  {
    license: 'CDLA-Permissive-2.0',
    notice: '© Overture Maps Foundation',
    url: 'https://docs.overturemaps.org/attribution/',
  },
]

/** Which of them are inside a viewport, ordered the way the server orders
    them: the best first, so a small limit is the best few rather than an
    arbitrary few. */
export function samplePins(
  box: { west: number; south: number; east: number; north: number },
  { headline = false, limit = 300 } = {},
): AttractionPoi[] {
  return SAMPLE_PINS.filter(
    pin =>
      pin.lng >= box.west &&
      pin.lng <= box.east &&
      pin.lat >= box.south &&
      pin.lat <= box.north &&
      (!headline || pin.big),
  )
    .sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name))
    .slice(0, limit)
}

/** What the demo knows about where its pins are.
 *
 * Every one of them is in Amsterdam and in the Netherlands, which is true of
 * all twenty-two and is the whole of what is claimed here. No street lines:
 * the demo is not the place to guess at a house number, and a wrong address
 * on a card is worse than a card with no address on it — the real records
 * carry the street from upstream, and a blank here is the same blank a real
 * place with no address upstream would show. */
const SAMPLE_ADDRESS = Object.freeze({
  freeform: null,
  locality: 'Amsterdam',
  region: null,
  postcode: null,
  country: 'NL',
})

/** One sample pin as the record behind it, for the card a tap opens.
 *
 * The demo has no server, so `/api/places/:id` cannot answer it — and a card
 * that opens on a pin the map drew and then says nothing about it reads as
 * broken rather than as a demo. Same shape the API sends, so the card has one
 * code path for both. */
export function samplePlace(id: string): Place | null {
  const pin = SAMPLE_PINS.find(held => held.id === id)
  if (!pin) return null
  return {
    id: pin.id,
    name: pin.name,
    category: pin.category,
    lat: pin.lat,
    lng: pin.lng,
    address: { ...SAMPLE_ADDRESS },
    website: null,
    phone: null,
    hours: null,
    confidence: pin.confidence,
    sources: [{ source: 'overture', license: 'CDLA-Permissive-2.0' }],
    attribution: SAMPLE_ATTRIBUTION,
  }
}
