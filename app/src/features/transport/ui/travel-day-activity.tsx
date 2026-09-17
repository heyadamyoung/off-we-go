import { useMemo } from 'react'
import type { Segment } from '../../../segments-core'
import type { LiveFix } from '../../../shared/model/types'
import useLiveActivity from '../model/use-live-activity'

/* Draws nothing. It is here so the Lock Screen card has the same view of the
   day the make-it meter has — the legs, everyone's fresh position, the clock —
   without the page having to know a Lock Screen exists. */
export default function TravelDayActivity({
  segments,
  markers,
  fixes,
  now,
}: {
  segments: readonly Segment[]
  markers: ReadonlyArray<{ name: string; lng: number; lat: number; stale?: boolean }>
  fixes: readonly LiveFix[]
  now: number
}) {
  const travellers = useMemo(
    () =>
      markers
        .filter(marker => !marker.stale)
        .map(marker => ({ name: marker.name, lng: marker.lng, lat: marker.lat })),
    [markers],
  )
  useLiveActivity({ segments, travellers, fixes, now })
  return null
}
