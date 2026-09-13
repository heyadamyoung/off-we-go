import assert from 'node:assert/strict'
import test from 'node:test'
import { placeProvenance } from '../src/photo-place-core.ts'

/* Where a photograph's pin came from, said out loud.
 
   The app has always known this — the column has been there since the server
   became the authority on it — and has never once shown it. So a picture
   sitting at the airport instead of the castle looked exactly like a bug, and
   the only way to find out which of the four answers it actually was, was to
   read the source. */

test('a picture that knows where it was says so, and needs no excuse', () => {
  const found = placeProvenance({ lng: 4.88, lat: 52.36, locationSource: 'exif' })
  assert.equal(found.label, 'The picture’s own GPS')
  assert.equal(found.exact, true)
  assert.equal(found.detail, '')
})

test('a person outranks everything and is not explained away', () => {
  const found = placeProvenance({ lng: 4.88, lat: 52.36, locationSource: 'manual' })
  assert.equal(found.label, 'Where you put it')
  assert.equal(found.exact, true)
  assert.equal(found.detail, '')
})

test('the trail says it is the trip’s position, not the picture’s', () => {
  const found = placeProvenance({
    lng: 4.88,
    lat: 52.36,
    locationSource: 'trail',
    takenAt: '2026-09-13T11:20:00.000Z',
  })
  assert.equal(found.label, 'Where the trip was at the time')
  assert.equal(found.exact, false)
  assert.match(found.detail, /kept its time but not its place/)
})

test('a picture stripped on the way out of the gallery is named as one', () => {
  /* The Android report. The file still carries when it was taken — only the
     GPS tags are taken out of it — so the two cases can be told apart, and
     this is the one worth spelling out because it looks like a bug and is not
     one. */
  const stripped = placeProvenance({
    lng: 4.9,
    lat: 52.37,
    locationSource: 'live',
    takenAt: '2026-09-13T11:20:00.000Z',
  })
  assert.equal(stripped.label, 'Where this was uploaded')
  assert.equal(stripped.exact, false)
  assert.match(stripped.detail, /kept its time but not its place/)
  assert.match(stripped.detail, /strip/)
})

test('a picture with nothing in it at all is named differently', () => {
  /* No capture time either, so there was no readable block rather than a
     block with the place taken out — a screenshot, something sent over a chat
     app, a scan. Nothing to recover and nothing to fix. */
  const bare = placeProvenance({ lng: 4.9, lat: 52.37, locationSource: 'live' })
  assert.equal(bare.label, 'Where this was uploaded')
  assert.match(bare.detail, /no camera details/)
  assert.doesNotMatch(bare.detail, /strip/)
})

test('the capture time is read under either name it travels by', () => {
  /* An upload on its way to the server calls it takenAt; the server sends it
     back as `when`. Reading only one of the two would tell everybody looking
     at a stored photograph that their file had no camera details in it. */
  const stored = placeProvenance({
    lng: 4.9,
    lat: 52.37,
    locationSource: 'live',
    when: '2026-09-13T11:20:00.000Z',
  })
  assert.match(stored.detail, /kept its time but not its place/)
})

test('roughly is admitted to rather than rounded up', () => {
  const rough = placeProvenance({ lng: 4.9, lat: 52.37, locationSource: 'approximate' })
  assert.equal(rough.label, 'Roughly where this was uploaded')
  assert.equal(rough.exact, false)
})

test('a picture with no point is not given a story about one', () => {
  assert.equal(placeProvenance({ locationSource: 'live' }), null)
  assert.equal(placeProvenance({ lng: 4.9, lat: null, locationSource: 'exif' }), null)
  assert.equal(placeProvenance({}), null)
  assert.equal(placeProvenance(null), null)
  // Zero is a real place, and the falsy check that drops it is the classic bug.
  assert.equal(placeProvenance({ lng: 0, lat: 0, locationSource: 'exif' })?.exact, true)
})

test('a point whose source nobody recorded is still a point', () => {
  /* Rows that predate the column. Saying nothing about where it came from
     beats inventing a provenance for it. */
  const old = placeProvenance({ lng: 4.88, lat: 52.36 })
  assert.equal(old.label, 'Placed on the map')
  assert.equal(old.exact, false)
  assert.equal(old.detail, '')
})
