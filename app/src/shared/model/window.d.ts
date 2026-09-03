import type { Map as MapLibreMap } from 'maplibre-gl'

declare global {
  interface Window {
    /** A handle for the test suite: the attraction layers are drawn by the
        GPU, so there is no DOM element to select and assert against. */
    __offwegoMap?: MapLibreMap
  }
}
