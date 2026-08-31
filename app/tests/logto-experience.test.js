import test from 'node:test'
import assert from 'node:assert/strict'
import { createLogtoExperienceClient } from '../src/logto-experience-core.ts'

function recordingClient() {
  const calls = []
  let accepted = null
  return {
    calls,
    api: {
      async request(path, options = {}) {
        calls.push({ path, ...options })
        if (path.endsWith('/start')) return { started: true, interaction: 'opaque-interaction' }
        if (path.endsWith('/verification/password')) return { verificationId: 'password-check' }
        if (path.endsWith('/verification/verification-code') && !path.endsWith('/verify')) {
          return { verificationId: 'email-code' }
        }
        if (path.endsWith('/submit')) {
          return { accessToken: 'app-token', user: { id: 'user-1', email: 'invited@example.com' } }
        }
        return { ok: true }
      },
      async acceptSession(session) { accepted = session; return session },
    },
    accepted: () => accepted,
  }
}

test('custom sign-in uses Logto password verification and saves the returned app session', async () => {
  const recorder = recordingClient()
  const experience = createLogtoExperienceClient(recorder.api)

  await experience.signIn(' Invited@Example.com ', 'correct horse battery staple')

  assert.deepEqual(recorder.calls.map(call => [call.path, call.method]), [
    ['/auth/experience/start', 'POST'],
    ['/auth/experience', 'PUT'],
    ['/auth/experience/verification/password', 'POST'],
    ['/auth/experience/identification', 'POST'],
    ['/auth/experience/submit', 'POST'],
  ])
  assert.deepEqual(recorder.calls[2].body, {
    identifier: { type: 'email', value: 'invited@example.com' },
    password: 'correct horse battery staple',
  })
  assert.equal(recorder.calls[1].headers['x-wayfare-experience'], 'opaque-interaction')
  assert.equal(recorder.calls[4].headers['x-wayfare-experience'], 'opaque-interaction')
  assert.equal(recorder.accepted().accessToken, 'app-token')
})

test('custom account creation verifies the email before setting a password', async () => {
  const recorder = recordingClient()
  const experience = createLogtoExperienceClient(recorder.api)

  const verificationId = await experience.sendRegistrationCode(' Invited@Example.com ')
  await experience.completeRegistration({
    verificationId, code: '204913', password: 'a sufficiently long password',
  })

  assert.equal(verificationId, 'email-code')
  assert.deepEqual(recorder.calls.map(call => [call.path, call.method]), [
    ['/auth/experience/start', 'POST'],
    ['/auth/experience', 'PUT'],
    ['/auth/experience/verification/verification-code', 'POST'],
    ['/auth/experience/verification/verification-code/verify', 'POST'],
    ['/auth/experience/profile', 'POST'],
    ['/auth/experience/identification', 'POST'],
    ['/auth/experience/submit', 'POST'],
  ])
  assert.deepEqual(recorder.calls[3].body, { verificationId: 'email-code', code: '204913' })
  assert.deepEqual(recorder.calls[4].body, { type: 'password', value: 'a sufficiently long password' })
  assert.equal(recorder.calls[6].headers['x-wayfare-experience'], 'opaque-interaction')
  assert.equal(recorder.accepted().user.email, 'invited@example.com')
})
