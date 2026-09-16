import { STOPS, PHOTOS, ROUTE, FAMILY, TRIP, SEED_COMMENTS } from './data'
import type {
  Coordinates,
  Id,
  Invite,
  MyProfile,
  Person,
  Stop,
  TripComment,
  TripData,
  TripPhoto,
  Trip,
} from './shared/model/types'

/* The bundled Amsterdam trip that stands in when no VPS API is configured:
   its state lives here for as long as the tab does, and every read hands back
   copies so the sample behaves like a server would. */

export interface SampleState {
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

/* The demo is perpetually on its middle day: whatever the real date, the trip
   "started yesterday and ends tomorrow", so the home page says it is live and
   the live machinery treats today as day two of three. The printed September
   dates stay as the fiction's own calendar. */
const isoDaysFromNow = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

/* The fiction's calendar mapped onto the real one, middle day on today.

   The trip's own range was already yesterday-to-tomorrow so the home page
   reads as live, but the stops kept the printed September dates — and nothing
   noticed, because the live machinery used to walk the itinerary as a cursor
   and never looked at a date at all. The moment it did, the whole demo was
   months in the past with nothing ahead of it: no Up next, no day to show,
   and the first trip anybody opens looking like one that had finished.

   Taken from the days the stops actually carry rather than from three written
   here, so a fourth day added to the fiction lands somewhere sensible instead
   of silently outside the window. */
const sampleStopDays = () => {
  const printed = [...new Set(STOPS.map(stop => stop.day))].sort()
  const middle = Math.floor(printed.length / 2)
  return new Map(printed.map((day, index) => [day, isoDaysFromNow(index - middle)]))
}

/* A wall clock on a given day, as an instant — the same arithmetic the
   photographs' capture times go through next door, and in the reader's own
   zone for the same reason. */
const sampleInstant = (day?: string | null, clock?: string | null) =>
  day && clock ? new Date(`${day}T${clock}:00`).toISOString() : null

export const sampleTrip = () => {
  if (!sample)
    sample = {
      trip: {
        ...TRIP,
        id: 'sample',
        slug: 'sample',
        startsOn: isoDaysFromNow(-1),
        endsOn: isoDaysFromNow(1),
        /* Drawn from the real range instead of the printed one. The two used
           to disagree by months and only the printed one was ever shown; now
           the day chips carry real dates, a subtitle reading "4 – 6 September"
           beside them would be the demo contradicting itself on its own front
           page. */
        dates: '',
      },
      /* The stops carry what the phones saw as well as what was planned, which
         is the timeline's whole subject. Written in data.ts as wall clocks and
         turned into instants here, against whichever real day the stop landed
         on — the fiction's September dates are mapped onto the live calendar,
         so an ISO instant written there would be months out by the time
         anybody read it.

         No visitZone, and deliberately: these are built in the reader's own
         clock and are read back in it, so they say the same thing in Sydney as
         in Amsterdam. A real trip carries the zone of the phone that was
         standing there, which the sample has not got. */
      stops: (() => {
        const days = sampleStopDays()
        return STOPS.map(value => {
          const day = days.get(value.day) ?? value.day
          return {
            ...value,
            day,
            arrivedAt: sampleInstant(day, value.arrived),
            leftAt: sampleInstant(day, value.left),
          }
        })
      })(),
      /* A photograph is on the day of the stop it belongs to, at the hour its
         own caption line names.

         The demo's pictures used to carry neither. `when` was display text —
         'Today · 10:42' — and there was no day at all, so everything that asks
         a real question about them ("what has been photographed today", "what
         is new since I last looked") came back empty in the one trip everybody
         sees first. A real photograph has an ISO instant and an ISO day; the
         demo contradicting the app is the worst kind of demo. */
      photos: (() => {
        const days = sampleStopDays()
        const dayOfStop = new Map(
          STOPS.map(stop => [stop.id, days.get(stop.day) ?? stop.day] as const),
        )
        return PHOTOS.map(value => {
          const day = value.stopId ? (dayOfStop.get(value.stopId) ?? null) : null
          const hour = /(\d{1,2}):(\d{2})/.exec(String(value.when ?? ''))
          const when =
            day && hour
              ? new Date(`${day}T${hour[1].padStart(2, '0')}:${hour[2]}:00`).toISOString()
              : value.when
          return { ...value, day, when }
        })
      })(),
      route: ROUTE.map(value => [...value] as Coordinates),
      family: FAMILY.map((value, index) => ({
        ...value,
        memberRole: index === 1 ? 'owner' : value.role === 'Travelling' ? 'editor' : 'viewer',
      })),
      comments: JSON.parse(JSON.stringify(SEED_COMMENTS)) as Record<Id, TripComment[]>,
      likes: ['p8'],
      invites: [],
    }
  return sample
}

export const uid = () => 's' + Math.random().toString(36).slice(2, 10)

/* Sample mode has no server to remember anything, so the profile lives here and
   survives for as long as the tab does. */
export const sampleProfile: MyProfile = {
  id: 'sample-me',
  name: 'You',
  handle: 'you',
  email: 'you@example.com',
  homePlace: 'Regina, Saskatchewan',
  homeLat: 50.45,
  homeLng: -104.6,
  timeZone: 'America/Regina',
  preferences: {},
  joinedAt: new Date().toISOString(),
  tripCount: 1,
  photoCount: 0,
}

export const sampleResult = (): TripData => {
  const value = sampleTrip()
  return {
    trip: { ...value.trip },
    stops: value.stops.map((item, seq) => ({ ...item, seq })),
    photos: value.photos.map(item => ({ ...item })),
    route: value.route.map(item => [...item]),
    family: value.family.map(item => ({ ...item })),
    comments: Object.fromEntries(
      Object.entries(value.comments).map(([key, items]) => [key, items.map(item => ({ ...item }))]),
    ),
    likes: [...value.likes],
    source: 'sample',
    tripId: 'sample',
    canEdit: true,
    me: value.family[1] || value.family[0],
  }
}
