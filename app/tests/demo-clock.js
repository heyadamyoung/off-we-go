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
