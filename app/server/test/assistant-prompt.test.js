import test from 'node:test'
import assert from 'node:assert/strict'
import { assistantPrompt } from '../src/assistant.js'

const ask = over =>
  assistantPrompt({
    user: { email: 'adam@outlook.com' },
    trip: { title: 'Netherlands & Scotland', slug: 'nl-scot' },
    now: new Date('2026-09-03T12:00:00Z'),
    messages: [{ role: 'user', text: 'When do we fly?' }],
    ...over,
  })

test('the prompt names the mailbox tools only when a mailbox is connected', () => {
  const without = ask({ mailboxes: 0 })
  assert.ok(!without.includes('search_mailbox'))

  const withOne = ask({ mailboxes: 1 })
  assert.match(withOne, /search_mailbox \/ read_mailbox_message/)
  assert.match(withOne, /read-only/)
  assert.ok(!withOne.includes('list_mailboxes names them'))

  // Two mailboxes is the only time the agent needs telling how to pick one.
  assert.match(ask({ mailboxes: 2 }), /list_mailboxes names them/)
})
