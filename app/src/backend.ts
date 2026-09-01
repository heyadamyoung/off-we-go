import { STOPS, PHOTOS, ROUTE, FAMILY, TRIP, SEED_COMMENTS } from './data'
import { createApiClient, safeOAuthContinuation } from './api-client-core'
import { mobileTracker, sessionStorage } from './mobile'
import { browserLoginHandoffFromUrl } from './mobile-auth-core'
import { createLogtoExperienceClient } from './logto-experience-core'
import type {
  AcceptedInvite, AccountArchive, AuthSession, Coordinates, Device, Id, Invite, LiveFix, MyProfile,
  PendingInvite, Person, Stop, Trip, TripComment, TripData, TripLandingData, TripLoadResult,
  TripPhoto, TripSummary, UploadInput,
} from './shared/model/types'

const API_URL = String(import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
export const hasBackend = Boolean(API_URL)
export const functionsUrl = hasBackend ? `${API_URL}/ingest` : null

export const authClient = createApiClient({
  baseUrl: API_URL || '/api',
  storage: sessionStorage,
  fetch: globalThis.fetch.bind(globalThis),
})
const logtoExperience = createLogtoExperienceClient(authClient)

let browserLogin: Promise<AuthSession | null> | null = null
export function completeBrowserLogin() {
  if (!hasBackend || typeof window === 'undefined') return Promise.resolve(authClient.getSession())
  if (browserLogin) return browserLogin
  const url = new URL(window.location.href)
  const token = browserLoginHandoffFromUrl(url.href)
  if (!token) return Promise.resolve(authClient.getSession())
  const continuation = safeOAuthContinuation(url.searchParams.get('continue'), url.origin)
  browserLogin = authClient.exchangeLoginHandoff(token).then(session => {
    if (continuation) window.location.replace(continuation)
    return session
  }).finally(() => {
    url.searchParams.delete('token')
    url.searchParams.delete('continue')
    if (continuation) return
    window.history.replaceState({}, '', url.pathname + url.search + url.hash)
  })
  return browserLogin
}

interface SampleState {
  trip: Trip
  stops: Stop[]
  photos: TripPhoto[]
  route: Coordinates[]
  family: Person[]
  comments: Record<Id, TripComment[]>
  likes: Id[]
  invites: Invite[]
}

let sample: SampleState | null = null
const sampleTrip = () => {
  if (!sample) sample = {
    trip: { ...TRIP, id: 'sample', slug: 'sample' }, stops: STOPS.map(value => ({ ...value })),
    photos: PHOTOS.map(value => ({ ...value })), route: ROUTE.map(value => [...value] as Coordinates),
    family: FAMILY.map((value, index) => ({
      ...value, memberRole: index === 1 ? 'owner' : value.role === 'Travelling' ? 'editor' : 'viewer',
    })),
    comments: JSON.parse(JSON.stringify(SEED_COMMENTS)), likes: ['p8'], invites: [],
  }
  return sample
}
const uid = () => 's' + Math.random().toString(36).slice(2, 10)

/* Sample mode has no server to remember anything, so the profile lives here and
   survives for as long as the tab does. */
const sampleProfile: MyProfile = {
  id: 'sample-me', name: 'You', handle: 'you', email: 'you@example.com',
  homePlace: 'Regina, Saskatchewan', homeLat: 50.45, homeLng: -104.6,
  timeZone: 'America/Regina', preferences: {}, joinedAt: new Date().toISOString(),
  tripCount: 1, photoCount: 0,
}
const isSample = (tripId: Id) => tripId === 'sample' || !hasBackend
const sampleResult = (): TripData => {
  const value = sampleTrip()
  return {
    trip: { ...value.trip }, stops: value.stops.map((item, seq) => ({ ...item, seq })),
    photos: value.photos.map(item => ({ ...item })), route: value.route.map(item => [...item]),
    family: value.family.map(item => ({ ...item })),
    comments: Object.fromEntries(Object.entries(value.comments).map(([key, items]) => [key, items.map(item => ({ ...item }))])),
    likes: [...value.likes], source: 'sample', tripId: 'sample', canEdit: true,
    me: value.family[1] || value.family[0],
  }
}

const tripPath = (tripId: Id) => `/trips/${encodeURIComponent(tripId)}`

export async function loadTripBySlug(slug: string, session: AuthSession | null): Promise<TripLoadResult> {
  if (!hasBackend) {
    if (slug === 'sample') return sampleResult()
    throw Object.assign(new Error('Trip not found'), { status: 404 })
  }
  if (!session) return { needsAuth: true }
  return authClient.request(`/trips/current?t=${encodeURIComponent(slug)}`)
}

export async function loadLanding(session: AuthSession | null): Promise<TripLandingData> {
  if (!hasBackend) {
    const value = sampleTrip()
    return {
      landing: true,
      trips: [{
        ...value.trip, id: 'sample', slug: 'sample', role: 'owner',
        places: value.stops.map(stop => ({
          name: stop.name, lng: stop.lng, lat: stop.lat, status: stop.status,
        })),
        stopCount: value.stops.length, photoCount: value.photos.length,
        memberCount: value.family.length,
      }],
      invites: [],
    }
  }
  return loadTripLanding(session!)
}

export async function loadUserProfile(handle: string): Promise<Person> {
  if (!hasBackend) {
    const profile = sampleTrip().family.find(person => person.handle === handle)
    if (!profile) throw Object.assign(new Error('Profile not found'), { status: 404 })
    return { ...profile }
  }
  return authClient.request(`/users/${encodeURIComponent(handle)}`)
}

export async function loadTripLanding(session: AuthSession): Promise<TripLandingData> {
  const result = await authClient.request<{ trips: TripSummary[]; invites: PendingInvite[] }>('/trips')
  return {
    landing: true, email: session.user.email,
    trips: result.trips || [], invites: result.invites || [],
  }
}

export async function createStop(tripId: Id, fields: Partial<Stop>): Promise<Stop> {
  if (isSample(tripId)) {
    const stop = { id: uid(), name: '', lng: 0, lat: 0, icon: 'pin', status: 'planned', seq: sampleTrip().stops.length, ...fields } as Stop
    sampleTrip().stops.push(stop); return { ...stop }
  }
  return authClient.request(`${tripPath(tripId)}/stops`, { method: 'POST', body: fields })
}
export async function updateStop(tripId: Id, id: Id, fields: Partial<Stop>): Promise<Stop | undefined> {
  if (isSample(tripId)) { const stop = sampleTrip().stops.find(item => item.id === id); if (stop) Object.assign(stop, fields); return stop }
  return authClient.request(`${tripPath(tripId)}/stops/${encodeURIComponent(id)}`, { method: 'PATCH', body: fields })
}
export async function deleteStop(tripId: Id, id: Id): Promise<unknown> {
  if (isSample(tripId)) { sampleTrip().stops = sampleTrip().stops.filter(item => item.id !== id); return }
  return authClient.request(`${tripPath(tripId)}/stops/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
export async function replaceRoute(tripId: Id, points: Coordinates[]): Promise<unknown> {
  if (isSample(tripId)) { sampleTrip().route = points.map(point => [...point]); return }
  return authClient.request(`${tripPath(tripId)}/route`, { method: 'PUT', body: { points } })
}

export async function addComment(tripId: Id, photoId: Id, body: string): Promise<TripComment> {
  if (isSample(tripId)) {
    const comment = { id: uid(), by: sampleResult().me.name, text: body, when: 'just now' }
    ;(sampleTrip().comments[photoId] ||= []).push(comment); return comment
  }
  return authClient.request(`${tripPath(tripId)}/photos/${encodeURIComponent(photoId)}/comments`, { method: 'POST', body: { body } })
}
export async function deleteComment(tripId: Id, id: Id): Promise<unknown> {
  if (isSample(tripId)) { for (const key of Object.keys(sampleTrip().comments)) sampleTrip().comments[key] = sampleTrip().comments[key].filter(item => item.id !== id); return }
  return authClient.request(`${tripPath(tripId)}/comments/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
export async function setLike(tripId: Id, photoId: Id, on: boolean): Promise<unknown> {
  if (isSample(tripId)) {
    const likes = sampleTrip().likes, index = likes.indexOf(photoId)
    if (on && index < 0) likes.push(photoId); if (!on && index >= 0) likes.splice(index, 1); return
  }
  return authClient.request(`${tripPath(tripId)}/photos/${encodeURIComponent(photoId)}/like`, { method: on ? 'PUT' : 'DELETE' })
}

export async function listInvites(tripId: Id): Promise<Invite[]> {
  if (isSample(tripId)) return sampleTrip().invites.map(item => ({ ...item }))
  return authClient.request(`${tripPath(tripId)}/invites`)
}
export async function listPendingInvites(): Promise<PendingInvite[]> {
  if (!hasBackend) return []
  return authClient.request('/invites/pending')
}
export async function acceptInvite(id: Id): Promise<AcceptedInvite> {
  if (!hasBackend) throw new Error('No backend configured')
  return authClient.request(`/invites/${encodeURIComponent(id)}/accept`, { method: 'POST' })
}
export async function invitePerson(tripId: Id, input: Omit<Invite, 'id' | 'claimedAt'>): Promise<Invite> {
  if (isSample(tripId)) { const row = { id: uid(), ...input, claimedAt: null }; sampleTrip().invites.push(row); return row }
  return authClient.request(`${tripPath(tripId)}/invites`, { method: 'POST', body: input })
}
export async function revokeInvite(tripId: Id, id: Id): Promise<unknown> {
  if (isSample(tripId)) { sampleTrip().invites = sampleTrip().invites.filter(item => item.id !== id); return }
  return authClient.request(`${tripPath(tripId)}/invites/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
export async function removeMember(tripId: Id, profileId: Id): Promise<unknown> {
  if (isSample(tripId)) return
  return authClient.request(`${tripPath(tripId)}/members/${encodeURIComponent(profileId)}`, { method: 'DELETE' })
}

export async function uploadPhoto(tripId: Id, file: File, meta: Partial<TripPhoto & UploadInput> = {}): Promise<TripPhoto> {
  if (isSample(tripId)) {
    const nextSequence = Math.max(sampleTrip().photos.length,
      ...sampleTrip().photos.map(photo => (photo.seq ?? -1) + 1))
    const photo = { id: uid(), by: '', src: URL.createObjectURL(file), seq: nextSequence, ...meta } as TripPhoto
    sampleTrip().photos.push(photo); return { ...photo }
  }
  const form = new FormData(); form.append('photo', file, file.name)
  const values = { stopId: meta.stopId, lng: meta.lng, lat: meta.lat, caption: meta.caption,
    fallbackLng: meta.fallbackLng, fallbackLat: meta.fallbackLat,
    fallbackLocationSource: meta.fallbackLocationSource,
    takenAt: meta.when || meta.takenAt, locationSource: meta.locationSource, uploadKey: meta.uploadKey }
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== null && value !== '') form.append(key, String(value))
  return authClient.request(`${tripPath(tripId)}/photos`, { method: 'POST', body: form })
}
export async function updatePhoto(tripId: Id, id: Id, fields: Partial<TripPhoto>): Promise<TripPhoto | undefined> {
  if (isSample(tripId)) { const photo = sampleTrip().photos.find(item => item.id === id); if (photo) Object.assign(photo, fields); return photo }
  return authClient.request(`${tripPath(tripId)}/photos/${encodeURIComponent(id)}`, { method: 'PATCH', body: fields })
}
export async function deletePhoto(tripId: Id, id: Id): Promise<unknown> {
  if (isSample(tripId)) { sampleTrip().photos = sampleTrip().photos.filter(item => item.id !== id); return }
  return authClient.request(`${tripPath(tripId)}/photos/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function createTrip(input: Partial<Trip>): Promise<Trip> {
  if (!hasBackend) throw new Error('No backend configured')
  return authClient.request('/trips', { method: 'POST', body: input })
}
export async function updateTrip(tripId: Id, fields: Partial<Trip>): Promise<Trip> {
  if (isSample(tripId)) { Object.assign(sampleTrip().trip, fields); return { ...sampleTrip().trip } }
  return authClient.request(tripPath(tripId), { method: 'PATCH', body: fields })
}
export async function loadMyProfile(): Promise<MyProfile> {
  if (!hasBackend) return { ...sampleProfile }
  return authClient.request('/profile')
}

export async function updateMe(changes: Partial<MyProfile>): Promise<MyProfile> {
  if (!hasBackend) {
    const me = sampleTrip().family[1] || sampleTrip().family[0]
    if (changes.name !== undefined) me.name = changes.name
    if (changes.handle !== undefined) me.handle = changes.handle
    Object.assign(sampleProfile, changes, { name: me.name, handle: me.handle })
    return { ...sampleProfile }
  }
  return authClient.request('/profile', { method: 'PATCH', body: changes })
}

/* The archive is a JSON document rather than a zip of originals: photo bytes
   stay where they are and are linked, so requesting it never has to hold a
   trip's worth of full-size images in memory. */
export async function loadAccountArchive(): Promise<AccountArchive> {
  if (!hasBackend) {
    const value = sampleTrip()
    return {
      exportedAt: new Date().toISOString(), profile: { ...sampleProfile },
      trips: [{ ...value.trip, stops: value.stops, photos: value.photos, route: value.route }],
    }
  }
  return authClient.request('/account/archive')
}
export async function uploadAvatar(file: File): Promise<string> {
  if (!hasBackend) {
    const avatar = URL.createObjectURL(file)
    const me = sampleTrip().family[1] || sampleTrip().family[0]
    me.avatar = avatar
    return avatar
  }
  const form = new FormData(); form.append('avatar', file, file.name)
  const result = await authClient.request('/profile/avatar', { method: 'POST', body: form })
  return result.avatar
}

export function subscribeToTrip(tripId: Id, onChange: () => void) {
  if (isSample(tripId)) return () => {}
  const timer = setInterval(onChange, 15_000)
  return () => clearInterval(timer)
}

export async function updateTripPresence(tripId: Id, clientId: string): Promise<Id[]> {
  if (isSample(tripId)) return [sampleResult().me.id].filter(Boolean) as Id[]
  const result = await authClient.request(`${tripPath(tripId)}/presence`, {
    method: 'PUT', body: { clientId },
  })
  return Array.isArray(result.userIds) ? result.userIds : []
}

export async function leaveTripPresence(tripId: Id, clientId: string): Promise<void> {
  if (isSample(tripId)) return
  await authClient.request(`${tripPath(tripId)}/presence`, {
    method: 'DELETE', body: { clientId }, keepalive: true,
  })
}

export async function listDevices(tripId: Id): Promise<Device[]> {
  if (isSample(tripId)) return []
  const values = await authClient.request(`${tripPath(tripId)}/devices`)
  return values.map(value => ({ ...value, lastSeen: value.lastSeen ? new Date(value.lastSeen) : null }))
}
export async function registerDevice(tripId: Id, name: string): Promise<Device> {
  if (isSample(tripId)) throw new Error('Phones require the VPS backend')
  let timezone: string | null = null; try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || null } catch {}
  return authClient.request(`${tripPath(tripId)}/devices`, { method: 'POST', body: { name, timezone } })
}
export async function removeDevice(tripId: Id, id: Id): Promise<unknown> {
  if (isSample(tripId)) return
  return authClient.request(`${tripPath(tripId)}/devices/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
const asFix = (value: { lng: number; lat: number; at: string | Date; [key: string]: unknown }): LiveFix => ({
  ...value, at: new Date(value.at),
})
export async function loadLive(tripId: Id, { hours = 24, cursor = null }: { hours?: number; cursor?: number | null } = {}) {
  if (isSample(tripId)) return { devices: [], fixes: [], cursor: 0 }
  const query = new URLSearchParams({ hours: String(hours) })
  if (cursor !== null && Number.isInteger(cursor) && cursor >= 0) query.set('cursor', String(cursor))
  const result = await authClient.request(`${tripPath(tripId)}/live?${query}`)
  return {
    devices: result.devices.map(value => ({ ...value, lastSeen: value.lastSeen ? new Date(value.lastSeen) : null })),
    fixes: result.fixes.map(asFix), cursor: result.cursor,
  }
}
export function subscribeToPositions(
  tripId: Id,
  onFix: (fix: LiveFix) => void,
  initialCursor = 0,
  { hours = 24, onState }: {
    hours?: number
    onState?: (state: 'ready' | 'error', error?: unknown) => void
  } = {},
) {
  if (isSample(tripId)) return () => {}
  let stopped = false, polling = false, cursor = initialCursor
  const poll = async () => {
    if (polling || stopped) return
    polling = true
    try {
      const result = await loadLive(tripId, { hours, cursor })
      for (const fix of result.fixes) onFix(fix)
      cursor = result.cursor
      onState?.('ready')
    } catch (error) {
      onState?.('error', error)
    } finally {
      polling = false
    }
  }
  const timer = setInterval(() => { if (!stopped) poll() }, 10_000)
  return () => { stopped = true; clearInterval(timer) }
}
export async function sweepPhotos() { return { objects: 0, inserted: 0, skipped: [] } }

export async function signInWithPassword(email: string, password: string) {
  if (!hasBackend) throw new Error('No backend configured')
  return logtoExperience.signIn(email, password)
}
export async function sendRegistrationCode(email: string, handle: string) {
  if (!hasBackend) throw new Error('No backend configured')
  return logtoExperience.sendRegistrationCode(email, handle)
}
export async function completeRegistration(input: { verificationId: string; code: string; password: string }) {
  if (!hasBackend) throw new Error('No backend configured')
  return logtoExperience.completeRegistration(input)
}
export async function signOut() {
  try { if (hasBackend) await authClient.signOut() }
  finally { await mobileTracker.forget() }
}
export async function deleteAccount() {
  if (!hasBackend) throw new Error('No backend configured')
  await authClient.request('/account', { method: 'DELETE', body: { confirm: 'DELETE' } })
  try { await authClient.signOut() }
  finally { await mobileTracker.forget() }
}

export async function loadAttractions(box: Record<string, string | number>, { headlineOnly = false, limit = 1000 } = {}) {
  if (!hasBackend) return null
  const query = new URLSearchParams(Object.fromEntries(Object.entries({
    ...box, headlineOnly, limit: Math.min(limit, 1000),
  }).map(([key, value]) => [key, String(value)])))
  try { return await authClient.request(`/attractions?${query}`) }
  catch (error) { if (error.status === 404) return null; throw error }
}
