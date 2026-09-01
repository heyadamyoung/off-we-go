import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Marker } from 'maplibre-gl'
import { clamp } from '../../../shared/lib/numbers'

function MapMarker({ map, lng, lat, draggable = false, onDragEnd, children }: any) {
  const elRef = useRef<any>(null)
  if (!elRef.current && typeof document !== 'undefined') {
    const d = document.createElement('div')
    d.style.width = '0'
    d.style.height = '0'
    elRef.current = d
  }
  const mk = useRef<any>(null)
  const dragRef = useRef(onDragEnd); dragRef.current = onDragEnd

  useEffect(() => {
    if (!map || !elRef.current) return
    const m = new Marker({ element: elRef.current, anchor: 'center' })
      .setLngLat([lng, lat]).addTo(map)
    m.on('dragend', () => { const l = m.getLngLat(); dragRef.current?.([l.lng, l.lat]) })
    mk.current = m
    return () => { m.remove(); mk.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map])

  useEffect(() => { mk.current?.setLngLat([lng, lat]) }, [lng, lat])
  useEffect(() => { mk.current?.setDraggable(!!draggable) }, [draggable])
  return elRef.current ? createPortal(children, elRef.current) : null
}

// The live fix jumps every few seconds; ease between them so the family marker
// walks rather than teleports.
function useGliding(target, ms = 800) {
  const [pt, setPt] = useState(target)
  const from = useRef(target)
  const raf = useRef(0)
  useEffect(() => {
    if (!target) return
    const a = from.current || target
    if (a[0] === target[0] && a[1] === target[1]) { from.current = target; return }
    const t0 = performance.now()
    const tick = () => {
      const t = clamp((performance.now() - t0) / ms, 0, 1)
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
      const next = [a[0] + (target[0] - a[0]) * e, a[1] + (target[1] - a[1]) * e]
      from.current = next
      setPt(next)
      if (t < 1) raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [target, ms])
  return pt || target
}


// One phone on the map — or, with no phone reporting, the family's best-known
// position. Eased between fixes so it walks rather than teleports.
function LiveMarker({ map, lng, lat, avatar, name, title, onClick, movedRef }: any) {
  const target = useMemo(() => [lng, lat], [lng, lat])
  const pt = useGliding(target, 800)
  return (
    <MapMarker map={map} lng={pt[0]} lat={pt[1]}>
      <div className="mme" title={title}
           onClick={e => { e.stopPropagation(); if (!movedRef.current) onClick?.() }}>
        <span className="halo" />
        {avatar ? <img src={avatar} alt="" draggable={false} />
                : <span className="ini">{(name || '?')[0]}</span>}
        <span className="dot" />
      </div>
    </MapMarker>
  )
}

export { LiveMarker, MapMarker }




