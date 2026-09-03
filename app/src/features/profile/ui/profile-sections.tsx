import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { hasBackend, signOut, updateMe } from '../../../backend'
import { appErrorMessage } from '../../../user-messages-core'
import {
  disconnectMailbox,
  loadConnectors,
  startOutlookConnection,
  type ConnectorState,
} from '../../../connectors-client'
import { formatRange } from '../../../shared/lib/trip-dates'
import Icon from '../../../shared/ui/icon'
import { Card, NotificationsCard, PrivacyCard, Row } from './profile-cards'
import type { Preferences } from '../../../preferences-core'
import type { MyProfile, Toast, TripSummary } from '../../../shared/model/types'

const TIME_ZONES = [
  'America/Regina',
  'America/Toronto',
  'America/Vancouver',
  'Europe/London',
  'Europe/Amsterdam',
  'Europe/Paris',
  'Australia/Sydney',
  'UTC',
]

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
  toast: Toast
}

export function ProfileSection({
  profile,
  field,
  set,
  saveDetails,
  saving,
  draft,
  toast,
}: SectionProps) {
  const [homeBusy, setHomeBusy] = useState(false)
  const hasHome = profile.homeLat != null && profile.homeLng != null

  /* The home privacy zone needs coordinates, not a town name. The browser has
     them; two taps beats teaching anyone what a latitude is. */
  const setHomeHere = () => {
    if (!navigator.geolocation) {
      toast('This browser cannot report a location.', 'error')
      return
    }
    setHomeBusy(true)
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        updateMe({ homeLat: coords.latitude, homeLng: coords.longitude })
          .then(() => toast('Home point saved — the trail will keep its distance'))
          .catch(error => toast(appErrorMessage(error, 'save-profile'), 'error'))
          .finally(() => setHomeBusy(false))
      },
      () => {
        setHomeBusy(false)
        toast('Location permission was refused.', 'error')
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    )
  }
  const clearHome = () => {
    setHomeBusy(true)
    updateMe({ homeLat: null, homeLng: null })
      .then(() => toast('Home point cleared'))
      .catch(error => toast(appErrorMessage(error, 'save-profile'), 'error'))
      .finally(() => setHomeBusy(false))
  }

  return (
    <Card title="Profile" aside="Shown to people on your trips">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="field">
          Display name
          <input value={field('name')} onChange={event => set('name', event.target.value)} />
        </label>
        <label className="field">
          Handle
          <input
            value={field('handle')}
            autoCapitalize="none"
            spellCheck={false}
            onChange={event => set('handle', event.target.value.toLowerCase())}
          />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="field">
          Home base
          <input
            placeholder="Regina, Saskatchewan"
            value={field('homePlace')}
            onChange={event => set('homePlace', event.target.value)}
          />
        </label>
        <label className="field">
          Time zone
          <select
            value={field('timeZone', TIME_ZONES[0])}
            onChange={event => set('timeZone', event.target.value)}>
            {TIME_ZONES.map(zone => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="hint">
        Home base marks where each trip leaves from and comes back to on your globe, and the time
        zone is the one followers see beside local times.
      </p>
      <div className="mt-1 flex flex-col gap-2 border-t border-line pt-3">
        <b className="text-[11px] font-extrabold uppercase tracking-[.08em] text-accent">
          Home privacy zone
        </b>
        <p className="hint">
          {hasHome
            ? 'Your home point is set: GPS history within 250 m of it never leaves the ' +
              'server, so the trail keeps its distance from your front door.'
            : 'Save a home point and GPS history within 250 m of it never leaves the ' +
              'server — the trail keeps its distance from your front door. Live position ' +
              'keeps working.'}
        </p>
        <div className="flex gap-2">
          <button className="mini" disabled={homeBusy} onClick={setHomeHere}>
            {homeBusy
              ? 'Working…'
              : hasHome
                ? 'Update to my current location'
                : 'Use my current location'}
          </button>
          {hasHome && (
            <button className="mini" disabled={homeBusy} onClick={clearHome}>
              Clear
            </button>
          )}
        </div>
      </div>
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
      <Row
        title={profile.email || 'No email on file'}
        detail="You sign in with this address. Changing it means signing in again."
      />
      <Row
        title="This browser"
        detail="Signed in now"
        action={
          hasBackend ? (
            <button
              className="mini"
              onClick={() => signOut().then(() => window.location.assign('/'))}>
              Sign out
            </button>
          ) : null
        }
      />
      <h3 className="mt-1.5 flex items-center justify-between text-[15px] font-extrabold">
        Your phones
        <span className="text-xs font-semibold text-faint">Report your position to a trip</span>
      </h3>
      {trips.length ? (
        trips.map(trip => (
          <Row
            key={trip.id}
            title={trip.title}
            detail="Pair a phone to this trip, or remove one"
            action={
              <Link
                className="mini"
                to="/trips/$slug"
                params={{ slug: trip.slug }}
                search={{ sheet: 'settings' as const, tab: 'phones' as const }}>
                Phones
              </Link>
            }
          />
        ))
      ) : (
        <p className="hint">No trips yet, so there is nothing for a phone to report to.</p>
      )}
      <p className="hint">
        A phone only shares its position while a trip is running, and only with the people on that
        trip.
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
      {trips.length ? (
        trips.map(trip => (
          <Row
            key={trip.id}
            title={
              <Link to="/trips/$slug" params={{ slug: trip.slug }} search={{}}>
                {trip.title}
              </Link>
            }
            detail={[trip.dates || formatRange(trip.startsOn, trip.endsOn), trip.crew]
              .filter(Boolean)
              .join(' · ')}
            action={
              <span
                className={
                  'rounded-md border px-2 py-1 text-[11px] font-bold ' +
                  (trip.role === 'owner'
                    ? 'border-accent-soft bg-accent-soft text-accent'
                    : 'border-line text-faint')
                }>
                {trip.role === 'owner'
                  ? 'Owner'
                  : trip.role === 'editor'
                    ? 'Traveller'
                    : 'Following'}
              </span>
            }
          />
        ))
      ) : (
        <p className="hint">When someone invites you along, their trip shows up here.</p>
      )}
    </Card>
  )
}

export function DataSection({ download, removeAccount }: SectionProps) {
  return (
    <Card title="Your data">
      <Row
        title="Download an archive"
        detail="Every caption, comment and stop, a GPX trail per trip, and a link to each photo at full size."
        action={
          <button className="mini" onClick={download}>
            <Icon n="download" s={13} className="inline -mt-0.5 mr-1" />
            Download
          </button>
        }
      />
      <div className="flex flex-col gap-2 rounded-xl border border-danger p-3.5">
        <h4 className="m-0 text-[13px] text-danger">Delete my account</h4>
        <p className="hint">
          Removes your profile, comments, likes, phones, GPS history and uploaded photos. A trip
          disappears too if you are its only owner — hand it to someone else first if they should
          keep it.
        </p>
        <div>
          <button className="btn btn-danger" onClick={removeAccount}>
            Delete my account…
          </button>
        </div>
      </div>
    </Card>
  )
}

/* Connecting a mailbox. The sign-in and the consent are Microsoft's screens,
   because that is the point of OAuth — the password is typed somewhere we
   cannot see it, and the permissions are granted somewhere we cannot fake.
   Everything either side of it is here: what is connected, adding another,
   taking one away. */
export function ConnectionsSection({ toast }: SectionProps) {
  const [state, setState] = useState<ConnectorState | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = () =>
    loadConnectors()
      .then(setState)
      .catch(() => setState(null))
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once on mount; refresh is rebuilt every render, so listing it would loop
  useEffect(() => {
    refresh()
  }, [])

  const connect = async () => {
    setBusy(true)
    try {
      window.location.assign(await startOutlookConnection(window.location.href))
    } catch {
      setBusy(false)
      toast('That connection could not be started', 'error')
    }
  }

  const disconnect = async (id: string, email?: string) => {
    if (!window.confirm(`Disconnect ${email || 'this mailbox'}?`)) return
    try {
      await disconnectMailbox(id)
      toast('Mailbox disconnected')
      refresh()
    } catch {
      toast('That mailbox could not be disconnected', 'error')
    }
  }

  return (
    <Card title="Connected mailboxes" aside="Outlook">
      {!state ? (
        <p className="hint">Loading…</p>
      ) : !state.configured ? (
        <p className="hint">
          No mailbox connector is set up on this server yet. Once one is, connecting a mailbox will
          appear here.
        </p>
      ) : (
        <>
          {state.connections.length ? (
            state.connections.map(connection => (
              <Row
                key={connection.id}
                title={connection.email || connection.name || 'Outlook mailbox'}
                detail={
                  connection.needsReconnect
                    ? 'Microsoft stopped accepting this connection — connect it again'
                    : `${connection.name ? `${connection.name} · ` : ''}Outlook`
                }
                action={
                  <button
                    className="mini"
                    onClick={() => disconnect(connection.id, connection.email)}>
                    Disconnect
                  </button>
                }
              />
            ))
          ) : (
            <p className="hint">
              No mailbox is connected. Connecting one lets Off We Go read the mail you point it at —
              nothing is sent, and it can be disconnected here at any time.
            </p>
          )}
          <div>
            <button className="btn btn-solid" disabled={busy} onClick={connect}>
              {state.connections.length ? 'Connect another mailbox' : 'Connect Outlook'}
            </button>
          </div>
          <p className="hint">
            You sign in on Microsoft's own page; we never see the password. The permissions asked
            for are read-only.
          </p>
        </>
      )}
    </Card>
  )
}
