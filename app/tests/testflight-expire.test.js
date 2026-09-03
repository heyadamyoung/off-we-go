import assert from 'node:assert/strict'
import test from 'node:test'
import { expirable } from '../scripts/testflightExpire.mjs'

const build = (version, over = {}) => ({
  id: `b${version}`,
  attributes: { version, processingState: 'VALID', expired: false, ...over },
})

test('everything below the newest valid build goes; it and newer stay', () => {
  const { kept, expire } = expirable([
    build('57'),
    build('16'),
    build('15'),
    build('14', { expired: true }), // already gone; not re-expired
    build('5'),
  ])
  assert.deepEqual(
    kept.map(b => b.attributes.version),
    ['57'],
  )
  assert.deepEqual(
    expire.map(b => b.attributes.version),
    ['16', '15', '5'],
  )
})

test('a build still processing shields its predecessor: both are kept', () => {
  const { kept, expire } = expirable([
    build('58', { processingState: 'PROCESSING' }),
    build('57'),
    build('56'),
  ])
  assert.deepEqual(
    kept.map(b => b.attributes.version),
    ['58', '57'],
  )
  assert.deepEqual(
    expire.map(b => b.attributes.version),
    ['56'],
  )
})

test('with no valid build at all, nothing is touched', () => {
  const { kept, expire } = expirable([build('58', { processingState: 'PROCESSING' })])
  assert.equal(expire.length, 0)
  assert.equal(kept.length, 1)
})
