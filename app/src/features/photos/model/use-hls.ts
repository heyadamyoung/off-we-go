import { useEffect, useRef } from 'react'
import type { PlaybackPlan } from '../../../hls-playback-core'
import { mediaPathOf } from '../../../media-refresh-core'
import { refreshMediaUrl } from '../../../media-links'

/* Attaching a script player to a video element, and taking it away again.

   The library is a couple of hundred kilobytes and most people watching a trip
   never open a film, so it is fetched the first time one is actually played
   rather than shipped with the app. Everything about that is asynchronous, and
   the thing it is being attached to may well be gone by the time it lands —
   somebody swiped to the next photograph — so every step checks that it still
   has an element to attach to.

   Errors are the interesting part. A stale link and a broken film arrive as
   the same fatal event, and they want opposite things: the first heals by
   asking for a fresh link, the second by giving up on the stream and playing
   the single file instead. Getting that the wrong way round is a film that
   spins for ever, which is what this exists to prevent. */

interface UseHlsOptions {
  plan: PlaybackPlan
  /** Give up on streaming; the caller falls back to the single file. */
  onFatal: (reason: string) => void
}

export default function useHls(
  video: HTMLVideoElement | null,
  { plan, onFatal }: UseHlsOptions,
): void {
  const healed = useRef(false)

  useEffect(() => {
    healed.current = false
  }, [plan.src])

  useEffect(() => {
    if (!video || plan.via !== 'hls.js' || !plan.src) return
    let alive = true
    // biome-ignore lint/suspicious/noExplicitAny: the library is loaded lazily and has no type here
    let player: any = null
    let recovered = false

    void import('hls.js').then(module => {
      const Hls = module.default
      if (!alive || !Hls?.isSupported?.()) {
        if (alive) onFatal('hls.js cannot run here')
        return
      }
      player = new Hls({
        /* A trip is watched on a phone on somebody else's wifi. Starting low
           and climbing is the difference between a film that begins now and
           one that begins in four seconds at a quality nobody asked for. */
        startLevel: -1,
        capLevelToPlayerSize: true,
        // The link itself is time-limited; retrying past it is retrying a 403.
        manifestLoadingMaxRetry: 2,
        levelLoadingMaxRetry: 2,
        fragLoadingMaxRetry: 3,
      })
      player.on(Hls.Events.ERROR, (_event: unknown, data: { fatal?: boolean; type?: string }) => {
        if (!data?.fatal || !alive) return
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          /* The likelier of the two causes, and the one that fixes itself: the
             signed link aged out while the film sat unopened in a tab. Asked
             for once — a second failure is the film, not the link. */
          if (!healed.current && mediaPathOf(plan.src)) {
            healed.current = true
            void refreshMediaUrl(plan.src).then(fresh => {
              if (!alive) return
              if (fresh) player.loadSource(fresh)
              else onFatal('the link could not be refreshed')
            })
            return
          }
          onFatal('the stream could not be fetched')
          return
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !recovered) {
          // One go at a decoder that lost its place; it usually works.
          recovered = true
          player.recoverMediaError()
          return
        }
        onFatal(`the stream failed: ${data.type || 'unknown'}`)
      })
      player.loadSource(plan.src)
      player.attachMedia(video)
    })

    return () => {
      alive = false
      player?.destroy?.()
    }
  }, [video, plan.via, plan.src, onFatal])
}
