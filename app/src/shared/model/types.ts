export type Id = string
export type Coordinates = [number, number]
export type ToastTone = 'success' | 'error'
export type Toast = (message: string, tone?: ToastTone) => void

export interface MapView {
  center: Coordinates
  zoom: number
  ms?: number
  bounds?: [Coordinates, Coordinates]
  /* This move is going somewhere to be looked at, so it is placed in the middle
     of the map that is not behind the chrome. Moves that merely keep the camera
     where it is — a zoom button, the position reported back after a drag — must
     leave this off, or every one of them shifts the map by the same offset. */
  focus?: boolean
}

export interface Stop {
  id: Id
  name: string
  lng: number
  lat: number
  day?: string
  time?: string
  kind?: string
  icon?: string
  status?: string
  note?: string
  src?: string | null
  sourceUrl?: string | null
  seq?: number
  kw?: string
  lock?: number
}

export interface TripPhoto {
  id: Id
  stopId?: Id | null
  lng?: number | null
  lat?: number | null
  by: string
  when?: string
  takenAt?: string
  locationSource?: 'exif' | 'trail' | 'live' | 'manual' | 'approximate' | null
  caption?: string
  src?: string
  url?: string
  thumbUrl?: string
  kw?: string
  lock?: number
  seed?: string
  pending?: boolean
  seq?: number
}

export interface Invite {
  id: Id
  email: string
  name?: string
  role?: string
  claimedAt?: string | null
  claimed_at?: string | null
  mailed?: boolean
  mailError?: string
}

export interface PendingInvite extends Invite {
  tripId: Id
  tripSlug: string
  tripTitle: string
}

export interface AcceptedInvite {
  tripId: Id
  tripSlug: string
  tripTitle: string
  role: string
}

export interface Device {
  id: Id
  name: string
  token?: string
  lastSeen?: Date | null
  /** set when the phone reported a deliberate pause after its last fix */
  pausedAt?: Date | null
  [key: string]: unknown
}

export interface LiveFix {
  deviceId?: Id
  id?: Id
  lng: number
  lat: number
  at: Date
  accuracy?: number | null
  speed?: number | null
  [key: string]: unknown
}

export interface TripComment {
  id: Id
  by: string
  text: string
  when?: string
  pending?: boolean
}

export interface Person {
  id?: Id
  handle?: string
  name: string
  email?: string
  role?: string
  memberRole?: 'owner' | 'editor' | 'viewer' | string
  avatar?: string
  avatarUrl?: string
  avatarPath?: string
  initials?: string
}

export interface Trip {
  id?: Id
  title: string
  crew?: string
  dates?: string
  startsOn?: string
  endsOn?: string
  dayIndex?: number
  dayCount?: number
  shareCode?: string
  slug?: string
}

export interface TripPlace {
  name: string
  lng: number
  lat: number
  status?: string
}

export interface TripSummary extends Trip {
  id: Id
  slug: string
  role: 'owner' | 'editor' | 'viewer' | string
  /** the trip's stops, capped, so the home globe can draw its arc */
  places?: TripPlace[]
  stopCount?: number
  photoCount?: number
  memberCount?: number
}

/** Your own profile, which carries more than the one other people can see. */
export interface MyProfile extends Person {
  email?: string
  homePlace?: string | null
  homeLat?: number | null
  homeLng?: number | null
  timeZone?: string | null
  preferences?: Record<string, unknown>
  joinedAt?: string | null
  tripCount?: number
  photoCount?: number
}

export interface TripLandingData {
  landing: true
  offlineAt?: number
  email?: string
  trips: TripSummary[]
  invites: PendingInvite[]
}

export interface AccountArchive {
  exportedAt: string
  profile: MyProfile | null
  trips: Array<Record<string, unknown>>
}

export interface TripData {
  /** Set when this came from the offline cache: when it was last synced. */
  offlineAt?: number
  tripId: Id
  trip: Trip
  stops: Stop[]
  photos: TripPhoto[]
  route: Coordinates[]
  family: Person[]
  comments: Record<Id, TripComment[]>
  likes: Id[]
  me: Person
  canEdit: boolean
  source?: string
}

/** Road truth between two consecutive stops of a day, from the routing engine. */
export interface TripLeg {
  fromId: Id
  toId: Id
  day?: string | null
  seconds: number
  meters: number
}

/** One turn of the AI chat; the transcript lives in the browser. */
export interface AssistantMessage {
  role: 'user' | 'assistant'
  text: string
}

export interface AuthSession {
  accessToken: string
  user: { id?: Id; email?: string; [key: string]: unknown }
  [key: string]: unknown
}

export interface AsyncStorage {
  getItem(key: string): string | null | Promise<string | null>
  setItem(key: string, value: string): void | Promise<void>
  removeItem(key: string): void | Promise<void>
}

export type ApiRequestOptions = Omit<RequestInit, 'body'> & { body?: unknown }

export type TripLoadResult = TripData | { needsAuth: true } | TripLandingData

export interface Attraction {
  id: Id | number
  name: string
  lng: number
  lat: number
  kind?: string
  icon?: string
  image?: string | null
  pageTitle?: string
  sourceUrl?: string
  note?: string
  metres?: number | null
  n?: string
  d?: string
  k?: string
  f?: string
  t?: string
  u?: string
  big?: boolean
  source?: string | null
}

export interface ViewerState {
  ids: Id[]
  index: number
}

/** The compact attraction row the map layer draws — seeded by the server or
    fetched live from Wikipedia, one shape either way. */
export interface AttractionPoi {
  id: number
  n: string
  d: string
  k: string
  f: string | null
  x: number
  y: number
}

export interface UploadInput {
  file: File
  stopId?: Id | null
  caption?: string
  lng?: number
  lat?: number
  fallbackLng?: number
  fallbackLat?: number
  fallbackLocationSource?: 'live' | 'approximate'
  takenAt?: string
  when?: string
  uploadKey?: string
  locationSource?: 'exif' | 'trail' | 'live' | 'manual' | 'approximate'
  order?: number
}

export type StopDraft = Partial<Stop> & Pick<Stop, 'lng' | 'lat'>

export interface ApiError extends Error {
  status?: number
  code?: string
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}
