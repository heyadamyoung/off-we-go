import { Link } from '@tanstack/react-router'
import { hasBackend, signOut } from '../../../backend'
import { formatRange } from '../../../shared/lib/trip-dates'
import Icon from '../../../shared/ui/icon'
import { Card, NotificationsCard, PrivacyCard, Row } from './profile-cards'
import type { Preferences } from '../../../preferences-core'
import type { MyProfile, TripSummary } from '../../../shared/model/types'

const TIME_ZONES = ['America/Regina', 'America/Toronto', 'America/Vancouver', 'Europe/London',
  'Europe/Amsterdam', 'Europe/Paris', 'Australia/Sydney', 'UTC']

/* One section per tab. They were a wall of six cards in two columns, which is a
   lot to read past to change your handle — and on a phone a single column of
   everything you have ever set. Same shape as the trip's settings: a row of
   tabs, one thing at a time. */

interface SectionProps {
  profile: MyProfile
  trips: TripSummary[]
  preferences: Preferences
  savePreferences: (next: Preferences) => void
  field: (key: string, fallback?: string) => string
  set: (key: string, value: string) => void
  saveDetails: () => void
  saving: boolean
  draft: Record<string, string> | null
  download: () => void
  removeAccount: () => void
}

export function ProfileSection({ field, set, saveDetails, saving, draft }: SectionProps) {
  return (
<Card title="Profile" aside="Shown to people on your trips">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="field">Display name
            <input value={field('name')} onChange={event => set('name', event.target.value)} />
          </label>
          <label className="field">Handle
            <input value={field('handle')} autoCapitalize="none" spellCheck={false}
                   onChange={event => set('handle', event.target.value.toLowerCase())} />
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="field">Home base
            <input placeholder="Regina, Saskatchewan" value={field('homePlace')}
                   onChange={event => set('homePlace', event.target.value)} />
          </label>
          <label className="field">Time zone
            <select value={field('timeZone', TIME_ZONES[0])}
                    onChange={event => set('timeZone', event.target.value)}>
              {TIME_ZONES.map(zone => <option key={zone} value={zone}>{zone}</option>)}
            </select>
          </label>
        </div>
        <p className="hint">
          Home base marks where each trip leaves from and comes back to on your globe, and the
          time zone is the one followers see beside local times.
        </p>
        <div>
          <button className="btn btn-solid" disabled={!draft || saving} onClick={saveDetails}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </Card>
  )
}

export function AccountSection({ profile, trips }: SectionProps) {
  return (
<Card title="Sign-in &amp; email">
        <Row title={profile.email || 'No email on file'}
             detail="You sign in with this address. Changing it means signing in again." />
        <Row title="This browser" detail="Signed in now"
             action={hasBackend
               ? <button className="mini" onClick={() => signOut().then(() => window.location.assign('/'))}>
                   Sign out
                 </button>
               : null} />
        <h3 className="mt-1.5 flex items-center justify-between text-[15px] font-extrabold">
          Your phones
          <span className="text-xs font-semibold text-faint">Report your position to a trip</span>
        </h3>
        {trips.length ? trips.map(trip => (
          <Row key={trip.id} title={trip.title}
               detail="Pair a phone to this trip, or remove one"
               action={<Link className="mini" to="/trips/$slug" params={{ slug: trip.slug }}
                             search={{ sheet: 'settings' as const, tab: 'phones' as const }}>
                 Phones
               </Link>} />
        )) : <p className="hint">No trips yet, so there is nothing for a phone to report to.</p>}
        <p className="hint">
          A phone only shares its position while a trip is running, and only with the people on
          that trip.
        </p>
      </Card>
  )
}

export function AlertsSection({ preferences, savePreferences }: SectionProps) {
  return (
    <>
<NotificationsCard preferences={preferences} onChange={savePreferences} />
          <PrivacyCard preferences={preferences} onChange={savePreferences} />
    </>
  )
}

export function TripsSection({ trips }: SectionProps) {
  return (
<Card title="Your trips" aside={<Link to="/">All trips</Link>}>
        {trips.length ? trips.map(trip => (
          <Row key={trip.id}
               title={<Link to="/trips/$slug" params={{ slug: trip.slug }}
                            search={{}}>{trip.title}</Link>}
               detail={[trip.dates || formatRange(trip.startsOn, trip.endsOn), trip.crew]
                 .filter(Boolean).join(' · ')}
               action={<span className={'rounded-md border px-2 py-1 text-[11px] font-bold ' +
                 (trip.role === 'owner'
                   ? 'border-accent-soft bg-accent-soft text-accent' : 'border-line text-faint')}>
                 {trip.role === 'owner' ? 'Owner' : trip.role === 'editor' ? 'Traveller' : 'Following'}
               </span>} />
        )) : <p className="hint">When someone invites you along, their trip shows up here.</p>}
      </Card>
  )
}

export function DataSection({ download, removeAccount }: SectionProps) {
  return (
<Card title="Your data">
        <Row title="Download an archive"
             detail="Every caption, comment and stop, a GPX trail per trip, and a link to each photo at full size."
             action={<button className="mini" onClick={download}>
               <Icon n="download" s={13} className="inline -mt-0.5 mr-1" />Download
             </button>} />
        <div className="flex flex-col gap-2 rounded-xl border border-danger p-3.5">
          <h4 className="m-0 text-[13px] text-danger">Delete my account</h4>
          <p className="hint">
            Removes your profile, comments, likes, phones, GPS history and uploaded photos. A trip
            disappears too if you are its only owner — hand it to someone else first if they
            should keep it.
          </p>
          <div>
            <button className="btn btn-danger" onClick={removeAccount}>Delete my account…</button>
          </div>
        </div>
      </Card>
  )
}
