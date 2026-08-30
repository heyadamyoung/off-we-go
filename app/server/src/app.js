import Fastify from 'fastify'
import multipart from '@fastify/multipart'
import cors from '@fastify/cors'
import formbody from '@fastify/formbody'
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { registerMcpRoutes } from './mcp.js'

const normalizeEmail = value => String(value || '').trim().toLowerCase()
const tokenHash = value => createHash('sha256').update(value).digest('hex')
const newToken = () => randomBytes(32).toString('base64url')

function bearer(request) {
  const value = request.headers.authorization || ''
  return value.startsWith('Bearer ') ? value.slice(7).trim() : null
}

export async function buildServer({ repository, fileStore = null, mailer, publicUrl, sessionSecret,
  clock = () => new Date(), ingestRateLimit = { max: 180, windowMs: 60_000 },
  authRateLimit = { maxPerEmail: 3, maxPerIp: 20, windowMs: 15 * 60_000 },
  appleTeamId = null, appleBundleId = 'ai.threadway.wayfare', logger = false, oauthSecret = null,
  trustProxy = ['loopback', 'linklocal', 'uniquelocal'] }) {
  if (!repository) throw new Error('A repository is required')
  if (!mailer) throw new Error('A mailer is required')
  if (!publicUrl) throw new Error('WAYFARE_PUBLIC_URL is required')
  if (!sessionSecret || sessionSecret.length < 16) throw new Error('WAYFARE_SESSION_SECRET must be at least 16 characters')
  oauthSecret ||= sessionSecret
  if (oauthSecret.length < 16) throw new Error('WAYFARE_OAUTH_SECRET must be at least 16 characters')

  const app = Fastify({ logger, bodyLimit: 30 * 1024 * 1024, trustProxy })
  const ingestWindows = new Map()
  const authEmailWindows = new Map(), authIpWindows = new Map()
  const rateWindow = (windows, key, max, windowMs) => {
    const now = clock().getTime()
    let value = windows.get(key)
    if (!value || now - value.startedAt >= windowMs) {
      value = { startedAt: now, count: 0 }
      windows.set(key, value)
    }
    value.count++
    return value.count > max
      ? Math.max(1, Math.ceil((value.startedAt + windowMs - now) / 1000)) : 0
  }
  const allowedOrigins = new Set([
    publicUrl.replace(/\/$/, ''), 'capacitor://localhost', 'ionic://localhost',
  ])
  await app.register(cors, {
    origin(origin, callback) { callback(null, !origin || allowedOrigins.has(origin)) },
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type', 'authorization'], maxAge: 86400,
  })
  await app.register(formbody)
  await app.register(multipart, {
    limits: { files: 1, fileSize: 25 * 1024 * 1024, fields: 20 },
  })

  app.get('/api/health', async (_request, reply) => {
    try {
      await Promise.all([repository.ready?.(), fileStore?.ready?.()])
      return { ok: true }
    } catch (error) {
      app.log.warn({ err: error }, 'readiness check failed')
      return reply.code(503).send({ ok: false })
    }
  })
  app.get('/.well-known/apple-app-site-association', async (_request, reply) => {
    if (!appleTeamId) return reply.code(404).send({ error: 'Apple universal links are not configured' })
    return reply.type('application/json').send({
      applinks: { apps: [], details: [{ appID: `${appleTeamId}.${appleBundleId}`, paths: ['/auth/callback*'] }] },
    })
  })

  const mediaSignature = (storagePath, expires) => createHmac('sha256', sessionSecret)
    .update(`${storagePath}:${expires}`).digest('base64url')
  const mediaUrl = storagePath => {
    const expires = Math.floor(clock().getTime() / 1000) + 3600
    return `/api/media/${storagePath}?expires=${expires}&signature=${mediaSignature(storagePath, expires)}`
  }
  const finite = value => {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  const dateFrom = value => {
    if (value == null || value === '') return null
    const numeric = Number(value)
    const date = Number.isFinite(numeric)
      ? new Date(numeric > 1e12 ? numeric : numeric * 1000) : new Date(String(value))
    return Number.isNaN(date.getTime()) ? null : date
  }

  const issueMagicLink = async (email, continuation = null) => {
    const token = newToken()
    const now = clock()
    await repository.createMagicToken({
      hash: tokenHash(token), email,
      expiresAt: new Date(now.getTime() + 15 * 60_000),
    })
    const root = publicUrl.replace(/\/$/, '')
    const callback = new URL('/auth/callback', root)
    callback.searchParams.set('token', token)
    if (typeof continuation === 'string') {
      try {
        const destination = new URL(continuation, root)
        if (destination.origin === root && destination.pathname === '/oauth/authorize') {
          callback.searchParams.set('continue', destination.pathname + destination.search)
        }
      } catch {}
    }
    const universalUrl = callback.href
    const message = {
      to: email,
      webUrl: universalUrl,
      nativeUrl: universalUrl,
    }
    await mailer.send(message)
    return message
  }

  app.post('/api/auth/magic-link', async (request, reply) => {
    const email = normalizeEmail(request.body?.email)
    const retryAfter = Math.max(
      rateWindow(authEmailWindows, email || '<empty>', authRateLimit.maxPerEmail, authRateLimit.windowMs),
      rateWindow(authIpWindows, request.ip, authRateLimit.maxPerIp, authRateLimit.windowMs),
    )
    if (retryAfter) return reply.header('retry-after', String(retryAfter)).code(429).send({ error: 'Try again later' })
    if (email && await repository.emailAllowed(email)) {
      await issueMagicLink(email, request.body?.continue)
    }
    return reply.code(202).send({ ok: true })
  })

  app.post('/api/auth/exchange', async (request, reply) => {
    const token = String(request.body?.token || '')
    const now = clock()
    const email = token.length >= 32
      ? await repository.consumeMagicToken(tokenHash(token), now) : null
    if (!email) return reply.code(401).send({ error: 'That sign-in link is invalid or has expired' })

    const user = await repository.ensureUser(email)
    const accessToken = newToken()
    await repository.createSession({
      hash: tokenHash(accessToken), userId: user.id,
      expiresAt: new Date(now.getTime() + 90 * 24 * 60 * 60_000),
    })
    return { accessToken, user }
  })

  app.get('/api/auth/session', async (request, reply) => {
    const accessToken = bearer(request)
    const user = accessToken
      ? await repository.findSession(tokenHash(accessToken), clock()) : null
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
    const user = accessToken
      ? await repository.findSession(tokenHash(accessToken), clock()) : null
    if (!user) reply.code(401).send({ error: 'Sign in required' })
    return user
  }

  await registerMcpRoutes(app, {
    repository, fileStore, publicUrl, oauthSecret, clock,
    authenticate: authenticated, sendInvite: issueMagicLink,
  })

  app.delete('/api/account', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    if (request.body?.confirm !== 'DELETE') {
      return reply.code(400).send({ error: 'Type DELETE to confirm account deletion' })
    }
    const paths = await repository.deleteAccount(user)
    if (fileStore) for (const path of paths) await fileStore.remove(path).catch(() => {})
    return reply.code(204).send()
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
    const row = await repository.loadCurrentTrip(user, request.query?.t || null)
    if (!row) return reply.code(404).send({ error: 'No trip found' })

    const member = value => ({
      id: value.userId,
      name: value.displayName || value.email.split('@')[0],
      role: ['owner', 'editor'].includes(value.role) ? 'Travelling' : 'Following',
      memberRole: value.role,
      avatar: value.avatarUrl ? mediaUrl(value.avatarUrl) : null,
    })
    const family = row.members.map(member)
    const me = member(row.members.find(value => value.userId === user.id))
    return {
      source: 'vps', tripId: row.id,
      trip: {
        id: row.id, slug: row.slug, title: row.title, crew: row.crew,
        dates: row.dates, dayCount: row.dayCount, startsOn: row.startsOn, endsOn: row.endsOn,
      },
      stops: row.stops,
      photos: row.photos.map(photo => ({
        ...photo, src: mediaUrl(photo.storagePath),
        thumbSrc: photo.thumbPath ? mediaUrl(photo.thumbPath) : null,
      })),
      route: row.route,
      comments: row.comments, likes: row.likes, family,
      canEdit: ['owner', 'editor'].includes(row.members.find(value => value.userId === user.id)?.role),
      me,
    }
  })

  app.patch('/api/trips/:tripId', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    const trip = await repository.updateTrip(user, request.params.tripId, request.body || {})
    if (!trip) return reply.code(403).send({ error: 'You cannot edit this trip' })
    return trip
  })

  app.patch('/api/trips/:tripId/members/me', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    const member = await repository.updateProfile(user, request.params.tripId, {
      ...(request.body?.name !== undefined ? { name: String(request.body.name).trim() || user.email.split('@')[0] } : {}),
      ...(request.body?.avatarPath !== undefined ? { avatarPath: request.body.avatarPath } : {}),
    })
    if (!member) return reply.code(404).send({ error: 'Trip membership not found' })
    return {
      id: member.userId, name: member.displayName || member.email.split('@')[0],
      role: ['owner', 'editor'].includes(member.role) ? 'Travelling' : 'Following',
      memberRole: member.role, avatar: member.avatarUrl ? mediaUrl(member.avatarUrl) : null,
    }
  })

  app.post('/api/trips/:tripId/members/me/avatar', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    if (!fileStore?.storeAvatar) return reply.code(503).send({ error: 'Avatar storage is not configured' })
    if (!await repository.canReadTrip(user.id, request.params.tripId)) {
      return reply.code(403).send({ error: 'You cannot edit this profile' })
    }
    let bytes = null
    for await (const part of request.parts()) {
      if (part.type !== 'file') continue
      if (!part.mimetype?.startsWith('image/')) return reply.code(415).send({ error: 'Only images can be uploaded' })
      bytes = await part.toBuffer()
    }
    if (!bytes?.length) return reply.code(400).send({ error: 'Choose an avatar to upload' })
    let stored
    try { stored = await fileStore.storeAvatar({ tripId: request.params.tripId, userId: user.id, bytes }) }
    catch { return reply.code(400).send({ error: 'That file is not a readable image' }) }
    const member = await repository.updateProfile(user, request.params.tripId, stored)
    if (!member) {
      await fileStore.remove(stored.avatarPath).catch(() => {})
      return reply.code(404).send({ error: 'Trip membership not found' })
    }
    return reply.code(201).send({ avatarPath: stored.avatarPath, avatar: mediaUrl(stored.avatarPath) })
  })

  app.post('/api/trips/:tripId/photos', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    if (!fileStore) return reply.code(503).send({ error: 'Photo storage is not configured' })
    if (!await repository.canEditTrip(user.id, request.params.tripId)) {
      return reply.code(403).send({ error: 'You cannot add photos to this trip' })
    }

    let bytes = null
    const fields = {}
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        if (!part.mimetype?.startsWith('image/')) return reply.code(415).send({ error: 'Only images can be uploaded' })
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
      if (existing) return {
        ...existing, src: mediaUrl(existing.storagePath),
        thumbSrc: existing.thumbPath ? mediaUrl(existing.thumbPath) : null,
      }
    }

    let stored
    try { stored = await fileStore.storePhoto({ tripId: request.params.tripId, bytes }) }
    catch { return reply.code(400).send({ error: 'That file is not a readable image' }) }

    let lng = finite(fields.lng), lat = finite(fields.lat)
    const takenAt = dateFrom(fields.takenAt)
    if (fields.takenAt && !takenAt) {
      await fileStore.remove(stored.storagePath).catch(() => {})
      await fileStore.remove(stored.thumbPath).catch(() => {})
      return reply.code(400).send({ error: 'The photo capture time is invalid' })
    }
    let locationSource = fields.locationSource || null
    if ((lng == null || lat == null) && takenAt && repository.findPositionNearCapture) {
      const matched = await repository.findPositionNearCapture(user, request.params.tripId, takenAt, 30 * 60_000)
      if (matched) { lng = matched.lng; lat = matched.lat; locationSource = 'trail' }
    }
    try {
      const photo = await repository.createPhoto(user, request.params.tripId, {
        ...stored,
        stopId: fields.stopId || null,
        caption: String(fields.caption || '').trim() || null,
        lng, lat, takenAt, locationSource, clientKey,
      })
      if (!photo) throw new Error('Trip not found')
      return reply.code(201).send({
        ...photo, src: mediaUrl(photo.storagePath),
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
    const photo = await repository.updatePhoto(user, request.params.tripId, request.params.photoId, {
      ...(request.body?.caption !== undefined ? { caption: String(request.body.caption) } : {}),
      ...(request.body && 'stopId' in request.body ? { stopId: request.body.stopId || null } : {}),
    })
    if (!photo) return reply.code(404).send({ error: 'Photo not found' })
    return photo
  })

  app.delete('/api/trips/:tripId/photos/:photoId', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    const removed = await repository.deletePhoto(user, request.params.tripId, request.params.photoId)
    if (!removed) return reply.code(404).send({ error: 'Photo not found' })
    if (fileStore) {
      await fileStore.remove(removed.storagePath).catch(() => {})
      if (removed.thumbPath) await fileStore.remove(removed.thumbPath).catch(() => {})
    }
    return reply.code(204).send()
  })

  app.get('/api/media/*', async (request, reply) => {
    if (!fileStore) return reply.code(404).send()
    const storagePath = request.params['*']
    const expires = Number(request.query?.expires)
    const supplied = String(request.query?.signature || '')
    const expected = mediaSignature(storagePath, expires)
    const valid = Number.isInteger(expires) && expires >= Math.floor(clock().getTime() / 1000) &&
      supplied.length === expected.length && timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
    if (!valid) return reply.code(403).send({ error: 'That photo link has expired' })
    try {
      const bytes = await fileStore.read(storagePath)
      return reply.type('image/jpeg').header('cache-control', 'private, max-age=3600').send(bytes)
    } catch { return reply.code(404).send({ error: 'Photo not found' }) }
  })

  app.post('/api/trips/:tripId/devices', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    const name = String(request.body?.name || '').trim()
    if (!name) return reply.code(400).send({ error: 'A phone needs a name' })
    if (!await repository.canEditTrip(user.id, request.params.tripId)) {
      return reply.code(403).send({ error: 'You cannot add a phone to this trip' })
    }
    const token = newToken()
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'phone'
    const device = await repository.registerDevice(user, request.params.tripId, {
      name, slug: `${base}-${randomBytes(2).toString('hex')}`,
      timezone: request.body?.timezone || null, tokenHash: tokenHash(token),
    })
    if (!device) return reply.code(404).send({ error: 'Trip not found' })
    return reply.code(201).send({
      id: device.id, name: device.name, slug: device.slug,
      userId: device.userId, lastSeen: device.lastSeen, token,
    })
  })

  app.get('/api/trips/:tripId/devices', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    const devices = await repository.listDevices(user, request.params.tripId)
    if (!devices) return reply.code(403).send({ error: 'You cannot view this trip' })
    return devices.map(device => ({
      id: device.id, name: device.name, slug: device.slug, userId: device.userId,
      lastSeen: device.lastSeen?.toISOString?.() || device.lastSeen || null,
    }))
  })

  app.delete('/api/trips/:tripId/devices/:deviceId', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    if (!await repository.removeDevice(user, request.params.tripId, request.params.deviceId)) {
      return reply.code(404).send({ error: 'Phone not found' })
    }
    return reply.code(204).send()
  })

  app.post('/api/ingest/track', async (request, reply) => {
    const accessToken = bearer(request) || request.query?.id || request.query?.token
    const device = accessToken ? await repository.findDeviceByTokenHash(tokenHash(accessToken)) : null
    if (!device) return reply.code(401).send({ error: 'Unknown phone' })

    const nowMs = clock().getTime()
    let window = ingestWindows.get(device.id)
    if (!window || nowMs - window.startedAt >= ingestRateLimit.windowMs) {
      window = { startedAt: nowMs, count: 0 }
      ingestWindows.set(device.id, window)
    }
    window.count++
    if (window.count > ingestRateLimit.max) {
      const retrySeconds = Math.max(1, Math.ceil((window.startedAt + ingestRateLimit.windowMs - nowMs) / 1000))
      return reply.header('retry-after', String(retrySeconds)).code(429).send({ error: 'Too many position updates' })
    }

    const body = request.body && typeof request.body === 'object' ? request.body : {}
    if (body._type && body._type !== 'location') return []
    const lat = finite(body.lat ?? request.query?.lat)
    const lng = finite(body.lon ?? body.lng ?? request.query?.lon ?? request.query?.lng)
    if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return reply.code(400).send({ error: 'No valid position in request' })
    }
    const at = dateFrom(body.tst ?? body.timestamp ?? request.query?.timestamp) || clock()
    const now = clock()
    if (at > new Date(now.getTime() + 5 * 60_000) || at < new Date(now.getTime() - 30 * 24 * 60 * 60_000)) {
      return reply.code(400).send({ error: 'Position timestamp is outside the accepted range' })
    }
    const ownTracks = body._type === 'location'
    const rawSpeed = finite(body.vel ?? body.speed ?? request.query?.speed)
    const fix = {
      lng, lat, at,
      accuracy: finite(body.acc ?? body.accuracy ?? request.query?.accuracy),
      altitude: finite(body.alt ?? body.altitude ?? request.query?.altitude),
      speed: rawSpeed == null ? null : rawSpeed / (ownTracks ? 3.6 : 1.943844),
      heading: finite(body.cog ?? body.bearing ?? request.query?.bearing),
      battery: finite(body.batt ?? body.battery ?? request.query?.batt),
    }
    await repository.insertPosition(device, fix)
    return ownTracks ? [] : reply.type('text/plain').send('OK')
  })

  app.get('/api/trips/:tripId/live', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    const hours = Math.min(Math.max(finite(request.query?.hours) || 24, 1), 168)
    const rawCursor = finite(request.query?.cursor)
    const cursor = rawCursor == null ? 0 : Math.max(0, Math.floor(rawCursor))
    const result = await repository.loadLive(
      user, request.params.tripId, new Date(clock().getTime() - hours * 3600_000), { afterId: cursor },
    )
    if (!result) return reply.code(403).send({ error: 'You cannot view this trip' })
    return {
      devices: result.devices.map(device => ({
        id: device.id, name: device.name, slug: device.slug, userId: device.userId,
        lastSeen: device.lastSeen?.toISOString?.() || device.lastSeen || null,
      })),
      fixes: result.fixes.map(fix => ({
        deviceId: fix.deviceId, lng: fix.lng, lat: fix.lat,
        accuracy: fix.accuracy, speed: fix.speed,
        at: fix.at.toISOString(),
      })),
      cursor: result.cursor,
    }
  })

  app.post('/api/trips/:tripId/stops', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    const body = request.body || {}
    const name = String(body.name || '').trim()
    const lng = finite(body.lng), lat = finite(body.lat)
    if (!name || lng == null || lat == null || Math.abs(lng) > 180 || Math.abs(lat) > 90) {
      return reply.code(400).send({ error: 'A stop needs a name and valid coordinates' })
    }
    const stop = await repository.createStop(user, request.params.tripId, {
      name, kind: body.kind || null, icon: body.icon || 'pin', day: body.day || null,
      time: body.time || null, lng, lat, status: body.status || 'planned',
      note: body.note || null, src: body.src || null, sourceUrl: body.sourceUrl || null,
      seq: Number.isInteger(body.seq) ? body.seq : 0,
    })
    if (!stop) return reply.code(403).send({ error: 'You cannot edit this trip' })
    return reply.code(201).send(stop)
  })

  app.patch('/api/trips/:tripId/stops/:stopId', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    const stop = await repository.updateStop(user, request.params.tripId, request.params.stopId, request.body || {})
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
    const valid = points && points.every(point => Array.isArray(point) && point.length === 2 &&
      finite(point[0]) != null && finite(point[1]) != null && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90)
    if (!valid) return reply.code(400).send({ error: 'Route points are invalid' })
    if (!await repository.replaceRoute(user, request.params.tripId, points)) {
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

  app.post('/api/trips/:tripId/invites', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    const email = normalizeEmail(request.body?.email)
    const role = request.body?.role === 'editor' ? 'editor' : 'viewer'
    if (!email || !email.includes('@')) return reply.code(400).send({ error: 'Enter a valid email address' })
    const invite = await repository.upsertInvite(user, request.params.tripId, {
      email, name: String(request.body?.name || '').trim() || null, role,
    })
    if (!invite) return reply.code(403).send({ error: 'You cannot manage this trip' })
    let mailed = true, mailError = null
    try { await issueMagicLink(email) }
    catch (error) { mailed = false; mailError = error.message }
    return reply.code(201).send({ ...invite, mailed, mailError })
  })

  app.delete('/api/trips/:tripId/invites/:inviteId', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    const removed = await repository.revokeInvite(user, request.params.tripId, request.params.inviteId)
    if (!removed) return reply.code(404).send({ error: 'Invitation not found' })
    return reply.code(204).send()
  })

  app.delete('/api/trips/:tripId/members/:userId', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    const result = await repository.removeMember(user, request.params.tripId, request.params.userId)
    if (result === 'owner') return reply.code(409).send({ error: 'A trip owner cannot be removed' })
    if (result !== 'removed') return reply.code(404).send({ error: 'Trip member not found' })
    return reply.code(204).send()
  })

  app.post('/api/trips/:tripId/photos/:photoId/comments', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    const body = String(request.body?.body || '').trim()
    if (!body) return reply.code(400).send({ error: 'A comment cannot be empty' })
    const comment = await repository.addComment(user, request.params.tripId, request.params.photoId, body)
    if (!comment) return reply.code(404).send({ error: 'Photo not found' })
    return reply.code(201).send(comment)
  })

  app.delete('/api/trips/:tripId/comments/:commentId', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    if (!await repository.deleteComment(user, request.params.tripId, request.params.commentId)) {
      return reply.code(404).send({ error: 'Comment not found' })
    }
    return reply.code(204).send()
  })

  app.put('/api/trips/:tripId/photos/:photoId/like', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    if (!await repository.setLike(user, request.params.tripId, request.params.photoId, true)) {
      return reply.code(404).send({ error: 'Photo not found' })
    }
    return reply.code(204).send()
  })

  app.delete('/api/trips/:tripId/photos/:photoId/like', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    if (!await repository.setLike(user, request.params.tripId, request.params.photoId, false)) {
      return reply.code(404).send({ error: 'Photo not found' })
    }
    return reply.code(204).send()
  })

  app.get('/api/attractions', async (request, reply) => {
    if (!repository.loadAttractions) return reply.code(404).send({ error: 'Attractions are not configured' })
    const bounds = {
      west: finite(request.query?.west), east: finite(request.query?.east),
      south: finite(request.query?.south), north: finite(request.query?.north),
    }
    if (Object.values(bounds).some(value => value == null)) return reply.code(400).send({ error: 'Map bounds are required' })
    const limit = Math.min(Math.max(Math.trunc(finite(request.query?.limit) || 1000), 1), 1000)
    const values = await repository.loadAttractions(bounds, {
      headlineOnly: request.query?.headlineOnly === 'true', limit,
    })
    return values.map(value => ({
      id: value.id, n: value.name, d: value.descr || '', k: value.category,
      f: value.imageFile, x: value.lng, y: value.lat, t: value.extract || '',
    }))
  })

  return app
}
