import { createRouter } from '@tanstack/react-router'
import { startTelemetry, view } from './shared/lib/telemetry'
import { routeTree } from './route-tree.gen'

// Before the first route renders, so the first paint's web vitals are seen.
startTelemetry()

export function getRouter() {
  const router = createRouter({
    routeTree,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
  })
  // Every landed navigation names the session's current view.
  router.subscribe('onResolved', ({ toLocation }) => view(toLocation.pathname))
  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
