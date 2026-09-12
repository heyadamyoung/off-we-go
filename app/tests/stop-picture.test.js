import assert from 'node:assert/strict'
import test from 'node:test'
import { chosenPicture, pictureChoices, stillOf } from '../src/stop-picture-core.ts'

const photo = (id, extra = {}) => ({ id, by: 'Adam', src: `/api/media/p/${id}.jpg`, ...extra })

test('a photograph offers itself and a film offers its poster', () => {
  /* A film is a perfectly good answer to "what does this place look like" —
     its poster is a frame of the place, taken there, by somebody on the trip. */
  assert.equal(stillOf(photo(1)), '/api/media/p/1.jpg')
  assert.equal(
    stillOf({ id: 2, kind: 'video', src: '/api/media/v/2.mp4', posterSrc: '/api/media/v/2.jpg' }),
    '/api/media/v/2.jpg',
  )
  // A film still being made has no frame to offer yet, so it offers nothing.
  assert.equal(stillOf({ id: 3, kind: 'video', src: '/api/media/v/3.mp4' }), null)
  assert.equal(stillOf({ id: 4 }), null)
})

test('the pictures already filed at this stop are offered first', () => {
  /* Somebody put them there. A stop's picture is meant to be a picture of the
     stop, and the shortest path to one is the pile that is already about it. */
  const photos = [
    photo(1, { seq: 1 }),
    photo(2, { seq: 2, stopId: 'castle' }),
    photo(3, { seq: 3 }),
    photo(4, { seq: 4, stopId: 'castle' }),
  ]
  assert.deepEqual(
    pictureChoices(photos, 'castle').map(choice => choice.id),
    [4, 2, 3, 1],
  )
  assert.deepEqual(
    pictureChoices(photos, 'castle').map(choice => choice.here),
    [true, true, false, false],
  )
})

test('with no stop chosen yet the whole trip is offered, newest first', () => {
  const photos = [photo(1, { seq: 1 }), photo(3, { seq: 3 }), photo(2, { seq: 2 })]
  assert.deepEqual(
    pictureChoices(photos, null).map(choice => choice.id),
    [3, 2, 1],
  )
})

test('nothing is offered that another person could not see', () => {
  /* The whole point of the field: a stop's picture is stored on the server and
     drawn for everyone on the trip. A blob: URL is this tab and this tab only
     — it is how a photograph still going up is drawn before it lands — so
     storing one gives the stop a picture that is broken for everybody else and
     for this person as soon as they reload. */
  const photos = [
    photo(1, { seq: 1, src: 'blob:https://offwego.to/9a8b' }),
    photo(2, { seq: 2, src: 'data:image/jpeg;base64,/9j/4AAQ' }),
    photo(3, { seq: 3, src: '' }),
    photo(4, { seq: 4 }),
  ]
  assert.deepEqual(
    pictureChoices(photos, null).map(choice => choice.id),
    [4],
  )
  assert.deepEqual(pictureChoices([], null), [])
  assert.deepEqual(pictureChoices(null, null), [])
})

test('choosing one hands back the picture and takes the credit off', () => {
  /* The stop may already be wearing a picture looked up from Wikipedia, and
     that link is drawn as a caption beside it. Leave it behind and somebody's
     own photograph is captioned as somebody else's work. */
  assert.deepEqual(chosenPicture('/api/media/p/7.jpg'), {
    src: '/api/media/p/7.jpg',
    sourceUrl: null,
  })
  assert.equal(chosenPicture('blob:https://offwego.to/9a8b'), null)
  assert.equal(chosenPicture('data:image/jpeg;base64,/9j/'), null)
  assert.equal(chosenPicture(''), null)
  assert.equal(chosenPicture(null), null)
  assert.equal(chosenPicture(undefined), null)
})
