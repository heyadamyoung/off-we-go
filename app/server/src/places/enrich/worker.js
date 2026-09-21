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
  WANTED_SOON,
} from './store.js'

/** How often the queue is looked at. */
export const TICK_MS = 30_000
/** How many places one claim takes. A batch, not a budget — see DRAIN_MS. */
export const PLACES_PER_TICK = 12
/**
 * How long a tick spends draining, at most.
 *
 * The throttle used to be the count: six places every thirty seconds, seven
 * hundred and twenty an hour, which put the prominent backfill in weeks. That
 * number was chosen when a place cost four hosts and one of them was Overpass
 * — a volunteer service with real limits and the fragile link in the chain.
 * Overpass is gone and a place now costs two calls to one CDN-fronted API.
 *
 * The count was also never the thing keeping us polite. `politely()` in
 * wikimedia.js serialises per host with a 250 ms gap, which is a ceiling of
 * about two places a second whatever this file asks for — so six per tick was
 * a second, blunter throttle stacked on a good one, holding us ten times
 * below what the good one already allowed.
 *
 * A clock rather than a count, then, and well inside the tick so the drain
 * never becomes the thing that stops the next one starting. What limits the
 * rate is the per-host gap, which is where the limit belongs.
 */
export const DRAIN_MS = 20_000
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
  drainMs = DRAIN_MS,
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
      const outcome = await enrichPlace(place, sources)
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
    const started = Date.now()
    const deadline = started + drainMs
    const counted = { ready: 0, barren: 0, failed: 0 }
    let toppedUp = 0

    /* Until the clock runs out, the queue runs dry twice, or we are asked to
       stop. Twice, because the first dry queue is answered by topping up and
       the second means there is genuinely nothing left to do — a place with
       `label_zoom <= 13` that nobody has looked at. */
    let refilled = false
    /* At least one pass, whatever the clock says. A tick that could make
       progress and returns having made none is a worker that looks alive and
       is not, and `drainMs` is a ceiling on the work rather than permission
       to do it. */
    for (let pass = 0; !stopped && (pass === 0 || Date.now() < deadline); pass += 1) {
      const places = await claimEnrichment(pool, placesPerTick)

      if (!places.length) {
        /* The top-up is bounded and indexed, so an empty queue costs one
           indexed read rather than a scan of a table with millions of rows.
           In rank order — see enqueueProminent. */
        if (refilled) break
        refilled = true
        const added = await enqueueProminent(pool, {
          zoom: prominentZoom,
          limit: topUp,
          pipeline,
        })
        toppedUp += added.length
        if (!added.length) break
        continue
      }

      /* One at a time. The sources serialise per host anyway, so running
         these in parallel would only pile promises up behind the same gap. */
      for (const place of places) {
        if (stopped) break
        counted[await enrichOne(place)] += 1
      }
    }

    if (toppedUp) log(`places: ${toppedUp} prominent place(s) queued for enrichment`)
    const done = counted.ready + counted.barren + counted.failed
    if (done) {
      log(
        `places: ${done} enriched in ${Math.round((Date.now() - started) / 100) / 10}s — ` +
          `${counted.ready} with something to show, ${counted.barren} without, ` +
          `${counted.failed} to try again`,
      )
    }
    if (done || toppedUp) {
      event('places enriched', {
        'places.enriched.ready': counted.ready,
        'places.enriched.barren': counted.barren,
        'places.enriched.failed': counted.failed,
        'places.enriched.queued': toppedUp,
        'places.enriched.ms': Date.now() - started,
      })
    }
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
