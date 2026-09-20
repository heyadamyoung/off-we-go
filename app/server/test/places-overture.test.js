import assert from 'node:assert/strict'
import test from 'node:test'
import {
  COLUMNS,
  OSM_LICENSE,
  OVERTURE_LICENSE,
  licensesFor,
  placeFromOverture,
  placesFromOverture,
  upstreamIds,
} from '../src/places/overture.js'

/* An Overture row in our shape.

   This is the only place that knows what a Parquet row looks like, so what it
   drops is dropped for good. What these pin: the whole documented shape of a
   place, field by field, from a row of the sort the reader actually hands
   over; that a row we cannot use is null and counted rather than half-built;
   that the licence trail is decided per record from the datasets behind it;
   that alternate names are gathered from both shapes `common` arrives in,
   because a reader that handles one silently loses every name in the other;
   and that `hours` is null, because Overture publishes none and an unfillable
   field stays unfilled. */

const release = { version: '2026-08-19.0' }

/** A row of the shape places/parquet.js hands over, with the columns we read. */
const overtureRow = (overrides = {}) => ({
  id: '08f196d0a1b2c3d4',
  names: {
    primary: 'Rijksmuseum',
    common: { nl: 'Rijksmuseum', en: 'Rijks Museum', fr: 'Musée national' },
    rules: [
      { variant: 'alternate', value: 'Het Rijks' },
      { variant: 'short', value: '   ' },
    ],
  },
  categories: { primary: 'museum', alternate: ['art_museum'] },
  basic_category: 'arts_and_entertainment',
  confidence: 0.93,
  websites: ['https://www.rijksmuseum.nl'],
  phones: ['+31 20 674 7000'],
  addresses: [
    {
      freeform: 'Museumstraat 1',
      locality: 'Amsterdam',
      region: 'NH',
      postcode: '1071 XX',
      country: 'NL',
    },
  ],
  sources: [
    { property: '', dataset: 'OpenStreetMap', record_id: 'w/12345', update_time: '2026-05-01' },
    { property: '', dataset: 'meta', record_id: 'abc', update_time: '2026-05-01' },
  ],
  operating_status: 'open',
  bbox: { xmin: 4.8852, xmax: 4.8852, ymin: 52.36, ymax: 52.36 },
  ...overrides,
})

test('the columns we read, and no more', () => {
  assert.deepEqual(COLUMNS, [
    'id',
    'names',
    'categories',
    'basic_category',
    'confidence',
    'websites',
    'phones',
    'addresses',
    'sources',
    'operating_status',
    'bbox',
  ])
  assert.equal(Object.isFrozen(COLUMNS), true)
  for (const dropped of ['ratings', 'review_count', 'photos', 'brand']) {
    assert.equal(COLUMNS.includes(dropped), false, `${dropped} is deliberately not read`)
  }
})

test('a realistic row becomes the documented shape', () => {
  assert.deepEqual(placeFromOverture(overtureRow(), release), {
    source: 'overture',
    upstreamId: '08f196d0a1b2c3d4',
    gersId: '08f196d0a1b2c3d4',
    name: 'Rijksmuseum',
    alternateNames: ['Het Rijks', 'Musée national', 'Rijks Museum'],
    lng: 4.8852,
    lat: 52.36,
    cell: 'N52E004',
    category: 'museum',
    categoryRaw: 'museum',
    address: {
      freeform: 'Museumstraat 1',
      locality: 'Amsterdam',
      region: 'NH',
      postcode: '1071 XX',
      country: 'NL',
    },
    website: 'https://www.rijksmuseum.nl',
    phone: '+31 20 674 7000',
    hours: null,
    operating: 'open',
    confidence: 0.93,
    licenses: ['CDLA-Permissive-2.0', 'ODbL-1.0'],
    upstreamIds: ['OpenStreetMap:w/12345', 'meta:abc'],
    version: '2026-08-19.0',
  })
})

