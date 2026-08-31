import test from 'node:test'
import assert from 'node:assert/strict'
import { safeExperienceError } from '../src/auth-errors.js'

test('missing required Logto profile fields become a safe actionable account error', () => {
  const result = safeExperienceError(
    422,
    JSON.stringify({
      code: 'user.missing_profile',
      data: { missingProfile: ['username'] },
      message: 'unsafe provider detail',
    }),
    'identification',
  )

  assert.deepEqual(result, {
    code: 'auth.profile_incomplete',
    error: 'Your account details are incomplete. Check your handle and try again.',
  })
})
