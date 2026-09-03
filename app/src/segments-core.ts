/* The getting-there layer, pure: faces, countdowns, connections, and the
   make-it verdicts. Everything here is a function of a segment and a clock,
   which is what keeps the feature honest — the right information ambushes
   the traveller at the right hour, chosen by time, never by settings.

   The deadline offsets mirror server/src/segments.js — keep the two in
   step, like the Overpass query pair. */

export interface SegmentPassenger {
  personId?: string | null
  name: string
  seat?: string | null
  passPhotoId?: string | null
}

export interface SegmentDocument {
  id: string
  personId?: string | null
  name: string
  kind: string
  mime: string
  bytes?: number | null
  src?: string
}

export interface SegmentDeadlines {
  checkinOpensAt?: string
  checkinClosesAt?: string
  bagsCloseAt?: string
  boardingAt?: string
  doorsAt?: string
}

export interface Segment {
  id: string
  tripId?: string
  mode: 'flight' | 'train' | 'bus' | 'ferry' | 'drive'
  carrier?: string | null
  number?: string | null
  ref?: string | null
  fromName: string
  fromCode?: string | null
  fromLng?: number | null
  fromLat?: number | null
  toName: string
  toCode?: string | null
  toLng?: number | null
  toLat?: number | null
  departsAt: string
  arrivesAt?: string | null
  departTz?: string | null
  arriveTz?: string | null
  terminal?: string | null
  gate?: string | null
  gateWas?: string | null
  platform?: string | null
  passengers: SegmentPassenger[]
  bags?: { checked?: string; carryOn?: string; personal?: boolean } | null
  deadlines?: SegmentDeadlines | null
  costAmount?: number | null
  costCurrency?: string | null
  status: 'scheduled' | 'delayed' | 'changed' | 'cancelled' | 'done'
  statusNote?: string | null
  notes?: string | null
  documents?: SegmentDocument[]
}

/* Mirrors server/src/segments.js OFFSETS. */
const OFFSETS: Record<Segment['mode'], Partial<Record<keyof SegmentDeadlines, number>>> = {
  flight: {
    checkinOpensAt: 1440,
    checkinClosesAt: 60,
    bagsCloseAt: 45,
    boardingAt: 40,
    doorsAt: 15,
  },
  train: { boardingAt: 20, doorsAt: 2 },
  bus: { boardingAt: 15, doorsAt: 5 },
  ferry: { checkinClosesAt: 60, boardingAt: 30, doorsAt: 10 },
  drive: {},
}

export const SEGMENT_MODES = Object.keys(OFFSETS) as Segment['mode'][]

export const MODE_GLYPH: Record<Segment['mode'], string> = {
  flight: '✈',
  train: '🚆',
  bus: '🚌',
  ferry: '⛴',
  drive: '⌁',
}

export function deriveDeadlines(mode: Segment['mode'], departsAt: string): SegmentDeadlines | null {
  const depart = new Date(departsAt).getTime()
  if (!Number.isFinite(depart)) return null
  const out: SegmentDeadlines = {}
  for (const [key, minutes] of Object.entries(OFFSETS[mode] || {})) {
    out[key as keyof SegmentDeadlines] = new Date(depart - minutes * 60_000).toISOString()
  }
  return Object.keys(out).length ? out : null
}

export const DEADLINE_LABELS: Record<keyof SegmentDeadlines, string> = {
  checkinOpensAt: 'Check-in opens',
  checkinClosesAt: 'Check-in by',
  bagsCloseAt: 'Bags by',
  boardingAt: 'Boarding',
  doorsAt: 'Doors close',
}

const DEADLINE_ORDER: Array<keyof SegmentDeadlines> = [
  'checkinOpensAt',
  'checkinClosesAt',
  'bagsCloseAt',
  'boardingAt',
  'doorsAt',
]

export function nextDeadline(segment: Segment, now: number) {
  const deadlines = segment.deadlines || {}
  for (const key of DEADLINE_ORDER) {
    const at = deadlines[key]
    if (at && new Date(at).getTime() > now) {
      return { key, label: DEADLINE_LABELS[key], at }
    }
  }
  return null
}

/* Which face the card wears — chosen by the clock, never by settings.
   future: a quiet line. eve: packing truth surfaces. day: the countdown and
   the meter. past: a line in the journal. */
