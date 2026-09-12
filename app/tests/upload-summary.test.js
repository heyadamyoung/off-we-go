import assert from 'node:assert/strict'
import test from 'node:test'
import { placementSentence, summarise } from '../src/upload-summary-core.ts'

const located = () => ({ previewPoint: [4.88, 52.36], hasEmbeddedGps: true })
const nowhere = () => ({ previewPoint: null, hasEmbeddedGps: false })

test('a batch is counted, not sampled', () => {
  /* The sheet used to answer "where will these go" with a map of one of them.
     That is the truth about photograph seven and silence about the rest. */
  assert.deepEqual(summarise([located(), located(), nowhere()]), {
    total: 3,
    located: 2,
    unplaced: 1,
  })
})

test('nothing is promised about itinerary items any more', () => {
  /* It used to say "2 will be grouped at the Rijksmuseum", counted from the
     nearest stop each photograph was about to be filed at. Nothing files a
     located photograph now — it goes on the map where it was taken, which is
     the whole of what the first sentence already says — so the clause would
     be a promise the app no longer keeps. */
  const sentence = placementSentence(summarise([located(), located(), nowhere()]))
  assert.doesNotMatch(sentence, /grouped/)
  assert.match(sentence, /2 go on the map where they were taken/)
  assert.match(sentence, /1 has no location, and can be filed at a place afterwards/)
})

test('nothing chosen says nothing', () => {
  assert.deepEqual(summarise([]), { total: 0, located: 0, unplaced: 0 })
  assert.equal(placementSentence(summarise([])), '')
})

test('all of them placed reads as all of them', () => {
  const sentence = placementSentence(summarise([located(), located()]))
  assert.match(sentence, /^All go on the map/)
  assert.doesNotMatch(sentence, /no location/, 'nothing to apologise for')
})

test('one photograph is spoken to as one photograph', () => {
  assert.match(placementSentence(summarise([located()])), /^It goes on the map/)
})

test('a picture with nothing to go on is told the truth, not the opposite of it', () => {
  /* The first draft of this said "It has a location" about a photograph that
     had none — a sentence assembled from a ternary in the wrong order. */
  const one = placementSentence(summarise([nowhere()]))
  assert.match(one, /^It has no location/)
  assert.doesNotMatch(one, /goes on the map/)

  const several = placementSentence(summarise([nowhere(), nowhere()]))
  assert.match(several, /^None of them have a location/)
  assert.match(several, /file them at a place afterwards/)
})
