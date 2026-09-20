import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ACCEPT,
  MATCH_METRES,
  MERGED_FIELDS,
  STRONG_NAME,
  STRONG_NAME_METRES,
  bestMatch,
  categoryAgreement,
  foldName,
  matchScore,
  mergeFields,
  merges,
  metresBetween,
  nameSimilarity,
  trigrams,
} from '../src/places/resolve.js'

/* When two records are the same place.

   A merge that goes wrong puts one café's phone number on another café's pin
   and somebody rings it, so every part of the decision is stated here in
   numbers rather than in adjectives. What these pin: the folding is shallow
   and stays shallow; the likeness measure, to a specific value, so tuning it
   is visible; the distance, against known ground; the hard gate outside which
   no name is good enough; the two doors that merge (the score, and the
   strong-name shortcut); that a tie is broken the same way whatever order the
   candidates arrived in; and that merging fields takes the filled value, the
   confident position and every name anybody knew. */

const close = (actual, expected, within) =>
  assert.ok(
    Math.abs(actual - expected) <= within,
    `${actual} is not within ${within} of ${expected}`,
  )

/* A metre of latitude, near enough, for building a pair a known distance
   apart: a degree of latitude is 111,195 m on this sphere. */
const north = (lat, metres) => lat + metres / 111_195

const at = (name, lat, lng, category = 'cafe', rest = {}) => ({ name, lat, lng, category, ...rest })

test('folding strips accents, case and punctuation, and stops there', () => {
  assert.equal(foldName('Café Zoöm!'), 'cafe zoom')
  assert.equal(foldName('  THE  Ritz-Carlton, Amsterdam '), 'the ritz carlton amsterdam')
  assert.equal(foldName("McSorley's Old Ale House"), 'mcsorley s old ale house')
  /* Not stemming, not translating, not dropping articles: every clever
     normalisation eventually folds two real places onto one. */
  assert.notEqual(foldName('Cafés'), foldName('Café'))
  assert.notEqual(foldName('The Ivy'), foldName('Ivy'))
  assert.equal(foldName('Æther'), 'æther', 'a ligature is a letter, not an accent')
  assert.equal(foldName('北京烤鸭'), '北京烤鸭')
  assert.equal(foldName(''), '')
  assert.equal(foldName(null), '')
  assert.equal(foldName(undefined), '')
  assert.equal(foldName('!!!'), '')
})

test('likeness is symmetric, one for the same name and zero for none', () => {
  assert.equal(nameSimilarity('Rijksmuseum', 'Rijksmuseum'), 1)
  assert.equal(nameSimilarity('Café Zoom', 'cafe zoom!'), 1, 'the same name once folded')
  assert.equal(nameSimilarity('', ''), 0)
  assert.equal(nameSimilarity('Zoom', ''), 0)
  assert.equal(nameSimilarity('Zoom', null), 0)
  assert.equal(nameSimilarity('!!!', '!!!'), 0, 'punctuation folds to nothing, and nothing is 0')
  assert.equal(nameSimilarity('Café Zoom', 'Bar Hopper'), 0, 'no shared trigrams at all')

  /* The measure itself, to the digit. Dice over padded character trigrams: if
     this number moves, the merge threshold means something else. */
  assert.equal(nameSimilarity('Rijksmuseum', 'Rijks Museum'), 0.8)
  assert.equal(nameSimilarity('Rijks Museum', 'Rijksmuseum'), 0.8)
  assert.equal(nameSimilarity('De Kas', 'Restaurant De Kas'), 0.48)
  close(nameSimilarity('Café Zoom', 'Cafe Zooms'), 0.857_142_857_142_857_1, 1e-12)

  for (const [a, b] of [
    ['Rijksmuseum', 'Van Gogh Museum'],
    ['Zoom', 'Zoo'],
    ['A', 'Something Longer'],
  ]) {
    assert.equal(nameSimilarity(a, b), nameSimilarity(b, a), `${a} / ${b}`)
  }
})

