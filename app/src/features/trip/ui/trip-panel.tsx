import type { ReactNode } from 'react'
import Icon from '../../../shared/ui/icon'
import MediaThumb from '../../../shared/ui/media-thumb'
import { SightsList, type SightsListProps } from '../../sights'
import { SegmentChain } from '../../transport'
import PanelPhotos from './panel-photos'
import { photoItem, stopItem, type TripItem } from '../model/trip-items'
import PeopleList from './panel-people'
import ChatPanel, { type ChatProps } from './panel-chat'
import type { Segment } from '../../../segments-core'
import { legLabel } from '../../../legs-core'
import type { Id, Person, Stop, TripLeg, TripPhoto } from '../../../shared/model/types'
import type { TripView } from '../../../trip-search-core'
import { groupByDay, type DayRange } from '../../../trip-days-core'

interface PanelProps {
  view: TripView
  stops: Stop[]
  photos: TripPhoto[]
  people: Person[]
  viewers?: Person[]
  selected?: string
  photoBy: string | null
  onPhotoBy: (by: string | null) => void
  /* The second argument is the list the viewer should page through: the one
     the click came from, in the order it was being read. */
  onSelect: (item: TripItem, ordered?: TripPhoto[]) => void
  onClose: () => void
  onInvite: () => void
  /** absent for read-only viewers — the button goes with it */
  onAddPhotos?: () => void
  /** filing several photographs at once; absent for read-only viewers */
  onMovePhotos?: (
    ids: Id[],
    filing: { stopId?: Id | null; stopPinned?: boolean },
  ) => Promise<boolean | undefined> | boolean | undefined
  sights: SightsListProps
  /** road truth from the routing engine, keyed by the stop each leg leaves */
  legs?: Map<Id, TripLeg>
  /** what gives a stored day label its year and a bare number its month */
  range?: DayRange
  /** the family's room — see panel-chat */
  chat?: ChatProps
  /** the getting-there chain: the Travel view is its home */
  transport?: {
    segments: Segment[]
    loadFailed?: boolean
    now: number
    canEdit: boolean
    onEdit: (segment: Segment) => void
    onAdd: () => void
    onShowGate: (segment: Segment) => void
    onAttach: (segment: Segment, file: File) => void
    onEditDoc?: (documentId: string, changes: { name?: string; note?: string }) => void
    onRemoveDoc?: (documentId: string) => void
  }
}

const HEADINGS: Record<string, [string, string]> = {
  timeline: ['Timeline', 'Every stop in order, with what everyone photographed along the way.'],
  travel: [
    'Getting there',
    'Every leg of the journey — deadlines, seats and documents in one chain.',
  ],
  chat: ['Chat', 'The whole crew, one room — travellers and followers alike.'],
  photos: ['Photos', ''],
  sights: ['Sights nearby', 'Places worth a detour, from where the map is looking.'],
  people: ['People', 'Who is travelling, and who is following from home.'],
}

