import Fastify from 'fastify'
import multipart from '@fastify/multipart'
import cors from '@fastify/cors'
import formbody from '@fastify/formbody'
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { registerMcpRoutes } from './mcp.js'
import { clientAddress, createWindowRateLimiter } from './rateLimit.js'
import { createLiveStream } from './live-stream.js'
import { changeKind } from './change-kind.js'
import { createSecretBox } from './secret-box.js'
import {
  DEFAULT_SCOPES,
  authorizeUrl,
  challengeFor,
  createState,
  createVerifier,
  expiresAt,
  stateHash,
  tokenRequestBody,
  tokenUrl,
} from './mailbox-oauth.js'
import { assistantPrompt, readAssistantMessages } from './assistant.js'
import { signAgentToken } from './agent-token.js'
import { createLogtoExperienceService } from './logto-experience.js'
import { normalizeProfileHandle } from './slugs.js'
import { createIndoorCache } from './airport-indoor.js'
import { mergeWalkways } from './airport-walkways.js'
import { createMailboxReader } from './mailbox-read.js'
import { validChunk } from './replay-store.js'
import { event, recordFailure, span, stamp } from './tracing.js'

const normalizeEmail = value =>
  String(value || '')
    .trim()
    .toLowerCase()
const tokenHash = value => createHash('sha256').update(value).digest('hex')
const newToken = () => randomBytes(32).toString('base64url')
const pkceChallenge = verifier => createHash('sha256').update(verifier).digest('base64url')
const loginCookieName = '__Host-wayfare-login'

function cookieValue(request, name) {
  const cookies = String(request.headers.cookie || '').split(';')
  for (const cookie of cookies) {
    const separator = cookie.indexOf('=')
    if (separator > 0 && cookie.slice(0, separator).trim() === name) {
      return cookie.slice(separator + 1).trim()
    }
  }
  return null
}

function bearer(request) {
  const value = request.headers.authorization || ''
  return value.startsWith('Bearer ') ? value.slice(7).trim() : null
}

const isPlainObject = value => !!value && typeof value === 'object' && !Array.isArray(value)

/* A home base is a name and a coordinate, and half a coordinate is not a place:
   null means the request was malformed, not that the field was left alone. */
function readHomeBase(body) {
  const place =
    body.homePlace === undefined ? undefined : String(body.homePlace).trim().slice(0, 120) || null
  const lat = body.homeLat === undefined || body.homeLat === null ? null : Number(body.homeLat)
  const lng = body.homeLng === undefined || body.homeLng === null ? null : Number(body.homeLng)
  if ((lat === null) !== (lng === null)) return null
  if (lat !== null && (!Number.isFinite(lat) || Math.abs(lat) > 90)) return null
  if (lng !== null && (!Number.isFinite(lng) || Math.abs(lng) > 180)) return null
  return {
    ...(place === undefined ? {} : { homePlace: place }),
    ...(body.homeLat === undefined && body.homeLng === undefined
      ? {}
      : { homeLat: lat, homeLng: lng }),
  }
}

const gpxEscape = value =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

/* The trail as GPX so it opens in anything that reads a track: the phones'
   fixes if there are any, otherwise the route somebody drew by hand. */
function gpxTrail(trip) {
  const points = trip.trail?.length
    ? trip.trail.map(fix => ({ lng: fix.lng, lat: fix.lat, at: fix.at }))
    : (trip.route || []).map(([lng, lat]) => ({ lng, lat, at: null }))
  if (!points.length) return null
  const body = points
    .map(
      point =>
        `      <trkpt lat="${point.lat}" lon="${point.lng}">` +
        (point.at ? `<time>${new Date(point.at).toISOString()}</time>` : '') +
        '</trkpt>',
    )
    .join('\n')
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<gpx version="1.1" creator="Off We Go" xmlns="http://www.topografix.com/GPX/1/1">\n' +
    `  <trk><name>${gpxEscape(trip.title)}</name><trkseg>\n${body}\n  </trkseg></trk>\n</gpx>\n`
  )
}

