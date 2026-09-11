import assert from 'node:assert/strict'
import test from 'node:test'
import {
  STOP_RADIUS_METRES,
  nearestStop,
  nearestStopId,
  pinAfter,
  pointOf,
  stopForPhoto,
} from '../src/stop-placement.js'

/* Amsterdam, because the distances between these are real ones: the Anne
   Frank House and the Westerkerk are next door to each other, the Rijksmuseum
   is a mile and a half south, and Central Station is a different walk again. */
const anneFrank = { id: 'anne', name: 'Anne Frank House', lng: 4.8839, lat: 52.3752 }
const westerkerk = { id: 'wester', name: 'Westerkerk', lng: 4.8836, lat: 52.3747 }
const rijksmuseum = { id: 'rijks', name: 'Rijksmuseum', lng: 4.8852, lat: 52.36 }
const centraal = { id: 'centraal', name: 'Centraal', lng: 4.9003, lat: 52.379 }
const stops = [anneFrank, westerkerk, rijksmuseum, centraal]

test('a photograph taken at a stop belongs to it', () => {
  assert.equal(nearestStopId({ lng: 4.8852, lat: 52.36 }, stops), 'rijks')
  assert.equal(nearestStopId({ lng: 4.9003, lat: 52.379 }, stops), 'centraal')
})

test('within range of several, it belongs to the closest', () => {
  /* The whole reason this is not "the first one that matches". The Anne Frank
     House and the Westerkerk are a courtyard apart, so almost anywhere near
     one is inside the radius of both, and the answer has to be the nearer. */
  const betweenThem = { lng: 4.88375, lat: 52.37505 }
  for (const stop of [anneFrank, westerkerk]) {
    assert.ok(
      nearestStop(betweenThem, [stop]),
      `${stop.name} is not even in range; this proves nothing`,
    )
  }

  assert.equal(nearestStopId({ lng: 4.8838, lat: 52.3751 }, stops), 'anne')
  assert.equal(nearestStopId({ lng: 4.8836, lat: 52.3747 }, stops), 'wester')

  // And the order they arrive in must not change the answer.
  assert.equal(nearestStopId({ lng: 4.8836, lat: 52.3747 }, [...stops].reverse()), 'wester')
})

test('a photograph taken nowhere near anything belongs to nothing', () => {
  /* Filing it under the least-distant stop in the country would be worse than
     leaving it unfiled: a picture from the aeroplane is not "at" the museum. */
  assert.equal(nearestStopId({ lng: 2.3522, lat: 48.8566 }, stops), null, 'Paris')
  assert.equal(nearestStopId({ lng: 4.7683, lat: 52.3105 }, stops), null, 'Schiphol')
})

test('the radius is a real distance, and it is the boundary', () => {
  /* A degree of latitude is about 111km, so this walks north from a stop in
     known metres and checks the edge lands where it claims to. */
  const north = metres => ({ lng: rijksmuseum.lng, lat: rijksmuseum.lat + metres / 111_320 })
  assert.equal(nearestStopId(north(STOP_RADIUS_METRES - 20), stops), 'rijks', 'just inside')
  assert.equal(nearestStopId(north(STOP_RADIUS_METRES + 20), stops), null, 'just outside')
})

test('a tighter or looser radius is honoured', () => {
  /* Someone walking a city wants a smaller one than someone driving a coast,
     and neither should have to edit this file to get it. */
  const nearby = { lng: rijksmuseum.lng, lat: rijksmuseum.lat + 300 / 111_320 }
  assert.equal(nearestStopId(nearby, stops, { radiusMetres: 100 }), null)
  assert.equal(nearestStopId(nearby, stops, { radiusMetres: 1000 }), 'rijks')
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

test('nothing to compare against is answered, not thrown at', () => {
  assert.equal(nearestStopId({ lng: 4.88, lat: 52.37 }, []), null)
  assert.equal(nearestStopId({ lng: 4.88, lat: 52.37 }, null), null)
  assert.equal(nearestStopId(null, stops), null)
  // A stop with no coordinates cannot win, and must not poison the search.
  assert.equal(
    nearestStopId({ lng: 4.8852, lat: 52.36 }, [{ id: 'nowhere' }, rijksmuseum]),
    'rijks',
  )
})

test('a photograph with a point is filed from the point, whatever it arrived claiming', () => {
  /* The point of moving this to the server. Two clients that disagree — an
     old build, a native picker, something posting to the API by hand — must
     not produce two different filings of the same photograph. */
  const atTheRijks = { lng: 4.8852, lat: 52.36, stopId: 'centraal' }
  assert.equal(stopForPhoto(atTheRijks, stops), 'rijks')

  // Including being told, wrongly, that it belongs nowhere.
  assert.equal(stopForPhoto({ lng: 4.8852, lat: 52.36, stopId: null }, stops), 'rijks')

  // And a point genuinely near nothing clears a link that claimed otherwise.
  assert.equal(stopForPhoto({ lng: 2.3522, lat: 48.8566, stopId: 'rijks' }, stops), null)
})

test('a photograph with no point keeps the link it came with', () => {
  /* There is nothing to compute from, so discarding what somebody else knew
     would be destroying information in order to look decisive. */
  assert.equal(stopForPhoto({ stopId: 'rijks' }, stops), 'rijks')
  assert.equal(stopForPhoto({ lng: null, lat: null, stopId: 'rijks' }, stops), 'rijks')
  assert.equal(stopForPhoto({}, stops), null)
})

test('a pinned photograph keeps where a person put it, however far away that is', () => {
  /* The two cases people actually hit: a picture with no coordinates that
     somebody filed by hand, and a picture whose coordinates put it firmly at
     the wrong thing. Both are corrections, and a correction that the next
     stop edit undoes is not a correction. */
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

  // Unpinned is the old behaviour exactly, so nothing already filed moves.
  assert.equal(
    stopForPhoto({ lng: 4.8852, lat: 52.36, stopId: 'centraal', stopPinned: false }, stops),
    'rijks',
  )
})

test('naming a stop is what pins it', () => {
  /* Nothing automatic edits a photograph, so a stop arriving as a change is
     always somebody saying where a picture goes. Callers do not have to
     remember the flag, because the one that forgets is the one that quietly
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
