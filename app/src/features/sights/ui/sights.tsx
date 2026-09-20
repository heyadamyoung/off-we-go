import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  isSightSort,
  SIGHT_SORT_KEY,
  SIGHT_SORTS,
  sightsListView,
  type SightSort,
} from '../../../sights-list-core'
import { articleSummary, attractionThumb } from '../../map'
import { isAbortError, placeById, PlaceAttribution, PlaceCredits } from '../../places'
import { cardFrom } from '../../../place-card-core'
import { addressLine, categoryWord, type Place } from '../../../places-core'
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
  const [place, setPlace] = useState<Place | null>(null)
  const [adding, setAdding] = useState(false)

  /* Which kind of pin this is. It used to be one kind — a Wikipedia page,
     whose numeric id was both identity and lookup. The map's pins come from
     the places layer now and their ids are ours, so asking Wikipedia about
     one fetched an unrelated page and the link under the card pointed at
     ?curid=<a uuid of ours>: dead, on somebody else's site. */
  const fromPlaces = typeof poi.id === 'string' && !/^\d+$/.test(poi.id)

  /* What the pin does not carry. A pin is a dot and a label — three hundred
     of them per view — so the address, the telephone number, the provenance
     and the picture live on the record behind it, and this is the tap that
     goes and gets them. Aborted when the card closes or the next pin is
     tapped: a slow answer for a card nobody is looking at must not overwrite
     the one they are. */
  useEffect(() => {
    if (!fromPlaces) return
    const controller = new AbortController()
    setPlace(null)
    placeById(String(poi.id), controller.signal)
      .then(found => {
        if (!controller.signal.aborted) setPlace(found)
      })
      .catch(error => {
        /* A record we cannot read leaves the card as the pin drew it: a name
           and a category, which is still a card and still true. */
        if (!isAbortError(error)) setPlace(null)
      })
    return () => controller.abort()
  }, [poi.id, fromPlaces])

  /* The legacy Wikipedia pin, for as long as one can still be drawn. */
  useEffect(() => {
    if (fromPlaces || poi.t) {
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
  }, [poi.id, poi.t, fromPlaces])

  /* What the card shows, and in what order — place-card-core states the
     precedence so it can be tested rather than inferred from a chain of
     fallbacks inside a component. */
  const { picture, note, source, credits } = cardFrom({
    pinNote: poi.t,
    pinPicture: attractionThumb(poi.f),
    about: place?.about,
    website: fromPlaces ? place?.website : null,
    article: fromPlaces
      ? null
      : { ...more, source: more?.source || `https://en.wikipedia.org/?curid=${poi.id}` },
  })
  /* What it is and where it is. `kind` is the category the pin already knew,
     so it is on screen before the record lands rather than appearing a beat
     later; the address can only come from the record. */
  const kind = fromPlaces ? categoryWord(place?.category || poi.k || 'other') : poi.d
  const where = place ? addressLine(place.address) : ''

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
        <span className="kind text-[11px] font-semibold text-accent">{kind}</span>
        {/* Where it is — the first thing anybody wants from a pin they
            tapped. Absent rather than a placeholder when upstream had no
            address: "Address unknown" reads as a card that is broken. */}
        {where && (
          <span className="awhere text-xs leading-snug text-muted">
            <Icon n="pin" s={11} /> {where}
          </span>
        )}
        {place?.phone && (
          <a className="aphone text-xs text-muted hover:text-fg" href={`tel:${place.phone}`}>
            {place.phone}
          </a>
        )}
        {note && <p className="m-0 line-clamp-4 text-xs leading-relaxed text-muted">{note}</p>}
        {/* The notice, under the thing it is about. Not optional and not a
            footnote elsewhere: a CC BY-SA photograph obliges us to name its
            photographer wherever it is shown. */}
        <PlaceCredits credits={credits} />
        <div className="aacts mt-1 flex gap-1.5">
          {canEdit && (
            <button
              className="mini mini-accent"
              disabled={inTrip || adding}
              onClick={async () => {
                setAdding(true)
                await onAdd({ ...poi, d: kind, image: picture, source, note })
                setAdding(false)
              }}>
              {inTrip ? 'In your trip' : adding ? 'Adding…' : 'Add to trip'}
            </button>
          )}
          {/* One outward link, and only when there is one to give: a place's
              own website for a place, the article for a legacy pin. A button
              labelled Wikipedia that opened ?curid=<one of our uuids> was a
              dead link on somebody else's site, on every card. */}
          {source && (
            <a className="mini" href={source} target="_blank" rel="noopener noreferrer">
              {fromPlaces ? 'Website' : 'Wikipedia'}
            </a>
          )}
        </div>
        {/* Who said so. The licence line is not decoration — see
            PlaceAttribution — and a card is a place shown on a screen. */}
        {place && <PlaceAttribution places={[place]} className="mt-1" />}
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

/* The sort a reader chose last time, on this device. */
const rememberedSort = (): SightSort => {
  try {
    const kept = localStorage.getItem(SIGHT_SORT_KEY)
    return isSightSort(kept) ? kept : 'popular'
  } catch {
    return 'popular'
  }
}

function SightsList({ centre, stops, canEdit, onAdd, onShow, toast }: SightsListProps) {
  const [items, setItems] = useState<SightPlace[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [added, setAdded] = useState<Set<string>>(() => new Set())
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SightSort>(rememberedSort)
  const [hideOnTrip, setHideOnTrip] = useState(false)
  const chooseSort = (next: SightSort) => {
    setSort(next)
    try {
      localStorage.setItem(SIGHT_SORT_KEY, next)
    } catch {
      /* private mode: the choice lasts the session */
    }
  }

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

  const already = useMemo(() => new Set(stops.map(s => (s.name || '').toLowerCase())), [stops])
  const onTrip = useCallback(
    (place: SightPlace) => already.has(place.name.toLowerCase()) || added.has(place.id),
    [already, added],
  )
  /* The list as a list: a word, a sort, and the ones already on the trip
     out of the way when asked. The search ranks by readers; this is what
     the reader does with forty results. */
  const view = useMemo(
    () => sightsListView(items || [], { query, sort, hideOnTrip, onTrip }),
    [items, query, sort, hideOnTrip, onTrip],
  )
  const list = view.shown

  return (
    <>
      <div className="flex items-center justify-between gap-2 px-3 pb-1 pt-3">
        <p className="hint">Around the middle of the map.</p>
        <button className="mini" onClick={load} disabled={busy}>
          {busy ? 'Searching…' : 'Search this area'}
        </button>
      </div>
      {items && items.length > 0 && (
        <div className="sbar sticky top-0 z-[2] flex flex-col gap-1.5 bg-strong px-3 pb-2 pt-1">
          <div className="flex items-center gap-2">
            <input
              type="search"
              className="sfilter min-w-0 flex-1 rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-xs"
              placeholder="Find a sight, a kind of place"
              aria-label="Filter the sights"
              value={query}
              onChange={event => setQuery(event.target.value)}
            />
            <select
              className="ssort flex-none rounded-lg border border-line bg-canvas px-2 py-1.5 text-xs"
              aria-label="Sort the sights"
              value={sort}
              onChange={event => chooseSort(event.target.value as SightSort)}>
              {SIGHT_SORTS.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-between gap-2 text-[11px] text-muted">
            <span className="scount">
              {list.length === view.total
                ? `${view.total} sights`
                : `${list.length} of ${view.total} sights`}
            </span>
            {view.onTrip > 0 && (
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={hideOnTrip}
                  onChange={event => setHideOnTrip(event.target.checked)}
                />
                Hide the {view.onTrip} on the trip
              </label>
            )}
          </div>
        </div>
      )}
      {!items && busy && <p className="hint px-3 py-2">Looking for sights around here…</p>}
      {items && !items.length && !busy && (
        <p className="hint px-3 py-2">
          Nothing found here. Move the map somewhere else and search again.
        </p>
      )}
      {items && items.length > 0 && !list.length && (
        <p className="hint px-3 py-2">
          {query.trim()
            ? `Nothing here matches “${query.trim()}”.`
            : 'Everything found here is already on the trip.'}
        </p>
      )}
      {list.map(pl => {
        const have = onTrip(pl)
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
