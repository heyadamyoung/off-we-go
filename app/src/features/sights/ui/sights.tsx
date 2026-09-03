import { useCallback, useEffect, useState } from 'react'
import { articleSummary, attractionThumb } from '../../map'
import { findSights, type SightPlace } from '../api/find-sights'
import { imageForPage, radiusForView } from '../api/nearby-places'
import Icon from '../../../shared/ui/icon'
import { appErrorMessage } from '../../../user-messages-core'
import type { Attraction, MapView, Stop, Toast } from '../../../shared/model/types'

type ArticleSummary = NonNullable<Awaited<ReturnType<typeof articleSummary>>>

/* The card that opens when somebody taps an attraction pin on the map. */
function AttractionCard({
  poi,
  canEdit,
  inTrip,
  onAdd,
  onClose,
}: {
  poi: Attraction
  canEdit: boolean
  inTrip: boolean
  onAdd: (poi: Attraction) => void | Promise<void>
  onClose: () => void
}) {
  const [more, setMore] = useState<ArticleSummary | null>(null)
  const [adding, setAdding] = useState(false)

  /* A seeded pin already carries its paragraph, so the card is complete the
     moment it opens. Only a pin the seeder never reached goes and asks. */
  useEffect(() => {
    if (poi.t) {
      setMore(null)
      return
    }
    let alive = true
    setMore(null)
    articleSummary(poi.id)
      .then(m => {
        if (alive) setMore(m)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [poi.id, poi.t])

  const picture = more?.image || attractionThumb(poi.f)
  const note = poi.t || more?.note || ''
  // A page id resolves to its article on its own, so the link costs no request.
  const source = more?.source || `https://en.wikipedia.org/?curid=${poi.id}`

  return (
    <div
      className="acard sheet rise absolute bottom-[var(--trip-1)] left-1/2 z-[9] flex w-[320px]
                    max-h-[calc(100%_-_var(--trip-top)_-_var(--trip-1)_-_12px)] -translate-x-1/2 flex-col
                    overflow-hidden rounded-2xl max-sm:inset-x-4 max-sm:w-auto max-sm:translate-x-0">
      <button
        className="ax absolute right-2.5 top-2.5 z-10 grid size-7 place-items-center rounded-lg
                         bg-black/60 text-white"
        onClick={onClose}
        title="Close">
        <Icon n="x" s={14} />
      </button>
      {picture && (
        <div className="apic h-[132px] flex-none overflow-hidden bg-raised2">
          <img src={picture} alt="" decoding="async" className="size-full object-cover" />
        </div>
      )}
      <div className="abody flex flex-col gap-1.5 overflow-y-auto p-4">
        <b className="text-base font-extrabold tracking-[-.01em]">{poi.n}</b>
        <span className="kind text-[11px] font-semibold text-accent">{poi.d}</span>
        <p className="m-0 line-clamp-4 text-xs leading-relaxed text-muted">{note}</p>
        <div className="aacts mt-1 flex gap-1.5">
          {canEdit && (
            <button
              className="mini mini-accent"
              disabled={inTrip || adding}
              onClick={async () => {
                setAdding(true)
                await onAdd({ ...poi, image: picture, source, note })
                setAdding(false)
              }}>
              {inTrip ? 'In your trip' : adding ? 'Adding…' : 'Add to trip'}
            </button>
          )}
          <a className="mini" href={source} target="_blank" rel="noopener noreferrer">
            Wikipedia
          </a>
        </div>
      </div>
    </div>
  )
}

/* The body of the "Sights nearby" panel. The panel around it supplies the
   heading and the way out, so this is only ever the list. */
export interface SightsListProps {
  centre: MapView
  stops: Stop[]
  canEdit: boolean
  onAdd: (place: SightPlace) => void | Promise<void>
  onShow: (place: SightPlace) => void
  toast: Toast
}

function SightsList({ centre, stops, canEdit, onAdd, onShow, toast }: SightsListProps) {
  const [items, setItems] = useState<SightPlace[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [added, setAdded] = useState<Set<string>>(() => new Set())

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const found = await findSights({
        lng: centre.center[0],
        lat: centre.center[1],
        radius: Math.max(1200, radiusForView(centre.zoom, centre.center[1], window.innerWidth)),
        limit: 40,
      })
      setItems(found)
    } catch (e) {
      toast(appErrorMessage(e, 'search-places'), 'error')
    } finally {
      setBusy(false)
    }
  }, [centre, toast])

  // biome-ignore lint/correctness/useExhaustiveDependencies: search once when the panel opens; after that the Search button re-runs it on demand
  useEffect(() => {
    load()
  }, [])

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
        if (url)
          setItems(list => (list || []).map(p => (p.id === place.id ? { ...p, image: url } : p)))
      }
    })()
    return () => {
      alive = false
    }
  }, [items])

  const already = new Set(stops.map(s => (s.name || '').toLowerCase()))
  const list = items || []

  return (
    <>
      <div className="flex items-center justify-between gap-2 px-3 pb-1 pt-3">
        <p className="hint">Around the middle of the map, most visited first.</p>
        <button className="mini" onClick={load} disabled={busy}>
          {busy ? 'Searching…' : 'Search this area'}
        </button>
      </div>
      {!items && busy && <p className="hint px-3 py-2">Looking for sights around here…</p>}
      {items && !list.length && !busy && (
        <p className="hint px-3 py-2">
          Nothing found here. Move the map somewhere else and search again.
        </p>
      )}
      {list.map(pl => {
        const have = already.has(pl.name.toLowerCase()) || added.has(pl.id)
        return (
          <article className="sight flex gap-3 rounded-xl p-2.5 hover:bg-raised2" key={pl.id}>
            <div className="relative size-[88px] flex-none overflow-hidden rounded-xl bg-raised">
              {pl.image ? (
                <img
                  src={pl.image}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="size-full object-cover"
                />
              ) : (
                <span className="grid size-full place-items-center text-faint">
                  <Icon n={pl.icon} s={22} />
                </span>
              )}
              {pl.metres != null && (
                <em
                  className="absolute bottom-1.5 left-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px]
                               font-bold not-italic text-white">
                  {pl.metres < 1000 ? pl.metres + ' m' : (pl.metres / 1000).toFixed(1) + ' km'}
                </em>
              )}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              {/* The name carries the attribution the licence asks for; a
                  separate "Wikipedia" link only crowded the buttons out. */}
              {pl.source ? (
                <a
                  className="sname text-sm font-bold text-ink"
                  href={pl.source}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Read about it on Wikipedia">
                  {pl.name}
                </a>
              ) : (
                <b className="sname text-sm font-bold">{pl.name}</b>
              )}
              {pl.kind && <span className="text-[11px] font-semibold text-accent">{pl.kind}</span>}
              <p className="m-0 line-clamp-3 text-xs leading-relaxed text-muted">{pl.note}</p>
              <div className="sacts mt-1 flex gap-1.5">
                <button className="mini" onClick={() => onShow(pl)}>
                  Show on map
                </button>
                {canEdit && (
                  <button
                    className="mini mini-accent"
                    disabled={have}
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
    </>
  )
}

export { AttractionCard, SightsList }
