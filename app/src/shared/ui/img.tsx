import { memo, useEffect, useState, type CSSProperties } from 'react'
import { pic, picFallback } from '../../data'

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
  item.src || (item.kw ? pic(item.kw, item.lock, w, h) : picFallback(item.seed || item.id, w, h))

interface ImgProps {
  item: ImageItem
  w?: number
  h?: number
  className?: string
  style?: CSSProperties
  alt?: string
  eager?: boolean
}

const Img = memo(function Img({ item, w = 800, h = 600, className, style, alt = '', eager = false }: ImgProps) {
  const first = srcFor(item, w, h)
  const [src, setSrc] = useState(first)
  const [ready, setReady] = useState(() => SEEN.has(first))

  useEffect(() => {
    const next = srcFor(item, w, h)
    setSrc(next)
    setReady(SEEN.has(next))
  }, [item.id, item.src, item.kw, item.lock, w, h])

  const cls = 'im' + (ready ? ' rdy' : '') + (className ? ' ' + className : '')
  return (
    <img className={cls} style={style} src={src} alt={alt} draggable={false}
      loading={eager ? 'eager' : 'lazy'} decoding="async"
      {...(eager ? { fetchpriority: 'high' } : {})}
      onLoad={() => { SEEN.add(src); setReady(true) }}
      onError={() => {
        if (item.src) return
        const fb = picFallback(item.seed || item.id, w, h)
        if (fb !== src) setSrc(fb)
      }} />
  )
})

export default Img


