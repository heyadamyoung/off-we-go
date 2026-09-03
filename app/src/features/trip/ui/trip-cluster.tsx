import { memo, useCallback, useEffect, useRef, useState } from 'react'
import Icon from '../../../shared/ui/icon'
import type { TripView } from '../../../trip-search-core'

export const VIEWS: Array<[TripView, string, string]> = [
  ['map', 'Map', 'map'],
  ['timeline', 'Timeline', 'list'],
  ['photos', 'Photos', 'grid'],
  ['sights', 'Sights', 'star'],
  ['people', 'People', 'people'],
]

interface ClusterProps {
  view: TripView
  onView: (view: TripView) => void
  canEdit: boolean
  editing: boolean
  placing: boolean
  theme: string
  attractions: boolean
  onAttractions: () => void
  onSettings: () => void
  onPlace: () => void
  onAdd: () => void
  onTheme: () => void
  onEdit: () => void
}

export const TripCluster = memo(function TripCluster(props: ClusterProps) {
  const night = props.theme !== 'light'
  /* Views and the everyday actions are words now, not a glyph quiz: every
     button in the bar carries its name. The occasional tools — settings,
     attractions, the map theme — live behind one More menu instead of
     widening the bar.

     The pin stays out of the menu: edit mode's controls live on a hint bar
     that hides below 768px, so on a phone the pin IS "add a stop" — and the
     pencil stays visible while edit mode is on, or there would be no way to
     leave it. */
  /* No Follow here: the locate button in the map controls is the same toggle,
     and one state does not get two buttons in two grammars on one screen.
     Pin and Upload are travellers' verbs — a follower (or a stranger in the
     sample) only reads, and a button that can only fail is not a feature. */
  const actions: Array<[string, string, string, string, boolean, () => void, string?]> =
    props.canEdit
      ? [
          ['pin', 'Place a pin', 'Pin', 'pinplus', props.placing, props.onPlace],
          ['add', 'Add photos', 'Upload', 'camera', false, props.onAdd],
        ]
      : []
  if (props.canEdit) {
    actions.unshift([
      'edit',
      props.editing ? 'Done editing' : 'Edit the itinerary',
      props.editing ? 'Done' : 'Edit',
      'pencil',
      props.editing,
      props.onEdit,
      props.editing ? '' : 'max-md:hidden',
    ])
  }
  const { strip, more, measure } = useScrollEdges()
  // The edit button appears and disappears with the trip's permissions, which
  // changes how much there is to scroll.
  useEffect(measure, [measure, actions.length])
  /* A dozen buttons do not fit across a phone, and dropping any of them takes a
     capability off the small screen entirely — so the strip scrolls, views
     first because they are the ones people reach for. A button sliced in half
     at the edge reads as a bug rather than an invitation, so the side with more
     on it fades out under a chevron, and the fade follows the scroll: both
     edges mid-strip, neither once there is nothing further that way. */
  return (
    <div
      className="glass relative flex min-w-0 items-center rounded-xl p-1
                    max-sm:border-0 max-sm:bg-transparent max-sm:p-0 max-sm:shadow-none
                    max-sm:backdrop-blur-none">
      {/* The strip and its edge fades share this box, so a fade marks the edge
          of what scrolls — it must never sit on top of the static More button,
          where it read as a rendering glitch. overflow-y clipped with it: a box
          that scrolls on one axis computes the other to auto, and a row of
          buttons could be dragged half out of its own bar. */}
      <div className="relative min-w-0 flex-1">
        <div
          ref={strip}
          className="noscroll flex min-w-0 items-center gap-0.5 max-sm:overflow-x-auto
                        max-sm:[overflow-y:clip]">
          {VIEWS.map(([key, label, icon]) => (
            <button
              key={key}
              aria-label={label}
              className={'tbv' + (props.view === key ? ' active' : '')}
              onClick={() => props.onView(key)}>
              <Icon n={icon} s={17} />
              <span>{label}</span>
            </button>
          ))}
          {actions.length > 0 && <span className="mx-1 h-5 w-px flex-none bg-line2" />}
          {actions.map(([key, label, word, icon, on, run, hide]) => (
            <button
              key={key}
              data-tip={label}
              aria-label={label}
              className={'tb lbl' + (on ? ' on' : '') + (hide ? ' ' + hide : '')}
              onClick={run}>
              <Icon n={icon} s={17} />
              <span>{word}</span>
            </button>
          ))}
        </div>
        {more.left && <MoreThisWay side="left" />}
        {more.right && <MoreThisWay side="right" />}
      </div>
      <MoreTools
        night={night}
        attractions={props.attractions}
        onSettings={props.onSettings}
        onAttractions={props.onAttractions}
        onTheme={props.onTheme}
      />
    </div>
  )
})

