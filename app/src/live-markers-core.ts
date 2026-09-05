import { agoLabel } from './shared/lib/geo'
import type { Coordinates, Device, LiveFix, Person } from './shared/model/types'

export interface PhoneMarker {
  key: string
  lng: number
  lat: number
  avatar: string | null
  name: string
  stale: boolean
  title: string
  /** Degrees clockwise from north while plainly walking; null standing still. */
  course: number | null
}

const keyOf = (fix: LiveFix) => String(fix.deviceId || 'phone')

/* GPS course is only meaningful in motion: a phone lying on a café table
   reports a heading that swings with every reflection. Below walking pace the
   marker shows no direction at all — an honest nothing beats a spinning lie. */
export const COURSE_MIN_SPEED_MS = 0.5

export function courseOf(fix: LiveFix, stale: boolean): number | null {
  if (stale) return null
  const heading = fix.heading
  if (typeof heading !== 'number' || !Number.isFinite(heading)) return null
  if (!((fix.speed ?? 0) >= COURSE_MIN_SPEED_MS)) return null
  return ((heading % 360) + 360) % 360
}

/* Which fixes count as "this phone is talking right now": recency ALONE.
   The accuracy gate belongs to the arrival math (a 300-metre fix must not
   trigger "arrived" inside a 125-metre radius) and was once reused here —
   which turned a phone driving with cradle-grade accuracy into a gliding
   dot whose LIVE chip never lit. A moving car is alive at any accuracy. */
export function aliveFixes(fixes: LiveFix[], now: number, maxAgeMs: number): LiveFix[] {
  return (fixes || []).filter(fix => fix.at instanceof Date && now - fix.at.getTime() <= maxAgeMs)
}

/* Where each phone was last heard from, however long ago that was. A phone
   that stops reporting has not stopped existing — it has run out of signal, or
   battery, or someone has turned sharing off — so its dot stays where it was
   last seen rather than vanishing and leaving the rest of the trip unable to
   tell "somewhere near here an hour ago" from "no idea at all". */
export function lastKnownFixes(fixes: LiveFix[]): LiveFix[] {
  const byDevice = new Map<string, LiveFix>()
  for (const fix of fixes || []) {
    if (!Number.isFinite(fix?.lng) || !Number.isFinite(fix?.lat)) continue
    if (!(fix.at instanceof Date) || !Number.isFinite(fix.at.getTime())) continue
    const seen = byDevice.get(keyOf(fix))
    if (!seen || fix.at.getTime() > seen.at.getTime()) byDevice.set(keyOf(fix), fix)
  }
  return [...byDevice.values()]
}

export function livePhoneMarkers({
  fixes,
  fresh,
  phones,
  family,
}: {
  fixes: LiveFix[]
  fresh: LiveFix[]
  phones: Device[]
  family: Person[]
}): PhoneMarker[] {
  const live = new Set((fresh || []).map(keyOf))

  return lastKnownFixes(fixes).map(fix => {
    const phone = (phones || []).find(device => device.id === fix.deviceId)
    const who = phone && (family || []).find(person => person.id === phone.userId)
    const name = who?.name || phone?.name || 'Phone'
    const stale = !live.has(keyOf(fix))
    /* A reported pause is named as one; mere silence never is. */
    const pausedAt = phone?.pausedAt ? new Date(phone.pausedAt) : null
    const paused =
      stale &&
      pausedAt != null &&
      Number.isFinite(pausedAt.getTime()) &&
      pausedAt.getTime() >= fix.at.getTime()
    return {
      key: keyOf(fix),
      lng: fix.lng,
      lat: fix.lat,
      avatar: who?.avatar || null,
      name,
      stale,
      course: courseOf(fix, stale),
      title: `${name} · ${
        paused
          ? `paused sharing · last seen ${agoLabel(fix.at)}`
          : stale
            ? `last seen ${agoLabel(fix.at)}`
            : agoLabel(fix.at)
      }`,
    }
  })
}

/* Where to point the camera when someone asks to follow. Everyone reporting
   gets framed together; with nobody reporting it is the single most recent
   position, not the box around every phone's last known one — those can be
   continents apart, and the middle of Regina and Amsterdam is the Atlantic. */
export function followPoints(fresh: LiveFix[], fixes: LiveFix[]): Coordinates[] {
  if (fresh?.length) return fresh.map(fix => [fix.lng, fix.lat] as Coordinates)

  const [newest] = lastKnownFixes(fixes).sort((a, b) => b.at.getTime() - a.at.getTime())
  return newest ? [[newest.lng, newest.lat]] : []
}
