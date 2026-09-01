import { defineConfig } from 'vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'

export default defineConfig({
  plugins: [
    tailwindcss(),
    /* SPA rather than SSR, deliberately. The same bundle is wrapped by
       Capacitor for iOS and Android and served as static files by Caddy, and
       the API of record is the Fastify server the phones already talk to — so
       there is nothing for a render server to do here. Start still gives us the
       router, the build pipeline and server functions the day we want them. */
    tanstackStart({
      // The shell is prerendered to index.html so Caddy's SPA fallback and
      // Capacitor's webDir both find it exactly where they already look.
      spa: { enabled: true, prerender: { outputPath: '/index.html' } },
      router: { generatedRouteTree: './route-tree.gen.ts' },
    }),
    viteReact(),
  ],
})
