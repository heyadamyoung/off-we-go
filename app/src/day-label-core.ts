/* The itinerary's days are labels — 'Fri 4 Sep' — because that is what a
   traveller says and what every chip, card and search string shows. The
   calendar picker speaks ISO. This is the border crossing between the two,
   pure so the mapping is testable without a browser.

   Labels carry no year on purpose (nobody's trip chip says 2026), which makes
   them meaningful only against the trip's own date range: the same label
   inside the range names exactly one date. */

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

/** The one date inside the trip that wears this label, or null. */
export function isoOfDayLabel(
  label?: string | null,
  startsOn?: string | null,
  endsOn?: string | null,
): string | null {
  const wanted = (label || '').trim()
  if (!wanted) return null
  return tripDayIsos(startsOn, endsOn).find(iso => dayLabelOf(iso) === wanted) ?? null
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
