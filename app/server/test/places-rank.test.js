import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CATEGORY_WEIGHT,
  EARLIEST_ZOOM,
  CONFIDENCE_FLOOR,
  DECAY_FRACTION,
  ENOUGH,
  LABEL_ZOOMS,
  MAX_RADIUS_METRES,
  NEAR_BIAS_METRES,
  SEARCH_KIND,
  SEARCH_WEIGHT,
  VIEW_WEIGHT,
  WIDENING,
  confidenceFactor,
  distanceDecay,
  markRank,
  nearbyScore,
  rankNearby,
  rankSearch,
  viewWeightOf,
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

const close = (actual, expected, within, message) =>
  assert.ok(
    Math.abs(actual - expected) <= within,
    message
      ? `${message}: ${actual} is not within ${within} of ${expected}`
      : `${actual} is not within ${within} of ${expected}`,
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
  assert.equal(
    nearbyScore(place('museum', 800), {}),
    nearbyScore(place('museum', 800), { radius: 1000 }),
  )
  assert.equal(
    nearbyScore(place('museum', 800)),
    nearbyScore(place('museum', 800), { radius: 1000 }),
  )
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
  const [top] = rankNearby([place('museum', 10, 0.9, { id: 'm', name: 'Museum' })], {
    radius: 1000,
  })
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
     trigrams. Being at the front of the name, and containing the whole of
     what was typed, restore the order a person expects. Same category on both
     so the comparison is about the name and nothing else. */
  const rijksmuseum = {
    name: 'Rijksmuseum',
    category: 'museum',
    similarity: 0.35,
    confidence: 0.9,
    metres: null,
  }
  const cafeRijk = {
    name: 'Café Rijk',
    category: 'museum',
    similarity: 0.5,
    confidence: 0.9,
    metres: null,
  }
  assert.ok(searchScore(rijksmuseum, 'rijks') > searchScore(cafeRijk, 'rijks'))
  assert.deepEqual(
    rankSearch([cafeRijk, rijksmuseum], 'rijks').map(row => row.name),
    ['Rijksmuseum', 'Café Rijk'],
  )
  /* Three tiers: the front of the name, anywhere else in it, nowhere. */
  const inside = {
    name: 'Grand Rijks Hotel',
    category: 'museum',
    similarity: 0.35,
    confidence: 0.9,
    metres: null,
  }
  const nowhere = {
    name: 'Grand Hotel',
    category: 'museum',
    similarity: 0.35,
    confidence: 0.9,
    metres: null,
  }
  const front = searchScore(rijksmuseum, 'rijks')
  const middle = searchScore(inside, 'rijks')
  const absent = searchScore(nowhere, 'rijks')
  assert.ok(front > middle && middle > absent, `${front} > ${middle} > ${absent}`)
  close(middle - absent, SEARCH_WEIGHT.contains + 0.4 * SEARCH_WEIGHT.position, 1e-12)
  close(front - absent, SEARCH_WEIGHT.contains + SEARCH_WEIGHT.position, 1e-12)
  close(searchScore(rijksmuseum, '  RIJKS  '), front, 1e-12)
})

test('a near place gets a bias, and likeness still decides', () => {
  assert.equal(NEAR_BIAS_METRES, 30_000)
  const here = { name: 'Zoom', category: 'cafe', similarity: 0.5, confidence: 0.8, metres: 0 }
  const unknown = { name: 'Zoom', category: 'cafe', similarity: 0.5, confidence: 0.8, metres: null }
  const far = { name: 'Zoom', category: 'cafe', similarity: 0.5, confidence: 0.8, metres: 100_000 }
  /* The whole bias is worth SEARCH_WEIGHT.near at zero metres, and nothing at
     all when the distance is unknown. */
  close(searchScore(here, 'zzz') - searchScore(unknown, 'zzz'), SEARCH_WEIGHT.near, 1e-12)
  assert.ok(searchScore(here, 'zzz') > searchScore(far, 'zzz'))
  assert.ok(searchScore(far, 'zzz') > searchScore(unknown, 'zzz'))
  /* Which half a point of similarity outweighs: geography biases, it does not
     decide. */
  const better = {
    name: 'Zoom Cafe',
    category: 'cafe',
    similarity: 1,
    confidence: 0.8,
    metres: 100_000,
  }
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
  const blank = searchScore({ name: 'Anything', similarity: 0, confidence: 0, metres: null }, '')
  assert.ok(blank > 0, 'an empty query excludes nothing')
  close(
    searchScore({ name: 'Anything', similarity: 0, confidence: 0, metres: null }, null),
    blank,
    1e-12,
  )
})

