export type AuthAction = 'signin' | 'send-code' | 'register'

type AuthError = Error & { code?: string; status?: number }

const messagesByCode: Record<string, string> = {
  'profile.handle_invalid': 'Use 3–30 letters, numbers, or single hyphens for your handle.',
  'profile.handle_taken': 'That handle is already taken. Try another one.',
  'user.email_already_in_use': 'An account already exists for this email. Sign in instead.',
  'auth.account_exists': 'An account already exists for this email. Sign in instead.',
  'user.invalid_email': 'Enter a valid email address.',
  'session.email_blocklist.invalid_email': 'Enter a valid email address.',
  'session.email_blocklist.email_not_allowed': 'This email address cannot be used. Try a different email.',
  'session.email_blocklist.disposable_email_validation_failed': 'Use a permanent email address to create your account.',
  'session.invalid_credentials': 'That email or password is incorrect.',
  'auth.invalid_credentials': 'That email or password is incorrect.',
  'user.email_not_exist': 'That email or password is incorrect.',
  'password.rejected': 'Choose a stronger password that meets the password requirements.',
  'auth.password_rejected': 'Choose a stronger password that meets the password requirements.',
  'password.expired': 'Your password has expired. Reset it before signing in.',
  'auth.password_expired': 'Your password has expired. Reset it before signing in.',
  'verification_code.code_mismatch': 'That verification code is incorrect. Try again.',
  'auth.code_incorrect': 'That verification code is incorrect. Try again.',
  'verification_code.expired': 'That verification code has expired. Request a new code.',
  'auth.code_expired': 'That verification code has expired. Request a new code.',
  'verification_code.not_found': 'Request a new verification code, then try again.',
  'auth.code_missing': 'Request a new verification code, then try again.',
  'verification_code.email_mismatch': 'This code belongs to a different email. Request a new code.',
  'auth.code_email_mismatch': 'This code belongs to a different email. Request a new code.',
  'verification_code.exceed_max_try': 'Too many incorrect codes. Request a new code.',
  'auth.code_attempts_exceeded': 'Too many incorrect codes. Request a new code.',
  'session.interaction_not_found': 'Your sign-in attempt expired. Start again.',
  'session.verification_session_not_found': 'Your verification attempt expired. Request a new code.',
  'session.verification_expired': 'Your verification attempt expired. Request a new code.',
  'auth.attempt_expired': 'Your sign-in attempt expired. Start again.',
  'session.verification_blocked_too_many_attempts': 'Too many attempts. Wait a moment, then try again.',
  'connector.rate_limit_exceeded': 'Too many attempts. Wait a moment, then try again.',
  'auth.rate_limited': 'Too many attempts. Wait a moment, then try again.',
  'connector.not_found': 'Email verification is temporarily unavailable. Please try again later.',
  'connector.not_enabled': 'Email verification is temporarily unavailable. Please try again later.',
  'connector.invalid_config': 'Email verification is temporarily unavailable. Please try again later.',
  'connector.template_not_found': 'Email verification is temporarily unavailable. Please try again later.',
  'auth.email_delivery_unavailable': 'Email verification is temporarily unavailable. Please try again later.',
  'user.sign_up_method_not_enabled': 'Account creation is temporarily unavailable. Please try again later.',
}

const fallbacks: Record<AuthAction, { invalid: string; unavailable: string }> = {
  signin: {
    invalid: 'We could not sign you in. Check your details and try again.',
    unavailable: 'Sign-in is temporarily unavailable. Please try again later.',
  },
  'send-code': {
    invalid: 'We could not send that code. Check your email and try again.',
    unavailable: 'We could not send a verification code right now. Please try again later.',
  },
  register: {
    invalid: 'We could not create your account. Check your details and try again.',
    unavailable: 'Account creation is temporarily unavailable. Please try again later.',
  },
}

export function authErrorMessage(caught: unknown, action: AuthAction) {
  const error = caught as Partial<AuthError> | null
  const code = String(error?.code || '')
  if (messagesByCode[code]) return messagesByCode[code]
  if (error?.status === 429) return 'Too many attempts. Wait a moment, then try again.'
  if (error?.status === 0 || caught instanceof TypeError) return 'Check your internet connection and try again.'
  if (Number(error?.status) >= 500) return fallbacks[action].unavailable
  return fallbacks[action].invalid
}

export function authSuccessMessage(action: AuthAction) {
  if (action === 'signin') return 'Signed in. Welcome back!'
  if (action === 'send-code') return 'Verification code sent. Check your email.'
  return 'Account created. Welcome to Off We Go!'
}

export function authCallbackMessage(value: unknown) {
  const message = String(value || '')
  if (message === 'Sign-in was cancelled or could not be completed') {
    return 'Sign-in was cancelled. Please try again when you are ready.'
  }
  if (message === 'The identity provider could not verify this sign-in') {
    return 'We could not verify your sign-in. Please try again.'
  }
  if (message === 'A verified email address is required to sign in') return 'Use an account with a verified email address.'
  if (message === 'That sign-in attempt is invalid or has expired') return 'Your sign-in attempt expired. Start again.'
  return 'Sign-in did not finish. Please try again.'
}
