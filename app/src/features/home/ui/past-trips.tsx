import { Link } from '@tanstack/react-router'
import { loadAccountArchive } from '../../../backend'
import { formatRange } from '../../../shared/lib/trip-dates'
import Boot from '../../../shared/ui/boot'
import { useToast } from '../../../shared/ui/toast'
import useLanding from '../model/use-landing'
import { globeScene, isPast, tripPlaces, tripProgress } from '../model/trip-globe'
import HomeShell, { Crumb, PageHeading } from './home-shell'
import Globe from './globe'
import type { TripSummary } from '../../../shared/model/types'

export default function PastTripsPage() {
  const { trips, profile, loading, error, reload } = useLanding()
  const past = trips.filter(trip => isPast(trip))
  const scene = globeScene(past[past.length - 1] || null, profile)

  if (error) return <Boot what="Your trips" error={error} onRetry={reload} />

  return (
    <HomeShell me={profile} wide home={scene.home} places={scene.places}>
      <Crumb here="Past trips" />
      <PageHeading>Past trips</PageHeading>
      <p className="m-0 max-w-[480px] text-base leading-relaxed text-muted">
        Finished trips keep everything — the route, every photo, who was there. Open one to walk it
        again, or download the lot.
      </p>
      {loading && <p className="hint">Loading…</p>}
      {!loading && !past.length && (
        <div className="rounded-2xl border-[1.5px] border-dashed border-line2 p-6 text-center text-[13px] text-faint">
          Nothing here yet. Your trips land here the day after you come home.
        </div>
      )}
      {past.map(trip => (
        <PastCard key={trip.id} trip={trip} />
      ))}
    </HomeShell>
  )
}

function PastCard({ trip }: { trip: TripSummary }) {
  const notify = useToast()
  const progress = tripProgress(trip)
  const stats = [
    [progress.days, progress.days === 1 ? 'day' : 'days'],
    [trip.stopCount || 0, 'stops'],
    [trip.photoCount || 0, 'photos'],
    [trip.memberCount || 0, 'people'],
  ] as const

  const download = async () => {
    try {
      const archive = await loadAccountArchive()
      const blob = new Blob([JSON.stringify(archive, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `off-we-go-${archive.exportedAt.slice(0, 10)}.json`
      link.click()
      URL.revokeObjectURL(url)
      notify('Archive downloaded.')
    } catch {
      notify('The archive could not be built just now.', 'error')
    }
  }

  return (
    <article className="surface grid grid-cols-[150px_1fr] items-stretch gap-4 p-3.5">
      {/* The trip's own shape, drawn from its stops rather than a stock photo. */}
      <div className="relative min-h-[110px] overflow-hidden rounded-xl bg-raised2">
        <Globe places={tripPlaces(trip)} />
      </div>
      <div className="flex flex-col gap-1">
        <b className="text-[17px] font-extrabold tracking-[-.01em]">{trip.title}</b>
        <span className="text-[12.5px] text-muted">
          {[trip.dates || formatRange(trip.startsOn, trip.endsOn), trip.crew]
            .filter(Boolean)
            .join(' · ')}
        </span>
        <div className="mt-1 flex gap-4 text-xs text-muted">
          {stats.map(([value, label]) => (
            <span key={label}>
              <b className="tnum mr-1 text-sm text-ink">{value}</b>
              {label}
            </span>
          ))}
        </div>
        <div className="mt-auto flex items-center gap-2 pt-2">
          <Link
            className="btn btn-ghost px-3.5 py-2"
            to="/trips/$slug"
            params={{ slug: trip.slug }}
            search={{}}>
            Open
          </Link>
          <button className="mini" onClick={download}>
            Download
          </button>
        </div>
      </div>
    </article>
  )
}
