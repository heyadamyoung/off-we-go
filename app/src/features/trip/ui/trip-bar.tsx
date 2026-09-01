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
  /* A phone showing a panel has no room for the bar underneath it, and the bar
     is the same day in a second form — the panel says it better. */
  behindPanel?: boolean
}

const TripBar = memo(function TripBar({
  items, days, day, liveDay, selected, query, onDay, onQuery, onSelect, behindPanel,
}: TripBarProps) {
  const chips = useRef<HTMLDivElement>(null)

  // Keep the chosen day in view when it changes from somewhere else — picking a
  // stop off the map moves the day with it.
  useEffect(() => {
    chips.current?.querySelector('.sel')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [day])

  return (
    <div className={'glass absolute inset-x-0 bottom-0 z-[5] flex h-[var(--trip-bar)] flex-col ' +
                    'border-t border-line pb-[env(safe-area-inset-bottom,0px)] backdrop-blur-[18px] ' +
                    (behindPanel ? 'max-sm:hidden' : '')}>
      {/* The day chips and the search box each want the full width of a phone,
          so below 640px they take a line each instead of splitting one. */}
      <div className="flex items-center justify-between gap-4 px-4 pb-1.5 pt-2.5
                      max-sm:flex-col max-sm:items-stretch max-sm:gap-1.5 max-sm:px-3 max-sm:pt-2">
        <div ref={chips} className="fdays flex items-center gap-1.5 overflow-x-auto pr-10 max-sm:pr-6
                        [mask-image:linear-gradient(to_right,#000_calc(100%-40px),transparent)]
                        [scrollbar-width:none]">
          <button className={'chip' + (day === ALL_DAYS ? ' sel' : '')}
                  onClick={() => onDay(ALL_DAYS)}>All days</button>
          {days.map(value => (
            <button key={value} className={'chip' + (day === value ? ' sel' : '')}
                    onClick={() => onDay(value)}>
              {value === liveDay && (
                <span className={'size-1.5 rounded-full ' + (day === value
                  ? 'bg-accent-ink' : 'bg-accent shadow-[0_0_8px_var(--c-glow)]')} />
              )}
              {value}
            </button>
          ))}
        </div>
        <label className="fsearch flex h-8 w-[230px] flex-none items-center gap-2 rounded-full border
                          border-line bg-raised px-3 text-faint max-sm:w-full">
          <Icon n="search" s={14} />
          <input className="min-w-0 flex-1 border-0 bg-transparent text-[12.5px] text-ink outline-none
                            placeholder:text-faint"
                 type="search" placeholder="Search stops and captions" autoComplete="off"
                 value={query} onChange={event => onQuery(event.target.value)} />
        </label>
      </div>
      <div className="flex flex-1 items-stretch gap-2.5 overflow-x-auto px-4 pb-3.5 pt-1.5
                      max-sm:gap-2 max-sm:px-3 max-sm:pb-2.5">
        {items.length ? items.map((item, index) => (
          <Card key={item.id} item={item} eager={index < 5}
                selected={selected === item.id} onSelect={() => onSelect(item)} />
        )) : (
          <div className="self-center px-1.5 text-[13px] text-faint">
            {query ? `Nothing matches “${query}”.` : 'Nothing planned for this day yet.'}
          </div>
        )}
      </div>
    </div>
  )
})

function Card({ item, selected, eager, onSelect }:
  { item: TripItem; selected: boolean; eager: boolean; onSelect: () => void }) {
  const label = item.kind === 'photo' ? 'Photo'
    : item.status === 'done' ? 'Done' : item.status === 'now' ? 'Now' : 'Planned'
  return (
    <button className={'card fcard flex w-[172px] flex-none flex-col overflow-hidden rounded-xl border ' +
      'max-sm:w-[116px] ' +
      'bg-raised text-left transition-[transform,border-color] hover:-translate-y-0.5 ' +
      (selected ? 'border-accent shadow-[0_0_0_1px_var(--c-accent)]' : 'border-line hover:border-line2')}
            onClick={onSelect}>
      <div className="relative h-[78px] overflow-hidden bg-raised2 max-sm:h-[52px]">
        {item.kind === 'photo' || item.stop?.src
          ? <Img item={(item.photo || item.stop)!} w={420} h={220} eager={eager}
                 className="size-full object-cover" />
          : <span className="grid size-full place-items-center text-faint">
              <Icon n={item.stop?.icon || 'pin'} s={28} />
            </span>}
        <span className={'absolute left-1.5 top-1.5 rounded border px-1.5 py-0.5 text-[9px] font-extrabold ' +
          'uppercase tracking-[.1em] max-sm:px-1 max-sm:text-[8px] ' + (item.status === 'now'
            ? 'border-transparent bg-accent text-accent-ink'
            : 'border-line bg-panel ' + (item.status === 'done' ? 'text-accent' : 'text-muted'))}>
          {label}
        </span>
      </div>
      <div className="flex flex-col gap-0.5 px-2.5 pb-2 pt-1.5 max-sm:px-2 max-sm:pb-1.5">
        <div className="t line-clamp-2 text-[12.5px] font-bold leading-tight max-sm:text-[11px]">
          {item.title}
        </div>
        <div className="truncate text-[11px] text-faint max-sm:text-[9.5px]">{item.meta}</div>
      </div>
    </button>
  )
}

export default TripBar
