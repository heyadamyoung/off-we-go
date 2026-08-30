import { useEffect, useRef, useState } from 'react'
import {
  deleteAccount, functionsUrl, hasBackend, invitePerson, listDevices, listInvites,
  registerDevice, removeDevice, removeMember, revokeInvite,
} from '../../../backend'
import { isNativeApp, mobilePlatform, mobileTracker } from '../../../mobile'
import { agoLabel } from '../../../shared/lib/geo'
import Icon from '../../../shared/ui/icon'
import Modal from '../../../shared/ui/modal'
import { daysBetween, formatRange } from '../../../shared/lib/trip-dates'

function TripSettings({ trip, onSave }: any) {
  const [f, setF] = useState({ title: trip.title || '', crew: trip.crew || '',
                               startsOn: trip.startsOn || '', endsOn: trip.endsOn || '' })
  const [dirty, setDirty] = useState(false)
  const set = (k, v) => { setF(x => ({ ...x, [k]: v })); setDirty(true) }
  return (
    <div className="tset">
      <div className="linkrow">
        <input value={f.title} placeholder="Trip name" onChange={e => set('title', e.target.value)} />
        <input value={f.crew} placeholder="Crew" onChange={e => set('crew', e.target.value)} />
      </div>
      <div className="linkrow">
        <label>Leaving
          <input type="date" value={f.startsOn} onChange={e => set('startsOn', e.target.value)} />
        </label>
        <label>Coming home
          <input type="date" value={f.endsOn} min={f.startsOn || undefined}
                 onChange={e => set('endsOn', e.target.value)} />
        </label>
        <button className="btn" disabled={!dirty}
                onClick={() => {
                  onSave({ ...f, dates: formatRange(f.startsOn, f.endsOn),
                           dayCount: daysBetween(f.startsOn, f.endsOn) || 1 })
                  setDirty(false)
                }}>
          Save
        </button>
      </div>
    </div>
  )
}

