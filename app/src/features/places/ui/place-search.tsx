import { useCallback, useEffect, useId, useRef, useState } from 'react'
import {
  confidenceHint,
  coverageNote,
  EMPTY_PLACE_LIST,
  placeSubtitle,
  type Place,
  type PlaceList,
} from '../../../places-core'
import { appErrorMessage } from '../../../user-messages-core'
import Icon from '../../../shared/ui/icon'
import { isAbortError, MIN_QUERY, searchPlaces } from '../api/places'
import PlaceAttribution from './place-attribution'
import type { Coordinates, Id } from '../../../shared/model/types'

/* Naming a stop, with the places layer offering to be precise about it.

   The rule this component exists to hold: the search is an offer, never a
   gate. The box is the stop's name field — whatever is typed is the name, the
   moment it is typed, and a traveller writing "Gran's house" gets a stop
   called Gran's house without ever touching the list. Picking a place only
   adds what the picking knows: the exact coordinates, and the id that lets the
   server keep the stop and the record together. Every place search that has
   ever annoyed anybody did the opposite — refused to let you past until you
   chose one of its answers.

   Two places are often called the same thing, so a row shows what it is and
   where it is, not just its name. Without that the list of eight Crowns is
   eight identical rows and choosing between them is a coin toss.

   The request is debounced and the previous one aborted, because a keystroke
   is a request: without the abort a slow answer for "rijks" lands after the
   quick one for "rijksmuseum" and the list flips back to the older, wronger
   results. Superseded work is cancelled rather than merely ignored.

   Keyboard throughout — a list you can only reach with a mouse is a list half
   the people editing a trip on a laptop will never open. */

/** Long enough that a pause reads as a pause, short enough to feel live. */
const DEBOUNCE_MS = 220

export interface PlaceSearchProps {
  /** the stop's name as it stands: free text, always authoritative */
  value: string
  /** every keystroke, straight through — the name is never held hostage */
  onText: (text: string) => void
  /** a record chosen, or null when the words no longer describe the chosen one */
  onPick: (place: Place | null) => void
  /** the place already attached to this stop, if any */
  pickedId?: string | null
  /** where the map is looking, so near things come first */
  near?: Coordinates | null
  /** the trip being edited, so its own geography is preferred */
  tripId?: Id | null
  label?: string
  placeholder?: string
  autoFocus?: boolean
  disabled?: boolean
}

