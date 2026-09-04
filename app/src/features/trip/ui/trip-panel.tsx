import type { ReactNode } from 'react'
import Icon from '../../../shared/ui/icon'
import Img from '../../../shared/ui/img'
import { SightsList, type SightsListProps } from '../../sights'
import { SegmentChain } from '../../transport'
import { photoItem, stopItem, type TripItem } from '../model/trip-items'
import PeopleList from './panel-people'
import ChatPanel, { type ChatProps } from './panel-chat'
import type { Segment } from '../../../segments-core'
import { legLabel } from '../../../legs-core'
import type { Id, Person, Stop, TripLeg, TripPhoto } from '../../../shared/model/types'
import type { TripView } from '../../../trip-search-core'

interface PanelProps {
  view: TripView
  stops: Stop[]
  photos: TripPhoto[]
  people: Person[]
  viewers?: Person[]
  selected?: string
  photoBy: string | null
  onPhotoBy: (by: string | null) => void
  onSelect: (item: TripItem) => void
  onClose: () => void
  onInvite: () => void
  /** absent for read-only viewers — the button goes with it */
  onAddPhotos?: () => void
  sights: SightsListProps
  /** road truth from the routing engine, keyed by the stop each leg leaves */
  legs?: Map<Id, TripLeg>
  /** the family's room — see panel-chat */
  chat?: ChatProps
  /** the getting-there chain: the Travel view is its home */
  transport?: {
    segments: Segment[]
    now: number
    canEdit: boolean
    onEdit: (segment: Segment) => void
    onAdd: () => void
    onShowGate: (segment: Segment) => void
    onAttach: (segment: Segment, file: File) => void
  }
}

const HEADINGS: Record<string, [string, string]> = {
  timeline: ['Timeline', 'Every stop in order, with what everyone photographed along the way.'],
  travel: [
    'Getting there',
    'Every leg of the journey — deadlines, seats and documents in one chain.',
  ],
  chat: ['Chat', 'The whole crew, one room — travellers and followers alike.'],
  photos: ['Photos', 'Everything anyone has taken on this trip, newest first.'],
  sights: ['Sights nearby', 'Places worth a detour, from where the map is looking.'],
  people: ['People', 'Who is travelling, and who is following from home.'],
}

export default function TripPanel(props: PanelProps) {
  const [title, sub] = HEADINGS[props.view] || ['', '']
  const action =
    props.view === 'photos' && props.onAddPhotos ? (
      <button className="mini mini-accent" onClick={props.onAddPhotos}>
        Add photos
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
      className="sheet rise absolute bottom-[var(--trip-1)] left-7 top-[var(--trip-top)] z-[6] flex
                      w-[440px] flex-col overflow-hidden rounded-2xl
                      max-lg:inset-x-4 max-lg:w-auto
                      max-sm:inset-x-0 max-sm:bottom-0 max-sm:rounded-none max-sm:border-x-0
                      max-sm:border-b-0">
      <div className="flex items-start justify-between gap-3 border-b border-line px-5 pb-3.5 pt-[18px]">
        <div>
          <h2 className="m-0 text-2xl font-extrabold tracking-[-.02em]">{title}</h2>
          <p className="mt-1 text-xs text-muted">{sub}</p>
        </div>
        <div className="flex flex-none gap-1.5">
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
      <div
        className="flex-1 overflow-y-auto px-2 pb-4 pt-2
                      max-sm:pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
        {props.view === 'timeline' && <Timeline {...props} />}
        {props.view === 'travel' && <Travel {...props} />}
        {props.view === 'chat' && props.chat && <ChatPanel {...props.chat} />}
        {props.view === 'photos' && <Photos {...props} />}
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
        {transport?.canEdit
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

function Timeline({ stops, photos, selected, onSelect, legs }: PanelProps) {
  const days = [...new Set(stops.map(stop => stop.day).filter(Boolean))]
  const byStop = new Map(stops.map(stop => [stop.id, stop]))
  if (!stops.length)
    return <p className="hint p-4">No stops yet. Place a pin on the map to start.</p>

  return (
    <>
      {days.map(day => {
        const here = stops.filter(stop => stop.day === day)
        return (
          <div key={day}>
            <div
              className="flex items-baseline gap-2 px-3 pb-1.5 pt-3.5 text-[11px] font-bold
                            uppercase tracking-[.1em] text-faint">
              <b className="text-ink">{day}</b>
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
                      title={photo.caption || 'Photo'}
                      detail={[photo.by, photo.when].filter(Boolean).join(' · ')}
                      selected={selected === photo.id}
                      onClick={() => onSelect(photoItem(photo, byStop.get(stop.id)))}
                      icon={
                        <span className="size-[30px] flex-none overflow-hidden rounded-lg">
                          <Img item={photo} w={90} h={90} className="size-full object-cover" />
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

function Photos({ photos, stops, selected, photoBy, onPhotoBy, onSelect }: PanelProps) {
  const people = [...new Set(photos.map(photo => photo.by).filter(Boolean))]
  const shown = (photoBy ? photos.filter(photo => photo.by === photoBy) : photos).slice().reverse()
  const byStop = new Map(stops.map(stop => [stop.id, stop]))
  const filter = 'rounded-full px-3 py-1.5 text-xs font-bold'

  return (
    <>
      <div className="flex gap-1.5 px-3 pb-1 pt-3">
        <button
          className={filter + (photoBy ? ' bg-raised text-muted' : ' bg-ink text-canvas')}
          onClick={() => onPhotoBy(null)}>
          Everyone
        </button>
        {people.map(name => (
          <button
            key={name}
            className={
              filter + (photoBy === name ? ' bg-ink text-canvas' : ' bg-raised text-muted')
            }
            onClick={() => onPhotoBy(name)}>
            {name.split(' ')[0]}
          </button>
        ))}
      </div>
      {shown.length ? (
        <div className="grid grid-cols-3 gap-2 p-3">
          {shown.map(photo => (
            <button
              key={photo.id}
              aria-label={photo.caption || 'Photo'}
              className={
                'pgrid-photo relative aspect-square overflow-hidden rounded-xl bg-raised ' +
                (selected === photo.id ? 'outline outline-2 -outline-offset-2 outline-accent' : '')
              }
              onClick={() =>
                onSelect(photoItem(photo, photo.stopId ? byStop.get(photo.stopId) : undefined))
              }>
              <Img item={photo} w={320} h={320} className="size-full object-cover" />
              {photo.caption && (
                <span
                  className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/65
                                 to-transparent px-2 pb-1.5 pt-4 text-[11px] text-white">
                  {photo.caption}
                </span>
              )}
            </button>
          ))}
        </div>
      ) : (
        <p className="hint p-4">No photos yet. Add some from the camera button.</p>
      )}
    </>
  )
}