export async function buildServer({
  repository,
  fileStore = null,
  mailer,
  publicUrl,
  sessionSecret,
  clock = () => new Date(),
  ingestRateLimit = { max: 180, windowMs: 60_000 },
  authRateLimit = { maxPerEmail: 3, maxPerIp: 20, windowMs: 15 * 60_000 },
  deviceRegistrationRateLimit = { max: 30, windowMs: 15 * 60_000 },
  maxDevicesPerTrip = 20,
  appleTeamId = null,
  appleBundleId = 'ai.threadway.wayfare',
  logger = false,
  oauthSecret = null,
  androidPackageName = 'ai.threadway.wayfare',
  androidCertFingerprints = [],
  identityProvider = null,
  experienceFetch = fetch,
  /* The mailbox connector is optional: with nothing configured the routes say
     so and the screen offers nothing, rather than sending someone to a
     half-built sign-in. */
  microsoft = null,
  mailboxTokenKey = null,
  connectorFetch = fetch,
  /* The AI assistant is optional the same way: no configured runner, and the
     route says so instead of half-working. `assistant.run` takes a prompt and
     returns the reply — in production that is the Codex CLI on the personal
     account, in tests a function. */
  assistant = null,
  assistantRateLimit = { max: 30, windowMs: 10 * 60_000 },
  indoorCache = null,
  /* Session replay: rrweb chunks from signed-in browsers, kept on this
     server's disk. The store is optional; without it uploads are politely
     swallowed. Watching back is for the admin email alone. */
  replayStore = null,
  adminEmail = null,
  trustProxy = ['loopback', 'linklocal', 'uniquelocal'],
}) {
  if (!repository) throw new Error('A repository is required')
  if (!mailer) throw new Error('A mailer is required')
  if (!publicUrl) throw new Error('WAYFARE_PUBLIC_URL is required')
  if (!sessionSecret || sessionSecret.length < 16)
    throw new Error('WAYFARE_SESSION_SECRET must be at least 16 characters')
  oauthSecret ||= sessionSecret
  if (oauthSecret.length < 16)
    throw new Error('WAYFARE_OAUTH_SECRET must be at least 16 characters')

  // Ordinary JSON contracts are tiny. Large payloads are allowed only on the
  // two authenticated multipart image routes below.
  const app = Fastify({ logger, bodyLimit: 64 * 1024, trustProxy })

  /* A path parameter that is not a uuid reaches Postgres and comes back as
     22P02. Unhandled that is a 500, which tells the app the server is having a
     moment and to keep retrying a link that will never work. It is a 404: the
     thing named does not exist, because no such name can. */
  app.setErrorHandler((error, request, reply) => {
    if (error.code === '22P02') {
      return reply.code(404).send({ error: 'Not found' })
    }
    recordFailure(error)
    request.log?.error?.({ err: error }, 'request failed')
    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500
    return reply
      .code(status)
      .send({ error: status === 500 ? 'Something went wrong' : error.message })
  })

  const ingestLimiter = createWindowRateLimiter({ clock: () => clock().getTime() })
  const indoorLimiter = createWindowRateLimiter({ clock: () => clock().getTime() })
  const indoorRateLimit = { max: 30, windowMs: 10 * 60_000 }
  const inviteLimiter = createWindowRateLimiter({ clock: () => clock().getTime() })
  const inviteRateLimit = { max: 20, windowMs: 60 * 60 * 1000 }
  const inviteTargetRateLimit = { max: 3, windowMs: 60 * 60 * 1000 }
  const liveStream = createLiveStream()

  /* Everything a browser watching this trip would want to know about. The
     positions carry their payload because they are incremental and cheap; the
     rest say only what changed, and the browser asks for that slice — one
     serializer, not two, and no chance of the pushed copy drifting from the
     fetched one. */
  const touched = (tripId, kind) => {
    if (tripId) liveStream.announce(tripId, kind)
  }

  /* One hook rather than an announce buried in every route: a request that
     changed something, and was allowed to, tells whoever is watching that trip.
     After the response, so nothing is announced that did not happen. */
  app.addHook('onResponse', async (request, reply) => {
    if (reply.statusCode >= 400) return
    const tripId = request.params?.tripId
    const kind = tripId && changeKind(request.method, request.raw?.url)
    if (kind) touched(tripId, kind)
  })

  /* One shape for the positions whether they are asked for or pushed, so a
     browser cannot tell the two apart beyond how quickly they arrived. */
  const livePayload = result => ({
    devices: result.devices.map(device => ({
      id: device.id,
      name: device.name,
      slug: device.slug,
      userId: device.userId,
      lastSeen: device.lastSeen?.toISOString?.() || device.lastSeen || null,
      pausedAt: device.pausedAt?.toISOString?.() || device.pausedAt || null,
    })),
    fixes: result.fixes.map(fix => ({
      deviceId: fix.deviceId,
      lng: fix.lng,
      lat: fix.lat,
      accuracy: fix.accuracy,
      speed: fix.speed,
      at: fix.at.toISOString(),
    })),
    cursor: result.cursor,
  })
  const deviceRegistrationLimiter = createWindowRateLimiter({ clock: () => clock().getTime() })
  const authEmailLimiter = createWindowRateLimiter({ clock: () => clock().getTime() })
  const authIpLimiter = createWindowRateLimiter({ clock: () => clock().getTime() })
  const assistantLimiter = createWindowRateLimiter({ clock: () => clock().getTime() })
  const mailboxBox = mailboxTokenKey ? createSecretBox(mailboxTokenKey) : null
  const connectorReady = !!(microsoft?.clientId && mailboxBox)
  // What the assistant reads a connected inbox through; nothing else uses it.
  const mailboxReader = connectorReady
    ? createMailboxReader({
        repository,
        box: mailboxBox,
        microsoft,
        fetchImpl: connectorFetch,
        clock,
      })
    : null
  const presenceByTrip = new Map()
  const presenceTtlMs = 45_000
  const allowedOrigins = new Set([
    publicUrl.replace(/\/$/, ''),
    'capacitor://localhost',
    'ionic://localhost',
    'https://localhost',
  ])
  await app.register(cors, {
    origin(origin, callback) {
      callback(null, !origin || allowedOrigins.has(origin))
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    // traceparent/tracestate: the native shells call cross-origin, and their
    // Faro spans propagate context so a tap and its SQL share one trace.
    allowedHeaders: [
      'content-type',
      'authorization',
      'x-wayfare-experience',
      'traceparent',
      'tracestate',
    ],
    maxAge: 86400,
  })
  await app.register(formbody)
  await app.register(multipart, {
    limits: { files: 1, fileSize: 25 * 1024 * 1024, fields: 20 },
  })

  // logLevel warn: docker probes this every ten seconds for ever, and two
  // info lines per probe would be most of what Loki holds. Failures still log.
  app.get('/api/health', { logLevel: 'warn' }, async (_request, reply) => {
    try {
      await Promise.all([repository.ready?.(), fileStore?.ready?.()])
      /* Which optional pieces this deployment actually came up with. It says
         whether the box has the configuration, never what the configuration
         is, and it is how a release is checked from outside. */
      return { ok: true, connectors: { outlook: connectorReady, assistant: !!assistant } }
    } catch (error) {
      app.log.warn({ err: error }, 'readiness check failed')
      return reply.code(503).send({ ok: false })
    }
  })
  app.get('/.well-known/apple-app-site-association', async (_request, reply) => {
    if (!appleTeamId)
      return reply.code(404).send({ error: 'Apple universal links are not configured' })
    return reply.type('application/json').send({
      applinks: {
        apps: [],
        details: [
          {
            appID: `${appleTeamId}.${appleBundleId}`,
            paths: ['/auth/callback*', '/auth/native*', '/pair*'],
          },
        ],
      },
    })
  })
  app.get('/.well-known/assetlinks.json', async (_request, reply) => {
    if (!androidCertFingerprints.length) {
      return reply.code(404).send({ error: 'Android app links are not configured' })
    }
    return reply.type('application/json').send([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: androidPackageName,
          sha256_cert_fingerprints: androidCertFingerprints,
        },
      },
    ])
  })

  const mediaSignature = (storagePath, expires) =>
    createHmac('sha256', sessionSecret).update(`${storagePath}:${expires}`).digest('base64url')
  /* timingSafeEqual compares buffers, so the lengths that must match are byte
     lengths. Comparing character counts let a signature with one multi-byte
     character through to a throw, and a 403 came back as a 500. */
  const sameSignature = (supplied, expected) => {
    const a = Buffer.from(supplied)
    const b = Buffer.from(expected)
    return a.length === b.length && timingSafeEqual(a, b)
  }

  const mediaUrl = storagePath => {
    const expires = Math.floor(clock().getTime() / 1000) + 3600
    return `${publicUrl.replace(/\/$/, '')}/api/media/${storagePath}?expires=${expires}&signature=${mediaSignature(storagePath, expires)}`
  }
  const STOP_STATUSES = new Set(['done', 'now', 'next', 'planned'])

  /* One address, and only one: a comma or a newline here becomes several
     recipients by the time the mailer parses the header. */
  const singleAddress = value =>
    typeof value === 'string' && /^[^\s@,;:<>"]+@[^\s@,;:<>"]+\.[^\s@,;:<>"]+$/.test(value)

  /** Fastify hands back an array when a query key is repeated. */
  const one = value => (Array.isArray(value) ? value[0] : value)

  const finite = value => {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  const dateFrom = value => {
    if (value == null || value === '') return null
    const numeric = Number(value)
    const date = Number.isFinite(numeric)
      ? new Date(numeric > 1e12 ? numeric : numeric * 1000)
      : new Date(String(value))
    return Number.isNaN(date.getTime()) ? null : date
  }

  const sendTripInvitation = async invite => {
    const appUrl = new URL('/', publicUrl)
    const message = {
      kind: 'trip-invitation',
      to: invite.email,
      appUrl: appUrl.href,
      tripTitle: invite.tripTitle,
    }
    await mailer.send(message)
    return message
  }

  const oidcCallbackUrl = `${publicUrl.replace(/\/$/, '')}/api/auth/oidc/callback`
  const experienceCookieName = '__Host-wayfare-experience'
  const experience = createLogtoExperienceService({
    identityProvider,
    publicUrl,
    fetch: experienceFetch,
    clock,
  })
  const safeAuthContinuation = value => {
    if (typeof value !== 'string') return null
    try {
      const root = publicUrl.replace(/\/$/, '')
      const destination = new URL(value, root)
      return destination.origin === root && destination.pathname === '/oauth/authorize'
        ? destination.pathname + destination.search
        : null
    } catch {
      return null
    }
  }
  const privateAuthReply = reply =>
    reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer')
  const oidcFailure = (reply, login, message) => {
    const destination = new URL(
      login?.client === 'native' ? '/auth/native' : '/auth/callback',
      publicUrl,
    )
    destination.searchParams.set('error', message)
    return privateAuthReply(reply).redirect(destination.href)
  }

  app.get('/api/auth/oidc/start', async (request, reply) => {
    privateAuthReply(reply)
    if (!identityProvider) return reply.code(503).send({ error: 'OIDC sign-in is not configured' })
    const retryAfter = authIpLimiter.hit(clientAddress(request), {
      max: authRateLimit.maxPerIp,
      windowMs: authRateLimit.windowMs,
    })
    if (retryAfter) {
      return reply
        .header('retry-after', String(retryAfter))
        .code(429)
        .send({ error: 'Try again later' })
    }
    const client = request.query?.client === 'native' ? 'native' : 'web'
    const nativeChallenge = String(request.query?.challenge || '')
    if (client === 'native' && !/^[A-Za-z0-9_-]{43}$/.test(nativeChallenge)) {
      return reply
        .code(400)
        .send({ error: 'The native sign-in request is missing its device binding' })
    }
    const webBinding = client === 'web' ? newToken() : null
    const bindingHash = client === 'native' ? nativeChallenge : tokenHash(webBinding)
    const state = newToken(),
      nonce = newToken(),
      codeVerifier = newToken()
    await repository.createOidcLogin({
      stateHash: tokenHash(state),
      nonce,
      codeVerifier,
      client,
      bindingHash,
      continuation: safeAuthContinuation(request.query?.continue),
      expiresAt: new Date(clock().getTime() + 10 * 60_000),
    })
    const location = await identityProvider.authorizationUrl({
      redirectUri: oidcCallbackUrl,
      state,
      nonce,
      codeChallenge: pkceChallenge(codeVerifier),
    })
    if (webBinding) {
      reply.header(
        'set-cookie',
        `${loginCookieName}=${webBinding}; Path=/; Max-Age=600; Secure; HttpOnly; SameSite=Lax`,
      )
    }
    return reply.redirect(location)
  })

  app.get('/api/auth/oidc/callback', async (request, reply) => {
    privateAuthReply(reply)
    if (!identityProvider) return reply.code(503).send({ error: 'OIDC sign-in is not configured' })
    const state = String(request.query?.state || '')
    const login =
      state.length >= 32 ? await repository.consumeOidcLogin(tokenHash(state), clock()) : null
    if (!login)
      return reply.code(400).send({ error: 'That sign-in attempt is invalid or has expired' })
    if (!request.query?.code || request.query?.error) {
      return oidcFailure(reply, login, 'Sign-in was cancelled or could not be completed')
    }
    let identity
    try {
      identity = await identityProvider.exchangeCallback({
        currentUrl: new URL(request.raw.url, publicUrl).href,
        redirectUri: oidcCallbackUrl,
        state,
        nonce: login.nonce,
        codeVerifier: login.codeVerifier,
      })
    } catch (error) {
      app.log.warn({ err: error }, 'OIDC callback exchange failed')
      return oidcFailure(reply, login, 'The identity provider could not verify this sign-in')
    }
    const email = normalizeEmail(identity?.email)
    if (!identity?.issuer || !identity?.subject || !identity?.emailVerified || !email) {
      return oidcFailure(reply, login, 'A verified email address is required to sign in')
    }
    const user = await repository.resolveOidcUser({
      issuer: identity.issuer,
      subject: identity.subject,
      email,
    })
    if (!user)
      return oidcFailure(
        reply,
        login,
        'We could not finish setting up your account. Please try again.',
      )
    const handoff = newToken()
    await repository.createLoginHandoff({
      hash: tokenHash(handoff),
      userId: user.id,
      client: login.client,
      bindingHash: login.bindingHash,
      expiresAt: new Date(clock().getTime() + 2 * 60_000),
    })
    const destination = new URL(
      login.client === 'native' ? '/auth/native' : '/auth/callback',
      publicUrl,
    )
    destination.searchParams.set('token', handoff)
    if (login.continuation) destination.searchParams.set('continue', login.continuation)
    return reply.redirect(destination.href)
  })

  app.get('/api/auth/oidc/logout', async (request, reply) => {
    privateAuthReply(reply)
    const native = request.query?.client === 'native'
    const returnTo = new URL(native ? '/auth/native?logout=1' : '/', publicUrl).href
    if (!identityProvider?.endSessionUrl) return reply.redirect(returnTo)
    try {
      return reply.redirect(
        await identityProvider.endSessionUrl({ postLogoutRedirectUri: returnTo }),
      )
    } catch (error) {
      app.log.warn({ err: error }, 'OIDC provider logout discovery failed')
      return reply.redirect(returnTo)
    }
  })

  app.post('/api/auth/experience/start', async (request, reply) => {
    privateAuthReply(reply)
    if (!experience) return reply.code(503).send({ error: 'Sign-in is not configured' })
    const retryAfter = authIpLimiter.hit(clientAddress(request), {
      max: authRateLimit.maxPerIp,
      windowMs: authRateLimit.windowMs,
    })
    if (retryAfter) {
      return reply
        .header('retry-after', String(retryAfter))
        .code(429)
        .send({ error: 'Try again later' })
    }
    try {
      const handle = await experience.start()
      reply.header(
        'set-cookie',
        `${experienceCookieName}=${handle}; Path=/; Max-Age=900; Secure; HttpOnly; SameSite=Strict`,
      )
      return { started: true, interaction: handle }
    } catch (error) {
      app.log.warn({ err: error }, 'Logto experience start failed')
      return reply.code(502).send({ error: 'Could not start sign-in' })
    }
  })

  app.post('/api/auth/experience/handle', async (request, reply) => {
    privateAuthReply(reply)
    if (!experience) return reply.code(503).send({ error: 'Sign-in is not configured' })
    const experienceHandle =
      String(request.headers['x-wayfare-experience'] || '') ||
      cookieValue(request, experienceCookieName)
    if (!experienceHandle || experience.event(experienceHandle) !== 'Register') {
      return reply.code(400).send({ error: 'Your registration attempt has expired' })
    }
    const handle = normalizeProfileHandle(request.body?.handle)
    if (!handle) {
      return reply.code(400).send({
        code: 'profile.handle_invalid',
        error: 'Use 3–30 letters, numbers, or single hyphens for your handle.',
      })
    }
    const reserved = await repository.reserveProfileHandle({
      reservationHash: tokenHash(experienceHandle),
      handle,
      expiresAt: new Date(clock().getTime() + 15 * 60_000),
    })
    if (!reserved) {
      return reply
        .code(409)
        .send({ code: 'profile.handle_taken', error: 'That handle is already taken.' })
    }
    return { handle }
  })

  const forwardExperience = async (request, reply) => {
    privateAuthReply(reply)
    if (!experience) return reply.code(503).send({ error: 'Sign-in is not configured' })
    const handle =
      String(request.headers['x-wayfare-experience'] || '') ||
      cookieValue(request, experienceCookieName)
    const path = String(request.params?.['*'] || '')
    if (
      [
        'verification/password',
        'verification/verification-code',
        'verification/verification-code/verify',
      ].includes(path)
    ) {
      let retryAfter = authIpLimiter.hit(clientAddress(request), {
        max: authRateLimit.maxPerIp,
        windowMs: authRateLimit.windowMs,
      })
      if (!retryAfter && path !== 'verification/verification-code/verify') {
        const identifier = request.body?.identifier
        const email = identifier?.type === 'email' ? normalizeEmail(identifier.value) : '<empty>'
        retryAfter = authEmailLimiter.hit(email || '<empty>', {
          max: authRateLimit.maxPerEmail,
          windowMs: authRateLimit.windowMs,
        })
      }
      if (retryAfter) {
        return reply
          .header('retry-after', String(retryAfter))
          .code(429)
          .send({ error: 'Try again later' })
      }
    }
    let result
    try {
      result = await experience.forward({
        handle,
        method: request.method,
        path,
        body: request.body,
      })
    } catch (error) {
      app.log.warn({ err: error }, 'Logto experience request failed')
      return reply.code(502).send({ error: 'The sign-in service could not complete this request' })
    }
    if (result.identity) {
      const identity = result.identity
      const email = normalizeEmail(identity?.email)
      if (!identity?.issuer || !identity?.subject || !identity?.emailVerified || !email) {
        return reply.code(401).send({ error: 'A verified email address is required to sign in' })
      }
      const user = await repository.resolveOidcUser({
        issuer: identity.issuer,
        subject: identity.subject,
        email,
        handleReservationHash: tokenHash(handle),
      })
      if (!user) return reply.code(500).send({ error: 'Could not create your Off We Go account' })
      const accessToken = newToken()
      await repository.createSession({
        hash: tokenHash(accessToken),
        userId: user.id,
        expiresAt: new Date(clock().getTime() + 90 * 24 * 60 * 60_000),
      })
      reply.header(
        'set-cookie',
        `${experienceCookieName}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict`,
      )
      return { accessToken, user }
    }
    reply.code(result.status)
    if (result.status === 204) return reply.send()
    return reply.type(result.contentType || 'application/json').send(result.body || '{}')
  }
  app.route({ method: ['PUT', 'POST'], url: '/api/auth/experience', handler: forwardExperience })
  app.route({ method: ['PUT', 'POST'], url: '/api/auth/experience/*', handler: forwardExperience })

  app.post('/api/auth/exchange', async (request, reply) => {
    privateAuthReply(reply)
    const token = String(request.body?.token || '')
    const now = clock()
    const client = request.body?.client === 'native' ? 'native' : 'web'
    const binding =
      client === 'native'
        ? pkceChallenge(String(request.body?.verifier || ''))
        : tokenHash(cookieValue(request, loginCookieName) || '')
    const user =
      token.length >= 32
        ? await repository.consumeLoginHandoff({
            hash: tokenHash(token),
            now,
            client,
            bindingHash: binding,
          })
        : null
    if (!user)
      return reply.code(401).send({ error: 'That sign-in handoff is invalid or has expired' })

    const accessToken = newToken()
    await repository.createSession({
      hash: tokenHash(accessToken),
      userId: user.id,
      expiresAt: new Date(now.getTime() + 90 * 24 * 60 * 60_000),
    })
    if (client === 'web') {
      reply.header(
        'set-cookie',
        `${loginCookieName}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`,
      )
    }
    return { accessToken, user }
  })

  app.get('/api/auth/session', async (request, reply) => {
    const accessToken = bearer(request)
    const user = accessToken ? await repository.findSession(tokenHash(accessToken), clock()) : null
    if (!user) return reply.code(401).send({ error: 'Sign in required' })
    return { user }
  })

  app.post('/api/auth/logout', async (request, reply) => {
    const accessToken = bearer(request)
    if (accessToken) await repository.deleteSession(tokenHash(accessToken))
    return reply.code(204).send()
  })

  async function authenticated(request, reply) {
    const accessToken = bearer(request)
    const user = accessToken ? await repository.findSession(tokenHash(accessToken), clock()) : null
    if (!user) reply.code(401).send({ error: 'Sign in required' })
    // Every authenticated request's span says who and from where — the wide
    // event that lets a trace search read "Catherine's requests, tonight".
    if (user) stamp({ 'user.id': user.id, 'client.address': clientAddress(request) })
    return user
  }

  const activePresence = tripId => {
    const byUser = presenceByTrip.get(tripId)
    if (!byUser) return []
    const cutoff = clock().getTime() - presenceTtlMs
    for (const [userId, clients] of byUser) {
      for (const [clientId, seenAt] of clients) if (seenAt < cutoff) clients.delete(clientId)
      if (!clients.size) byUser.delete(userId)
    }
    if (!byUser.size) presenceByTrip.delete(tripId)
    return [...byUser.keys()]
  }

  const presenceClientId = request => {
    const value = typeof request.body?.clientId === 'string' ? request.body.clientId.trim() : ''
    return value && value.length <= 100 ? value : null
  }

  const removeQueuedFile = async path => {
    try {
      await fileStore.remove(path)
      await repository.completeFileDeletion(path)
      return true
    } catch (error) {
      await repository.failFileDeletion(path, error.message, clock())
      app.log.error({ err: error, path }, 'queued file deletion failed')
      return false
    }
  }
  const processFileDeletionQueue = async () => {
    if (!fileStore || !repository.listPendingFileDeletions) return
    const paths = await repository.listPendingFileDeletions(clock(), 50)
    for (const path of paths) await removeQueuedFile(path)
  }
  let fileDeletionTimer = null
  if (fileStore && repository.listPendingFileDeletions) {
    await processFileDeletionQueue().catch(error =>
      app.log.error({ err: error }, 'file deletion queue failed'),
    )
    fileDeletionTimer = setInterval(() => {
      processFileDeletionQueue().catch(error =>
        app.log.error({ err: error }, 'file deletion queue failed'),
      )
    }, 60_000)
    fileDeletionTimer.unref?.()
    app.addHook('onClose', async () => clearInterval(fileDeletionTimer))
  }

  await registerMcpRoutes(app, {
    repository,
    fileStore,
    publicUrl,
    oauthSecret,
    clock,
    authenticate: authenticated,
    sendInvite: sendTripInvitation,
    /* Tool edits reach watching browsers the same way route edits do. */
    announce: touched,
    mailboxReader,
  })

  app.delete('/api/account', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    if (request.body?.confirm !== 'DELETE') {
      return reply.code(400).send({ error: 'Type DELETE to confirm account deletion' })
    }
    const paths = await repository.deleteAccount(user)
    if (fileStore && repository.completeFileDeletion) {
      for (const path of paths) await removeQueuedFile(path)
    }
    return reply.code(204).send()
  })

  app.get('/api/trips', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    const [trips, invites] = await Promise.all([
      repository.listTrips(user),
      repository.listPendingInvites(user),
    ])
    return { trips, invites }
  })

  app.post('/api/trips', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    const title = String(request.body?.title || '').trim()
    if (!title) return reply.code(400).send({ error: 'A trip needs a title' })
    const trip = await repository.createTrip(user, { ...request.body, title })
    return reply.code(201).send(trip)
  })

  app.get('/api/trips/current', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    const row = await repository.loadCurrentTrip(user, one(request.query?.t) || null)
    if (!row) return reply.code(404).send({ error: 'No trip found' })

    const member = value => ({
      id: value.profileId,
      handle: value.handle,
      name: value.displayName || value.email.split('@')[0],
      role: ['owner', 'editor'].includes(value.role) ? 'Travelling' : 'Following',
      memberRole: value.role,
      avatar: value.avatarUrl ? mediaUrl(value.avatarUrl) : null,
    })
    const family = row.members.map(member)
    const me = member(row.members.find(value => value.profileId === user.id))
    return {
      source: 'vps',
      tripId: row.id,
      trip: {
        id: row.id,
        slug: row.slug,
        title: row.title,
        crew: row.crew,
        dates: row.dates,
        dayCount: row.dayCount,
        startsOn: row.startsOn,
        endsOn: row.endsOn,
      },
      stops: row.stops,
      photos: row.photos.map(photo => ({
        ...photo,
        src: mediaUrl(photo.storagePath),
        thumbSrc: photo.thumbPath ? mediaUrl(photo.thumbPath) : null,
      })),
      route: row.route,
      comments: row.comments,
      likes: row.likes,
      family,
      canEdit: ['owner', 'editor'].includes(
        row.members.find(value => value.profileId === user.id)?.role,
      ),
      me,
    }
  })

  /* The AI chat behind the sparkle on the map. The prompt names the trip and
     nothing else: the agent queries this server's own MCP endpoint for what a
     question needs, holding a token minted here that is the asking user, for
     a few minutes — so what the agent can see and touch is exactly what the
     person asking could. An editor's agent can edit the trip; a viewer's
     agent cannot, because its token never carries the write scope and the
     write tools are never registered for it. A stranger's slug gets the same
     404 as a trip that does not exist. The model runs on a personal account,
     so the limiter is per person, not per trip. */
  app.post('/api/assistant', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    if (!assistant) return reply.code(503).send({ error: 'The AI assistant is not configured' })
    const retryAfter = assistantLimiter.hit(user.id, assistantRateLimit)
    if (retryAfter) {
      return reply
        .header('retry-after', String(retryAfter))
        .code(429)
        .send({ error: 'Too many questions at once' })
    }
    const messages = readAssistantMessages(request.body)
    if (!messages) {
      return reply.code(400).send({ error: 'A conversation ending with a question is required' })
    }
    const slug = typeof request.body?.trip === 'string' ? request.body.trip : null
    const trips = await repository.listTrips(user)
    const trip = slug ? trips.find(value => value.slug === slug) : trips[0]
    if (!trip) return reply.code(404).send({ error: 'No trip found' })
    const canEdit = ['owner', 'editor'].includes(trip.role)
    const scopes = canEdit ? ['trips:read', 'trips:write'] : ['trips:read']
    // Told about the mailbox tools only when there is a mailbox behind them.
    const mailboxes = mailboxReader ? await repository.listMailboxConnections(user.id) : []
    try {
      const answer = await span(
        'answer question',
        {
          'trip.slug': trip.slug,
          'assistant.can_edit': canEdit,
          'mailbox.count': mailboxes.length,
        },
        async active => {
          const said = await assistant.run(
            assistantPrompt({
              user,
              trip,
              canEdit,
              mailboxes: mailboxes.length,
              now: clock(),
              messages,
            }),
            { env: { OFFWEGO_MCP_TOKEN: signAgentToken(user, oauthSecret, clock(), scopes) } },
          )
          active.setAttributes({ 'answer.length': said.length, 'turn.count': messages.length })
          return said
        },
      )
      return { reply: answer }
    } catch (error) {
      app.log.error({ err: error }, 'assistant request failed')
      return reply.code(502).send({ error: 'The assistant could not answer' })
    }
  })

  /* ---- session replay -------------------------------------------------
     The browser posts rrweb chunks; the owner watches them back. Uploads
     need only a session; the list and the events are the admin's alone. */
  const isAdmin = user => !!adminEmail && user.email === adminEmail
  app.post('/api/replay/chunks', { bodyLimit: 2 * 1024 * 1024 }, async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    if (!replayStore) return reply.code(204).send()
    const chunk = validChunk(request.body)
    if (!chunk) return reply.code(400).send({ error: 'Not a replay chunk' })
    stamp({ 'replay.session': chunk.session, 'replay.seq': chunk.seq })
    await replayStore.append(user.id, chunk)
    return reply.code(204).send()
  })
  app.get('/api/replay/sessions', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    if (!isAdmin(user)) return reply.code(403).send({ error: 'Replays are for the owner' })
    if (!replayStore) return { sessions: [] }
    return { sessions: await replayStore.sessions() }
  })
  app.get('/api/replay/sessions/:session/events', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    if (!isAdmin(user)) return reply.code(403).send({ error: 'Replays are for the owner' })
    const events = replayStore ? await replayStore.events(request.params.session) : null
    if (!events) return reply.code(404).send({ error: 'No such session' })
    return { events }
  })

  app.put('/api/trips/:tripId/presence', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    const tripId = request.params.tripId
    if (!(await repository.canReadTrip(user.id, tripId))) {
      return reply.code(403).send({ error: 'You cannot view this trip' })
    }
    const clientId = presenceClientId(request)
    if (!clientId) return reply.code(400).send({ error: 'A presence client id is required' })
    activePresence(tripId)
    let byUser = presenceByTrip.get(tripId)
    if (!byUser) {
      byUser = new Map()
      presenceByTrip.set(tripId, byUser)
    }
    let clients = byUser.get(user.id)
    if (!clients) {
      clients = new Map()
      byUser.set(user.id, clients)
    }
    clients.set(clientId, clock().getTime())
    return { userIds: activePresence(tripId) }
  })

  app.delete('/api/trips/:tripId/presence', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    const tripId = request.params.tripId
    if (!(await repository.canReadTrip(user.id, tripId))) {
      return reply.code(403).send({ error: 'You cannot view this trip' })
    }
    const clientId = presenceClientId(request)
    if (!clientId) return reply.code(400).send({ error: 'A presence client id is required' })
    const byUser = presenceByTrip.get(tripId)
    const clients = byUser?.get(user.id)
    clients?.delete(clientId)
    if (clients && !clients.size) byUser.delete(user.id)
    if (byUser && !byUser.size) presenceByTrip.delete(tripId)
    return reply.code(204).send()
  })

  app.patch('/api/trips/:tripId', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    const trip = await repository.updateTrip(user, request.params.tripId, request.body || {})
    if (!trip) return reply.code(403).send({ error: 'You cannot edit this trip' })
    return trip
  })

  app.get('/api/users/:handle', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    const handle = normalizeProfileHandle(request.params.handle)
    if (!handle) return reply.code(404).send({ error: 'Profile not found' })
    const profile = await repository.loadProfileByHandle(user, handle)
    if (!profile) return reply.code(404).send({ error: 'Profile not found' })
    return {
      id: profile.profileId,
      handle: profile.handle,
      name: profile.displayName,
      avatar: profile.avatarUrl ? mediaUrl(profile.avatarUrl) : null,
    }
  })

  const ownProfile = profile => ({
    id: profile.profileId,
    handle: profile.handle,
    email: profile.email,
    name: profile.displayName || profile.email.split('@')[0],
    avatar: profile.avatarUrl ? mediaUrl(profile.avatarUrl) : null,
    homePlace: profile.homePlace,
    homeLat: profile.homeLat,
    homeLng: profile.homeLng,
    timeZone: profile.timeZone,
    preferences: profile.preferences || {},
    joinedAt: profile.joinedAt,
    tripCount: profile.tripCount,
    photoCount: profile.photoCount,
  })

  app.get('/api/profile', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    const profile = await repository.loadProfile(user)
    if (!profile) return reply.code(404).send({ error: 'Profile not found' })
    return ownProfile(profile)
  })

  app.patch('/api/profile', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    const body = request.body || {}
    const requestedHandle =
      body.handle === undefined ? undefined : normalizeProfileHandle(body.handle)
    if (body.handle !== undefined && !requestedHandle) {
      return reply.code(400).send({
        code: 'profile.handle_invalid',
        error: 'Use 3–30 letters, numbers, or single hyphens for your handle.',
      })
    }
    let home
    if (body.homePlace !== undefined || body.homeLat !== undefined || body.homeLng !== undefined) {
      home = readHomeBase(body)
      if (home === null) {
        return reply.code(400).send({ error: 'A home base needs both a latitude and a longitude' })
      }
    }
    if (body.preferences !== undefined && !isPlainObject(body.preferences)) {
      return reply.code(400).send({ error: 'Preferences must be an object' })
    }
    const profile = await repository.updateProfile(user, {
      ...(body.name !== undefined
        ? { name: String(body.name).trim() || user.email.split('@')[0] }
        : {}),
      ...(requestedHandle !== undefined ? { handle: requestedHandle } : {}),
      ...(home || {}),
      ...(body.timeZone !== undefined
        ? { timeZone: String(body.timeZone).trim().slice(0, 64) || null }
        : {}),
      ...(body.preferences !== undefined ? { preferences: body.preferences } : {}),
    })
    if (profile?.conflict === 'handle') {
      return reply
        .code(409)
        .send({ code: 'profile.handle_taken', error: 'That handle is already taken.' })
    }
    if (!profile) return reply.code(404).send({ error: 'Profile not found' })
    return ownProfile(profile)
  })

  /* Everything this account holds, as one JSON document. Photo bytes stay put
     and are linked rather than inlined: an archive that had to buffer a trip's
     worth of full-size images in memory would fall over on the first real one. */
  app.get('/api/account/archive', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    if (!repository.exportAccount)
      return reply.code(503).send({ error: 'Archives are not configured' })
    const archive = await repository.exportAccount(user)
    const stamp = clock().toISOString().slice(0, 10)
    reply.header('content-disposition', `attachment; filename="off-we-go-${stamp}.json"`)
    return {
      exportedAt: clock().toISOString(),
      profile: archive.profile ? ownProfile(archive.profile) : null,
      trips: (archive.trips || []).map(trip => ({
        ...trip,
        photos: trip.photos.map(({ path, ...photo }) => ({
          ...photo,
          url: path ? mediaUrl(path) : null,
        })),
        gpx: gpxTrail(trip),
      })),
    }
  })

  app.post('/api/profile/avatar', { bodyLimit: 30 * 1024 * 1024 }, async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    if (!fileStore?.storeAvatar)
      return reply.code(503).send({ error: 'Avatar storage is not configured' })
    let bytes = null
    for await (const part of request.parts()) {
      if (part.type !== 'file') continue
      if (!part.mimetype?.startsWith('image/'))
        return reply.code(415).send({ error: 'Only images can be uploaded' })
      bytes = await part.toBuffer()
    }
    if (!bytes?.length) return reply.code(400).send({ error: 'Choose an avatar to upload' })
    let stored
    try {
      stored = await fileStore.storeAvatar({ profileId: user.id, bytes })
    } catch {
      return reply.code(400).send({ error: 'That file is not a readable image' })
    }
    const profile = await repository.updateProfile(user, stored)
    if (!profile) {
      await fileStore.remove(stored.avatarPath).catch(() => {})
      return reply.code(404).send({ error: 'Profile not found' })
    }
    if (profile.oldAvatarUrl && profile.oldAvatarUrl !== stored.avatarPath) {
      await fileStore.remove(profile.oldAvatarUrl).catch(() => {})
    }
    return reply
      .code(201)
      .send({ avatarPath: stored.avatarPath, avatar: mediaUrl(stored.avatarPath) })
  })

  app.post('/api/trips/:tripId/photos', { bodyLimit: 30 * 1024 * 1024 }, async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    if (!fileStore) return reply.code(503).send({ error: 'Photo storage is not configured' })
    if (!(await repository.canEditTrip(user.id, request.params.tripId))) {
      return reply.code(403).send({ error: 'You cannot add photos to this trip' })
    }

    let bytes = null
    const fields = {}
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        if (!part.mimetype?.startsWith('image/'))
          return reply.code(415).send({ error: 'Only images can be uploaded' })
        bytes = await part.toBuffer()
      } else fields[part.fieldname] = part.value
    }
    if (!bytes?.length) return reply.code(400).send({ error: 'Choose a photo to upload' })
    const clientKey = String(fields.uploadKey || '').trim() || null
    if (clientKey && (clientKey.length < 16 || clientKey.length > 100)) {
      return reply.code(400).send({ error: 'The photo upload key is invalid' })
    }
    if (clientKey && repository.findPhotoByClientKey) {
      const existing = await repository.findPhotoByClientKey(user, request.params.tripId, clientKey)
      if (existing)
        return {
          ...existing,
          src: mediaUrl(existing.storagePath),
          thumbSrc: existing.thumbPath ? mediaUrl(existing.thumbPath) : null,
        }
    }

    const coordinatePair = (lngField, latField, label) => {
      const lngPresent = fields[lngField] != null && String(fields[lngField]).trim() !== ''
      const latPresent = fields[latField] != null && String(fields[latField]).trim() !== ''
      if (lngPresent !== latPresent)
        return { error: `${label} longitude and latitude must be supplied together` }
      if (!lngPresent) return { lng: null, lat: null }
      const lng = finite(fields[lngField]),
        lat = finite(fields[latField])
      if (lng == null || lat == null || Math.abs(lng) > 180 || Math.abs(lat) > 90) {
        return { error: `${label} coordinates are invalid` }
      }
      return { lng, lat }
    }
    const supplied = coordinatePair('lng', 'lat', 'Photo')
    if (supplied.error) return reply.code(400).send({ error: supplied.error })
    const fallback = coordinatePair('fallbackLng', 'fallbackLat', 'Fallback')
    if (fallback.error) return reply.code(400).send({ error: fallback.error })
    const allowedLocationSources = new Set(['exif', 'trail', 'live', 'manual', 'approximate'])
    const requestedLocationSource = String(fields.locationSource || '').trim() || null
    if (requestedLocationSource && !allowedLocationSources.has(requestedLocationSource)) {
      return reply.code(400).send({ error: 'The photo location source is invalid' })
    }
    const fallbackLocationSource = String(fields.fallbackLocationSource || 'live').trim()
    if (!['live', 'approximate'].includes(fallbackLocationSource)) {
      return reply.code(400).send({ error: 'The photo fallback location source is invalid' })
    }

    let lng = supplied.lng,
      lat = supplied.lat
    const takenAt = dateFrom(fields.takenAt)
    if (fields.takenAt && !takenAt) {
      return reply.code(400).send({ error: 'The photo capture time is invalid' })
    }
    let locationSource = requestedLocationSource
    if ((lng == null || lat == null) && takenAt && repository.findPositionNearCapture) {
      const matched = await repository.findPositionNearCapture(
        user,
        request.params.tripId,
        takenAt,
        30 * 60_000,
      )
      if (matched) {
        lng = matched.lng
        lat = matched.lat
        locationSource = 'trail'
      }
    }
    if (lng == null || lat == null) {
      if (fallback.lng != null && fallback.lat != null) {
        lng = fallback.lng
        lat = fallback.lat
        locationSource = fallbackLocationSource
      }
    }
    if (lng == null || lat == null) locationSource = null

    let stored
    try {
      stored = await fileStore.storePhoto({ tripId: request.params.tripId, bytes })
    } catch {
      return reply.code(400).send({ error: 'That file is not a readable image' })
    }
    try {
      const photo = await repository.createPhoto(user, request.params.tripId, {
        ...stored,
        stopId: fields.stopId || null,
        caption: String(fields.caption || '').trim() || null,
        lng,
        lat,
        takenAt,
        locationSource,
        clientKey,
      })
      if (!photo) throw new Error('Trip not found')
      return reply.code(201).send({
        ...photo,
        src: mediaUrl(photo.storagePath),
        thumbSrc: photo.thumbPath ? mediaUrl(photo.thumbPath) : null,
      })
    } catch (error) {
      await fileStore.remove(stored.storagePath)
      await fileStore.remove(stored.thumbPath)
      throw error
    }
  })

  app.patch('/api/trips/:tripId/photos/:photoId', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    const photo = await repository.updatePhoto(
      user,
      request.params.tripId,
      request.params.photoId,
      {
        ...(request.body?.caption !== undefined ? { caption: String(request.body.caption) } : {}),
        ...(request.body && 'stopId' in request.body
          ? { stopId: request.body.stopId || null }
          : {}),
      },
    )
    if (!photo) return reply.code(404).send({ error: 'Photo not found' })
    return photo
  })

  app.delete('/api/trips/:tripId/photos/:photoId', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    const removed = await repository.deletePhoto(
      user,
      request.params.tripId,
      request.params.photoId,
    )
    if (!removed) return reply.code(404).send({ error: 'Photo not found' })
    if (fileStore) {
      for (const path of [removed.storagePath, removed.thumbPath].filter(Boolean))
        await removeQueuedFile(path)
    }
    return reply.code(204).send()
  })

  app.get('/api/media/*', async (request, reply) => {
    if (!fileStore) return reply.code(404).send()
    const storagePath = request.params['*']
    const expires = Number(request.query?.expires)
    const supplied = String(request.query?.signature || '')
    const expected = mediaSignature(storagePath, expires)
    const valid =
      Number.isInteger(expires) &&
      expires >= Math.floor(clock().getTime() / 1000) &&
      sameSignature(supplied, expected)
    if (!valid) return reply.code(403).send({ error: 'That photo link has expired' })
    try {
      const bytes = await fileStore.read(storagePath)
      return reply.type('image/jpeg').header('cache-control', 'private, max-age=3600').send(bytes)
    } catch {
      return reply.code(404).send({ error: 'Photo not found' })
    }
  })

  app.post('/api/trips/:tripId/devices', { bodyLimit: 16 * 1024 }, async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    const name = String(request.body?.name || '').trim()
    if (!name) return reply.code(400).send({ error: 'A phone needs a name' })
    if (!(await repository.canEditTrip(user.id, request.params.tripId))) {
      return reply.code(403).send({ error: 'You cannot add a phone to this trip' })
    }
    const retryAfter = deviceRegistrationLimiter.hit(user.id, deviceRegistrationRateLimit)
    if (retryAfter) {
      return reply
        .header('retry-after', String(retryAfter))
        .code(429)
        .send({ error: 'Too many phone registrations' })
    }
    const currentDevices = await repository.listDevices(user, request.params.tripId)
    if (currentDevices?.length >= maxDevicesPerTrip) {
      return reply
        .code(409)
        .send({ error: `A trip can have at most ${maxDevicesPerTrip} registered phones` })
    }
    const token = newToken()
    const base =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'phone'
    const device = await repository.registerDevice(user, request.params.tripId, {
      name,
      slug: `${base}-${randomBytes(2).toString('hex')}`,
      timezone: request.body?.timezone || null,
      tokenHash: tokenHash(token),
    })
    if (!device) return reply.code(404).send({ error: 'Trip not found' })
    return reply.code(201).send({
      id: device.id,
      name: device.name,
      slug: device.slug,
      userId: device.userId,
      lastSeen: device.lastSeen,
      token,
    })
  })

  app.get('/api/trips/:tripId/devices', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    const devices = await repository.listDevices(user, request.params.tripId)
    if (!devices) return reply.code(403).send({ error: 'You cannot view this trip' })
    return devices.map(device => ({
      id: device.id,
      name: device.name,
      slug: device.slug,
      userId: device.userId,
      lastSeen: device.lastSeen?.toISOString?.() || device.lastSeen || null,
      pausedAt: device.pausedAt?.toISOString?.() || device.pausedAt || null,
    }))
  })

  /* The setup card says the token is shown once; this is the honest second
     chance. A new code is issued and the old one is dead the moment this
     returns — no lecture about writing it down. */
  app.post('/api/trips/:tripId/devices/:deviceId/token', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    const token = newToken()
    const device = await repository.resetDeviceToken(
      user,
      request.params.tripId,
      request.params.deviceId,
      tokenHash(token),
    )
    if (!device) return reply.code(404).send({ error: 'Phone not found' })
    return {
      id: device.id,
      name: device.name,
      slug: device.slug,
      userId: device.userId,
      lastSeen: device.lastSeen?.toISOString?.() || device.lastSeen || null,
      token,
    }
  })

  app.delete('/api/trips/:tripId/devices/:deviceId', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    if (!(await repository.removeDevice(user, request.params.tripId, request.params.deviceId))) {
      return reply.code(404).send({ error: 'Phone not found' })
    }
    return reply.code(204).send()
  })

  app.post('/api/ingest/track', async (request, reply) => {
    // Repeated query keys arrive as arrays; hashing one throws, and an
    // unauthenticated 500 is worse than the 401 this should be.
    const accessToken = bearer(request) || one(request.query?.id) || one(request.query?.token)
    const device = accessToken
      ? await repository.findDeviceByTokenHash(tokenHash(accessToken))
      : null
    if (!device) return reply.code(401).send({ error: 'Unknown phone' })
    stamp({ 'device.id': device.id, 'trip.id': device.tripId })

    const retryAfter = ingestLimiter.hit(device.id, ingestRateLimit)
    if (retryAfter) {
      return reply
        .header('retry-after', String(retryAfter))
        .code(429)
        .send({ error: 'Too many position updates' })
    }

    const body = request.body && typeof request.body === 'object' ? request.body : {}
    if (body._type && body._type !== 'location') return []
    /* "I stopped on purpose" is as much a fact as a fix — and the only thing
       that lets the viewers' copy say "paused" instead of guessing from
       silence. The next real fix clears it. */
    if (body.paused === true || body.paused === 'true' || request.query?.paused === 'true') {
      event('mark paused', { 'device.id': device.id })
      await repository.markDevicePaused(device, clock())
      liveStream.announce(device.tripId)
      return reply.type('text/plain').send('OK')
    }
    const lat = finite(body.lat ?? request.query?.lat)
    const lng = finite(body.lon ?? body.lng ?? request.query?.lon ?? request.query?.lng)
    if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return reply.code(400).send({ error: 'No valid position in request' })
    }
    const at = dateFrom(body.tst ?? body.timestamp ?? request.query?.timestamp) || clock()
    const now = clock()
    if (
      at > new Date(now.getTime() + 5 * 60_000) ||
      at < new Date(now.getTime() - 30 * 24 * 60 * 60_000)
    ) {
      return reply.code(400).send({ error: 'Position timestamp is outside the accepted range' })
    }
    const ownTracks = body._type === 'location'
    const rawSpeed = finite(body.vel ?? body.speed ?? request.query?.speed)
    const fix = {
      lng,
      lat,
      at,
      accuracy: finite(body.acc ?? body.accuracy ?? request.query?.accuracy),
      altitude: finite(body.alt ?? body.altitude ?? request.query?.altitude),
      speed: rawSpeed == null ? null : rawSpeed / (ownTracks ? 3.6 : 1.943844),
      heading: finite(body.cog ?? body.bearing ?? request.query?.bearing),
      battery: finite(body.batt ?? body.battery ?? request.query?.batt),
    }
    const stored = await repository.insertPosition(device, fix)
    // Everyone looking at this trip hears about it now, rather than within ten
    // seconds of now.
    if (stored !== false) liveStream.announce(device.tripId)
    return ownTracks ? [] : reply.type('text/plain').send('OK')
  })

  app.get('/api/trips/:tripId/live', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    const hours = Math.min(Math.max(finite(request.query?.hours) || 24, 1), 720)
    const rawCursor = finite(request.query?.cursor)
    const cursor = rawCursor == null ? 0 : Math.max(0, Math.floor(rawCursor))
    const result = await repository.loadLive(
      user,
      request.params.tripId,
      new Date(clock().getTime() - hours * 3600_000),
      { afterId: cursor },
    )
    if (!result) return reply.code(403).send({ error: 'You cannot view this trip' })
    return livePayload(result)
  })

  /* The same positions as /live, pushed. The browser holds this open and the
     server writes a frame when a phone reports; there is no interval anywhere.

     It is Server-Sent Events rather than a socket because everything here goes
     one way: phones post over plain HTTP and browsers only listen. That also
     means no protocol upgrade to arrange through Caddy, and a reconnect that
     resumes from the cursor it already had. */
  app.get('/api/trips/:tripId/live/stream', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    const tripId = request.params.tripId
    const hours = Math.min(Math.max(finite(request.query?.hours) || 24, 1), 720)
    const since = () => new Date(clock().getTime() - hours * 3600_000)
    const rawCursor = finite(request.query?.cursor)
    let cursor = rawCursor == null ? 0 : Math.max(0, Math.floor(rawCursor))

    const opening = await repository.loadLive(user, tripId, since(), { afterId: cursor })
    if (!opening) return reply.code(403).send({ error: 'You cannot view this trip' })

    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Nothing between here and the browser may hold a frame back waiting for
      // more of it; that is what turns a push into a slower poll.
      'x-accel-buffering': 'no',
    })

    let open = true
    const write = text => {
      if (!open) return
      try {
        reply.raw.write(text)
      } catch {
        open = false
      }
    }
    const send = payload => {
      cursor = payload.cursor
      write(`id: ${payload.cursor}\ndata: ${JSON.stringify(payload)}\n\n`)
    }

    // Tell the browser how long to wait before reconnecting, then hand it
    // whatever it missed while it was away.
    write('retry: 3000\n\n')
    send(livePayload(opening))

    let reading = false
    let again = false
    const deliver = async () => {
      if (reading) {
        again = true
        return
      }
      reading = true
      try {
        do {
          again = false
          const next = await repository.loadLive(user, tripId, since(), { afterId: cursor })
          if (!next || !open) break
          if (next.fixes.length || next.devices.length) send(livePayload(next))
        } while (again && open)
      } catch {
        // A read that fails is not a reason to drop the connection; the next
        // position will try again, and the browser can always reconnect.
      } finally {
        reading = false
      }
    }

    const unwatch = liveStream.watch(tripId, kind => {
      if (kind === 'positions') {
        deliver()
        return
      }
      // Everything else says only what changed; the browser asks for that slice
      // rather than the server keeping a second copy of every serializer.
      write(`event: changed\ndata: ${JSON.stringify({ kind })}\n\n`)
    })
    // Proxies close a connection that says nothing. A comment is not an event.
    const heartbeat = setInterval(() => write(':\n\n'), 25_000)

    const close = () => {
      if (!open) return
      open = false
      clearInterval(heartbeat)
      unwatch()
      try {
        reply.raw.end()
      } catch {
        /* already gone */
      }
    }
    request.raw.on('close', close)
    request.raw.on('error', close)

    return reply
  })

  /* ---- connected mailboxes --------------------------------------------

     The sign-in and the consent are Microsoft's screens, because that is the
     point of OAuth: the password is typed somewhere we cannot see it and the
     scopes are granted somewhere we cannot fake. Everything either side of that
     is ours — which mailboxes are connected, adding another, removing one. */
  const connectorRedirect = `${publicUrl.replace(/\/$/, '')}/api/connectors/outlook/callback`

  const publicConnection = connection => ({
    id: connection.id,
    provider: connection.provider,
    email: connection.accountEmail,
    name: connection.accountName,
    scopes: connection.scopes,
    connectedAt: connection.connectedAt,
    lastUsedAt: connection.lastUsedAt,
    needsReconnect: connection.needsReconnect,
  })

  app.get('/api/connectors', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    const connections = await repository.listMailboxConnections(user.id)
    return {
      configured: connectorReady,
      // Named so the screen can say what it is offering without knowing how it
      // is wired underneath.
      providers: connectorReady ? [{ id: 'outlook', name: 'Outlook', scopes: DEFAULT_SCOPES }] : [],
      connections: connections.map(publicConnection),
    }
  })

  app.post('/api/connectors/outlook/start', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    if (!connectorReady) {
      return reply.code(503).send({ error: 'No mailbox connector is configured on this server' })
    }
    const verifier = createVerifier()
    const state = createState()
    await repository.startMailboxConnection({
      userId: user.id,
      provider: 'outlook',
      stateHash: stateHash(state),
      verifier,
      redirectTo: typeof request.body?.redirectTo === 'string' ? request.body.redirectTo : null,
      expiresAt: new Date(clock().getTime() + 10 * 60_000),
    })
    /* prompt=select_account only once a mailbox is already connected.

       Microsoft's /common endpoint currently misroutes personal accounts when
       the account picker is forced on a fresh browser session — Home Realm
       Discovery sends them down the organisational path and refuses them with
       "you can't sign in here with a personal account". The first connection
       is exactly that fresh-session case, so it goes without the prompt and
       lets Microsoft authenticate whatever identity is typed. A SECOND mailbox
       still needs the picker (without it Microsoft silently reconnects the
       first account) — and by then a Microsoft session cookie exists, which is
       precisely the condition under which the picker routes correctly. */
    const connected = await repository.listMailboxConnections(user.id)
    return {
      authorizeUrl: authorizeUrl({
        clientId: microsoft.clientId,
        tenant: microsoft.tenant,
        redirectUri: connectorRedirect,
        state,
        challenge: challengeFor(verifier),
        prompt: connected.length ? 'select_account' : undefined,
      }),
    }
  })

  app.get('/api/connectors/outlook/callback', async (request, reply) => {
    const back = where =>
      reply.redirect(`${publicUrl.replace(/\/$/, '')}/profile?tab=connections${where}`)
    if (request.query?.error) return back(`&connected=denied`)
    const pending = request.query?.state
      ? await repository.takeMailboxConnectionRequest(stateHash(request.query.state))
      : null
    if (!pending || !request.query?.code) return back('&connected=expired')

    try {
      const response = await connectorFetch(tokenUrl(microsoft.tenant), {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: tokenRequestBody({
          clientId: microsoft.clientId,
          clientSecret: microsoft.clientSecret,
          code: request.query.code,
          redirectUri: connectorRedirect,
          verifier: pending.verifier,
        }).toString(),
      })
      const tokens = await response.json()
      if (!response.ok || !tokens.access_token)
        throw new Error(tokens.error_description || 'No token')

      const who = await connectorFetch('https://graph.microsoft.com/v1.0/me', {
        headers: { authorization: `Bearer ${tokens.access_token}` },
      })
        .then(result => result.json())
        .catch(() => ({}))

      await repository.saveMailboxConnection({
        userId: pending.userId,
        provider: 'outlook',
        accountId: who.id || who.userPrincipalName || who.mail || 'unknown',
        accountEmail: who.mail || who.userPrincipalName || null,
        accountName: who.displayName || null,
        tenant: microsoft.tenant || 'common',
        scopes: String(tokens.scope || '')
          .split(' ')
          .filter(Boolean),
        accessToken: mailboxBox.seal(tokens.access_token),
        refreshToken: mailboxBox.seal(tokens.refresh_token),
        expiresAt: expiresAt(tokens, clock()),
      })
      return back('&connected=yes')
    } catch {
      return back('&connected=failed')
    }
  })

  app.delete('/api/connectors/:id', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    const removed = await repository.deleteMailboxConnection(user.id, request.params.id)
    if (!removed) return reply.code(404).send({ error: 'That mailbox is not connected' })
    return reply.code(204).send()
  })

  app.post('/api/trips/:tripId/stops', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    const body = request.body || {}
    const name = String(body.name || '').trim()
    const lng = finite(body.lng),
      lat = finite(body.lat)
    if (!name || lng == null || lat == null || Math.abs(lng) > 180 || Math.abs(lat) > 90) {
      return reply.code(400).send({ error: 'A stop needs a name and valid coordinates' })
    }
    const stop = await repository.createStop(user, request.params.tripId, {
      name,
      kind: body.kind || null,
      icon: body.icon || 'pin',
      day: body.day || null,
      time: body.time || null,
      lng,
      lat,
      status: body.status || 'planned',
      note: body.note || null,
      src: body.src || null,
      sourceUrl: body.sourceUrl || null,
      seq: Number.isInteger(body.seq) ? body.seq : 0,
    })
    if (!stop) return reply.code(403).send({ error: 'You cannot edit this trip' })
    return reply.code(201).send(stop)
  })

  app.patch('/api/trips/:tripId/stops/:stopId', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    const fields = request.body || {}
    /* The create route checks these; without the same check here the same
       values get in through the side door and every member's map breaks. */
    for (const key of ['lng', 'lat']) {
      if (fields[key] === undefined) continue
      const value = finite(fields[key])
      const limit = key === 'lng' ? 180 : 90
      if (value == null || Math.abs(value) > limit) {
        return reply.code(400).send({ error: 'A stop needs valid coordinates' })
      }
      fields[key] = value
    }
    if (fields.status !== undefined && !STOP_STATUSES.has(String(fields.status))) {
      return reply.code(400).send({ error: 'That is not a stop status' })
    }
    if (fields.seq !== undefined && !Number.isInteger(fields.seq)) {
      return reply.code(400).send({ error: 'A stop order must be a whole number' })
    }
    const stop = await repository.updateStop(
      user,
      request.params.tripId,
      request.params.stopId,
      fields,
    )
    if (!stop) return reply.code(404).send({ error: 'Stop not found' })
    return stop
  })

  app.delete('/api/trips/:tripId/stops/:stopId', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    const removed = await repository.deleteStop(user, request.params.tripId, request.params.stopId)
    if (!removed) return reply.code(404).send({ error: 'Stop not found' })
    return reply.code(204).send()
  })

  app.put('/api/trips/:tripId/route', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    const points = Array.isArray(request.body?.points) ? request.body.points : null
    const valid = points?.every(
      point =>
        Array.isArray(point) &&
        point.length === 2 &&
        finite(point[0]) != null &&
        finite(point[1]) != null &&
        Math.abs(point[0]) <= 180 &&
        Math.abs(point[1]) <= 90,
    )
    if (!valid) return reply.code(400).send({ error: 'Route points are invalid' })
    if (!(await repository.replaceRoute(user, request.params.tripId, points))) {
      return reply.code(403).send({ error: 'You cannot edit this trip' })
    }
    return reply.code(204).send()
  })

  app.get('/api/trips/:tripId/invites', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    const invites = await repository.listInvites(user, request.params.tripId)
    if (!invites) return reply.code(403).send({ error: 'You cannot manage this trip' })
    return invites
  })

  app.get('/api/invites/pending', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    return repository.listPendingInvites(user)
  })

  app.post('/api/invites/:inviteId/accept', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    const accepted = await repository.acceptInvite(user, request.params.inviteId)
    if (!accepted) return reply.code(404).send({ error: 'Invitation not found' })
    return accepted
  })

  app.post('/api/trips/:tripId/invites', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    const email = normalizeEmail(request.body?.email)
    const role = request.body?.role === 'editor' ? 'editor' : 'viewer'
    if (!singleAddress(email)) return reply.code(400).send({ error: 'Enter a valid email address' })
    /* Nothing else stops one account posting this route in a loop: the invite
       row is upserted, so every call sends another mail from our identity to
       an address the recipient never asked us to write to. */
    const slowDown =
      inviteLimiter.hit(`user:${user.id}`, inviteRateLimit) ||
      inviteLimiter.hit(`to:${email}`, inviteTargetRateLimit)
    if (slowDown) {
      return reply
        .header('retry-after', String(slowDown))
        .code(429)
        .send({ error: 'Too many invitations just now. Try again shortly.' })
    }
    const invite = await repository.upsertInvite(user, request.params.tripId, {
      email,
      name: String(request.body?.name || '').trim() || null,
      role,
    })
    if (!invite) return reply.code(403).send({ error: 'You cannot manage this trip' })
    let mailed = true,
      mailError = null
    try {
      await sendTripInvitation(invite)
    } catch (error) {
      mailed = false
      mailError = error.message
    }
    return reply.code(201).send({ ...invite, mailed, mailError })
  })

  app.delete('/api/trips/:tripId/invites/:inviteId', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    const removed = await repository.revokeInvite(
      user,
      request.params.tripId,
      request.params.inviteId,
    )
    if (!removed) return reply.code(404).send({ error: 'Invitation not found' })
    return reply.code(204).send()
  })

  app.delete('/api/trips/:tripId/members/:profileId', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    const result = await repository.removeMember(
      user,
      request.params.tripId,
      request.params.profileId,
    )
    if (result === 'owner') return reply.code(409).send({ error: 'A trip owner cannot be removed' })
    if (result !== 'removed') return reply.code(404).send({ error: 'Trip member not found' })
    return reply.code(204).send()
  })

  app.post('/api/trips/:tripId/photos/:photoId/comments', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    const body = String(request.body?.body || '').trim()
    if (!body) return reply.code(400).send({ error: 'A comment cannot be empty' })
    const comment = await repository.addComment(
      user,
      request.params.tripId,
      request.params.photoId,
      body,
    )
    if (!comment) return reply.code(404).send({ error: 'Photo not found' })
    return reply.code(201).send(comment)
  })

  app.delete('/api/trips/:tripId/comments/:commentId', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    if (!(await repository.deleteComment(user, request.params.tripId, request.params.commentId))) {
      return reply.code(404).send({ error: 'Comment not found' })
    }
    return reply.code(204).send()
  })

  app.put('/api/trips/:tripId/photos/:photoId/like', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    if (!(await repository.setLike(user, request.params.tripId, request.params.photoId, true))) {
      return reply.code(404).send({ error: 'Photo not found' })
    }
    return reply.code(204).send()
  })

  app.delete('/api/trips/:tripId/photos/:photoId/like', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    if (!(await repository.setLike(user, request.params.tripId, request.params.photoId, false))) {
      return reply.code(404).send({ error: 'Photo not found' })
    }
    return reply.code(204).send()
  })

  app.get('/api/attractions', async (request, reply) => {
    if (!repository.loadAttractions)
      return reply.code(404).send({ error: 'Attractions are not configured' })
    const bounds = {
      west: finite(request.query?.west),
      east: finite(request.query?.east),
      south: finite(request.query?.south),
      north: finite(request.query?.north),
    }
    if (Object.values(bounds).some(value => value == null))
      return reply.code(400).send({ error: 'Map bounds are required' })
    const limit = Math.min(Math.max(Math.trunc(finite(request.query?.limit) || 1000), 1), 1000)
    const values = await repository.loadAttractions(bounds, {
      headlineOnly: request.query?.headlineOnly === 'true',
      limit,
    })
    return values.map(value => ({
      id: value.id,
      n: value.name,
      d: value.descr || '',
      k: value.category,
      f: value.imageFile,
      x: value.lng,
      y: value.lat,
      t: value.extract || '',
    }))
  })

  /* The inside of an airport, from Overpass via a shared server-side cache:
     one fetch per airport per month rather than one per phone. Unauthenticated
     like the attractions, and the raw Overpass JSON goes back as-is — the app
     owns the conversion. */
  const indoor =
    indoorCache ||
    createIndoorCache({
      userAgent: `OffWeGo (${publicUrl})`,
      /* Durable in Postgres when the repository can hold it, so a deploy's
         restart does not send the next phone back to Overpass for a terminal
         already fetched this month. Test repositories without the methods
         simply run memory-only, as before. */
      store: repository.readAirportIndoor
        ? {
            read: key => repository.readAirportIndoor(key),
            write: (key, body, at) => repository.writeAirportIndoor(key, body, at),
          }
        : null,
    })
  app.get('/api/airports/indoor', async (request, reply) => {
    const lng = finite(request.query?.lng),
      lat = finite(request.query?.lat)
    if (lng == null || lat == null || Math.abs(lng) > 180 || Math.abs(lat) > 90) {
      return reply.code(400).send({ error: 'A position is required' })
    }
    /* Nobody has to sign in for this, and every miss fans out to three public
       Overpass mirrors. Walking the coordinates a thousandth of a degree at a
       time would be a guaranteed miss every time, and their ban would land on
       us rather than on whoever was walking. */
    const retryAfter = indoorLimiter.hit(clientAddress(request), indoorRateLimit)
    if (retryAfter) {
      request.log.info({ client: clientAddress(request) }, 'airport indoor rate limited')
      return reply
        .header('retry-after', String(retryAfter))
        .code(429)
        .send({ error: 'Too many airport lookups' })
    }
    try {
      const body = await indoor.get(lng, lat)
      /* Hand-laid walkways ride along at serve time, not cache-fill time, so
         a segment the assistant adds routes immediately instead of waiting
         out the month-long Overpass cache. */
      const walkways = repository.listAirportWalkways
        ? await repository.listAirportWalkways(lng, lat).catch(() => [])
        : []
      stamp({
        'airport.lng': lng,
        'airport.lat': lat,
        'element.count': body?.elements?.length ?? 0,
        'walkway.count': walkways.length,
      })
      return mergeWalkways(body, walkways)
    } catch (error) {
      // The night the gates vanished per-phone there was no record of what
      // anyone was served; this line is that record.
      request.log.warn({ err: error, lng, lat }, 'airport indoor fetch failed')
      return reply.code(502).send({ error: 'The map source is not answering' })
    }
  })

  return app
}
