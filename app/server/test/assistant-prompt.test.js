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

/* Promising a tool that is not there.
 *
 * The reported symptom was the assistant saying, over and over, that it could
 * not fetch documents from email. It was telling the truth about a promise
 * this file made and the server did not keep: the mailbox tools are registered
 * only when a connector is configured AND the traveller has connected a
 * mailbox, but the editing half of the prompt named search_mailbox and
 * attach_mail_document unconditionally. An editor with no mailbox was told to
 * reach for tools that did not exist, reached, failed, and reported the
 * failure — which is the only honest thing left to do by then.
 *
 * The existing test above missed it because it never set canEdit, and the
 * broken sentences live in the editing block.
 */

test('an editor with no mailbox is never told to reach for the mailbox tools', () => {
  const editing = ask({ canEdit: true, mailboxes: 0 })
  assert.ok(!editing.includes('search_mailbox'), 'promised a tool that is not registered')
  assert.ok(!editing.includes('attach_mail_document'), 'promised a tool that is not registered')
  /* And still says how to shape a leg, because that half is real. */
  assert.match(editing, /add_segment \/ update_segment \/ remove_segment/)
})

test('an editor with a mailbox is told about both halves', () => {
  const editing = ask({ canEdit: true, mailboxes: 1 })
  assert.match(editing, /search_mailbox \/ read_mailbox_message/)
  assert.match(editing, /attach_mail_document/)
})

test('it knows to say how to connect one, rather than only that it cannot', () => {
  /* "I cannot retrieve documents from email" is true and useless. The useful
     sentence names the remedy, and the assistant can only say it if it is
     told there is one. */
  const editing = ask({ canEdit: true, mailboxes: 0, connector: true })
  assert.match(editing, /connect/i)
  assert.match(editing, /Settings/)
})

test('a deployment with no connector at all does not offer to connect one', () => {
  /* Sending somebody to a screen that offers nothing is worse than saying no:
     the app already refuses to show the connector when no Azure application
     is configured. */
  const editing = ask({ canEdit: true, mailboxes: 0, connector: false })
  assert.ok(!/Settings → Connectors/.test(editing))
})