test('the cell is computed from the position the row carries', () => {
  assert.equal(placeFromOverture(overtureRow(), release).cell, 'N52E004')
  const sydney = overtureRow({
    bbox: { xmin: 151.2153, xmax: 151.2153, ymin: -33.8568, ymax: -33.8568 },
  })
  const place = placeFromOverture(sydney, release)
  assert.equal(place.lng, 151.2153)
  assert.equal(place.lat, -33.8568)
  assert.equal(place.cell, 'S34E151')
  /* The position is the bbox's own corner, not a midpoint invented here. */
  const wide = overtureRow({ bbox: { xmin: 4.88, xmax: 4.9, ymin: 52.36, ymax: 52.4 } })
  assert.equal(placeFromOverture(wide, release).lng, 4.88)
  assert.equal(placeFromOverture(wide, release).lat, 52.36)
})

test('hours is null, because Overture publishes none', () => {
  assert.equal(placeFromOverture(overtureRow(), release).hours, null)
  /* Not even when a row turns up carrying something that looks like them: the
     field is unfillable from this source and stays unfilled. */
  const noisy = overtureRow({ hours: [{ mon: '09:00-17:00' }], opening_hours: 'Mo-Su 09:00-17:00' })
  assert.equal(placeFromOverture(noisy, release).hours, null)
})

test('confidence is clamped into 0..1 whatever the row says', () => {
  assert.equal(placeFromOverture(overtureRow({ confidence: 0.93 }), release).confidence, 0.93)
  assert.equal(placeFromOverture(overtureRow({ confidence: 1.4 }), release).confidence, 1)
  assert.equal(placeFromOverture(overtureRow({ confidence: -0.2 }), release).confidence, 0)
  assert.equal(placeFromOverture(overtureRow({ confidence: 1 }), release).confidence, 1)
  assert.equal(placeFromOverture(overtureRow({ confidence: 0 }), release).confidence, 0)
  assert.equal(placeFromOverture(overtureRow({ confidence: null }), release).confidence, 0)
  assert.equal(placeFromOverture(overtureRow({ confidence: undefined }), release).confidence, 0)
})

test('a row without a name or a position is not a place', () => {
  assert.equal(placeFromOverture(overtureRow({ names: null }), release), null)
  assert.equal(placeFromOverture(overtureRow({ names: { primary: null } }), release), null)
  assert.equal(placeFromOverture(overtureRow({ names: { primary: '   ' } }), release), null)
  assert.equal(placeFromOverture(overtureRow({ names: { primary: 42 } }), release), null)
  assert.equal(placeFromOverture(overtureRow({ bbox: null }), release), null)
  assert.equal(placeFromOverture(overtureRow({ bbox: {} }), release), null)
  assert.equal(placeFromOverture(overtureRow({ bbox: { xmin: 4.88 } }), release), null)
  assert.equal(
    placeFromOverture(overtureRow({ bbox: { xmin: Number.NaN, ymin: 52.36 } }), release),
    null,
  )
  assert.equal(
    placeFromOverture(
      overtureRow({ bbox: { xmin: Number.POSITIVE_INFINITY, ymin: 52.36 } }),
      release,
    ),
    null,
  )
  assert.equal(placeFromOverture(null, release), null)
  assert.equal(placeFromOverture(undefined, release), null)
  /* Zero is a position: the prime meridian is not missing data. */
  const nullIsland = placeFromOverture(overtureRow({ bbox: { xmin: 0, ymin: 0 } }), release)
  assert.equal(nullIsland.cell, 'N00E000')
})

test('a page counts what it could not use rather than dropping it quietly', () => {
  const { places, skipped } = placesFromOverture(
    [
      overtureRow(),
      overtureRow({ names: null }),
      overtureRow({ bbox: {} }),
      null,
      overtureRow({ id: 'second', names: { primary: 'Van Gogh Museum' } }),
    ],
    release,
  )
  assert.equal(places.length, 2)
  assert.equal(skipped, 3)
  assert.deepEqual(
    places.map(place => place.name),
    ['Rijksmuseum', 'Van Gogh Museum'],
  )
  assert.deepEqual(placesFromOverture([], release), { places: [], skipped: 0 })
  assert.deepEqual(placesFromOverture(null, release), { places: [], skipped: 0 })
})

