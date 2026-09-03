import { memo, useEffect, useRef } from 'react'
import Icon from '../../../shared/ui/icon'
import Img from '../../../shared/ui/img'
import { ALL_DAYS } from '../../../trip-search-core'
import type { TripItem } from '../model/trip-items'

interface TripBarProps {
  items: TripItem[]
  days: string[]
  day: string
  liveDay?: string
  selected?: string
  query: string
  onDay: (day: string) => void
  onQuery: (query: string) => void
  onSelect: (item: TripItem) => void
  /** present when this person can add stops — the empty day offers the verb */
  onAddStop?: () => void
  /* A panel and the bar are the same day in two forms, and the panel says it
     better — so the bar yields whenever one is open, at every width. On a
     phone there was no room anyway; on a desktop it was a duplicate. */
  behindPanel?: boolean
  /* Phone only: collapsed to the handle and the day chips, the map keeps the
     height. The state lives on the page so the floating chrome moves with it. */
  peek?: boolean
  onPeek?: (peek: boolean) => void
}

const TripBar = memo(function TripBar({
  items,
  days,
  day,
  liveDay,
  selected,
  query,
  onDay,
  onQuery,
  onSelect,
  onAddStop,
  behindPanel,
  peek,
  onPeek,
}: TripBarProps) {
  const chips = useRef<HTMLDivElement>(null)

  // Keep the chosen day in view when it changes from somewhere else — picking a
  // stop off the map moves the day with it.
  useEffect(() => {
    chips.current?.querySelector('.sel')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [day])

  return (
    <div
      className={
        'glass absolute inset-x-0 bottom-0 z-[5] flex h-[var(--trip-bar)] flex-col ' +
        'border-t border-line pb-[env(safe-area-inset-bottom,0px)] backdrop-blur-[18px] ' +
        (behindPanel ? 'hidden' : '')
      }>
      {onPeek && (
        <button
          className="hitslop mx-auto mt-1.5 hidden h-2 w-12 flex-none rounded-full
                        bg-line2 max-sm:block"
          aria-label={peek ? 'Show the day’s cards' : 'Collapse to the map'}
          aria-expanded={!peek}
          onClick={() => onPeek(!peek)}
        />
      )}
      {/* The day chips and the search box each want the full width of a phone,
          so below 640px they take a line each instead of splitting one. */}
      <div
        className="flex items-center justify-between gap-4 px-4 pb-1.5 pt-2.5
                      max-sm:flex-col max-sm:items-stretch max-sm:gap-1.5 max-sm:px-3 max-sm:pt-2">
        <div
          ref={chips}
          className="fdays flex items-center gap-1.5 overflow-x-auto overflow-y-hidden
                        pr-10 max-sm:pr-6
                        [mask-image:linear-gradient(to_right,#000_calc(100%-40px),transparent)]
                        [scrollbar-width:none]">
          <button
            className={'chip hitslop' + (day === ALL_DAYS ? ' sel' : '')}
            onClick={() => onDay(ALL_DAYS)}>
            All days
          </button>
          {days.map(value => (
            <button
              key={value}
              className={'chip hitslop' + (day === value ? ' sel' : '')}
              onClick={() => onDay(value)}>
              {/* The live dot stays amber even on the ink-inverted selected
                  chip — it marks the journey's day, and that is amber's job. */}
              {value === liveDay && (
                <span className="size-1.5 rounded-full bg-accent shadow-[0_0_8px_var(--c-glow)]" />
              )}
              {value}
            </button>
          ))}
        </div>
        <label
          className={
            'fsearch flex h-8 w-[230px] flex-none items-center gap-2 rounded-full border ' +
            'border-line bg-raised px-3 text-faint max-sm:h-10 max-sm:w-full' +
            (peek ? ' max-sm:hidden' : '')
          }>
          <Icon n="search" s={14} />
          <input
            className="min-w-0 flex-1 border-0 bg-transparent text-xs text-ink outline-none
                            placeholder:text-faint"
            type="search"
            placeholder="Search stops and captions"
            autoComplete="off"
            value={query}
            onChange={event => onQuery(event.target.value)}
          />
        </label>
      </div>
      <div
        className={
          'flex flex-1 items-stretch gap-2 overflow-x-auto overflow-y-hidden px-4 ' +
          'pb-3.5 pt-1.5 max-sm:gap-2 max-sm:px-3 max-sm:pb-2.5' +
          (peek ? ' max-sm:hidden' : '')
        }>
        {items.length ? (
          items.map((item, index) => (
            <Card
              key={item.id}
              item={item}
              eager={index < 5}
              selected={selected === item.id}
              onSelect={() => onSelect(item)}
            />
          ))
        ) : (
          <div className="flex items-center gap-2 self-center px-1.5 text-xs text-faint">
            {query ? (
              `Nothing matches “${query}”.`
            ) : (
              <>
                Nothing planned for this day yet.
                {onAddStop && (
                  <button className="mini" onClick={onAddStop}>
                    Add a stop
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
})

function Card({
  item,
  selected,
  eager,
  onSelect,
}: {
  item: TripItem
  selected: boolean
  eager: boolean
  onSelect: () => void
}) {
  /* Type is carried by form, not by a chip on everything: a planned leg is a
     dashed card — the same dash it wears on the map — a photograph is simply
     its picture, a visited stop is a plain card, and only what is happening
     now (or up next) earns a badge. */
  const planned = item.kind === 'stop' && (item.status === 'planned' || item.status === 'next')
  const badge = item.status === 'now' ? 'Now' : item.status === 'next' ? 'Up next' : null
  return (
    <button
      className={
        'card fcard flex w-[172px] flex-none flex-col overflow-hidden rounded-xl border ' +
        'max-sm:w-[116px] ' +
        (item.kind === 'photo' ? 'fcard-photo ' : '') +
        (planned && !selected ? 'border-dashed ' : '') +
        'bg-raised text-left transition-[transform,border-color] hover:-translate-y-0.5 ' +
        (selected
          ? 'border-ink shadow-[0_0_0_1px_var(--c-ink)]'
          : planned
            ? 'border-line2 hover:border-ink'
            : 'border-line hover:border-line2')
      }
      onClick={onSelect}>
      {/* flex-none: the bar is a fixed height, so without it a two-line title
          takes its extra line out of the photograph and cards in the same row
          end up with different sized pictures. */}
      <div className="relative h-[78px] flex-none overflow-hidden bg-raised2 max-sm:h-[52px]">
        {item.kind === 'photo' || item.stop?.src ? (
          <Img
            item={(item.photo || item.stop)!}
            w={420}
            h={220}
            eager={eager}
            className="size-full object-cover"
          />
        ) : (
          <span className="grid size-full place-items-center text-faint">
            <Icon n={item.stop?.icon || 'pin'} s={28} />
          </span>
        )}
        {badge && (
          <span
            className={
              'absolute left-1.5 top-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-extrabold ' +
              'uppercase tracking-[.1em] max-sm:px-1 ' +
              (badge === 'Now'
                ? 'bg-accent text-accent-ink'
                : 'border border-accent bg-panel text-accent')
            }>
            {badge}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-0.5 px-2.5 pb-2 pt-1.5 max-sm:px-2 max-sm:pb-1.5">
        {/* One line on a phone: a stop called "Schiphol — arrive from Toronto"
            would otherwise spend two of them, and the row is easier to read
            across when every card is the same shape. */}
        <div
          className="t line-clamp-2 text-xs font-semibold leading-tight
                        max-sm:line-clamp-1 max-sm:text-[11px]">
          {item.title}
        </div>
        {/* On a phone the card is barely wider than the name, and the times
            underneath were clipped mid-line by the bottom of the bar — a sliver
            of text that reads as a mistake. The name is the useful half; the
            times are on the stop itself. */}
        <div className="truncate text-[11px] text-faint max-sm:hidden">{item.meta}</div>
      </div>
    </button>
  )
}

export default TripBar
