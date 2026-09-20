import assert from 'node:assert/strict'
import test from 'node:test'
import { centreOf, landmarkOf } from '../scripts/osm-landmarks.mjs'

/* Deciding which OSM objects are worth keeping.
 *
 * The table this fills is the haystack the one uncertain hop in the whole
 * enrichment chain searches. Keeping the wrong things makes that hop harder
 * and the table bigger; keeping too few loses places we could have described.
 * Both are decided here, in a pure function, so both can be stated. */

const feature = (properties, geometry = { type: 'Point', coordinates: [-3.1999, 55.9486] }) => ({
  id: 'way/1',
  properties,
  geometry,
})

test('which OSM objects earn a row', async t => {
  await t.test('one that names a Wikidata item does', () => {
    const kept = landmarkOf(feature({ name: 'Edinburgh Castle', wikidata: 'Q209507' }))
    assert.equal(kept.id, 'way/1')
    assert.equal(kept.wikidata, 'Q209507')
    assert.equal(kept.name, 'Edinburgh Castle')
  })

  await t.test('so does one with only an article, a category or its own words', () => {
    assert.ok(landmarkOf(feature({ wikipedia: 'en:Edinburgh Castle' })))
    assert.ok(landmarkOf(feature({ wikimedia_commons: 'Category:Edinburgh Castle' })))
    assert.ok(landmarkOf(feature({ description: 'A ruined tower house above the glen.' })))
    assert.ok(landmarkOf(feature({ image: 'https://example.com/castle.jpg' })))
  })

  /* The table would otherwise be the whole planet, and the matcher would be
     choosing between a hundred post boxes. */
  await t.test('an object carrying nothing we can use earns nothing', () => {
    assert.equal(landmarkOf(feature({ name: 'A Bench', amenity: 'bench' })), null)
    assert.equal(landmarkOf(feature({})), null)
  })

  await t.test('a malformed identifier is not kept as though it were one', () => {
    const kept = landmarkOf(feature({ wikidata: 'not-an-id', description: 'Something real.' }))
    assert.equal(kept.wikidata, null, 'refused, but the description still earns the row')
    assert.equal(
      landmarkOf(feature({ wikipedia: 'no-language-prefix', wikidata: 'Q1' })).wikipedia,
      null,
    )
  })

  await t.test('an object with no id we can write down is skipped', () => {
    assert.equal(
      landmarkOf({ properties: { wikidata: 'Q1' }, geometry: feature({}).geometry }),
      null,
    )
  })
})

test('a point for anything', async t => {
  await t.test('a point is itself', () => {
    assert.deepEqual(centreOf({ type: 'Point', coordinates: [1, 2] }), [1, 2])
  })

  /* A castle is a polygon and the matcher wants somewhere to stand. The
     middle of its extent is well inside a 200-metre gate. */
  await t.test('a polygon is the middle of its extent', () => {
    const square = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [0, 4],
          [4, 4],
          [4, 0],
          [0, 0],
        ],
      ],
    }
    assert.deepEqual(centreOf(square), [2, 2])
  })

  await t.test('a relation of several polygons is the middle of all of them', () => {
    const many = {
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [0, 0],
            [0, 2],
            [2, 2],
            [2, 0],
            [0, 0],
          ],
        ],
        [
          [
            [8, 8],
            [8, 10],
            [10, 10],
            [10, 8],
            [8, 8],
          ],
        ],
      ],
    }
    assert.deepEqual(centreOf(many), [5, 5])
  })

  await t.test('nothing is nothing', () => {
    assert.equal(centreOf(null), null)
    assert.equal(centreOf({ type: 'Polygon', coordinates: [] }), null)
  })
})
