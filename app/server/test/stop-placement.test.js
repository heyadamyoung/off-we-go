import assert from 'node:assert/strict'
import test from 'node:test'
import { pinAfter, pointOf, stopForPhoto } from '../src/stop-placement.js'

/* Amsterdam, because the distances between these are real ones: the Anne
   Frank House and the Westerkerk are next door to each other, the Rijksmuseum
   is a mile and a half south, and Central Station is a different walk again. */
const anneFrank = { id: 'anne', name: 'Anne Frank House', lng: 4.8839, lat: 52.3752 }
const westerkerk = { id: 'wester', name: 'Westerkerk', lng: 4.8836, lat: 52.3747 }
const rijksmuseum = { id: 'rijks', name: 'Rijksmuseum', lng: 4.8852, lat: 52.36 }
const centraal = { id: 'centraal', name: 'Centraal', lng: 4.9003, lat: 52.379 }
const stops = [anneFrank, westerkerk, rijksmuseum, centraal]

test('a photograph that knows where it was taken is filed nowhere', () => {
  /* This used to be the opposite: a picture taken within four hundred metres
     of an itinerary item was filed at it, and the closest won when several
     were in range.

     It reads well and it is wrong. A photograph that knows where it was taken
     is already somewhere — that is the most precise thing anybody has about
     it — and filing it at a stop replaced that with the stop's own point
     everywhere the trip is drawn. Stand outside the Rijksmuseum and photograph
     the street, the bikes, your family, the sky, and all of it collapses onto
     the museum's pin. Worse, it happened on a pass that reruns: the picture
     appeared where it was taken, and after a reload it had moved. */
  assert.equal(stopForPhoto({ lng: 4.8852, lat: 52.36 }, stops), null, 'at the Rijksmuseum itself')
  assert.equal(stopForPhoto({ lng: 4.8838, lat: 52.3751 }, stops), null, 'a courtyard from two')
  assert.equal(stopForPhoto({ lng: 2.3522, lat: 48.8566 }, stops), null, 'Paris')

  // Including one arriving with a link some other client guessed at.
  assert.equal(stopForPhoto({ lng: 4.8852, lat: 52.36, stopId: 'centraal' }, stops), null)
})

test('a photograph with no point keeps the link it came with', () => {
  /* There is nothing to compute from, so discarding what somebody else knew
     would be destroying information in order to look decisive. This is the
     only kind of row an itinerary link is still doing work for: no
     coordinates, so the stop is the only idea anyone has of where it was. */
  assert.equal(stopForPhoto({ stopId: 'rijks' }, stops), 'rijks')
  assert.equal(stopForPhoto({ lng: null, lat: null, stopId: 'rijks' }, stops), 'rijks')
  assert.equal(stopForPhoto({}, stops), null)
})

test('a pinned photograph keeps where a person put it, coordinates or not', () => {
  /* Somebody looked at the picture and said where it goes. That outranks
     everything here, and a correction the next itinerary edit undoes is not a
     correction. It is now the only way a located photograph gets a stop at
     all. */
  assert.equal(stopForPhoto({ stopId: 'rijks', stopPinned: true }, stops), 'rijks')
  assert.equal(
    stopForPhoto({ lng: 4.8852, lat: 52.36, stopId: 'centraal', stopPinned: true }, stops),
    'centraal',
  )

  // Including a person saying it belongs nowhere, which also has to stick.
  assert.equal(
    stopForPhoto({ lng: 4.8852, lat: 52.36, stopId: null, stopPinned: true }, stops),
    null,
  )

  /* Handing one back to the rule now means unfiling it, because the rule has
     nothing to say about a photograph that knows where it was. */
  assert.equal(
    stopForPhoto({ lng: 4.8852, lat: 52.36, stopId: 'centraal', stopPinned: false }, stops),
    null,
  )
})

test('a point that is not a point is not a point', () => {
  assert.equal(pointOf(null), null)
  assert.equal(pointOf({}), null)
  assert.equal(pointOf({ lng: 4.88, lat: null }), null)
  assert.equal(pointOf({ lng: 'four', lat: 52 }), null)
  assert.equal(pointOf({ lng: Number.NaN, lat: 52 }), null)
  assert.equal(pointOf({ lng: 200, lat: 52 }), null, 'off the edge of the world')
  assert.deepEqual(pointOf({ lng: 4.88, lat: 52.37 }), { lng: 4.88, lat: 52.37 })
  // Zero is a real place, and the falsy check that drops it is the classic bug.
  assert.deepEqual(pointOf({ lng: 0, lat: 0 }), { lng: 0, lat: 0 })
})

test('a row that is barely a row is answered, not thrown at', () => {
  assert.equal(stopForPhoto(null, stops), null)
  assert.equal(stopForPhoto(undefined, stops), null)
  assert.equal(stopForPhoto({ lng: 4.88, lat: 52.37 }, []), null)
  assert.equal(stopForPhoto({ lng: 4.88, lat: 52.37 }, null), null)
  assert.equal(stopForPhoto({ stopId: 'rijks' }, null), 'rijks')
})

test('naming a stop is what pins it', () => {
  /* Nothing automatic files a photograph any more, so a stop arriving as a
     change is always somebody saying where a picture goes. Callers do not have
     to remember the flag, because the one that forgets is the one that quietly
     reverts a correction. */
  assert.equal(pinAfter({ stopId: 'rijks' }), true)
  assert.equal(pinAfter({ stopId: null }), true)

  // A caption is not a filing, and must not disturb one.
  assert.equal(pinAfter({ caption: 'the night watch' }), undefined)
  assert.equal(pinAfter({}), undefined)

  // Saying it outright wins either way — this is how it is handed back.
  assert.equal(pinAfter({ stopPinned: false }), false)
  assert.equal(pinAfter({ stopId: 'rijks', stopPinned: false }), false)
  assert.equal(pinAfter({ stopPinned: true }), true)
})
