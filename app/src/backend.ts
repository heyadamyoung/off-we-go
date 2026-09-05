import { sampleProfile, sampleResult, sampleTrip, uid } from './sample-trip-core'
import { safeOAuthContinuation } from './api-client-core'
import { browserLoginHandoffFromUrl } from './mobile-auth-core'
import { createLogtoExperienceClient } from './logto-experience-core'
import { authClient, hasBackend, isSample, tripPath } from './backend-base'
import { trackError } from './shared/lib/telemetry'
import { deviceStorage, mobileTracker } from './mobile'
import { localId } from './offline-edits-core'
import { withOfflineEdit } from './offline-edits'
import {
  isTripData,
  isTripLandingData,
  LANDING_SLUG,
  offlineAccountId,
  withOfflineFallback,
} from './offline-trip-core'

export { authClient, functionsUrl, hasBackend, isSample, tripPath } from './backend-base'
export * from './backend-assistant'
export * from './backend-segments'
export * from './backend-social'
export * from './backend-live'
export * from './backend-chat'
import type {
  AccountArchive,
  ApiError,
  AttractionPoi,
  AuthSession,
  Coordinates,
  Id,
  MyProfile,
  PendingInvite,
  Person,
  Stop,
  Trip,
  TripLandingData,
  TripLeg,
  TripLoadResult,
  TripSummary,
} from './shared/model/types'

const logtoExperience = createLogtoExperienceClient(authClient)

let browserLogin: Promise<AuthSession | null> | null = null
export function completeBrowserLogin() {
  if (!hasBackend || typeof window === 'undefined') return Promise.resolve(authClient.getSession())
  if (browserLogin) return browserLogin
  const url = new URL(window.location.href)
  const token = browserLoginHandoffFromUrl(url.href)
  if (!token) return Promise.resolve(authClient.getSession())
  const continuation = safeOAuthContinuation(url.searchParams.get('continue'), url.origin)
  browserLogin = authClient
    .exchangeLoginHandoff(token)
    .then(session => {
      if (continuation) window.location.replace(continuation)
      return session
    })
    .finally(() => {
      url.searchParams.delete('token')
      url.searchParams.delete('continue')
      if (continuation) return
      window.history.replaceState({}, '', url.pathname + url.search + url.hash)
    })
  return browserLogin
}

export async function loadTripBySlug(
  slug: string,
  session: AuthSession | null,
): Promise<TripLoadResult> {
  /* The sample trip is bundled data and the product's public demo: it answers
     with or without a backend and needs no account. Against a real backend it
     is read-only — its edits would have nowhere to live past the tab. */
  if (slug === 'sample') return { ...sampleResult(), canEdit: !hasBackend }
  if (!hasBackend) {
    throw Object.assign(new Error('Trip not found'), { status: 404 })
  }
  if (!session) return { needsAuth: true }
  return withOfflineFallback(deviceStorage, {
    account: offlineAccountId(session),
    slug,
    valid: isTripData,
    load: () => authClient.request<TripLoadResult>(`/trips/current?t=${encodeURIComponent(slug)}`),
  })
}

