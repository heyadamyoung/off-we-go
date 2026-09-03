import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router'
import { useEffect, type ReactNode } from 'react'
import { ToastHost } from '../shared/ui/toast'
import { SessionProvider } from '../features/auth'
import { trackKeyboardInset } from '../shared/lib/keyboard-inset'
import { registerAppShell } from '../service-worker-client'
import { isNativeApp } from '../mobile'
import styles from '../styles.css?url'

/* Painted before React arrives, so a returning visitor's chosen theme is on the
   first frame rather than after a flash of the other one. */
/* Painted before React arrives, and — on a trip — the two map requests that
   are known before any of the app's own code has parsed. The map is otherwise
   a chain of five: route chunk, then the style, then the tile index, then the
   tiles, then the glyphs, each discovered only once the one before it has been
   parsed. These two start at the first byte instead, which takes a whole
   round trip each off the front of that chain. */
const THEME_BOOT =
  `try{var t=localStorage.getItem('offwego-theme')==='light'?'light':'dark';` +
  `document.documentElement.dataset.theme=t;` +
  `if(location.pathname.indexOf('/trips/')===0){` +
  `var p=function(h){var l=document.createElement('link');l.rel='preload';` +
  `l.as='fetch';l.crossOrigin='anonymous';l.href=h;document.head.appendChild(l)};` +
  `p('/map-'+t+'.json');p('https://tiles.openfreemap.org/planet')}` +
  `}catch(e){}`

/* Link scrapers do not run JavaScript and want absolute image URLs. The API's
   origin is the public origin (the same rule share links use), known at build
   time; in sample-mode dev there is none and a relative path is fine. */
const PUBLIC_ORIGIN = (() => {
  try {
    const api = new URL(String(import.meta.env.VITE_API_URL || ''))
    if (api.protocol === 'http:' || api.protocol === 'https:') return api.origin
  } catch {
    /* no backend configured */
  }
  return ''
})()

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      /* interactive-widget: when the on-screen keyboard opens, the layout
         viewport shrinks with it. Without this the page keeps its full height
         behind the keyboard, and anything anchored to the bottom — the stop
         editor, most of all — is typed into from underneath it. */
      {
        name: 'viewport',
        content:
          'width=device-width, initial-scale=1, viewport-fit=cover, ' +
          'interactive-widget=resizes-content',
      },
      { name: 'theme-color', content: '#0B0D11' },
      { title: 'Off We Go — Go Places Together' },
      /* A trip link pasted into the family chat is the front door; without
         these it unfurls as a bare URL. Deliberately generic: every trip is
         private, so the card never carries trip content. */
      {
        name: 'description',
        content:
          'Plan the trip, let your phone draw the route, drop photos where they ' +
          'happened — and the people at home follow it live.',
      },
      { property: 'og:type', content: 'website' },
      { property: 'og:site_name', content: 'Off We Go' },
      { property: 'og:title', content: 'Off We Go — Go Places Together' },
      {
        property: 'og:description',
        content:
          'Follow the trip live: the route as it happens, photos where they were ' +
          'taken, and who is where right now.',
      },
      { property: 'og:image', content: `${PUBLIC_ORIGIN}/og-card.png` },
      { name: 'twitter:card', content: 'summary_large_image' },
    ],
    links: [
      { rel: 'stylesheet', href: styles },
      { rel: 'icon', href: '/favicon.ico', sizes: 'any' },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      { rel: 'manifest', href: '/site.webmanifest' },
      // Map tiles are the LCP element and the handshake to this host measured
      // ~210ms. Preconnect only: which tiles are wanted depends on theme,
      // viewport and DPR, so a hardcoded preload is as likely to waste a
      // request as to save one. The boot script below starts the two requests
      // that *are* known in advance, and only on a trip.
      { rel: 'preconnect', href: 'https://tiles.openfreemap.org' },
      // The home page's planet comes from NASA's tile service instead.
      { rel: 'preconnect', href: 'https://gibs.earthdata.nasa.gov' },
      /* Two faces with two jobs: Bricolage carries the wordmark and the big
         titles — the one voice with character — and Schibsted does the quiet
         everyday work. Both are declared in styles.css and served from here,
         so there is no third-party stylesheet standing in front of the app.
         The latin subsets are preloaded because every screen paints them. */
      {
        rel: 'preload',
        as: 'font',
        type: 'font/woff2',
        href: '/fonts/bricolage-grotesque-latin.woff2',
        crossOrigin: 'anonymous',
      },
      {
        rel: 'preload',
        as: 'font',
        type: 'font/woff2',
        href: '/fonts/schibsted-grotesk-latin.woff2',
        crossOrigin: 'anonymous',
      },
    ],
    /* React hoists every link above this script, and a synchronous inline
       script waits for the stylesheets before it — so this runs once the
       cross-origin web-font sheet has landed, about 150ms in, rather than at
       the first byte. Worth knowing before trusting it to beat first paint. */
    scripts: [{ children: THEME_BOOT }],
  }),
  shellComponent: RootDocument,
  component: RootLayout,
})

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        <div id="root">{children}</div>
        <Scripts />
      </body>
    </html>
  )
}

function RootLayout() {
  performance.mark('mk:root')
  useEffect(() => trackKeyboardInset(), [])
  useEffect(() => registerAppShell(isNativeApp), [])

  return (
    <SessionProvider>
      <ToastHost>
        <Outlet />
      </ToastHost>
    </SessionProvider>
  )
}
