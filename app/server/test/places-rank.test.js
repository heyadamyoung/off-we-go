import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CATEGORY_WEIGHT,
  CONFIDENCE_FLOOR,
  DECAY_FRACTION,
  ENOUGH,
  MAX_RADIUS_METRES,
  NEAR_BIAS_METRES,
  WIDENING,
  confidenceFactor,
  distanceDecay,
  nearbyScore,
  rankNearby,
  rankSearch,
  searchScore,
  weightOf,
  widen,
} from '../src/places/rank.js'

/* The order a traveller wants, in numbers.

   Every constant here is a judgement somebody will want to argue with, so the
   tests state the judgement rather than gesturing at it: what each factor is
   worth, where the decay bites, which of two places wins and by how much. The
   balance the file exists to hold is three comparisons — a museum at 800 m
   beats a launderette at 10 m, a café at 50 m still beats a museum at 900 m,
   and asking for a category switches the "what kind" factor off — and they
   are asserted here with their scores, because a change to DECAY_FRACTION
   moves all three at once. */

const close = (actual, expected, within) =>
  assert.ok(
    Math.abs(actual - expected) <= within,
    `${actual} is not within ${within} of ${expected}`,
  )

const place = (category, metres, confidence = 0.9, rest = {}) => ({
  category,
  metres,
  confidence,
  ...rest,
})

test('a category nobody weighted is unknown, not worthless', () => {
  assert.equal(weightOf('sights'), 1)
  assert.equal(weightOf('viewpoint'), 1)
  assert.equal(weightOf('museum'), 0.95)
  assert.equal(weightOf('cafe'), 0.55)
  assert.equal(weightOf('services'), 0.15)
  assert.equal(weightOf('other'), 0.1)
  /* A word from a future release falls to the `other` weight, which ranks low
     and is never hidden. */
  assert.equal(weightOf('cryptid_sanctuary'), CATEGORY_WEIGHT.other)
  assert.equal(weightOf('cryptid_sanctuary'), 0.1)
  assert.equal(weightOf(undefined), 0.1)
  assert.equal(weightOf(null), 0.1)
  assert.equal(Object.keys(CATEGORY_WEIGHT).length, 20, 'a weight for each of the twenty')
})

test('distance decays over two thirds of the radius asked for', () => {
  assert.equal(DECAY_FRACTION, 1.5)
  assert.equal(distanceDecay(0, 1200), 1)
  /* One decay length is radius / 1.5, so at 800 m of a 1200 m radius a place
     keeps 37% of its score, and at the full radius 22%. */
  close(distanceDecay(800, 1200), 0.367_879_441_171_442_33, 1e-12)
  close(distanceDecay(1600, 1200), 0.135_335_283_236_612_7, 1e-12)
  close(distanceDecay(400, 1200), 0.606_530_659_712_633_4, 1e-12, 'a third of the radius')
  close(distanceDecay(1200, 1200), 0.223_130_160_148_429_82, 1e-12, 'the full radius')
  /* The shape is the same whatever the radius. */
  close(distanceDecay(400, 600), distanceDecay(4000, 6000), 1e-12)
  assert.equal(distanceDecay(-5, 1000), 1, 'a negative distance is zero, not a boost')
  assert.equal(distanceDecay(0, 0), 1, 'and a zero radius does not divide by zero')
})

test('confidence demotes and never vetoes', () => {
  assert.equal(confidenceFactor(0), 0.4)
  assert.equal(confidenceFactor(1), 1)
  assert.equal(confidenceFactor(0.5), 0.7)
  close(confidenceFactor(0.9), 0.94, 1e-12)
  assert.equal(confidenceFactor(null), 0.4)
  assert.equal(confidenceFactor(undefined), 0.4)
  assert.equal(confidenceFactor(2), 1, 'clamped')
  assert.equal(confidenceFactor(-1), 0.4, 'clamped')
})

test('a museum at 800 m beats a launderette at 10 m when no category was asked for', () => {
  const query = { radius: 1000 }
  const museum = nearbyScore(place('museum', 800), query)
  const launderette = nearbyScore(place('services', 10), query)
  close(museum, 0.269, 0.001)
  close(launderette, 0.139, 0.001)
  assert.ok(museum > launderette, 'sights nearby is not whatever is underfoot')

  /* The other half of the same balance: kind must not swamp distance either.
     A café fifty metres away is a better answer than a museum nine hundred. */
  const cafe = nearbyScore(place('cafe', 50), query)
  const distantMuseum = nearbyScore(place('museum', 900), query)
  close(cafe, 0.48, 0.001)
  close(distantMuseum, 0.232, 0.001)
  assert.ok(cafe > distantMuseum)
})

