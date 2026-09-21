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
/* The furthest away each kind may ever be drawn from — places/rank.js
   EARLIEST_ZOOM, kept in step by the test beside this file, which reads both
   tables and fails when they part.
   The server's other rule, the budget of marks a square may carry, is
   deliberately not copied here. Twenty-two places in one city never fill a
   square, so it would never bind — and a number copied into a file nobody
   re-reads is a number that drifts. Density alone put a café on the map from
   across Amsterdam once, because the algorithm was right that there was room;
   room is not the only question, which is what this table answers. */
const SAMPLE_EARLIEST: Record<string, number> = {
  sights: 11,
  viewpoint: 11,
  museum: 11,
  historic: 11,
  gallery: 11,
  nature: 11,
  beach: 11,
  entertainment: 11,
  religious: 11,
  market: 11,
  transit: 11,
  sport: 12,
  lodging: 13,
  food: 14,
  cafe: 14,
  bar: 14,
  shopping: 14,
  services: 16,
  health: 16,
  other: 16,
}

/* The zoom each of these is drawn from, which is one lookup per place.
 *
 * places/rank.js EARLIEST_ZOOM is the rule and SAMPLE_EARLIEST below is this
 * file's copy of it, held to the original by the test beside this file.
 *
 * It used to rank them against each other — best two dozen per square earn
 * this zoom, the rest fall through — and this file is where that was learned
 * to be wrong. Twenty-two places do not fill a square, so density alone put
 * Winkel 43, a cafe, on the map beside the Rijksmuseum from across the city.
 * The algorithm was right that there was room. Room was never the question:
 * a cafe does not become a landmark by being unopposed, and a museum does not
 * stop being one by standing next to four others. The kind decides, the
 * crowd does not, and crowding is settled at render time by the map's own
 * label collision — see use-attraction-layers.ts symbol-sort-key.
 */
function zoomsFor(places: { category: string }[]) {
  return places.map(place => SAMPLE_EARLIEST[place.category] ?? SAMPLE_EARLIEST.other)
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
  { headline = false } = {},
): AttractionPoi[] {
  /* No slice. The real route has no limit either — what a viewport shows is
     decided by the zoom a place earned and nothing else — and a demo that
     cut at a number would be a demo of a different thing. Twenty-two pins. */
  return SAMPLE_PINS.filter(
    pin =>
      pin.lng >= box.west &&
      pin.lng <= box.east &&
      pin.lat >= box.south &&
      pin.lat <= box.north &&
      (!headline || pin.big),
  ).sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name))
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
