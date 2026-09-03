import { createRouter } from '@tanstack/react-router'
import { startTelemetry } from './shared/lib/telemetry'
import { routeTree } from './route-tree.gen'

// Before the first route renders, so the first paint's web vitals are seen.
startTelemetry()

export function getRouter() {
  return createRouter({
    routeTree,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
