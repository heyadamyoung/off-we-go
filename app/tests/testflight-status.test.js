import assert from 'node:assert/strict'
import test from 'node:test'
import { describeBuild, describeGroup, readable } from '../scripts/testflightStatus.mjs'

test('Apple’s states are said in words a person can act on', () => {
  assert.equal(readable('READY_FOR_BETA_TESTING'), 'approved — they can install it')
  assert.equal(readable('IN_BETA_REVIEW'), 'in beta review at Apple')
  assert.equal(readable('MISSING_EXPORT_COMPLIANCE'), 'blocked: export compliance unanswered')
  assert.equal(readable('SOMETHING_NEW'), 'SOMETHING_NEW', 'an unknown state is reported, not swallowed')
  assert.equal(readable(undefined), 'unknown')
})

/* Internal testers never face review, so the same state name means something
   different in each column, and the wrong word there is worse than none. */
test('a state is read against the audience it describes', () => {
  assert.equal(readable('IN_BETA_TESTING', 'internal'), 'installable')
  assert.equal(readable('IN_BETA_TESTING', 'external'), 'approved — they can install it')
  assert.equal(readable('WAITING_FOR_BETA_REVIEW', 'external'), 'waiting for Apple to start beta review')
})

test('a build line says who can install it and where it went', () => {
  const line = describeBuild({
    version: '14',
    uploaded: '2026-09-01T23:45:00Z',
    processingState: 'VALID',
    internalState: 'READY_FOR_BETA_TESTING',
    externalState: 'IN_BETA_REVIEW',
    groups: ['Wayfare Friends & Family'],
  })

  assert.match(line, /^build 14 \(2026-09-01 23:45\)/)
  assert.match(line, /internal: installable/)
  assert.match(line, /external: in beta review at Apple/)
  assert.match(line, /groups: Wayfare Friends & Family/)
})

test('a build nobody has released says so plainly', () => {
  const line = describeBuild({ version: '9', processingState: 'VALID', groups: [] })

  assert.match(line, /unknown time/)
  assert.match(line, /groups: no external group/)
})

test('a group says who is in it, so an invitation can be checked rather than assumed', () => {
  const group = { attributes: { name: 'Wayfare Friends & Family', isInternalGroup: false } }
  const testers = [
    { attributes: { email: 'steve.lazurko@gmail.com' } },
    { attributes: { email: 'adam@example.com' } },
  ]

  assert.equal(
    describeGroup(group, testers),
    'Wayfare Friends & Family (external): adam@example.com, steve.lazurko@gmail.com',
  )
  assert.match(describeGroup(group, []), /nobody yet$/)
})