test('a two-letter name still scores, because the trigrams are padded', () => {
  assert.deepEqual([...trigrams('bo')], ['  b', ' bo', 'bo '])
  assert.equal(trigrams('bo').size, 3)
  /* Without the padding "Bo" would have no trigrams and every two-letter bar
     in Lisbon would match every other one at zero. */
  assert.equal(nameSimilarity('Bo', 'Ba'), 1 / 3)
  assert.equal(nameSimilarity('Bo', 'Bo'), 1)
  assert.ok(nameSimilarity('Bo', 'Ba') < ACCEPT, 'and still does not merge on its own')
})

test('the distance is the great-circle one, against known ground', () => {
  /* A hundredth of a degree of latitude is 1.1 km anywhere on earth. */
  close(metresBetween({ lat: 52.37, lng: 4.9 }, { lat: 52.38, lng: 4.9 }), 1112, 11)
  close(metresBetween({ lat: -33.86, lng: 151.2 }, { lat: -33.87, lng: 151.2 }), 1112, 11)
  /* And on the equator a hundredth of a degree of longitude is the same. */
  close(metresBetween({ lat: 0, lng: 0 }, { lat: 0, lng: 0.01 }), 1112, 11)
  /* Amsterdam to Paris, 430 km. */
  close(metresBetween({ lat: 52.3676, lng: 4.9041 }, { lat: 48.8566, lng: 2.3522 }), 430_000, 4300)
  assert.equal(metresBetween({ lat: 1, lng: 1 }, { lat: 1, lng: 1 }), 0)
  assert.equal(
    metresBetween({ lat: 52.37, lng: 4.9 }, { lat: 52.38, lng: 4.9 }),
    metresBetween({ lat: 52.38, lng: 4.9 }, { lat: 52.37, lng: 4.9 }),
    'symmetric',
  )
})

test('agreement about kind is one, a half, or nothing', () => {
  assert.equal(categoryAgreement('cafe', 'cafe'), 1)
  assert.equal(categoryAgreement('cafe', 'food'), 0.5, 'neighbours in the taxonomy')
  assert.equal(categoryAgreement('cafe', 'health'), 0)
  /* Unknown on either side is not evidence either way, so it sits in the
     middle rather than voting against. */
  assert.equal(categoryAgreement('cafe', 'other'), 0.5)
  assert.equal(categoryAgreement('cafe', null), 0.5)
  assert.equal(categoryAgreement(undefined, undefined), 0.5)
})

test('beyond the gate there is no score, whatever the name says', () => {
  assert.equal(MATCH_METRES, 200)
  const subject = at('Café Zoom', 52.37, 4.9)
  const far = at('Café Zoom', north(52.37, 300), 4.9)

  const outside = matchScore(subject, far)
  assert.equal(outside.gated, true)
  assert.equal(outside.score, 0)
  assert.equal(outside.name, 1, 'the name was still perfect; it is simply a different building')
  close(outside.distance, 300, 1)
  assert.equal(merges(outside), false, 'the same name 300 m apart does not merge')

  const inside = matchScore(subject, at('Café Zoom', north(52.37, 199), 4.9))
  assert.equal(inside.gated, false)
  assert.ok(inside.score > 0)
})

test('the score is name, closeness and kind in fixed proportions', () => {
  const subject = at('Café Zoom', 52.37, 4.9)
  const twin = matchScore(subject, at('Cafe Zoom', north(52.37, 50), 4.9))
  /* 0.5 x name 1 + 0.3 x proximity 0.75 + 0.2 x category 1 */
  close(twin.score, 0.925, 0.001)
  close(twin.distance, 50, 0.1)
  assert.equal(twin.name, 1)
  assert.equal(twin.category, 1)

  const stranger = matchScore(subject, at('Bar Hopper', north(52.37, 50), 4.9))
  close(stranger.score, 0.425, 0.001)
  assert.equal(stranger.name, 0)
})

