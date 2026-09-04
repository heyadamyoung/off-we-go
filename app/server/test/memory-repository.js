import { availableSlug, normalizeProfileHandle, slugBase } from '../src/slugs.js'
import { maskHomeZones } from '../src/home-zone.js'

const profileShape = profile => ({
  profileId: profile.id,
  email: profile.email,
  handle: profile.handle,
  displayName: profile.displayName,
  avatarUrl: profile.avatarUrl,
  homePlace: profile.homePlace ?? null,
  homeLat: profile.homeLat ?? null,
  homeLng: profile.homeLng ?? null,
  timeZone: profile.timeZone ?? null,
  preferences: profile.preferences || {},
  joinedAt: profile.joinedAt ?? null,
  tripCount: 0,
  photoCount: 0,
})

export function createMemoryRepository({ allowedEmails = [] } = {}) {
  const walkways = new Map()
  const segments = new Map()
  const segmentDocuments = new Map()
  const stopDocuments = new Map()
  const fakeUuid = (namespace, value) =>
    `00000000-0000-4000-8000-${String(namespace * 100000 + value).padStart(12, '0')}`
  const allowed = new Set(allowedEmails.map(email => email.toLowerCase()))
  const oidcLogins = new Map()
  const oidcIdentities = new Map()
  const loginHandoffs = new Map()
  const sessions = new Map()
  const users = new Map()
  const profiles = new Map()
  const profileHandleReservations = new Map()
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

  const mailboxes = new Map()
  const mailboxRequests = new Map()

  return {
    seedPhoto(tripId) {
      const trip = trips.get(tripId)
      const photo = {
        id: fakeUuid(3, nextPhoto++),
        stopId: null,
        lng: 0,
        lat: 0,
        caption: 'Seed photo',
        by: 'owner',
        when: null,
        locationSource: 'manual',
        storagePath: `${tripId}/seed.jpg`,
        thumbPath: null,
        seq: trip.photos.length,
        userId: trip.ownerId,
      }
      trip.photos.push(photo)
      return photo
    },
    async emailAllowed(email) {
      return (
        allowed.has(email) ||
        [...trips.values()].some(trip => trip.invites.some(invite => invite.email === email))
      )
    },
    async findUserByEmail(email) {
      return users.get(email) || null
    },
    async createOidcLogin({ stateHash, ...login }) {
      oidcLogins.set(stateHash, login)
    },
    async consumeOidcLogin(stateHash, now) {
      const row = oidcLogins.get(stateHash)
      oidcLogins.delete(stateHash)
      return row && row.expiresAt > now ? row : null
    },
    async ensureUser(email, chosenHandle = null) {
      if (!users.has(email)) {
        const user = { id: fakeUuid(1, nextUser++), email }
        const rawBase = slugBase(email.split('@')[0], 'traveller', 30)
        const base =
          normalizeProfileHandle(rawBase) || `${rawBase.slice(0, 25) || 'traveller'}-user`
        let handle = chosenHandle || base
        for (
          let suffix = 2;
          [...profiles.values()].some(profile => profile.handle === handle);
          suffix++
        )
          handle = `${base}-${suffix}`
        users.set(email, user)
        profiles.set(user.id, {
          id: user.id,
          handle,
          email,
          displayName: email.split('@')[0],
          avatarUrl: null,
          homePlace: null,
          homeLat: null,
          homeLng: null,
          timeZone: null,
          preferences: {},
          joinedAt: new Date().toISOString(),
        })
      }
      return users.get(email)
    },
    async reserveProfileHandle({ reservationHash, handle, expiresAt }) {
      const now = new Date()
      for (const [key, value] of profileHandleReservations) {
        if (value.expiresAt <= now) profileHandleReservations.delete(key)
      }
      if ([...profiles.values()].some(profile => profile.handle === handle)) return false
      if (
        [...profileHandleReservations].some(
          ([key, value]) => key !== reservationHash && value.handle === handle,
        )
      )
        return false
      profileHandleReservations.set(reservationHash, { handle, expiresAt })
      return true
    },
    async resolveOidcUser({ issuer, subject, email, handleReservationHash = null }) {
      const key = `${issuer}\u0000${subject}`
      const existingId = oidcIdentities.get(key)
      if (existingId) return [...users.values()].find(user => user.id === existingId) || null
      let user = users.get(email)
      if (!user) {
        const reservation =
          handleReservationHash && profileHandleReservations.get(handleReservationHash)
        if (reservation?.expiresAt > new Date())
          user = await this.ensureUser(email, reservation.handle)
        else if (allowed.has(email)) user = await this.ensureUser(email)
        else return null
      }
      oidcIdentities.set(key, user.id)
      if (handleReservationHash) profileHandleReservations.delete(handleReservationHash)
      return user
    },
    async createLoginHandoff({ hash, userId, client, bindingHash, expiresAt }) {
      loginHandoffs.set(hash, { userId, client, bindingHash, expiresAt })
    },
    async consumeLoginHandoff({ hash, now, client, bindingHash }) {
      const row = loginHandoffs.get(hash)
      if (!row || row.expiresAt <= now || row.client !== client || row.bindingHash !== bindingHash)
        return null
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
    async deleteSession(hash) {
      sessions.delete(hash)
    },
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
      if (
        !code ||
        code.expiresAt <= grant.now ||
        code.clientId !== grant.clientId ||
        code.redirectUri !== grant.redirectUri ||
        code.resource !== grant.resource ||
        code.codeChallenge !== grant.codeChallenge
      )
        return null
      mcpCodes.delete(grant.codeHash)
      const token = {
        accessHash: grant.accessHash,
        refreshHash: grant.refreshHash,
        userId: code.userId,
        clientId: code.clientId,
        scopes: code.scopes,
        resource: code.resource,
        accessExpiresAt: grant.accessExpiresAt,
        refreshExpiresAt: grant.refreshExpiresAt,
        grantId: grant.codeHash,
      }
      mcpTokens.set(token.accessHash, token)
      return {
        userId: code.userId,
        clientId: code.clientId,
        scopes: code.scopes,
        resource: code.resource,
      }
    },
    async findMcpAccessToken(hash, now) {
      const token = mcpTokens.get(hash)
      if (!token || token.accessExpiresAt <= now) return null
      const user = [...users.values()].find(value => value.id === token.userId)
      return user ? { ...token, user } : null
    },
    async rotateMcpRefreshToken(grant) {
      const used = mcpUsedRefreshTokens.get(grant.refreshHash)
      if (
        used &&
        used.expiresAt > grant.now &&
        used.clientId === grant.clientId &&
        used.resource === grant.resource
      ) {
        for (const [accessHash, token] of mcpTokens) {
          if (token.grantId === used.grantId) mcpTokens.delete(accessHash)
        }
        return null
      }
      const entry = [...mcpTokens.entries()].find(
        ([, value]) => value.refreshHash === grant.refreshHash,
      )
      if (!entry) return null
      const [accessHash, token] = entry
      if (
        token.refreshExpiresAt <= grant.now ||
        token.clientId !== grant.clientId ||
        token.resource !== grant.resource
      )
        return null
      mcpTokens.delete(accessHash)
      mcpUsedRefreshTokens.set(token.refreshHash, {
        grantId: token.grantId,
        clientId: token.clientId,
        resource: token.resource,
        expiresAt: token.refreshExpiresAt,
      })
      const replacement = {
        ...token,
        accessHash: grant.accessHash,
        refreshHash: grant.replacementRefreshHash,
        accessExpiresAt: grant.accessExpiresAt,
        refreshExpiresAt: grant.refreshExpiresAt,
      }
      mcpTokens.set(replacement.accessHash, replacement)
      return {
        userId: token.userId,
        clientId: token.clientId,
        scopes: token.scopes,
        resource: token.resource,
      }
    },
    async revokeMcpToken(hash) {
      const matched =
        [...mcpTokens.values()].find(
          token => token.accessHash === hash || token.refreshHash === hash,
        ) || mcpUsedRefreshTokens.get(hash)
      for (const [accessHash, token] of mcpTokens) {
        if (
          (matched && token.grantId === matched.grantId) ||
          accessHash === hash ||
          token.refreshHash === hash
        ) {
          mcpTokens.delete(accessHash)
        }
      }
    },
    async createTrip(user, input) {
      const id = fakeUuid(2, nextTrip++)
      const slug = await availableSlug(input.title, candidate =>
        [...trips.values()].some(trip => trip.slug === candidate),
      )
      const trip = {
        id,
        slug,
        ownerId: user.id,
        title: input.title,
        crew: input.crew || null,
        dates: input.dates || null,
        dayCount: input.dayCount || 1,
        startsOn: input.startsOn || null,
        endsOn: input.endsOn || null,
        members: [{ profileId: user.id, role: 'owner' }],
        stops: [],
        photos: [],
        route: [],
        comments: {},
        likes: [],
        invites: [],
      }
      trips.set(id, trip)
      return { id, slug: trip.slug, ownerId: user.id, title: trip.title }
    },
    async listTrips(user) {
      return [...trips.values()]
        .filter(trip => trip.members.some(member => member.profileId === user.id))
        .map(trip => ({
          id: trip.id,
          slug: trip.slug,
          title: trip.title,
          crew: trip.crew,
          dates: trip.dates,
          dayCount: trip.dayCount,
          startsOn: trip.startsOn,
          endsOn: trip.endsOn,
          role: trip.members.find(member => member.profileId === user.id).role,
          places: trip.stops.slice(0, 60).map(stop => ({
            name: stop.name,
            lng: stop.lng,
            lat: stop.lat,
            status: stop.status,
          })),
          stopCount: trip.stops.length,
          photoCount: trip.photos.length,
          memberCount: trip.members.length,
        }))
    },
    async loadCurrentTrip(user, slug) {
      const trip = [...trips.values()].find(
        value =>
          (!slug || value.slug === slug) &&
          value.members.some(member => member.profileId === user.id),
      )
      if (!trip) return null
      return {
        ...trip,
        stops: (trip.stops || []).map(stop => ({
          ...stop,
          documents: [...stopDocuments.values()].filter(d => d.stopId === stop.id),
        })),
        members: trip.members.map(member => {
          const profile = profiles.get(member.profileId)
          return {
            ...member,
            email: profile.email,
            handle: profile.handle,
            displayName: profile.displayName,
            avatarUrl: profile.avatarUrl,
          }
        }),
      }
    },
    async updateTrip(user, tripId, changes) {
      if (!(await this.canEditTrip(user.id, tripId))) return null
      const trip = trips.get(tripId)
      Object.assign(trip, changes)
      return trip
    },
    async loadProfileByHandle(user, handle) {
      const profile = [...profiles.values()].find(value => value.handle === handle)
      if (!profile) return null
      const sharesTrip =
        profile.id === user.id ||
        [...trips.values()].some(
          trip =>
            trip.members.some(member => member.profileId === user.id) &&
            trip.members.some(member => member.profileId === profile.id),
        )
      return sharesTrip
        ? {
            profileId: profile.id,
            handle: profile.handle,
            displayName: profile.displayName,
            avatarUrl: profile.avatarUrl,
          }
        : null
    },
    async loadProfile(user) {
      const profile = profiles.get(user.id)
      return profile ? profileShape(profile) : null
    },
    async exportAccount(user) {
      const mine = [...trips.values()].filter(trip =>
        trip.members.some(member => member.profileId === user.id),
      )
      return {
        profile: profiles.get(user.id) ? profileShape(profiles.get(user.id)) : null,
        trips: mine.map(trip => ({
          id: trip.id,
          slug: trip.slug,
          title: trip.title,
          crew: trip.crew,
          dates: trip.dates,
          role: trip.members.find(member => member.profileId === user.id).role,
          stops: trip.stops.map(stop => ({ ...stop })),
          photos: trip.photos.map(photo => ({
            id: photo.id,
            stopId: photo.stopId,
            caption: photo.caption,
            by: photo.by,
            takenAt: photo.when,
            lng: photo.lng,
            lat: photo.lat,
            path: photo.storagePath || null,
          })),
          route: trip.route.map(point => [...point]),
          comments: Object.entries(trip.comments || {}).flatMap(([photoId, list]) =>
            list.map(comment => ({ id: comment.id, photoId, by: comment.by, body: comment.text })),
          ),
          trail: [],
        })),
      }
    },
    async updateProfile(user, changes) {
      const profile = profiles.get(user.id)
      if (!profile) return null
      if (changes.handle !== undefined) {
        const reserved = [...profileHandleReservations.values()].some(
          value => value.expiresAt > new Date() && value.handle === changes.handle,
        )
        if (
          reserved ||
          [...profiles.values()].some(
            value => value.id !== user.id && value.handle === changes.handle,
          )
        ) {
          return { conflict: 'handle' }
        }
      }
      const oldAvatarUrl = profile.avatarUrl
      if (changes.name !== undefined) profile.displayName = changes.name
      if (changes.handle !== undefined) profile.handle = changes.handle
      if (changes.avatarPath !== undefined) profile.avatarUrl = changes.avatarPath
      if (changes.homePlace !== undefined) profile.homePlace = changes.homePlace
      if (changes.homeLat !== undefined) profile.homeLat = changes.homeLat
      if (changes.homeLng !== undefined) profile.homeLng = changes.homeLng
      if (changes.timeZone !== undefined) profile.timeZone = changes.timeZone
      if (changes.preferences !== undefined) {
        profile.preferences = { ...profile.preferences, ...changes.preferences }
      }
      return { ...profileShape(profile), oldAvatarUrl }
    },
    async canEditTrip(userId, tripId) {
      const trip = trips.get(tripId)
      return !!trip?.members.some(
        member => member.profileId === userId && ['owner', 'editor'].includes(member.role),
      )
    },
    async canManageTrip(userId, tripId) {
      return !!trips
        .get(tripId)
        ?.members.some(member => member.profileId === userId && member.role === 'owner')
    },
    async canReadTrip(userId, tripId) {
      return !!trips.get(tripId)?.members.some(member => member.profileId === userId)
    },
    async listStopCoordinates() {
      const points = new Map()
      for (const trip of trips.values()) {
        for (const stop of trip.stops) {
          if (stop.lng == null || stop.lat == null) continue
          const lng = Math.round(stop.lng * 100) / 100
          const lat = Math.round(stop.lat * 100) / 100
          points.set(`${lng},${lat}`, [lng, lat])
        }
      }
      return [...points.values()]
    },
    async listStops(user, tripId) {
      if (!(await this.canReadTrip(user.id, tripId))) return null
      return trips
        .get(tripId)
        .stops.map(stop => ({ ...stop }))
        .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
    },
    async createPhoto(user, tripId, input) {
      const trip = trips.get(tripId)
      const member = trip?.members.find(value => value.profileId === user.id)
      if (!trip || !member || !['owner', 'editor'].includes(member.role)) return null
      const photo = {
        id: fakeUuid(3, nextPhoto++),
        stopId: input.stopId || null,
        lng: input.lng,
        lat: input.lat,
        caption: input.caption || null,
        by: profiles.get(member.profileId).displayName,
        when: input.takenAt || null,
        locationSource: input.locationSource || null,
        storagePath: input.storagePath,
        thumbPath: input.thumbPath,
        userId: user.id,
        clientKey: input.clientKey || null,
        seq: Math.max(trip.photos.length, ...trip.photos.map(value => (value.seq ?? -1) + 1)),
      }
      trip.photos.push(photo)
      return photo
    },
    async findPhotoByClientKey(user, tripId, clientKey) {
      if (!clientKey || !(await this.canEditTrip(user.id, tripId))) return null
      return (
        trips
          .get(tripId)
          ?.photos.find(value => value.userId === user.id && value.clientKey === clientKey) || null
      )
    },
    async updatePhoto(user, tripId, photoId, changes) {
      if (!(await this.canEditTrip(user.id, tripId))) return null
      const trip = trips.get(tripId)
      if (changes.stopId != null && !trip?.stops.some(value => value.id === changes.stopId))
        return null
      const photo = trip?.photos.find(value => value.id === photoId)
      if (!photo) return null
      Object.assign(photo, changes)
      return photo
    },
    async deletePhoto(user, tripId, photoId) {
      if (!(await this.canEditTrip(user.id, tripId))) return null
      const trip = trips.get(tripId)
      const photo = trip?.photos.find(value => value.id === photoId)
      if (!photo) return null
      trip.photos = trip.photos.filter(value => value.id !== photoId)
      delete trip.comments[photoId]
      trip.likes = trip.likes.filter(value => value !== photoId)
      for (const path of [photo.storagePath, photo.thumbPath].filter(Boolean))
        fileDeletionQueue.set(path, new Date(0))
      return { storagePath: photo.storagePath, thumbPath: photo.thumbPath }
    },
    async listPendingFileDeletions(now, limit = 50) {
      return [...fileDeletionQueue]
        .filter(([, next]) => next <= now)
        .slice(0, limit)
        .map(([path]) => path)
    },
    async completeFileDeletion(path) {
      fileDeletionQueue.delete(path)
    },
    async failFileDeletion(path, _error, now) {
      fileDeletionQueue.set(path, new Date(now.getTime() + 60_000))
    },
    async createStop(user, tripId, input) {
      if (!(await this.canEditTrip(user.id, tripId))) return null
      const stop = { id: fakeUuid(4, nextStop++), ...input }
      trips.get(tripId).stops.push(stop)
      return stop
    },
    async updateStop(user, tripId, stopId, changes) {
      if (!(await this.canEditTrip(user.id, tripId))) return null
      const stop = trips.get(tripId)?.stops.find(value => value.id === stopId)
      if (!stop) return null
      Object.assign(stop, changes)
      return stop
    },
    async deleteStop(user, tripId, stopId) {
      if (!(await this.canEditTrip(user.id, tripId))) return false
      const trip = trips.get(tripId)
      const before = trip.stops.length
      trip.photos.forEach(photo => {
        if (photo.stopId === stopId) photo.stopId = null
      })
      trip.stops = trip.stops.filter(value => value.id !== stopId)
      return trip.stops.length < before
    },
    async replaceRoute(user, tripId, points) {
      if (!(await this.canEditTrip(user.id, tripId))) return false
      trips.get(tripId).route = points.map(point => [...point])
      return true
    },
    async upsertInvite(user, tripId, input) {
      if (!(await this.canManageTrip(user.id, tripId))) return null
      const trip = trips.get(tripId)
      let invite = trip.invites.find(value => value.email === input.email)
      if (invite) {
        Object.assign(invite, input)
        const invitedUser = users.get(input.email)
        const member = invitedUser && trip.members.find(value => value.profileId === invitedUser.id)
        if (member && member.role !== 'owner') member.role = input.role
      } else {
        invite = { id: fakeUuid(5, trip.invites.length + 1), ...input, claimedAt: null }
        trip.invites.push(invite)
      }
      return { ...invite, tripId: trip.id, tripSlug: trip.slug, tripTitle: trip.title }
    },
    async listPendingInvites(user) {
      return [...trips.values()].flatMap(trip =>
        trip.invites
          .filter(invite => invite.email === user.email && !invite.claimedAt)
          .map(invite => ({
            id: invite.id,
            email: invite.email,
            name: invite.name,
            role: invite.role,
            tripId: trip.id,
            tripSlug: trip.slug,
            tripTitle: trip.title,
          })),
      )
    },
    async acceptInvite(user, inviteId) {
      for (const trip of trips.values()) {
        const invite = trip.invites.find(
          value => value.id === inviteId && value.email === user.email && !value.claimedAt,
        )
        if (!invite) continue
        if (!trip.members.some(member => member.profileId === user.id)) {
          trip.members.push({ profileId: user.id, role: invite.role })
        }
        invite.claimedAt = new Date()
        return { tripId: trip.id, tripSlug: trip.slug, tripTitle: trip.title, role: invite.role }
      }
      return null
    },
    async listInvites(user, tripId) {
      if (!(await this.canManageTrip(user.id, tripId))) return null
      return trips.get(tripId).invites
    },
    async revokeInvite(user, tripId, inviteId) {
      if (!(await this.canManageTrip(user.id, tripId))) return false
      const trip = trips.get(tripId)
      const invite = trip.invites.find(value => value.id === inviteId)
      if (!invite) return false
      const invitedUser = users.get(invite.email)
      if (invitedUser) {
        trip.members = trip.members.filter(
          value => value.profileId !== invitedUser.id || value.role === 'owner',
        )
      }
      const before = trip.invites.length
      trip.invites = trip.invites.filter(value => value.id !== inviteId)
      return before !== trip.invites.length
    },
    async removeMember(user, tripId, profileId) {
      if (!(await this.canManageTrip(user.id, tripId))) return null
      const trip = trips.get(tripId)
      const member = trip.members.find(value => value.profileId === profileId)
      if (!member) return null
      if (member.role === 'owner') return 'owner'
      trip.members = trip.members.filter(value => value.profileId !== profileId)
      trip.invites = trip.invites.filter(value => value.email !== profiles.get(profileId)?.email)
      const removedDevices = [...devices.values()]
        .filter(value => value.tripId === tripId && value.userId === profileId)
        .map(value => value.id)
      removedDevices.forEach(id => {
        devices.delete(id)
      })
      for (const [key, fix] of positions)
        if (removedDevices.includes(fix.deviceId)) positions.delete(key)
      return 'removed'
    },
    async listMessages(user, tripId, { limit = 100, before = null } = {}) {
      if (!(await this.canReadTrip(user.id, tripId))) return null
      const trip = trips.get(tripId)
      trip.messages ||= []
      let list = trip.messages
      if (before) {
        const index = list.findIndex(message => message.id === before)
        if (index >= 0) list = list.slice(0, index)
      }
      return list.slice(-Math.min(Math.max(limit, 1), 200)).map(message => ({
        id: message.id,
        userId: message.userId,
        by: profiles.get(message.userId)?.displayName,
        handle: profiles.get(message.userId)?.handle,
        body: message.body,
        at: message.at,
        reactions: [...message.reactions.entries()].map(([emoji, userIds]) => ({
          emoji,
          count: userIds.size,
          mine: userIds.has(user.id),
        })),
      }))
    },
    async createMessage(user, tripId, body) {
      if (!(await this.canReadTrip(user.id, tripId))) return null
      const trip = trips.get(tripId)
      trip.messages ||= []
      const message = {
        id: fakeUuid(6, ++nextComment),
        userId: user.id,
        body,
        at: new Date().toISOString(),
        reactions: new Map(),
      }
      trip.messages.push(message)
      return {
        id: message.id,
        userId: user.id,
        by: profiles.get(user.id)?.displayName,
        handle: profiles.get(user.id)?.handle,
        body,
        at: message.at,
        reactions: [],
      }
    },
    async deleteMessage(user, tripId, messageId) {
      const trip = trips.get(tripId)
      if (!trip?.messages) return false
      const message = trip.messages.find(value => value.id === messageId)
      const owner = trip.members.some(
        member => member.profileId === user.id && member.role === 'owner',
      )
      if (!message || (message.userId !== user.id && !owner)) return false
      trip.messages = trip.messages.filter(value => value.id !== messageId)
      return true
    },
    async setMessageReaction(user, tripId, messageId, emoji, on) {
      if (!(await this.canReadTrip(user.id, tripId))) return false
      const message = trips.get(tripId)?.messages?.find(value => value.id === messageId)
      if (!message) return false
      const users = message.reactions.get(emoji) || new Set()
      if (on) users.add(user.id)
      else users.delete(user.id)
      if (users.size) message.reactions.set(emoji, users)
      else message.reactions.delete(emoji)
      return true
    },
    async addComment(user, tripId, photoId, body) {
      if (!(await this.canReadTrip(user.id, tripId))) return null
      const trip = trips.get(tripId)
      if (!trip.photos.some(photo => photo.id === photoId)) return null
      const member = trip.members.find(value => value.profileId === user.id)
      const comment = {
        id: fakeUuid(6, nextComment++),
        by: profiles.get(member.profileId).displayName,
        text: body,
        userId: user.id,
        when: 'just now',
      }
      trip.comments[photoId] ||= []
      trip.comments[photoId].push(comment)
      return comment
    },
    async deleteComment(user, tripId, commentId) {
      const trip = trips.get(tripId)
      if (!trip) return false
      const canEdit = await this.canEditTrip(user.id, tripId)
      for (const photoId of Object.keys(trip.comments)) {
        const before = trip.comments[photoId].length
        trip.comments[photoId] = trip.comments[photoId].filter(
          value => value.id !== commentId || (!canEdit && value.userId !== user.id),
        )
        if (!trip.comments[photoId].length) delete trip.comments[photoId]
        if ((trip.comments[photoId]?.length || 0) !== before) return true
      }
      return false
    },
    async setLike(user, tripId, photoId, on) {
      if (!(await this.canReadTrip(user.id, tripId))) return false
      const trip = trips.get(tripId)
      if (!trip.photos.some(photo => photo.id === photoId)) return false
      const index = trip.likes.indexOf(photoId)
      if (on && index < 0) trip.likes.push(photoId)
      if (!on && index >= 0) trip.likes.splice(index, 1)
      return true
    },
    async registerDevice(user, tripId, input) {
      if (!(await this.canEditTrip(user.id, tripId))) return null
      const id = `device-${nextDevice++}`
      const device = {
        id,
        tripId,
        userId: user.id,
        name: input.name,
        slug: input.slug,
        timezone: input.timezone || null,
        tokenHash: input.tokenHash,
        lastSeen: null,
        pausedAt: null,
        createdAt: new Date(),
      }
      devices.set(id, device)
      return device
    },
    async markDevicePaused(device, at) {
      const found = devices.get(device.id)
      if (found) found.pausedAt = at
      return true
    },
    async resetDeviceToken(user, tripId, deviceId, tokenHash) {
      if (!(await this.canEditTrip(user.id, tripId))) return null
      const device = devices.get(deviceId)
      if (!device || device.tripId !== tripId) return null
      device.tokenHash = tokenHash
      return device
    },
    async prunePositions(now = new Date()) {
      const cutoff = now.getTime() - 30 * 24 * 60 * 60 * 1000
      let removed = 0
      for (const [key, fix] of positions) {
        if (fix.at.getTime() < cutoff) {
          positions.delete(key)
          removed++
        }
      }
      return removed
    },
    async listDevices(user, tripId) {
      if (!(await this.canReadTrip(user.id, tripId))) return null
      return [...devices.values()].filter(device => device.tripId === tripId)
    },
    async removeDevice(user, tripId, deviceId) {
      if (!(await this.canEditTrip(user.id, tripId))) return false
      const device = devices.get(deviceId)
      if (!device || device.tripId !== tripId) return false
      devices.delete(deviceId)
      for (const [key, fix] of positions) if (fix.deviceId === deviceId) positions.delete(key)
      return true
    },
    async findDeviceByTokenHash(hash) {
      return [...devices.values()].find(device => device.tokenHash === hash) || null
    },
    /* ---- connected mailboxes ---- */
    async startMailboxConnection({ userId, provider, stateHash, verifier, redirectTo, expiresAt }) {
      mailboxRequests.set(stateHash, { userId, provider, verifier, redirectTo, expiresAt })
    },
    async takeMailboxConnectionRequest(stateHash) {
      const pending = mailboxRequests.get(stateHash)
      if (!pending) return null
      mailboxRequests.delete(stateHash)
      return pending.expiresAt > new Date() ? pending : null
    },
    async saveMailboxConnection(connection) {
      const key = `${connection.userId}:${connection.provider}:${connection.accountId}`
      const existing = mailboxes.get(key)
      const saved = {
        id: existing?.id || `mailbox-${mailboxes.size + 1}`,
        connectedAt: new Date(),
        lastUsedAt: existing?.lastUsedAt || null,
        needsReconnect: false,
        ...connection,
        refreshToken: connection.refreshToken || existing?.refreshToken || null,
      }
      mailboxes.set(key, saved)
      return saved
    },
    async listMailboxConnections(userId) {
      return [...mailboxes.values()].filter(row => row.userId === userId)
    },
    async findMailboxConnection(userId, id) {
      return [...mailboxes.values()].find(row => row.userId === userId && row.id === id) || null
    },
    async updateMailboxTokens(id, fields) {
      for (const [key, row] of mailboxes) {
        if (row.id !== id) continue
        const saved = {
          ...row,
          ...fields,
          refreshToken: fields.refreshToken || row.refreshToken,
          lastUsedAt: new Date(),
          needsReconnect: false,
        }
        mailboxes.set(key, saved)
        return saved
      }
      return null
    },
    async markMailboxNeedsReconnect(id) {
      for (const [key, row] of mailboxes) {
        if (row.id === id) mailboxes.set(key, { ...row, needsReconnect: true })
      }
    },
    async deleteMailboxConnection(userId, id) {
      for (const [key, row] of mailboxes) {
        if (row.userId === userId && row.id === id) {
          mailboxes.delete(key)
          return true
        }
      }
      return false
    },

    async insertPosition(device, fix) {
      const key = `${device.id}:${fix.at.toISOString()}`
      if (positions.has(key)) return false
      positions.set(key, { ...fix, id: nextPosition++, deviceId: device.id, tripId: device.tripId })
      const registered = devices.get(device.id) || device
      if (!registered.lastSeen || registered.lastSeen < fix.at) registered.lastSeen = fix.at
      if (registered.pausedAt && registered.pausedAt <= fix.at) registered.pausedAt = null
      return true
    },
    async findPositionNearCapture(user, tripId, capturedAt, toleranceMs) {
      const nearest = [...positions.values()]
        .filter(
          fix =>
            fix.tripId === tripId &&
            devices.get(fix.deviceId)?.userId === user.id &&
            (fix.accuracy == null || fix.accuracy <= 80),
        )
        .map(fix => ({ ...fix, distance: Math.abs(fix.at.getTime() - capturedAt.getTime()) }))
        .filter(fix => fix.distance <= toleranceMs)
        .sort((a, b) => a.distance - b.distance)[0]
      return nearest ? { lng: nearest.lng, lat: nearest.lat, at: nearest.at } : null
    },
    async loadLive(user, tripId, since, { afterId = 0, maxPerDevice = 100000 } = {}) {
      if (!(await this.canReadTrip(user.id, tripId))) return null
      const tripPositions = [...positions.values()].filter(fix => fix.tripId === tripId)
      const sampled = new Map()
      for (const fix of tripPositions.filter(fix => fix.at >= since && fix.id > afterId)) {
        const key = `${fix.deviceId}:${Math.floor(fix.at.getTime() / 30_000)}`
        const current = sampled.get(key)
        const accuracy = Number.isFinite(fix.accuracy) ? fix.accuracy : Number.POSITIVE_INFINITY
        const currentAccuracy = Number.isFinite(current?.accuracy)
          ? current.accuracy
          : Number.POSITIVE_INFINITY
        if (
          !current ||
          accuracy < currentAccuracy ||
          (accuracy === currentAccuracy && fix.id > current.id)
        ) {
          sampled.set(key, fix)
        }
      }
      const byDevice = new Map()
      for (const fix of sampled.values()) {
        if (!byDevice.has(fix.deviceId)) byDevice.set(fix.deviceId, [])
        byDevice.get(fix.deviceId).push(fix)
      }
      const homes = new Map()
      for (const device of devices.values()) {
        if (device.tripId !== tripId) continue
        const profile = profiles.get(device.userId)
        homes.set(
          device.id,
          profile && profile.homeLat != null && profile.homeLng != null
            ? { lat: profile.homeLat, lng: profile.homeLng }
            : null,
        )
      }
      return {
        devices: [...devices.values()].filter(device => device.tripId === tripId),
        fixes: maskHomeZones(
          [...byDevice.values()]
            .flatMap(values => values.sort((a, b) => a.id - b.id).slice(-maxPerDevice))
            .sort((a, b) => a.id - b.id),
          homes,
        ),
        cursor: Math.max(afterId, ...tripPositions.map(fix => fix.id), 0),
      }
    },
    async deleteAccount(user) {
      const paths = []
      for (const [tripId, trip] of [...trips]) {
        const owners = trip.members.filter(member => member.role === 'owner')
        const soleOwner = owners.length === 1 && owners[0].profileId === user.id
        if (soleOwner) {
          for (const photo of trip.photos) paths.push(photo.storagePath, photo.thumbPath)
          trips.delete(tripId)
          continue
        }
        for (const photo of trip.photos.filter(value => value.userId === user.id))
          paths.push(photo.storagePath, photo.thumbPath)
        trip.photos = trip.photos.filter(value => value.userId !== user.id)
        trip.members = trip.members.filter(value => value.profileId !== user.id)
        trip.invites = trip.invites.filter(value => value.email !== user.email)
      }
      for (const [hash, session] of sessions) if (session.userId === user.id) sessions.delete(hash)
      for (const [id, device] of devices) if (device.userId === user.id) devices.delete(id)
      paths.push(profiles.get(user.id)?.avatarUrl)
      profiles.delete(user.id)
      users.delete(user.email)
      const uniquePaths = [...new Set(paths.filter(Boolean))]
      for (const path of uniquePaths) fileDeletionQueue.set(path, new Date(0))
      return uniquePaths
    },

    /* ---- hand-laid airport walkways: the postgres contract, in a Map ---- */
    async addAirportWalkway({ userId, level, name, points }) {
      const id = 'walkway-' + (walkways.size + 1)
      const row = {
        id,
        lng: points[0][0],
        lat: points[0][1],
        level: level || '0',
        name: name || null,
        points,
        createdBy: userId || null,
        createdAt: new Date(),
      }
      walkways.set(id, row)
      return row
    },
    async listAirportWalkways(lng, lat) {
      return [...walkways.values()].filter(
        row => Math.abs(row.lng - lng) < 0.03 && Math.abs(row.lat - lat) < 0.03,
      )
    },
    async deleteAirportWalkway(id) {
      return walkways.delete(id)
    },

    /* ---- travel segments: the postgres contract, in Maps ---------------- */
    async listSegments(user, tripId) {
      if (!(await this.canReadTrip(user.id, tripId))) return null
      return [...segments.values()]
        .filter(s => s.tripId === tripId)
        .sort((a, b) => new Date(a.departsAt) - new Date(b.departsAt))
        .map(s => ({
          ...s,
          documents: [...segmentDocuments.values()].filter(d => d.segmentId === s.id),
        }))
    },
    async createSegment(user, tripId, input) {
      if (!(await this.canEditTrip(user.id, tripId))) return null
      /* Same identity rule as Postgres: a re-asked leg updates, never doubles. */
      const twin = [...segments.values()].find(
        s =>
          s.tripId === tripId &&
          s.mode === input.mode &&
          (s.carrier ?? '') === (input.carrier ?? '') &&
          (s.number ?? '') === (input.number ?? '') &&
          new Date(s.departsAt).getTime() === new Date(input.departsAt).getTime(),
      )
      if (twin) return this.updateSegment(user, tripId, twin.id, input)
      const id = 'segment-' + (segments.size + 1)
      const row = {
        id,
        tripId,
        gateWas: null,
        status: 'scheduled',
        statusNote: null,
        passengers: [],
        ...input,
      }
      segments.set(id, row)
      return { ...row, documents: [] }
    },
    async updateSegment(user, tripId, segmentId, changes) {
      if (!(await this.canEditTrip(user.id, tripId))) return null
      const row = segments.get(segmentId)
      if (!row || row.tripId !== tripId) return null
      if (changes.gate !== undefined && changes.gate !== row.gate) row.gateWas = row.gate
      Object.assign(row, changes)
      return { ...row }
    },
    async deleteSegment(user, tripId, segmentId) {
      if (!(await this.canEditTrip(user.id, tripId))) return null
      const row = segments.get(segmentId)
      if (!row || row.tripId !== tripId) return null
      const paths = [...segmentDocuments.values()]
        .filter(d => d.segmentId === segmentId)
        .map(d => d.storagePath)
      for (const [key, d] of segmentDocuments)
        if (d.segmentId === segmentId) segmentDocuments.delete(key)
      segments.delete(segmentId)
      return { deleted: true, paths }
    },
    async addStopDocument(user, tripId, stopId, doc) {
      if (!(await this.canEditTrip(user.id, tripId))) return null
      const trip = trips.get(tripId)
      const stop = (trip?.stops || []).find(value => value.id === stopId)
      if (!stop) return null
      const id = 'stop-document-' + (stopDocuments.size + 1)
      const row = { id, stopId, ...doc }
      stopDocuments.set(id, row)
      return { ...row }
    },
    async updateStopDocument(user, tripId, documentId, changes) {
      if (!(await this.canEditTrip(user.id, tripId))) return null
      const row = stopDocuments.get(documentId)
      const trip = trips.get(tripId)
      if (!row || !(trip?.stops || []).some(value => value.id === row.stopId)) return null
      if (changes.name != null) row.name = changes.name
      if (changes.note !== undefined) row.note = changes.note || null
      if (changes.kind != null) row.kind = changes.kind
      if (changes.personId !== undefined) row.personId = changes.personId || null
      return { ...row }
    },
    async deleteStopDocument(user, tripId, documentId) {
      if (!(await this.canEditTrip(user.id, tripId))) return null
      const row = stopDocuments.get(documentId)
      if (!row) return null
      const trip = trips.get(tripId)
      if (!(trip?.stops || []).some(value => value.id === row.stopId)) return null
      stopDocuments.delete(documentId)
      return { storagePath: row.storagePath }
    },
    async addSegmentDocument(user, tripId, segmentId, doc) {
      if (!(await this.canEditTrip(user.id, tripId))) return null
      const segment = segments.get(segmentId)
      if (!segment || segment.tripId !== tripId) return null
      const id = 'document-' + (segmentDocuments.size + 1)
      const row = { id, segmentId, ...doc }
      segmentDocuments.set(id, row)
      return { ...row }
    },
    async updateSegmentDocument(user, tripId, documentId, changes) {
      if (!(await this.canEditTrip(user.id, tripId))) return null
      const row = segmentDocuments.get(documentId)
      const segment = row && segments.get(row.segmentId)
      if (!segment || segment.tripId !== tripId) return null
      if (changes.name != null) row.name = changes.name
      if (changes.note !== undefined) row.note = changes.note || null
      if (changes.kind != null) row.kind = changes.kind
      if (changes.personId !== undefined) row.personId = changes.personId || null
      return { ...row }
    },
    async findSegmentDocument(user, tripId, documentId) {
      if (!(await this.canReadTrip(user.id, tripId))) return null
      const row = segmentDocuments.get(documentId)
      if (!row) return null
      const segment = segments.get(row.segmentId)
      return segment && segment.tripId === tripId ? { ...row } : null
    },
    async deleteSegmentDocument(user, tripId, documentId) {
      if (!(await this.canEditTrip(user.id, tripId))) return null
      const row = segmentDocuments.get(documentId)
      if (!row) return null
      const segment = segments.get(row.segmentId)
      if (!segment || segment.tripId !== tripId) return null
      segmentDocuments.delete(documentId)
      return { storagePath: row.storagePath }
    },

    async listAdoptableDevices(user, tripId) {
      if (!(await this.canEditTrip(user.id, tripId))) return null
      const out = []
      for (const device of devices.values()) {
        if (device.tripId === tripId) continue
        if (!(await this.canEditTrip(user.id, device.tripId))) continue
        out.push({
          id: device.id,
          name: device.name,
          tripId: device.tripId,
          tripTitle: trips.get(device.tripId)?.title || '',
          lastSeen: device.lastSeen || null,
        })
      }
      return out
    },
    async adoptDevice(user, tripId, deviceId) {
      if (!(await this.canEditTrip(user.id, tripId))) return null
      const device = devices.get(deviceId)
      if (!device) return null
      if (!(await this.canEditTrip(user.id, device.tripId))) return null
      device.tripId = tripId
      let movedPositions = 0
      for (const fix of positions.values()) {
        if (fix.deviceId === deviceId) {
          fix.tripId = tripId
          movedPositions++
        }
      }
      return { id: device.id, name: device.name, movedPositions }
    },
  }
}
