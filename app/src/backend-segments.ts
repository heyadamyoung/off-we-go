import { authClient, isSample, tripPath } from './backend-base'
import type { AircraftHeard } from './plane-core'
import { uid } from './sample-trip-core'
import { deriveDeadlines, type Segment, type SegmentDocument } from './segments-core'
import type { Id, StopDocument } from './shared/model/types'

/* ---- travel segments: the getting-there layer ------------------------- */

/* The sample trip's legs are built relative to now, so the public demo's
   travel day is forever tomorrow and the countdowns forever alive.

   Unless the page says it is the travel day itself: then the train has
   just run and the flight leaves in a couple of hours, which is the one
   hour of the demo the ticket's day face exists for, and the only way a
   browser test can look at it without waiting a night. */
function sampleSegments(): Segment[] {
  const today =
    typeof window !== 'undefined' &&
    (window as { __offwegoTravelDay?: boolean }).__offwegoTravelDay === true
  const shift = today ? -22 * 60 - 20 : 0
  const at = (hours: number, minutes = 0) =>
    new Date(Date.now() + (hours * 60 + minutes + shift) * 60_000).toISOString()
  const heard = new Date(Date.now() - 2 * 60_000).toISOString()
  const train: Segment = {
    id: 'sample-segment-train',
    mode: 'train',
    carrier: 'NS Intercity',
    number: 'IC 3155',
    ref: 'NSI-4KQ',
    fromName: 'Amsterdam Centraal',
    toName: 'Schiphol Airport',
    fromLng: 4.9003,
    fromLat: 52.3791,
    toLng: 4.7683,
    toLat: 52.3105,
    departsAt: at(21, 40),
    /* Put back twenty-five minutes, because a demo where nothing ever goes
       wrong is a demo of a different app — and a delay is the one thing the
       Travel screen exists to survive. The whole countdown moved with it; the
       card strikes the old time through beside the new one. */
    departsWas: at(21, 15),
    status: 'delayed',
    arrivesAt: at(22),
    departTz: 'Europe/Amsterdam',
    arriveTz: 'Europe/Amsterdam',
    platform: '14b',
    passengers: [{ name: 'Maya' }, { name: 'Alex' }],
    deadlines: deriveDeadlines('train', at(21, 40)),
    costAmount: 9.6,
    costCurrency: 'EUR',
  }
  const flight: Segment = {
    id: 'sample-segment-flight',
    mode: 'flight',
    carrier: 'KLM',
    number: 'KL 677',
    ref: 'R7QWXZ',
    fromName: 'Amsterdam Schiphol',
    fromCode: 'AMS',
    toName: 'Calgary',
    toCode: 'YYC',
    fromLng: 4.7683,
    fromLat: 52.3105,
    toLng: -114.0134,
    toLat: 51.1215,
    departsAt: at(25, 30),
    arrivesAt: at(34),
    departTz: 'Europe/Amsterdam',
    arriveTz: 'America/Edmonton',
    terminal: '3',
    gate: 'E19',
    passengers: [
      { name: 'Maya', seat: '31A' },
      { name: 'Alex', seat: '31B' },
    ],
    bags: { checked: '1 × 23 kg', carryOn: '1 × 12 kg', personal: true },
    /* Two passes, because a family travels with more than one and the pile is
       the whole point of the Papers screen — a demo carrying a single document
       demonstrates a folder, not a wallet. One of each kind, too: a pass is a
       picture about as often as it is a PDF, and the picture is the one the
       app can draw itself, on white, as a barcode a desk can read. */
    documents: [
      {
        id: 'd-demo-3',
        name: 'Boarding pass — Maya',
        kind: 'pass',
        mime: 'image/svg+xml',
        src: '/demo/boarding-pass.svg',
      },
      {
        id: 'd-demo-4',
        name: 'Boarding pass — Alex',
        kind: 'pass',
        mime: 'application/pdf',
        src: '/demo/boarding-pass.pdf',
      },
    ],
    deadlines: deriveDeadlines('flight', at(25, 30)),
    costAmount: 1284,
    costCurrency: 'EUR',
    status: 'scheduled',
    /* What the airport's board would have written onto the leg: the ticket's
       columns filled in, so the demo shows the day the way a watched trip
       has it rather than as a row of dashes. */
    flight: {
      status: 'scheduled',
      statusText: 'On time',
      boardingStatus: null,
      gate: 'E19',
      terminal: '3',
      scheduledDeparture: at(25, 30),
      estimatedDeparture: at(25, 30),
      scheduledArrival: at(34),
      checkinZone: '3',
      checkinDesks: '13-20',
      walkMinutes: 9,
      securityWaitMinutes: 6,
      sources: ['www.schiphol.nl'],
      lastUpdated: heard,
      fetchedAt: heard,
    },
  }
  return [train, flight]
}

/* ---- what the airport said, and where the aircraft is ------------------ */

export interface FlightTrailEvent {
  id: string
  type: string
  oldValue: string | null
  newValue: string | null
  minutes: number | null
  text: string
  source: string | null
  at: string
}

