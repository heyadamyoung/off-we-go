import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

const moduleUnderTest = await import('../src/login-core.ts').catch(() => null)

test('web OIDC sign-in navigates the whole page through the backend authorization route', async () => {
  assert.ok(moduleUnderTest?.beginOidcLogin, 'the OIDC login launcher has not been implemented')
  let assigned = null
  await moduleUnderTest.beginOidcLogin({
    apiBaseUrl: '/api', native: false,
    location: { assign(value) { assigned = value } },
    browser: { async open() { throw new Error('web login must not open a native browser plugin') } },
  })

  assert.equal(assigned, '/api/auth/oidc/start?client=web')
})

test('native OIDC sign-in opens the system browser with a native-bound authorization request', async () => {
  let opened = null
  let stored = null
  await moduleUnderTest.beginOidcLogin({
    apiBaseUrl: 'https://offwego.example.com/api', native: true,
    location: { assign() { throw new Error('native login must not navigate the app webview') } },
    browser: { async open(options) { opened = options } },
    storage: { async setItem(key, value) { stored = { key, value } } },
  })

  assert.equal(opened.presentationStyle, 'popover')
  assert.equal(stored.key, moduleUnderTest.NATIVE_OIDC_VERIFIER_KEY)
  assert.match(stored.value, /^[A-Za-z0-9_-]{43}$/)
  const url = new URL(opened.url)
  assert.equal(url.origin + url.pathname, 'https://offwego.example.com/api/auth/oidc/start')
  assert.equal(url.searchParams.get('client'), 'native')
  assert.equal(url.searchParams.get('challenge'), createHash('sha256').update(stored.value).digest('base64url'))
})

test('OIDC logout uses full-page navigation on web and the system browser on native', async () => {
  let assigned = null
  moduleUnderTest.beginOidcLogout({
    apiBaseUrl: '/api', native: false, location: { assign(value) { assigned = value } },
    browser: { async open() { throw new Error('not native') } },
  })
  assert.equal(assigned, '/api/auth/oidc/logout?client=web')

  let opened = null
  await moduleUnderTest.beginOidcLogout({
    apiBaseUrl: 'https://offwego.example.com/api', native: true,
    location: { assign() { throw new Error('native must not navigate webview') } },
    browser: { async open(options) { opened = options } },
  })
  assert.deepEqual(opened, {
    url: 'https://offwego.example.com/api/auth/oidc/logout?client=native',
    presentationStyle: 'popover',
  })
})
