import { memo, useEffect, useRef, useState, type CSSProperties } from 'react'
import { pic, picFallback } from '../../data'
import { keepPhotoOffline, recallPhotoUrl } from '../../offline-photos-core'

export const SEEN = new Set<string>()
// Rows that came from a database have no placeholder keywords, so fall back to
// a stable per-id image rather than requesting `undefined`.
interface ImageItem {
  id: string
  src?: string | null
  kw?: string
  lock?: number
  seed?: string
}

export const srcFor = (item: ImageItem, w: number, h: number) =>
  item.src ||
  (item.kw ? pic(item.kw, item.lock ?? 0, w, h) : picFallback(item.seed || item.id, w, h))

interface ImgProps {
  item: ImageItem
  w?: number
  h?: number
  className?: string
  style?: CSSProperties
  alt?: string
  eager?: boolean
}

const Img = memo(function Img({
  item,
  w = 800,
  h = 600,
  className,
  style,
  alt = '',
  eager = false,
}: ImgProps) {
  const first = srcFor(item, w, h)
  const [src, setSrc] = useState(first)
  const [ready, setReady] = useState(() => SEEN.has(first))

  /* A blob: URL only exists while this element is showing one; letting it
     outlive the element would hold the photograph's bytes in memory for the
     life of the tab. */
  const held = useRef<string | null>(null)
  const alive = useRef(true)
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
    const next = srcFor(item, w, h)
    if (held.current) {
      URL.revokeObjectURL(held.current)
      held.current = null
    }
    setSrc(next)
    setReady(SEEN.has(next))
  }, [item.id, item.src, item.kw, item.lock, w, h])

  const cls = 'im' + (ready ? ' rdy' : '') + (className ? ' ' + className : '')
  return (
    <img
      className={cls}
      style={style}
      src={src}
      alt={alt}
      draggable={false}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      {...(eager ? { fetchPriority: 'high' as const } : {})}
      onLoad={() => {
        SEEN.add(src)
        setReady(true)
        // Keep a copy of what was actually looked at, for the next time there
        // is no signal. Ignores anything that is not our own media.
        if (!src.startsWith('blob:')) void keepPhotoOffline(src)
      }}
      onError={() => {
        /* The usual reason a photograph fails is that there is no connection —
           and the usual case for this app is that the reader is abroad. If we
           kept these bytes when they were last seen, show them. */
        void recallPhotoUrl(src).then(blobUrl => {
          if (!blobUrl) return
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
          setSrc(blobUrl)
        })
        if (item.src) return
        const fb = picFallback(item.seed || item.id, w, h)
        if (fb !== src) setSrc(fb)
      }}
    />
  )
})

export default Img