/* The case that sent this file back to the drawing board, measured on the
   real Overture release for Amsterdam.
 *
 * Dice over trigrams divides by the length of both names, so for "heineken"
 * a bar called "Heineken Bar" scores 0.82 and the Heineken Experience scores
 * 0.60 — purely for having a longer name. The top five used to be four bars
 * and an office, one of them eleven kilometres away, and the museum a
 * traveller was obviously looking for was nowhere in the list. */
test('a landmark beats a bar named after it', () => {
  const heineken = [
    {
      id: 'bar-near',
      name: 'Heineken Bar',
      category: 'bar',
      similarity: 0.82,
      confidence: 0.64,
      metres: 500,
    },
    {
      id: 'bar-far',
      name: 'Heineken Bar',
      category: 'bar',
      similarity: 0.82,
      confidence: 0.99,
      metres: 11_252,
    },
    {
      id: 'museum',
      name: 'Heineken Experience',
      category: 'museum',
      similarity: 0.6,
      confidence: 1,
      metres: 1_684,
    },
    {
      id: 'office',
      name: 'HEINEKEN International',
      category: 'services',
      similarity: 0.55,
      confidence: 0.96,
      metres: 1_689,
    },
  ]
  assert.equal(rankSearch(heineken, 'heineken')[0].id, 'museum')
})

/* And the other half of the same defect: a station is not a sight, so the
   nearby weighting rightly puts transit near the bottom — but a search is a
   question about a name, and "Amsterdam Centraal" is exactly the kind of
   name a traveller types. It used to lose to Bar Centraal. */
test('a station wins its own name, though it would not win a list of sights', () => {
  const centraal = [
    {
      id: 'bar',
      name: 'Bar Centraal',
      category: 'bar',
      similarity: 0.78,
      confidence: 1,
      metres: 1_925,
    },
    {
      id: 'station',
      name: 'Amsterdam Centraal',
      category: 'transit',
      similarity: 0.62,
      confidence: 0.99,
      metres: 752,
    },
  ]
  assert.equal(rankSearch(centraal, 'centraal')[0].id, 'station')
  /* The nearby list is the other question, and there the bar still wins. */
  assert.ok(CATEGORY_WEIGHT.bar > CATEGORY_WEIGHT.transit)
  assert.ok(SEARCH_KIND.transit > CATEGORY_WEIGHT.transit)
})

/* Fuzzy matching is what the similarity term is for, and it must survive the
   terms added around it: a misspelling still has to find the place. */
test('a misspelling still finds the place', () => {
  const rows = [
    {
      id: 'right',
      name: 'Van Gogh Museum',
      category: 'museum',
      similarity: 0.72,
      confidence: 0.98,
      metres: 900,
    },
    {
      id: 'cafe',
      name: 'Van Gogh Cafe',
      category: 'cafe',
      similarity: 0.66,
      confidence: 0.7,
      metres: 400,
    },
  ]
  assert.equal(rankSearch(rows, 'van gogh musuem')[0].id, 'right')
})

/* The map's ordering is done in the database — a city viewport holds tens of
   thousands of rows and the screen wants a few hundred, so sorting them here
   would throw the index away at the last step. That means the weights exist
   twice: as this table, and as a CASE that store.js builds from it. This is
   the test that says they are the same table, so a change to one cannot
   quietly leave the other behind. */
test('every category has a map weight, and the map weights are a table not a guess', () => {
  for (const category of Object.keys(CATEGORY_WEIGHT)) {
    assert.equal(
      VIEW_WEIGHT[category],
      viewWeightOf(category),
      `${category} weighs differently on a map than viewWeightOf says`,
    )
    assert.ok(Number.isFinite(VIEW_WEIGHT[category]), category)
  }
  assert.deepEqual(Object.keys(VIEW_WEIGHT).sort(), Object.keys(CATEGORY_WEIGHT).sort())
  /* The catch-all sits under the named kinds. Measured on the real Amsterdam
     data: at the nearby weighting the best eight places in the city centre
     were two arts venues and six canal bridges, all honestly filed as
     `sights`, and every museum in Amsterdam lost to them. */
  assert.ok(VIEW_WEIGHT.sights < VIEW_WEIGHT.museum)
  assert.ok(VIEW_WEIGHT.sights < VIEW_WEIGHT.gallery)
  assert.ok(VIEW_WEIGHT.sights < VIEW_WEIGHT.historic)
  /* And it is only the map that thinks so: a list of what is near you still
     leads with the catch-all, because there distance decides and a sight
     underfoot is a sight. */
  assert.ok(CATEGORY_WEIGHT.sights > CATEGORY_WEIGHT.museum)
})

