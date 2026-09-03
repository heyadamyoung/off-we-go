/* When "live" may be believed: how old a fix can be, how long the trail
   reaches back, and whether a quiet phone went quiet on purpose. */

export const LIVE_FIX_MAX_AGE_MS = 5 * 60_000
export const LIVE_HISTORY_MAX_AGE_MS = 30 * 24 * 60 * 60_000
export const LIVE_FIX_MAX_ACCURACY_METRES = 100

export function liveHistoryHours(trip: { startsOn?: string } | null | undefined, now = new Date()) {
  const value = trip?.startsOn
  if (!value) return 30 * 24
  const start = value
    ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value)
    : null
  if (!start || !Number.isFinite(start.getTime())) return 30 * 24
  if (start.getTime() > now.getTime()) return 24
  const inclusiveDays = Math.floor((now.getTime() - start.getTime()) / (24 * 60 * 60_000)) + 1
  return Math.min(30 * 24, Math.max(24, inclusiveDays * 24))
}

export type PausableDevice = { lastSeen?: Date | string | null; pausedAt?: Date | string | null }

const timeOf = (value: Date | string | null | undefined) => {
  const date = value instanceof Date ? value : value ? new Date(value) : null
  return date && Number.isFinite(date.getTime()) ? date.getTime() : null
}

/* Paused means the phone SAID it paused, after the last thing it sent. "She
   turned it off" and "her phone went dark in a tunnel" must never wear the
   same label — one is a decision, the other is the state a parent worries
   about. A phone that has reported again since its pause is not paused, and a
   pause stamped in the future is a clock problem, not a fact. */
export function deliberatePause(devices: PausableDevice[] | undefined, now = new Date()) {
  if (!devices?.length) return false
  const heard = devices.filter(
    device => timeOf(device.lastSeen) != null || timeOf(device.pausedAt) != null,
  )
  if (!heard.length) return false
  const freshest = heard.reduce((a, b) =>
    Math.max(timeOf(a.lastSeen) ?? 0, timeOf(a.pausedAt) ?? 0) >=
    Math.max(timeOf(b.lastSeen) ?? 0, timeOf(b.pausedAt) ?? 0)
      ? a
      : b,
  )
  const pausedAt = timeOf(freshest.pausedAt)
  return (
    pausedAt != null &&
    pausedAt >= (timeOf(freshest.lastSeen) ?? 0) &&
    pausedAt <= now.getTime() + 5 * 60_000
  )
}
