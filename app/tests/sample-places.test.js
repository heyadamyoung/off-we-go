import assert from 'node:assert/strict'
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
  /* A limit is the best few, not an arbitrary few. */
  assert.deepEqual(
    samplePins(AMSTERDAM, { limit: 3 }).map(pin => pin.name),
    found.slice(0, 3).map(pin => pin.name),
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
