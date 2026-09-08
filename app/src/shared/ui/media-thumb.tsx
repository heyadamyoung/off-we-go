import type { CSSProperties } from 'react'
import Img from './img'
import { durationLabel } from '../../mobile-videos-core'
import type { TripPhoto } from '../model/types'

/* A filled triangle on a soft disc: the one mark every camera roll in the
   world uses to say "this one moves". Drawn rather than stroked, because the
   stroke set reads as a hairline at the 42px of a map marker. */
export function PlayBadge({ size = 26 }: { size?: number }) {
  return (
    <span
      className="pointer-events-none absolute inset-0 grid place-items-center"
      aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 32 32" role="presentation">
        <circle cx="16" cy="16" r="15" fill="rgb(0 0 0 / .48)" stroke="#fff" strokeWidth="1.5" />
        <path d="M13 10.5 22.5 16 13 21.5V10.5Z" fill="#fff" />
      </svg>
    </span>
  )
}

interface MediaThumbProps {
  item: TripPhoto
  w?: number
  h?: number
  className?: string
  style?: CSSProperties
  alt?: string
  eager?: boolean
  /** The badge is the whole point at grid size and noise at 30px in a row. */
  badge?: number | false
}

/* One tile for either kind of thing on a trip. A photograph is its own
   picture; a film is its poster frame with the play mark over it and its
   length in the corner — the same tile a phone's own camera roll draws, so
   nothing has to be learnt. A film whose poster would not decode still gets
   the mark, over the dark tile, rather than a stock picture of somewhere
   nobody went. */
export default function MediaThumb({
  item,
  w = 800,
  h = 600,
  className,
  style,
  alt = '',
  eager = false,
  badge = 26,
}: MediaThumbProps) {
  if (item.kind !== 'video')
    return (
      <Img item={item} w={w} h={h} className={className} style={style} alt={alt} eager={eager} />
    )

  const length = durationLabel(item.durationMs)
  return (
    <span className="relative block size-full" style={style}>
      {item.posterSrc ? (
        <Img
          item={{ id: item.id, src: item.posterSrc, mediaKind: 'video' }}
          w={w}
          h={h}
          className={className}
          alt={alt}
          eager={eager}
        />
      ) : (
        <span className={'block size-full bg-ink/85 ' + (className || '')} />
      )}
      {badge !== false && <PlayBadge size={badge} />}
      {length && badge !== false && badge >= 22 && (
        <span
          className="pointer-events-none absolute bottom-1 right-1 rounded-md bg-black/70 px-1
                     py-px text-[10px] font-bold tabular-nums text-white">
          {length}
        </span>
      )}
    </span>
  )
}
