import { useState } from 'react'
import Icon from '../../../shared/ui/icon'
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
  names: string[]
  faces: Map<string, Person>
  photoBy: string | null
  onPhotoBy: (name: string | null) => void
  count: number
  /** Starts choosing several. Absent for a read-only trip, or while choosing. */
  onSelect?: () => void
  onAddPhotos?: () => void
  onClose: () => void
}

export default function GalleryBar({
  mode,
  onMode,
  names,
  faces,
  photoBy,
  onPhotoBy,
  count,
  onSelect,
  onAddPhotos,
  onClose,
}: GalleryBarProps) {
  /* Everything the gallery needs in one band: what it is, how it is arranged,
     whose it is, how much there is, and the way out. Two rows of chrome over a
     wall of photographs is one row too many. */
  return (
    <div
      className="sticky top-0 z-[2] flex items-center gap-2 border-b border-line bg-strong
                 px-3 py-2.5 backdrop-blur-xl sm:gap-3 sm:px-6">
      {/* The name goes first where there is room for it. On a phone the
          screen is the answer to what this is, and the width is better spent
          on the controls. */}
      <h2 className="m-0 mr-1 text-[15px] font-extrabold tracking-[-.02em] max-sm:hidden">
        Photos
      </h2>

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
        {onSelect && (
          /* The only discoverable way in. A long press is what a thumb
             reaches for and nobody has to be taught, but nothing on the
             screen says it is there — and a mouse has no long press at
             all. */
          <button
            className="mini whitespace-nowrap max-sm:hidden"
            /* Wrapped, not passed: React hands a click handler the event, and
               `begin` reads its first argument as a photograph to choose. */
            onClick={() => onSelect()}>
            Select
          </button>
        )}
        {onAddPhotos && (
          /* A plus, because everywhere else a plus is how you add one more of
             whatever you are looking at. The word was costing sixty pixels
             of a row that has to hold everything. */
          <button
            className="grid size-8 place-items-center rounded-full bg-accent text-accent-ink
                       transition-[filter] hover:brightness-110"
            onClick={onAddPhotos}
            title="Add photos or videos"
            aria-label="Add photos or videos">
            <Icon n="plus" s={16} w={2} />
          </button>
        )}
        <button
          className="grid size-8 place-items-center rounded-full text-muted hover:bg-raised2 hover:text-ink"
          onClick={onClose}
          title="Back to map"
          aria-label="Back to map">
          <Icon n="x" s={16} />
        </button>
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
