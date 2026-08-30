import { STOPS, PHOTOS, ROUTE, FAMILY, TRIP, SEED_COMMENTS } from './data'
import { createApiClient } from './apiClientCore'

const API_URL = String(import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
export const hasBackend = Boolean(API_URL)
export const functionsUrl = hasBackend ? `${API_URL}/ingest` : null

const memoryStorage = { getItem() { return null }, setItem() {}, removeItem() {} }
export const authClient = createApiClient({
  baseUrl: API_URL || '/api',
  storage: typeof localStorage === 'undefined' ? memoryStorage : localStorage,
  fetch: globalThis.fetch.bind(globalThis),
})

let browserLogin = null
export function completeBrowserLogin() {
  if (!hasBackend || typeof window === 'undefined') return Promise.resolve(authClient.getSession())
  if (browserLogin) return browserLogin
  const url = new URL(window.location.href)
  const token = url.searchParams.get('token')
  if (!token || token.length < 32) return Promise.resolve(authClient.getSession())
  browserLogin = authClient.exchangeMagicToken(token).finally(() => {
    url.searchParams.delete('token')
    window.history.replaceState({}, '', url.pathname + url.search + url.hash)
  })
  return browserLogin
}

let sample = null
const sampleTrip = () => {
  if (!sample) sample = {
    trip: { ...TRIP, id: 'sample' }, stops: STOPS.map(value => ({ ...value })),
    photos: PHOTOS.map(value => ({ ...value })), route: ROUTE.map(value => [...value]),
    family: FAMILY.map(value => ({ ...value, memberRole: value.role === 'Travelling' ? 'editor' : 'viewer' })),
    comments: JSON.parse(JSON.stringify(SEED_COMMENTS)), likes: ['p8'], invites: [],
  }
  return sample
}
const uid = () => 's' + Math.random().toString(36).slice(2, 10)
const isSample = tripId => tripId === 'sample' || !hasBackend
const sampleResult = () => {
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

const tripPath = tripId => `/trips/${encodeURIComponent(tripId)}`

export async function loadTrip(session) {
  if (!hasBackend) return sampleResult()
  if (!session) return { needsAuth: true }
  const wanted = new URLSearchParams(window.location.search).get('t')
  try { return await authClient.request(`/trips/current${wanted ? `?t=${encodeURIComponent(wanted)}` : ''}`) }
  catch (error) {
    if (error.status === 404) return { noTrip: true, email: session.user.email }
    throw error
  }
}

export async function createStop(tripId, fields) {
  if (isSample(tripId)) {
    const stop = { id: uid(), icon: 'pin', status: 'planned', seq: sampleTrip().stops.length, ...fields }
    sampleTrip().stops.push(stop); return { ...stop }
  }
  return authClient.request(`${tripPath(tripId)}/stops`, { method: 'POST', body: fields })
}
export async function updateStop(tripId, id, fields) {
  if (isSample(tripId)) { const stop = sampleTrip().stops.find(item => item.id === id); if (stop) Object.assign(stop, fields); return stop }
  return authClient.request(`${tripPath(tripId)}/stops/${encodeURIComponent(id)}`, { method: 'PATCH', body: fields })
}
export async function deleteStop(tripId, id) {
  if (isSample(tripId)) { sampleTrip().stops = sampleTrip().stops.filter(item => item.id !== id); return }
  return authClient.request(`${tripPath(tripId)}/stops/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
export async function replaceRoute(tripId, points) {
  if (isSample(tripId)) { sampleTrip().route = points.map(point => [...point]); return }
  return authClient.request(`${tripPath(tripId)}/route`, { method: 'PUT', body: { points } })
}

export async function addComment(tripId, photoId, body) {
  if (isSample(tripId)) {
    const comment = { id: uid(), by: sampleResult().me.name, text: body, when: 'just now' }
    ;(sampleTrip().comments[photoId] ||= []).push(comment); return comment
  }
  return authClient.request(`${tripPath(tripId)}/photos/${encodeURIComponent(photoId)}/comments`, { method: 'POST', body: { body } })
}
export async function deleteComment(tripId, id) {
  if (isSample(tripId)) { for (const key of Object.keys(sampleTrip().comments)) sampleTrip().comments[key] = sampleTrip().comments[key].filter(item => item.id !== id); return }
  return authClient.request(`${tripPath(tripId)}/comments/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
export async function setLike(tripId, photoId, on) {
  if (isSample(tripId)) {
    const likes = sampleTrip().likes, index = likes.indexOf(photoId)
    if (on && index < 0) likes.push(photoId); if (!on && index >= 0) likes.splice(index, 1); return
  }
  return authClient.request(`${tripPath(tripId)}/photos/${encodeURIComponent(photoId)}/like`, { method: on ? 'PUT' : 'DELETE' })
}

export async function listInvites(tripId) {
  if (isSample(tripId)) return sampleTrip().invites.map(item => ({ ...item }))
  return authClient.request(`${tripPath(tripId)}/invites`)
}
export async function invitePerson(tripId, input) {
  if (isSample(tripId)) { const row = { id: uid(), ...input, claimedAt: null }; sampleTrip().invites.push(row); return row }
  return authClient.request(`${tripPath(tripId)}/invites`, { method: 'POST', body: input })
}
export async function revokeInvite(tripId, id) {
  if (isSample(tripId)) { sampleTrip().invites = sampleTrip().invites.filter(item => item.id !== id); return }
  return authClient.request(`${tripPath(tripId)}/invites/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function uploadPhoto(tripId, file, meta = {}) {
  if (isSample(tripId)) {
    const photo = { id: uid(), src: URL.createObjectURL(file), seq: sampleTrip().photos.length, ...meta }
    sampleTrip().photos.push(photo); return { ...photo }
  }
  const form = new FormData(); form.append('photo', file, file.name)
  const values = { stopId: meta.stopId, lng: meta.lng, lat: meta.lat, caption: meta.caption,
    takenAt: meta.when || meta.takenAt, locationSource: meta.locationSource }
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== null && value !== '') form.append(key, String(value))
  return authClient.request(`${tripPath(tripId)}/photos`, { method: 'POST', body: form })
}
export async function updatePhoto(tripId, id, fields) {
  if (isSample(tripId)) { const photo = sampleTrip().photos.find(item => item.id === id); if (photo) Object.assign(photo, fields); return photo }
  return authClient.request(`${tripPath(tripId)}/photos/${encodeURIComponent(id)}`, { method: 'PATCH', body: fields })
}
export async function deletePhoto(tripId, id) {
  if (isSample(tripId)) { sampleTrip().photos = sampleTrip().photos.filter(item => item.id !== id); return }
  return authClient.request(`${tripPath(tripId)}/photos/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function createTrip(input) {
  if (!hasBackend) throw new Error('No backend configured')
  return authClient.request('/trips', { method: 'POST', body: input })
}
export async function updateTrip(tripId, fields) {
  if (isSample(tripId)) { Object.assign(sampleTrip().trip, fields); return { ...sampleTrip().trip } }
  return authClient.request(tripPath(tripId), { method: 'PATCH', body: fields })
}
export async function updateMe(tripId, _userId, { name, avatarUrl, avatarPath }) {
  if (isSample(tripId)) { const me = sampleTrip().family[1] || sampleTrip().family[0]; if (name !== undefined) me.name = name; if (avatarUrl !== undefined) me.avatar = avatarUrl; return { ...me } }
  return authClient.request(`${tripPath(tripId)}/members/me`, { method: 'PATCH', body: { name, avatarPath: avatarPath ?? avatarUrl } })
}
export async function uploadAvatar(tripId, _userId, file) {
  if (isSample(tripId)) return URL.createObjectURL(file)
  const form = new FormData(); form.append('avatar', file, file.name)
  const result = await authClient.request(`${tripPath(tripId)}/members/me/avatar`, { method: 'POST', body: form })
  return result.avatarPath
}

export function subscribeToTrip(tripId, onChange) {
  if (isSample(tripId)) return () => {}
  const timer = setInterval(onChange, 15_000)
  return () => clearInterval(timer)
}

export async function listDevices(tripId) {
  if (isSample(tripId)) return []
  const values = await authClient.request(`${tripPath(tripId)}/devices`)
  return values.map(value => ({ ...value, lastSeen: value.lastSeen ? new Date(value.lastSeen) : null }))
}
export async function registerDevice(tripId, name) {
  if (isSample(tripId)) throw new Error('Phones require the VPS backend')
  let timezone = null; try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || null } catch {}
  return authClient.request(`${tripPath(tripId)}/devices`, { method: 'POST', body: { name, timezone } })
}
export async function removeDevice(tripId, id) {
  if (isSample(tripId)) return
  return authClient.request(`${tripPath(tripId)}/devices/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
const asFix = value => ({ ...value, at: new Date(value.at) })
export async function loadLive(tripId, { hours = 24 } = {}) {
  if (isSample(tripId)) return { devices: [], fixes: [] }
  const result = await authClient.request(`${tripPath(tripId)}/live?hours=${encodeURIComponent(hours)}`)
  return { devices: result.devices.map(value => ({ ...value, lastSeen: value.lastSeen ? new Date(value.lastSeen) : null })), fixes: result.fixes.map(asFix) }
}
export function subscribeToPositions(tripId, onFix) {
  if (isSample(tripId)) return () => {}
  let stopped = false, latest = Date.now()
  const poll = async () => {
    try {
      const { fixes } = await loadLive(tripId, { hours: 1 })
      for (const fix of fixes) if (fix.at.getTime() > latest) onFix(fix)
      latest = Math.max(latest, ...fixes.map(fix => fix.at.getTime()), 0)
    } catch {}
  }
  const timer = setInterval(() => { if (!stopped) poll() }, 10_000)
  return () => { stopped = true; clearInterval(timer) }
}
export async function sweepPhotos() { return { objects: 0, inserted: 0, skipped: [] } }

export async function sendMagicLink(email) {
  if (!hasBackend) throw new Error('No backend configured')
  return authClient.request('/auth/magic-link', { method: 'POST', body: { email: email.trim().toLowerCase() } })
}
export async function signOut() { if (hasBackend) await authClient.signOut() }
export async function deleteAccount() {
  if (!hasBackend) throw new Error('No backend configured')
  await authClient.request('/account', { method: 'DELETE', body: { confirm: 'DELETE' } })
  await authClient.signOut()
}

export async function loadAttractions(box, { headlineOnly = false, limit = 1000 } = {}) {
  if (!hasBackend) return null
  const query = new URLSearchParams({ ...box, headlineOnly: String(headlineOnly), limit: String(Math.min(limit, 1000)) })
  try { return await authClient.request(`/attractions?${query}`) }
  catch (error) { if (error.status === 404) return null; throw error }
}
