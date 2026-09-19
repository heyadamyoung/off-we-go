import type { Map as MapLibreMap } from 'maplibre-gl'

declare global {
  interface Window {
    /** A handle for the test suite: the attraction layers are drawn by the
        GPU, so there is no DOM element to select and assert against. */
    __offwegoMap?: MapLibreMap
    /** A handle for the test suite: the trip page's minute clock, ticked on
        demand once the suite has moved the pinned time on. */
    __offwegoTick?: () => void
    /** A handle for the test suite: raises a toast of a given tone, so the
        suite can measure where one sits and what colour it wears. */
    __offwegoToast?: (message: string, tone?: 'success' | 'warning' | 'error') => void
  }
}