test('identical names fifty metres apart merge; different ones do not', () => {
  assert.equal(ACCEPT, 0.72)
  const subject = at('Café Zoom', 52.37, 4.9)
  assert.equal(merges(matchScore(subject, at('Cafe Zoom', north(52.37, 50), 4.9))), true)
  assert.equal(merges(matchScore(subject, at('Bar Hopper', north(52.37, 50), 4.9))), false)
  assert.equal(
    merges(matchScore(subject, at('Grand Hotel Zoom', north(52.37, 50), 4.9))),
    false,
    'sharing a word is not sharing a shopfront',
  )
  /* Where a longer name stops being the same place. A suffix still merges; the
     bare word on its own does not. These two are the edge of the measure and
     the numbers are worth seeing. */
  const suffix = matchScore(subject, at('Café Zoom Express', north(52.37, 50), 4.9))
  close(suffix.name, 0.714_285_714_285_714_3, 1e-12)
  close(suffix.score, 0.782, 0.001)
  assert.equal(merges(suffix), true)
  const bare = matchScore(subject, at('Zoom', north(52.37, 50), 4.9))
  close(bare.name, 0.533_333_333_333_333_3, 1e-12)
  close(bare.score, 0.692, 0.001)
  assert.equal(merges(bare), false)
})

test('a strong enough name merges within 120 m though the categories contradict', () => {
  assert.equal(STRONG_NAME, 0.92)
  assert.equal(STRONG_NAME_METRES, 120)
  const subject = at('Café Zoom', 52.37, 4.9, 'museum')
  const shop = at('Café Zoom', north(52.37, 119), 4.9, 'shopping')
  const scored = matchScore(subject, shop)
  assert.equal(scored.name, 1)
  assert.equal(scored.category, 0, 'a museum and a shop contradict outright')
  close(scored.score, 0.6215, 0.001)
  assert.ok(scored.score < ACCEPT, 'the score alone would not have merged it')
  assert.equal(merges(scored), true, 'the strong-name shortcut merges it anyway')

  /* And the shortcut stops at its own distance, not at the gate. */
  const past = matchScore(subject, at('Café Zoom', north(52.37, 150), 4.9, 'shopping'))
  close(past.score, 0.575, 0.001)
  assert.equal(merges(past), false)
})

test('a tie is broken the same way whichever order the candidates arrive in', () => {
  const subject = at('Café Zoom', 0, 0, 'cafe', { upstreamId: 'subject' })
  const west = at('Café Zoom', 0, -0.0005, 'cafe', { upstreamId: 'b-west' })
  const east = at('Café Zoom', 0, 0.0005, 'cafe', { upstreamId: 'a-east' })
  assert.equal(
    matchScore(subject, west).score,
    matchScore(subject, east).score,
    'the two candidates really are tied',
  )
  assert.equal(bestMatch(subject, [west, east]).match.upstreamId, 'a-east')
  assert.equal(bestMatch(subject, [east, west]).match.upstreamId, 'a-east')
  /* The smaller id wins, not the nearer or the first seen. */
  assert.equal(bestMatch(subject, [east, west]).match, east)

  const better = at('Café Zoom', 0, 0.0001, 'cafe', { upstreamId: 'z-best' })
  assert.equal(bestMatch(subject, [east, better, west]).match.upstreamId, 'z-best')
  assert.equal(bestMatch(subject, [better, west, east]).match.upstreamId, 'z-best')
})

test('nothing near enough is null, not a poor match', () => {
  const subject = at('Café Zoom', 0, 0, 'cafe', { upstreamId: 's' })
  assert.equal(bestMatch(subject, []), null)
  assert.equal(bestMatch(subject, null), null)
  assert.equal(bestMatch(subject, [at('Somewhere Else', 0, 0.01, 'bar', { upstreamId: 'z' })]), null)
  const found = bestMatch(subject, [at('Café Zoom', 0, 0.0002, 'cafe', { upstreamId: 'm' })])
  assert.equal(found.match.upstreamId, 'm')
  assert.ok(found.scored.score >= ACCEPT)
})

