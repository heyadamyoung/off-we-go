/* Registers the shell worker that lets the app open with no signal at all.

   Not in development, where it would sit between the browser and the dev
   server's live reloading; and not in the native app, whose shell is already
   on the device — there it would be a second, worse copy of the same idea. */

const CACHEABLE = /\.(js|mjs|css|woff2?|json|png|svg|jpg|webp|ico)$/
const warmed = new Set<string>()

/* What this page actually loaded. The worker cannot know it: these were
   fetched before the worker existed, on the very visit that installed it, and
   they are precisely what a cold offline start needs. Anything fetched after
   the worker takes over it keeps on its own. */
function loadedResources() {
  if (typeof performance === 'undefined') return []
  const here = window.location.origin
  const fresh: string[] = []
  for (const entry of performance.getEntriesByType('resource')) {
    try {
      const url = new URL(entry.name, here)
      if (url.origin !== here || url.pathname.startsWith('/api/')) continue
      if (!CACHEABLE.test(url.pathname)) continue
      const path = url.pathname + url.search
      if (warmed.has(path)) continue
      warmed.add(path)
      fresh.push(path)
    } catch {
      /* an entry we cannot parse is one we cannot keep */
    }
  }
  return fresh
}

export function registerAppShell(native: boolean) {
  if (native || !import.meta.env.PROD) return
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  navigator.serviceWorker
    .register('/sw.js')
    .then(async () => {
      const ready = await navigator.serviceWorker.ready
      const warm = () => {
        const urls = loadedResources()
        if (urls.length) ready.active?.postMessage({ type: 'warm', urls })
      }
      warm()
      /* Again once the screen has finished asking for its parts. Routes load
         their own code as they mount, so the first pass cannot have seen the
         chunk for the page the visitor actually opened. */
      setTimeout(warm, 4_000)
    })
    .catch(() => {
      /* A browser that refuses it loses offline, not the app. */
    })
}
