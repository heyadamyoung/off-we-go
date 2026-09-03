import assert from 'node:assert/strict'
import test from 'node:test'
import {
  describeBuild,
  describeGroup,
  describeTrain,
  readable,
  utc,
} from '../scripts/testflightStatus.mjs'

test('Apple’s states are said in words a person can act on', () => {
  assert.equal(readable('READY_FOR_BETA_TESTING'), 'approved — they can install it')
  assert.equal(readable('IN_BETA_REVIEW'), 'in beta review at Apple')
  assert.equal(readable('MISSING_EXPORT_COMPLIANCE'), 'blocked: export compliance unanswered')
  assert.equal(
    readable('SOMETHING_NEW'),
    'SOMETHING_NEW',
    'an unknown state is reported, not swallowed',
  )
  assert.equal(readable(undefined), 'unknown')
})

/* Internal testers never face review, so the same state name means something
   different in each column, and the wrong word there is worse than none. */
test('a state is read against the audience it describes', () => {
  assert.equal(readable('IN_BETA_TESTING', 'internal'), 'installable')
  assert.equal(readable('IN_BETA_TESTING', 'external'), 'approved — they can install it')
  assert.equal(
    readable('WAITING_FOR_BETA_REVIEW', 'external'),
    'waiting for Apple to start beta review',
  )
})

test('a build line says who can install it and where it went', () => {
  const line = describeBuild({
    version: '14',
    release: '1.1',
    uploaded: '2026-09-01T23:45:00Z',
    processingState: 'VALID',
    internalState: 'READY_FOR_BETA_TESTING',
    externalState: 'IN_BETA_REVIEW',
    groups: ['Wayfare Friends & Family'],
  })

  assert.match(
    line,
    /^1\.1 build 14 \(2026-09-01 23:45Z\)/,
    'which version a build belongs to decides whether Apple reviews it afresh',
  )
  assert.match(line, /internal: installable/)
  assert.match(line, /external: in beta review at Apple/)
  assert.match(line, /groups: Wayfare Friends & Family/)
})

test('a build nobody has released says so plainly', () => {
  const line = describeBuild({ version: '9', processingState: 'VALID', groups: [] })

  assert.match(line, /^\? build 9/)
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

/* A build that never had a submission of its own was approved with its train:
   the first build of a version pays for the review, the rest ride on it. */
test('a build with no submission of its own says so, rather than looking unreviewed', () => {
  const ridden = describeBuild({
    version: '3',
    release: '1.0',
    processingState: 'VALID',
    groups: [],
  })
  assert.match(ridden, /review: never submitted — approved with its train/)

  const paid = describeBuild({
    version: '14',
    release: '1.1',
    processingState: 'VALID',
    groups: [],
    submitted: 'WAITING_FOR_REVIEW since 2026-09-01 23:45',
  })
  assert.match(paid, /review: WAITING_FOR_REVIEW since 2026-09-01 23:45/)
})

/* Apple answers with its own offsets, and two stamps in different zones sitting
   next to each other read as a seven-hour gap that never happened. */
test('times are all said in the same zone', () => {
  assert.equal(utc('2026-09-01T23:45:00Z'), '2026-09-01 23:45Z')
  assert.equal(utc('2026-09-01T16:45:00-07:00'), '2026-09-01 23:45Z')
})

/* The trains section exists because "why do I see two versions?" cannot be
   answered from a recent-builds window that one busy day fills entirely. */
test('a version train names its newest build, and says when it is expired', () => {
  assert.equal(
    describeTrain({
      version: '1.0',
      platform: 'IOS',
      build: '56',
      uploaded: '2026-09-03T16:59:00Z',
    }),
    'version 1.0 (IOS) — latest build 56, uploaded 2026-09-03 16:59Z',
  )
  assert.match(
    describeTrain({
      version: '0.1',
      platform: 'IOS',
      build: '2',
      uploaded: '2026-08-30T10:00:00Z',
      expired: true,
    }),
    /latest build 2, uploaded 2026-08-30 10:00Z, expired/,
  )
  assert.equal(describeTrain({ version: '1.1', platform: 'IOS' }), 'version 1.1 (IOS) — no builds')
  // A refused ask must not read as an empty train — that lie shipped once.
  assert.match(
    describeTrain({ version: '1.0', platform: 'IOS', unknown: true }),
    /builds unknown, Apple refused the ask/,
  )
})
