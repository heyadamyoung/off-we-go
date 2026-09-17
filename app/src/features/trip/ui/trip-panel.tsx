import Icon from '../../../shared/ui/icon'
import { SightsList, type SightsListProps } from '../../sights'
import { MakeIt, SegmentChain } from '../../transport'
import PanelPhotos from './panel-photos'
import PanelPapers from './panel-papers'
import Timeline from './timeline'
import type { TripItem } from '../model/trip-items'
import PeopleList from './panel-people'
import ChatPanel, { type ChatProps } from './panel-chat'
import type { Paper } from '../../../papers-core'
import type { Segment } from '../../../segments-core'
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
  /** adding a stop to a day from the timeline; absent for a follower */
  onAddOnDay?: (iso: string) => void
  /** opening a leg of the journey from the timeline, in the Travel view */
  onTravel?: (segment: Segment) => void
  /** the papers view: everything the trip is carrying, in one place */
  papers?: { onOpen: (paper: Paper) => void }
  /** the family's room — see panel-chat */
  chat?: ChatProps
  /** the getting-there chain: the Travel view is its home */
  transport?: {
    segments: Segment[]
    loadFailed?: boolean
    now: number
    /** everybody's live position, for the make-it meter above the chain */
    travellers?: Array<{ name: string; lng: number; lat: number }>
    canEdit: boolean
    onEdit: (segment: Segment) => void
    onAdd: () => void
    onShowGate: (segment: Segment) => void
    onAttach: (segment: Segment, file: File) => void
    /* Every document opens the same full-screen paper, whichever of the three
       doors it was tapped through — the leg's own card, a stop's sheet, or the
       Papers tab. */
    onOpenPaper?: (paper: Paper) => void
  }
}

const HEADINGS: Record<string, [string, string]> = {
  timeline: [
    'Timeline',
    'The day in order — what was planned, and when everyone actually got there.',
  ],
  travel: [
    'Getting there',
    'Every leg of the journey — deadlines, seats and documents in one chain.',
  ],
  papers: ['Papers', 'Every ticket, pass and booking you are carrying — the next one first.'],
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
        {props.view === 'timeline' && (
          <Timeline
            {...props}
            now={props.transport?.now}
            segments={props.transport?.segments}
            /* A journey's home is the Travel view, where its seats, deadlines
               and documents are. The timeline says when it leaves; it does not
               try to become a second place to read a boarding pass. */
            onTravel={props.onTravel}
          />
        )}
        {props.view === 'travel' && <Travel {...props} />}
        {props.view === 'papers' && props.papers && (
          <PanelPapers
            stops={props.stops}
            segments={props.transport?.segments}
            now={props.transport?.now}
            onOpen={props.papers.onOpen}
          />
        )}
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
      {/* The one thing on this screen no competitor can build, at the top of
          the screen it is about. It floated over the map and the map hides it
          the moment a panel opens — so on the tab whose whole subject is
          whether you are going to make it, it was the one place it never
          appeared. It draws itself only on a travel day with somebody's
          position to draw. */}
      <MakeIt
        segments={transport.segments}
        travellers={transport.travellers || []}
        now={transport.now}
      />
      <SegmentChain {...transport} />
    </div>
  )
}
