import { memo, useEffect, useRef, useState, type CSSProperties } from 'react'
import { pic, picFallback } from '../../data'
import { tileLoading } from '../../img-loading-core'
import { copyFor, drawn } from '../../media-copy-core'
import { keepPhotoOffline, recallPhotoUrl } from '../../offline-photos-core'
import { mediaPathOf } from '../../media-refresh-core'
import { refreshMediaUrl } from '../../media-links'
import { track } from '../lib/telemetry'

export const SEEN = new Set<string>()
const seen = (url: string) => SEEN.has(url)
// Rows that came from a database have no placeholder keywords, so fall back to
// a stable per-id image rather than requesting `undefined`.
interface ImageItem {
  id: string
  src?: string | null
  /** The small copy of the same picture, when the server made one. */
  thumbSrc?: string | null
  kw?: string
  lock?: number
  seed?: string
  /* Only so a failure can be counted as a photograph's or a film's. Not
     `kind` — a Stop already means something else by that. */
  mediaKind?: 'photo' | 'video'
}

/** The copy this box should end up showing, or a placeholder if there is none. */
export const srcFor = (item: ImageItem, w: number, h: number) =>
  copyFor(item, Math.max(w, h)) ||
  (item.kw ? pic(item.kw, item.lock ?? 0, w, h) : picFallback(item.seed || item.id, w, h))

/* What is in the element, what it should end up being, and whether anybody
   had to wait for it.

   The three change together, which is why they are one value. A picture that
   kept somebody waiting fades up over the space its shimmer was holding; one
   that was already in hand must simply appear. Fading the second sort is what
   made paging through a preloaded strip look exactly like loading. */
type Phase = 'waiting' | 'fade' | 'set'
interface Shown {
  src: string
  want: string
  phase: Phase
}

function opening(item: ImageItem, w: number, h: number): Shown {
  const want = srcFor(item, w, h)
  /* The small copy may stand in while the big one comes down — and only ever
     borrows: `want` does not change, so the picture still sharpens. */
  const now = drawn({ src: want, thumbSrc: item.thumbSrc }, Math.max(w, h), seen)
  const src = now?.show || want
  return { src, want, phase: seen(src) ? 'set' : 'waiting' }
}

interface ImgProps {
  item: ImageItem
  w?: number
  h?: number
  className?: string
  style?: CSSProperties
  alt?: string
  /** The one picture on screen: load it now and ahead of everything else. */
  eager?: boolean
  /** A parent that windows its children has already decided this is visible. */
  now?: boolean
}

const Img = memo(function Img({
  item,
  w = 800,
  h = 600,
  className,
  style,
  alt = '',
  eager = false,
  now = false,
}: ImgProps) {
  const [shown, setShown] = useState(() => opening(item, w, h))
  /* Pulled apart here rather than inside the effects below: a hook that
     captures the whole of `shown` re-runs whenever any part of it moves,
     and the part that moves most is the one neither effect cares about. */
  const { src, want } = shown

  /* A blob: URL only exists while this element is showing one; letting it
     outlive the element would hold the photograph's bytes in memory for the
     life of the tab. */
  const held = useRef<string | null>(null)
  const alive = useRef(true)
  /* One refresh per tile. Without this a link the server keeps refusing —
     a deleted photograph, a path this reader may not read — becomes an
     endless error/refresh loop against the API. */
  const retried = useRef(false)
  useEffect(
    () => () => {
      alive.current = false
      if (held.current) URL.revokeObjectURL(held.current)
      held.current = null
    },
    [],
  )

  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the fields that build the URL; the item object itself is rebuilt by every parent render
  useEffect(() => {
    setShown(was => {
      const next = opening(item, w, h)
      if (was.src === next.src && was.want === next.want) return was
      if (held.current) {
        URL.revokeObjectURL(held.current)
        held.current = null
      }
      retried.current = false
      return next
    })
  }, [item.id, item.src, item.thumbSrc, item.kw, item.lock, w, h])

  /* The one we actually want, fetched quietly behind the small copy standing
     in for it, and swapped in without a fade — it is the same photograph, and
     a picture dissolving into a sharper version of itself is a distraction
     rather than a flourish. */
  useEffect(() => {
    if (src === want) return
    let live = true
    const settle = (phase: Phase) => {
      if (live) setShown(was => (was.want === want ? { src: want, want, phase } : was))
    }
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => {
      SEEN.add(want)
      settle('set')
    }
    /* A link that will not load is the <img> element's own business: it knows
       how to ask for a fresh one and how to fall back on what is offline. */
    image.onerror = () => settle('waiting')
    image.src = want
    return () => {
      live = false
    }
  }, [src, want])

  const cls =
    'im' +
    (shown.phase === 'waiting' ? '' : ' rdy') +
    (shown.phase === 'fade' ? ' up' : '') +
    (className ? ' ' + className : '')
  /* Read at render rather than held in state: a remounted tile asks afresh,
     which is exactly the moment the answer matters. */
  const plan = tileLoading({ seen: seen(src), eager, now })
  /* Whatever the element is showing is now the whole of its business: a
     replacement has no better copy waiting behind it. */
  const instead = (url: string) => setShown({ src: url, want: url, phase: 'waiting' })
  return (
    <img
      className={cls}
      style={style}
      src={src}
      alt={alt}
      draggable={false}
      {...plan}
      onLoad={() => {
        SEEN.add(src)
        setShown(was => (was.phase === 'waiting' ? { ...was, phase: 'fade' } : was))
        // Keep a copy of what was actually looked at, for the next time there
        // is no signal. Ignores anything that is not our own media.
        if (!src.startsWith('blob:')) void keepPhotoOffline(src)
      }}
      onError={() => {
        /* A stand-in that will not load is not worth healing: the picture it
           was standing in for is already on its way, and asking for a fresh
           link to the small copy would leave the viewer on it for good. Hand
           the element over to the one it was waiting for. */
        if (src !== want) {
          setShown({ src: want, want, phase: 'waiting' })
          return
        }
        const failed = src
        /* A signed link outlives neither the day nor a trip left open, and the
           payload carrying it is fetched once. Ask for a fresh one before
           concluding the photograph is gone — this is the single commonest
           reason a tile is grey, and it heals itself. */
        if (!retried.current && mediaPathOf(failed)) {
          retried.current = true
          track('media link expired', { kind: item.mediaKind || 'photo' })
          void refreshMediaUrl(failed).then(fresh => {
            if (!fresh || !alive.current) return
            SEEN.delete(failed)
            instead(fresh)
          })
          return
        }
        /* The usual other reason a photograph fails is that there is no
           connection — and the usual case for this app is that the reader is
           abroad. If we kept these bytes when they were last seen, show them. */
        void recallPhotoUrl(failed).then(blobUrl => {
          if (!blobUrl) {
            // Nothing left to try: say so once, with enough to group by.
            track('media unavailable', {
              kind: item.mediaKind || 'photo',
              own: mediaPathOf(failed) ? 'yes' : 'no',
            })
            return
          }
          /* Scrolling a grid offline starts one of these per picture. The ones
             that land after their element has gone would otherwise be assigned
             to a ref nothing will ever revoke, pinning the bytes for the life
             of the tab. */
          if (!alive.current) {
            URL.revokeObjectURL(blobUrl)
            return
          }
          if (held.current) URL.revokeObjectURL(held.current)
          held.current = blobUrl
          instead(blobUrl)
        })
        if (item.src) return
        const fb = picFallback(item.seed || item.id, w, h)
        if (fb !== src) instead(fb)
      }}
    />
  )
})

export default Img
