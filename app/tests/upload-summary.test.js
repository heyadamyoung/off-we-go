import assert from 'node:assert/strict'
import test from 'node:test'
import { placementSentence, summarise } from '../src/upload-summary-core.ts'

const at = (stopId, stopName) => ({
  previewPoint: [4.88, 52.36],
  hasEmbeddedGps: true,
  stopId,
  stopName,
})
const nowhere = () => ({ previewPoint: null, hasEmbeddedGps: false, stopId: null })

test('a batch is counted, not sampled', () => {
  /* The sheet used to answer "where will these go" with a map of one of them.
     That is the truth about photograph seven and silence about the rest. */
  const summary = summarise([at('r', 'Rijksmuseum'), at('r', 'Rijksmuseum'), nowhere()])
  assert.deepEqual(summary, {
    total: 3,
    located: 2,
    unplaced: 1,
    stopName: 'Rijksmuseum',
    atStop: 2,
  })
})

test('the place named is the one most of them land at', () => {
  const summary = summarise([at('r', 'Rijksmuseum'), at('r', 'Rijksmuseum'), at('c', 'Centraal')])
  assert.equal(summary.stopName, 'Rijksmuseum')
  assert.equal(summary.atStop, 2)
})

test('a picture near nothing is located but not grouped', () => {
  const loose = { previewPoint: [2.35, 48.85], hasEmbeddedGps: true, stopId: null }
  const summary = summarise([loose])
  assert.equal(summary.located, 1)
  assert.equal(summary.unplaced, 0)
  assert.equal(summary.stopName, null)
})

test('nothing chosen says nothing', () => {
  assert.deepEqual(summarise([]), {
    total: 0,
    located: 0,
    unplaced: 0,
    stopName: null,
    atStop: 0,
  })
  assert.equal(placementSentence(summarise([])), '')
})

test('the sentence says what will happen and what to do about the rest', () => {
  const sentence = placementSentence(
    summarise([at('r', 'Rijksmuseum'), at('r', 'Rijksmuseum'), nowhere()]),
  )
  assert.match(sentence, /2 go on the map where they were taken/)
  assert.match(sentence, /2 will be grouped at Rijksmuseum/)
  assert.match(sentence, /1 has no location, and can be filed at a place afterwards/)
})

test('all of them placed reads as all of them', () => {
  const sentence = placementSentence(summarise([at('r', 'Rijks'), at('r', 'Rijks')]))
  assert.match(sentence, /^All go on the map/)
  assert.doesNotMatch(sentence, /no location/, 'nothing to apologise for')
})

test('one photograph is spoken to as one photograph', () => {
  assert.match(placementSentence(summarise([at('r', 'Rijks')])), /^It goes on the map/)
  assert.match(placementSentence(summarise([at('r', 'Rijks')])), /One will be grouped at Rijks/)
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
