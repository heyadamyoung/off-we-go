import { frameJson, readFrames } from './sse-core'
import type { LiveFix } from './shared/model/types'

/* One held-open connection per trip, however many parts of the screen are
   listening on it. Positions arrive with their payload because they are
   incremental and cheap; everything else — a stop moved, a photograph added, a
   comment posted — says only what changed, and the page asks for that slice.

   Written as a factory over its dependencies so the dispatch can be tested
   without a server, a socket, or a browser. */

export interface TripStreamDeps {
  /** Opens the stream. Rejects if it cannot be opened. */
  open: (path: string, signal: AbortSignal) => Promise<{ body: ReadableStream<Uint8Array> | null }>
  /** The fallback, for a connection something in the middle will not hold open. */
  poll: (
    tripId: string,
    options: { hours: number; cursor: number },
  ) => Promise<{ fixes: LiveFix[]; cursor: number }>
  path: (tripId: string) => string
  asFix: (value: unknown) => LiveFix
  retryDelay: (failures: number) => number
  pollEvery?: number
  setTimer?: (run: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

export interface Listener {
  onFix?: (fix: LiveFix) => void
  onChange?: (kind: string) => void
  onState?: (state: 'ready' | 'error') => void
  cursor?: number
  hours?: number
}

export function createTripStreams(deps: TripStreamDeps) {
  const setTimer = deps.setTimer || ((run: () => void, ms: number) => setTimeout(run, ms))
  const clearTimer = deps.clearTimer || ((handle: unknown) => clearTimeout(handle as never))
  const pollEvery = deps.pollEvery ?? 15_000
  const streams = new Map<string, ReturnType<typeof openStream>>()

  function openStream(tripId: string) {
    const listeners = new Set<Listener>()
    let cursor = 0
    let hours = 24
    let stopped = false
    let failures = 0
    let polling: unknown = null
    let abort: AbortController | null = null

    const tell = (run: (listener: Listener) => void) => {
      for (const listener of [...listeners]) {
        try {
          run(listener)
        } catch {
          /* one bad listener is not the others' problem */
        }
      }
    }
    const state = (value: 'ready' | 'error') => tell(listener => listener.onState?.(value))

    const askOnce = async () => {
      try {
        const result = await deps.poll(tripId, { hours, cursor })
        cursor = Math.max(cursor, result.cursor)
        for (const fix of result.fixes) tell(listener => listener.onFix?.(fix))
        tell(listener => listener.onChange?.('poll'))
        state('ready')
      } catch {
        state('error')
      }
    }

    /* Older webviews, and anything in the middle that buffers, can leave a
       stream that connects and never delivers. Asking is worse than being told,
       and better than silence. */
    const startPolling = () => {
      if (polling || stopped) return
      polling = setTimer(function tick() {
        if (stopped) return
        askOnce().finally(() => {
          if (!stopped && polling) polling = setTimer(tick, pollEvery)
        })
      }, pollEvery)
    }
    const stopPolling = () => {
      if (polling) {
        clearTimer(polling)
        polling = null
      }
    }

    const consume = (text: string, carry: string) => {
      const { frames, rest } = readFrames(carry + text)
      for (const frame of frames) {
        const payload = frameJson<Record<string, unknown>>(frame)
        if (!payload) continue
        if (frame.event === 'changed') {
          const kind = String(payload.kind || 'trip')
          tell(listener => listener.onChange?.(kind))
          continue
        }
        if (Number.isFinite(payload.cursor as number)) cursor = payload.cursor as number
        for (const raw of (payload.fixes as unknown[]) || []) {
          const fix = deps.asFix(raw)
          tell(listener => listener.onFix?.(fix))
        }
      }
      return rest
    }

    const connect = async () => {
      if (stopped) return
      abort = new AbortController()
      try {
        const response = await deps.open(
          `${deps.path(tripId)}/live/stream?hours=${hours}&cursor=${cursor}`,
          abort.signal,
        )
        if (!response.body) throw new Error('This browser cannot read a stream')
        stopPolling()
        failures = 0
        state('ready')

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let carry = ''
        for (;;) {
          const { value, done } = await reader.read()
          if (done || stopped) break
          carry = consume(decoder.decode(value, { stream: true }), carry)
        }
        if (!stopped) throw new Error('the stream ended')
      } catch (error) {
        if (stopped || (error as Error)?.name === 'AbortError') return
        failures += 1
        state('error')
        // Twice in a row and something in the middle does not want a held-open
        // connection. Ask until it changes its mind.
        if (failures >= 2) startPolling()
        setTimer(connect, deps.retryDelay(failures))
      }
    }

    let started = false

    return {
      /* Not before the first listener: it brings the cursor to resume from,
         and a connection nobody is listening to is a connection to close. */
      start() {
        if (started || stopped) return
        started = true
        connect()
      },
      add(listener: Listener) {
        cursor = Math.max(cursor, listener.cursor || 0)
        hours = Math.max(hours, listener.hours || 0)
        listeners.add(listener)
      },
      remove(listener: Listener) {
        listeners.delete(listener)
        return listeners.size
      },
      stop() {
        stopped = true
        stopPolling()
        abort?.abort()
      },
      get listeners() {
        return listeners.size
      },
    }
  }

  return {
    /** Listen to a trip. Returns the way to stop listening. */
    watch(tripId: string, listener: Listener) {
      const key = String(tripId)
      let stream = streams.get(key)
      if (!stream) {
        stream = openStream(key)
        streams.set(key, stream)
      }
      stream.add(listener)
      stream.start()
      return () => {
        const left = stream.remove(listener)
        if (!left) {
          stream.stop()
          streams.delete(key)
        }
      }
    },
    /** How many connections are open, which should be one per trip on screen. */
    get open() {
      return streams.size
    },
  }
}