test('asking for a category switches the kind factor off', () => {
  const query = { radius: 1000, category: 'services' }
  const museum = nearbyScore(place('museum', 800), query)
  const launderette = nearbyScore(place('services', 10), query)
  close(museum, 0.283, 0.001)
  close(launderette, 0.926, 0.001)
  assert.ok(launderette > museum, 'show me launderettes must not rank them by sight-likeness')
  /* With the weight gone the two are separated by distance and confidence
     alone: the same two places, the same radius, the opposite order. */
  assert.equal(nearbyScore(place('museum', 10), query), nearbyScore(place('cafe', 10), query))
})

test('a thousand metres is the radius assumed when none was given', () => {
  assert.equal(nearbyScore(place('museum', 800), {}), nearbyScore(place('museum', 800), { radius: 1000 }))
  assert.equal(nearbyScore(place('museum', 800)), nearbyScore(place('museum', 800), { radius: 1000 }))
})

test('anything below the floor is not shown at all', () => {
  assert.equal(CONFIDENCE_FLOOR, 0.3)
  const ranked = rankNearby(
    [
      place('museum', 800, 0.9, { id: 'museum' }),
      place('services', 10, 0.9, { id: 'launderette' }),
      place('museum', 5, 0.25, { id: 'doubtful' }),
    ],
    { radius: 1000 },
  )
  assert.deepEqual(
    ranked.map(row => row.id),
    ['museum', 'launderette'],
  )
  close(ranked[0].score, 0.269, 0.001)
  close(ranked[1].score, 0.139, 0.001)
  /* The floor is inclusive, and the caller may lower or raise it. */
  assert.equal(rankNearby([place('museum', 5, 0.3)], { radius: 1000 }).length, 1)
  assert.equal(rankNearby([place('museum', 5, 0.4)], { radius: 1000, floor: 0.5 }).length, 0)
  assert.equal(rankNearby([place('museum', 5, 0.1)], { radius: 1000, floor: 0 }).length, 1)
  assert.equal(rankNearby([{ category: 'museum', metres: 5 }], { radius: 1000 }).length, 0)
  assert.deepEqual(rankNearby([], { radius: 1000 }), [])
  assert.deepEqual(rankNearby(null, { radius: 1000 }), [])
})

test('an equal score keeps the order the database gave', () => {
  const rows = [
    place('cafe', 100, 0.6, { id: 'first' }),
    place('cafe', 100, 0.6, { id: 'second' }),
    place('cafe', 100, 0.6, { id: 'third' }),
  ]
  assert.deepEqual(
    rankNearby(rows, { radius: 1000 }).map(row => row.id),
    ['first', 'second', 'third'],
  )
  assert.deepEqual(
    rankNearby([...rows].reverse(), { radius: 1000 }).map(row => row.id),
    ['third', 'second', 'first'],
    'stable, not sorted again by something else',
  )
  /* The place comes back whole, with its score added. */
  const [top] = rankNearby([place('museum', 10, 0.9, { id: 'm', name: 'Museum' })], { radius: 1000 })
  assert.equal(top.name, 'Museum')
  assert.equal(top.category, 'museum')
  assert.equal(typeof top.score, 'number')
})

test('the ladder widens until it has enough, and never past 50 km', () => {
  assert.equal(ENOUGH, 8)
  assert.equal(MAX_RADIUS_METRES, 50_000)
  assert.deepEqual(WIDENING, [
    { radius: 1, floor: 1 },
    { radius: 3, floor: 1 },
    { radius: 8, floor: 0.75 },
    { radius: 25, floor: 0.5 },
  ])
  const base = { radius: 1000, floor: 0.3 }
  assert.equal(widen(8, 0, base), null, 'enough is enough')
  assert.equal(widen(20, 0, base), null)
  /* The radius grows first and the floor drops second: a real place further
     away beats a doubtful one underfoot. */
  assert.deepEqual(widen(0, 0, base), { radius: 3000, floor: 0.3 })
  close(widen(0, 1, base).radius, 8000, 0)
  close(widen(0, 1, base).floor, 0.225, 1e-12)
  assert.deepEqual(widen(0, 2, base), { radius: 25_000, floor: 0.15 })
  assert.equal(widen(0, 3, base), null, 'the ladder is spent')
  assert.equal(widen(7, 0, base).radius, 3000, 'one short of enough still widens')
})

