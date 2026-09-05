import { useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Marker, type Map as MapLibreMap } from 'maplibre-gl'
import { turnTowards } from '../../../compass-core'
import type { PhoneMarker } from '../../../live-markers-core'
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

/* A rendered needle must turn the short way round: the rotation it is handed
   is cumulative, each new heading adding only its signed short turn, so the
   CSS transition never pirouettes through 340° to move 20°. */
function useTurned(heading: number | null): number | null {
  const cumulative = useRef<number | null>(null)
  if (heading == null) cumulative.current = null
  else cumulative.current = turnTowards(cumulative.current, heading)
  return cumulative.current
}

interface LiveMarkerProps {
  map: MapLibreMap
  m: PhoneMarker
  /** compass facing for the traveller's own phone; overrides the GPS course */
  facing?: number | null
  onClick?: () => void
  /** true while a map drag is in flight — a drag must not count as a click */
  movedRef: MutableRefObject<boolean>
}

// One phone on the map — or, with no phone reporting, the family's best-known
// position. Eased between fixes so it walks rather than teleports. A phone that
// has gone quiet keeps its dot at the last place it was heard from, dimmed and
// without the pulse: out of signal is not the same as gone.
function LiveMarker({ map, m, facing, onClick, movedRef }: LiveMarkerProps) {
  const target = useMemo<Coordinates>(() => [m.lng, m.lat], [m.lng, m.lat])
  const pt = useGliding(target, 800)
  const beam = useTurned(facing ?? m.course)
  return (
    <MapMarker map={map} lng={pt[0]} lat={pt[1]}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a map pin is the pointer route; the people rail is the keyboard route */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: a map pin is the pointer route; the people rail is the keyboard route */}
      <div
        className={'mme' + (m.stale ? ' quiet' : '')}
        title={m.title}
        onClick={e => {
          e.stopPropagation()
          if (!movedRef.current) onClick?.()
        }}>
        {beam != null && (
          <span className="beam" style={{ transform: `rotate(${beam}deg)` }} aria-hidden="true" />
        )}
        {!m.stale && <span className="halo" />}
        {m.avatar ? (
          <img src={m.avatar} alt="" draggable={false} />
        ) : (
          <span className="ini">{(m.name || '?')[0]}</span>
        )}
        <span className="dot" />
        {!m.stale && <span className="tag">LIVE</span>}
      </div>
    </MapMarker>
  )
}

/* The web tab is nobody's registered phone, so when its owner arms the compass
   there is no avatar to wear the beam — a small plain dot at the browser's own
   position wears it instead. */
function YouBeam({
  map,
  at,
  facing,
}: {
  map: MapLibreMap
  at: Coordinates
  facing: number | null
}) {
  const beam = useTurned(facing)
  return (
    <MapMarker map={map} lng={at[0]} lat={at[1]}>
      <div className="youb" title="You">
        {beam != null && (
          <span className="beam" style={{ transform: `rotate(${beam}deg)` }} aria-hidden="true" />
        )}
        <span className="core" />
      </div>
    </MapMarker>
  )
}

export { LiveMarker, MapMarker, YouBeam }
