/* Wall-clock times, made into instants.
 *
 * A display feed says "16:26 on the 17th" in the airport's own time and
 * nothing else, because the screens it was written for hang in that airport.
 * Turning that into an instant needs the zone's offset at that moment — which
 * Intl knows for every IANA zone, with no tables of our own to fall behind. */

const parts = new Map()

function formatter(zone) {
  if (!parts.has(zone)) {
    parts.set(
      zone,
      new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        hourCycle: 'h23',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
      }),
    )
  }
  return parts.get(zone)
}

/** Minutes east of UTC for `zone` at the instant `atMs`. */
export function zoneOffsetMinutes(zone, atMs) {
  const read = {}
  for (const part of formatter(zone).formatToParts(new Date(atMs))) {
    if (part.type !== 'literal') read[part.type] = Number(part.value)
  }
  const asUtc = Date.UTC(read.year, read.month - 1, read.day, read.hour, read.minute, read.second)
  return Math.round((asUtc - atMs) / 60_000)
}

/**
 * The instant at which a clock in `zone` reads the given wall time, as ISO.
 * Two passes, because the offset can change between the guess and the answer
 * (a wall time on the day the clocks go forward); null for a time that does
 * not parse.
 */
export function localToIso({ year, month, day, hour = 0, minute = 0 }, zone) {
  const fields = [year, month, day, hour, minute].map(Number)
  if (fields.some(one => !Number.isFinite(one))) return null
  const [y, m, d, h, min] = fields
  const guess = Date.UTC(y, m - 1, d, h, min)
  let offset = zoneOffsetMinutes(zone, guess)
  let instant = guess - offset * 60_000
  const again = zoneOffsetMinutes(zone, instant)
  if (again !== offset) {
    offset = again
    instant = guess - offset * 60_000
  }
  return new Date(instant).toISOString()
}
