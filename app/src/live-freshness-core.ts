/* When "live" may be believed: how old a fix can be, how long the trail
   reaches back, and whether a quiet phone went quiet on purpose. */

/* Fifteen minutes, not five: a phone doing honest background reporting sends
   a fix every five to fifteen minutes, so a five-minute window declared the
   marker quiet between almost every pair of real updates — a traveller who
   never looked live while genuinely walking. Fifteen keeps the LIVE badge on
   through a normal reporting cadence and still goes quiet within one missed
   cycle of a phone that has actually stopped. */
export const LIVE_FIX_MAX_AGE_MS = 15 * 60_000
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
/* A phone that stopped sharing without saying so. The night this was built,
   a TestFlight auto-update killed both phones' background watchers mid-drive
   — iOS revives them only when the app is next opened — and the map simply
   went stale with no explanation. The remedy is information: name the quiet
   phone and say what reopens it, so the family polices itself. A deliberate
   pause is excluded — "she turned it off" is not "her update ate it". */
export const QUIET_PHONE_MS = 30 * 60_000

export function quietPhones(
  devices:
    | Array<{
        id: string
        name?: string | null
        lastSeen?: Date | string | null
        pausedAt?: Date | string | null
      }>
    | undefined,
  now = new Date(),
) {
  return (devices || [])
    .filter(device => device.lastSeen && !device.pausedAt)
    .map(device => ({
      id: device.id,
      name: device.name || 'A phone',
      minutesQuiet: Math.floor(
        (now.getTime() - new Date(device.lastSeen as Date | string).getTime()) / 60_000,
      ),
    }))
    .filter(device => device.minutesQuiet >= QUIET_PHONE_MS / 60_000)
    .sort((a, b) => b.minutesQuiet - a.minutesQuiet)
}

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