test('a filled value beats an empty one from a more confident source', () => {
  const records = [
    {
      source: 'overture',
      confidence: 0.9,
      name: 'Café Zoom',
      category: 'cafe',
      address: { freeform: 'Prinsengracht 1' },
      website: null,
      phone: null,
      hours: null,
      operating: 'open',
      lat: 52.37,
      lng: 4.9,
      alternateNames: ['Zoom'],
    },
    {
      source: 'fsq',
      confidence: 0.5,
      name: 'Cafe Zoom',
      category: 'cafe',
      address: null,
      website: 'https://zoom.example',
      phone: '+31 20 123 4567',
      hours: { mon: '09:00-17:00' },
      operating: null,
      lat: 52.3701,
      lng: 4.9001,
      alternateNames: ['Koffie Zoom', 'Zoom'],
    },
    {
      source: 'osm',
      confidence: 0.7,
      name: 'Café Zoom',
      category: 'cafe',
      address: null,
      website: 'https://osm.example',
      phone: null,
      hours: null,
      operating: null,
      lat: 52.3702,
      lng: 4.9002,
      alternateNames: [],
    },
  ]
  const { merged, credit } = mergeFields(records)

  assert.equal(merged.name, 'Café Zoom')
  assert.deepEqual(merged.address, { freeform: 'Prinsengracht 1' })
  assert.equal(merged.operating, 'open')
  /* The most confident source had no website; the next one down did, and a
     blank from a confident source is not knowledge. */
  assert.equal(merged.website, 'https://osm.example')
  assert.equal(merged.phone, '+31 20 123 4567')
  assert.deepEqual(merged.hours, { mon: '09:00-17:00' })

  /* Every name anybody knew, minus the one we settled on, sorted. */
  assert.deepEqual(merged.alternateNames, ['Cafe Zoom', 'Koffie Zoom', 'Zoom'])

  /* The position is the most confident source's. Averaging would put the pin
     in the road between them. */
  assert.equal(merged.lat, 52.37)
  assert.equal(merged.lng, 4.9)

  assert.deepEqual(credit, {
    overture: ['name', 'category', 'address', 'operating'],
    fsq: ['phone', 'hours'],
    osm: ['website'],
  })
  assert.deepEqual(MERGED_FIELDS, [
    'name',
    'category',
    'address',
    'website',
    'phone',
    'hours',
    'operating',
  ])
})

test('an equal confidence is broken by the order the caller gave', () => {
  const records = [
    { source: 'fsq', confidence: 0.5, name: 'Zoom B', lat: 1, lng: 1 },
    { source: 'overture', confidence: 0.5, name: 'Zoom A', lat: 2, lng: 2 },
  ]
  const first = mergeFields(records)
  assert.equal(first.merged.name, 'Zoom A')
  assert.equal(first.merged.lat, 2)
  assert.deepEqual(first.credit, { fsq: [], overture: ['name'] })

  const second = mergeFields(records, ['fsq', 'overture', 'osm'])
  assert.equal(second.merged.name, 'Zoom B')
  assert.equal(second.merged.lat, 1)
  assert.deepEqual(second.merged.alternateNames, ['Zoom A'])
})

test('an empty string, an empty array and a null are all empty', () => {
  const { merged } = mergeFields([
    { source: 'overture', confidence: 0.9, name: '', category: null, website: '', lat: null },
    { source: 'fsq', confidence: 0.1, name: 'Real Name', category: 'cafe', website: 'x', lat: 5, lng: 6 },
  ])
  assert.equal(merged.name, 'Real Name')
  assert.equal(merged.category, 'cafe')
  assert.equal(merged.website, 'x')
  assert.equal(merged.lat, 5, 'a record without a position does not place the merge')
  assert.equal(merged.lng, 6)
  assert.deepEqual(merged.alternateNames, [])

  const nowhere = mergeFields([{ source: 'overture', confidence: 0.9, name: 'Only' }])
  assert.equal(nowhere.merged.lat, null)
  assert.equal(nowhere.merged.lng, null)
})
