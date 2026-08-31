export function createMemoryRepository({ allowedEmails = [] } = {}) {
  const fakeUuid = (namespace, value) => `00000000-0000-4000-8000-${String(namespace * 100000 + value).padStart(12, '0')}`
  const allowed = new Set(allowedEmails.map(email => email.toLowerCase()))
  const oidcLogins = new Map()
  const oidcIdentities = new Map()
  const loginHandoffs = new Map()
  const sessions = new Map()
  const users = new Map()
  const trips = new Map()
  const devices = new Map()
  const positions = new Map()
  const mcpClients = new Map()
  const mcpCodes = new Map()
  const mcpTokens = new Map()
  const mcpUsedRefreshTokens = new Map()
  const fileDeletionQueue = new Map()
  let nextUser = 1
  let nextTrip = 1
  let nextPhoto = 1
  let nextDevice = 1
  let nextPosition = 1
  let nextStop = 1
  let nextComment = 1

  return {
    seedPhoto(tripId) {
      const trip = trips.get(tripId)
      const photo = {
        id: fakeUuid(3, nextPhoto++), stopId: null, lng: 0, lat: 0,
        caption: 'Seed photo', by: 'owner', when: null, locationSource: 'manual',
        storagePath: `${tripId}/seed.jpg`, thumbPath: null, seq: trip.photos.length,
        userId: trip.ownerId,
      }
      trip.photos.push(photo)
      return photo
    },
    async emailAllowed(email) {
      return allowed.has(email) || [...trips.values()].some(trip => trip.invites.some(invite => invite.email === email))
    },
    async findUserByEmail(email) { return users.get(email) || null },
    async createOidcLogin({ stateHash, ...login }) {
      oidcLogins.set(stateHash, login)
    },
    async consumeOidcLogin(stateHash, now) {
      const row = oidcLogins.get(stateHash)
      oidcLogins.delete(stateHash)
      return row && row.expiresAt > now ? row : null
    },
    async ensureUser(email) {
      if (!users.has(email)) users.set(email, { id: fakeUuid(1, nextUser++), email })
      return users.get(email)
    },
    async resolveOidcUser({ issuer, subject, email }) {
      const key = `${issuer}\u0000${subject}`
      const existingId = oidcIdentities.get(key)
      if (existingId) return [...users.values()].find(user => user.id === existingId) || null
      const user = await this.ensureUser(email)
      oidcIdentities.set(key, user.id)
      return user
    },
    async createLoginHandoff({ hash, userId, client, bindingHash, expiresAt }) {
      loginHandoffs.set(hash, { userId, client, bindingHash, expiresAt })
    },
    async consumeLoginHandoff({ hash, now, client, bindingHash }) {
      const row = loginHandoffs.get(hash)
      if (!row || row.expiresAt <= now || row.client !== client || row.bindingHash !== bindingHash) return null
      loginHandoffs.delete(hash)
      return [...users.values()].find(user => user.id === row.userId) || null
    },
    async createSession({ hash, userId, expiresAt }) {
      sessions.set(hash, { userId, expiresAt })
    },
    async findSession(hash, now) {
      const row = sessions.get(hash)
      if (!row || row.expiresAt <= now) return null
      return [...users.values()].find(user => user.id === row.userId) || null
    },
    async deleteSession(hash) { sessions.delete(hash) },
    async registerMcpClient(client) {
      mcpClients.set(client.id, { ...client })
      return { ...client }
    },
    async findMcpClient(id) {
      const client = mcpClients.get(id)
      return client ? { ...client } : null
    },
    async createMcpAuthorizationCode(code) {
      mcpCodes.set(code.hash, { ...code })
    },
    async redeemMcpAuthorizationCode(grant) {
      const code = mcpCodes.get(grant.codeHash)
      if (!code || code.expiresAt <= grant.now || code.clientId !== grant.clientId ||
        code.redirectUri !== grant.redirectUri || code.resource !== grant.resource ||
        code.codeChallenge !== grant.codeChallenge) return null
      mcpCodes.delete(grant.codeHash)
      const token = {
        accessHash: grant.accessHash, refreshHash: grant.refreshHash,
        userId: code.userId, clientId: code.clientId, scopes: code.scopes, resource: code.resource,
        accessExpiresAt: grant.accessExpiresAt, refreshExpiresAt: grant.refreshExpiresAt,
        grantId: grant.codeHash,
      }
      mcpTokens.set(token.accessHash, token)
      return { userId: code.userId, clientId: code.clientId, scopes: code.scopes, resource: code.resource }
    },
    async findMcpAccessToken(hash, now) {
      const token = mcpTokens.get(hash)
      if (!token || token.accessExpiresAt <= now) return null
      const user = [...users.values()].find(value => value.id === token.userId)
      return user ? { ...token, user } : null
    },
    async rotateMcpRefreshToken(grant) {
      const used = mcpUsedRefreshTokens.get(grant.refreshHash)
      if (used && used.expiresAt > grant.now && used.clientId === grant.clientId && used.resource === grant.resource) {
        for (const [accessHash, token] of mcpTokens) {
          if (token.grantId === used.grantId) mcpTokens.delete(accessHash)
        }
        return null
      }
      const entry = [...mcpTokens.entries()].find(([, value]) => value.refreshHash === grant.refreshHash)
      if (!entry) return null
      const [accessHash, token] = entry
      if (token.refreshExpiresAt <= grant.now || token.clientId !== grant.clientId ||
        token.resource !== grant.resource) return null
      mcpTokens.delete(accessHash)
      mcpUsedRefreshTokens.set(token.refreshHash, {
        grantId: token.grantId, clientId: token.clientId,
        resource: token.resource, expiresAt: token.refreshExpiresAt,
      })
      const replacement = {
        ...token, accessHash: grant.accessHash, refreshHash: grant.replacementRefreshHash,
        accessExpiresAt: grant.accessExpiresAt, refreshExpiresAt: grant.refreshExpiresAt,
      }
      mcpTokens.set(replacement.accessHash, replacement)
      return { userId: token.userId, clientId: token.clientId, scopes: token.scopes, resource: token.resource }
    },
    async revokeMcpToken(hash) {
      const matched = [...mcpTokens.values()].find(token => token.accessHash === hash || token.refreshHash === hash)
        || mcpUsedRefreshTokens.get(hash)
      for (const [accessHash, token] of mcpTokens) {
        if ((matched && token.grantId === matched.grantId) || accessHash === hash || token.refreshHash === hash) {
          mcpTokens.delete(accessHash)
        }
      }
    },
    async createTrip(user, input) {
      const id = fakeUuid(2, nextTrip++)
      const base = (input.title || 'trip').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      const trip = {
        id, slug: `${base || 'trip'}-${id.slice(-1)}`, ownerId: user.id,
        title: input.title, crew: input.crew || null, dates: input.dates || null,
        dayCount: input.dayCount || 1, startsOn: input.startsOn || null, endsOn: input.endsOn || null,
        members: [{ userId: user.id, email: user.email, role: 'owner', displayName: user.email.split('@')[0], avatarUrl: null }],
        stops: [], photos: [], route: [], comments: {}, likes: [], invites: [],
      }
      trips.set(id, trip)
      return { id, slug: trip.slug, ownerId: user.id, title: trip.title }
    },
    async listTrips(user) {
      return [...trips.values()].filter(trip => trip.members.some(member => member.userId === user.id))
        .map(trip => ({
          id: trip.id, slug: trip.slug, title: trip.title, crew: trip.crew, dates: trip.dates,
          dayCount: trip.dayCount, startsOn: trip.startsOn, endsOn: trip.endsOn,
          role: trip.members.find(member => member.userId === user.id).role,
        }))
    },
    async loadCurrentTrip(user, slug) {
      return [...trips.values()].find(trip =>
        (!slug || trip.slug === slug) && trip.members.some(member => member.userId === user.id)) || null
    },
    async updateTrip(user, tripId, changes) {
      if (!await this.canEditTrip(user.id, tripId)) return null
      const trip = trips.get(tripId)
      Object.assign(trip, changes)
      return trip
    },
    async updateProfile(user, tripId, changes) {
      const trip = trips.get(tripId)
      const member = trip?.members.find(value => value.userId === user.id)
      if (!member) return null
      const oldAvatarUrl = member.avatarUrl
      if (changes.name !== undefined) member.displayName = changes.name
      if (changes.avatarPath !== undefined) member.avatarUrl = changes.avatarPath
      return { ...member, oldAvatarUrl }
    },
    async canEditTrip(userId, tripId) {
      const trip = trips.get(tripId)
      return !!trip?.members.some(member => member.userId === userId && ['owner', 'editor'].includes(member.role))
    },
    async canManageTrip(userId, tripId) {
      return !!trips.get(tripId)?.members.some(member => member.userId === userId && member.role === 'owner')
    },
    async canReadTrip(userId, tripId) {
      return !!trips.get(tripId)?.members.some(member => member.userId === userId)
    },
    async createPhoto(user, tripId, input) {
      const trip = trips.get(tripId)
      const member = trip?.members.find(value => value.userId === user.id)
      if (!trip || !member || !['owner', 'editor'].includes(member.role)) return null
      const photo = {
        id: fakeUuid(3, nextPhoto++), stopId: input.stopId || null,
        lng: input.lng, lat: input.lat, caption: input.caption || null,
        by: member.displayName, when: input.takenAt || null,
        locationSource: input.locationSource || null,
        storagePath: input.storagePath, thumbPath: input.thumbPath, userId: user.id, clientKey: input.clientKey || null,
        seq: trip.photos.length,
      }
      trip.photos.push(photo)
      return photo
    },
    async findPhotoByClientKey(user, tripId, clientKey) {
      if (!clientKey || !await this.canEditTrip(user.id, tripId)) return null
      return trips.get(tripId)?.photos.find(value => value.userId === user.id && value.clientKey === clientKey) || null
    },
    async updatePhoto(user, tripId, photoId, changes) {
      if (!await this.canEditTrip(user.id, tripId)) return null
      const trip = trips.get(tripId)
      if (changes.stopId != null && !trip?.stops.some(value => value.id === changes.stopId)) return null
      const photo = trip?.photos.find(value => value.id === photoId)
      if (!photo) return null
      Object.assign(photo, changes)
      return photo
    },
    async deletePhoto(user, tripId, photoId) {
      if (!await this.canEditTrip(user.id, tripId)) return null
      const trip = trips.get(tripId)
      const photo = trip?.photos.find(value => value.id === photoId)
      if (!photo) return null
      trip.photos = trip.photos.filter(value => value.id !== photoId)
      delete trip.comments[photoId]
      trip.likes = trip.likes.filter(value => value !== photoId)
      for (const path of [photo.storagePath, photo.thumbPath].filter(Boolean)) fileDeletionQueue.set(path, new Date(0))
      return { storagePath: photo.storagePath, thumbPath: photo.thumbPath }
    },
    async listPendingFileDeletions(now, limit = 50) {
      return [...fileDeletionQueue].filter(([, next]) => next <= now).slice(0, limit).map(([path]) => path)
    },
    async completeFileDeletion(path) { fileDeletionQueue.delete(path) },
    async failFileDeletion(path, _error, now) { fileDeletionQueue.set(path, new Date(now.getTime() + 60_000)) },
    async createStop(user, tripId, input) {
      if (!await this.canEditTrip(user.id, tripId)) return null
      const stop = { id: fakeUuid(4, nextStop++), ...input }
      trips.get(tripId).stops.push(stop)
      return stop
    },
    async updateStop(user, tripId, stopId, changes) {
      if (!await this.canEditTrip(user.id, tripId)) return null
      const stop = trips.get(tripId)?.stops.find(value => value.id === stopId)
      if (!stop) return null
      Object.assign(stop, changes)
      return stop
    },
    async deleteStop(user, tripId, stopId) {
      if (!await this.canEditTrip(user.id, tripId)) return false
      const trip = trips.get(tripId)
      const before = trip.stops.length
      trip.photos.forEach(photo => { if (photo.stopId === stopId) photo.stopId = null })
      trip.stops = trip.stops.filter(value => value.id !== stopId)
      return trip.stops.length < before
    },
    async replaceRoute(user, tripId, points) {
      if (!await this.canEditTrip(user.id, tripId)) return false
      trips.get(tripId).route = points.map(point => [...point])
      return true
    },
    async upsertInvite(user, tripId, input) {
      if (!await this.canManageTrip(user.id, tripId)) return null
      const trip = trips.get(tripId)
      let invite = trip.invites.find(value => value.email === input.email)
      if (invite) {
        Object.assign(invite, input)
        const invitedUser = users.get(input.email)
        const member = invitedUser && trip.members.find(value => value.userId === invitedUser.id)
        if (member && member.role !== 'owner') member.role = input.role
      }
      else {
        invite = { id: fakeUuid(5, trip.invites.length + 1), ...input, claimedAt: null }
        trip.invites.push(invite)
      }
      return { ...invite, tripId: trip.id, tripSlug: trip.slug, tripTitle: trip.title }
    },
    async listPendingInvites(user) {
      return [...trips.values()].flatMap(trip => trip.invites
        .filter(invite => invite.email === user.email && !invite.claimedAt)
        .map(invite => ({
          id: invite.id, email: invite.email, name: invite.name, role: invite.role,
          tripId: trip.id, tripSlug: trip.slug, tripTitle: trip.title,
        })))
    },
    async acceptInvite(user, inviteId) {
      for (const trip of trips.values()) {
        const invite = trip.invites.find(value => value.id === inviteId && value.email === user.email && !value.claimedAt)
        if (!invite) continue
        if (!trip.members.some(member => member.userId === user.id)) {
          trip.members.push({
            userId: user.id, email: user.email, role: invite.role,
            displayName: invite.name || user.email.split('@')[0], avatarUrl: null,
          })
        }
        invite.claimedAt = new Date()
        return { tripId: trip.id, tripSlug: trip.slug, tripTitle: trip.title, role: invite.role }
      }
      return null
    },
    async listInvites(user, tripId) {
      if (!await this.canManageTrip(user.id, tripId)) return null
      return trips.get(tripId).invites
    },
    async revokeInvite(user, tripId, inviteId) {
      if (!await this.canManageTrip(user.id, tripId)) return false
      const trip = trips.get(tripId)
      const invite = trip.invites.find(value => value.id === inviteId)
      if (!invite) return false
      const invitedUser = users.get(invite.email)
      if (invitedUser) {
        trip.members = trip.members.filter(value => value.userId !== invitedUser.id || value.role === 'owner')
      }
      const before = trip.invites.length
      trip.invites = trip.invites.filter(value => value.id !== inviteId)
      return before !== trip.invites.length
    },
    async removeMember(user, tripId, memberUserId) {
      if (!await this.canManageTrip(user.id, tripId)) return null
      const trip = trips.get(tripId)
      const member = trip.members.find(value => value.userId === memberUserId)
      if (!member) return null
      if (member.role === 'owner') return 'owner'
      trip.members = trip.members.filter(value => value.userId !== memberUserId)
      trip.invites = trip.invites.filter(value => value.email !== member.email)
      const removedDevices = [...devices.values()]
        .filter(value => value.tripId === tripId && value.userId === memberUserId).map(value => value.id)
      removedDevices.forEach(id => devices.delete(id))
      for (const [key, fix] of positions) if (removedDevices.includes(fix.deviceId)) positions.delete(key)
      return 'removed'
    },
    async addComment(user, tripId, photoId, body) {
      if (!await this.canReadTrip(user.id, tripId)) return null
      const trip = trips.get(tripId)
      if (!trip.photos.some(photo => photo.id === photoId)) return null
      const member = trip.members.find(value => value.userId === user.id)
      const comment = {
        id: fakeUuid(6, nextComment++), by: member.displayName, text: body,
        userId: user.id, when: 'just now',
      }
      ;(trip.comments[photoId] ||= []).push(comment)
      return comment
    },
    async deleteComment(user, tripId, commentId) {
      const trip = trips.get(tripId)
      if (!trip) return false
      const canEdit = await this.canEditTrip(user.id, tripId)
      for (const photoId of Object.keys(trip.comments)) {
        const before = trip.comments[photoId].length
        trip.comments[photoId] = trip.comments[photoId].filter(value =>
          value.id !== commentId || (!canEdit && value.userId !== user.id))
        if (!trip.comments[photoId].length) delete trip.comments[photoId]
        if ((trip.comments[photoId]?.length || 0) !== before) return true
      }
      return false
    },
    async setLike(user, tripId, photoId, on) {
      if (!await this.canReadTrip(user.id, tripId)) return false
      const trip = trips.get(tripId)
      if (!trip.photos.some(photo => photo.id === photoId)) return false
      const index = trip.likes.indexOf(photoId)
      if (on && index < 0) trip.likes.push(photoId)
      if (!on && index >= 0) trip.likes.splice(index, 1)
      return true
    },
    async registerDevice(user, tripId, input) {
      if (!await this.canEditTrip(user.id, tripId)) return null
      const id = `device-${nextDevice++}`
      const device = {
        id, tripId, userId: user.id, name: input.name, slug: input.slug,
        timezone: input.timezone || null, tokenHash: input.tokenHash,
        lastSeen: null, createdAt: new Date(),
      }
      devices.set(id, device)
      return device
    },
    async listDevices(user, tripId) {
      if (!await this.canReadTrip(user.id, tripId)) return null
      return [...devices.values()].filter(device => device.tripId === tripId)
    },
    async removeDevice(user, tripId, deviceId) {
      if (!await this.canEditTrip(user.id, tripId)) return false
      const device = devices.get(deviceId)
      if (!device || device.tripId !== tripId) return false
      devices.delete(deviceId)
      for (const [key, fix] of positions) if (fix.deviceId === deviceId) positions.delete(key)
      return true
    },
    async findDeviceByTokenHash(hash) {
      return [...devices.values()].find(device => device.tokenHash === hash) || null
    },
    async insertPosition(device, fix) {
      const key = `${device.id}:${fix.at.toISOString()}`
      if (positions.has(key)) return false
      positions.set(key, { ...fix, id: nextPosition++, deviceId: device.id, tripId: device.tripId })
      device.lastSeen = fix.at
      return true
    },
    async findPositionNearCapture(user, tripId, capturedAt, toleranceMs) {
      const nearest = [...positions.values()]
        .filter(fix => fix.tripId === tripId && devices.get(fix.deviceId)?.userId === user.id)
        .map(fix => ({ ...fix, distance: Math.abs(fix.at.getTime() - capturedAt.getTime()) }))
        .filter(fix => fix.distance <= toleranceMs)
        .sort((a, b) => a.distance - b.distance)[0]
      return nearest ? { lng: nearest.lng, lat: nearest.lat, at: nearest.at } : null
    },
    async loadLive(user, tripId, since, { afterId = 0, maxPerDevice = 6000 } = {}) {
      if (!await this.canReadTrip(user.id, tripId)) return null
      const tripPositions = [...positions.values()].filter(fix => fix.tripId === tripId)
      const byDevice = new Map()
      for (const fix of tripPositions.filter(fix => fix.at >= since && fix.id > afterId)) {
        if (!byDevice.has(fix.deviceId)) byDevice.set(fix.deviceId, [])
        byDevice.get(fix.deviceId).push(fix)
      }
      return {
        devices: [...devices.values()].filter(device => device.tripId === tripId),
        fixes: [...byDevice.values()].flatMap(values => values.sort((a, b) => a.id - b.id).slice(-maxPerDevice))
          .sort((a, b) => a.id - b.id),
        cursor: Math.max(afterId, ...tripPositions.map(fix => fix.id), 0),
      }
    },
    async deleteAccount(user) {
      const paths = []
      for (const [tripId, trip] of [...trips]) {
        const owners = trip.members.filter(member => member.role === 'owner')
        const soleOwner = owners.length === 1 && owners[0].userId === user.id
        if (soleOwner) {
          for (const photo of trip.photos) paths.push(photo.storagePath, photo.thumbPath)
          for (const member of trip.members) paths.push(member.avatarUrl)
          trips.delete(tripId)
          continue
        }
        for (const photo of trip.photos.filter(value => value.userId === user.id)) paths.push(photo.storagePath, photo.thumbPath)
        trip.photos = trip.photos.filter(value => value.userId !== user.id)
        trip.members = trip.members.filter(value => value.userId !== user.id)
        trip.invites = trip.invites.filter(value => value.email !== user.email)
      }
      for (const [hash, session] of sessions) if (session.userId === user.id) sessions.delete(hash)
      for (const [id, device] of devices) if (device.userId === user.id) devices.delete(id)
      users.delete(user.email)
      const uniquePaths = [...new Set(paths.filter(Boolean))]
      for (const path of uniquePaths) fileDeletionQueue.set(path, new Date(0))
      return uniquePaths
    },
  }
}
