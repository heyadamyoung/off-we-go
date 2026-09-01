import { agoLabel } from './shared/lib/geo'
import type { Device, LiveFix, Person } from './shared/model/types'

export interface PhoneMarker {
  key: string
  lng: number
  lat: number
  avatar: string | null
  name: string
  stale: boolean
  title: string
}

const keyOf = (fix: LiveFix) => String(fix.deviceId || 'phone')

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

export function livePhoneMarkers(
  { fixes, fresh, phones, family }:
  { fixes: LiveFix[]; fresh: LiveFix[]; phones: Device[]; family: Person[] },
): PhoneMarker[] {
  const live = new Set((fresh || []).map(keyOf))

  return lastKnownFixes(fixes).map(fix => {
    const phone = (phones || []).find(device => device.id === fix.deviceId)
    const who = phone && (family || []).find(person => person.id === phone.userId)
    const name = who?.name || phone?.name || 'Phone'
    const stale = !live.has(keyOf(fix))
    return {
      key: keyOf(fix),
      lng: fix.lng,
      lat: fix.lat,
      avatar: who?.avatar || null,
      name,
      stale,
      title: `${name} · ${stale ? `last seen ${agoLabel(fix.at)}` : agoLabel(fix.at)}`,
    }
  })
}
