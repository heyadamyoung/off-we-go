import { useCallback, useEffect, useState } from 'react'
import { articleSummary, attractionThumb } from '../../map'
import { findSights } from '../api/find-sights'
import { imageForPage, radiusForView } from '../api/nearby-places'
import Icon from '../../../shared/ui/icon'
import Pane from '../../../shared/ui/pane'

function AttractionCard({ poi, canEdit, inTrip, onAdd, onClose }: any) {
  const [more, setMore] = useState(null)
  const [adding, setAdding] = useState(false)

  /* A seeded pin already carries its paragraph, so the card is complete the
     moment it opens. Only a pin the seeder never reached goes and asks. */
  useEffect(() => {
    if (poi.t) { setMore(null); return }
    let alive = true
    setMore(null)
    articleSummary(poi.id).then(m => { if (alive) setMore(m) }).catch(() => {})
    return () => { alive = false }
  }, [poi.id, poi.t])

  const picture = more?.image || attractionThumb(poi.f)
  const note = poi.t || more?.note || ''
  // A page id resolves to its article on its own, so the link costs no request.
  const source = more?.source || `https://en.wikipedia.org/?curid=${poi.id}`

  return (
    <div className="acard">
      <button className="ax" onClick={onClose} title="Close"><Icon n="x" s={15} w={2} /></button>
      {picture && <div className="apic"><img src={picture} alt="" decoding="async" /></div>}
      <div className="abody">
        <b>{poi.n}</b>
        <span className="kind">{poi.d}</span>
        <p>{note}</p>
        <div className="aacts">
          {canEdit && (
            <button className="wbtn sm hot" disabled={inTrip || adding}
              onClick={async () => { setAdding(true); await onAdd({ ...poi, image: picture, source, note }); setAdding(false) }}>
              {inTrip ? 'In your trip' : adding ? 'Adding…' : 'Add to trip'}
            </button>
          )}
          <a className="wbtn sm" href={source} target="_blank" rel="noopener noreferrer">Wikipedia</a>
        </div>
      </div>
    </div>
  )
}

function SightsView({ centre, stops, canEdit, onAdd, onShow, onClose }: any) {
  const [items, setItems] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [added, setAdded] = useState(() => new Set())

  const load = useCallback(async () => {
    setBusy(true); setError(null)
    try {
      const found = await findSights({
        lng: centre.center[0], lat: centre.center[1],
        radius: Math.max(1200, radiusForView(centre.zoom, centre.center[1], window.innerWidth)),
        limit: 40,
      })
      setItems(found)
    } catch (e) {
      setError(e.message || 'Could not reach Wikipedia')
    } finally { setBusy(false) }
  }, [centre])

  useEffect(() => { load() }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  /* A handful of articles lead with a logo rather than a photograph — the Van
     Gogh Museum is one — and the picture filter correctly rejects it, leaving a
     blank card. Go looking inside those articles afterwards, so the list is not
     held up waiting for the exceptions. */
  useEffect(() => {
    if (!items) return
    const blank = items.filter(p => !p.image && p.pageTitle).slice(0, 12)
    if (!blank.length) return
    let alive = true
    ;(async () => {
      for (const place of blank) {
        const url = await imageForPage(place.pageTitle).catch(() => null)
        if (!alive) return
        if (url) setItems(list => list.map(p => (p.id === place.id ? { ...p, image: url } : p)))
      }
    })()
    return () => { alive = false }
  }, [items])

  const already = new Set(stops.map(s => (s.name || '').toLowerCase()))
  const list = items || []

  return (
    <Pane
      title="Sights nearby"
      sub="Around the middle of the map, most visited first — not merely the nearest."
      onClose={onClose}
      actions={<button className="wbtn" onClick={load} disabled={busy}>
        <Icon n="search" s={15} />{busy ? 'Searching…' : 'Search this area'}
      </button>}>

      {error && <p className="swarn">{error}</p>}
      {!items && busy && <p className="snote">Looking for sights around here…</p>}
      {items && !list.length && !busy && (
        <p className="snote">Nothing found here. Move the map somewhere else and search again.</p>
      )}

      <div className="sights">
        {list.map(pl => {
          const have = already.has(pl.name.toLowerCase()) || added.has(pl.id)
          return (
            <article className="sight" key={pl.id}>
              <div className="spic">
                {pl.image
                  ? <img src={pl.image} alt="" loading="lazy" decoding="async" />
                  : <span className="none"><Icon n={pl.icon} s={22} c="var(--ink3)" /></span>}
                {pl.metres != null && <em>{pl.metres < 1000
                  ? pl.metres + ' m' : (pl.metres / 1000).toFixed(1) + ' km'}</em>}
              </div>
              <div className="sbody">
                {/* The name carries the attribution the licence asks for; a
                    separate "Wikipedia" link only crowded the buttons out. */}
                {pl.source
                  ? <a className="sname" href={pl.source} target="_blank" rel="noopener noreferrer"
                       title="Read about it on Wikipedia">{pl.name}</a>
                  : <b className="sname">{pl.name}</b>}
                {pl.kind && <span className="kind">{pl.kind}</span>}
                <p>{pl.note}</p>
                <div className="sacts">
                  <button className="wbtn sm" onClick={() => onShow(pl)}>Show on map</button>
                  {canEdit && (
                    <button className="wbtn sm hot" disabled={have}
                            onClick={async () => {
                              await onAdd(pl)
                              setAdded(a => new Set(a).add(pl.id))
                            }}>
                      {have ? 'In your trip' : 'Add to trip'}
                    </button>
                  )}
                </div>
              </div>
            </article>
          )
        })}
      </div>
    </Pane>
  )
}

export { AttractionCard, SightsView }



