import type { MyProfile, TripSummary } from '../../../shared/model/types'
import type { GlobePlace } from './globe-core'

/* Turning trips into something the globe can draw. Pure, so the rules about
   which leg counts as walked and which trip counts as live are testable without
   a browser. */

const DAY = 86_400_000
const onDay = (iso?: string | null) => (iso ? new Date(`${iso}T12:00:00`) : null)

export const todayISO = (now = new Date()) =>
  new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)

export interface TripProgress {
  /** 1-based, clamped to the trip; 0 before it starts */
  day: number
  days: number
  state: 'upcoming' | 'live' | 'past'
}

export function tripProgress(trip: TripSummary, today = todayISO()): TripProgress {
  const start = onDay(trip.startsOn)
  const end = onDay(trip.endsOn)
  const now = onDay(today)
  const days = start && end ? Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY) + 1)
    : trip.dayCount || 0
  if (!start || !end || !now) return { day: 0, days, state: 'upcoming' }
  if (now < start) return { day: 0, days, state: 'upcoming' }
  if (now > end) return { day: days, days, state: 'past' }
  return { day: Math.round((now.getTime() - start.getTime()) / DAY) + 1, days, state: 'live' }
}

/** The trip to lead with: the one running now, else the next one, else the last. */
export function pickCurrentTrip(trips: TripSummary[], today = todayISO()): TripSummary | null {
  if (!trips.length) return null
  const scored = trips.map(trip => ({ trip, progress: tripProgress(trip, today) }))
  return (scored.find(item => item.progress.state === 'live')
    || scored.find(item => item.progress.state === 'upcoming')
    || scored[scored.length - 1]).trip
}

export const isPast = (trip: TripSummary, today = todayISO()) =>
  tripProgress(trip, today).state === 'past'

const near = (a: GlobePlace, b: GlobePlace) =>
  Math.abs(a.lng - b.lng) < 0.05 && Math.abs(a.lat - b.lat) < 0.05

/* Consecutive stops in the same place are one dot: a globe at this scale cannot
   show the difference between a hotel and the restaurant across the street, and
   drawing both just thickens the line. */
export function tripPlaces(trip: TripSummary): GlobePlace[] {
  const places: GlobePlace[] = []
  for (const place of trip.places || []) {
    if (!Number.isFinite(place.lng) || !Number.isFinite(place.lat)) continue
    const next: GlobePlace = {
      name: place.name || '', lng: place.lng, lat: place.lat,
      done: place.status === 'done' || place.status === 'now',
    }
    const previous = places[places.length - 1]
    if (previous && near(previous, next)) {
      previous.done = previous.done || next.done
      continue
    }
    places.push(next)
  }
  /* Only the ends get a name, so a dense trip does not become a wall of
     labels — and a there-and-back trip gets one, not two on top of each other. */
  if (places.length) {
    const last = places[places.length - 1]
    last.label = true
    if (places.length > 1 && !near(places[0], last)) places[0].label = true
  }
  return places
}

/** Where the travellers have got to: the last place already visited. */
export function livePlace(places: GlobePlace[]): GlobePlace | null {
  for (let index = places.length - 1; index >= 0; index--) if (places[index].done) return places[index]
  return null
}

export function homePlace(profile?: MyProfile | null): GlobePlace | null {
  if (!profile || profile.homeLat == null || profile.homeLng == null) return null
  return {
    name: (profile.homePlace || '').split(',')[0].trim() || 'Home',
    lng: profile.homeLng, lat: profile.homeLat,
  }
}

/* The globe shows one trip's arc at a time — every trip at once is a ball of
   string. Home joins the ends so the journey starts and finishes somewhere. */
export function globeScene(trip: TripSummary | null, profile?: MyProfile | null) {
  const home = homePlace(profile)
  const places = trip ? tripPlaces(trip) : []
  if (!places.length) return { places: home ? [home] : [], home, live: null }
  const leaving = home ? [{ ...home, done: places[0].done, label: false }] : []
  const returning = home && tripProgress(trip!).state === 'past'
    ? [{ ...home, done: true, label: false }] : []
  return {
    places: [...leaving, ...places, ...returning],
    home,
    live: tripProgress(trip!).state === 'live' ? livePlace(places) : null,
  }
}
