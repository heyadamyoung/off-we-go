import { getWebInstrumentations, initializeFaro, type Faro } from '@grafana/faro-web-sdk'
import { TracingInstrumentation } from '@grafana/faro-web-tracing'

/* Frontend observability, first-party: the Faro SDK posts to /collect on our
   own domain, Caddy hands it to the Alloy agent, and Alloy fans it out —
   errors and events to Loki, spans to Tempo — under the same roof as the
   server's telemetry. No third-party endpoint, nothing for a blocker to eat.

   Event names are lowercase verb-noun ("open terminal", "ask assistant"),
   the same convention as the server's span names, so one search phrasing
   works across both ends of a trace. */

let faro: Faro | null = null

export function startTelemetry() {
  if (faro) return
  // Production web only: the dev server has a console, and the native shells
  // (capacitor:// origins) get their own wiring when it is worth having.
  if (!import.meta.env.PROD) return
  if (typeof window === 'undefined' || !/^https:/.test(window.location.origin)) return
  try {
    faro = initializeFaro({
      url: window.location.origin + '/collect',
      app: { name: 'offwego-web', version: '1.1' },
      sessionTracking: { enabled: true },
      instrumentations: [...getWebInstrumentations(), new TracingInstrumentation()],
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
