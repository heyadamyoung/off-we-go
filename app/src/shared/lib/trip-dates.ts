const MONTH = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// Midday avoids date-only UTC values landing on the previous local day.
const onDay = (iso?: string) => (iso ? new Date(`${iso}T12:00:00`) : null)

export function formatRange(startsOn?: string, endsOn?: string) {
  const start = onDay(startsOn)
  const end = onDay(endsOn)
  if (!start && !end) return ''
  if (start && !end) return `from ${start.getDate()} ${MONTH[start.getMonth()]}`
  if (!start && end) return `until ${end.getDate()} ${MONTH[end.getMonth()]}`

  const sameYear = start.getFullYear() === end.getFullYear()
  if (sameYear && start.getMonth() === end.getMonth()) {
    return `${start.getDate()} – ${end.getDate()} ${MONTH[end.getMonth()]}`
  }
  if (sameYear) {
    return `${start.getDate()} ${MONTH[start.getMonth()]} – ${end.getDate()} ${MONTH[end.getMonth()]}`
  }
  return `${start.getDate()} ${MONTH[start.getMonth()]} ${start.getFullYear()}` +
    ` – ${end.getDate()} ${MONTH[end.getMonth()]} ${end.getFullYear()}`
}

export function daysBetween(startsOn?: string, endsOn?: string) {
  const start = onDay(startsOn)
  const end = onDay(endsOn)
  if (!start || !end) return null
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1
  return days > 0 ? days : null
}
