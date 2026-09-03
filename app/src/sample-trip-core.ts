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

export const sampleTrip = () => {
  if (!sample)
    sample = {
      trip: {
        ...TRIP,
        id: 'sample',
        slug: 'sample',
        startsOn: isoDaysFromNow(-1),
        endsOn: isoDaysFromNow(1),
      },
      stops: STOPS.map(value => ({ ...value })),
      photos: PHOTOS.map(value => ({ ...value })),
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