function MyProfile({ me, onSave }: any) {
  const [name, setName] = useState(me.name || '')
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const ref = useRef(null)
  const preview = file ? URL.createObjectURL(file) : me.avatar

  const save = async () => {
    setBusy(true)
    try { await onSave({ name: name.trim() || me.name, file }) ; setFile(null) }
    finally { setBusy(false) }
  }
  const changed = name.trim() !== (me.name || '') || !!file

  return (
    <div className="mine">
      <button className="av" onClick={() => ref.current?.click()} title="Change your picture">
        {preview ? <img src={preview} alt="" /> : <span className="ini">{(name || '?')[0]}</span>}
        <em><Icon n="camera" s={12} /></em>
      </button>
      <input ref={ref} type="file" accept="image/*" hidden
             onChange={e => e.target.files?.[0] && setFile(e.target.files[0])} />
      <input value={name} placeholder="Your name" onChange={e => setName(e.target.value)} />
      <button className="btn" disabled={!changed || busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
    </div>
  )
}

/* =========================================================================
   Phones — live position and automatic photos

   A phone is registered here and gets a token, shown once. The native app
   stores that device-scoped token and posts location fixes itself; the web app
   keeps external tracker/uploader instructions for phones without the app.
   ========================================================================= */
function Phones({ tripId, family, canEdit, me, toast, phones, onChange }: any) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [card, setCard] = useState(null)        // the token, on screen exactly once
  const [tracking, setTracking] = useState(() => mobileTracker.getState())
  const suggested = `${me?.name || 'My'}'s phone`

  useEffect(() => mobileTracker.subscribe(setTracking), [])

  const enableTracking = async phone => {
    try {
      await mobileTracker.configure({
        endpoint: `${functionsUrl}/track`, token: phone.token,
        deviceId: phone.id, name: phone.name,
      })
      toast('Location sharing is on')
    } catch (e) {
      toast(e.message || 'Allow Always location access to start sharing')
      throw e
    }
  }

  const add = async e => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      const made = await registerDevice(tripId, name.trim() || suggested)
      setCard(made); setName('')
      onChange?.(await listDevices(tripId))
      if (isNativeApp) await enableTracking(made).catch(() => {})
    } catch (e2) { toast(e2.message || 'Could not add that phone') }
    finally { setBusy(false) }
  }

  const remove = async id => {
    try {
      await removeDevice(tripId, id)
      if (tracking.deviceId === id) await mobileTracker.forget()
      onChange?.(phones.filter(p => p.id !== id))
      if (card?.id === id) setCard(null)
    } catch (e2) { toast(e2.message || 'Could not remove that phone') }
  }

  if (!hasBackend) return <p>Phones report to the database, and this is the sample trip.</p>

  return (
    <>
      {isNativeApp && (
        <div className={`tracking ${tracking.status}`}>
          <span className="trackdot" />
          <div><b>{tracking.status === 'tracking' ? 'Location sharing is on'
                  : tracking.status === 'waiting' ? 'Waiting to send location'
                  : tracking.status === 'starting' ? 'Starting location sharing…'
                  : tracking.configured ? 'Location sharing is off' : 'Set up this iPhone below'}</b>
            <span>{tracking.error || (tracking.queued ? `${tracking.queued} fix${tracking.queued === 1 ? '' : 'es'} queued for retry`
              : 'Wayfare sends a fix after you move about 10 metres, including while the screen is locked.')}</span></div>
          {tracking.configured && ['tracking', 'waiting', 'starting'].includes(tracking.status)
            ? <button className="btn" disabled={tracking.status === 'starting'} onClick={() => mobileTracker.stop()}>Pause</button>
            : tracking.configured && <button className="btn" onClick={() => mobileTracker.stop().then(() => mobileTracker.start()).catch(e => toast(e.message))}>Resume</button>}
        </div>
      )}
      {phones.length ? (
        <div className="roster">
          {phones.map(p => {
            const who = family.find(f => f.id === p.userId)
            return (
              <div className="rperson" key={p.id}>
                {who?.avatar ? <img src={who.avatar} alt="" /> : <span className="ini">{(p.name || '?')[0]}</span>}
                <div><b>{p.name}</b>
                  <span>{p.lastSeen ? `Last fix ${agoLabel(p.lastSeen)}` : 'No fixes yet'}{who ? ` · ${who.name}` : ''}</span></div>
                {canEdit && <button className="rm" onClick={() => remove(p.id)} title="Remove this phone">
                  <Icon n="x" s={13} w={2} /></button>}
              </div>
            )
          })}
        </div>
      ) : (
        <p>No phones yet.{canEdit ? ' Add one and it reports where it is and hands over every picture it takes, with nobody opening the app.' : ''}</p>
      )}

      {canEdit && (
        <>
          <form onSubmit={add} className="linkrow">
            <input placeholder={suggested} value={name} onChange={e => setName(e.target.value)} />
            <button className="btn pri" type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add a phone'}</button>
          </form>
        </>
      )}

      {card && <SetupCard card={card} onClose={() => setCard(null)} toast={toast}
                          tracking={tracking} onEnableTracking={enableTracking} />}
    </>
  )
}

