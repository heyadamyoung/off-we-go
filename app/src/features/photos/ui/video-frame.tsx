import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from '../../../shared/ui/icon'
import { mediaPathOf } from '../../../media-refresh-core'
import { refreshMediaUrl } from '../../../media-links'
import { browserPowers, playbackPlan } from '../../../hls-playback-core'
import useHls from '../model/use-hls'
import { track } from '../../../shared/lib/telemetry'
import type { TripPhoto } from '../../../shared/model/types'

/* A film in the viewer, in whichever form this browser can actually play.

   A film is stored twice: a ladder of renditions a player moves between as the
   line changes, and one MP4 that plays anywhere. Adaptive wherever it is
   possible — somebody walking out of hotel wifi should drop to a smaller
   picture rather than stop — and the single file wherever it is not, which is
   exactly what used to happen and still works.

   Two things can go wrong, and they want opposite answers. A link that aged
   out is not a broken video at all: the bytes are there and this reader may
   have them, so it asks for a fresh link and carries on. A film this browser
   cannot decode is real, and it used to be a black rectangle with a scrubber
   that never moved. It is better to say what happened and offer the file than
   to let somebody poke at a dead player. */
export default function VideoFrame({ photo }: { photo: TripPhoto }) {
  const [video, setVideo] = useState<HTMLVideoElement | null>(null)
  const [src, setSrc] = useState(photo.src || '')
  const [streamFailed, setStreamFailed] = useState(false)
  const [dead, setDead] = useState(false)
  const retried = useRef(false)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  // A different film in the same frame starts its own life.
  useEffect(() => {
    setSrc(photo.src || '')
    setStreamFailed(false)
    setDead(false)
    retried.current = false
  }, [photo.id, photo.src])

  /* Asked of the browser rather than guessed from its name, and asked before
     anything is fetched: there is no sense pulling forty megabytes down a
     phone line to discover the decoder was never going to take it. */
  const powers = browserPowers(undefined, photo.mime)
  const film = { src, hlsSrc: streamFailed ? null : photo.hlsSrc, mime: photo.mime }
  const plan = playbackPlan(film, powers)

  const onFatal = useCallback((reason: string) => {
    if (!alive.current) return
    /* Down to the single file, which is what this played before there were
       renditions at all. Counted, because a stream that always falls back is
       a ladder nobody is getting any benefit from. */
    track('video stream fell back', { why: reason.slice(0, 60) })
    setStreamFailed(true)
  }, [])
  useHls(video, { plan, onFatal })

  /* Still being converted. The bytes exist and would even play for whoever
     filmed them, but they are about to be replaced by ones that play for
     everybody, and starting the old file now would only be interrupted. */
  if (photo.status === 'pending' || photo.status === 'working') {
    return (
      <div className="flex max-w-md flex-col items-center gap-3 rounded-2xl bg-black/40 p-8 text-center">
        <span className="size-2 animate-pulse rounded-full bg-white/70" />
        <b className="text-sm text-white">Getting this video ready</b>
        <p className="text-xs text-white/70">
          It is being converted so it plays on everyone’s phone, not just the one that filmed it.
          This appears on its own when it is done.
        </p>
      </div>
    )
  }

  if (dead || plan.via === 'none') {
    return (
      <div className="flex max-w-md flex-col items-center gap-3 rounded-2xl bg-black/40 p-8 text-center">
        <Icon n="video" s={30} c="#f2f4f8" />
        <b className="text-sm text-white">This video will not play in this browser</b>
        <p className="text-xs text-white/70">
          {photo.mime === 'video/quicktime'
            ? 'iPhones film in a format only Apple devices decode. It plays in Safari, and the file itself is untouched.'
            : 'The format it was filmed in is one this browser cannot decode. The file itself is untouched.'}
        </p>
        {src && (
          <a
            className="rounded-lg bg-white/15 px-4 py-2 text-xs font-bold text-white hover:bg-white/25"
            href={src}
            target="_blank"
            rel="noreferrer">
            Open the file
          </a>
        )}
      </div>
    )
  }

  return (
    <video
      /* Keyed on the form as well as the film: falling back from a stream to
         the file has to build a new element, because a media element that has
         had a script player attached does not forget it. */
      key={`${photo.id}:${plan.via}`}
      ref={setVideo}
      className="main"
      /* hls.js feeds the element itself; setting a source as well would have
         the browser fetch a playlist it cannot read. */
      src={plan.via === 'hls.js' ? undefined : plan.src}
      poster={photo.posterSrc || undefined}
      controls
      playsInline
      preload="metadata"
      onError={() => {
        /* Only the element's own fetches land here — a script player reports
           its troubles through its own error channel. An expired link and an
           undecodable film arrive as the same bare event, so the link is ruled
           out first: it is both the likelier cause and the one that heals. */
        if (!retried.current && mediaPathOf(plan.src)) {
          retried.current = true
          track('media link expired', { kind: 'video' })
          void refreshMediaUrl(plan.src).then(fresh => {
            if (!alive.current) return
            if (!fresh) return setDead(true)
            if (plan.via === 'file') setSrc(fresh)
            // A stale playlist link: the file is still there to fall back to.
            else onFatal('the playlist link expired')
          })
          return
        }
        if (plan.via !== 'file') return onFatal('the stream would not play')
        track('video undecodable', { mime: photo.mime || 'unknown' })
        setDead(true)
      }}>
      <track kind="captions" />
    </video>
  )
}
