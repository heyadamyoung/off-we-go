import { useState } from 'react'
import { createTrip, deleteAccount, signOut } from '../../backend'
import { daysBetween, formatRange } from '../../shared/lib/trip-dates'

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

function NoTrip({ email, onCreated }: any) {
  const [making, setMaking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [f, setF] = useState({ title: '', crew: '', startsOn: '', endsOn: '' })
  const span = daysBetween(f.startsOn, f.endsOn)
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))

  const create = async e => {
    e.preventDefault()
    if (!f.title.trim() || busy) return
    setBusy(true); setErr(null)
    try {
      await createTrip({
        title: f.title, crew: f.crew,
        startsOn: f.startsOn || null, endsOn: f.endsOn || null,
        dates: formatRange(f.startsOn, f.endsOn),
        dayCount: span || 1,
      })
      onCreated()
    }
    catch (e2) { setErr(e2.message || 'Could not create that trip'); setBusy(false) }
  }
  const removeAccount = async () => {
    if (window.prompt('Permanently delete this Wayfare account? Type DELETE to continue.') !== 'DELETE') return
    try { await deleteAccount(); window.location.reload() }
    catch (error) { setErr(error.message || 'Could not delete your account') }
  }

  return (
    <div className="boot">
      <div className="bootIn wide">
        <span className="mk brand"><img src="/wayfare-icon.png" alt="" /></span>
        {making ? (
          <>
            <b>Start a trip</b>
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
                        disabled={busy || !f.title.trim()}>{busy ? 'Creating…' : 'Create trip'}</button>
              </div>
            </form>
            {err && <p className="warn">{err}</p>}
          </>
        ) : (
          <>
            <b>No trip yet</b>
            <p>You are signed in as <strong>{email}</strong>, but nobody has invited that
               address to a trip. Invitations go by email address, so it has to be this one —
               ask whoever is running it to add you. Or start your own.</p>
            <div className="linkrow">
              <button className="btn" onClick={() => signOut().then(() => window.location.reload())}>
                Sign out
              </button>
              <button className="btn pri" onClick={() => setMaking(true)}>Start a trip</button>
            </div>
            <button className="btn danger" onClick={removeAccount}>Delete my account</button>
            {err && <p className="warn">{err}</p>}
          </>
        )}
      </div>
    </div>
  )
}

export default NoTrip



