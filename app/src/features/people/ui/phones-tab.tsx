import { useEffect, useState } from 'react'
import {
  functionsUrl, hasBackend, listDevices, registerDevice, removeDevice,
} from '../../../backend'
import { isNativeApp, mobilePlatform, mobileTracker } from '../../../mobile'
import { agoLabel } from '../../../shared/lib/geo'
import Icon from '../../../shared/ui/icon'
import { appErrorMessage } from '../../../user-messages-core'
import type { Device, Person, Toast } from '../../../shared/model/types'

interface PhonesProps {
  tripId: string
  family: Person[]
  canEdit: boolean
  me: Person
  toast: Toast
  phones: Device[]
  onChange: (phones: Device[]) => void
}

/* A phone is registered here and gets a token, shown exactly once. The native
   app stores that device-scoped token and posts fixes itself; a phone without
   the app can be pointed at the same endpoint by any tracker. */
export default function PhonesTab({ tripId, family, canEdit, me, toast, phones, onChange }: PhonesProps) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [card, setCard] = useState<Device | null>(null)
  const [tracking, setTracking] = useState(() => mobileTracker.getState())
  const suggested = `${me?.name || 'My'}'s phone`

  useEffect(() => mobileTracker.subscribe(setTracking), [])

  const enableTracking = async (phone: Device) => {
    try {
      await mobileTracker.configure({
        endpoint: `${functionsUrl}/track`, token: phone.token,
        deviceId: phone.id, name: phone.name,
      })
      toast('Location sharing is on')
    } catch (error) {
      toast(appErrorMessage(error, 'share-location'), 'error')
      throw error
    }
  }

  const add = async (event) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      const made = await registerDevice(tripId, name.trim() || suggested)
      setCard(made); setName('')
      onChange(await listDevices(tripId))
      if (isNativeApp) await enableTracking(made).catch(() => {})
      toast('Phone added')
    } catch (error) { toast(appErrorMessage(error, 'add-phone'), 'error') }
    finally { setBusy(false) }
  }

  const remove = async (id: string) => {
    try {
      await removeDevice(tripId, id)
      if (tracking.deviceId === id) await mobileTracker.forget()
      onChange(phones.filter(phone => phone.id !== id))
      if (card?.id === id) setCard(null)
      toast('Phone removed')
    } catch (error) { toast(appErrorMessage(error, 'remove-phone'), 'error') }
  }

  if (!hasBackend) {
    return <p className="hint">Phones report to the database, and this is the sample trip.</p>
  }

  return (
    <>
      {isNativeApp && (
        <div className="surface grid grid-cols-[auto_1fr_auto] items-center gap-2.5 p-3">
          <span className={'size-2.5 rounded-full ' + (tracking.status === 'tracking'
            ? 'bg-trail shadow-[0_0_0_4px_var(--c-accent-soft)]'
            : ['waiting', 'starting'].includes(tracking.status)
              ? 'bg-accent shadow-[0_0_0_4px_var(--c-accent-soft)]' : 'bg-faint')} />
          <div className="flex min-w-0 flex-col gap-0.5">
            <b className="text-[13px]">
              {tracking.status === 'tracking' ? 'Location sharing is on'
                : tracking.status === 'waiting' ? 'Waiting to send location'
                  : tracking.status === 'starting' ? 'Starting location sharing…'
                    : tracking.configured ? 'Location sharing is off' : 'Set up this phone below'}
            </b>
            <span className="text-[11.5px] leading-snug text-faint">
              {tracking.error
                ? appErrorMessage(new Error(tracking.error), 'share-location')
                : tracking.queued
                  ? `${tracking.queued} fix${tracking.queued === 1 ? '' : 'es'} queued for retry`
                  : 'A fix is sent after about 10 metres of movement, including while the screen is locked.'}
            </span>
          </div>
          {tracking.configured && ['tracking', 'waiting', 'starting'].includes(tracking.status)
            ? <button className="mini" disabled={tracking.status === 'starting'}
                      onClick={() => mobileTracker.stop()}>Pause</button>
            : tracking.configured && (
              <button className="mini" onClick={() => mobileTracker.stop()
                .then(() => mobileTracker.start())
                .then(() => toast('Location sharing resumed'))
                .catch(error => toast(appErrorMessage(error, 'share-location'), 'error'))}>Resume</button>
            )}
        </div>
      )}

      {phones.length ? phones.map(phone => {
        const who = family.find(person => person.id === phone.userId)
        return (
          <div key={phone.id} className="flex items-center gap-3 border-b border-line py-2.5 last:border-b-0">
            <span className="avatar plain size-8">
              {who?.avatar ? <img src={who.avatar} alt="" /> : (phone.name || '?')[0].toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <b className="block text-[13.5px]">{phone.name}</b>
              <span className="text-xs text-muted">
                {phone.lastSeen ? `Last fix ${agoLabel(phone.lastSeen)}` : 'No fixes yet'}
                {who ? ` · ${who.name}` : ''}
              </span>
            </div>
            {canEdit && (
              <button className="rounded-lg px-2 py-1.5 text-xs font-bold text-faint hover:bg-raised2
                                 hover:text-danger" onClick={() => remove(phone.id)}>Remove</button>
            )}
          </div>
        )
      }) : (
        <p className="hint">
          No phones yet.{canEdit ? ' Add one and the map moves with it, with nobody opening the app.' : ''}
        </p>
      )}

      {canEdit && (
        <form onSubmit={add} className="flex gap-2">
          <input className="flex-1 rounded-lg border border-line bg-raised px-3 py-2.5 text-[12.5px] outline-none"
                 placeholder={suggested} value={name} onChange={event => setName(event.target.value)} />
          <button className="btn btn-accent" type="submit" disabled={busy}>
            {busy ? 'Adding…' : 'Add a phone'}
          </button>
        </form>
      )}

      {card && <SetupCard card={card} toast={toast} tracking={tracking}
                          onEnable={enableTracking} onClose={() => setCard(null)} />}

      <p className="hint">
        A phone shares its position only while a trip is running, and only with the people on that
        trip. Positions are kept for the trip and deleted with it.
      </p>
    </>
  )
}

