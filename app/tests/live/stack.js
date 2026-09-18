import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/* What scripts/live-stack.mjs stood up, as this worker sees it.

   The specs run side by side, and the stack seeds a trip for each worker
   rather than one for all of them: a photograph planted by one test while
   another counts the cards on a day is a flake by design, and tidying up
   afterwards (leave-no-trace.js) only holds within one worker's own trip.
   So each worker takes the trip at its own index — Playwright names it in
   the environment — and every spec reads `stack.trip` exactly as before.

   The count of trips is the count of workers in playwright.live.config.ts;
   more workers than trips would put two on one trip again. */
const raw = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../dist/live-stack.json'), 'utf8'),
)
const lane = Number(process.env.TEST_PARALLEL_INDEX || 0) % raw.trips.length
export const stack = { ...raw, trip: raw.trips[lane].trip, stops: raw.trips[lane].stops }