test('a release that does not say which release it is says so', () => {
  assert.equal(placeFromOverture(overtureRow(), release).version, '2026-08-19.0')
  assert.equal(placeFromOverture(overtureRow(), {}).version, 'unknown')
  assert.equal(placeFromOverture(overtureRow(), undefined).version, 'unknown')
})

test('ODbL is added when a source dataset mentions OpenStreetMap, and not otherwise', () => {
  assert.equal(OVERTURE_LICENSE, 'CDLA-Permissive-2.0')
  assert.equal(OSM_LICENSE, 'ODbL-1.0')
  assert.deepEqual(licensesFor([{ dataset: 'meta' }]), ['CDLA-Permissive-2.0'])
  assert.deepEqual(licensesFor([{ dataset: 'msft' }, { dataset: 'Foursquare' }]), [
    'CDLA-Permissive-2.0',
  ])
  assert.deepEqual(licensesFor([{ dataset: 'OpenStreetMap' }]), ['CDLA-Permissive-2.0', 'ODbL-1.0'])
  assert.deepEqual(licensesFor([{ dataset: 'openstreetmap' }]), ['CDLA-Permissive-2.0', 'ODbL-1.0'])
  assert.deepEqual(licensesFor([{ dataset: 'OSM' }]), ['CDLA-Permissive-2.0', 'ODbL-1.0'])
  /* One OSM source among several is enough to oblige the attribution, and it
     is said once. */
  assert.deepEqual(
    licensesFor([{ dataset: 'meta' }, { dataset: 'OpenStreetMap' }, { dataset: 'OpenStreetMap' }]),
    ['CDLA-Permissive-2.0', 'ODbL-1.0'],
  )
  /* Overture's own licence applies even to a record with no sources listed. */
  assert.deepEqual(licensesFor([]), ['CDLA-Permissive-2.0'])
  assert.deepEqual(licensesFor(null), ['CDLA-Permissive-2.0'])
  assert.deepEqual(licensesFor([{}, { dataset: null }]), ['CDLA-Permissive-2.0'])
  assert.deepEqual(
    placeFromOverture(overtureRow({ sources: [{ dataset: 'meta' }] }), release).licenses,
    ['CDLA-Permissive-2.0'],
  )
})

test('the upstream ids are deduplicated and sorted', () => {
  assert.deepEqual(
    upstreamIds([
      { dataset: 'meta', record_id: '2' },
      { dataset: 'OpenStreetMap', record_id: 'w/1' },
      { dataset: 'meta', record_id: '2' },
      { dataset: 'meta', record_id: '1' },
    ]),
    ['OpenStreetMap:w/1', 'meta:1', 'meta:2'],
  )
  /* A source that names only half of a pair identifies nothing. */
  assert.deepEqual(upstreamIds([{ dataset: 'meta' }, { record_id: '9' }, {}]), [])
  assert.deepEqual(upstreamIds([{ dataset: '  ', record_id: '  ' }]), [])
  assert.deepEqual(upstreamIds([]), [])
  assert.deepEqual(upstreamIds(null), [])
  /* A row whose sources are not a list at all still produces a place. */
  const odd = placeFromOverture(overtureRow({ sources: 'not a list' }), release)
  assert.deepEqual(odd.upstreamIds, [])
  assert.deepEqual(odd.licenses, ['CDLA-Permissive-2.0'])
})

