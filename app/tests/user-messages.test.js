import assert from 'node:assert/strict'
import test from 'node:test'

import { appErrorMessage } from '../src/user-messages-core.ts'

test('application errors are actionable without exposing raw server details', () => {
  const raw = Object.assign(new Error('<html>upstream exploded at /opt/app/server.js</html>'), {
    status: 502,
  })

  assert.equal(
    appErrorMessage(raw, 'upload-photo'),
    'Photo uploads are temporarily unavailable. Please try again later.',
  )
  assert.doesNotMatch(appErrorMessage(raw, 'upload-photo'), /html|upstream|\/opt\/app/i)
})

test('application errors explain common status codes in the context of the action', () => {
  assert.equal(
    appErrorMessage(Object.assign(new Error('raw'), { status: 401 }), 'save-trip'),
    'Your session has expired. Sign in again, then retry.',
  )
  assert.equal(
    appErrorMessage(Object.assign(new Error('raw'), { status: 403 }), 'save-trip'),
    'You do not have permission to edit this trip.',
  )
  assert.equal(
    appErrorMessage(Object.assign(new Error('raw'), { status: 415 }), 'upload-photo'),
    'Choose a JPEG, PNG, WebP, or HEIC image.',
  )
  assert.equal(
    appErrorMessage(Object.assign(new Error('raw'), { status: 429 }), 'send-invite'),
    'Too many attempts. Wait a moment, then try again.',
  )
})

test('application errors explain profile handle conflicts without suggesting a reload', () => {
  const conflict = Object.assign(new Error('raw'), { status: 409, code: 'profile.handle_taken' })
  assert.equal(
    appErrorMessage(conflict, 'save-profile'),
    'That handle is already taken. Try another one.',
  )
})

test('application errors have human-readable action-specific fallbacks', () => {
  assert.equal(
    appErrorMessage(new TypeError('Failed to fetch'), 'create-trip'),
    'Check your internet connection and try again.',
  )
  assert.equal(
    appErrorMessage(new Error('database relation does not exist'), 'create-trip'),
    'We could not create your trip. Check the details and try again.',
  )
  assert.equal(
    appErrorMessage(new Error('native stack trace'), 'share-location'),
    'Location sharing could not start. Check location permissions and try again.',
  )
})
