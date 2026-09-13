import assert from 'node:assert/strict'
import test from 'node:test'
import { applyRefilings } from '../src/photo-refile-core.ts'

/* Where the photographs went, after an itinerary edit moved them.

   The server has re-filed the trip on every stop added, moved or deleted since
   it became the authority on filing, and it never said so. The screen that
   asked for the edit went on drawing the old filing until the whole trip was
   loaded again — which reads exactly like the re-filing not happening, and is
   what was reported about moving a stop next to some photographs. */

const photos = [
  { id: 'a', stopId: null, caption: 'the street' },
  { id: 'b', stopId: 's1', caption: 'the hall' },
  { id: 'c', stopId: 's2', caption: 'Paris' },
]

test('a photograph told where it went, goes there', () => {
  const after = applyRefilings(photos, [
    { id: 'a', stopId: 's1' },
    { id: 'b', stopId: null },
  ])

  assert.deepEqual(
    after.map(photo => [photo.id, photo.stopId]),
    [
      ['a', 's1'],
      ['b', null],
      ['c', 's2'],
    ],
  )
  // And nothing else about it is disturbed on the way through.
  assert.equal(after[0].caption, 'the street')
})

test('nothing to apply hands back the very same list', () => {
  /* Not a copy of it. The gallery re-groups, re-measures and re-windows
     whenever it is handed a different array, and most edits move nothing. */
  assert.equal(applyRefilings(photos, []), photos)
  assert.equal(applyRefilings(photos, undefined), photos)
  assert.equal(applyRefilings(photos), photos)
  assert.equal(applyRefilings(photos, null), photos)
})

test('a filing for a photograph nobody is holding is ignored, not invented', () => {
  /* Somebody else's upload, re-filed by the same pass. It will arrive with its
     own row; a placeholder built out of an id would be a photograph with no
     picture. */
  const after = applyRefilings(photos, [{ id: 'unknown', stopId: 's9' }])
  assert.equal(after.length, 3)
  assert.equal(after, photos, 'and nothing changed, so nothing was rebuilt')
})

test('a list that is barely a list is answered, not thrown at', () => {
  assert.deepEqual(applyRefilings([], [{ id: 'a', stopId: 's1' }]), [])
  assert.deepEqual(applyRefilings(null, [{ id: 'a', stopId: 's1' }]), [])
  assert.deepEqual(applyRefilings(photos, [{ stopId: 's1' }]), photos, 'no id, no news')
})
