import { isOwnPhoto, photoKey, type PhotoStore } from './offline-photos-core'

/* The papers, kept before anybody asks for them.
 *
 * This is the opposite policy to the photographs next door, and deliberately.
 * A picture is kept because somebody looked at it: downloading a whole trip's
 * worth on the chance would spend a traveller's data guessing at what they
 * might want. A document is kept because nobody has looked at it yet — the
 * entire case is standing at a check-in desk with no signal, needing the one
 * you did not think to open on the aeroplane. A boarding pass that is only
 * cached once you have already opened it is a boarding pass that is not
 * cached.
 *
 * Its own cache, not a corner of the photographs'. That one evicts the oldest
 * two hundred keys as a gallery is scrolled, and scrolling a gallery must
 * never be able to lose somebody their ferry ticket.
 *
 * Documents are served from the same signed media route as photographs, which
 * is why the two checks below are borrowed rather than rewritten: what counts
 * as ours, and what a signed link is a link TO, are the same questions here.
 */

const CACHE_NAME = 'wayfare-papers-v1'
/* A trip's worth of tickets and bookings. Small on purpose: this is not a file
   store, it is the handful of things somebody has to produce at a desk. */
export const MAX_PAPERS = 60
/* Generous next to a photograph's two megabytes. A boarding pass is a hundred
   kilobytes and a hotel confirmation with a map in it can be several, and the
   one time this matters is the one time it must not have been skipped. */
export const MAX_PAPER_BYTES = 8_000_000

export interface Paper {
  id: string
  name?: string
  src: string
}

/* Loose on purpose: a stop's document and a segment's document are the same
   thing to somebody at a desk, and the two types differ only in which fields
   they promise. What matters is a name and somewhere to fetch it from. */
interface LooseDocument {
  id: string
  name?: string
  src?: string | null
}

interface PaperHolder {
  documents?: readonly LooseDocument[] | null
}

/**
 * Every document on a trip, wherever it hangs.
 *
 * A boarding pass is on a flight and a hotel booking is on a stop, and
 * somebody at a desk does not know or care which.
 */
export function papersOf(trip: {
  stops?: readonly PaperHolder[] | null
  segments?: readonly PaperHolder[] | null
}): Paper[] {
  const found = new Map<string, Paper>()
  // Nowhere to fetch it from is not a paper, however it is named.
  for (const holder of [...(trip.stops || []), ...(trip.segments || [])])
    for (const doc of holder?.documents || [])
      if (doc?.src && !found.has(doc.id)) found.set(doc.id, { ...doc, src: doc.src })
  return [...found.values()]
}

async function prune(store: PhotoStore) {
  const held = await store.keys()
  if (held.length <= MAX_PAPERS) return
  for (const stale of held.slice(0, held.length - MAX_PAPERS)) await store.delete(stale.url)
}

/**
 * Keep all of them, and say how many were newly kept.
 *
 * One document behind a dead link must not stop the boarding pass being kept,
 * so each is its own attempt and a failure costs only itself.
 */
export async function keepPapers(
  store: PhotoStore,
  papers: readonly Paper[],
  fetchImpl: typeof fetch,
): Promise<number> {
  let kept = 0
  for (const paper of papers) {
    if (!isOwnPhoto(paper.src)) continue
    const key = photoKey(paper.src)
    try {
      // Already held: no second copy, and no second request for it either.
      if (await store.match(key)) continue
      const response = await fetchImpl(paper.src)
      if (!response.ok) continue
      /* content-length is absent on a chunked or compressed response, and
         Number(null) is 0 — which passes a cap rather than failing it. */
      const bytes = await response.clone().blob()
      if (bytes.size > MAX_PAPER_BYTES) continue
      await store.put(key, response)
      kept += 1
    } catch {
      /* Offline, or a browser that will not keep anything. The document still
         opens when there is signal; we simply have no copy of it. */
    }
  }
  if (kept) await prune(store)
  return kept
}

export async function recallPaper(store: PhotoStore, src: string): Promise<Blob | null> {
  try {
    const held = await store.match(photoKey(src))
    return held ? await held.blob() : null
  } catch {
    return null
  }
}

let opening: Promise<PhotoStore | null> | null = null

/* One cache, opened once. Absent without a secure context and in some
   webviews, in which case the feature is simply not there. */
export function paperStore(): Promise<PhotoStore | null> {
  if (!opening) {
    opening = (async () => {
      try {
        return (await globalThis.caches?.open(CACHE_NAME)) ?? null
      } catch {
        return null
      }
    })()
  }
  return opening
}
