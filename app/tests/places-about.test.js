import assert from 'node:assert/strict'
import test from 'node:test'
import { aboutFrom, placeFrom } from '../src/places-wire.ts'

/* Reading the picture and the paragraph off the wire.
 *
 * The rule worth testing is the refusal. The server only stores a photograph
 * it can credit, so a picture arriving here with no credit means something
 * went wrong in between — and the safe failure is a card with no photograph,
 * never somebody's photograph with no name on it. */

const credit = {
  text: 'Jane Photographer · Wikimedia Commons · CC BY-SA 4.0',
  author: 'Jane Photographer',
  license: 'CC BY-SA 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
  source: 'Wikimedia Commons',
  sourceUrl: 'https://commons.wikimedia.org/wiki/File:A.jpg',
}

const about = {
  status: 'ready',
  waiting: false,
  description: {
    text: 'Edinburgh Castle is a historic castle in Edinburgh, Scotland.',
    source: 'Wikipedia',
    sourceUrl: 'https://en.wikipedia.org/wiki/Edinburgh_Castle',
    attribution: { text: 'Wikipedia · CC BY-SA 4.0', license: 'CC BY-SA 4.0' },
  },
  images: [
    {
      url: 'https://upload.wikimedia.org/a.jpg',
      thumbUrl: 'https://upload.wikimedia.org/a-t.jpg',
      width: 2400,
      height: 1600,
      attribution: credit,
    },
  ],
}

test('what a card is given', async t => {
  await t.test('takes the paragraph, the picture and both credits', () => {
    const read = aboutFrom(about)
    assert.equal(read.status, 'ready')
    assert.equal(read.waiting, false)
    assert.match(read.description.text, /^Edinburgh Castle is a historic castle/)
    assert.equal(read.description.attribution.license, 'CC BY-SA 4.0')
    assert.equal(read.images[0].attribution.author, 'Jane Photographer')
    assert.equal(read.images[0].thumbUrl, 'https://upload.wikimedia.org/a-t.jpg')
  })

  /* The one that matters. */
  await t.test('drops a picture that arrives with no credit', () => {
    const read = aboutFrom({ ...about, images: [{ url: 'https://example.com/x.jpg' }] })
    assert.deepEqual(read.images, [], 'no credit, no picture')
  })

  await t.test('drops a credit with no licence on it', () => {
    const read = aboutFrom({
      ...about,
      images: [{ url: 'https://example.com/x.jpg', attribution: { text: 'Somebody' } }],
    })
    assert.deepEqual(read.images, [])
  })

  await t.test('a place with nothing found yet is waiting, not broken', () => {
    const read = aboutFrom({ status: 'pending', waiting: true, description: null, images: [] })
    assert.equal(read.description, null)
    assert.deepEqual(read.images, [])
    assert.equal(read.waiting, true)
  })

  /* `barren` is an answer: we looked and there is nothing. The card should
     stop waiting rather than spin for ever. */
  await t.test('barren is finished, not waiting', () => {
    const read = aboutFrom({ status: 'barren', waiting: false, description: null, images: [] })
    assert.equal(read.status, 'barren')
    assert.equal(read.waiting, false)
  })

  await t.test('nothing at all is nothing, not a crash', () => {
    assert.equal(aboutFrom(null), null)
    assert.equal(aboutFrom('some string'), null)
  })

  /* Missing `waiting` means an older server that does not send it; assume we
     are still waiting rather than telling somebody there is nothing. */
  await t.test('assumes it is still waiting when the server did not say', () => {
    assert.equal(aboutFrom({ images: [] }).waiting, true)
  })
})

test('a whole place answer', async t => {
  const payload = {
    place: { id: 'p1', name: 'Edinburgh Castle', category: 'historic', lat: 55.9486, lng: -3.1999 },
    about,
  }

  await t.test('carries the place and what we know about it together', () => {
    const place = placeFrom(payload)
    assert.equal(place.name, 'Edinburgh Castle')
    assert.equal(place.about.images.length, 1)
    assert.match(place.about.description.text, /historic castle/)
  })

  await t.test('a place with no about block is still a place', () => {
    const place = placeFrom({ place: payload.place })
    assert.equal(place.name, 'Edinburgh Castle')
    assert.equal(place.about, undefined)
  })
})
