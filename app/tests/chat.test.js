import assert from 'node:assert/strict'
import test from 'node:test'
import { QUICK_EMOJI, reactionTurnsOn, toggleReaction } from '../src/chat-core.ts'

const message = reactions => ({ id: 'm1', body: 'hi', at: '', reactions })

test('a tap adds my reaction, a second tap takes it back, counts stay honest', () => {
  let list = [message([])]
  list = toggleReaction(list, 'm1', '❤️')
  assert.deepEqual(list[0].reactions, [{ emoji: '❤️', count: 1, mine: true }])

  // Someone else already loved it: mine joins the count.
  list = [message([{ emoji: '❤️', count: 2, mine: false }])]
  list = toggleReaction(list, 'm1', '❤️')
  assert.deepEqual(list[0].reactions, [{ emoji: '❤️', count: 3, mine: true }])

  // Untoggle: my share leaves, theirs stays.
  list = toggleReaction(list, 'm1', '❤️')
  assert.deepEqual(list[0].reactions, [{ emoji: '❤️', count: 2, mine: false }])

  // The last person out turns off the light.
  list = [message([{ emoji: '🎉', count: 1, mine: true }])]
  list = toggleReaction(list, 'm1', '🎉')
  assert.deepEqual(list[0].reactions, [])

  // Other messages are untouched.
  const both = toggleReaction([message([]), { ...message([]), id: 'm2' }], 'm2', '🔥')
  assert.deepEqual(both[0].reactions, [])
  assert.equal(both[1].reactions[0].emoji, '🔥')
})

test('the tap direction is read from the same state the toggle changes', () => {
  const list = [message([{ emoji: '❤️', count: 1, mine: true }])]
  assert.equal(reactionTurnsOn(list, 'm1', '❤️'), false)
  assert.equal(reactionTurnsOn(list, 'm1', '🎉'), true)
  assert.equal(reactionTurnsOn(list, 'missing', '❤️'), true)
})

test('the quick palette is emoji, short, and free of accidental words', () => {
  assert.ok(QUICK_EMOJI.length >= 6)
  for (const emoji of QUICK_EMOJI) {
    assert.ok(emoji.length <= 16)
    assert.ok(!/[\p{L}\p{N}]/u.test(emoji), `${emoji} contains letters or digits`)
  }
})
