import assert from 'node:assert/strict'
import test from 'node:test'
import { askedQuestion, sendableTranscript, QUESTION_LENGTH_LIMIT } from '../src/assistant-core.ts'

test('a question is trimmed, bounded, and nothing is not a question', () => {
  assert.equal(askedQuestion('  Where do we sleep on Tuesday?  '), 'Where do we sleep on Tuesday?')
  assert.equal(askedQuestion('   '), null)
  assert.equal(askedQuestion(''), null)
  assert.equal(askedQuestion('x'.repeat(QUESTION_LENGTH_LIMIT + 500)).length, QUESTION_LENGTH_LIMIT)
})

const turn = (role, text) => ({ role, text })

test('a short conversation travels whole', () => {
  const messages = [turn('user', 'Hi'), turn('assistant', 'Hello'), turn('user', 'Where next?')]
  assert.deepEqual(sendableTranscript(messages), messages)
})

test('a long afternoon of chat keeps the newest turns and drops the oldest', () => {
  const messages = []
  for (let index = 0; index < 60; index++) {
    messages.push(turn(index % 2 ? 'assistant' : 'user', `turn ${index}`))
  }
  const sent = sendableTranscript(messages, { limit: 10 })
  assert.equal(sent.length, 10)
  assert.deepEqual(sent[sent.length - 1], messages[messages.length - 1])
  assert.deepEqual(sent[0], messages[messages.length - 10])
})

test('one enormous pasted question still goes, alone', () => {
  const messages = [
    turn('user', 'small'),
    turn('assistant', 'small'),
    turn('user', 'y'.repeat(30_000)),
  ]
  const sent = sendableTranscript(messages, { budget: 24_000 })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].role, 'user')
})

test('the character budget drops whole old turns, never splits one', () => {
  const messages = [
    turn('user', 'a'.repeat(9000)),
    turn('assistant', 'b'.repeat(9000)),
    turn('user', 'c'.repeat(9000)),
    turn('assistant', 'd'.repeat(4000)),
    turn('user', 'Where now?'),
  ]
  const sent = sendableTranscript(messages, { budget: 20_000 })
  assert.deepEqual(
    sent.map(message => message.text[0] || 'W'),
    ['c', 'd', 'W'],
  )
})
