/**
 * The drain that gives places their pictures.
 *
 * Two tiers through one queue, which is the whole point of having a priority
 * column rather than two queues:
 *
 *   the backfill    places that earn a low label_zoom — the ones somebody
 *                   sees without looking for them. There are few enough to
 *                   fetch ahead of being asked: 1,409 in the Paris degree at
 *                   zoom 11, 12,498 at 13 or better. Topped up a few hundred
 *                   at a time so the table is never scanned in one go.
 *   on demand       somebody opened a card for a place nobody had asked
 *                   about. Queued at priority 0, which jumps everything, so
 *                   the card fills while they are still looking at it.
 *
 * A person always beats a batch, and one queue means a place the backfill had
 * merely queued is promoted rather than done twice.
 *
 * Rate is the constraint, not compute. Wikimedia is donation-funded and we
 * are asking it millions of questions; `wikimedia.js` keeps one request in
 * flight per host with a gap, so `PLACES_PER_TICK` is really a statement
 * about how much of their afternoon we are willing to take.
 */

import { event } from '../../tracing.js'
import { enrichPlace, ENRICH_PIPELINE } from './enrich.js'
import {
  claimEnrichment,
  enqueueProminent,
  failEnrichment,
  writeEnrichment,
  WANTED_NOW,
  WANTED_SOON,
} from './store.js'

/** How often the queue is looked at. */
export const TICK_MS = 30_000
/** How many places one tick may enrich. */
export const PLACES_PER_TICK = 6
/** How many prominent places are queued at a time when the queue runs dry. */
export const TOP_UP = 400
/** A place at or below this zoom is one people see without looking for it. */
export const PROMINENT_ZOOM = 13

export function createEnrichWorker({
  pool,
  sources,
  log = () => {},
  tickMs = TICK_MS,
  placesPerTick = PLACES_PER_TICK,
  topUp = TOP_UP,
  prominentZoom = PROMINENT_ZOOM,
  pipeline = ENRICH_PIPELINE,
  enabled = true,
}) {
  let timer = null
  let stopped = !enabled
  let running = Promise.resolve()

  /** One place: fetch, decide, write. Never throws — a failure waits. */
  async function enrichOne(place) {
    try {
      /* Whether a person is looking at this place right now, which is the one
         thing that decides whether a public volunteer-run service may be
         asked about it. WANTED_NOW is set by the card route when somebody
         opens a place we have never enriched; everything else here is the
         backfill, and a backfill is answered from our own landmark table or
         not at all — see fromTableThenOverpass in enrich/osm.js. */
      const outcome = await enrichPlace(place, sources, {
        waiting: Number(place.priority) <= WANTED_NOW,
      })
      await writeEnrichment(pool, place.id, outcome, pipeline)
      log(
        `places: ${place.name} ${outcome.status}` +
          (outcome.status === 'ready'
            ? ` (${outcome.images.length} picture(s)${outcome.description ? ', words' : ''})`
            : ` — ${outcome.reason}`),
      )
      return outcome.status
    } catch (error) {
      await failEnrichment(pool, place.id, error).catch(() => {})
      log(`places: ${place.name} could not be enriched — ${error.message}`)
      return 'failed'
    }
  }

  async function tick() {
    if (stopped) return
    const places = await claimEnrichment(pool, placesPerTick)

    /* Nothing waiting: put the next slice of the prominent places in. The
       top-up is bounded and indexed, so an empty queue costs one indexed
       read rather than a scan of a table with millions of rows in it. */
    if (!places.length) {
      const added = await enqueueProminent(pool, {
        zoom: prominentZoom,
        limit: topUp,
        pipeline,
      })
      if (added.length) log(`places: ${added.length} prominent place(s) queued for enrichment`)
      return
    }

    const started = Date.now()
    const counted = { ready: 0, barren: 0, failed: 0 }
    /* One at a time. The sources serialise per host anyway, so running these
       in parallel would only pile promises up behind the same gap. */
    for (const place of places) {
      if (stopped) break
      counted[await enrichOne(place)] += 1
    }
    event('places enriched', {
      'places.enriched.ready': counted.ready,
      'places.enriched.barren': counted.barren,
      'places.enriched.failed': counted.failed,
      'places.enriched.ms': Date.now() - started,
    })
  }

  async function safeTick() {
    running = tick().catch(error => log(`places: the enrichment tick failed — ${error.message}`))
    await running
    if (!stopped) schedule(tickMs)
  }

  function schedule(delay) {
    if (stopped) return
    timer = setTimeout(() => {
      timer = null
      void safeTick()
    }, delay)
    timer.unref?.()
  }

  return {
    start() {
      if (!enabled) {
        log('places: enrichment is off (no contact address configured)')
        return
      }
      stopped = false
      schedule(0)
    },
    async stop() {
      stopped = true
      if (timer) clearTimeout(timer)
      timer = null
      await running
    },
    /** Tests, and a boot that wants one pass now rather than in half a minute. */
    async once() {
      await tick()
    },
  }
}

export { WANTED_SOON }
