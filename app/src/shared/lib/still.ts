/* A test seam, the same shape as the one in backend-live.ts: the suite sets
   `__offwegoStill` to freeze the demo's live position. The camera reads it
   too, and jumps where it would ease, so no move can start under a test's
   feet a second after it thought the map had settled. Never set by the app. */
export const isStill = (): boolean =>
  (globalThis as { __offwegoStill?: boolean }).__offwegoStill === true
