/* The app shell, so that opening Off We Go with no signal gets you the app
   rather than the browser's dinosaur. Everything else offline — the trip, the
   photographs, the map — is already handled inside the app; without this the
   app simply never starts to do any of it.

   Deliberately not a precache manifest: this keeps what has actually been
   used, which is the same bargain the rest of the offline story makes, and it
   cannot go stale against a build it does not know about.

   Regenerating is not a thing; edit this file. It is served as-is from
   public/. */

const SHELL = 'wayfare-shell-v1'
/* Every deploy renames the hashed bundles, so without a ceiling the cache
   keeps a generation of the app per release until the origin quota runs out —
   at which point nothing new is cached and the offline start quietly rots.
   The shell is a few dozen files; anything past this is last release's. */
const MAX_SHELL_ENTRIES = 120

/* Fingerprinted files never change under their name, so a copy of one is good
   for ever. Everything else same-origin is fetched fresh when there is a
   network and answered from the copy when there is not. */
const PRIVATE = ['/api/', '/oauth/', '/mcp', '/.well-known/']

const IMMUTABLE = /\/assets\/|\.[0-9a-f]{8,}\.(js|css|woff2?|png|svg|jpg|webp)$/

self.addEventListener('install', event => {
  event.waitUntil(
    (async () => {
      /* The page that installed us was fetched before we existed, so nothing
         of it is held yet. The single-page shell at / is enough to boot any
         route, so that is what we take first. */
      const cache = await caches.open(SHELL)
      await cache.add('/').catch(() => {})
      // Take over straight away rather than waiting for every tab to close: a
      // half-updated app is worse than a brief overlap.
      await self.skipWaiting()
    })(),
  )
})

/* The app tells us what it actually loaded — its scripts, styles and fonts —
   because those were fetched before we were controlling anything and would
   otherwise be missing exactly when they are needed. */
self.addEventListener('message', event => {
  const urls = event.data?.type === 'warm' ? event.data.urls : null
  if (!Array.isArray(urls)) return
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL)
      for (const url of urls.slice(0, 80)) await cache.add(url).catch(() => {})
    })(),
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        // Ours, from an older shape of this file.
        if (name.startsWith('wayfare-shell-') && name !== SHELL) await caches.delete(name)
      }
      await self.clients.claim()
    })(),
  )
})

const keep = async (request, response) => {
  if (!response || !response.ok) return response
  const cache = await caches.open(SHELL)
  await cache.put(request, response.clone()).catch(() => {})
  const held = await cache.keys()
  // Insertion order, so the oldest generation goes first.
  for (const stale of held.slice(0, Math.max(0, held.length - MAX_SHELL_ENTRIES))) {
    await cache.delete(stale).catch(() => {})
  }
  return response
}

/* The document itself: newest wins while there is a network, because that is
   how a deploy reaches somebody who never closed the tab. Offline, any page of
   the app will do — it is a single-page app, so the shell it holds can render
   whichever route was asked for. */
const document_ = async request => {
  try {
    return await keep(request, await fetch(request))
  } catch {
    return (await caches.match(request)) || (await caches.match('/')) || Response.error()
  }
}

const asset = async request => {
  const held = await caches.match(request)
  if (held && IMMUTABLE.test(new URL(request.url).pathname)) return held
  try {
    return await keep(request, await fetch(request))
  } catch {
    return held || Response.error()
  }
}

self.addEventListener('fetch', event => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  /* None of these are ours to keep: they are per-account and authenticated,
     and the app has its own answer for what to show when it cannot reach them.
     /oauth, /mcp and /.well-known are proxied to the API on this same origin,
     and the consent page among them carries a signed request token. */
  if (PRIVATE.some(prefix => url.pathname.startsWith(prefix))) return
  event.respondWith(request.mode === 'navigate' ? document_(request) : asset(request))
})
