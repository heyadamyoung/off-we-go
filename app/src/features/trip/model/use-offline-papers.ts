import { useEffect, useMemo, useRef } from 'react'
import { keepPapers, paperStore, papersOf } from '../../../offline-papers-core'
import { paperKind } from '../../../paper-kind-core'
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

/* And the thing that draws them, when any of them needs it.
 *
 * pdf.js is loaded on demand, which is right — most sessions never open a PDF
 * and it is the largest thing this app could ship. But "on demand" for a
 * traveller means at a check-in desk with no signal, where a chunk that was
 * never fetched is a ticket that does not open. So the bytes are pulled while
 * there is still a network, exactly as the documents themselves are, and the
 * service worker keeps what the page fetches. Nothing is constructed: this is
 * a download, not a renderer starting up. */
async function keepRenderer() {
  try {
    const worker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker&url')
    await Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'), fetch(worker.default)])
  } catch {
    /* No network, or a browser that will not keep it. The renderer still loads
       the moment somebody opens a document with signal. */
  }
}

/* Not in the first seconds. The renderer is the largest thing the app can
   ship — a megabyte and a half — and pulling it the moment a trip opened
   had it competing with the map and the photographs for the phone's radio
   and its CPU, on every open, for a document nobody was opening yet. It
   waits until the page has been quiet for a while; a trip open for a few
   seconds still has it before anybody reaches a desk. */
const RENDERER_AFTER_MS = 4000
const whenQuiet = () =>
  new Promise<void>(resolve => {
    setTimeout(() => {
      const idle = (globalThis as { requestIdleCallback?: (fn: () => void) => void })
        .requestIdleCallback
      if (idle) idle(() => resolve())
      else resolve()
    }, RENDERER_AFTER_MS)
  })
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
      if (!papers.some(paper => paperKind(paper.mime, paper.name) === 'pdf')) return
      await whenQuiet()
      if (alive) await keepRenderer()
    })()
    return () => {
      alive = false
    }
  }, [mark, papers])
}
