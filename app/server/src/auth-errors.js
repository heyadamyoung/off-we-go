const knownErrors = new Map([
  ['user.email_already_in_use', ['auth.account_exists', 'An account already exists for this email. Sign in instead.']],
  ['user.invalid_email', ['auth.invalid_email', 'Enter a valid email address.']],
  ['session.email_blocklist.invalid_email', ['auth.invalid_email', 'Enter a valid email address.']],
  ['session.email_blocklist.email_not_allowed', ['auth.email_not_allowed', 'This email address cannot be used. Try a different email.']],
  ['session.email_blocklist.disposable_email_validation_failed', ['auth.email_not_allowed', 'Use a permanent email address to create your account.']],
  ['session.invalid_credentials', ['auth.invalid_credentials', 'That email or password is incorrect.']],
  ['user.email_not_exist', ['auth.invalid_credentials', 'That email or password is incorrect.']],
  ['password.rejected', ['auth.password_rejected', 'Choose a stronger password that meets the password requirements.']],
  ['password.expired', ['auth.password_expired', 'Your password has expired. Reset it before signing in.']],
  ['verification_code.code_mismatch', ['auth.code_incorrect', 'That verification code is incorrect. Try again.']],
  ['verification_code.expired', ['auth.code_expired', 'That verification code has expired. Request a new code.']],
  ['verification_code.not_found', ['auth.code_missing', 'Request a new verification code, then try again.']],
  ['verification_code.email_mismatch', ['auth.code_email_mismatch', 'This code belongs to a different email. Request a new code.']],
  ['verification_code.exceed_max_try', ['auth.code_attempts_exceeded', 'Too many incorrect codes. Request a new code.']],
  ['session.interaction_not_found', ['auth.attempt_expired', 'Your sign-in attempt expired. Start again.']],
  ['session.verification_session_not_found', ['auth.attempt_expired', 'Your verification attempt expired. Request a new code.']],
  ['session.verification_expired', ['auth.attempt_expired', 'Your verification attempt expired. Request a new code.']],
  ['session.verification_blocked_too_many_attempts', ['auth.rate_limited', 'Too many attempts. Wait a moment, then try again.']],
  ['connector.rate_limit_exceeded', ['auth.rate_limited', 'Too many attempts. Wait a moment, then try again.']],
  ['connector.not_found', ['auth.email_delivery_unavailable', 'Email verification is temporarily unavailable. Please try again later.']],
  ['connector.not_enabled', ['auth.email_delivery_unavailable', 'Email verification is temporarily unavailable. Please try again later.']],
  ['connector.invalid_config', ['auth.email_delivery_unavailable', 'Email verification is temporarily unavailable. Please try again later.']],
  ['connector.template_not_found', ['auth.email_delivery_unavailable', 'Email verification is temporarily unavailable. Please try again later.']],
  ['user.sign_up_method_not_enabled', ['auth.registration_unavailable', 'Account creation is temporarily unavailable. Please try again later.']],
  ['user.missing_profile', ['auth.profile_incomplete', 'Your account details are incomplete. Check your handle and try again.']],
])

export function safeExperienceError(status, body, path = '') {
  let providerCode = ''
  try { providerCode = String(JSON.parse(String(body || '{}')).code || '') }
  catch {}
  const known = knownErrors.get(providerCode)
  if (known) return { code: known[0], error: known[1] }
  if (status === 429) return { code: 'auth.rate_limited', error: 'Too many attempts. Wait a moment, then try again.' }
  if (status >= 500) {
    return path === 'verification/verification-code'
      ? { code: 'auth.email_delivery_unavailable', error: 'Email verification is temporarily unavailable. Please try again later.' }
      : { code: 'auth.service_unavailable', error: 'The sign-in service is temporarily unavailable. Please try again later.' }
  }
  if (path === 'verification/password') {
    return { code: 'auth.invalid_credentials', error: 'That email or password is incorrect.' }
  }
  return { code: 'auth.request_failed', error: 'We could not complete that request. Check your details and try again.' }
}