function SetupCard({ card, onClose, toast, tracking, onEnableTracking }: any) {
  const copy = (label, v) => navigator.clipboard?.writeText(v)
    .then(() => toast(`${label} copied`)).catch(() => toast('Copy failed'))
  const trackUrl = `${functionsUrl}/track`
  const Row = ({ k, v }) => (
    <div className="kv">
      <span>{k}</span>
      <code onClick={() => copy(k, v)} title="Click to copy">{v}</code>
      <button className="btn sq" title={`Copy ${k}`} onClick={() => copy(k, v)}><Icon n="copy" s={14} /></button>
    </div>
  )
  return (
    <div className="setup">
      <b>{card.name} — set-up card</b>
      <p>The token below is shown once and never again. If it is lost, remove the phone and add it back.</p>

      {isNativeApp ? <>
        <em>Location sharing</em>
        {mobilePlatform === 'android' ?
          <p className="fine">Wayfare tracks this Android phone itself. Allow <b>precise location</b> and
            <b> notifications</b> so sharing continues while the screen is locked. Android keeps a Wayfare
            notification visible whenever background tracking is active.</p> :
          <p className="fine">Wayfare tracks this iPhone itself. Choose <b>Allow While Using App</b>, then
            approve <b>Always Allow</b> when iOS asks so fixes continue while the screen is locked. A blue
            location indicator may appear while tracking.</p>}
        <button className="btn pri" disabled={tracking?.status === 'starting'}
                onClick={() => onEnableTracking(card).catch(() => {})}>
          {tracking?.deviceId === card.id && tracking.status === 'tracking' ? 'Tracking is on' : 'Enable location sharing'}
        </button>
        <em>Photos</em>
        {mobilePlatform === 'android' ?
          <p className="fine">Take pictures normally with the phone camera. In Wayfare, press the camera
            button, select up to 20 pictures from the system photo picker, and upload them together. The
            originals remain in the phone&apos;s photo library.</p> :
          <p className="fine">Take pictures normally in Apple Camera. In Wayfare, press the camera button,
            choose <b>Apple Photos</b>, select up to 20 pictures, and upload them together. iPhone converts
            HEIC selections to browser-ready JPEG automatically.</p>}
      </> : <>

      <em>1 · Where it is — Traccar Client (free, Play Store)</em>
      <Row k="Device identifier" v={card.token} />
      <Row k="Server URL" v={trackUrl} />
      <p className="fine">Frequency 30 s, accuracy high, then start the service. Let it ignore battery
         optimisation when Android asks. OwnTracks or GPSLogger work too: post to
         <code>{trackUrl}?id=</code>token.</p>

      <em>2 · Its pictures</em>
      <p className="fine">Open Wayfare on the phone and use the camera button to select pictures.
         Wayfare uploads private, web-sized copies directly to your VPS; the originals stay in the
         phone's photo library and iCloud.</p>
      </>}

      <button className="btn" onClick={onClose}>Done</button>
    </div>
  )
}

