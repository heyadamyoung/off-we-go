import { authClient } from '../../backend'

/* Session replay, self-hosted: rrweb records the DOM's own diary and posts it
   in chunks to this server, which keeps it on the VPS disk for the owner to
   watch — never a third party, because these sessions show a family's GPS
   trail and photographs. Inputs are masked wholesale; anything else that
   should never appear can wear className "noreplay".

   The recorder is a lazy import behind an idle callback: nobody's map pans
   slower so that a session can be watched later. */

const FLUSH_MS = 8000
const FLUSH_EVENTS = 300
const SESSION_CAP_EVENTS = 60_000 // a long session ends quietly, not hugely

let started = false

export function startReplay() {
  // The shells record too: uploads ride authClient, whose base is absolute
  // in a native build, so the webview's odd origin never matters here.
  if (started || !import.meta.env.PROD || typeof window === 'undefined') return
  started = true

  const begin = async () => {
    try {
      const { record } = await import('rrweb')
      const session = crypto.randomUUID()
      let buffer: unknown[] = []
      let seq = 0
      let total = 0
      let stop: (() => void) | undefined

      const flush = (last = false) => {
        if (!buffer.length) return
        const chunk = { session, seq: seq++, events: buffer }
        buffer = []
        // keepalive so the tab closing does not eat the final seconds.
        authClient
          .request('/replay/chunks', { method: 'POST', body: chunk, keepalive: last })
          .catch(() => {})
      }

      stop = record({
        emit(event) {
          buffer.push(event)
          total++
          if (total >= SESSION_CAP_EVENTS) {
            flush(true)
            stop?.()
            return
          }
          if (buffer.length >= FLUSH_EVENTS) flush()
        },
        maskAllInputs: true,
        blockClass: 'noreplay',
        sampling: { mousemove: 80, scroll: 120, media: 800 },
      })

      const timer = window.setInterval(flush, FLUSH_MS)
      window.addEventListener('pagehide', () => {
        flush(true)
        window.clearInterval(timer)
      })
    } catch {
      /* recording is a luxury; the app never notices its absence */
    }
  }

  const idle = (
    window as { requestIdleCallback?: (job: () => void, options?: { timeout: number }) => void }
  ).requestIdleCallback
  if (idle) idle(() => begin(), { timeout: 8000 })
  else setTimeout(begin, 4000)
}
