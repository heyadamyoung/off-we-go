import { type ReactNode, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from '../../../shared/ui/icon'
import { SightsList, type SightsListProps } from '../../sights'
import { PushOffer, SegmentChain } from '../../transport'
import PanelPhotos from './panel-photos'
import PanelPapers from './panel-papers'
import Timeline from './timeline'
import type { TripItem } from '../model/trip-items'
import PeopleList from './panel-people'
import ChatPanel, { type ChatProps } from './panel-chat'
import type { Paper } from '../../../papers-core'
import type { Segment } from '../../../segments-core'
import type { Id, Person, Stop, Toast, TripLeg, TripPhoto } from '../../../shared/model/types'
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
  /** deleting several photographs at once; absent for read-only viewers */
  onDeletePhotos?: (ids: Id[]) => Promise<void> | void
  /** where the gallery's saves say how they went */
  toast?: Toast
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
    /** the trip the legs are on, for the airport's trail behind a ticket */
    tripId?: string
    segments: Segment[]
    loadFailed?: boolean
    now: number
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

/* Just the name, the same word as the tab. A sentence explaining a screen
   is a sentence in the way of it. */
const HEADINGS: Record<string, string> = {
  timeline: 'Timeline',
  travel: 'Travel',
  papers: 'Papers',
  chat: 'Chat',
  photos: 'Photos',
  sights: 'Sights',
  people: 'People',
}

/* The panel's name and its verbs, the same row on every panel: the name,
   a plus where there is something to add, and the way back. On a desktop
   this is the panel's own first row. On a phone it takes the trip title's
   row in the top bar instead — the title, the tabs and then a panel title
   made three bands of chrome, a third of the screen, above the thing
   somebody opened; the tabs under it already say where you are, and the
   title comes back with the map. */
export function PanelHeader({
  title,
  action,
  onClose,
  className = '',
}: {
  title: string
  action: ReactNode
  onClose: () => void
  className?: string
}) {
  return (
    <div
      className={
        'phead flex items-center justify-between gap-3 border-b border-line px-5 py-3 ' +
        'max-sm:min-h-10 max-sm:border-0 max-sm:px-0 max-sm:py-0 ' +
        className
      }>
      <h2 className="m-0 min-w-0 truncate text-xl font-extrabold tracking-[-.02em] max-sm:text-[17px]">
        {title}
      </h2>
      <div className="flex flex-none items-center gap-1.5">
        {action}
        <button
          className="grid size-8 place-items-center rounded-lg text-muted hover:bg-raised2 hover:text-ink"
          onClick={onClose}
          title="Back to map"
          aria-label="Back to map">
          <Icon n="x" s={16} />
        </button>
      </div>
    </div>
  )
}

/* The top bar's row, found once it is in the document: the bar renders before
   the panel, but nothing is in the DOM until the first commit. */
function useTopBar() {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  useEffect(() => setSlot(document.getElementById('trip-top')), [])
  return slot
}

/* One plus, wherever there is one more of something to add. */
function Plus({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      className="mini mini-accent grid size-8 place-items-center !px-0"
      onClick={onClick}
      title={label}
      aria-label={label}>
      <Icon n="plus" s={15} />
    </button>
  )
}

export default function TripPanel(props: PanelProps) {
  const title = HEADINGS[props.view] || ''
  const topBar = useTopBar()
  /* A tab opens at its top. Switching from the Travel tab halfway down to
     Photos landed halfway down Photos, because the one scroller served every
     view; a fresh page already starts at the top, and a switch is the same
     request. */
  const body = useRef<HTMLDivElement>(null)
  useEffect(() => {
    body.current?.scrollTo({ top: 0 })
  }, [props.view])
  /* The gallery takes the screen. A wall of photographs in a 440px column is a
     column of photographs — three across, most of the screen given to a map
     nobody is looking at while they are looking at these. Everywhere else the
     panel is still a panel: a timeline or a chat has a natural width and does
     not get better for being stretched across a desktop. */
  const wide = props.view === 'photos'
  const action =
    props.view === 'photos' && props.onAddPhotos ? (
      <Plus label="Add photos or videos" onClick={props.onAddPhotos} />
    ) : props.view === 'people' ? (
      <Plus label="Invite someone" onClick={props.onInvite} />
    ) : props.view === 'travel' && props.transport?.canEdit ? (
      <Plus label="Add a leg" onClick={props.transport.onAdd} />
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
      <PanelHeader
        title={title}
        action={action}
        onClose={props.onClose}
        className="max-sm:hidden"
      />
      {topBar &&
        createPortal(
          <PanelHeader
            title={title}
            action={action}
            onClose={props.onClose}
            className="w-full sm:hidden"
          />,
          topBar,
        )}
      <div
        ref={body}
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
   and the add action, so the chain itself is bare legs and gaps. The make-it
   meter is the map's, floated over it where everybody's position is drawn;
   a second copy boxed above the tickets was a box in the way of them. */
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
    /* A ticket is a ticket's width. On a tablet the panel is the screen less
       its margins, and a card stretched across seven hundred pixels put the
       gate a hand's breadth from the terminal; the column is capped and
       centred instead, the way a boarding pass is not the size of the desk. */
    <div className="mx-auto w-full max-w-[600px] px-3 pt-3">
      <SegmentChain {...transport} />
      {/* Under the tickets, for a browser that can be told about them while
          it is closed: one line, and gone once it is on. */}
      {transport.tripId && <PushOffer tripId={transport.tripId} />}
    </div>
  )
}
