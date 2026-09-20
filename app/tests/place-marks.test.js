import assert from 'node:assert/strict'
import test from 'node:test'
import {
  familyOf,
  markColour,
  markColourExpression,
  MARK_COLOURS,
  MARK_FAMILIES,
} from '../src/place-marks-core.ts'
import { PLACE_CATEGORIES } from '../src/places-core.ts'

/* What a place looks like on the map.
 *
 * Reported from the road, looking at a city: "ours is just a cluster fuck of
 * dots". Three things were wrong and this file covers one of them — every dot
 * was the same grey, so a street with three cafés and a museum on it looked
 * like four of the same thing. (The other two, the zoom a place earns its dot
 * at and which place wins a collision, are the server's and are asserted in
 * places-rank.test.js.) */

test('every category is coloured, and none of them by accident', () => {
  for (const category of PLACE_CATEGORIES) {
    const family = familyOf(category)
    assert.ok(
      MARK_FAMILIES.includes(family),
      `${category} landed in ${family}, which is not a family`,
    )
    assert.match(markColour(category, 'light'), /^#[0-9A-Fa-f]{6}$/)
    assert.match(markColour(category, 'dark'), /^#[0-9A-Fa-f]{6}$/)
  }
})

test('a category nobody has heard of recedes rather than shouting', () => {
  assert.equal(familyOf('sorcery'), 'everyday')
  assert.equal(familyOf(''), 'everyday')
  // Everyday is the grey one: it is the quietest, which is the point.
  assert.equal(markColour('sorcery', 'light'), MARK_COLOURS.everyday.light)
})

test('the families are what a stranger would guess', () => {
  assert.equal(familyOf('museum'), 'culture')
  assert.equal(familyOf('gallery'), 'culture')
  assert.equal(familyOf('nature'), 'outdoors')
  assert.equal(familyOf('beach'), 'outdoors')
  assert.equal(familyOf('cafe'), 'food')
  assert.equal(familyOf('food'), 'food')
  assert.equal(familyOf('transit'), 'transit')
  assert.equal(familyOf('lodging'), 'lodging')
})

test('no two families share a colour, in either theme', () => {
  for (const theme of ['light', 'dark']) {
    const seen = new Map()
    for (const family of MARK_FAMILIES) {
      const colour = MARK_COLOURS[family][theme].toLowerCase()
      assert.equal(
        seen.get(colour),
        undefined,
        `${family} and ${seen.get(colour)} are both ${colour} in the ${theme} map`,
      )
      seen.set(colour, family)
    }
  }
})

test('the map expression covers every category with no second list to forget', () => {
  const expression = markColourExpression('light')
  assert.equal(expression[0], 'match')
  assert.deepEqual(expression[1], ['get', 'k'])
  // The last entry is the fallback, so anything unmatched is still coloured.
  assert.equal(expression.at(-1), MARK_COLOURS.everyday.light)

  /* Walk the branches the way MapLibre would, and check every real category
     comes out the colour the core says it should. A `match` written by hand
     drifts from the table beside it; this one is built from the table, and
     this is what proves it. */
  const branches = expression.slice(2, -1)
  const resolve = category => {
    for (let at = 0; at < branches.length; at += 2) {
      if (branches[at].includes(category)) return branches[at + 1]
    }
    return expression.at(-1)
  }
  for (const category of PLACE_CATEGORIES) {
    assert.equal(resolve(category), markColour(category, 'light'), `${category} is mis-coloured`)
  }
  assert.equal(resolve('sorcery'), MARK_COLOURS.everyday.light)
})

test('the dark map gets its own values, not the light ones dimmed by the GPU', () => {
  for (const family of MARK_FAMILIES) {
    assert.notEqual(MARK_COLOURS[family].light, MARK_COLOURS[family].dark, family)
  }
  assert.notDeepEqual(markColourExpression('light'), markColourExpression('dark'))
})