function PeopleModal({ onClose, toast, tripId, family, canEdit, appLink, trip, onSaveTrip, me, onSaveMe,
                       phones = [], onPhonesChange, viewers = [] }: any) {
  const [invites, setInvites] = useState([])
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState('viewer')
  const [busy, setBusy] = useState(false)
  const canManage = me?.memberRole === 'owner'
  const viewingIds = new Set(viewers.map(person => person.id))

  useEffect(() => {
    if (!canManage) return
    listInvites(tripId).then(setInvites).catch(() => {})
  }, [tripId, canManage])

  const pending = invites.filter(i => !i.claimedAt && !i.claimed_at)

  const add = async e => {
    e.preventDefault()
    if (!email.trim() || busy) return
    setBusy(true)
    try {
      const row = await invitePerson(tripId, { email, name, role })
      setInvites(list => [...list.filter(i => i.id !== row.id), row])
      setEmail(''); setName('')
      // The invitation stands either way; say plainly which happened, because
      // "Invited" over a mail that never went is how somebody ends up waiting.
      toast(row.mailed
        ? `Invited ${row.email} — sign-in link sent`
        : `${row.email} can join, but the email did not send: ${row.mailError || 'unknown error'}`)
    } catch (e2) {
      toast(e2.message || 'Could not send that invite')
    } finally { setBusy(false) }
  }

  const revoke = async id => {
    try {
      await revokeInvite(tripId, id)
      setInvites(list => list.filter(i => i.id !== id))
    } catch (e2) { toast(e2.message || 'Could not remove that invite') }
  }

  const removePerson = async person => {
    if (!window.confirm(`Remove ${person.name} from this trip? Their registered phones will stop reporting.`)) return
    try {
      await removeMember(tripId, person.id)
      toast(`${person.name} removed from the trip`)
      window.location.reload()
    } catch (error) { toast(error.message || 'Could not remove that person') }
  }

  const removeMyAccount = async () => {
    const confirmation = window.prompt('This permanently deletes your account, your uploads, and any trip you solely own. Type DELETE to continue.')
    if (confirmation !== 'DELETE') return
    try { await deleteAccount(); window.location.reload() }
    catch (error) { toast(error.message || 'Could not delete your account') }
  }

  return (
    <Modal title="Who is on this trip" onClose={onClose}>
      <div className="mb">
        <div className="sect">You</div>
        <MyProfile me={me} onSave={onSaveMe} />

        {canEdit && trip && (
          <>
            <div className="sect">Trip</div>
            <TripSettings trip={trip} onSave={onSaveTrip} />
          </>
        )}

        <div className="sect">Phones</div>
        <Phones tripId={tripId} family={family} canEdit={canEdit} me={me} toast={toast}
                phones={phones} onChange={onPhonesChange} />

        <div className="sect">Everyone</div>
        <div className="roster">
          {family.map(f => (
            <div className="rperson" key={f.id}>
              {f.avatar ? <img src={f.avatar} alt="" /> : <span className="ini">{(f.name || '?')[0]}</span>}
              <div><b>{f.name}</b><span>{f.role}
                {viewingIds.has(f.id) && <i className="viewing-now"> · Viewing now</i>}
              </span></div>
              <em>{f.memberRole === 'owner' ? 'Owner' : f.memberRole === 'editor' ? 'Editor' : 'Viewer'}</em>
              {canManage && f.id !== me.id && (
                <button className="wbtn sm" onClick={() => removePerson(f)}>Remove</button>
              )}
            </div>
          ))}
          {pending.map(i => (
            <div className="rperson pend" key={i.id}>
              <span className="ini">{(i.name || i.email || '?')[0]}</span>
              <div><b>{i.name || i.email}</b><span>Invited — not signed in yet</span></div>
              {canManage && <button className="rm" onClick={() => revoke(i.id)} title="Cancel invite">
                <Icon n="x" s={13} w={2} /></button>}
            </div>
          ))}
        </div>

        <a className="btn" href={`mailto:safety@threadway.ai?subject=${encodeURIComponent('Wayfare safety concern')}&body=${encodeURIComponent(`Trip: ${trip?.title || tripId}\nPlease describe the member or content and what happened:\n`)}`}>
          Report a safety concern
        </a>

        {canManage ? (
          <>
            <p>Everyone signs in, including people just following along. Invite them by the
               email address they will use — that is what grants access.</p>
            <form onSubmit={add} className="invite">
              <div className="linkrow">
                <input placeholder="Name" value={name} onChange={e => setName(e.target.value)} />
                <select value={role} onChange={e => setRole(e.target.value)}>
                  <option value="viewer">Can view</option>
                  <option value="editor">Can edit</option>
                </select>
              </div>
              <div className="linkrow">
                <input type="email" required placeholder="them@example.com" value={email}
                       onChange={e => setEmail(e.target.value)} />
                <button className="btn pri" type="submit" disabled={busy || !email.trim()}>
                  {busy ? 'Inviting…' : 'Invite'}
                </button>
              </div>
            </form>
            <div className="linkrow">
              <input readOnly value={appLink} onFocus={e => e.target.select()} />
              <button className="btn" onClick={() => {
                navigator.clipboard?.writeText(appLink)
                  .then(() => toast('Link copied')).catch(() => toast('Copy failed'))
              }}><Icon n="copy" s={15} />Copy</button>
            </div>
            <p className="fine">The link is only where the trip lives — it grants nothing on
               its own. Access comes from the invitation.</p>
          </>
        ) : (
          <p>Only the people running this trip can invite others.</p>
        )}

        {hasBackend && <>
          <div className="sect">Account</div>
          <p className="fine">Deleting your account removes your profile, comments, likes, phones,
            GPS history, and uploaded photos. A trip disappears too if you are its only owner.</p>
          <button className="btn danger" onClick={removeMyAccount}>Delete my account</button>
        </>}
      </div>
    </Modal>
  )
}

export default PeopleModal


