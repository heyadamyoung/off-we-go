/* The demo trip is genuinely live, so the suite has to say when it is.

   The sample maps its printed September dates onto the real calendar with the
   middle day on today, and the live machinery then reads the clock: which stop
   is next, which day chip lights up, which stops the strip is even showing.
   The day the app opens on is the day of whatever it is heading to.

   Which means the tests were a function of what time it was. Anne Frank House
   runs 15:45 to 17:00, and an hour and a half after that the trip has moved on
   to tomorrow — so a suite that was green all afternoon started failing at
   half past six in the evening, in nine places at once, none of them about
   anything that had changed.

   So the browser is told what time it is. Fixed rather than frozen: Date.now
   and new Date answer the same instant every run, and every timer, animation
   and map frame carries on as normal.

   Early afternoon of the middle day, which is the demo at its most useful —
   a morning behind it, an afternoon in front of it, and a traveller partway
   along. */
export const DEMO_NOW = new Date('2026-09-13T13:00:00Z')

/** Pin the page's clock. Call before `goto`, or the first render reads the real one. */
export const atDemoTime = page => page.clock.setFixedTime(DEMO_NOW)

/* A day either side of the demo's own today, as an ISO date.

   Never from Date.now(). The page's clock is pinned and the suite's is not,
   so the two agreed only for as long as the machine's date happened to match
   the one above — which it stopped doing at midnight, and the day-range
   assertion went red with nothing having changed. The same lesson as the
   clock itself, one level up. */
export const demoDay = (shift = 0) =>
  new Date(DEMO_NOW.getTime() + shift * 86_400_000).toISOString().slice(0, 10)