function SetupCard({ card, toast, tracking, onEnable, onClose }) {
  const copy = (label: string, value: string) => navigator.clipboard?.writeText(value)
    .then(() => toast(`${label} copied`))
    .catch(error => toast(appErrorMessage(error, 'copy'), 'error'))
  const trackUrl = `${functionsUrl}/track`

  const Row = ({ k, v }: { k: string; v: string }) => (
    <div className="grid grid-cols-[110px_1fr_auto] items-center gap-2">
      <span className="text-[11.5px] text-faint">{k}</span>
      <code className="min-w-0 cursor-copy break-all rounded-lg border border-line bg-raised px-2 py-1.5
                       font-mono text-[11.5px] leading-snug text-ink"
            onClick={() => copy(k, v)} title="Click to copy">{v}</code>
      <button className="grid size-9 place-items-center rounded-lg border border-line bg-raised"
              title={`Copy ${k}`} onClick={() => copy(k, v)}><Icon n="copy" s={14} /></button>
    </div>
  )

  return (
    <div className="surface flex flex-col gap-2.5 p-3.5">
      <b className="text-sm font-extrabold tracking-[-.01em]">{card.name} — set-up card</b>
      <p className="hint">
        The token below is shown once and never again. If it is lost, remove the phone and add it back.
      </p>
      {isNativeApp ? (
        <>
          <em className="text-[11px] font-extrabold uppercase not-italic tracking-[.06em] text-accent">
            Location sharing
          </em>
          <p className="hint">
            {mobilePlatform === 'android'
              ? 'Allow precise location and notifications so sharing continues while the screen is locked.'
              : 'Choose Allow While Using App, then approve Always Allow when iOS asks, so fixes continue while the screen is locked.'}
          </p>
          <div>
            <button className="btn btn-accent" disabled={tracking?.status === 'starting'}
                    onClick={() => onEnable(card).catch(() => {})}>
              {tracking?.deviceId === card.id && tracking.status === 'tracking'
                ? 'Tracking is on' : 'Enable location sharing'}
            </button>
          </div>
        </>
      ) : (
        <>
          <em className="text-[11px] font-extrabold uppercase not-italic tracking-[.06em] text-accent">
            Point a tracker at this trip
          </em>
          <Row k="Device identifier" v={card.token} />
          <Row k="Server URL" v={trackUrl} />
          <p className="hint">
            Traccar Client, OwnTracks and GPSLogger all work: post to{' '}
            <code className="break-all">{trackUrl}?id=</code>token,
            every 30 seconds, high accuracy.
          </p>
        </>
      )}
      <div><button className="mini" onClick={onClose}>Done</button></div>
    </div>
  )
}
