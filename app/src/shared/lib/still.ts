/* A test seam, the same shape as the one in backend-live.ts: the suite sets
   `__offwegoStill` to freeze the demo's live position. The camera reads it
   too, and jumps where it would ease, so no move can start under a test's
   feet a second after it thought the map had settled. Never set by the app. */
export const isStill = (): boolean =>
  (globalThis as { __offwegoStill?: boolean }).__offwegoStill === true

/* The same seam for the travel day: the demo's legs are built relative to
   now, and only a page that says it is the day itself sees the day face —
   and the family at the airport rather than at lunch across town. */
export const isTravelDay = (): boolean =>
  (globalThis as { __offwegoTravelDay?: boolean }).__offwegoTravelDay === true
