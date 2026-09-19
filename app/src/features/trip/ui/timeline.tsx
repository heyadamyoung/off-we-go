import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../../../shared/ui/icon'
import MediaThumb from '../../../shared/ui/media-thumb'
import useGridBox from '../model/use-grid-box'
import { legLabel } from '../../../legs-core'
import { photoItem, stopItem, type TripItem } from '../model/trip-items'
import { driftLabel, stayLabel, visitLabel } from '../../../stop-visit-core'
import { filterRows, orderRows, type TimelineOrder } from '../../../timeline-find-core'
import {
  timelineRows,
  windowRows,
  type ShotsRow,
  type StopRow,
  type TravelRow,
} from '../../../timeline-core'
import { segmentName, type Segment } from '../../../segments-core'
import type { Id, Stop, TripLeg, TripPhoto } from '../../../shared/model/types'

/* The day, in order, in time — and the one place where the plan and what
 * happened are the same object.
 *
 * It used to be two features wearing one coat: an itinerary AND a feed, with
 * every photograph on the trip as a text row carrying a thumbnail the size of
 * a full stop. That made it a worse gallery than the gallery and a worse
 * itinerary than the map, and it rendered the entire trip at once because a
 * nest of days holding stops holding pictures cannot be windowed.
 *
 * What is left is the thing nothing else here does. The map answers where,
 * the gallery answers what we saw, Getting there answers how we move, and the
 * gap nobody filled is WHEN — and whether it went the way it was meant to.
 * A planner cannot say that: it has no idea where anybody was. A location
 * history cannot say it either: it has no plan to hold the answer against.
 * This app has had both facts since it first drew a map.
 */

export interface TimelineProps {
  stops: Stop[]
  photos: TripPhoto[]
  selected?: string
  onSelect: (item: TripItem, ordered?: TripPhoto[]) => void
  legs?: Map<Id, TripLeg>
  /** the getting-there chain, so a travel day is a day of the trip rather
      than a gap between two hotels */
  segments?: readonly Segment[]
  /** where a journey is opened — the Travel view is its home */
  onTravel?: (segment: Segment) => void
  /** the clock, so one day heading can say it is this one */
  now?: number
  /* Adding a stop to a day from the day itself. Absent for a follower, and
     absent on the day with no date — a stop has to be placed somewhere, and
     "no date yet" is not a day to place one on. */
  onAddOnDay?: (iso: string) => void
}

/* Newest first unless this browser was told otherwise: on the trip, today is
   the top of the screen; afterwards, the last day is, and the first morning
   is at the bottom where a journal keeps it. */
const ORDER_KEY = 'offwego.timeline.order'
const rememberedOrder = (): TimelineOrder => {
  try {
    return localStorage.getItem(ORDER_KEY) === 'oldest' ? 'oldest' : 'newest'
  } catch {
    return 'newest'
  }
}
const rememberOrder = (order: TimelineOrder) => {
  try {
    localStorage.setItem(ORDER_KEY, order)
  } catch {
    /* private mode: it opens newest first next time, which is the default anyway */
  }
}

