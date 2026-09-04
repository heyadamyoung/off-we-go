import { authClient, isSample } from './backend-base'
import { track } from './shared/lib/telemetry'
import type { AssistantMessage, Id } from './shared/model/types'

export async function askAssistant(
  tripId: Id,
  slug: string,
  messages: AssistantMessage[],
): Promise<string> {
  if (isSample(tripId)) {
    return (
      'The AI assistant lives on the family server, so the sample trip cannot reach it. ' +
      'On a real trip, ask me anything about the plan, the places, or where everyone is.'
    )
  }
  track('ask assistant', { trip: slug, turns: String(messages.length) })
  /* Started as a job and polled, never held open: the agent can think for
     minutes, and both the CDN and a phone's radio kill a silent held
     response long before that — the run then finished (and edited the trip)
     server-side while the phone showed a failure. Each poll is a one-second
     request that survives airport LTE; a poll lost to the radio is retried,
     only the job's own verdict is final. */
  const started = await authClient.request<{ job?: string; reply?: string }>('/assistant', {
    method: 'POST',
    body: { trip: slug, messages, wait: false },
  })
  if (!started.job) return String(started.reply || '')
  const deadline = Date.now() + 12 * 60_000
  while (Date.now() < deadline) {
    await new Promise(rest => setTimeout(rest, 3000))
    try {
      const job = await authClient.request<{ state: string; reply?: string; error?: string }>(
        `/assistant/jobs/${started.job}`,
      )
      if (job.state === 'done') return String(job.reply || '')
      if (job.state === 'failed') {
        throw Object.assign(new Error(job.error || 'The assistant could not answer'), {
          status: 502,
          final: true,
        })
      }
    } catch (caught) {
      const error = caught as { status?: number; final?: boolean }
      if (error.final) throw caught
      // The server restarted mid-run: the job is gone and nobody is running it.
      if (error.status === 404) {
        throw Object.assign(new Error('The answer was lost to a server restart'), {
          status: 502,
          final: true,
        })
      }
      // Anything else — a dropped poll, a tunnel blip — is waited out.
    }
  }
  throw Object.assign(new Error('The assistant is taking too long'), { status: 502, final: true })
}
