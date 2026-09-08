import assert from 'node:assert/strict'
import test from 'node:test'
import { createMediaRefresher, mediaPathOf } from '../src/media-refresh-core.ts'

const signed = (path, at = 1) =>
  `https://offwego.example/api/media/${path}?expires=${at}&signature=abc`

test('the storage path is read back out of a signed link, and only ours', () => {
  assert.equal(mediaPathOf(signed('trip-1/p1.jpg')), 'trip-1/p1.jpg')
  assert.equal(mediaPathOf(signed('trip-1/p1.thumb.jpg')), 'trip-1/p1.thumb.jpg')
  assert.equal(mediaPathOf('/api/media/trip-1/clip.mp4?expires=2'), 'trip-1/clip.mp4')
  // A path with a space or an accent survives the round trip.
  assert.equal(mediaPathOf(signed('trip-1/a%20b.jpg')), 'trip-1/a b.jpg')

  // Anything that is not one of our links has no path to ask about.
  assert.equal(mediaPathOf('blob:https://offwego.example/1234'), null)
  assert.equal(mediaPathOf('data:image/gif;base64,R0lGOD'), null)
  assert.equal(mediaPathOf('https://upload.wikimedia.org/a/b.jpg'), null)
  assert.equal(mediaPathOf(''), null)
})

/** Runs the batch on demand, so the test drives the clock rather than waiting. */
const manual = () => {
  const pending = []
  return {
    schedule: flush => {
      pending.push(flush)
    },
    run: () => {
      for (const flush of pending.splice(0)) flush()
    },
  }
}

test('a screenful of dead links asks once, not once each', async () => {
  const clock = manual()
  const asked = []
  const refresher = createMediaRefresher({
    schedule: clock.schedule,
    async fetchLinks(paths) {
      asked.push(paths)
      return Object.fromEntries(paths.map(path => [path, `${signed(path, 999)}-fresh`]))
    },
  })

  const wanted = ['t/a.jpg', 't/b.jpg', 't/c.jpg'].map(path => refresher.refresh(signed(path)))
  // The same tile failing twice must not become two entries in the batch.
  const duplicate = refresher.refresh(signed('t/a.jpg'))
  clock.run()

  const links = await Promise.all([...wanted, duplicate])
  assert.equal(asked.length, 1, 'one round trip for the whole grid')
  assert.deepEqual(asked[0], ['t/a.jpg', 't/b.jpg', 't/c.jpg'])
  assert.equal(refresher.calls, 1)
  assert.ok(links[0].endsWith('-fresh'))
  assert.equal(links[0], links[3], 'both waiters on one path get the same answer')
})

test('a path the server will not re-sign is asked about once and then left alone', async () => {
  const clock = manual()
  let rounds = 0
  const refresher = createMediaRefresher({
    schedule: clock.schedule,
    async fetchLinks() {
      rounds++
      return {} // deleted, or not this reader's to see
    },
  })

  const first = refresher.refresh(signed('t/gone.jpg'))
  clock.run()
  assert.equal(await first, null)

  // Asking again would be a loop against a server that already said no.
  const second = refresher.refresh(signed('t/gone.jpg'))
  clock.run()
  assert.equal(await second, null)
  assert.equal(rounds, 1, 'the refusal is remembered')
})

test('a refresh that itself fails leaves the tile alone rather than throwing', async () => {
  const clock = manual()
  const refresher = createMediaRefresher({
    schedule: clock.schedule,
    async fetchLinks() {
      throw new Error('offline')
    },
  })
  const answer = refresher.refresh(signed('t/a.jpg'))
  clock.run()
  assert.equal(await answer, null, 'no link, and no unhandled rejection either')
})
