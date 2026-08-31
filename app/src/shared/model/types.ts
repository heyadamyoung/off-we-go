export type Id = string
export type Coordinates = [number, number]
export type ToastTone = 'success' | 'error'
export type Toast = (message: string, tone?: ToastTone) => void

export interface MapView {
  center: Coordinates
  zoom: number
  ms?: number
  bounds?: [Coordinates, Coordinates]
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
  sourceUrl?: string
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
  [key: string]: unknown
}

export interface LiveFix {
  deviceId?: Id
  id?: Id
  lng: number
  lat: number
  at: Date
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
  slug?: string
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

export interface TripData {
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

export type TripLoadResult =
  | TripData
  | { needsAuth: true }
  | { noTrip: true; email?: string; invites: PendingInvite[] }

export interface Attraction {
  id: Id | number
  name: string
  lng: number
  lat: number
  icon?: string
  image?: string | null
  pageTitle?: string
  sourceUrl?: string
  note?: string
  metres?: number
  n?: string
  d?: string
  k?: string
  f?: string
  t?: string
  u?: string
  source?: string
}

export interface ViewerState {
  ids: Id[]
  index: number
}

export interface UploadInput {
  file: File
  stopId?: Id
  caption?: string
  lng?: number
  lat?: number
  takenAt?: string
  when?: string
  uploadKey?: string
  locationSource?: string
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
