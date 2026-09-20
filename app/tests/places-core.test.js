import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addressLine,
  categoryLabel,
  categoryWord,
  confidenceBand,
  confidenceHint,
  coverageNote,
  creditsFor,
  groupByCategory,
  licenceNotice,
  placeSubtitle,
  PLACE_CATEGORIES,
} from '../src/places-core.ts'
import { placeFrom, placeListFrom } from '../src/places-wire.ts'

/* The presentation rules of the places layer, pinned here rather than checked
   by eye on a screen. Three of them are the ones that matter: a licence notice
   that appears once however many records demand it, a low-confidence record
   that is softened rather than hidden, and a half-answer that says so in
   words. */

const osm = { source: 'osm', license: 'ODbL-1.0', upstreamId: 'n1' }
const overture = { source: 'overture', license: 'CDLA-Permissive-2.0', upstreamId: 'o1' }
const fsq = { source: 'fsq', license: 'Apache-2.0', upstreamId: 'f1' }

const place = (fields = {}) => ({
  id: fields.id || 'p1',
  name: fields.name || 'Somewhere',
  category: fields.category || 'other',
  lat: 52.37,
  lng: 4.9,
  ...fields,
})

test('one notice per licence, however many records carry it', () => {
  const credits = creditsFor([
    place({ id: 'a', sources: [osm] }),
    place({ id: 'b', sources: [osm] }),
  ])
  assert.deepEqual(credits.notices, ['© OpenStreetMap contributors'])
  assert.equal(credits.line, '© OpenStreetMap contributors')
})

test('a permissive licence asks for no notice, and is still nameable', () => {
  const credits = creditsFor([place({ sources: [overture] }), place({ id: 'b', sources: [fsq] })])
  assert.deepEqual(credits.notices, [], 'CDLA-Permissive and Apache demand nothing on screen')
  assert.equal(credits.line, '')
  assert.deepEqual(credits.sources, ['Overture Maps Foundation', 'Foursquare'])
})

test('a mixed screen renders the notices its licences demand, once each', () => {
  const credits = creditsFor([
    place({ id: 'a', sources: [overture, osm] }),
    place({ id: 'b', sources: [overture] }),
    place({ id: 'c', sources: [osm, fsq] }),
  ])
  assert.deepEqual(credits.notices, ['© OpenStreetMap contributors'])
  assert.deepEqual(credits.sources, ['Overture Maps Foundation', 'OpenStreetMap', 'Foursquare'])
})

test('a licence nobody here has heard of is rendered rather than dropped', () => {
  /* The failure we can live with is an ugly line. The one we cannot is a
     record on screen with the attribution its licence asked for missing. */
  assert.equal(licenceNotice('CC-BY-SA-4.0'), 'Contains data licensed CC-BY-SA-4.0')
  assert.equal(licenceNotice('odbl-1.0'), '© OpenStreetMap contributors')
  assert.equal(licenceNotice('CDLA-Permissive-2.0'), null)
  assert.equal(licenceNotice(''), null)

  const credits = creditsFor([place({ sources: [{ source: 'x', license: 'Weird-1.0' }] })])
  assert.deepEqual(credits.notices, ['Contains data licensed Weird-1.0'])
})

test('notices the server sent are rendered, and deduplicated against our own', () => {
  const credits = creditsFor([
    place({ id: 'a', sources: [osm], attribution: ['© OpenStreetMap contributors'] }),
    place({ id: 'b', attribution: ['Photographs by the council'] }),
  ])
  assert.deepEqual(credits.notices, ['© OpenStreetMap contributors', 'Photographs by the council'])
})

test("the server's own notices arrive as objects, and are rendered from them", () => {
  /* What /api/places/* actually sends: {license, notice, url} per licence,
     already deduplicated per record. The screen still has to deduplicate
     across records, and has to read the words out of the object rather than
     stringify it — which is how "[object Object]" ends up under a search. */
  const credits = creditsFor([
    place({
      id: 'a',
      sources: [osm, overture],
      attribution: [
        { license: 'ODbL-1.0', notice: '© OpenStreetMap contributors', url: 'https://osm.org/c' },
        { license: 'CDLA-Permissive-2.0', notice: '© Overture Maps Foundation', url: null },
      ],
    }),
    place({
      id: 'b',
      sources: [overture],
      attribution: [{ license: 'CDLA-Permissive-2.0', notice: '© Overture Maps Foundation' }],
    }),
  ])
  assert.deepEqual(credits.notices, ['© OpenStreetMap contributors', '© Overture Maps Foundation'])
  assert.equal(credits.line, '© OpenStreetMap contributors · © Overture Maps Foundation')
})

