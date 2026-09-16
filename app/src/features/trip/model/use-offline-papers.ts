import { useEffect, useMemo, useRef } from 'react'
import { keepPapers, paperStore, papersOf } from '../../../offline-papers-core'
import type { Segment } from '../../../segments-core'
import type { Stop } from '../../../shared/model/types'

/* Taking the papers with you.
 *
 * Eagerly, the moment a trip is open and there is signal to do it with — which
 * is the opposite of how the photographs are kept, and the whole point. A
 * picture is cached because somebody looked at it. A document is cached
 * because nobody has: the case this exists for is a check-in desk with no
 * signal and the one ticket you did not think to open on the way there.
 *
 * Once a trip, not once a render. A boarding pass does not change, and asking
 * the server for the same handful of files every time a position arrives would
 * spend somebody's data on an answer we already have.
 */
export default function useOfflinePapers({
  tripId,
  stops,
  segments,
}: {
  tripId: string
  stops: Stop[]
  segments: Segment[]
}) {
  /* Keyed by what there is to keep rather than by the trip alone: a document
     added while the app is open is a document somebody wants on their phone,
     and waiting for the next launch to fetch it would be the wrong answer at
     exactly the wrong moment. */
  const papers = useMemo(() => papersOf({ stops, segments }), [stops, segments])
  const mark = `${tripId}:${papers.map(paper => paper.id).join(',')}`
  const done = useRef('')

  useEffect(() => {
    if (!papers.length || done.current === mark) return
    done.current = mark
    let alive = true
    void (async () => {
      const store = await paperStore()
      if (!store || !alive) return
      await keepPapers(store, papers, (...args) => fetch(...args))
    })()
    return () => {
      alive = false
    }
  }, [mark, papers])
}
