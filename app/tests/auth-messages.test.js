import test from 'node:test'
import assert from 'node:assert/strict'
import {
  authCallbackMessage,
  authErrorMessage,
  authSuccessMessage,
} from '../src/auth-messages-core.ts'

const failure = (code, status = 400, message = 'unsafe provider detail') =>
  Object.assign(new Error(message), { code, status })

test('auth errors turn provider codes into comprehensive actionable messages', () => {
  const cases = [
    [
      'user.email_already_in_use',
      422,
      'An account already exists for this email. Sign in instead.',
    ],
    ['user.invalid_email', 400, 'Enter a valid email address.'],
    ['session.invalid_credentials', 401, 'That email or password is incorrect.'],
    ['password.rejected', 422, 'Choose a stronger password that meets the password requirements.'],
    ['verification_code.code_mismatch', 400, 'That verification code is incorrect. Try again.'],
    ['verification_code.expired', 400, 'That verification code has expired. Request a new code.'],
    ['verification_code.not_found', 404, 'Request a new verification code, then try again.'],
    ['verification_code.exceed_max_try', 429, 'Too many incorrect codes. Request a new code.'],
    ['session.interaction_not_found', 401, 'Your sign-in attempt expired. Start again.'],
    [
      'connector.not_found',
      501,
      'Email verification is temporarily unavailable. Please try again later.',
    ],
    ['connector.rate_limit_exceeded', 429, 'Too many attempts. Wait a moment, then try again.'],
    [
      'auth.email_delivery_unavailable',
      501,
      'Email verification is temporarily unavailable. Please try again later.',
    ],
    [
      'auth.profile_incomplete',
      422,
      'Your account details are incomplete. Check your handle and try again.',
    ],
  ]

  for (const [code, status, expected] of cases) {
    assert.equal(authErrorMessage(failure(code, status), 'register'), expected, code)
  }
})

test('auth errors use safe action-specific fallbacks instead of raw provider details', () => {
  assert.equal(
    authErrorMessage(failure('unknown.internal', 503), 'signin'),
    'Sign-in is temporarily unavailable. Please try again later.',
  )
  assert.equal(
    authErrorMessage(failure('unknown.internal', 503), 'send-code'),
    'We could not send a verification code right now. Please try again later.',
  )
  assert.equal(
    authErrorMessage(failure('unknown.internal', 400), 'register'),
    'We could not create your account. Check your details and try again.',
  )
  assert.doesNotMatch(
    authErrorMessage(failure('unknown.internal', 500), 'register'),
    /unsafe|provider/i,
  )
})

test('auth errors explain profile handle validation and uniqueness', () => {
  assert.equal(
    authErrorMessage(failure('profile.handle_invalid'), 'send-code'),
    'Use 3–30 letters, numbers, or single hyphens for your handle.',
  )
  assert.equal(
    authErrorMessage(failure('profile.handle_taken', 409), 'send-code'),
    'That handle is already taken. Try another one.',
  )
})

test('auth successes have friendly messages for each completed action', () => {
  assert.equal(authSuccessMessage('signin'), 'Signed in. Welcome back!')
  assert.equal(authSuccessMessage('send-code'), 'Verification code sent. Check your email.')
  assert.equal(authSuccessMessage('register'), 'Account created. Welcome to Off We Go!')
})

test('auth callback errors are allow-listed instead of echoing URL text', () => {
  assert.equal(
    authCallbackMessage('Sign-in was cancelled or could not be completed'),
    'Sign-in was cancelled. Please try again when you are ready.',
  )
  assert.equal(
    authCallbackMessage('The identity provider could not verify this sign-in'),
    'We could not verify your sign-in. Please try again.',
  )
  assert.equal(
    authCallbackMessage('<img src=x onerror=alert(1)>'),
    'Sign-in did not finish. Please try again.',
  )
})