test('a notice with no words in it is not a notice', () => {
  const credits = creditsFor([
    place({ attribution: [{ license: 'Weird-1.0', notice: null }, {}, ''] }),
  ])
  assert.deepEqual(credits.notices, [])
})

test('nothing on screen means nothing to say', () => {
  assert.deepEqual(creditsFor([]), { notices: [], sources: [], line: '' })
})

test('the confidence bands, at their boundaries', () => {
  assert.equal(confidenceBand(1), 'firm')
  assert.equal(confidenceBand(0.75), 'firm', '0.75 is firm')
  assert.equal(confidenceBand(0.7499), 'reported')
  assert.equal(confidenceBand(0.665), 'reported', "Overture's measured mean is ordinary")
  assert.equal(confidenceBand(0.5), 'reported', '0.5 is not yet rough')
  assert.equal(confidenceBand(0.4999), 'rough')
  assert.equal(confidenceBand(0), 'rough')
})

test('an unstated confidence is rough, never assumed firm', () => {
  assert.equal(confidenceBand(undefined), 'rough')
  assert.equal(confidenceBand(null), 'rough')
  assert.equal(confidenceBand(Number.NaN), 'rough')
})

test('low confidence is softened, not hidden', () => {
  /* The record is still on the list — the mean upstream confidence is 0.665,
     so a screen that hid the doubtful ones would hide most of the world. It
     is shown, and told what it is. */
  assert.equal(confidenceHint(0.42), 'Roughly located')
  assert.equal(confidenceHint(0.5), null)
  assert.equal(confidenceHint(0.9), null)
  assert.equal(confidenceHint(null), 'Roughly located')
})

test('nearby results group in the categories order, not in the order they arrived', () => {
  const groups = groupByCategory([
    place({ id: '1', category: 'cafe' }),
    place({ id: '2', category: 'museum' }),
    place({ id: '3', category: 'sights' }),
    place({ id: '4', category: 'cafe' }),
    place({ id: '5', category: 'nonsense' }),
  ])
  assert.deepEqual(
    groups.map(group => group.category),
    ['sights', 'museum', 'cafe', 'other'],
  )
  assert.deepEqual(
    groups.map(group => group.label),
    ['Sights', 'Museums', 'Cafés', 'Other places'],
  )
  assert.deepEqual(
    groups[2].places.map(item => item.id),
    ['1', '4'],
    "the server's ranking inside a group is left alone",
  )
  assert.deepEqual(
    groups[3].places.map(item => item.id),
    ['5'],
    'a category this build has never heard of lands in other, never vanishes',
  )
})

test('an empty category is not a heading over nothing', () => {
  assert.deepEqual(groupByCategory([]), [])
  const one = groupByCategory([place({ category: 'beach' })])
  assert.equal(one.length, 1)
  assert.equal(one[0].label, 'Beaches')
})

test('every category has both a heading and a word', () => {
  for (const category of PLACE_CATEGORIES) {
    assert.ok(categoryLabel(category), `${category} needs a heading`)
    assert.ok(categoryWord(category), `${category} needs a word`)
  }
  assert.equal(categoryLabel('not-a-category'), 'Other places')
  assert.equal(categoryWord('not-a-category'), 'Place')
})

test('a half-answer says so, in words, rather than spinning for ever', () => {
  assert.equal(
    coverageNote({ degraded: true, coverage: { cell: 'N52E004', status: 'pending' } }),
    'Still gathering places here — this is what we have so far.',
  )
  assert.equal(
    coverageNote({ degraded: true, coverage: { cell: 'N52E004', status: 'ingesting' } }),
    'Still gathering places here — this is what we have so far.',
  )
  assert.equal(
    coverageNote({ degraded: true, coverage: { cell: 'N52E004', status: 'failed' } }),
    'We could not finish gathering places here — this is what we already had.',
  )
  assert.equal(
    coverageNote({ degraded: true, coverage: { cell: 'N52E004', status: 'empty' } }),
    'Not much is mapped around here — this is everything we have.',
  )
  assert.equal(
    coverageNote({ degraded: true }),
    'Still gathering places here — this is what we have so far.',
    'degraded with no coverage block still has to say something',
  )
})

