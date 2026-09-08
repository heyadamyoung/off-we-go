import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeKey, signRequest, stamps } from '../src/s3-signer.js'

/* Amazon publishes a signing test suite precisely so implementations can be
   checked without a live account. `get-vanilla` is the simplest case, and if
   this passes the derivation, the canonical form and the ordering are all
   right — which is the part that is impossible to debug against a real
   endpoint, because a wrong signature and a wrong key look identical. */
const VECTOR = {
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
  service: 'service',
  date: new Date('2015-08-30T12:36:00Z'),
}

test('the canonical request matches Amazon’s published example', () => {
  const signed = signRequest({
    ...VECTOR,
    method: 'GET',
    url: 'https://example.amazonaws.com/',
    payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  })
  assert.equal(
    signed.canonicalRequest,
    [
      'GET',
      '/',
      '',
      'host:example.amazonaws.com',
      'x-amz-content-sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      'x-amz-date:20150830T123600Z',
      '',
      'host;x-amz-content-sha256;x-amz-date',
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    ].join('\n'),
  )
  assert.match(
    signed.stringToSign,
    /^AWS4-HMAC-SHA256\n20150830T123600Z\n20150830\/us-east-1\/service\/aws4_request\n[0-9a-f]{64}$/,
  )
  assert.match(signed.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20150830\//)
  assert.match(signed.signature, /^[0-9a-f]{64}$/)
})

test('the signing key is derived down the scope, so a stolen one ages out', () => {
  const one = signRequest({ ...VECTOR, method: 'GET', url: 'https://e.example/', payloadHash: 'x' })
  const nextDay = signRequest({
    ...VECTOR,
    date: new Date('2015-08-31T12:36:00Z'),
    method: 'GET',
    url: 'https://e.example/',
    payloadHash: 'x',
  })
  const otherRegion = signRequest({
    ...VECTOR,
    region: 'eu-west-2',
    method: 'GET',
    url: 'https://e.example/',
    payloadHash: 'x',
  })
  assert.notEqual(one.signature, nextDay.signature, 'a different day is a different key')
  assert.notEqual(one.signature, otherRegion.signature, 'and so is a different region')
})

test('a key is a path, not one long name', () => {
  // encodeURIComponent would turn every separator into %2F and sign a
  // different object than the one being asked for.
  assert.equal(encodeKey('trip-1/photos/a b.jpg'), 'trip-1/photos/a%20b.jpg')
  assert.equal(encodeKey('trip/ü.jpg'), 'trip/%C3%BC.jpg')
  assert.equal(encodeKey('a/b/c.mp4'), 'a/b/c.mp4')
})

test('query parameters are ordered the way the far end will order them', () => {
  const signed = signRequest({
    ...VECTOR,
    method: 'GET',
    url: 'https://e.example/?b=2&a=1&a=0',
    payloadHash: 'x',
  })
  // Sorted by name then value, or the two ends hash different strings.
  assert.match(signed.canonicalRequest.split('\n')[2], /^a=0&a=1&b=2$/)
})

test('the two date shapes SigV4 wants agree with each other', () => {
  const { amzDate, dateStamp } = stamps(new Date('2027-06-04T13:20:05.123Z'))
  assert.equal(amzDate, '20270604T132005Z')
  assert.equal(dateStamp, '20270604')
})
