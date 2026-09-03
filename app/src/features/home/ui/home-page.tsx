import { Link } from '@tanstack/react-router'
import { formatRange } from '../../../shared/lib/trip-dates'
import Boot from '../../../shared/ui/boot'
import OfflineNote from '../../../shared/ui/offline-note'
import Icon from '../../../shared/ui/icon'
import useLanding from '../model/use-landing'
import { globeScene, isPast, pickCurrentTrip, tripProgress } from '../model/trip-globe'
import HomeShell, { MoreLink } from './home-shell'
import type { TripSummary } from '../../../shared/model/types'

const STEPS = [
  {
    title: 'Name the trip and its dates',
    detail: 'Flights, hotels and plans can come later, or straight from your inbox.',
  },
  {
    title: "Invite who's coming — and who's following",
    detail: 'Travellers add photos and stops. Followers see everything, live.',
  },
  {
    title: 'Link your phone',
    detail: 'The map moves with you. It only reports while a trip is running.',
  },
]

export default function HomePage() {
  const { trips, invites, profile, offlineAt, loading, error, reload } = useLanding()
  const current = pickCurrentTrip(trips)
  const scene = globeScene(current, profile)
  const past = trips.filter(trip => isPast(trip))

  if (error) return <Boot what="Your trips" error={error} onRetry={reload} />
  if (loading)
    return (
      <HomeShell me={profile} waiting>
        <span />
      </HomeShell>
    )

  return (
    <HomeShell
      me={profile}
      places={scene.places}
      home={scene.home}
      live={scene.live}
      waiting={!trips.length}>
      {offlineAt != null && (
        <OfflineNote at={offlineAt} className="absolute left-1/2 top-4 z-20 -translate-x-1/2" />
      )}
      {trips.length ? (
        <Returning trip={current!} invites={invites.length} past={past.length} />
      ) : (
        <FirstVisit invites={invites.length} />
      )}
    </HomeShell>
  )
}

function FirstVisit({ invites }: { invites: number }) {
  return (
    <>
      <div className="flex items-center gap-2.5 text-xs font-bold uppercase tracking-[.14em] text-accent">
        Welcome
      </div>
      <h1 className="m-0 text-[56px] font-extrabold leading-[.98] tracking-[-.03em] text-balance">
        Bring everyone along.
      </h1>
      <p className="m-0 max-w-[480px] text-base leading-relaxed text-muted">
        Plan the trip, let your phone draw the route, drop photos where they happened — and the
        people at home follow it live, <b className="font-semibold text-ink">on this globe</b>.
      </p>
      <div className="mt-1.5 flex flex-col border-t border-line">
        {STEPS.map((step, index) => (
          <div key={step.title} className="flex items-start gap-4 border-b border-line py-3.5">
            <i
              className="mt-px grid size-[26px] flex-none place-items-center rounded-full border-[1.5px]
                          border-line2 text-xs font-extrabold not-italic text-muted">
              {index + 1}
            </i>
            <div>
              <b className="block text-sm">{step.title}</b>
              <span className="text-xs text-muted">{step.detail}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2.5">
        <Link className="btn btn-accent px-5 py-3 text-sm" to="/new">
          <Icon n="plus" s={14} />
          Start your first trip
        </Link>
        {invites > 0 && (
          <Link className="btn btn-ghost px-5 py-3 text-sm" to="/invitations">
            {invites} invitation{invites === 1 ? '' : 's'} waiting
          </Link>
        )}
      </div>
    </>
  )
}

function Returning({ trip, invites, past }: { trip: TripSummary; invites: number; past: number }) {
  const progress = tripProgress(trip)
  const dates = trip.dates || formatRange(trip.startsOn, trip.endsOn)
  const counted = [
    trip.stopCount ? `${trip.stopCount} stop${trip.stopCount === 1 ? '' : 's'}` : null,
    trip.photoCount ? `${trip.photoCount} photo${trip.photoCount === 1 ? '' : 's'}` : null,
    trip.memberCount ? `${trip.memberCount} on the trip` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <>
      <div className="flex items-center gap-2.5 text-xs font-bold uppercase tracking-[.14em] text-accent">
        {progress.state === 'live' && (
          <span className="size-2 rounded-full bg-accent shadow-[0_0_0_4px_var(--c-accent-soft),0_0_16px_var(--c-glow)]" />
        )}
        {progress.state === 'live'
          ? 'Live now'
          : progress.state === 'upcoming'
            ? 'Coming up'
            : 'Most recent'}
        {progress.days > 0 && progress.state === 'live' && (
          <span className="tracking-[.06em] text-faint">
            · Day {progress.day} of {progress.days}
          </span>
        )}
      </div>
      <h1 className="m-0 text-[56px] font-extrabold leading-[.98] tracking-[-.03em] text-balance">
        {trip.title}
      </h1>
      <p className="m-0 max-w-[480px] text-base leading-relaxed text-muted">
        {[trip.crew, dates].filter(Boolean).join(' · ')}
        {counted ? (
          <>
            . <b className="font-semibold text-ink">{counted}</b>.
          </>
        ) : (
          '.'
        )}
      </p>
      <div className="flex items-center gap-2.5">
        <Link
          className="btn btn-accent px-5 py-3 text-sm"
          to="/trips/$slug"
          params={{ slug: trip.slug }}>
          Open the trip
        </Link>
        <Link
          className="btn btn-ghost px-5 py-3 text-sm"
          to="/trips/$slug"
          params={{ slug: trip.slug }}
          search={{ sheet: 'add' as const }}>
          <Icon n="camera" s={14} />
          Add photos
        </Link>
      </div>
      <div className="mt-1 flex flex-col border-t border-line">
        <MoreLink
          to="/new"
          icon="plus"
          title="Start a new trip"
          detail="Plan the next one while this one is still going."
        />
        <MoreLink
          to="/invitations"
          icon="people"
          title="Invitations"
          detail="Trips you've been asked to join or follow."
          note={invites ? `${invites} waiting` : undefined}
        />
        <MoreLink
          to="/past"
          icon="trips"
          title="Past trips"
          detail="Finished trips keep their routes and photos."
          note={past ? `${past} trip${past === 1 ? '' : 's'}` : undefined}
        />
      </div>
    </>
  )
}