/* The tools someone reaches for once a day, behind one quiet button. The menu
   is a surface, not glass, for the same reason the account menu is: it opens
   over a moving map. */
function MoreTools({
  night,
  attractions,
  onSettings,
  onAttractions,
  onTheme,
}: {
  night: boolean
  attractions: boolean
  onSettings: () => void
  onAttractions: () => void
  onTheme: () => void
}) {
  const [open, setOpen] = useState(false)
  const holder = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (event: PointerEvent) => {
      if (!holder.current?.contains(event.target as Node)) setOpen(false)
    }
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', onEscape)
    }
  }, [open])

  const item =
    'flex items-center gap-2 rounded-lg px-2.5 py-2.5 text-left text-xs ' +
    'text-ink hover:bg-raised2'
  const pick = (run: () => void) => () => {
    setOpen(false)
    run()
  }

  return (
    <div className="relative flex-none" ref={holder}>
      <button
        className={'tb lbl' + (open ? ' active' : '')}
        data-tip="More tools"
        aria-label="More tools"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}>
        <Icon n="more" s={17} />
        <span>More</span>
      </button>
      {open && (
        <div
          className="sheet absolute right-0 top-[calc(100%+8px)] z-40 flex w-52 flex-col rounded-xl p-1.5"
          role="menu"
          aria-label="More tools">
          <button className={item} role="menuitem" onClick={pick(onSettings)}>
            <Icon n="cog" s={14} />
            Trip settings
          </button>
          <button className={item} role="menuitem" onClick={pick(onAttractions)}>
            <Icon n="museum" s={14} />
            {attractions ? 'Hide attractions' : 'Show attractions'}
          </button>
          <button className={item} role="menuitem" onClick={pick(onTheme)}>
            <Icon n={night ? 'sun' : 'moon'} s={14} />
            {night ? 'Day map' : 'Night map'}
          </button>
          {/* The CC-BY credits the basemap's design owes live here, off the
              map itself — the corner keeps only the ODbL's line. */}
          <a
            className={item}
            role="menuitem"
            href="/credits.html"
            target="_blank"
            rel="noreferrer"
            onClick={() => setOpen(false)}>
            <Icon n="map" s={14} />
            Map credits
          </a>
        </div>
      )}
    </div>
  )
}

/* Which way there is more to see, kept in step with the strip rather than
   assumed: the answer changes with the width of the phone, whether the edit
   button is there at all, and where the strip has been scrolled to. */
function useScrollEdges() {
  const strip = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState({ left: false, right: false })

  const measure = useCallback(() => {
    const el = strip.current
    if (!el) return
    const slack = el.scrollWidth - el.clientWidth
    setMore({
      left: el.scrollLeft > 2,
      right: slack > 2 && el.scrollLeft < slack - 2,
    })
  }, [])

  useEffect(() => {
    const el = strip.current
    if (!el) return
    measure()
    el.addEventListener('scroll', measure, { passive: true })
    const resize = new ResizeObserver(measure)
    resize.observe(el)
    return () => {
      el.removeEventListener('scroll', measure)
      resize.disconnect()
    }
  }, [measure])

  return { strip, more, measure }
}

/* The button at the edge is what says the strip scrolls, so it is not hidden —
   it is faded into the bar it sits on, under an arrow pointing the way. A
   transparency mask would have dissolved the button against the map instead. */
function MoreThisWay({ side }: { side: 'left' | 'right' }) {
  const left = side === 'left'
  return (
    <span
      aria-hidden="true"
      className={
        'pointer-events-none absolute inset-y-0 z-[1] flex w-11 items-center text-muted sm:hidden ' +
        (left
          ? 'left-0 justify-start bg-gradient-to-r from-strong via-strong to-transparent'
          : 'right-0 justify-end bg-gradient-to-l from-strong via-strong to-transparent')
      }>
      <Icon n={left ? 'chevl' : 'chevron'} s={15} />
    </span>
  )
}