test('alternate names are gathered whichever shape `common` arrives in', () => {
  /* hyparquet gives a map back as an object or as a list of {key, value}
     depending on the writer, and a reader that handles one silently loses
     every name in the other. */
  const asObject = placeFromOverture(overtureRow(), release)
  const asList = placeFromOverture(
    overtureRow({
      names: {
        primary: 'Rijksmuseum',
        common: [
          { key: 'nl', value: 'Rijksmuseum' },
          { key: 'en', value: 'Rijks Museum' },
          { key: 'fr', value: 'Musée national' },
        ],
        rules: [{ variant: 'alternate', value: 'Het Rijks' }],
      },
    }),
    release,
  )
  assert.deepEqual(asObject.alternateNames, ['Het Rijks', 'Musée national', 'Rijks Museum'])
  assert.deepEqual(asList.alternateNames, asObject.alternateNames)

  /* The primary is never repeated among them, whichever shape carried it, and
     blanks are not names. */
  assert.equal(asObject.alternateNames.includes('Rijksmuseum'), false)
  assert.equal(asList.alternateNames.includes('Rijksmuseum'), false)
  assert.equal(asObject.alternateNames.includes('   '), false)

  /* Sorted, so two ingests of the same row produce the same array. */
  const shuffled = placeFromOverture(
    overtureRow({
      names: {
        primary: 'Rijksmuseum',
        common: { fr: 'Musée national', en: 'Rijks Museum' },
        rules: [{ variant: 'alternate', value: 'Het Rijks' }],
      },
    }),
    release,
  )
  assert.deepEqual(shuffled.alternateNames, ['Het Rijks', 'Musée national', 'Rijks Museum'])

  const bare = placeFromOverture(overtureRow({ names: { primary: 'Rijksmuseum' } }), release)
  assert.deepEqual(bare.alternateNames, [])
  const empty = placeFromOverture(
    overtureRow({ names: { primary: 'Rijksmuseum', common: {}, rules: [] } }),
    release,
  )
  assert.deepEqual(empty.alternateNames, [])
})

test('an address is null rather than a shape full of nulls', () => {
  assert.equal(placeFromOverture(overtureRow({ addresses: [] }), release).address, null)
  assert.equal(placeFromOverture(overtureRow({ addresses: null }), release).address, null)
  assert.equal(
    placeFromOverture(
      overtureRow({
        addresses: [
          { freeform: null, locality: null, region: null, postcode: null, country: null },
        ],
      }),
      release,
    ).address,
    null,
  )
  /* One filled field is an address; the rest stay null rather than absent, so
     the JSON column has one shape. */
  assert.deepEqual(
    placeFromOverture(overtureRow({ addresses: [{ locality: 'Amsterdam' }] }), release).address,
    { freeform: null, locality: 'Amsterdam', region: null, postcode: null, country: null },
  )
  /* The first address is the one we keep. */
  assert.equal(
    placeFromOverture(
      overtureRow({ addresses: [{ locality: 'Amsterdam' }, { locality: 'Haarlem' }] }),
      release,
    ).address.locality,
    'Amsterdam',
  )
})

test('the category comes from the pair, and the raw value is kept beside it', () => {
  const place = placeFromOverture(overtureRow(), release)
  assert.equal(place.category, 'museum')
  assert.equal(place.categoryRaw, 'museum')

  const cafe = placeFromOverture(
    overtureRow({ categories: { primary: 'coffee_shop' }, basic_category: 'coffee_shop' }),
    release,
  )
  assert.equal(cafe.category, 'cafe')
  assert.equal(cafe.categoryRaw, 'coffee_shop')

  /* The leaf is preferred as the raw value; the coarse one stands in when
     there is no leaf; and with neither, a place is still a place. */
  const coarseOnly = placeFromOverture(
    overtureRow({ categories: null, basic_category: 'hotel' }),
    release,
  )
  assert.equal(coarseOnly.category, 'lodging')
  assert.equal(coarseOnly.categoryRaw, 'hotel')

  const uncategorised = placeFromOverture(
    overtureRow({ categories: null, basic_category: null }),
    release,
  )
  assert.equal(uncategorised.category, 'other')
  assert.equal(uncategorised.categoryRaw, null)
})

test('a blank website, phone or operating status is null, not an empty string', () => {
  const place = placeFromOverture(
    overtureRow({ websites: ['   '], phones: [], operating_status: '' }),
    release,
  )
  assert.equal(place.website, null)
  assert.equal(place.phone, null)
  assert.equal(place.operating, null)
  /* The first of each list is the one we keep. */
  const several = placeFromOverture(
    overtureRow({ websites: ['https://a.example', 'https://b.example'], phones: ['+1', '+2'] }),
    release,
  )
  assert.equal(several.website, 'https://a.example')
  assert.equal(several.phone, '+1')
  /* And an id that is missing is null, not the string "undefined". */
  const anonymous = placeFromOverture(overtureRow({ id: null }), release)
  assert.equal(anonymous.upstreamId, null)
  assert.equal(anonymous.gersId, null)
})