/* What shows at which zoom.
 *
 * Reported from the road, looking at a city: "ours is just a cluster fuck of
 * dots". It was. The layer had one bit per place — `big` — and above zoom 11
 * everything drew, so three hundred identical grey dots landed at once on a
 * view of a whole city. These are the tiers that replaced that bit, and they
 * are asserted rather than eyeballed because they are the numbers somebody
 * will want to argue with. */
test('the zooms a mark can earn are the ones a person zooms through', () => {
  /* There is no table of category zooms any more, and the absence is the
     point. It read well — museum 11.5, café 15.5 — and it produced both of
     the complaints it was meant to answer, because the same rule ran in a
     city of a hundred and sixty-eight thousand places and on an island of
     thirteen hundred. A mark earns its zoom from where it comes among its
     neighbours now: places/store.js assignLabelZoom, using the weights below
     as the order and nothing at all as the tier.

     What is left to assert here is the shape of the ladder. 11 is a whole
     city and 16 a few streets; 17 is the pavement, where everything not
     already placed lands, because a square three hundred metres across is
     not a place anybody wants a selection. */
  assert.equal(LABEL_ZOOMS.from, 11)
  assert.ok(LABEL_ZOOMS.to < LABEL_ZOOMS.floor, 'the floor is below the thinning zooms')
  assert.ok(LABEL_ZOOMS.floor - LABEL_ZOOMS.to === 1, 'and immediately below them')
  /* Every kind sits inside the ladder, and the floor is strictly past the
     last of them — which is what makes the unranked default (LABEL_ZOOMS.floor
     in store.js ZOOM_AT) later than anything a pass would assign, so a row
     the pass has not reached cannot outrank one it has. */
  for (const [kind, zoom] of Object.entries(EARLIEST_ZOOM)) {
    assert.ok(Number.isInteger(zoom), `${kind} has no zoom`)
    assert.ok(zoom >= LABEL_ZOOMS.from, `${kind} is drawn from ${zoom}, below the first zoom`)
    assert.ok(zoom < LABEL_ZOOMS.floor, `${kind} is drawn from the floor, which means never`)
  }
  /* And the table is the whole rule: no quota, no per-tile budget, nothing
     that makes one place's zoom depend on another's. A museum is drawn from
     the same zoom in Amsterdam and in Regina. */
  assert.equal(EARLIEST_ZOOM.museum, EARLIEST_ZOOM.gallery)
  assert.ok(EARLIEST_ZOOM.museum < EARLIEST_ZOOM.cafe)
  assert.ok(EARLIEST_ZOOM.cafe < EARLIEST_ZOOM.services)
})

test('what a mark is worth still says a museum beats a launderette', () => {
  /* The category decides the order marks are chosen in, which is the half of
     the old table that was a fact about the category rather than a guess
     about the density. */
  const worth = category => VIEW_WEIGHT[category]
  assert.ok(worth('museum') > worth('cafe'))
  assert.ok(worth('historic') > worth('shopping'))
  assert.ok(worth('sights') > worth('services'))
  assert.ok(worth('nature') > worth('other'))
  /* And a kind nobody weighted is unknown rather than worthless. */
  assert.equal(VIEW_WEIGHT.nonsense ?? VIEW_WEIGHT.other, VIEW_WEIGHT.other)
})

test('the cathedral wins the piece of screen the cafe wanted', () => {
  const cathedral = markRank({ category: 'religious', confidence: 0.9 })
  const cafe = markRank({ category: 'cafe', confidence: 0.9 })
  const launderette = markRank({ category: 'services', confidence: 0.9 })
  assert.ok(cathedral > cafe, `${cathedral} should beat ${cafe}`)
  assert.ok(cafe > launderette, `${cafe} should beat ${launderette}`)

  // Confidence demotes within a kind, so two museums are not a coin toss.
  assert.ok(
    markRank({ category: 'museum', confidence: 0.95 }) >
      markRank({ category: 'museum', confidence: 0.4 }),
  )
  // Integers, because this travels as a GeoJSON property and is sorted on.
  assert.equal(cathedral, Math.round(cathedral))
  assert.ok(Number.isFinite(markRank({})))
})
