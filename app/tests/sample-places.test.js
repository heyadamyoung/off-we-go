import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { SAMPLE_PINS, samplePins } from '../src/sample-places-core'

/* The demo's pins. It has no server to ask, and before this it filled the map
   by walking Wikipedia from the browser — which is the thing the places layer
   exists to stop doing. These are canned, like every other part of the sample
   trip, and they have to be the same shape the server sends or the map would
   need two code paths to draw one thing. */

const AMSTERDAM = { west: 4.85, south: 52.35, east: 4.92, north: 52.39 }

test('a sample pin is shaped exactly like one from the server', () => {
  for (const pin of SAMPLE_PINS) {
    assert.deepEqual(Object.keys(pin).sort(), [
      'big',
      'category',
      'confidence',
      'id',
      'lat',
      'lng',
      'minzoom',
      'name',
      'rank',
    ])
    assert.ok(pin.id && typeof pin.id === 'string', pin.name)
    assert.ok(pin.confidence > 0 && pin.confidence <= 1, `${pin.name} ${pin.confidence}`)
    assert.ok(Number.isFinite(pin.lng) && Number.isFinite(pin.lat), pin.name)
    /* The zoom it earns its dot at, and the rank that settles a collision.
       Both come from the server for a real pin; the demo has no server, so
       these are the canned equivalents and they have to be real numbers in
       the range the map layer reads — see the note in sample-places-core. */
    assert.ok(pin.minzoom >= 11 && pin.minzoom <= 18, `${pin.name} ${pin.minzoom}`)
    assert.ok(Number.isInteger(pin.rank) && pin.rank > 0, `${pin.name} ${pin.rank}`)
  }
  /* Ids are what the map keys its features on, so two the same would drop a
     pin and nobody would know which. */
  assert.equal(new Set(SAMPLE_PINS.map(pin => pin.id)).size, SAMPLE_PINS.length)
})

test('a viewport gets what is inside it, best first', () => {
  const found = samplePins(AMSTERDAM)
  assert.ok(found.length > 10, `${found.length} pins in Amsterdam`)
  for (const pin of found) {
    assert.ok(pin.lng >= AMSTERDAM.west && pin.lng <= AMSTERDAM.east, pin.name)
    assert.ok(pin.lat >= AMSTERDAM.south && pin.lat <= AMSTERDAM.north, pin.name)
  }
  for (let at = 1; at < found.length; at += 1) {
    assert.ok(found[at - 1].confidence >= found[at].confidence, `${found[at].name} out of order`)
  }
  /* And all of them. There is no limit to pass: what a viewport shows is
     decided by the zoom each place's kind is drawn from and by nothing else,
     on the server and here — see places/rank.js EARLIEST_ZOOM. */
  assert.equal(
    found.length,
    samplePins({ west: -180, south: -90, east: 180, north: 90 }).filter(
      pin =>
        pin.lng >= AMSTERDAM.west &&
        pin.lng <= AMSTERDAM.east &&
        pin.lat >= AMSTERDAM.south &&
        pin.lat <= AMSTERDAM.north,
    ).length,
    'the demo cut a viewport short',
  )
})

test('a box somewhere else is empty rather than everything', () => {
  assert.deepEqual(samplePins({ west: -105, south: 50, east: -104, north: 51 }), [])
})

test('zoomed out, the everyday places drop away and the landmarks stay', () => {
  const headline = samplePins(AMSTERDAM, { headline: true })
  const all = samplePins(AMSTERDAM)
  assert.ok(headline.length < all.length, 'a zoom out drew everything')
  assert.ok(
    headline.some(pin => pin.name === 'Rijksmuseum'),
    'the Rijksmuseum did not survive a zoom out',
  )
  for (const pin of headline) assert.equal(pin.big, true)
  for (const kind of ['cafe', 'bar', 'shopping']) {
    assert.ok(!headline.some(pin => pin.category === kind), `a ${kind} survived a zoom out`)
  }
})

