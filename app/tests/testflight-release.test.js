import assert from 'node:assert/strict'
import { createVerify, generateKeyPairSync } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  buildToken,
  chooseGroups,
  findBuild,
  isReady,
  shouldNotify,
} from '../scripts/testflightRelease.mjs'

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })

const decode = part => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))

test('the token is one App Store Connect will accept, and expires', () => {
  const now = Date.UTC(2026, 8, 1, 12, 0, 0)
  const token = buildToken({ keyId: 'ABC123', issuerId: 'issuer-uuid', privateKey, now })
  const [header, payload, signature] = token.split('.')

  assert.deepEqual(decode(header), { alg: 'ES256', kid: 'ABC123', typ: 'JWT' })
  const claims = decode(payload)
  assert.equal(claims.iss, 'issuer-uuid')
  assert.equal(claims.aud, 'appstoreconnect-v1')
  assert.equal(
    claims.exp - claims.iat,
    1200,
    'a token that never expires is a key left lying about',
  )

  const verifier = createVerify('sha256')
  verifier.update(`${header}.${payload}`)
  assert.equal(
    verifier.verify(
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      Buffer.from(signature, 'base64url'),
    ),
    true,
  )
})

test('a missing key is refused rather than sent as an anonymous request', () => {
  assert.throws(() => buildToken({ issuerId: 'x', privateKey }), /API key/)
  assert.throws(() => buildToken({ keyId: 'x', privateKey }), /API key/)
  assert.throws(() => buildToken({ keyId: 'x', issuerId: 'y' }), /API key/)
})

const groups = [
  { id: '1', attributes: { name: 'Family', isInternalGroup: true } },
  { id: '2', attributes: { name: 'Early access', isInternalGroup: false } },
  { id: '3', attributes: { name: 'Team', isInternalGroup: true } },
]

/* Apple refuses "Cannot add internal group to a build" — internal testers get
   every processed build without being asked, and only external groups need
   the build attaching to them. */
test('internal groups are left alone, because Apple hands them the build itself', () => {
  assert.deepEqual(
    chooseGroups(groups).map(group => group.name),
    ['Early access'],
  )
  assert.deepEqual(
    chooseGroups(groups, ['Team', 'Family']),
    [],
    'naming an internal group changes nothing',
  )
})

test('naming an external group picks it, whatever its case', () => {
  assert.deepEqual(
    chooseGroups(groups, ['early access']).map(group => group.id),
    ['2'],
  )
  assert.deepEqual(chooseGroups(groups, ['Nobody']), [])
  assert.deepEqual(chooseGroups([], []), [])
})

test('the build this run made is found by its number, and only when processed', () => {
  const builds = [
    { id: 'b9', attributes: { version: '9', processingState: 'VALID' } },
    { id: 'b10', attributes: { version: '10', processingState: 'PROCESSING' } },
  ]

  assert.equal(findBuild(builds, 9).id, 'b9', 'a number is a number whether or not it is a string')
  assert.equal(isReady(findBuild(builds, '9')), true)
  assert.equal(isReady(findBuild(builds, '10')), false, 'a processing build cannot join a group')
  assert.equal(findBuild(builds, '11'), null)
})

/* Ten fixes in an evening is ten builds, and Apple pages every tester for each
   one. Quiet is the default; interrupting people is the thing you ask for. */
test('a build only interrupts the testers when something asks it to', () => {
  assert.equal(shouldNotify('true'), true)
  assert.equal(shouldNotify(' TRUE '), true)
  assert.equal(shouldNotify(''), false)
  assert.equal(shouldNotify(undefined), false)
  assert.equal(shouldNotify('false'), false)
  assert.equal(shouldNotify('yes'), false, 'only a plain true, so a stray value is not a page')
})

/* The flag above was right, and nothing asked it.
 *
 * Reported from the road: TestFlight is spamming people's inboxes. It was.
 * The iOS build fires on every push to main that touches app/src, which on a
 * working day is most merges, and at the end of it the script POSTed
 * /buildBetaNotifications — the call Apple sends mail for — unconditionally.
 * TESTFLIGHT_NOTIFY existed, was off, was tested, and only ever set
 * autoNotifyEnabled on the build's beta detail, which is a different thing.
 *
 * So the test that matters is not what shouldNotify returns, it is whether
 * the one line that emails a human is behind it. Read from the source,
 * because the alternative is standing up App Store Connect in a test.
 */
test('the call that emails every tester is behind the flag', async () => {
  const source = await readFile(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'testflightRelease.mjs'),
    'utf8',
  )
  const at = source.indexOf('buildBetaNotifications')
  assert.ok(at > 0, 'the notification call has moved; this test needs to follow it')

  /* The guard has to be between the flag being read and the mail being sent,
     and it has to be an early return — a notification sent and then regretted
     is a notification sent. */
  const before = source.slice(0, at)
  assert.match(
    before,
    /if \(!notify\)[\s\S]{0,600}return/,
    'nothing stops the notification when TESTFLIGHT_NOTIFY is off',
  )
  assert.ok(
    before.indexOf('const notify') < before.lastIndexOf('if (!notify)'),
    'the guard reads a flag that has not been read yet',
  )
})
