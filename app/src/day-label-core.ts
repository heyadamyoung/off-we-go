/* The itinerary's days are labels — 'Fri 4 Sep' — because that is what a
   traveller says and what every chip, card and search string shows. The
   calendar picker speaks ISO. This is the border crossing between the two,
   pure so the mapping is testable without a browser.

   Labels carry no year on purpose — nobody's trip chip says 2026 — so the
   crossing only goes one way. Reading a label back into a date needed the
   trip's own range to supply the year, and that reverse lookup is gone: a
   label is drawn, never stored, never compared and never parsed. */

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Midday avoids date-only values sliding onto a neighbouring local day.
const onDay = (iso: string) => new Date(`${iso}T12:00:00`)

const isoDate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`

/** '2026-09-04' → 'Fri 4 Sep', the label format the whole app already speaks. */
export function dayLabelOf(iso: string): string {
  /* An ISO date or nothing. Callers hand this whatever they hold, and a
     browser will happily read 'Fri 4 Sep' as the fourth of September 2001 —
     which came back out as 'Tue 4 Sep' and got written to a stop. A label in
     is not a date, and guessing a year for it silently moves the stop. */
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso ?? '').slice(0, 10))) return ''
  const date = onDay(iso)
  if (!Number.isFinite(date.getTime())) return ''
  return `${WEEKDAY[date.getDay()]} ${date.getDate()} ${MONTH[date.getMonth()]}`
}

/** Every date of the trip, inclusive, oldest first. Empty without a range. */
export function tripDayIsos(startsOn?: string | null, endsOn?: string | null): string[] {
  if (!startsOn || !endsOn) return []
  const start = onDay(startsOn)
  const end = onDay(endsOn)
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return []
  const days: string[] = []
  // Noon-to-noon steps survive DST's 23- and 25-hour days; two years of trip
  // is the honesty cap — a range wider than that is a typo, not a journey.
  for (let at = start.getTime(); at <= end.getTime() && days.length < 750; at += 86_400_000) {
    days.push(isoDate(new Date(at)))
  }
  return days
}

/** True when a picked date falls outside the trip's declared range. */
export function outsideRange(
  iso?: string | null,
  startsOn?: string | null,
  endsOn?: string | null,
): boolean {
  if (!iso) return false
  // ISO dates order lexicographically; an open end never excludes anything.
  return !!(startsOn && iso < startsOn) || !!(endsOn && iso > endsOn)
}

/**
 * The time of day a stored moment happened, for reading.
 *
 * A photograph's `when` is whatever the thing that made it wrote there. The
 * server writes an ISO timestamp; the bundled sample writes "Today · 10:42",
 * already formatted, which is why nobody noticed for so long that a real trip
 * titled every uncaptioned photograph "2026-09-05T11:00:00.000Z".
 *
 * So: a timestamp becomes a clock, and anything else is handed back as it
 * came. Never used for sorting — the raw value is the sort key, and a
 * formatted one does not order.
 */
export function clockLabel(value: string | null | undefined): string {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  // An ISO moment, which is the only shape worth reformatting.
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(raw)) return raw
  const at = new Date(raw)
  if (!Number.isFinite(at.getTime())) return raw
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
}
