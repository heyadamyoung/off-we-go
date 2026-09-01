import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { ToastHost } from '../shared/ui/toast'
import { SessionProvider } from '../features/auth'
import styles from '../styles.css?url'

/* Painted before React arrives, so a returning visitor's chosen theme is on the
   first frame rather than after a flash of the other one. */
const THEME_BOOT = `try{var t=localStorage.getItem('offwego-theme');` +
  `document.documentElement.dataset.theme=t==='light'?'light':'dark'}catch(e){}`

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
      { name: 'theme-color', content: '#10141C' },
      { title: 'Off We Go — Go Places Together' },
    ],
    links: [
      { rel: 'stylesheet', href: styles },
      { rel: 'icon', href: '/favicon.ico', sizes: 'any' },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      { rel: 'manifest', href: '/site.webmanifest' },
      // Map tiles are the LCP element and the handshake to this CDN measured
      // ~210ms. Preconnect only: which tiles are wanted depends on theme,
      // viewport and DPR, so a hardcoded preload is as likely to waste a
      // request as to save one.
      { rel: 'preconnect', href: 'https://basemaps.cartocdn.com' },
      // The home page's planet comes from NASA's tile service instead.
      { rel: 'preconnect', href: 'https://gibs.earthdata.nasa.gov' },
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@400..800&display=swap',
      },
    ],
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
  return (
    <SessionProvider>
      <ToastHost>
        <Outlet />
      </ToastHost>
    </SessionProvider>
  )
}
