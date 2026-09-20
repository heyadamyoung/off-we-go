import assert from 'node:assert/strict'
import test from 'node:test'
import { CATEGORIES, categoryFor, isCategory, relatedCategories } from '../src/places/taxonomy.js'

/* Two thousand upstream leaf categories in twenty travellers' words.

   The mapping is a judgement, so the tests are not "is this sensible" but "is
   this still what it was". What they pin: that the twenty are twenty; the
   precedence between the leaf value and the coarse one, in both directions —
   a leaf that names a sight the coarse value cannot beats it, an ordinary
   coarse value beats the leaf, and a coarse value that names a sector defers
   to the leaf; that the leaf rules are anchored tightly enough not to file a
   bar association under drinks; that nothing throws and nothing escapes the
   twenty; and which categories are near enough that two sources disagreeing
   about them is a difference of opinion. */

test('there are twenty categories and no repeats', () => {
  assert.equal(CATEGORIES.length, 20)
  assert.equal(new Set(CATEGORIES).size, 20)
  assert.deepEqual(CATEGORIES, [
    'sights',
    'viewpoint',
    'museum',
    'gallery',
    'historic',
    'religious',
    'nature',
    'beach',
    'food',
    'cafe',
    'bar',
    'market',
    'lodging',
    'shopping',
    'entertainment',
    'sport',
    'transit',
    'services',
    'health',
    'other',
  ])
  for (const category of CATEGORIES) assert.equal(isCategory(category), true, category)
  assert.equal(isCategory('Museum'), false, 'the category is the lower-case word')
  assert.equal(isCategory('restaurant'), false, 'an upstream word is not one of ours')
  assert.equal(isCategory(undefined), false)
})

test('the leaf wins where it names a sight the coarse value cannot', () => {
  /* "arts_and_entertainment" and "geographic_entities" describe a sector; the
     leaf is the only field that knows this is a museum or a lookout, and
     "sights nearby" is exactly what those two are for. */
  assert.equal(categoryFor({ basic: 'arts_and_entertainment', leaf: 'museum' }), 'museum')
  assert.equal(categoryFor({ basic: 'geographic_entities', leaf: 'scenic_lookout' }), 'viewpoint')
  assert.equal(categoryFor({ basic: 'shopping', leaf: 'art_gallery' }), 'gallery')
  assert.equal(categoryFor({ basic: 'nature_reserve', leaf: 'observation_deck' }), 'viewpoint')
  assert.equal(categoryFor({ basic: 'park', leaf: 'historic_castle' }), 'historic')
  assert.equal(categoryFor({ basic: 'community_and_government', leaf: 'cathedral' }), 'religious')
})

test('the coarse value decides the ordinary cases', () => {
  assert.equal(categoryFor({ basic: 'hotel' }), 'lodging')
  assert.equal(categoryFor({ basic: 'coffee_shop' }), 'cafe')
  assert.equal(categoryFor({ basic: 'christian_place_of_worship' }), 'religious')
  assert.equal(categoryFor({ basic: 'farmers_market' }), 'market')
  assert.equal(categoryFor({ basic: 'airport' }), 'transit')
  assert.equal(categoryFor({ basic: 'dental_clinic' }), 'health')
  assert.equal(categoryFor({ basic: 'museum' }), 'museum')
  assert.equal(categoryFor({ basic: 'beach' }), 'beach')
  assert.equal(categoryFor({ basic: 'library' }), 'services', 'a library is not a sight')
  assert.equal(categoryFor({ basic: 'apartment' }), 'other')
})

test('a coarse value that names a sector defers to the leaf', () => {
  assert.equal(categoryFor({ basic: 'shopping', leaf: 'pizza_restaurant' }), 'food')
  assert.equal(categoryFor({ basic: 'food_and_drink', leaf: 'tea_house' }), 'cafe')
  assert.equal(categoryFor({ basic: 'travel_and_transportation', leaf: 'train_station' }), 'transit')
  assert.equal(categoryFor({ basic: 'sports_and_recreation', leaf: 'golf_course' }), 'sport')
  assert.equal(categoryFor({ basic: 'specialty_store', leaf: 'cheese_shop' }), 'shopping')
  /* And when the leaf knows nothing either, the sector is still better than
     nothing. */
  assert.equal(categoryFor({ basic: 'shopping', leaf: 'unfathomable_thing' }), 'shopping')
  assert.equal(categoryFor({ basic: 'geographic_entities' }), 'nature')
})

