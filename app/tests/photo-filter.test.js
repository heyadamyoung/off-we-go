import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isVideo,
  kindInForce,
  narrowPhotos,
  nothingShown,
  tallyKinds,
  worthFiltering,
} from '../src/photo-filter-core.ts'

const still = (id, by) => ({ id, by, kind: 'photo' })
const film = (id, by) => ({ id, by, kind: 'video' })
/* Rows that predate the column, and rows written by a client that never knew
   about it. Both are stills, and both turn up on trips that have been going a
   while. */
const old = (id, by) => ({ id, by })

test('a film is a film and everything else is a still', () => {
  assert.equal(isVideo(film('f1')), true)
  assert.equal(isVideo(still('p1')), false)
  assert.equal(isVideo(old('p2')), false, 'no kind at all')
  assert.equal(isVideo({ kind: null }), false)
  assert.equal(isVideo({ kind: 'Video' }), false, 'not the value the column holds')
  assert.equal(isVideo(null), false)
  assert.equal(isVideo(undefined), false)
})

test('the tally counts anything that is not a film as a photograph', () => {
  assert.deepEqual(tallyKinds([still('p1'), film('f1'), old('p2')]), { photo: 2, video: 1 })
  assert.deepEqual(tallyKinds([]), { photo: 0, video: 0 })
  assert.deepEqual(tallyKinds(null), { photo: 0, video: 0 })
})

test('narrowing by kind is only worth offering when it divides something', () => {
  /* Same rule as the faces beside it: one person's photographs is not a
     filter, it is the trip. A Videos button on a trip with no films is a
     button whose only outcome is an empty screen, and the band above the grid
     has one row to spend. */
  assert.equal(worthFiltering({ photo: 4, video: 1 }), true)
  assert.equal(worthFiltering({ photo: 0, video: 3 }), false, 'films only')
  assert.equal(worthFiltering({ photo: 9, video: 0 }), false, 'the ordinary trip')
  assert.equal(worthFiltering({ photo: 0, video: 0 }), false)
})

test('a narrowing you cannot see is not one you are still under', () => {
  /* The control disappears when the last film is deleted. If the choice
     outlived the control, the gallery would sit empty with nothing on the
     screen to undo it. */
  assert.equal(kindInForce({ photo: 4, video: 1 }, 'video'), 'video')
  assert.equal(kindInForce({ photo: 4, video: 0 }, 'video'), 'all')
  assert.equal(kindInForce({ photo: 0, video: 0 }, 'photo'), 'all')
})

const trip = [still('p1', 'Maya'), film('f1', 'Maya'), still('p2', 'Alex'), old('p3', 'Alex')]

test('narrowing takes the person and the kind together', () => {
  const ids = narrowed => narrowed.map(photo => photo.id)
  assert.deepEqual(ids(narrowPhotos(trip, { kind: 'video' })), ['f1'])
  assert.deepEqual(ids(narrowPhotos(trip, { kind: 'photo' })), ['p1', 'p2', 'p3'])
  assert.deepEqual(ids(narrowPhotos(trip, { by: 'Alex' })), ['p2', 'p3'])
  assert.deepEqual(ids(narrowPhotos(trip, { by: 'Maya', kind: 'video' })), ['f1'])
  // A combination nobody took anything under is empty rather than ignored.
  assert.deepEqual(ids(narrowPhotos(trip, { by: 'Alex', kind: 'video' })), [])
  // And the order they arrived in survives, because something else sorts them.
  assert.deepEqual(ids(narrowPhotos(trip, {})), ['p1', 'f1', 'p2', 'p3'])
})

test('narrowing to nothing hands back the very same list', () => {
  /* Not a copy of it. The grid below re-groups, re-measures and re-windows
     whenever the array it was handed is a different one, so a gallery under no
     filter at all must not be handed a new array on every render. */
  assert.equal(narrowPhotos(trip, { by: null, kind: 'all' }), trip)
  assert.equal(narrowPhotos(trip, {}), trip)
  assert.equal(narrowPhotos(trip), trip)
})

test('an empty gallery says which narrowing emptied it', () => {
  assert.equal(nothingShown({ by: 'Alex' }), 'Nothing from Alex on this trip.')
  assert.equal(nothingShown({ by: 'Alex', kind: 'video' }), 'No videos from Alex on this trip.')
  assert.equal(nothingShown({ by: 'Alex', kind: 'photo' }), 'No photos from Alex on this trip.')
  assert.equal(nothingShown({ kind: 'video' }), 'No videos on this trip yet.')
  assert.equal(nothingShown({ kind: 'photo' }), 'No photos on this trip yet.')
  assert.equal(nothingShown({}), 'Nothing on this trip yet.')
})
