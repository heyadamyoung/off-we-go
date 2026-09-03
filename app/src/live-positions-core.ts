import type { Device, Id, LiveFix } from './shared/model/types'

const timeOf = (value: Date | string | number) =>
  value instanceof Date ? value.getTime() : new Date(value).getTime()

/* What the wire carries: devices and fixes whose timestamps are still ISO
   strings. Turning them into Dates happens here, once, for every caller. */
export interface DeviceWire {
  id: Id
  name: string
  token?: string
  lastSeen?: string | Date | null
  pausedAt?: string | Date | null
  [key: string]: unknown
}

export const asDevice = (value: DeviceWire): Device => ({
  ...value,
  lastSeen: value.lastSeen ? new Date(value.lastSeen) : null,
  pausedAt: value.pausedAt ? new Date(value.pausedAt) : null,
})

export const asFix = (value: {
  lng: number
  lat: number
  at: string | Date
  [key: string]: unknown
}): LiveFix => ({ ...value, at: new Date(value.at) })

export function liveRetryDelay(failures: number) {
  return Math.min(30_000, 1_000 * 2 ** Math.max(0, Math.min(30, failures)))
}

export function mergeLiveFixes(
  current: LiveFix[],
  incoming: LiveFix[],
  maxPerDevice = 100_000,
): LiveFix[] {
  const byDevice = new Map<string, Map<number, LiveFix>>()
  for (const fix of [...current, ...incoming]) {
    if (!fix?.deviceId || !Number.isFinite(timeOf(fix.at))) continue
    if (!byDevice.has(fix.deviceId)) byDevice.set(fix.deviceId, new Map())
    byDevice.get(fix.deviceId)!.set(timeOf(fix.at), fix)
  }
  return [...byDevice.values()]
    .flatMap(values =>
      [...values.values()].sort((a, b) => timeOf(a.at) - timeOf(b.at)).slice(-maxPerDevice),
    )
    .sort((a, b) => timeOf(a.at) - timeOf(b.at))
}
