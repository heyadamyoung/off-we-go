import { frameJson, readFrames } from './sse-core'
import type { LiveFix } from './shared/model/types'

/* One held-open connection per trip, however many parts of the screen are
   listening on it. Positions arrive with their payload because they are
   incremental and cheap; everything else — a stop moved, a photograph added, a
   comment posted — says only what changed, and the page asks for that slice.

   A held-open connection dies quietly. A phone that went to another app for
   a minute, or walked off the terminal's Wi-Fi onto the mobile network,
   keeps a socket with nobody on the other end: no error, no end, nothing —
   and the gate the airport named while it was away reached the leg and never
   reached the screen until somebody reloaded. So the server comments every
   twenty-five seconds, and silence for longer than that is read here as a
   dead connection: dropped, and opened again. Coming back to the foreground,
   or back online, does the same at once rather than waiting the silence out.
   And every connection after the first tells its listeners so, because what
   changed while the last one was dead was announced to nobody: they ask
   again, the way they do for any change.

   Written as a factory over its dependencies so the dispatch can be tested
   without a server, a socket, or a browser. */

/** The server comments every 25 s; this is that, and room for a slow network. */
export const STREAM_SILENCE_MS = 70_000

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
  /** How long the stream may say nothing before it is presumed dead. */
  silenceMs?: number
  /** The moments a page comes back — to the foreground, online — and the
      way to stop listening for them. */
  onWake?: (run: () => void) => () => void
  setTimer?: (run: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

export interface Listener {
  onFix?: (fix: LiveFix) => void
  /** What changed: a kind the server named, 'poll' for a round of asking,
      or 'resume' — the connection was re-made, and anything may have. */
  onChange?: (kind: string) => void
  onState?: (state: 'ready' | 'error') => void
  cursor?: number
  hours?: number
}

export function createTripStreams(deps: TripStreamDeps) {
  const setTimer = deps.setTimer || ((run: () => void, ms: number) => setTimeout(run, ms))
  const clearTimer = deps.clearTimer || ((handle: unknown) => clearTimeout(handle as never))
  const pollEvery = deps.pollEvery ?? 15_000
  const silenceMs = deps.silenceMs ?? STREAM_SILENCE_MS
  const streams = new Map<string, ReturnType<typeof openStream>>()

  function openStream(tripId: string) {
    const listeners = new Set<Listener>()
    let cursor = 0
    let hours = 24
    let stopped = false
    let started = false
    let failures = 0
    let polling: unknown = null
    let abort: AbortController | null = null
    /* Whether a connection has ever been held: the first has nothing to catch
       up on, every one after it does. */
    let held = false
    /* Set when this side drops the connection on purpose — silence, a wake —
       so the drop is followed by a reconnect and not by a back-off. */
    let dropped = false
    let watchdog: unknown = null
    let retry: unknown = null
    let unwake: (() => void) | null = null
    /* The reader on the open body: cancelled as well as aborted when this
       side lets go, so a body that outlives its request still ends. */
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null

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

    /* Silence past the server's heartbeat is a dead socket, not a quiet
       evening: the connection is dropped and made again. */
    const expectSomething = () => {
      if (watchdog) clearTimer(watchdog)
      watchdog = setTimer(() => {
        watchdog = null
        drop()
      }, silenceMs)
    }
    const expectNothing = () => {
      if (watchdog) clearTimer(watchdog)
      watchdog = null
    }

    /* Drop whatever connection there is, or whatever wait there is, and
       connect now. */
    const drop = () => {
      if (stopped || !started || dropped) return
      dropped = true
      if (retry) {
        clearTimer(retry)
        retry = null
        connect()
        return
      }
      abort?.abort()
      reader?.cancel().catch(() => {})
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
      retry = null
      dropped = false
      const controller = new AbortController()
      abort = controller
      try {
        const response = await deps.open(
          `${deps.path(tripId)}/live/stream?hours=${hours}&cursor=${cursor}`,
          controller.signal,
        )
        if (!response.body) throw new Error('This browser cannot read a stream')
        stopPolling()
        failures = 0
        state('ready')
        if (held) tell(listener => listener.onChange?.('resume'))
        held = true

        reader = response.body.getReader()
        const decoder = new TextDecoder()
        let carry = ''
        expectSomething()
        for (;;) {
          const { value, done } = await reader.read()
          if (done || stopped) break
          expectSomething()
          carry = consume(decoder.decode(value, { stream: true }), carry)
        }
        if (!stopped) throw new Error('the stream ended')
      } catch (error) {
        reader = null
        expectNothing()
        if (stopped) return
        if (dropped) {
          /* Our own doing: straight back, with nothing to report. */
          retry = setTimer(connect, 0)
          return
        }
        if ((error as Error)?.name === 'AbortError') return
        failures += 1
        state('error')
        // Twice in a row and something in the middle does not want a held-open
        // connection. Ask until it changes its mind.
        if (failures >= 2) startPolling()
        retry = setTimer(connect, deps.retryDelay(failures))
      }
    }

    return {
      /* Not before the first listener: it brings the cursor to resume from,
         and a connection nobody is listening to is a connection to close. */
      start() {
        if (started || stopped) return
        started = true
        unwake = deps.onWake?.(drop) || null
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
        expectNothing()
        if (retry) clearTimer(retry)
        retry = null
        unwake?.()
        unwake = null
        abort?.abort()
        reader?.cancel().catch(() => {})
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
