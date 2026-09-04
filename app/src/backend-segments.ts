import { authClient, isSample, tripPath } from './backend-base'
import { uid } from './sample-trip-core'
import { deriveDeadlines, type Segment, type SegmentDocument } from './segments-core'
import type { Id, StopDocument } from './shared/model/types'

/* ---- travel segments: the getting-there layer ------------------------- */

/* The sample trip's legs are built relative to now, so the public demo's
   travel day is forever tomorrow and the countdowns forever alive. */
function sampleSegments(): Segment[] {
  const at = (hours: number, minutes = 0) =>
    new Date(Date.now() + (hours * 60 + minutes) * 60_000).toISOString()
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
    arrivesAt: at(22),
    departTz: 'Europe/Amsterdam',
    arriveTz: 'Europe/Amsterdam',
    platform: '14b',
    passengers: [{ name: 'Maya' }, { name: 'Alex' }],
    deadlines: deriveDeadlines('train', at(21, 40)),
    costAmount: 9.6,
    costCurrency: 'EUR',
    status: 'scheduled',
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
    deadlines: deriveDeadlines('flight', at(25, 30)),
    costAmount: 1284,
    costCurrency: 'EUR',
    status: 'scheduled',
  }
  return [train, flight]
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