export default function PlaceSearch({
  value,
  onText,
  onPick,
  pickedId,
  near,
  tripId,
  label = 'Name',
  placeholder = 'Rijksmuseum, or your own words',
  autoFocus,
  disabled,
}: PlaceSearchProps) {
  const listId = useId()
  const [typed, setTyped] = useState('')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState('')
  const [results, setResults] = useState<PlaceList>(EMPTY_PLACE_LIST)
  const [active, setActive] = useState(-1)
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /* Numbers rather than the tuple: `near` is rebuilt on every render of the
     editor above, and an effect keyed on the array itself would re-search on
     every keystroke it was not meant to hear about. */
  const nearLng = near?.[0] ?? null
  const nearLat = near?.[1] ?? null

  useEffect(() => {
    const wanted = typed.trim()
    if (!open || wanted.length < MIN_QUERY) {
      setResults(EMPTY_PLACE_LIST)
      setBusy(false)
      return
    }
    const controller = new AbortController()
    setBusy(true)
    const timer = setTimeout(() => {
      searchPlaces({
        query: wanted,
        near: nearLng != null && nearLat != null ? [nearLng, nearLat] : null,
        tripId,
        signal: controller.signal,
      })
        .then(list => {
          setResults(list)
          setActive(-1)
          setFailed('')
          setBusy(false)
        })
        .catch(error => {
          /* A request we cancelled ourselves is not a failure, and saying so
             would put a red line under every third keystroke. */
          if (isAbortError(error)) return
          setResults(EMPTY_PLACE_LIST)
          setFailed(appErrorMessage(error, 'search-places'))
          setBusy(false)
        })
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [open, typed, nearLng, nearLat, tripId])

  useEffect(
    () => () => {
      if (blurTimer.current) clearTimeout(blurTimer.current)
    },
    [],
  )

  const found = results.places
  const note = coverageNote(results)

  const close = useCallback(() => {
    setOpen(false)
    setActive(-1)
  }, [])

  const choose = useCallback(
    (place: Place) => {
      /* The name first: even if the caller does nothing with the record, the
         stop is now called what the traveller pointed at. */
      onText(place.name)
      onPick(place)
      setTyped('')
      close()
    },
    [onText, onPick, close],
  )

  const type = (text: string) => {
    onText(text)
    setTyped(text)
    setOpen(true)
    setFailed('')
    /* The words have moved on from the record they were chosen from, so the
       stop stops claiming to be that record. Renaming "Café Luxembourg" to
       "lunch with Jo" must not leave the old place id riding along. */
    if (pickedId) onPick(null)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!found.length) return
      event.preventDefault()
      setOpen(true)
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive(current => {
        const next = current + step
        if (next < 0) return found.length - 1
        if (next >= found.length) return 0
        return next
      })
      return
    }
    if (event.key === 'Enter') {
      /* Only when a row is actually highlighted. Enter on your own words is
         Enter on your own words — it must never be swallowed by a list. */
      if (open && active >= 0 && found[active]) {
        event.preventDefault()
        choose(found[active])
      }
      return
    }
    if (event.key === 'Escape' && open) {
      // The list closes first; the editor behind keeps its own Escape.
      event.stopPropagation()
      close()
    }
  }

  const showPanel = open && (busy || !!found.length || !!note || !!failed)

  return (
    <div className="f placesearch">
      <span>{label}</span>
      <div className="relative">
        <input
          type="text"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 && found[active] ? `${listId}-${active}` : undefined}
          autoComplete="off"
          className="w-full"
          value={value}
          autoFocus={autoFocus}
          disabled={disabled}
          placeholder={placeholder}
          onChange={event => type(event.target.value)}
          onFocus={() => {
            if (typed.trim().length >= MIN_QUERY) setOpen(true)
          }}
          onBlur={() => {
            /* After the click, not before it: closing on blur alone removed
               the row from under the pointer on its way down. */
            blurTimer.current = setTimeout(close, 120)
          }}
          onKeyDown={onKeyDown}
        />
        {showPanel && (
          <div
            className="psdrop absolute inset-x-0 top-[calc(100%+4px)] z-30 overflow-hidden rounded-xl
                       border border-line bg-solid shadow-lg">
            {/* A div rather than a ul: the input is the combobox and this is
                its popup, and only the rows themselves are options — the
                "looking" and "no match" lines below are not choices and must
                not be counted as any by a screen reader. */}
            <div
              id={listId}
              role="listbox"
              aria-label="Matching places"
              className="max-h-[200px] overflow-y-auto overscroll-contain">
              {found.map((place, index) => {
                const rough = confidenceHint(place.confidence)
                return (
                  <button
                    key={place.id}
                    id={`${listId}-${index}`}
                    type="button"
                    role="option"
                    aria-selected={index === active}
                    className={
                      'psrow flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left ' +
                      (index === active ? 'bg-raised2' : 'hover:bg-raised')
                    }
                    // Keep the focus in the box, so blur never races the click.
                    onMouseDown={event => event.preventDefault()}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => choose(place)}>
                    <b className="text-xs font-bold text-ink">{place.name}</b>
                    <span className="text-[11px] leading-snug text-muted">
                      {placeSubtitle(place)}
                    </span>
                    {rough && (
                      <em className="text-[10px] font-semibold not-italic text-faint">{rough}</em>
                    )}
                  </button>
                )
              })}
            </div>
            {!found.length && (
              <p className="psnone m-0 px-3 py-2 text-[11px] text-muted">
                {busy ? 'Looking…' : failed || 'No match — your own words are fine.'}
              </p>
            )}
            {(note || found.length > 0) && (
              <div className="flex flex-col gap-1 border-t border-line px-3 py-1.5">
                {note && <p className="m-0 text-[10px] leading-snug text-muted">{note}</p>}
                <PlaceAttribution places={found} />
              </div>
            )}
          </div>
        )}
      </div>
      {pickedId && (
        <p className="pspicked m-0 flex items-center gap-1.5 text-[10px] text-faint">
          <Icon n="pin" s={11} />
          Pinned to a place we know
          <button
            type="button"
            className="underline"
            onClick={() => onPick(null)}
            title="Keep the name, drop the match">
            use my own words
          </button>
        </p>
      )}
    </div>
  )
}
