import assert from 'node:assert/strict'
import test from 'node:test'
import { changeKind } from '../server/src/change-kind.js'

const T = '/api/trips/abc123'

test('each kind of change is named from the path it happened at', () => {
  assert.equal(changeKind('PATCH', T), 'trip')
  assert.equal(changeKind('POST', `${T}/stops`), 'stops')
  assert.equal(changeKind('PATCH', `${T}/stops/9`), 'stops')
  assert.equal(changeKind('DELETE', `${T}/stops/9`), 'stops')
  assert.equal(changeKind('PUT', `${T}/route`), 'stops')
  assert.equal(changeKind('POST', `${T}/photos`), 'photos')
  assert.equal(changeKind('DELETE', `${T}/photos/4`), 'photos')
  assert.equal(changeKind('PUT', `${T}/photos/4/like`), 'photos')
  assert.equal(changeKind('POST', `${T}/invites`), 'people')
  assert.equal(changeKind('DELETE', `${T}/members/7`), 'people')
  assert.equal(changeKind('POST', `${T}/devices`), 'people')
})

/* A comment lives under a photo but is not one: telling the browser "photos
   changed" would have it refetch the wrong slice. */
test('comments are comments even though they live under a photo', () => {
  assert.equal(changeKind('POST', `${T}/photos/4/comments`), 'comments')
  assert.equal(changeKind('DELETE', `${T}/comments/11`), 'comments')
})

test('reading changes nothing, and says so', () => {
  assert.equal(changeKind('GET', `${T}/stops`), null)
  assert.equal(changeKind('HEAD', T), null)
  assert.equal(changeKind(undefined, T), null)
})

/* Presence beats every fifteen seconds per viewer. Announcing those would be
   the polling this replaced, wearing a hat. */
test('presence is not a change to the trip', () => {
  assert.equal(changeKind('PUT', `${T}/presence`), null)
  assert.equal(changeKind('DELETE', `${T}/presence`), null)
})

test('a query string is not part of the path', () => {
  assert.equal(changeKind('POST', `${T}/photos?after=3`), 'photos')
})

test('something outside a trip announces nothing', () => {
  assert.equal(changeKind('POST', '/api/ingest/track'), null)
  assert.equal(changeKind('PATCH', '/api/profile'), null)
})
