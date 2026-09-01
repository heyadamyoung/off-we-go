import assert from 'node:assert/strict'
import { createVerify, generateKeyPairSync } from 'node:crypto'
import test from 'node:test'
import { buildToken, chooseGroups, findBuild, isReady } from '../scripts/testflightRelease.mjs'

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
  assert.equal(claims.exp - claims.iat, 1200, 'a token that never expires is a key left lying about')

  const verifier = createVerify('sha256')
  verifier.update(`${header}.${payload}`)
  assert.equal(
    verifier.verify({ key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')),
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

test('with no group named, every internal group gets the build', () => {
  assert.deepEqual(chooseGroups(groups).map(group => group.name), ['Family', 'Team'])
})

test('naming a group picks it, whatever its case, and external stays possible', () => {
  assert.deepEqual(chooseGroups(groups, ['early access']).map(group => group.id), ['2'])
  assert.deepEqual(chooseGroups(groups, ['Team', 'Family']).map(group => group.id), ['1', '3'])
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
