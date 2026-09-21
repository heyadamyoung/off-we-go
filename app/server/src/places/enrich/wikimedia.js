/**
 * Fetching from Wikimedia and OpenStreetMap, politely.
 *
 * These are donation-funded volunteer services and we are about to ask them
 * several million questions. Everything here exists to make that acceptable:
 *
 *   a real User-Agent   Wikimedia's policy requires one that identifies the
 *                       application and gives a way to reach its operator.
 *                       They block on this, and they are right to.
 *   one at a time       per host, with a gap. A pipeline that opened fifty
 *                       connections would be indistinguishable from an
 *                       attack and would be treated as one.
 *   batched             `wbgetentities` takes fifty Q-ids in one request and
 *                       `imageinfo` takes fifty titles. Fifty round trips
 *                       become one, which is fifty times less of their
 *                       bandwidth as well as ours.
 *   it stops            429 and 503 are answered by waiting, not by trying
 *                       harder. Retry-After is honoured when sent.
 *
 * None of this is in the runtime path. Everything fetched here is written to
 * our own database and served from there — the standing rule for this layer
 * is that no third-party service sits between a traveller and their map.
 */

const WIKIDATA = 'https://www.wikidata.org/w/api.php'
const COMMONS = 'https://commons.wikimedia.org/w/api.php'
const WIKIPEDIA = language => `https://${language}.wikipedia.org/api/rest_v1/page/summary`
const WIKIPEDIA_API = language => `https://${language}.wikipedia.org/w/api.php`

/** How far around a place to look for an article about it. Wider than the
    200-metre gate identity.js applies: the search only has to not miss the
    candidate, the gate decides. */
export const NEAR_METRES = 300
/** More than this and the matcher is choosing between duplicates anyway. */
export const MOST_NEARBY = 20

/** Most ids one `wbgetentities` or `imageinfo` call may carry. */
export const BATCH = 50
/** The least time between two requests to the same host. */
export const GAP_MS = 250
/** How long we wait when asked to, at most. */
export const MOST_BACKOFF_MS = 60_000