test('the ladder stops rather than pretend to widen past the cap', () => {
  /* A 5 km start reaches the cap on the last rung and stops there. */
  assert.deepEqual(widen(0, 2, { radius: 5000, floor: 0.3 }), { radius: 50_000, floor: 0.15 })
  assert.equal(widen(0, 1, { radius: 5000, floor: 0.3 }).radius, 40_000)
  close(widen(0, 1, { radius: 5000, floor: 0.3 }).floor, 0.225, 1e-12)
  /* A 20 km start is already close enough to the cap that the next rung would
     not be wider than the one just tried, so there is no next rung. */
  assert.equal(widen(0, 1, { radius: 20_000, floor: 0.4 }), null)
  assert.equal(widen(0, 2, { radius: 20_000, floor: 0.3 }), null)
  for (const attempt of [0, 1, 2]) {
    for (const radius of [1000, 5000, 20_000, 60_000]) {
      const next = widen(0, attempt, { radius, floor: 0.3 })
      if (next) assert.ok(next.radius <= MAX_RADIUS_METRES, `${next.radius} at ${radius}`)
      if (next) assert.ok(next.floor >= 0)
    }
  }
})

test('a prefix match outranks a merely similar longer name', () => {
  /* Trigram similarity alone puts "Café Rijk" above "Rijksmuseum" for the
     query "rijks", because the shorter name shares a greater share of its
     trigrams. The bonus restores the order a person expects. */
  const rijksmuseum = { name: 'Rijksmuseum', similarity: 0.35, confidence: 0.9, metres: null }
  const cafeRijk = { name: 'Café Rijk', similarity: 0.5, confidence: 0.9, metres: null }
  close(searchScore(rijksmuseum, 'rijks'), 0.744, 0.001)
  close(searchScore(cafeRijk, 'rijks'), 0.594, 0.001)
  assert.deepEqual(
    rankSearch([cafeRijk, rijksmuseum], 'rijks').map(row => row.name),
    ['Rijksmuseum', 'Café Rijk'],
  )
  /* Three tiers: the front of the name is worth 0.3, anywhere else in it 0.1,
     nowhere nothing. */
  const inside = { name: 'Grand Rijks Hotel', similarity: 0.35, confidence: 0.9, metres: null }
  const nowhere = { name: 'Grand Hotel', similarity: 0.35, confidence: 0.9, metres: null }
  close(searchScore(inside, 'rijks') - searchScore(nowhere, 'rijks'), 0.1, 1e-12)
  close(searchScore(rijksmuseum, 'rijks') - searchScore(nowhere, 'rijks'), 0.3, 1e-12)
  close(searchScore(rijksmuseum, '  RIJKS  '), searchScore(rijksmuseum, 'rijks'), 1e-12)
})

test('a near place gets a bias, and likeness still decides', () => {
  assert.equal(NEAR_BIAS_METRES, 30_000)
  const here = { name: 'Zoom', similarity: 0.5, confidence: 0.8, metres: 0 }
  const unknown = { name: 'Zoom', similarity: 0.5, confidence: 0.8, metres: null }
  const far = { name: 'Zoom', similarity: 0.5, confidence: 0.8, metres: 100_000 }
  close(searchScore(here, 'zzz'), 0.738, 0.001)
  close(searchScore(unknown, 'zzz'), 0.588, 0.001)
  close(searchScore(far, 'zzz'), 0.593, 0.001)
  assert.ok(searchScore(here, 'zzz') > searchScore(far, 'zzz'))
  /* The whole bias is worth 0.15 at zero metres, which a fifth of a point of
     similarity outweighs: geography biases, it does not decide. */
  const better = { name: 'Zoom Cafe', similarity: 0.7, confidence: 0.8, metres: 100_000 }
  close(searchScore(better, 'zzz'), 0.793, 0.001)
  assert.ok(searchScore(better, 'zzz') > searchScore(here, 'zzz'))
  assert.equal(searchScore(unknown, 'zzz'), searchScore({ ...unknown, metres: undefined }, 'zzz'))
})

test('a search keeps the order it was given when the scores are equal', () => {
  const rows = [
    { id: 1, name: 'Alpha', similarity: 0.5, confidence: 0.5, metres: null },
    { id: 2, name: 'Beta', similarity: 0.5, confidence: 0.5, metres: null },
  ]
  assert.deepEqual(
    rankSearch(rows, 'zz').map(row => row.id),
    [1, 2],
  )
  assert.deepEqual(
    rankSearch([...rows].reverse(), 'zz').map(row => row.id),
    [2, 1],
  )
  assert.deepEqual(rankSearch([], 'zz'), [])
  assert.deepEqual(rankSearch(null, 'zz'), [])
  /* An empty query is a prefix of every name, which is what a typeahead with
     nothing typed should do: nothing is excluded. */
  close(searchScore({ name: 'Anything', similarity: 0, confidence: 0, metres: null }, ''), 0.34, 1e-12)
  close(
    searchScore({ name: 'Anything', similarity: 0, confidence: 0, metres: null }, null),
    0.34,
    1e-12,
  )
})
