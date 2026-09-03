import { authClient, isSample, tripPath } from './backend-base'
import { asDevice, asFix, liveRetryDelay, type DeviceWire } from './live-positions-core'
import { sampleResult } from './sample-trip-core'
import { createTripStreams } from './trip-stream-core'
import type { Device, Id, LiveFix } from './shared/model/types'

/* The live side of the API: change streams, presence, the phones that report
   positions and the positions they report. */
const tripStreams = createTripStreams({
  open: (path, signal) => authClient.stream(path, signal),
  poll: (tripId, options) => loadLive(tripId, options),
  path: tripPath,
  asFix: value => asFix(value as never),
  retryDelay: liveRetryDelay,
})

export function subscribeToTrip(tripId: Id, onChange: () => void) {
  if (isSample(tripId)) return () => {}
  return tripStreams.watch(String(tripId), { onChange })
}

export async function updateTripPresence(tripId: Id, clientId: string): Promise<Id[]> {
  if (isSample(tripId)) return [sampleResult().me.id].filter(Boolean) as Id[]
  const result = await authClient.request<{ userIds?: Id[] }>(`${tripPath(tripId)}/presence`, {
    method: 'PUT',
    body: { clientId },
  })
  return Array.isArray(result.userIds) ? result.userIds : []
}

export async function leaveTripPresence(tripId: Id, clientId: string): Promise<void> {
  if (isSample(tripId)) return
  await authClient.request(`${tripPath(tripId)}/presence`, {
    method: 'DELETE',
    body: { clientId },
    keepalive: true,
  })
}

export async function listDevices(tripId: Id): Promise<Device[]> {
  if (isSample(tripId)) return []
  const values = await authClient.request<DeviceWire[]>(`${tripPath(tripId)}/devices`)
  return values.map(asDevice)
}
export async function registerDevice(tripId: Id, name: string): Promise<Device> {
  if (isSample(tripId)) throw new Error('Phones require the VPS backend')
  let timezone: string | null = null
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || null
  } catch {}
  return authClient.request(`${tripPath(tripId)}/devices`, {
    method: 'POST',
    body: { name, timezone },
  })
}
export async function removeDevice(tripId: Id, id: Id): Promise<unknown> {
  if (isSample(tripId)) return
  return authClient.request(`${tripPath(tripId)}/devices/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}
/* "Shown once and never again" needed an honest second chance: a new code,
   the old one dead the moment this returns. */
export async function resetDeviceToken(tripId: Id, id: Id): Promise<Device> {
  if (isSample(tripId)) throw new Error('Phones require the VPS backend')
  return authClient.request(`${tripPath(tripId)}/devices/${encodeURIComponent(id)}/token`, {
    method: 'POST',
  })
}
export async function loadLive(
  tripId: Id,
  { hours = 24, cursor = null }: { hours?: number; cursor?: number | null } = {},
) {
  if (isSample(tripId)) return { devices: [], fixes: [], cursor: 0 }
  const query = new URLSearchParams({ hours: String(hours) })
  if (cursor !== null && Number.isInteger(cursor) && cursor >= 0)
    query.set('cursor', String(cursor))
  const result = await authClient.request<{
    devices: DeviceWire[]
    fixes: Array<{ lng: number; lat: number; at: string | Date; [key: string]: unknown }>
    cursor: number
  }>(`${tripPath(tripId)}/live?${query}`)
  return {
    devices: result.devices.map(asDevice),
    fixes: result.fixes.map(asFix),
    cursor: result.cursor,
  }
}
export function subscribeToPositions(
  tripId: Id,
  onFix: (fix: LiveFix) => void,
  initialCursor = 0,
  {
    hours = 24,
    onState,
  }: {
    hours?: number
    onState?: (state: 'ready' | 'error', error?: unknown) => void
  } = {},
) {
  if (isSample(tripId)) return () => {}
  return tripStreams.watch(String(tripId), {
    onFix,
    onState,
    cursor: initialCursor,
    hours,
  })
}