/** A queue per host, so requests to one never overtake each other. */
function politely({ gapMs = GAP_MS, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  const lastAt = new Map()
  const queues = new Map()
  return async function inTurn(host, work) {
    const before = queues.get(host) ?? Promise.resolve()
    const mine = before.then(async () => {
      const since = Date.now() - (lastAt.get(host) ?? 0)
      if (since < gapMs) await sleep(gapMs - since)
      try {
        return await work()
      } finally {
        lastAt.set(host, Date.now())
      }
    })
    /* The queue is the promise chain; a failure must not break the chain for
       everything behind it. */
    queues.set(
      host,
      mine.then(
        () => {},
        () => {},
      ),
    )
    return mine
  }
}

/**
 * @param {{userAgent: string, fetch?: Function, log?: Function}} options
 *   userAgent must identify the application and a way to reach us —
 *   Wikimedia's policy, and they enforce it.
 */
export function createWikimedia({
  userAgent,
  fetch: fetchImpl = globalThis.fetch,
  log = () => {},
  gapMs = GAP_MS,
  sleep = ms => new Promise(r => setTimeout(r, ms)),
  tries = 4,
} = {}) {
  if (!userAgent || !/\S+@\S+|https?:\/\//.test(userAgent)) {
    throw new Error(
      'places: the Wikimedia user agent must name the application and a way to reach its operator',
    )
  }
  const inTurn = politely({ gapMs, sleep })

  async function ask(url, { signal } = {}) {
    const host = new URL(url).host
    return inTurn(host, async () => {
      let wait = 1000
      for (let attempt = 1; ; attempt += 1) {
        const response = await fetchImpl(url, {
          signal,
          headers: { 'user-agent': userAgent, accept: 'application/json' },
        })
        if (response.ok) return await response.json()
        /* 404 from the summary endpoint means there is no such article,
           which is an answer rather than a failure. */
        if (response.status === 404) return null
        const retryable = response.status === 429 || response.status >= 500
        if (!retryable || attempt >= tries) {
          throw new Error(`places: ${host} answered ${response.status}`)
        }
        const askedFor = Number(response.headers?.get?.('retry-after')) * 1000
        const pause = Math.min(
          Number.isFinite(askedFor) && askedFor > 0 ? askedFor : wait,
          MOST_BACKOFF_MS,
        )
        log(`places: ${host} said ${response.status}; waiting ${Math.round(pause / 1000)}s`)
        await sleep(pause)
        wait = Math.min(wait * 2, MOST_BACKOFF_MS)
      }
    })
  }

  return {
    /**
     * The articles written about somewhere near a point.
     *
     * This is the whole of the identification step, and it used to be three
     * hops: find the OpenStreetMap object at these coordinates, read its
     * `wikidata` tag, then ask Wikidata which article that is. OSM knew
     * nothing about the place we did not already know — not its name, not
     * its category, not where it is. It was a lookup table from a position
     * to a Q-id, and it cost a planet extract, a second spatial index, a
     * loader, and a fallback to a volunteer API for everything the extract
     * did not have. Which, until somebody loaded one, was everywhere.
     *
     * An article is what we are actually looking for. It carries the
     * sentences, the lead image, and its own Wikidata id — so asking for it
     * directly is one hop, no extract, and nothing to keep in step.
     *
     * `list=geosearch` is the MediaWiki Action API, CDN-fronted and built for
     * exactly this. Not the endpoint that got the old per-device Wikipedia
     * walk rate-limited: that was every phone asking for a hundred and fifty
     * circles of its own. This is one server asking once per place, six every
     * thirty seconds, and writing the answer into our database for good.
     */
    async near({ lat, lng, radius = NEAR_METRES, lang = 'en' } = {}, options = {}) {
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
      const url = `${WIKIPEDIA_API(lang)}?${new URLSearchParams({
        action: 'query',
        list: 'geosearch',
        gscoord: `${lat}|${lng}`,
        gsradius: String(Math.round(radius)),
        gslimit: String(MOST_NEARBY),
        format: 'json',
        formatversion: '2',
      })}`
      return await ask(url, options)
    },

    /** One Wikidata entity, or several — `wbgetentities` takes up to fifty. */
    async entity(id, options = {}) {
      const ids = Array.isArray(id) ? id : [id]
      if (!ids.length) return null
      const url = `${WIKIDATA}?${new URLSearchParams({
        action: 'wbgetentities',
        ids: ids.slice(0, BATCH).join('|'),
        props: 'claims|sitelinks|labels|descriptions',
        languages: 'en',
        format: 'json',
        formatversion: '2',
      })}`
      const body = await ask(url, options)
      const entities = body?.entities ?? {}
      return Array.isArray(id) ? entities : (entities[ids[0]] ?? null)
    },

    /** The lead paragraph of one article. */
    async summary({ lang, title }, options = {}) {
      if (!title) return null
      return await ask(`${WIKIPEDIA(lang || 'en')}/${encodeURIComponent(title)}`, options)
    },

    /**
     * Files, by name and/or every file in a category.
     *
     * `generator=categorymembers` walks the category and `prop=imageinfo`
     * describes each file, in one request rather than one per file.
     */
    async files({ files = [], category = null }, options = {}) {
      const common = {
        action: 'query',
        prop: 'imageinfo',
        iiprop: 'url|size|mime|extmetadata',
        iiurlwidth: '1280',
        format: 'json',
        formatversion: '2',
      }
      if (files.length) {
        const named = await ask(
          `${COMMONS}?${new URLSearchParams({ ...common, titles: files.slice(0, BATCH).join('|') })}`,
          options,
        )
        const found = named?.query?.pages ?? []
        const usable = (Array.isArray(found) ? found : Object.values(found)).filter(
          page => page?.imageinfo?.length,
        )
        /* A named file is the one the item itself chose, so if it is usable
           there is no need to walk a whole category. */
        if (usable.length && !category) return named
        if (usable.length && category) {
          const walked = await this.files({ category }, options)
          const more = walked?.query?.pages ?? []
          return {
            query: { pages: [...usable, ...(Array.isArray(more) ? more : Object.values(more))] },
          }
        }
      }
      if (!category) return { query: { pages: [] } }
      return await ask(
        `${COMMONS}?${new URLSearchParams({
          ...common,
          generator: 'categorymembers',
          gcmtitle: category,
          gcmtype: 'file',
          gcmlimit: String(BATCH),
        })}`,
        options,
      )
    },
  }
}
