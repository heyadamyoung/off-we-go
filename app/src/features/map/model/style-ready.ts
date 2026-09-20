import type { Map as MapGL } from 'maplibre-gl'

/* Adding to a style is a three-way race and only one of the three is obvious.
   `style.load` fires once, and with the style document preloaded it can fire
   before React has committed this effect. `isStyleLoaded()` looks like the
   guard for exactly that, but it means "the style *and every source's tiles*
   are loaded" — so it still reads false long after the event has gone, and
   `styledata` stops firing before it flips. That leaves a window where the
   event is past, the flag is false, and the layers are never added at all.

   What adding a source actually needs is the style *document*, which is what
   this waits for; `load` closes the last gap by firing once the first frame is
   up, whichever way round the rest happened. Every add is guarded by its own
   getSource check, so arriving twice costs nothing. */
export function whenStyleReady(map: MapGL, add: () => void) {
  const parsed = () => {
    try {
      return Boolean(map.getStyle()?.layers?.length)
    } catch {
      return false
    }
  }
  const run = () => {
    if (parsed()) add()
  }
  run()
  // Also on a theme swap, which replaces the whole document.
  map.on('style.load', run)
  map.on('load', run)
  return () => {
    map.off('style.load', run)
    map.off('load', run)
  }
}
