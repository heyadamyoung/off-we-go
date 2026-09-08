/* Signed media links do not last for ever, and a trip left open outlasts
   them. The payload carrying them is fetched once and only refetched when
   somebody edits, so on a quiet trip every photograph's link ages out
   together and the grid turns grey — the failure people described as "photos
   just don't load sometimes".

   The bytes never went anywhere and the reader is still allowed to see them,
   so a dead link is a question, not an answer: hand the path back and ask for
   a fresh one. Batched, because a screen full of photographs discovers the
   expiry all at once and thirty requests to say the same thing is a stampede
   against a server that is already the reason nothing drew. */

/** The storage path inside one of our signed links, or null if it is not one. */
export function mediaPathOf(url: string): string | null {
  if (!url || url.startsWith('blob:') || url.startsWith('data:')) return null
  try {
    const path = new URL(url, 'https://offwego.invalid').pathname
    const at = path.indexOf('/api/media/')
    if (at < 0) return null
    return decodeURIComponent(path.slice(at + '/api/media/'.length)) || null
  } catch {
    return null
  }
}

type FetchLinks = (paths: string[]) => Promise<Record<string, string>>

interface RefresherOptions {
  fetchLinks: FetchLinks
  /* Injected so a test can drive the batching without waiting on a timer. The
     default gathers everything one render's worth of broken tiles produces. */
  schedule?: (flush: () => void) => void
  /** A path refused once is refused for good; asking again is a loop. */
  rememberRefusals?: boolean
}

export interface MediaRefresher {
  /** A fresh link for a URL that would not load, or null if there is none. */
  refresh(url: string): Promise<string | null>
  /** For tests: how many round trips it has made. */
  readonly calls: number
}

export function createMediaRefresher({
  fetchLinks,
  schedule = flush => setTimeout(flush, 40),
  rememberRefusals = true,
}: RefresherOptions): MediaRefresher {
  let waiting = new Map<string, Array<(link: string | null) => void>>()
  let scheduled = false
  let calls = 0
  const refused = new Set<string>()

  const flush = () => {
    scheduled = false
    const batch = waiting
    waiting = new Map()
    if (!batch.size) return
    const paths = [...batch.keys()]
    calls++
    /* One failure fails the batch, not the app: every waiter is told there is
       no fresh link and the tile keeps whatever it was showing. */
    Promise.resolve(fetchLinks(paths))
      .then(links => {
        for (const [path, waiters] of batch) {
          const link = links?.[path] || null
          if (!link && rememberRefusals) refused.add(path)
          for (const settle of waiters) settle(link)
        }
      })
      .catch(() => {
        for (const waiters of batch.values()) for (const settle of waiters) settle(null)
      })
  }

  return {
    get calls() {
      return calls
    },
    refresh(url: string) {
      const path = mediaPathOf(url)
      if (!path || refused.has(path)) return Promise.resolve(null)
      return new Promise<string | null>(resolve => {
        const waiters = waiting.get(path)
        if (waiters) waiters.push(resolve)
        else waiting.set(path, [resolve])
        if (!scheduled) {
          scheduled = true
          schedule(flush)
        }
      })
    },
  }
}
