const API = 'https://en.wikipedia.org/w/api.php'

/* The slice of Wikipedia's query envelope this app actually reads. The API
   returns far more; everything else stays unknown on purpose. */
export interface WikiPage {
  pageid: number
  title: string
  description?: string
  coordinates?: Array<{ lat: number; lon: number }>
  pageprops?: { page_image_free?: string }
  extract?: string
  fullurl?: string
  thumbnail?: { source?: string }
  pageimage?: string
  images?: Array<{ title: string }>
  imageinfo?: Array<{ thumburl?: string }>
  pageviews?: Record<string, number | null>
  [key: string]: unknown
}

export interface WikiGeosearchHit {
  pageid: number
  title: string
  lat: number
  lon: number
  dist?: number
}

export interface WikiQueryResponse {
  query?: {
    pages?: Record<string, WikiPage>
    geosearch?: WikiGeosearchHit[]
  }
}

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/* Wikipedia refuses a request with no User-Agent. A browser always sends one;
   Node does not, which is why the seed script has to say who it is. */
let apiHeaders: HeadersInit = {}
export function setApiHeaders(headers: HeadersInit = {}) {
  apiHeaders = headers
}

/* And it refuses too many of them: about two a second, after which it answers
   429 for a while. A single gate here rather than a delay at each call site,
   because the one that forgets is the one that gets everything else refused. */
/* Two a second is what the API tolerates, so that is the default everywhere —
   including the browser fallback, which used to fire a whole viewport's worth
   of cells at once. Nothing complained, because a refused cell is caught and
   dropped: the map just quietly held fewer attractions than it should have. */
let minGap = 450
let lastCall = 0
export function setApiThrottle(ms: number) {
  minGap = ms || 0
}

/* Each call site knows the shape its query produces; the transport does not.
   The generic keeps that knowledge at the caller instead of laundering it
   through `any`. */
async function ask<T = unknown>(params: Record<string, string>, signal?: AbortSignal): Promise<T> {
  const url =
    API + '?' + new URLSearchParams({ action: 'query', format: 'json', origin: '*', ...params })
  for (let attempt = 0; attempt < 4; attempt++) {
    if (minGap) {
      const wait = lastCall + minGap - Date.now()
      if (wait > 0) await pause(wait)
      lastCall = Date.now()
    }
    const res = await fetch(url, { signal, headers: apiHeaders })
    if (res.ok) {
      const text = await res.text()
      if (text.startsWith('{')) return JSON.parse(text) as T
    }
    if (attempt === 3) break
    // Honour Retry-After when it is offered; otherwise back off steeply, since
    // the usual cause is having asked for too much too quickly.
    const after = Number(res.headers.get('retry-after'))
    await pause(Number.isFinite(after) && after > 0 ? after * 1000 : 2000 * (attempt + 1))
  }
  throw new Error('Could not reach Wikipedia')
}

export { API, ask, pause }