test('the demo thins the way the server does, and cannot drift from it', async () => {
  /* The demo has no server to ask, so it carries its own copy of the rule —
     which is a thing to be uneasy about and the reason this exists. It used
     to carry a copy of a *table* of category zooms, and when that table was
     deleted for being wrong the copy would have sat there being wrong on its
     own. A copy of a rule can at least be held to the original's constants.

     Read out of the source rather than imported, because rank.js is server
     code and this suite is the client's. */
  const server = await readFile(new URL('../server/src/places/rank.js', import.meta.url), 'utf8')
  const demo = await readFile(new URL('../src/sample-places-core.ts', import.meta.url), 'utf8')

  /* Neither side ranks any more. A quota on one and not the other would be a
     demo of a different product, and a quota on both would be two copies of a
     rule this stopped having. */
  assert.ok(!/LABEL_PER_TILE/.test(server), 'the server thins by a per-tile quota again')
  assert.ok(!/SAMPLE_PER_TILE|squareOf/.test(demo), 'the demo thins by a per-tile quota again')
  /* And the table that was deleted is not quietly still here. */
  assert.ok(!/MARK_ZOOM/.test(demo), 'no copy of the zoom table the server no longer has')
  assert.ok(!/MARK_ZOOM/.test(server), 'and the server does not have one either')

  /* The ceilings, category by category. Not a spot check: the whole table,
     because the failure this guards against is one category quietly drifting
     and a café reappearing on the map from across a city — which is exactly
     what happened, and the browser suite caught it only because somebody had
     written a test about that one café. */
  const ceilings = source => {
    /* Anchored on the declaration, not on the name appearing anywhere: a
       comment that mentions EARLIEST_ZOOM used to be enough to match, and
       then the braces it found were the next function's. */
    const block = /const (?:EARLIEST_ZOOM|SAMPLE_EARLIEST)[^{]*\{([^}]*)\}/.exec(source)
    assert.ok(block, 'the ceilings are where the guard expects them')
    return Object.fromEntries(
      [...block[1].matchAll(/^\s*(\w+):\s*(\d+),/gm)].map(([, kind, zoom]) => [kind, zoom]),
    )
  }
  const onTheServer = ceilings(server)
  const inTheDemo = ceilings(demo)
  assert.ok(Object.keys(onTheServer).length >= 15, 'every category has a ceiling')
  assert.deepEqual(inTheDemo, onTheServer, 'the demo caps each kind exactly as the server does')

  /* And the rule the ceilings exist to enforce, stated once so that loosening
     the whole table is a deliberate act rather than a slip. */
  for (const kind of ['cafe', 'bar', 'food']) {
    assert.ok(
      Number(onTheServer[kind]) >= 14,
      `a ${kind} is never visible from across a city (${onTheServer[kind]})`,
    )
  }
  for (const kind of ['museum', 'sights', 'historic']) {
    assert.equal(Number(onTheServer[kind]), 11, `a ${kind} is visible across a city`)
  }

  /* Every pin lands exactly on its kind's zoom — not near it, on it. There is
     no density to nudge it and nothing else the number could come from, which
     is the property that replaced the ranking: what a place is decides when it
     is drawn, and where it happens to stand decides nothing. */
  for (const pin of SAMPLE_PINS) {
    assert.equal(
      pin.minzoom,
      Number(onTheServer[pin.category] ?? onTheServer.other),
      `${pin.name} (${pin.category}) is not drawn from its kind's zoom`,
    )
  }

  /* And the one the browser suite caught: a café beside the Rijksmuseum from
     across Amsterdam, because twenty-two places left room for it. */
  const cafe = SAMPLE_PINS.find(pin => pin.name === 'Winkel 43')
  const museum = SAMPLE_PINS.find(pin => pin.name === 'Rijksmuseum')
  assert.ok(cafe && museum, 'the two the rule is about are both in the sample')
  assert.equal(museum.minzoom, 11, 'the museum is visible across the city')
  assert.ok(cafe.minzoom >= 14, `the café waits for its street (${cafe.minzoom})`)
})