export default function TripPanel(props: PanelProps) {
  const [title, sub] = HEADINGS[props.view] || ['', '']
  /* The gallery takes the screen. A wall of photographs in a 440px column is a
     column of photographs — three across, most of the screen given to a map
     nobody is looking at while they are looking at these. Everywhere else the
     panel is still a panel: a timeline or a chat has a natural width and does
     not get better for being stretched across a desktop. */
  const wide = props.view === 'photos'
  const action =
    props.view === 'photos' && props.onAddPhotos ? (
      <button
        className="mini mini-accent inline-flex items-center gap-1"
        onClick={props.onAddPhotos}>
        <Icon n="plus" s={13} />
        Add
      </button>
    ) : props.view === 'people' ? (
      <button className="mini mini-accent" onClick={props.onInvite}>
        Invite someone
      </button>
    ) : props.view === 'travel' && props.transport?.canEdit ? (
      <button className="mini mini-accent" onClick={props.transport.onAdd}>
        Add a leg
      </button>
    ) : null

  return (
    <aside
      className={
        'sheet rise absolute flex flex-col overflow-hidden ' +
        (wide
          ? /* Every pixel BELOW the trip's own chrome, and not one above it.
               The gallery is a view of the trip, not a place you leave it: the
               title and the row of tabs are how anybody gets to the map, the
               timeline or anywhere else, and a screen that covers them is a
               screen you are stuck in. --trip-top already carries the bezel,
               so this clears an island without knowing there is one. */
            `sheet-flat inset-x-0 bottom-0 top-[var(--trip-top)] z-30 rounded-none border-0
             max-sm:pb-[env(safe-area-inset-bottom,0px)]`
          : `z-[6] bottom-[var(--trip-1)] left-7 top-[var(--trip-top)] w-[440px] rounded-2xl
             max-lg:inset-x-4 max-lg:w-auto
             max-sm:inset-x-0 max-sm:bottom-0 max-sm:rounded-none max-sm:border-x-0
             max-sm:border-b-0`)
      }>
      {/* The gallery draws its own, because a title bar and a row of controls
          stacked on top of each other is two bands of chrome above the thing
          somebody actually opened. */}
      {!wide && (
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 pb-3.5 pt-[18px]">
          <div className="min-w-0">
            <h2 className="m-0 truncate text-2xl font-extrabold tracking-[-.02em]">{title}</h2>
            {sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
          </div>
          <div className="flex flex-none items-center gap-1.5">
            {action}
            <button
              className="grid size-8 place-items-center rounded-lg text-muted hover:bg-raised2 hover:text-ink"
              onClick={props.onClose}
              title="Back to map"
              aria-label="Back to map">
              <Icon n="x" s={16} />
            </button>
          </div>
        </div>
      )}
      <div
        className={
          'flex-1 overflow-y-auto ' +
          (wide
            ? 'pb-6 max-sm:pb-[calc(1rem+env(safe-area-inset-bottom,0px))]'
            : 'px-2 pb-4 pt-2 max-sm:pb-[calc(1rem+env(safe-area-inset-bottom,0px))]')
        }>
        {props.view === 'timeline' && <Timeline {...props} />}
        {props.view === 'travel' && <Travel {...props} />}
        {props.view === 'chat' && props.chat && <ChatPanel {...props.chat} />}
        {props.view === 'photos' && <PanelPhotos {...props} />}
        {props.view === 'sights' && <SightsList {...props.sights} />}
        {props.view === 'people' && (
          <PeopleList people={props.people} photos={props.photos} viewers={props.viewers} />
        )}
      </div>
    </aside>
  )
}

function Row({
  time,
  icon,
  title,
  detail,
  selected,
  onClick,
}: {
  time: string
  icon: ReactNode
  title: string
  detail: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={
        'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left ' +
        (selected ? 'bg-accent-soft' : 'hover:bg-raised2')
      }>
      <span className="tnum w-10 flex-none text-[11px] text-faint">{time}</span>
      {icon}
      <span className="min-w-0 flex-1">
        <b className="block truncate text-sm font-semibold">{title}</b>
        <span className="block truncate text-xs text-muted">{detail}</span>
      </span>
    </button>
  )
}

/* The Travel view: the chain is the whole page. The header carries the name
   and the add action, so the chain itself is bare legs and gaps. */
function Travel({ transport }: PanelProps) {
  if (!transport?.segments.length)
    return (
      <p className="hint p-4">
        {transport?.loadFailed
          ? 'The travel legs could not be loaded — they will retry on their own.'
          : transport?.canEdit
            ? 'No legs yet. Add the flight or train that starts the trip.'
            : 'No travel legs on this trip yet.'}
      </p>
    )
  return (
    <div className="px-3 pt-3">
      <SegmentChain {...transport} />
    </div>
  )
}

function Timeline({ stops, photos, selected, onSelect, legs, range }: PanelProps) {
  /* Grouped the same way the day chips are, by date rather than by the text a
     stop happens to hold — otherwise '4' and 'Fri 4 Sep' are two headings, and
     a stop with no day at all belongs to no heading and is never drawn. */
  const groups = groupByDay(stops, range)
  const byStop = new Map(stops.map(stop => [stop.id, stop]))
  if (!stops.length)
    return <p className="hint p-4">No stops yet. Place a pin on the map to start.</p>

  return (
    <>
      {groups.map(group => {
        const here = group.things
        return (
          <div key={group.day?.iso ?? 'undated'}>
            <div
              className="flex items-baseline gap-2 px-3 pb-1.5 pt-3.5 text-[11px] font-bold
                            uppercase tracking-[.1em] text-faint">
              <b className={group.day ? 'text-ink' : 'text-muted'}>
                {group.day?.label ?? 'No date yet'}
              </b>
              <span>
                {here.length} stop{here.length === 1 ? '' : 's'}
              </span>
            </div>
            {here.map(stop => {
              const taken = photos.filter(photo => photo.stopId === stop.id)
              return (
                <div key={stop.id}>
                  <Row
                    time={stop.time || ''}
                    title={stop.name || 'Untitled stop'}
                    detail={stop.note || stop.kind || ''}
                    selected={selected === stop.id}
                    onClick={() => onSelect(stopItem(stop))}
                    icon={
                      <span
                        className={
                          'grid size-[30px] flex-none place-items-center rounded-lg ' +
                          'bg-raised ' +
                          (stop.status === 'done' ? 'text-accent' : 'text-muted')
                        }>
                        <Icon n={stop.status === 'done' ? 'check' : stop.icon || 'pin'} s={14} />
                      </span>
                    }
                  />
                  {taken.map(photo => (
                    <Row
                      key={photo.id}
                      time=""
                      title={photo.caption || (photo.kind === 'video' ? 'Video' : 'Photo')}
                      detail={[photo.by, photo.when].filter(Boolean).join(' · ')}
                      selected={selected === photo.id}
                      onClick={() => onSelect(photoItem(photo, byStop.get(stop.id)))}
                      icon={
                        <span className="size-[30px] flex-none overflow-hidden rounded-lg">
                          {/* No length at 30px: the play mark alone says it
                              moves, and a timestamp there is unreadable. */}
                          <MediaThumb
                            item={photo}
                            w={90}
                            h={90}
                            badge={14}
                            className="size-full object-cover"
                          />
                        </span>
                      }
                    />
                  ))}
                  {legs?.has(stop.id) && (
                    /* The road between this stop and the next, in the gap
                       between their rows — a fact of the world, not a row of
                       the plan, so it is quiet and unclickable. */
                    <div className="pl-[52px] pr-3 pb-1 text-[11px] text-faint">
                      ↓ {legLabel(legs.get(stop.id)!)}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
    </>
  )
}