const todayIso = (now: number) => {
  const when = new Date(now)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`
}

export default function Timeline({
  stops,
  photos,
  selected,
  onSelect,
  legs,
  segments,
  onTravel,
  now = Date.now(),
  onAddOnDay,
}: TimelineProps) {
  const { ref, box, scroller } = useGridBox()
  const today = todayIso(now)
  const [order, setOrder] = useState<TimelineOrder>(rememberedOrder)
  const [query, setQuery] = useState('')
  const everything = useMemo(
    () => timelineRows({ stops, photos, segments, legs, today }),
    [stops, photos, segments, legs, today],
  )
  const rows = useMemo(
    () => filterRows(orderRows(everything, order), query),
    [everything, order, query],
  )
  const view = windowRows(rows, box)
  const flip = () => {
    const next: TimelineOrder = order === 'newest' ? 'oldest' : 'newest'
    rememberOrder(next)
    setOrder(next)
  }

  /* Opened at today rather than at the first morning of the trip.
     
     The screen's whole subject is when things happened, and on the fourth day
     of a fortnight the answer to "where are we" was eleven rows of scrolling
     away. Once per opening, and never again: after that the view belongs to
     whoever is reading it, and a list that jumps back while somebody is
     reading yesterday is worse than one that never moved. */
  const jumped = useRef(false)
  useEffect(() => {
    if (jumped.current || !box.viewportHeight) return
    const at = rows.findIndex(row => row.kind === 'day' && row.today)
    jumped.current = true
    if (at <= 0) return
    let above = 0
    for (let index = 0; index < at; index += 1) above += rows[index].height
    scroller.current?.scrollTo({ top: above })
  }, [rows, box.viewportHeight, scroller])

  if (!everything.length)
    return <p className="hint p-4">No stops yet. Place a pin on the map to start.</p>

  /* A word to find things by and the order to read them in, on one row that
     stays put while the trip scrolls under it. Outside the windowed list,
     which measures itself from its own top. */
  const bar = (
    <div className="tbar sticky top-0 z-[2] flex items-center gap-2 bg-strong px-1 pb-2 pt-1">
      <input
        type="search"
        className="tfilter min-w-0 flex-1 rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-xs"
        placeholder="Find a stop, a place, a flight"
        aria-label="Filter the timeline"
        value={query}
        onChange={event => setQuery(event.target.value)}
      />
      <button
        className="mini flex-none whitespace-nowrap"
        onClick={flip}
        aria-label={
          order === 'newest'
            ? 'Newest first; switch to oldest first'
            : 'Oldest first; switch to newest first'
        }>
        {order === 'newest' ? 'Newest first' : 'Oldest first'}
      </button>
    </div>
  )
  if (!rows.length)
    return (
      <>
        {bar}
        <p className="hint p-4">Nothing on the trip matches “{query.trim()}”.</p>
      </>
    )

  return (
    <>
      {bar}
      <div ref={ref} className="tline">
        {/* Standing in for everything above and below the slice, so the
          scrollbar tells the truth about how long the trip is. */}
        <div style={{ height: view.above }} />
        {view.rows.map(row => {
          if (row.kind === 'day')
            return (
              <div
                key={row.key}
                className={row.today ? 'tday now' : 'tday'}
                data-iso={row.iso ?? undefined}
                style={rowHeight(row)}>
                <b>{row.label}</b>
                <span className="tdaycount">{whatIsOn(row.stops, row.journeys)}</span>
                {row.today && <span className="tnow">Today</span>}
                {/* Planning a day from the day, rather than from the map with
                  the right chip already chosen. It does what somebody would
                  have done by hand: picks the day and hands the map over for
                  a pin, which is still where a place is chosen because a stop
                  without one is a stop nothing can draw. */}
                {onAddOnDay && row.iso && (
                  <button
                    className="tadd hitslop"
                    onClick={() => onAddOnDay(row.iso as string)}
                    aria-label={`Add a stop on ${row.label}`}>
                    <Icon n="plus" s={12} />
                  </button>
                )}
              </div>
            )
          if (row.kind === 'leg')
            return (
              /* The road between this stop and the next — a fact of the world
               rather than a row of the plan, so it stays quiet. */
              <div key={row.key} className="tleg" style={rowHeight(row)}>
                ↓ {legLabel(row.leg)}
              </div>
            )
          if (row.kind === 'travel') return <Travel key={row.key} row={row} onOpen={onTravel} />
          if (row.kind === 'shots') return <Shots key={row.key} row={row} onSelect={onSelect} />
          return (
            <StopLine
              key={row.key}
              row={row}
              selected={selected === row.stop.id}
              onSelect={onSelect}
            />
          )
        })}
        <div style={{ height: view.below }} />
      </div>
    </>
  )
}

/* What a day holds, named rather than totalled. "4 stops" on a day with two
   flights on it is the heading telling a small lie about the one thing it
   says, and a travel day with nothing planned would have read "0 stops". */
const count = (many: number, one: string) => `${many} ${one}${many === 1 ? '' : 's'}`
const whatIsOn = (stops: number, journeys: number) =>
  [stops ? count(stops, 'stop') : '', journeys ? count(journeys, 'journey') : '']
    .filter(Boolean)
    .join(' · ')

const rowHeight = (row: { height: number }) => ({ height: row.height })

function StopLine({
  row,
  selected,
  onSelect,
}: {
  row: StopRow
  selected: boolean
  onSelect: (item: TripItem) => void
}) {
  const { stop } = row
  /* What happened leads over what was written down, because it is the rarer
     and more interesting fact and because the plan is already in the column to
     its left. A note only has the line when there is nothing to report. */
  const happened = visitLabel(stop)
  const stayed = stayLabel(stop)
  const drift = driftLabel(stop)
  /* The stay only when the difference is not already taking the right-hand
     end of the row. "arrived 10:05, left 12:40 · 2 h 35 there" next to a
     35-min-late chip is a line that ends in an ellipsis, and how long they
     were there is the one of the three a reader can work out unaided. */
  const detail = happened
    ? [happened, drift ? '' : stayed].filter(Boolean).join(' · ')
    : stop.note || stop.kind || ''

  return (
    <button
      onClick={() => onSelect(stopItem(stop))}
      style={rowHeight(row)}
      className={selected ? 'trow on' : 'trow'}>
      {/* The clock on its own line and the word that went with it under it —
          "14:00 / Check-in". They shared one 58px column before, which turned
          a hotel check-in into "Check-in 1…" and lost the only number in the
          row. The far end of a window lives on the card; a timeline wants to
          know when a thing starts. */}
      <span className="ttime">
        <b className="tnum">{stop.startsAt || stop.endsAt || '—'}</b>
        {stop.timeNote && <span>{stop.timeNote}</span>}
      </span>
      <span className={stop.status === 'done' || happened ? 'ticon been' : 'ticon'}>
        <Icon n={stop.status === 'done' ? 'check' : stop.icon || 'pin'} s={14} />
      </span>
      <span className="tbody">
        <b>{stop.name || 'Untitled stop'}</b>
        <span className={happened ? 'tsaid' : 'tdetail'}>{detail}</span>
      </span>
      {/* Only ever the difference, and only when there is one worth saying —
          a plan written to the minute was still written by somebody who meant
          "about a quarter to ten", and an app that reports three minutes as a
          failure is an app that nags. */}
      {drift && <span className={`tdrift ${lateness(drift)}`}>{drift}</span>}
    </button>
  )
}

/* Late is the only one worth colouring. Early is a bonus and on time is the
   plan working, and painting all three would make a timeline of a well-run
   day look like a list of problems. */
const lateness = (said: string) =>
  said.endsWith('late') ? 'late' : said === 'on time' ? 'ontime' : ''

/* Getting there, on the day it happens.
 *
 * A flight was a whole tab of its own and nothing at all on the one screen
 * whose subject is the order of a day, so a travel day read as a gap between
 * two hotels. It is the plainest thing every itinerary app does and the only
 * one this one did not — and every fact it needs was already stored. */
/* Line art rather than the emoji the Travel view uses, because this glyph
   sits in the same 30px box as a stop's own and a row of clean shapes with one
   emoji in it reads as a mistake. There is no bus drawing, and a coach is
   nearer a car than a plane. */
const MODE_ICON: Record<string, string> = {
  flight: 'plane',
  train: 'train',
  bus: 'car',
  ferry: 'boat',
  drive: 'car',
}

function Travel({ row, onOpen }: { row: TravelRow; onOpen?: (segment: Segment) => void }) {
  const { segment } = row
  /* Codes rather than names in a 390px row, but the same rule about not
     saying the airline twice — see segmentName. */
  const called = segmentName({ carrier: segment.carrier, number: segment.number })
  const where = `${segment.fromCode || segment.fromName} → ${segment.toCode || segment.toName}`
  return (
    <button
      style={rowHeight(row)}
      className="trow tgo"
      onClick={() => onOpen?.(segment)}
      disabled={!onOpen}>
      <span className="ttime">
        <b className="tnum">{row.at}</b>
      </span>
      <span className="ticon going">
        <Icon n={MODE_ICON[segment.mode] || 'plane'} s={14} />
      </span>
      <span className="tbody">
        <b>{where}</b>
        <span className="tdetail">{called || segment.mode}</span>
      </span>
    </button>
  )
}

function Shots({
  row,
  onSelect,
}: {
  row: ShotsRow
  onSelect: (item: TripItem, ordered?: TripPhoto[]) => void
}) {
  /* One row for the afternoon, not one row per picture. Fourteen photographs
     from the Rijksmuseum were fourteen text rows before this, which is neither
     a gallery nor an itinerary — and the gallery next door is a real one. */
  const rest = row.count - row.photos.length
  return (
    <div className="tshots" style={rowHeight(row)}>
      {row.photos.map(photo => (
        <button
          key={photo.id}
          className="tshot"
          onClick={() => onSelect(photoItem(photo, row.stop), row.ordered)}
          aria-label={photo.caption || 'Open photograph'}>
          <MediaThumb item={photo} w={180} h={180} badge={14} />
        </button>
      ))}
      {rest > 0 && (
        <button
          className="tmore"
          onClick={() =>
            onSelect(photoItem(row.ordered[row.photos.length], row.stop), row.ordered)
          }>
          +{rest}
        </button>
      )}
    </div>
  )
}
