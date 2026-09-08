import { useEffect, useRef, useState } from 'react'
import Icon from '../../../shared/ui/icon'
import { mediaPathOf } from '../../../media-refresh-core'
import { refreshMediaUrl } from '../../../media-links'
import { canProbablyPlay } from '../../../mobile-videos-core'
import { track } from '../../../shared/lib/telemetry'
import type { TripPhoto } from '../../../shared/model/types'

/* A film in the viewer, and the two ways it can fail to be one.

   The first is a link that aged out, which is not a broken video at all — the
   bytes are there and this reader may have them, so it asks for a fresh link
   and carries on. The second is real: an iPhone films in HEVC inside a .mov,
   and Chrome and Android will not decode it. That used to be a black
   rectangle with a scrubber that never moved. It is better to say what
   happened and offer the file than to let somebody poke at a dead player. */
export default function VideoFrame({ photo }: { photo: TripPhoto }) {
  const [src, setSrc] = useState(photo.src || '')
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
    setDead(false)
    retried.current = false
  }, [photo.src])

  /* Asked before anything is fetched: there is no sense pulling forty
     megabytes down a phone line to discover the decoder was never going to
     take it. An empty answer from canPlayType is the browser saying no. */
  const playable = canProbablyPlay(photo.mime)

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

  if (dead || !playable) {
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
      key={photo.id}
      className="main"
      src={src}
      poster={photo.posterSrc || undefined}
      controls
      playsInline
      preload="metadata"
      onError={() => {
        /* An expired link and an undecodable film both arrive here as the
           same bare event, so the link is ruled out first — it is both the
           likelier cause and the one that fixes itself. */
        if (!retried.current && mediaPathOf(src)) {
          retried.current = true
          track('media link expired', { kind: 'video' })
          void refreshMediaUrl(src).then(fresh => {
            if (!alive.current) return
            if (fresh) setSrc(fresh)
            else setDead(true)
          })
          return
        }
        track('video undecodable', { mime: photo.mime || 'unknown' })
        setDead(true)
      }}>
      <track kind="captions" />
    </video>
  )
}