/** The board's snapshot and its trail of events for a leg, newest first. */
export async function loadSegmentFlight(
  tripId: Id,
  segmentId: string,
): Promise<{ snapshot: unknown; events: FlightTrailEvent[] }> {
  if (isSample(tripId)) {
    if (segmentId !== 'sample-segment-flight') return { snapshot: null, events: [] }
    const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()
    return {
      snapshot: null,
      events: [
        {
          id: 'sample-fe-2',
          type: 'GateChanged',
          oldValue: 'E17',
          newValue: 'E19',
          minutes: null,
          text: 'KL 677 has moved from gate E17 to E19.',
          source: 'www.schiphol.nl',
          at: minutesAgo(48),
        },
        {
          id: 'sample-fe-1',
          type: 'TerminalChanged',
          oldValue: null,
          newValue: '3',
          minutes: null,
          text: 'KL 677 leaves from terminal 3.',
          source: 'www.schiphol.nl',
          at: minutesAgo(190),
        },
      ],
    }
  }
  return authClient.request<{ snapshot: unknown; events: FlightTrailEvent[] }>(
    `${tripPath(tripId)}/segments/${encodeURIComponent(segmentId)}/flight`,
  )
}

/** Where the aircraft is, as the transponder network last heard it. */
export async function loadSegmentPosition(
  tripId: Id,
  segmentId: string,
): Promise<{ callsign: string | null; aircraft: AircraftHeard | null; reason: string | null }> {
  if (isSample(tripId)) return { callsign: null, aircraft: null, reason: 'sample' }
  return authClient.request<{
    callsign: string | null
    aircraft: AircraftHeard | null
    reason: string | null
  }>(`${tripPath(tripId)}/segments/${encodeURIComponent(segmentId)}/position`)
}

export async function loadSegments(tripId: Id): Promise<Segment[]> {
  if (isSample(tripId)) return sampleSegments()
  const result = await authClient.request<{ segments: Segment[] }>(`${tripPath(tripId)}/segments`)
  return result.segments
}

export async function createSegment(tripId: Id, fields: Partial<Segment>): Promise<Segment> {
  if (isSample(tripId)) {
    return {
      id: uid(),
      mode: 'train',
      fromName: '',
      toName: '',
      departsAt: new Date().toISOString(),
      passengers: [],
      status: 'scheduled',
      ...fields,
    } as Segment
  }
  return authClient.request<Segment>(`${tripPath(tripId)}/segments`, {
    method: 'POST',
    body: fields,
  })
}

export async function updateSegment(
  tripId: Id,
  segmentId: string,
  changes: Partial<Segment>,
): Promise<Segment> {
  if (isSample(tripId)) return { ...(changes as Segment), id: segmentId }
  return authClient.request<Segment>(
    `${tripPath(tripId)}/segments/${encodeURIComponent(segmentId)}`,
    { method: 'PATCH', body: changes },
  )
}

export async function deleteSegment(tripId: Id, segmentId: string): Promise<void> {
  if (isSample(tripId)) return
  await authClient.request(`${tripPath(tripId)}/segments/${encodeURIComponent(segmentId)}`, {
    method: 'DELETE',
  })
}

export async function uploadSegmentDocument(
  tripId: Id,
  segmentId: string,
  file: File,
  fields: { name?: string; kind?: string; personId?: string | null } = {},
): Promise<SegmentDocument> {
  if (isSample(tripId)) throw new Error('The sample trip keeps no documents')
  const form = new FormData()
  form.append('file', file)
  if (fields.name) form.append('name', fields.name)
  if (fields.kind) form.append('kind', fields.kind)
  if (fields.personId) form.append('personId', fields.personId)
  return authClient.request<SegmentDocument>(
    `${tripPath(tripId)}/segments/${encodeURIComponent(segmentId)}/documents`,
    { method: 'POST', body: form },
  )
}

export async function deleteSegmentDocument(tripId: Id, documentId: string): Promise<void> {
  if (isSample(tripId)) return
  await authClient.request(
    `${tripPath(tripId)}/segments/documents/${encodeURIComponent(documentId)}`,
    { method: 'DELETE' },
  )
}

export interface DocumentChanges {
  name?: string
  note?: string
  kind?: string
  personId?: string | null
}

export async function updateSegmentDocument(
  tripId: Id,
  documentId: string,
  changes: DocumentChanges,
): Promise<SegmentDocument> {
  if (isSample(tripId)) throw new Error('The sample trip keeps no documents')
  return authClient.request<SegmentDocument>(
    `${tripPath(tripId)}/segments/documents/${encodeURIComponent(documentId)}`,
    { method: 'PATCH', body: changes },
  )
}

/* A stop's paperwork: same rules, same shapes, the other home. */
export async function uploadStopDocument(
  tripId: Id,
  stopId: string,
  file: File,
  fields: { name?: string; kind?: string } = {},
): Promise<StopDocument> {
  if (isSample(tripId)) throw new Error('The sample trip keeps no documents')
  const form = new FormData()
  form.append('file', file)
  if (fields.name) form.append('name', fields.name)
  if (fields.kind) form.append('kind', fields.kind)
  return authClient.request<StopDocument>(
    `${tripPath(tripId)}/stops/${encodeURIComponent(stopId)}/documents`,
    { method: 'POST', body: form },
  )
}

export async function updateStopDocument(
  tripId: Id,
  documentId: string,
  changes: DocumentChanges,
): Promise<StopDocument> {
  if (isSample(tripId)) throw new Error('The sample trip keeps no documents')
  return authClient.request<StopDocument>(
    `${tripPath(tripId)}/stops/documents/${encodeURIComponent(documentId)}`,
    { method: 'PATCH', body: changes },
  )
}

export async function deleteStopDocument(tripId: Id, documentId: string): Promise<void> {
  if (isSample(tripId)) return
  await authClient.request(
    `${tripPath(tripId)}/stops/documents/${encodeURIComponent(documentId)}`,
    {
      method: 'DELETE',
    },
  )
}
