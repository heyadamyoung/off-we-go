import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
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

test('the tile URL carries a generation, so a bad tile can be recalled', async () => {
  /* A tile is cached for an hour in the browser with a day of
     stale-while-revalidate behind it, which is what makes a tiled map quick
     and is also why a wrong one could not be taken back. Squares built over
     ground that had not been ingested yet cached empty, and fixing the server
     does not reach into a phone that already holds the hole — a traveller in
     the Highlands was looking at empty squares the server had been answering
     correctly for an hour. The generation in the URL is the recall: the old
     address is never asked for again. */
  const source = await readFile(new URL('../src/backend-base.ts', import.meta.url), 'utf8')
  assert.match(source, /export const PLACE_TILES_EPOCH = (\d+)/)
  const epoch = Number(/export const PLACE_TILES_EPOCH = (\d+)/.exec(source)[1])
  assert.ok(epoch >= 2, 'the empty-ground tiles were recalled at generation 2')
  /* On both the same-origin and the named-API path, or half the clients go on
     asking the old address. */
  const templates = source.match(/places\/tiles\/\{z\}\/\{x\}\/\{y\}[^`']*/g) || []
  assert.equal(templates.length, 2)
  for (const template of templates) {
    assert.match(template, /\?v=\$\{PLACE_TILES_EPOCH\}/)
  }
})

test('a tile generation and the rule that fills it move together', async () => {
  /* The bug this exists for, reported from the road: "grey dots show at a
     further out zoom, then I scroll in a bit and they disappear, then I zoom
     in more and they come back."
     Nothing in the database was wrong. #219 changed how a mark earns its zoom
     and did not bump the generation in the tile URL, so a browser kept the
     tiles it already had for the zooms it had recently looked at and fetched
     new ones for the rest. Two rules on one screen, a zoom step apart.
     A tile is cached for an hour with a day of stale-while-revalidate behind
     it, and nothing on the server can reach into a phone that already holds
     one. The only recall is a different URL.
     So the pair is written down. Change either number and this fails, which
     is the point: it is a question, not an assertion — "the rule moved, does
     every tile already out there need recalling?" — and the answer this time
     was yes. */
  const rank = await readFile(new URL('../server/src/places/rank.js', import.meta.url), 'utf8')
  const backend = await readFile(new URL('../src/backend-base.ts', import.meta.url), 'utf8')
  const policy = Number(rank.match(/export const ZOOM_POLICY = (\d+)/)?.[1])
  const epoch = Number(backend.match(/export const PLACE_TILES_EPOCH = (\d+)/)?.[1])
  assert.ok(Number.isInteger(policy), 'no ZOOM_POLICY in rank.js')
  assert.ok(Number.isInteger(epoch), 'no PLACE_TILES_EPOCH in backend-base.ts')
  assert.equal(
    `zoom policy ${policy}, tiles epoch ${epoch}`,
    'zoom policy 4, tiles epoch 3',
    'one of these moved without the other being considered — see backend-base.ts',
  )
})

/* Words the map is not allowed to say.
 *
 * "Still loading places here" hung over the map in a glass capsule for as
 * long as the coverage answer said `degraded`, which means "the sweep has
 * not reached this one-degree cell of the planet yet" — a fact about a
 * backfill running on a box in another country, reported to somebody looking
 * at a city. It sat there for days at a time, over a map that was already
 * drawing pins, next to a count that is structurally zero once the pins come
 * from tiles.
 *
 * Asked for twice, in as many words, and this is what stops a third time: a
 * map does not apologise for the parts of the world nobody has finished
 * cataloguing. It draws what it has.
 *
 * Comments are stripped before the check, because the note where the capsule
 * used to be quotes the words on purpose — a removal nobody can find the
 * reason for is one somebody puts back. */
test('the map never says it is still loading places', async () => {
  const roots = ['src/features', 'src/shared', 'src/pages', 'src/widgets']
  const { readdir } = await import('node:fs/promises')
  const path = await import('node:path')
  const here = path.dirname(new URL(import.meta.url).pathname)

  const walk = async dir => {
    const found = []
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return found
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) found.push(...(await walk(full)))
      else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) found.push(full)
    }
    return found
  }

  /* Block and line comments out; string and template contents stay, which is
     the whole point — the ban is on what can reach a screen. */
  const withoutComments = source =>
    source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')

  const banned = /still\s+loading\s+places/i
  const guilty = []
  for (const root of roots) {
    for (const file of await walk(path.join(here, '..', root))) {
      if (banned.test(withoutComments(await readFile(file, 'utf8')))) guilty.push(file)
    }
  }
  assert.deepEqual(guilty, [], `the map says it again in:\n${guilty.join('\n')}`)
})
