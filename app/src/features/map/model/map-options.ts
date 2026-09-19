import type { MapOptions } from 'maplibre-gl'

/* How the map is built: its range, its feel under a wheel or a pinch, and
   what it spends on a phone's screen. Its own module so the canvas is left
   with the map's life rather than its birth. */

/** How much of a zoom level one notch of a mouse wheel is worth: a hundred
    units of wheel is most of a level, eased, the way Google Maps does it.
    MapLibre's own is a fifth, five notches to go anywhere, which read as the
    map resisting. A trackpad keeps its own finer rate. */
export const WHEEL_ZOOM_RATE = 1 / 120

/** The whole world, as far out as Google Maps goes: a trip across an ocean
    is a line across the globe, and stopping at a continent made the far end
    of it something to scroll to. */
export const MIN_ZOOM = 1
export const MAX_ZOOM = 18

/** No more than two device pixels per CSS pixel. Three is nine times the
    fill of a desk for the same screen, and a pinch on a phone paid for it in
    dropped frames; no eye tells two from three on a phone. */
export const pixelRatioFor = (devicePixelRatio: number) => Math.min(devicePixelRatio || 1, 2)

export function mapOptions(
  container: HTMLElement,
  view: { center: [number, number]; zoom: number },
  interactive: boolean,
): MapOptions {
  return {
    container,
    center: view.center,
    zoom: view.zoom,
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
    interactive,
    pixelRatio: pixelRatioFor(globalThis.devicePixelRatio),
    /* Tiles asked for mid-pinch were dropped the moment the zoom changed
       again, so the map arrived blank and filled in after the fingers
       lifted. What was on its way is drawn. */
    cancelPendingTileRequestsWhileZooming: false,
    /* A shorter cross-fade as tiles arrive: the long one read as the map
       still catching up after the gesture had ended. */
    fadeDuration: 120,
    // The credit is our own control, added by the canvas — bottom-left, clear
    // of the map controls, resting at the one line the licences insist on.
    attributionControl: false,
    dragRotate: false,
    pitchWithRotate: false,
  }
}
