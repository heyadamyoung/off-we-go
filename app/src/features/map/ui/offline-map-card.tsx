import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from '../../../shared/ui/icon'
import { forgetOfflineTiles, offlineTileCount } from '../../../offline-tiles-core'
import { saveTripMap } from '../model/save-region'
import type { Coordinates, Toast } from '../../../shared/model/types'

const REFUSALS: Record<string, string> = {
  'nothing-to-save': 'Add a stop first — there is no map to save yet.',
  'too-wide': 'This trip covers too much ground to save in one go.',
  'no-basemap': 'The map could not be reached. Try again when you are online.',
}

interface OfflineMapCardProps {
  points: Coordinates[]
  toast: Toast
}

/* The map, before the aeroplane. The rest of the trip already keeps itself on
   the device as you read it; this is the part you cannot read in advance,
   because nobody pans across their whole itinerary before they fly. */
export default function OfflineMapCard({ points, toast }: OfflineMapCardProps) {
  const [held, setHeld] = useState<number | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const stop = useRef<AbortController | null>(null)

  const count = useCallback(() => {
    offlineTileCount()
      .then(setHeld)
      .catch(() => setHeld(0))
  }, [])
  useEffect(() => {
    count()
    return () => stop.current?.abort()
  }, [count])

  const save = async () => {
    const controller = new AbortController()
    stop.current = controller
    setProgress({ done: 0, total: 0 })
    try {
      const result = await saveTripMap({
        points,
        signal: controller.signal,
        onProgress: setProgress,
      })
      if (!result.ok) toast(REFUSALS[result.reason] || 'The map could not be saved.', 'error')
      else if (!controller.signal.aborted) toast('This trip’s map is on your device')
    } finally {
      stop.current = null
      setProgress(null)
      count()
    }
  }

  const remove = async () => {
    await forgetOfflineTiles()
    count()
    toast('Saved map removed')
  }

  const busy = progress !== null
  const pct = busy && progress.total ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-raised p-3">
      <div className="flex items-center gap-2">
        <Icon n="map" s={15} />
        <b className="text-sm">Use this map without a signal</b>
      </div>
      <p className="m-0 text-xs leading-relaxed text-muted">
        Saves the streets around this trip onto this device, so the map still draws with the data
        off. Your stops, notes and photographs are already kept as you read them.
      </p>
      {busy ? (
        <div className="flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-raised2">
            <div
              className="h-full rounded-full bg-accent transition-[width]"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-[11px] tabular-nums text-muted">
            {progress.total ? `${pct}%` : 'Working out the area…'}
          </span>
          <button
            className="text-xs font-semibold text-muted hover:text-ink"
            onClick={() => stop.current?.abort()}>
            Stop
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button
            className="h-9 rounded-lg bg-accent px-3 text-xs font-bold text-accent-ink"
            onClick={save}>
            Save this trip’s map
          </button>
          {!!held && (
            <button
              className="h-9 rounded-lg border border-line px-3 text-xs font-semibold text-muted hover:text-ink"
              onClick={remove}>
              Remove ({held} tiles)
            </button>
          )}
        </div>
      )}
    </div>
  )
}
