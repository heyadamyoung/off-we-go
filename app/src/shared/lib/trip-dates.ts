const MONTH = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/* Midday avoids date-only UTC values landing on the previous local day.

   Null for anything unreadable, not an Invalid Date. Every caller below goes
   straight to getDate() and getMonth(), which on an Invalid Date are NaN and
   undefined — so a value nobody could read printed "NaN September" on the home
   card. Worse than printing it: the new-trip screen stores what this returns
   as the trip's own `dates`, so the nonsense outlived the render. */
const onDay = (iso?: string) => {
  if (!iso) return null
  const at = new Date(`${iso}T12:00:00`)
  return Number.isNaN(at.getTime()) ? null : at
}

/**
 * The words under a trip's name.
 *
 * A side it cannot read is treated as a side that is not there, so a trip with
 * one good date still says what it knows rather than losing both to one typo.
 */
export function formatRange(startsOn?: string, endsOn?: string) {
  const start = onDay(startsOn)
  const end = onDay(endsOn)
  if (!start && !end) return ''
  if (!start) return `until ${end!.getDate()} ${MONTH[end!.getMonth()]}`
  if (!end) return `from ${start.getDate()} ${MONTH[start.getMonth()]}`

  const sameYear = start.getFullYear() === end.getFullYear()
  if (sameYear && start.getMonth() === end.getMonth()) {
    return `${start.getDate()} – ${end.getDate()} ${MONTH[end.getMonth()]}`
  }
  if (sameYear) {
    return `${start.getDate()} ${MONTH[start.getMonth()]} – ${end.getDate()} ${MONTH[end.getMonth()]}`
  }
  return (
    `${start.getDate()} ${MONTH[start.getMonth()]} ${start.getFullYear()}` +
    ` – ${end.getDate()} ${MONTH[end.getMonth()]} ${end.getFullYear()}`
  )
}

export function daysBetween(startsOn?: string, endsOn?: string) {
  const start = onDay(startsOn)
  const end = onDay(endsOn)
  if (!start || !end) return null
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1
  return days > 0 ? days : null
}
