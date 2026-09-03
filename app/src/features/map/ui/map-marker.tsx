import { useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Marker, type Map as MapLibreMap } from 'maplibre-gl'
import { clamp } from '../../../shared/lib/numbers'
import type { Coordinates } from '../../../shared/model/types'

interface MapMarkerProps {
  map: MapLibreMap
  lng: number
  lat: number
  draggable?: boolean
  onDragEnd?: (point: Coordinates) => void
  children: ReactNode
}

function MapMarker({ map, lng, lat, draggable = false, onDragEnd, children }: MapMarkerProps) {
  const elRef = useRef<HTMLDivElement | null>(null)
  if (!elRef.current && typeof document !== 'undefined') {
    const d = document.createElement('div')
    d.style.width = '0'
    d.style.height = '0'
    elRef.current = d
  }
  const mk = useRef<Marker | null>(null)
  const dragRef = useRef(onDragEnd)
  dragRef.current = onDragEnd

  // biome-ignore lint/correctness/useExhaustiveDependencies: the marker is created once per map; position changes ride the setLngLat effect below
  useEffect(() => {
    if (!map || !elRef.current) return
    const m = new Marker({ element: elRef.current, anchor: 'center' })
      .setLngLat([lng, lat])
      .addTo(map)
    m.on('dragend', () => {
      const l = m.getLngLat()
      dragRef.current?.([l.lng, l.lat])
    })
    mk.current = m
    return () => {
      m.remove()
      mk.current = null
    }
  }, [map])

  useEffect(() => {
    mk.current?.setLngLat([lng, lat])
  }, [lng, lat])
  useEffect(() => {
    mk.current?.setDraggable(!!draggable)
  }, [draggable])
  return elRef.current ? createPortal(children, elRef.current) : null
}

// The live fix jumps every few seconds; ease between them so the family marker
// walks rather than teleports.
function useGliding(target: Coordinates, ms = 800): Coordinates {
  const [pt, setPt] = useState(target)
  const from = useRef<Coordinates>(target)
  const raf = useRef(0)
  useEffect(() => {
    if (!target) return
    const a = from.current || target
    if (a[0] === target[0] && a[1] === target[1]) {
      from.current = target
      return
    }
    const t0 = performance.now()
    const tick = () => {
      const t = clamp((performance.now() - t0) / ms, 0, 1)
      const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
      const next: Coordinates = [a[0] + (target[0] - a[0]) * e, a[1] + (target[1] - a[1]) * e]
      from.current = next
      setPt(next)
      if (t < 1) raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [target, ms])
  return pt || target
}

interface LiveMarkerProps {
  map: MapLibreMap
  lng: number
  lat: number
  avatar: string | null
  name: string
  title: string
  stale: boolean
  onClick?: () => void
  /** true while a map drag is in flight — a drag must not count as a click */
  movedRef: MutableRefObject<boolean>
}

// One phone on the map — or, with no phone reporting, the family's best-known
// position. Eased between fixes so it walks rather than teleports. A phone that
// has gone quiet keeps its dot at the last place it was heard from, dimmed and
// without the pulse: out of signal is not the same as gone.
function LiveMarker({
  map,
  lng,
  lat,
  avatar,
  name,
  title,
  stale,
  onClick,
  movedRef,
}: LiveMarkerProps) {
  const target = useMemo<Coordinates>(() => [lng, lat], [lng, lat])
  const pt = useGliding(target, 800)
  return (
    <MapMarker map={map} lng={pt[0]} lat={pt[1]}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a map pin is the pointer route; the people rail is the keyboard route */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: a map pin is the pointer route; the people rail is the keyboard route */}
      <div
        className={'mme' + (stale ? ' quiet' : '')}
        title={title}
        onClick={e => {
          e.stopPropagation()
          if (!movedRef.current) onClick?.()
        }}>
        {!stale && <span className="halo" />}
        {avatar ? (
          <img src={avatar} alt="" draggable={false} />
        ) : (
          <span className="ini">{(name || '?')[0]}</span>
        )}
        <span className="dot" />
        {!stale && <span className="tag">LIVE</span>}
      </div>
    </MapMarker>
  )
}

export { LiveMarker, MapMarker }
