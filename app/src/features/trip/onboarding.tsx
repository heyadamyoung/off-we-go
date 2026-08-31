import { useState } from 'react'
import { acceptInvite, createTrip, deleteAccount, signOut } from '../../backend'
import { daysBetween, formatRange } from '../../shared/lib/trip-dates'
import { appErrorMessage } from '../../user-messages-core'
import type { Id, PendingInvite, TripSummary } from '../../shared/model/types'
import type { ToastNotice } from '../../shared/ui/toast'

/* A face, or the next best thing.

   Everybody starts without a picture, and an <img> with an empty src is drawn
   by every browser as a broken image — so the photo grid was full of them. An
   SVG data URI rather than a styled <span>, because every place a face appears
   already has CSS aimed at an img, and this way none of it has to change. */
function initialAvatar(name) {
  const label = (name || '?').trim() || '?'
  const initial = label.charAt(0).toUpperCase()
  const hue = [...label].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 11)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" fill="hsl(${hue} 38% 34%)"/>` +
    `<text x="32" y="43" text-anchor="middle" fill="#fff" font-weight="700"` +
    ` font-size="30" font-family="system-ui,-apple-system,sans-serif">${initial}</text></svg>`
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg)
}

export const withFace = person =>
  (person && person.avatar ? person : { ...person, avatar: initialAvatar(person && person.name) })

interface TripLandingProps {
  email?: string
  trips: TripSummary[]
  invites: PendingInvite[]
  onChanged: () => void
  notify: (notice: ToastNotice) => void
}

const tripRole = (role: string) => role === 'owner' ? 'You own this trip'
  : role === 'editor' ? 'You can edit' : 'You can view'

function TripLanding({ email, trips = [], invites = [], onChanged, notify }: TripLandingProps) {
  const [making, setMaking] = useState(false)
  const [busy, setBusy] = useState<Id | 'create' | null>(null)
  const [f, setF] = useState({ title: '', crew: '', startsOn: '', endsOn: '' })
  const span = daysBetween(f.startsOn, f.endsOn)
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))

  const create = async e => {
    e.preventDefault()
    if (!f.title.trim() || busy) return
    setBusy('create')
    try {
      await createTrip({
        title: f.title, crew: f.crew,
        startsOn: f.startsOn || null, endsOn: f.endsOn || null,
        dates: formatRange(f.startsOn, f.endsOn),
        dayCount: span || 1,
      })
      notify({ message: 'Trip created. Your adventure is ready.', tone: 'success' })
      setMaking(false)
      setF({ title: '', crew: '', startsOn: '', endsOn: '' })
      setBusy(null)
      onChanged()
    }
    catch (e2) { notify({ message: appErrorMessage(e2, 'create-trip'), tone: 'error' }); setBusy(null) }
  }
  const removeAccount = async () => {
    if (window.prompt('Permanently delete this Off We Go account? Type DELETE to continue.') !== 'DELETE') return
    try { await deleteAccount(); window.location.reload() }
    catch (error) { notify({ message: appErrorMessage(error, 'delete-account'), tone: 'error' }) }
  }
  const accept = async id => {
    if (busy) return
    setBusy(id)
    try {
      await acceptInvite(id)
      notify({ message: 'Invitation accepted. Welcome to the trip!', tone: 'success' })
      setBusy(null)
      onChanged()
    }
    catch (error) { notify({ message: appErrorMessage(error, 'accept-invite'), tone: 'error' }); setBusy(null) }
  }

  return (
    <main className="tripLanding">
      <div className="tripLandingIn">
        <header className="landingHead">
          <span className="mk brand"><img src="/wayfare-icon.png" alt="" /></span>
          <div><span className="eyebrow">OFF WE GO</span><h1>Your trips</h1>
            {email && <p>Signed in as {email}</p>}
          </div>
        </header>
        {making ? (
          <section className="landingPanel newTripPanel">
            <h2>Start a trip</h2>
            <p>You will be its owner, and can invite everyone else once it exists.</p>
            <form className="newtrip" onSubmit={create}>
              <label>Where are you going?
                <input autoFocus required placeholder="City break" value={f.title}
                       onChange={e => set('title', e.target.value)} />
              </label>
              <label>Who is going?
                <input placeholder="Sample family" value={f.crew}
                       onChange={e => set('crew', e.target.value)} />
              </label>
              <div className="linkrow">
                <label>Leaving
                  <input type="date" value={f.startsOn} onChange={e => set('startsOn', e.target.value)} />
                </label>
                <label>Coming home
                  <input type="date" value={f.endsOn} min={f.startsOn || undefined}
                         onChange={e => set('endsOn', e.target.value)} />
                </label>
              </div>
              {span && <p className="span">{formatRange(f.startsOn, f.endsOn)}</p>}
              <div className="linkrow">
                <button type="button" className="btn" style={{ flex: 1 }}
                        onClick={() => setMaking(false)}>Back</button>
                <button type="submit" className="btn pri" style={{ flex: 1 }}
                        disabled={!!busy || !f.title.trim()}>{busy === 'create' ? 'Creating…' : 'Create trip'}</button>
              </div>
            </form>
          </section>
        ) : (
          <>
            <section className="landingSection" aria-labelledby="accessible-trips">
              <div className="landingSectionHead"><div><span className="eyebrow">READY TO GO</span>
                <h2 id="accessible-trips">Trips you can access</h2></div>
                <span className="countPill">{trips.length}</span>
              </div>
              {trips.length ? <div className="tripGrid">
                {trips.map(trip => <article className="tripCard" key={trip.id}>
                  <span className="tripInitial">{(trip.title || '?')[0]}</span>
                  <div className="tripCardBody"><h3>{trip.title}</h3>
                    <p>{[trip.crew, trip.dates].filter(Boolean).join(' · ') || tripRole(trip.role)}</p>
                    <span>{tripRole(trip.role)}</span>
                  </div>
                  <a className="btn pri" href={`?t=${encodeURIComponent(trip.slug)}`}
                     aria-label={`Open ${trip.title}`}>Open</a>
                </article>)}
              </div> : <div className="landingEmpty"><b>No trips yet</b>
                <p>Start your own trip, or accept an invitation below.</p></div>}
            </section>

            <section className="landingSection" aria-labelledby="trip-invitations">
              <div className="landingSectionHead"><div><span className="eyebrow">WAITING FOR YOU</span>
                <h2 id="trip-invitations">Invitations</h2></div>
                <span className="countPill">{invites.length}</span>
              </div>
              {invites.length ? <div className="tripGrid">
                {invites.map(invite => <article className="tripCard invitation" key={invite.id}>
                  <span className="tripInitial">{(invite.tripTitle || '?')[0]}</span>
                  <div className="tripCardBody"><h3>{invite.tripTitle}</h3>
                    <p>You have been invited to join this trip.</p>
                    <span>{invite.role === 'editor' ? 'Can edit' : 'Can view'}</span>
                  </div>
                  <button className="btn pri" disabled={!!busy} onClick={() => accept(invite.id)}>
                    {busy === invite.id ? 'Accepting…' : 'Accept'}
                  </button>
                </article>)}
              </div> : <div className="landingEmpty compact"><p>No pending invitations.</p></div>}
            </section>

            <div className="landingActions">
              <button className="btn pri" onClick={() => setMaking(true)}>Start a new trip</button>
              <button className="btn" onClick={() => signOut().then(() => window.location.reload())}>
                Sign out
              </button>
              <button className="btn danger" onClick={removeAccount}>Delete my account</button>
            </div>
          </>
        )}
      </div>
    </main>
  )
}

export default TripLanding