test('an unknown pair is other, and never a throw', () => {
  assert.equal(categoryFor({ basic: 'zzz_unknown', leaf: 'qqq_unknown' }), 'other')
  assert.equal(categoryFor({ basic: null, leaf: null }), 'other')
  assert.equal(categoryFor({}), 'other')
  assert.equal(categoryFor(), 'other')
  assert.equal(categoryFor({ basic: '', leaf: '   ' }), 'other')
  assert.equal(categoryFor({ basic: 42, leaf: {} }), 'other')
  /* Whatever comes back is one of the twenty, always. */
  for (const upstream of [
    { basic: 'zzz', leaf: 'qqq' },
    { basic: 'hotel' },
    { leaf: 'taco_restaurant' },
    {},
  ]) {
    assert.equal(isCategory(categoryFor(upstream)), true, JSON.stringify(upstream))
  }
})

test('the value is read whatever case and spacing it arrives in', () => {
  assert.equal(categoryFor({ basic: 'ARTS_AND_ENTERTAINMENT', leaf: '  MUSEUM ' }), 'museum')
  assert.equal(categoryFor({ basic: ' Hotel ' }), 'lodging')
})

test('the leaf rules are anchored: a bar association is not a bar', () => {
  /* A bare `bar` alternative matched the front of the value and filed a law
     firm under drinks. The head noun of these names sits at the end. */
  assert.equal(categoryFor({ basic: 'professional_service', leaf: 'bar_association' }), 'services')
  assert.equal(categoryFor({ basic: 'attorney_or_law_firm', leaf: 'bar_association' }), 'services')
  assert.equal(categoryFor({ basic: null, leaf: 'bar_association' }), 'other')
  assert.equal(categoryFor({ basic: 'shopping', leaf: 'bar_association' }), 'shopping')
  /* The words that should still be claimed. */
  assert.equal(categoryFor({ basic: 'shopping', leaf: 'wine_bar' }), 'bar')
  assert.equal(categoryFor({ basic: 'shopping', leaf: 'sports_bar' }), 'bar')
  assert.equal(categoryFor({ basic: null, leaf: 'bar' }), 'bar')
})

test('the fifteen cases the mapping is built around', () => {
  const cases = [
    ['professional_service', 'bar_association', 'services'],
    ['arts_and_entertainment', 'museum', 'museum'],
    ['geographic_entities', 'scenic_lookout', 'viewpoint'],
    ['amusement_park', 'theme_park', 'entertainment'],
    ['arts_and_entertainment', 'theme_park', 'entertainment'],
    ['sports_and_recreation', 'skate_park', 'sport'],
    ['hotel', 'hotel', 'lodging'],
    ['coffee_shop', 'coffee_shop', 'cafe'],
    ['shopping', 'pizza_restaurant', 'food'],
    ['shopping', 'wine_bar', 'bar'],
    ['farmers_market', 'farmers_market', 'market'],
    ['dental_clinic', 'dentist', 'health'],
    ['police_station', 'police_station', 'services'],
    ['national_park', 'national_park', 'nature'],
    [null, null, 'other'],
  ]
  for (const [basic, leaf, expected] of cases) {
    assert.equal(categoryFor({ basic, leaf }), expected, `${basic} / ${leaf}`)
  }
})

test('the specific-and-built leaf rules are read before the open-air one', () => {
  /* The generic outdoors rule sees the word "park" in all three of these. It
     must be asked last, or a theme park becomes a meadow. */
  assert.equal(categoryFor({ basic: 'arts_and_entertainment', leaf: 'theme_park' }), 'entertainment')
  assert.equal(categoryFor({ basic: null, leaf: 'theme_park' }), 'entertainment')
  assert.equal(categoryFor({ basic: null, leaf: 'skate_park' }), 'sport')
  assert.equal(categoryFor({ basic: null, leaf: 'national_park' }), 'nature')
  assert.equal(categoryFor({ basic: 'travel_and_transportation', leaf: 'car_park' }), 'transit')
})

test('two categories are related when a source calling it the other is an opinion', () => {
  assert.equal(relatedCategories('food', 'cafe'), true)
  assert.equal(relatedCategories('museum', 'historic'), true)
  assert.equal(relatedCategories('food', 'health'), false)
  assert.equal(relatedCategories('x', 'x'), true, 'anything is itself, ours or not')
  assert.equal(relatedCategories('museum', 'museum'), true)
  assert.equal(relatedCategories('nature', 'viewpoint'), true)
  assert.equal(relatedCategories('health', 'services'), true)
  assert.equal(relatedCategories('lodging', 'museum'), false)
  assert.equal(relatedCategories('beach', 'bar'), false)
  /* Symmetric, both ways round, for every pair of the twenty. */
  for (const a of CATEGORIES) {
    for (const b of CATEGORIES) {
      assert.equal(relatedCategories(a, b), relatedCategories(b, a), `${a} / ${b}`)
    }
  }
  assert.equal(relatedCategories(null, 'food'), false)
  assert.equal(relatedCategories(undefined, undefined), true)
})
