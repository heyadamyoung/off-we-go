import { getWebInstrumentations, initializeFaro, type Faro } from '@grafana/faro-web-sdk'
import { TracingInstrumentation } from '@grafana/faro-web-tracing'
import { mobilePlatform } from '../../mobile'

/* Frontend observability, first-party: the Faro SDK posts to /collect on our
   own domain, Caddy hands it to the Alloy agent, and Alloy fans it out —
   errors and events to Loki, spans to Tempo — under the same roof as the
   server's telemetry. No third-party endpoint, nothing for a blocker to eat.

   The native shells ride the same wire: their origin is capacitor://localhost
   or https://localhost, useless as a base, so the collector root is derived
   from the API base their builds carry — and the app name says which shell a
   session came from (offwego-ios, offwego-android, offwego-web).

   Event names are lowercase verb-noun ("open terminal", "ask assistant"),
   the same convention as the server's span names, so one search phrasing
   works across both ends of a trace. */

const API_URL = String(import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

/* Where /collect lives: the API's own origin when the build carries an
   absolute one (the shells), otherwise the page's origin (the web). */
const collectRoot = /^https:/.test(API_URL)
  ? API_URL.replace(/\/api$/, '')
  : typeof window !== 'undefined' && /^https:/.test(window.location.origin)
    ? window.location.origin
    : null

let faro: Faro | null = null

export function startTelemetry() {
  if (faro || !import.meta.env.PROD || !collectRoot) return
  try {
    const escaped = collectRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    faro = initializeFaro({
      url: collectRoot + '/collect',
      app: {
        name: 'offwego-' + (mobilePlatform || 'web'),
        // The deploy sha, so "did this start with the release" is a filter.
        version: String(import.meta.env.VITE_APP_SHA || '').slice(0, 7) || 'dev',
      },
      sessionTracking: { enabled: true },
      instrumentations: [
        ...getWebInstrumentations(),
        new TracingInstrumentation({
          // The shells call the API cross-origin; traceparent may ride along
          // (the server's CORS allows it), so their traces join the wire too.
          instrumentationOptions: { propagateTraceHeaderCorsUrls: [new RegExp('^' + escaped)] },
        }),
      ],
    })
  } catch {
    faro = null // observability must never take the app down with it
  }
}

/** One user-meaningful thing happened. Lowercase verb-noun, flat attributes. */
export function track(name: string, attributes: Record<string, string> = {}) {
  try {
    faro?.api.pushEvent(name, attributes)
  } catch {
    /* never the app's problem */
  }
}

/** A handled failure happened. Handling it well is UX; recording it is
    observability — a caught error the operator cannot query never happened,
    which is the invisible-integration anti-pattern wearing a try/catch. */
export function trackError(
  action: string,
  caught: unknown,
  attributes: Record<string, string> = {},
) {
  try {
    const error = caught instanceof Error ? caught : new Error(String(caught))
    const status = (caught as { status?: number })?.status
    const code = (caught as { code?: string })?.code
    faro?.api.pushError(error, {
      context: {
        action,
        ...(status ? { status: String(status) } : {}),
        ...(code ? { code } : {}),
        ...attributes,
      },
    })
  } catch {
    /* never the app's problem */
  }
}

/** Sessions, errors and events wear the signed-in user's id from here on. */
export function identify(id: string | undefined) {
  try {
    if (id) faro?.api.setUser({ id: String(id) })
  } catch {
    /* never the app's problem */
  }
}

/** The screen the session is on; route changes call this as they land. */
export function view(name: string) {
  try {
    faro?.api.setView({ name })
  } catch {
    /* never the app's problem */
  }
}
