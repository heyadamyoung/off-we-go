import { useCallback, useEffect, useMemo, useRef } from 'react'
import { ALL_DAYS } from '../../../trip-search-core'
import { tripItems, type TripItem } from './trip-items'
import type { MapView, Stop, TripPhoto } from '../../../shared/model/types'
import type { DayRange } from '../../../trip-days-core'

/* The strip, the timeline and the map all select from one list. This owns that
   list, which item is chosen, and what choosing does — including the rule that
   choosing a photograph means the viewer, full stop. */
export default function useTripSelection({
  liveStops,
  photos,
  day,
  query,
  selected,
  patch,
  setFollowing,
  setMapView,
  viewRef,
  openViewer,
  range,
}: {
  liveStops: Stop[]
  photos: TripPhoto[]
  day: string
  query: string
  selected?: string
  patch: (changes: Record<string, unknown>) => void
  setFollowing: (value: boolean) => void
  setMapView: (view: MapView) => void
  viewRef: { current: MapView }
  openViewer: (list: TripPhoto[], index: number) => void
  /** What gives a stored label its year and a bare number its month. */
  range?: DayRange
}) {
  const items = useMemo(
    () => tripItems({ stops: liveStops, photos, day, range, query }),
    [liveStops, photos, day, range, query],
  )
  /* The list the viewer should page through, put here by whoever opened it.
     Without this the viewer always paged through the bottom strip — so a
     photograph opened from the gallery was followed by whatever came next in
     a DIFFERENT order, filtered to a single day, and often by nothing at all
     because the strip did not contain it. You page through the list you were
     looking at. */
  const within = useRef<TripPhoto[] | null>(null)

  const selectedItem = useMemo(
    () =>
      items.find(item => item.id === selected) ||
      tripItems({ stops: liveStops, photos, day: ALL_DAYS, range }).find(
        item => item.id === selected,
      ),
    [items, liveStops, photos, selected, range],
  )

  /* Clicking a photograph anywhere — strip, panel, timeline — brings up the
     viewer, full stop. The strip's order is the viewer's order, so the arrows
     page through the same day. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs only when the selection changes; the viewer must not reopen because the photo list refreshed under it
  useEffect(() => {
    if (selectedItem?.kind !== 'photo' || !selectedItem.photo) return
    const opened = within.current
    within.current = null
    const strip = opened?.some(photo => photo.id === selectedItem.photo!.id)
      ? opened
      : items.filter(item => item.kind === 'photo' && item.photo).map(item => item.photo!)
    const at = strip.findIndex(photo => photo.id === selectedItem.photo!.id)
    openViewer(at >= 0 ? strip : [selectedItem.photo], Math.max(at, 0))
  }, [selected])

  const select = useCallback(
    (item: TripItem, ordered?: TripPhoto[]) => {
      within.current = ordered ?? null
      setFollowing(false)
      const target = item.stop
      if (item.kind === 'photo' && item.photo?.lng != null && item.photo?.lat != null) {
        setMapView({
          center: [item.photo.lng, item.photo.lat],
          zoom: Math.max(viewRef.current.zoom, 15),
          ms: 520,
          focus: true,
        })
      } else if (target) {
        setMapView({
          center: [target.lng, target.lat],
          zoom: Math.max(viewRef.current.zoom, 15),
          ms: 520,
          focus: true,
        })
      }
      patch({
        sel: item.id,
        ...(day !== ALL_DAYS && item.day && item.day !== day ? { day: item.day } : {}),
      })
    },
    [patch, day, setFollowing, setMapView, viewRef],
  )

  return { items, selectedItem, select }
}
