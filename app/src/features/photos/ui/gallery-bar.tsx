import { type ReactNode, useState } from 'react'
import { worthFiltering, type KindTally, type MediaKind } from '../../../photo-filter-core'
import type { GroupMode } from '../../../photo-groups-core'
import type { Person } from '../../../shared/model/types'

/* The gallery's chrome: what it is, how it is arranged, whose it is, how much
   there is, how to add more, and the way out — in one band, always one line.

   Its own file because the gallery below it is a windowed grid with a
   selection in it, and a screen's worth of controls sitting on top of that is
   two unrelated things sharing a scroll position. */

interface GalleryBarProps {
  mode: GroupMode
  onMode: (mode: GroupMode) => void
  kind: MediaKind
  onKind: (kind: MediaKind) => void
  /** How much of each kind the trip holds, which is what decides whether to ask. */
  tally: KindTally
  names: string[]
  faces: Map<string, Person>
  photoBy: string | null
  onPhotoBy: (name: string | null) => void
  count: number
  /** Starts choosing several. Absent for a read-only trip, or while choosing. */
  onSelect?: () => void
  /** Whether every card is rolled up, and the one control that rolls them
      all up or opens them all. Absent when there is nothing to fold. */
  folded?: boolean
  onFold?: (fold: boolean) => void
  /** The card under the bar, named under it while its own title row is
      scrolled off: pinned with the bar so it stays until the next card's
      row pushes up under it. */
  stuck?: ReactNode
}

export default function GalleryBar({
  mode,
  onMode,
  kind,
  onKind,
  tally,
  names,
  faces,
  photoBy,
  onPhotoBy,
  count,
  onSelect,
  folded,
  onFold,
  stuck,
}: GalleryBarProps) {
  /* Everything the gallery needs in one band: what it is, how it is arranged,
     whose it is, how much there is, and the way out. Two rows of chrome over a
     wall of photographs is one row too many — the card's name under it, while
     there is one, is the grid's own row pinned, not a second band. */
  return (
    <div className="sticky top-0 z-[2] border-b border-line bg-strong backdrop-blur-xl">
      {stuck && <div className="order-last border-t border-line">{stuck}</div>}
      <div className="flex items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-6">
        {/* One line, always. Where the controls outgrow a phone they slide
          rather than wrapping: a second band of chrome costs every screen
          below it, and this one costs nothing until it is used. */}
        <div className="gallery-controls flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
          <fieldset className="segbar" aria-label="How to arrange">
            <button aria-pressed={mode === 'stop'} onClick={() => onMode('stop')}>
              By place
            </button>
            <button aria-pressed={mode === 'date'} onClick={() => onMode('date')}>
              By date
            </button>
          </fieldset>
          {worthFiltering(tally) && (
            /* Only where there is something of each to divide. A trip of
             nothing but stills does not need a Videos button, and this row
             has to stay one row.

             The spoken names are longer than the written ones because the
             written one has to be short enough to fit three of: a tab called
             Photos already sits a few pixels away, and two controls that
             announce themselves identically is one too many for anybody
             listening rather than looking. */
            <fieldset className="segbar" aria-label="Photos or videos">
              <button
                aria-pressed={kind === 'all'}
                aria-label="All media"
                onClick={() => onKind('all')}>
                All
              </button>
              <button
                aria-pressed={kind === 'photo'}
                aria-label="Photos only"
                onClick={() => onKind('photo')}>
                Photos
              </button>
              <button
                aria-pressed={kind === 'video'}
                aria-label="Videos only"
                onClick={() => onKind('video')}>
                Videos
              </button>
            </fieldset>
          )}
          {names.length > 1 && (
            /* Faces rather than names. Four names in pills is most of a phone's
             width spent spelling out something a 26px circle says at a
             glance, and the row has to stay one row. Tapping the one already
             chosen puts everyone back, and the way out is spelled out beside
             it while it is needed rather than parked there for ever. */
            <fieldset className="flex flex-none items-center gap-1" aria-label="Whose photographs">
              {names.map(name => {
                const mine = photoBy === name
                const person = faces.get(name)
                return (
                  <button
                    key={name}
                    aria-pressed={mine}
                    /* Distinct from the reset beside it on purpose: two
                     controls that both announce themselves as "everyone" is
                     one control too many to a screen reader. */
                    title={mine ? `Only ${name} — tap to clear` : `Only ${name}`}
                    aria-label={mine ? `Only ${name}, tap to clear` : `Show only ${name}`}
                    onClick={() => onPhotoBy(mine ? null : name)}
                    className={
                      'avatar size-[26px] text-[10px] transition-opacity ' +
                      (mine
                        ? 'opacity-100 ring-2 ring-accent'
                        : photoBy
                          ? 'opacity-40 hover:opacity-80'
                          : 'opacity-90 hover:opacity-100')
                    }>
                    <Face name={name} src={person?.avatar} />
                  </button>
                )
              })}
              {photoBy && (
                <button className="mini ml-0.5 whitespace-nowrap" onClick={() => onPhotoBy(null)}>
                  Everyone
                </button>
              )}
            </fieldset>
          )}
        </div>

        <div className="flex flex-none items-center gap-1.5 sm:gap-2">
          <span className="text-[11px] tabular-nums text-muted max-sm:hidden">
            {count} {count === 1 ? 'item' : 'items'}
          </span>
          {onFold && (
            <button
              className="mini whitespace-nowrap"
              aria-label={folded ? 'Expand all' : 'Collapse all'}
              title={folded ? 'Open every card' : 'Roll every card up'}
              onClick={() => onFold(!folded)}>
              {folded ? 'Expand all' : 'Collapse all'}
            </button>
          )}
          {onSelect && (
            /* The only discoverable way in, on every width. A long press is
             what a thumb reaches for and nobody has to be taught, but
             nothing on the screen says it is there — and it was hidden on a
             phone in portrait, which is where the thumbs are. */
            <button
              className="mini whitespace-nowrap"
              /* Wrapped, not passed: React hands a click handler the event, and
               `begin` reads its first argument as a photograph to choose. */
              onClick={() => onSelect()}>
              Select
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/* A face, or the initial of one. A portrait that will not load is the ordinary
   case rather than the odd one — somebody signed up without a picture, an
   avatar host is having a bad afternoon — and the browser's broken-image glyph
   in a 26px circle is worse than the letter it was covering up. */
function Face({ name, src }: { name: string; src?: string }) {
  const [failed, setFailed] = useState(false)
  const letter = (name || '?')[0].toUpperCase()
  if (!src || failed) return <span className="avatar-letter">{letter}</span>
  return <img src={src} alt="" onError={() => setFailed(true)} />
}