export async function loadLanding(session: AuthSession | null): Promise<TripLandingData> {
  if (!hasBackend) {
    const value = sampleTrip()
    return {
      landing: true,
      trips: [
        {
          ...value.trip,
          id: 'sample',
          slug: 'sample',
          role: 'owner',
          places: value.stops.map(stop => ({
            name: stop.name,
            lng: stop.lng,
            lat: stop.lat,
            status: stop.status,
          })),
          stopCount: value.stops.length,
          photoCount: value.photos.length,
          memberCount: value.family.length,
        },
      ],
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

/* The trips list gets the same treatment as a trip, and for the same reason:
   without it, an aeroplane-mode traveller cannot reach the trip we cached for
   them — the way in is a list they cannot load. */
export async function loadTripLanding(session: AuthSession): Promise<TripLandingData> {
  return withOfflineFallback(deviceStorage, {
    account: offlineAccountId(session),
    slug: LANDING_SLUG,
    valid: isTripLandingData,
    load: async (): Promise<TripLandingData> => {
      const result = await authClient.request<{ trips: TripSummary[]; invites: PendingInvite[] }>(
        '/trips',
      )
      return {
        landing: true,
        email: session.user.email,
        trips: result.trips || [],
        invites: result.invites || [],
      }
    },
  })
}

export async function createStop(tripId: Id, fields: Partial<Stop>): Promise<Stop> {
  if (isSample(tripId)) {
    const stop = {
      id: uid(),
      name: '',
      lng: 0,
      lat: 0,
      icon: 'pin',
      status: 'planned',
      seq: sampleTrip().stops.length,
      ...fields,
    } as Stop
    sampleTrip().stops.push(stop)
    return { ...stop }
  }
  const target = localId()
  return withOfflineEdit(
    { kind: 'stop.create', tripId, target, fields },
    () => authClient.request<Stop>(`${tripPath(tripId)}/stops`, { method: 'POST', body: fields }),
    // The stop exists on the screen straight away under a name only this
    // device knows; the server's name replaces it when the queue drains.
    () => ({ id: target, name: '', lng: 0, lat: 0, ...fields }) as Stop,
  )
}
export async function updateStop(
  tripId: Id,
  id: Id,
  fields: Partial<Stop>,
): Promise<Stop | undefined> {
  if (isSample(tripId)) {
    const stop = sampleTrip().stops.find(item => item.id === id)
    if (stop) Object.assign(stop, fields)
    return stop
  }
  return withOfflineEdit(
    { kind: 'stop.update', tripId, target: id, fields },
    () =>
      authClient.request<Stop | undefined>(`${tripPath(tripId)}/stops/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: fields,
      }),
    () => ({ id, ...fields }) as Stop,
  )
}
export async function deleteStop(tripId: Id, id: Id): Promise<unknown> {
  if (isSample(tripId)) {
    sampleTrip().stops = sampleTrip().stops.filter(item => item.id !== id)
    return
  }
  return withOfflineEdit(
    { kind: 'stop.delete', tripId, target: id },
    () =>
      authClient.request(`${tripPath(tripId)}/stops/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
    () => undefined,
  )
}
export async function replaceRoute(tripId: Id, points: Coordinates[]): Promise<unknown> {
  if (isSample(tripId)) {
    sampleTrip().route = points.map(point => [...point])
    return
  }
  return withOfflineEdit(
    { kind: 'route.replace', tripId, points },
    () => authClient.request(`${tripPath(tripId)}/route`, { method: 'PUT', body: { points } }),
    () => undefined,
  )
}

export async function createTrip(input: Partial<Trip>): Promise<Trip> {
  if (!hasBackend) throw new Error('No backend configured')
  return authClient.request('/trips', { method: 'POST', body: input })
}
export async function updateTrip(tripId: Id, fields: Partial<Trip>): Promise<Trip> {
  if (isSample(tripId)) {
    Object.assign(sampleTrip().trip, fields)
    return { ...sampleTrip().trip }
  }
  return withOfflineEdit(
    { kind: 'trip.update', tripId, fields },
    () => authClient.request<Trip>(tripPath(tripId), { method: 'PATCH', body: fields }),
    () => fields as Trip,
  )
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
      exportedAt: new Date().toISOString(),
      profile: { ...sampleProfile },
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
  const form = new FormData()
  form.append('avatar', file, file.name)
  const result = await authClient.request<{ avatar: string }>('/profile/avatar', {
    method: 'POST',
    body: form,
  })
  return result.avatar
}

/* One connection per trip on screen, shared by everything watching it. */

export async function sweepPhotos() {
  return { objects: 0, inserted: 0, skipped: [] }
}

/* The sign-in flows, guarded once: every one of them is meaningless without a
   backend, and the guard preserves each method's own signature. */
const requireBackend =
  <A extends unknown[], R>(fn: (...args: A) => R) =>
  (...args: A): R => {
    if (!hasBackend) throw new Error('No backend configured')
    return fn(...args)
  }
export const signInWithPassword = requireBackend(logtoExperience.signIn)
export const sendRegistrationCode = requireBackend(logtoExperience.sendRegistrationCode)
export const completeRegistration = requireBackend(logtoExperience.completeRegistration)
export const sendSignInCode = requireBackend(logtoExperience.sendSignInCode)
export const signInWithCode = requireBackend(logtoExperience.signInWithCode)
export async function signOut() {
  try {
    if (hasBackend) await authClient.signOut()
  } finally {
    await mobileTracker.forget()
  }
}
export async function deleteAccount() {
  if (!hasBackend) throw new Error('No backend configured')
  await authClient.request('/account', { method: 'DELETE', body: { confirm: 'DELETE' } })
  try {
    await authClient.signOut()
  } finally {
    await mobileTracker.forget()
  }
}

/* The AI chat on the map. Addressed by slug like /trips/current, and the
   whole transcript travels with the ask — the server keeps no chat state. */
/* From the person to a stop: the engine's shortest way, with the shape to
   draw. Null on any refusal — the caller falls back to the crow. */
export async function routeToStop(
  tripId: Id,
  from: Coordinates,
  to: Coordinates,
  mode: 'pedestrian' | 'auto' | 'bicycle',
): Promise<{ seconds: number; meters: number; shape: Coordinates[] } | null> {
  if (isSample(tripId)) return null
  try {
    return await authClient.request(
      `${tripPath(tripId)}/route?fromLng=${from[0]}&fromLat=${from[1]}` +
        `&toLng=${to[0]}&toLat=${to[1]}&mode=${mode}`,
    )
  } catch {
    return null
  }
}

/* Road truth is an optional garnish: no engine, no session, sample mode, or a
   mid-build engine all degrade to "no legs" here — the server keeps the
   evidence, the itinerary just renders without the labels. */
export async function loadTripLegs(
  tripId: Id,
  mode: 'auto' | 'pedestrian' | 'bicycle' = 'auto',
): Promise<{ mode: string; legs: TripLeg[] } | null> {
  if (isSample(tripId)) return null
  try {
    return await authClient.request(`${tripPath(tripId)}/legs?mode=${mode}`)
  } catch (caught) {
    // Degrade-to-absence for the UI, never for the telemetry: an unconfigured
    // engine 503s (expected, quiet), anything else is a recorded failure.
    if ((caught as { status?: number })?.status !== 503) trackError('load legs', caught)
    return null
  }
}

export async function loadAttractions(
  box: Record<string, string | number>,
  { headlineOnly = false, limit = 1000 } = {},
): Promise<AttractionPoi[] | null> {
  if (!hasBackend) return null
  const query = new URLSearchParams(
    Object.fromEntries(
      Object.entries({
        ...box,
        headlineOnly,
        limit: Math.min(limit, 1000),
      }).map(([key, value]) => [key, String(value)]),
    ),
  )
  try {
    return await authClient.request<AttractionPoi[]>(`/attractions?${query}`)
  } catch (error) {
    if ((error as ApiError).status === 404) return null
    throw error
  }
}

/* The inside of an airport, from the server's shared Overpass cache. Null when
   there is no backend, or one deployed from before this route existed — the
   caller then asks OpenStreetMap directly. */
export async function loadAirportIndoor(lng: number, lat: number): Promise<unknown | null> {
  if (!hasBackend) return null
  try {
    return await authClient.request(`/airports/indoor?lng=${lng}&lat=${lat}`)
  } catch (error) {
    if ((error as ApiError).status === 404) return null
    throw error
  }
}
