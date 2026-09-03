import { createRouter } from '@tanstack/react-router'
import { startTelemetry, trackError, view } from './shared/lib/telemetry'
import { routeTree } from './route-tree.gen'

// Before the first route renders, so the first paint's web vitals are seen.
startTelemetry()

export function getRouter() {
  const router = createRouter({
    routeTree,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
    // The router's own catch boundary swallows render crashes before
    // window.onerror can see them — a white screen with no trail. Record
    // first, then show the way back.
    defaultErrorComponent: ({ error }) => {
      trackError('render', error)
      return (
        <div className="grid min-h-[60vh] place-items-center p-8 text-center">
          <div>
            <h1 className="m-0 text-xl font-extrabold">Something broke on this screen.</h1>
            <p className="mt-2 text-sm text-muted">
              It has been reported.{' '}
              <a className="underline" href="/">
                Back to your trips
              </a>
            </p>
          </div>
        </div>
      )
    },
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
