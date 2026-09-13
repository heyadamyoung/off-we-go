import test from 'node:test'
import assert from 'node:assert/strict'

const moduleUnderTest = await import('../src/api-client-core.ts').catch(() => null)
const liveModule = await import('../src/live-positions-core.ts').catch(() => null)

test('live polling retry delays grow exponentially but remain bounded', () => {
  assert.equal(liveModule.liveRetryDelay(0), 1_000)
  assert.equal(liveModule.liveRetryDelay(3), 8_000)
  assert.equal(liveModule.liveRetryDelay(99), 30_000)
})

test('the VPS client exchanges an OIDC handoff, persists the session and authenticates requests', async () => {
  assert.ok(moduleUnderTest?.createApiClient, 'the self-hosted API client has not been implemented')
  const saved = new Map()
  const calls = []
  const client = moduleUnderTest.createApiClient({
    baseUrl: '/api',
    storage: {
      getItem(key) {
        return saved.get(key) || null
      },
      setItem(key, value) {
        saved.set(key, value)
      },
      removeItem(key) {
        saved.delete(key)
      },
    },
    fetch: async (url, options = {}) => {
      calls.push({ url, options })
      if (url === '/api/auth/exchange')
        return new Response(
          JSON.stringify({
            accessToken: 'session-token',
            user: { id: 'user-1', email: 'owner@example.com' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      return new Response(JSON.stringify({ title: 'Scotland' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })

  const session = await client.exchangeLoginHandoff('one-time-token')
  assert.equal(session.user.email, 'owner@example.com')
  assert.deepEqual(JSON.parse(saved.get('wayfare-session')), session)

  assert.deepEqual(await client.request('/trips/current'), { title: 'Scotland' })
  assert.equal(calls[1].options.headers.authorization, 'Bearer session-token')
})

test('native login becomes authenticated before slow keychain persistence finishes', async () => {
  let releaseKeychain
  let keychainWriteStarted
  const writeStarted = new Promise(resolve => {
    keychainWriteStarted = resolve
  })
  const keychainReleased = new Promise(resolve => {
    releaseKeychain = resolve
  })
  const client = moduleUnderTest.createApiClient({
    baseUrl: '/api',
    storage: {
      getItem() {
        return null
      },
      async setItem() {
        keychainWriteStarted()
        await keychainReleased
      },
      removeItem() {},
    },
    fetch: async () =>
      new Response(
        JSON.stringify({
          accessToken: 'native-session-token',
          user: { id: 'user-1', email: 'owner@example.com' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
  })
  let observed = null
  client.subscribe(session => {
    observed = session
  })

  const exchange = client.exchangeLoginHandoff('one-time-token')
  await writeStarted

  assert.equal(observed?.accessToken, 'native-session-token')
  releaseKeychain()
  await exchange
})

test('API errors expose their HTTP status so the app can distinguish an empty account', async () => {
  const client = moduleUnderTest.createApiClient({
    baseUrl: '/api',
    storage: {
      getItem() {
        return null
      },
      setItem() {},
      removeItem() {},
    },
    fetch: async () =>
      new Response(JSON.stringify({ error: 'No trip found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
  })
  await assert.rejects(client.request('/trips/current'), error => {
    assert.equal(error.message, 'No trip found')
    assert.equal(error.status, 404)
    return true
  })
})

test('OIDC continuation only returns to the same-origin OAuth authorization page', () => {
  assert.equal(
    moduleUnderTest.safeOAuthContinuation(
      '/oauth/authorize?client_id=abc',
      'https://offwego.example.com',
    ),
    '/oauth/authorize?client_id=abc',
  )
  assert.equal(
    moduleUnderTest.safeOAuthContinuation(
      'https://evil.example/oauth/authorize',
      'https://offwego.example.com',
    ),
    null,
  )
  assert.equal(
    moduleUnderTest.safeOAuthContinuation('/account', 'https://offwego.example.com'),
    null,
  )
})

test('the API client restores a session from asynchronous native secure storage', async () => {
  const stored = JSON.stringify({
    accessToken: 'keychain-token',
    user: { id: 'old', email: 'owner@example.com' },
  })
  const client = moduleUnderTest.createApiClient({
    baseUrl: '/api',
    storage: {
      async getItem(key) {
        return key === 'wayfare-session' ? stored : null
      },
      async setItem() {},
      async removeItem() {},
    },
    fetch: async (_url, options) => {
      assert.equal(options.headers.authorization, 'Bearer keychain-token')
      return new Response(JSON.stringify({ user: { id: 'fresh', email: 'owner@example.com' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })

  const restored = await client.restore()

  assert.equal(restored.accessToken, 'keychain-token')
  assert.equal(restored.user.id, 'fresh')
})

test('live GPS retention is bounded independently for every phone and removes duplicate fixes', () => {
  assert.ok(liveModule?.mergeLiveFixes, 'the per-device live GPS buffer has not been implemented')
  const at = value => new Date(`2027-01-01T00:00:0${value}.000Z`)
  const existing = [
    { deviceId: 'a', at: at(1), lat: 1 },
    { deviceId: 'a', at: at(2), lat: 2 },
    { deviceId: 'b', at: at(1), lat: 3 },
    { deviceId: 'c', at: at(1), lat: 4 },
  ]
  const incoming = [
    { deviceId: 'a', at: at(2), lat: 2 },
    { deviceId: 'a', at: at(3), lat: 5 },
    { deviceId: 'b', at: at(2), lat: 6 },
    { deviceId: 'b', at: at(3), lat: 7 },
    { deviceId: 'c', at: at(2), lat: 8 },
    { deviceId: 'c', at: at(3), lat: 9 },
  ]

  const result = liveModule.mergeLiveFixes(existing, incoming, 2)

  assert.equal(result.length, 6)
  assert.deepEqual(
    Object.fromEntries(Object.entries(Object.groupBy(result, value => value.deviceId))),
    {
      a: [
        { deviceId: 'a', at: at(2), lat: 2 },
        { deviceId: 'a', at: at(3), lat: 5 },
      ],
      b: [
        { deviceId: 'b', at: at(2), lat: 6 },
        { deviceId: 'b', at: at(3), lat: 7 },
      ],
      c: [
        { deviceId: 'c', at: at(2), lat: 8 },
        { deviceId: 'c', at: at(3), lat: 9 },
      ],
    },
  )
})

/* ---- the transport an upload actually goes over -------------------------
   The app runs with CapacitorHttp on, which replaces XMLHttpRequest's open
   and send with a pair that carries the body across the bridge as base64 —
   the whole file as a string, then the whole file again a third longer. A
   photograph survives it. A film off an iPhone is a few hundred megabytes
   and is not there to be caught: the web view dies, or the conversion throws
   into a promise with no catch on it, and the request dispatches neither load
   nor error. Nothing is said and nothing arrives. */

const transport = await import('../src/web-transport-core.ts').catch(() => null)

/* A shell that has patched the prototype, exactly as the bridge does: the
   originals set aside under their own name, the live methods replaced. */
function patchedShell() {
  const used = []
  class Request {
    constructor() {
      this.upload = {}
      this.status = 0
      this.responseText = ''
    }
    open() {
      used.push('bridge open')
    }
    send() {
      used.push('bridge send')
    }
    setRequestHeader() {
      used.push('bridge header')
    }
    getResponseHeader() {
      used.push('bridge response header')
      return null
    }
    abort() {
      used.push('bridge abort')
    }
  }
  const scope = {
    XMLHttpRequest: Request,
    CapacitorWebXMLHttpRequest: {
      constructor: Request,
      open(...args) {
        used.push(['open', ...args])
      },
      send(body) {
        used.push(['send', body])
      },
      setRequestHeader(name, value) {
        used.push(['header', name, value])
      },
      getResponseHeader(name) {
        used.push(['response header', name])
        return name === 'content-type' ? 'application/json' : null
      },
      abort() {
        used.push(['abort'])
      },
    },
  }
  return { scope, used, Request }
}

test('a request in the native shell is made with the transport underneath the patch', () => {
  assert.ok(transport?.webRequest, 'the web transport escape hatch has not been implemented')
  const { scope, used } = patchedShell()
  const wire = transport.webRequest(scope)
  wire.open('POST', 'https://example.test/api/photos')
  wire.header('authorization', 'Bearer t')
  wire.send('body')
  wire.responseHeader('content-type')
  wire.abort()

  assert.equal(wire.direct, true)
  assert.deepEqual(used, [
    ['open', 'POST', 'https://example.test/api/photos', true],
    ['header', 'authorization', 'Bearer t'],
    ['send', 'body'],
    ['response header', 'content-type'],
    ['abort'],
  ])
})

test('a request in a plain browser is made the plain way', () => {
  const sent = []
  class Request {
    open(...args) {
      sent.push(['open', ...args])
    }
    send(body) {
      sent.push(['send', body])
    }
    setRequestHeader() {}
    getResponseHeader() {
      return null
    }
    abort() {}
  }
  const wire = transport.webRequest({ XMLHttpRequest: Request })
  wire.open('POST', '/api/photos')
  wire.send('body')
  assert.equal(wire.direct, false)
  assert.deepEqual(sent, [
    ['open', 'POST', '/api/photos', true],
    ['send', 'body'],
  ])
})

test('half a saved transport is not used at all — a request opened one way and sent the other is neither', () => {
  const { scope, used } = patchedShell()
  // A future Capacitor that stops setting one of them aside.
  delete scope.CapacitorWebXMLHttpRequest.send
  const wire = transport.webRequest(scope)
  wire.open('POST', '/api/photos')
  wire.send('body')
  assert.equal(wire.direct, false)
  assert.deepEqual(used, ['bridge open', 'bridge send'])
})

test('an upload hands the file to the real transport, never to the bridge', async () => {
  const { scope, used, Request } = patchedShell()
  const realXhr = globalThis.XMLHttpRequest
  const realSaved = globalThis.CapacitorWebXMLHttpRequest
  globalThis.XMLHttpRequest = scope.XMLHttpRequest
  globalThis.CapacitorWebXMLHttpRequest = scope.CapacitorWebXMLHttpRequest
  // The instance the client is about to build, so the test can answer it.
  let made = null
  const originalConstructor = scope.CapacitorWebXMLHttpRequest.constructor
  scope.CapacitorWebXMLHttpRequest.constructor = class extends Request {
    constructor() {
      super()
      made = this
    }
  }
  try {
    const client = moduleUnderTest.createApiClient({
      baseUrl: '/api',
      storage: { getItem: () => null, setItem() {}, removeItem() {} },
      fetch: async () => new Response('{}', { status: 200 }),
    })
    const form = new FormData()
    form.append('photo', new Blob(['film']), 'clip.mov')
    const pending = client.upload('/trips/1/photos', { body: form })
    // The send is behind one await of the session hydration.
    await new Promise(resolve => setTimeout(resolve, 0))
    made.status = 201
    made.responseText = '{"id":"p1"}'
    made.onload()
    assert.deepEqual(await pending, { id: 'p1' })
  } finally {
    scope.CapacitorWebXMLHttpRequest.constructor = originalConstructor
    globalThis.XMLHttpRequest = realXhr
    globalThis.CapacitorWebXMLHttpRequest = realSaved
  }

  const sent = used.find(entry => Array.isArray(entry) && entry[0] === 'send')
  assert.ok(sent, 'the upload never reached the browser transport')
  assert.ok(sent[1] instanceof FormData, 'the body was converted on the way')
  assert.ok(
    !used.includes('bridge send'),
    'the file was handed to the bridge, which carries it as base64',
  )
})

test('an upload asked to stop before it starts says so rather than hanging', async () => {
  const { scope } = patchedShell()
  const realXhr = globalThis.XMLHttpRequest
  const realSaved = globalThis.CapacitorWebXMLHttpRequest
  globalThis.XMLHttpRequest = scope.XMLHttpRequest
  globalThis.CapacitorWebXMLHttpRequest = scope.CapacitorWebXMLHttpRequest
  try {
    const client = moduleUnderTest.createApiClient({
      baseUrl: '/api',
      storage: { getItem: () => null, setItem() {}, removeItem() {} },
      fetch: async () => new Response('{}', { status: 200 }),
    })
    const stop = new AbortController()
    stop.abort()
    await assert.rejects(
      client.upload('/trips/1/photos', { body: new FormData(), signal: stop.signal }),
      /stopped/,
    )
  } finally {
    globalThis.XMLHttpRequest = realXhr
    globalThis.CapacitorWebXMLHttpRequest = realSaved
  }
})
