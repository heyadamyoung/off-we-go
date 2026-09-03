import assert from 'node:assert/strict'
import test from 'node:test'
import { findGroup, invitationPayload, testerPayload } from '../scripts/testflightInvite.mjs'

const groups = [
  { id: 'in', attributes: { name: 'Wayfare Internal', isInternalGroup: true } },
  { id: 'ff', attributes: { name: 'Wayfare Friends & Family', isInternalGroup: false } },
]

test('a named group is found however it was typed', () => {
  assert.equal(findGroup(groups, 'wayfare friends & family').id, 'ff')
  assert.equal(findGroup(groups, '  Wayfare Internal  ').id, 'in')
  assert.equal(findGroup(groups, 'Nobody'), null)
})

test('with nothing named it takes the one external group, and refuses to guess between two', () => {
  assert.equal(findGroup(groups).id, 'ff')
  assert.equal(findGroup([groups[0]]), null, 'internal groups take every build anyway')
  assert.equal(
    findGroup([
      ...groups,
      {
        id: 'beta',
        attributes: { name: 'Public beta', isInternalGroup: false },
      },
    ]),
    null,
    'two external groups is a choice for a person to make',
  )
})

test('an address that is not one is refused before Apple is asked', () => {
  assert.throws(() => testerPayload({ email: 'steve.lazurko', groupId: 'ff' }), /Not an email/)
  assert.throws(() => testerPayload({ email: '', groupId: 'ff' }), /Not an email/)
  assert.throws(() => testerPayload({ email: 'two @spaces.com', groupId: 'ff' }), /Not an email/)
})

test('the invitation names the group, and a name is optional', () => {
  assert.deepEqual(testerPayload({ email: 'someone@example.com', groupId: 'ff' }), {
    data: {
      type: 'betaTesters',
      attributes: { email: 'someone@example.com' },
      relationships: { betaGroups: { data: [{ type: 'betaGroups', id: 'ff' }] } },
    },
  })

  const named = testerPayload({
    email: 'someone@example.com',
    firstName: 'Some',
    lastName: 'One',
    groupId: 'ff',
  })
  assert.deepEqual(named.data.attributes, {
    email: 'someone@example.com',
    firstName: 'Some',
    lastName: 'One',
  })
})

/* A tester already in the group is not an error to report but a person whose
   invitation email went unopened; the fix is sending it again. */
test('the re-invitation names the tester and the app, nothing else', () => {
  assert.deepEqual(invitationPayload({ testerId: 't-9', appId: 'app-1' }), {
    data: {
      type: 'betaTesterInvitations',
      relationships: {
        betaTester: { data: { type: 'betaTesters', id: 't-9' } },
        app: { data: { type: 'apps', id: 'app-1' } },
      },
    },
  })
})