export function segmentFace(segment: Segment, now: number): 'future' | 'eve' | 'day' | 'past' {
  const departs = new Date(segment.departsAt).getTime()
  const arrives = segment.arrivesAt ? new Date(segment.arrivesAt).getTime() : departs
  if (now > arrives + 2 * 3600_000 || segment.status === 'done') return 'past'
  if (now > departs - 12 * 3600_000) return 'day'
  if (now > departs - 28 * 3600_000) return 'eve'
  return 'future'
}

/* The gap between consecutive legs, judged. walkMinutes, when the airport's
   own walk graph can say, tightens the verdict honestly. */
export function connectionGap(previous: Segment, next: Segment, walkMinutes: number | null = null) {
  const landed = new Date(previous.arrivesAt || previous.departsAt).getTime()
  const leaves = new Date(next.departsAt).getTime()
  const minutes = Math.round((leaves - landed) / 60_000)
  const needed = 15 + (walkMinutes || 0) + (next.mode === 'flight' ? 45 : 5)
  const verdict: 'roomy' | 'tight' | 'short' =
    minutes >= needed * 2 ? 'roomy' : minutes >= needed ? 'tight' : 'short'
  return { minutes, needed, verdict, walkMinutes }
}

const rad = (value: number) => (value * Math.PI) / 180
export function metresBetween(a: [number, number], b: [number, number]) {
  const dLat = rad(b[1] - a[1])
  const dLng = rad(b[0] - a[0])
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h))
}

export interface Traveller {
  name: string
  lng: number
  lat: number
}

/* The make-it meter: each traveller's live position against the departure's
   hardest deadline. Honest arithmetic, stated plainly: walking pace inside
   2.5 km, driving pace beyond it, judged against doors (or boarding when
   doors is unset). Only possible because the app knows where everyone is. */
export function makeIt(segment: Segment, travellers: Traveller[], now: number) {
  if (segment.fromLng == null || segment.fromLat == null) return null
  const deadlines = segment.deadlines || {}
  const hard = deadlines.doorsAt || deadlines.boardingAt || segment.departsAt
  const hardAt = new Date(hard).getTime()
  if (!Number.isFinite(hardAt)) return null
  const minutesLeft = Math.round((hardAt - now) / 60_000)

  const people = travellers.map(person => {
    const metres = metresBetween(
      [person.lng, person.lat],
      [segment.fromLng as number, segment.fromLat as number],
    )
    const minutesAway =
      metres < 120
        ? 0
        : metres <= 2500
          ? Math.ceil(metres / 76) // 4.6 km/h on foot
          : Math.ceil(metres / 583) + 8 // 35 km/h door to door, plus parking
    const spare = minutesLeft - minutesAway
    const state: 'here' | 'ok' | 'tight' | 'late' =
      minutesAway === 0 ? 'here' : spare > 20 ? 'ok' : spare >= 0 ? 'tight' : 'late'
    return { name: person.name, minutesAway, state }
  })

  const worst = people.some(p => p.state === 'late')
    ? 'late'
    : people.some(p => p.state === 'tight')
      ? 'tight'
      : 'ok'
  return {
    minutesLeft,
    hardLabel: deadlines.doorsAt ? 'doors' : 'boarding',
    people,
    verdict: worst,
  }
}

/* Which trip day a segment belongs to, in the airport's own zone when known
   — a red-eye files under the day it departs where it departs. */
export function segmentDay(segment: Segment, startsOn: string | null | undefined): number | null {
  if (!startsOn) return null
  const dayOf = (iso: string, tz?: string | null) => {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: tz || undefined }).format(new Date(iso))
    } catch {
      return new Intl.DateTimeFormat('en-CA').format(new Date(iso))
    }
  }
  const local = dayOf(segment.departsAt, segment.departTz)
  const first = new Date(startsOn + 'T00:00:00')
  const departed = new Date(local + 'T00:00:00')
  const day = Math.round((departed.getTime() - first.getTime()) / 86_400_000) + 1
  return day >= 1 ? day : null
}

export function localTime(iso: string | null | undefined, tz?: string | null) {
  if (!iso) return ''
  try {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: tz || undefined,
    }).format(new Date(iso))
  } catch {
    return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(
      new Date(iso),
    )
  }
}