test('a whole answer says nothing at all', () => {
  assert.equal(coverageNote({ degraded: false, places: [] }), null)
  assert.equal(coverageNote(null), null)
  assert.equal(coverageNote(undefined), null)
})

test('two places of the same name are told apart by what and where', () => {
  const crownA = place({
    name: 'The Crown',
    category: 'bar',
    address: { freeform: '12 High Street', locality: 'Bath', country: 'United Kingdom' },
  })
  const crownB = place({
    name: 'The Crown',
    category: 'lodging',
    address: { locality: 'Wells', region: 'Somerset' },
  })
  assert.equal(placeSubtitle(crownA), 'Bar · 12 High Street, Bath')
  assert.equal(placeSubtitle(crownB), 'Somewhere to stay · Wells, Somerset')
})

test('an address says as much as it has, and never says it twice', () => {
  assert.equal(addressLine(null), '')
  assert.equal(addressLine('  Prinsengracht 2  '), 'Prinsengracht 2')
  assert.equal(addressLine({ freeform: 'Museumstraat 1' }), 'Museumstraat 1')
  assert.equal(addressLine({ locality: 'Amsterdam', region: 'Amsterdam' }), 'Amsterdam')
  assert.equal(addressLine({ postcode: '1071 XX' }), '', 'a postcode alone tells nobody anything')
})

test('a list answer is read defensively, because a keystroke is not a place to throw', () => {
  const full = placeListFrom({
    places: [{ id: 'a', name: 'Rijksmuseum', category: 'museum', lat: 52.36, lng: 4.88 }],
    degraded: true,
    coverage: { cell: 'N52E004', status: 'ingesting' },
  })
  assert.equal(full.places.length, 1)
  assert.equal(full.degraded, true)
  assert.deepEqual(full.coverage, { cell: 'N52E004', status: 'ingesting' })

  assert.deepEqual(placeListFrom([{ id: 'a', name: 'A', category: 'other', lat: 0, lng: 0 }]), {
    places: [{ id: 'a', name: 'A', category: 'other', lat: 0, lng: 0 }],
    degraded: false,
    coverage: null,
  })
  assert.deepEqual(placeListFrom(null), { places: [], degraded: false, coverage: null })
  assert.deepEqual(placeListFrom('nonsense'), { places: [], degraded: false, coverage: null })
  assert.deepEqual(placeListFrom({ places: [{ name: 'no id' }, 7] }).places, [])
})

/* The regression for "why don't any of the places have addresses or phone
   numbers?".
 *
 * They did. Every one of them, sitting in the payload. GET /api/places/:id
 * replies `{place, redirectedFrom}` — a wrapper, because a single record can
 * also say where it went when upstream merged or dropped it — and the client
 * handed that whole envelope to placeListFrom as though the envelope were a
 * record. An envelope has no `id` and no `name`, so the filter dropped it and
 * the lookup returned null. Every time, for every place, since the layer
 * shipped: a card that knew a pin's name and category and could not say the
 * address or the telephone number of anywhere. */
test('a single place is read out of the envelope the API sends it in', () => {
  const record = {
    id: '0f2f8b9e-1c2d-4a5b-8e7f-9a0b1c2d3e4f',
    name: 'Royal Saskatchewan Museum',
    category: 'museum',
    lat: 50.4452,
    lng: -104.6167,
    address: { freeform: '2445 Albert St', locality: 'Regina', region: 'SK', country: 'CA' },
    phone: '+1 306-787-2815',
    website: 'https://royalsaskmuseum.ca',
  }
  const found = placeFrom({ place: record, redirectedFrom: null })
  assert.ok(found, 'the envelope is opened rather than parsed as a record')
  assert.equal(found.name, 'Royal Saskatchewan Museum')
  assert.equal(found.phone, '+1 306-787-2815')
  assert.equal(addressLine(found.address), '2445 Albert St, Regina')

  // A bare record, for anything that hands one over already unwrapped.
  assert.equal(placeFrom(record)?.id, record.id)
  // And nothing worth a card is nothing, not a throw.
  assert.equal(placeFrom(null), null)
  assert.equal(placeFrom({ place: null }), null)
  assert.equal(placeFrom({ error: 'No such place' }), null)
})
