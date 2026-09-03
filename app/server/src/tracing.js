/* Hand-made spans, for the operations whose story the auto-instrumented
   HTTP spans cannot tell on their own. Names are lowercase verb-noun
   ("fetch terminal", "answer question"), attributes are flat dotted keys —
   the same conventions the browser's events follow, so one search phrasing
   works across the whole trace. With no SDK registered (tests, local dev)
   the api is a no-op and this file costs nothing. */

import { SpanStatusCode, trace } from '@opentelemetry/api'

const tracer = trace.getTracer('offwego-api')

/** A moment inside whatever span is running — "refresh token", "heal row". */
export function event(name, attributes = {}) {
  trace.getActiveSpan()?.addEvent(name, attributes)
}

/** Widen the current request's span: who asked, from where, about what.
    This is the wide-event promise — the 3am question is answered by the
    span itself, not by joining four systems. */
export function stamp(attributes) {
  trace.getActiveSpan()?.setAttributes(attributes)
}

/** The failure lands on the span, whatever the HTTP layer turns it into. */
export function recordFailure(error) {
  trace.getActiveSpan()?.recordException(error)
}

export async function span(name, attributes, work) {
  return tracer.startActiveSpan(name, { attributes }, async active => {
    try {
      return await work(active)
    } catch (error) {
      active.recordException(error)
      active.setStatus({ code: SpanStatusCode.ERROR, message: error.message })
      throw error
    } finally {
      active.end()
    }
  })
}
