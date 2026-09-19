import { useState, type FormEvent } from 'react'
import {
  functionsUrl,
  hasBackend,
  listDevices,
  registerDevice,
  removeDevice,
} from '../../../backend'
import AdoptPhones from './adopt-phones'
import SetupCard from './setup-card'
import { isNativeApp, mobileTracker } from '../../../mobile'
import { agoLabel } from '../../../shared/lib/geo'
import { appErrorMessage } from '../../../user-messages-core'
import useTrackerState from '../model/use-tracker-state'
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

/* A phone is registered here and paired with six characters typed on it —
   in the Off We Go app, which keeps sharing while the screen is locked, or
   in a browser, which shares while the page is open. The phone in your hand
   can be the one, with a button. A phone without either can be pointed at
   the same endpoint by any tracker app. */
export default function PhonesTab({
  tripId,
  family,
  canEdit,
  me,
  toast,
  phones,
  onChange,
}: PhonesProps) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [card, setCard] = useState<Device | null>(null)
  const tracking = useTrackerState()
  const sayShareFailed = (error: unknown) =>
    toast(appErrorMessage(error, 'share-location'), 'error')
  const suggested = `${me?.name || 'My'}'s phone`

  const enableTracking = async (phone: Device) => {
    try {
      await mobileTracker.configure({
        endpoint: `${functionsUrl}/track`,
        token: phone.token ?? '',
        deviceId: phone.id,
        name: phone.name,
      })
      toast('Location sharing is on')
    } catch (error) {
      toast(appErrorMessage(error, 'share-location'), 'error')
      throw error
    }
  }

  const add = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      const made = await registerDevice(tripId, name.trim() || suggested)
      setCard(made)
      setName('')
      onChange(await listDevices(tripId))
      // A phone that exists but is not talking gets its own sentence now.
      if (isNativeApp) await enableTracking(made).catch(sayShareFailed)
      toast('Phone added')
    } catch (error) {
      toast(appErrorMessage(error, 'add-phone'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    try {
      await removeDevice(tripId, id)
      if (tracking.deviceId === id) await mobileTracker.forget()
      onChange(phones.filter(phone => phone.id !== id))
      if (card?.id === id) setCard(null)
      toast('Phone removed')
    } catch (error) {
      toast(appErrorMessage(error, 'remove-phone'), 'error')
    }
  }

  /* The honest answer to a lost code: the card, which asks for a new one and
     retires the old one as it opens. */
  const reissue = (phone: Device) => setCard(phone)

  if (!hasBackend) {
    return <p className="hint">Phones report to the database, and this is the sample trip.</p>
  }

  return (
    <>
      {canEdit && <AdoptPhones tripId={tripId} toast={toast} onChange={onChange} />}
      {(isNativeApp || tracking.configured) && (
        <div className="surface trackrow grid grid-cols-[auto_1fr_auto] items-center gap-2 p-3">
          <span
            className={
              'size-2.5 rounded-full ' +
              (tracking.status === 'tracking'
                ? 'bg-accent shadow-[0_0_0_4px_var(--c-accent-soft)]'
                : ['waiting', 'starting'].includes(tracking.status)
                  ? 'animate-pulse bg-faint shadow-[0_0_0_4px_var(--c-line)]'
                  : 'bg-faint')
            }
          />
          <div className="flex min-w-0 flex-col gap-0.5">
            <b className="text-xs">
              {tracking.status === 'tracking'
                ? 'Location sharing is on'
                : tracking.status === 'waiting'
                  ? 'Waiting to send location'
                  : tracking.status === 'starting'
                    ? 'Starting location sharing…'
                    : tracking.configured
                      ? 'Location sharing is off'
                      : 'Set up this phone below'}
            </b>
            <span className="text-[11px] leading-snug text-faint">
              {tracking.error
                ? appErrorMessage(new Error(tracking.error), 'share-location')
                : tracking.queued
                  ? `${tracking.queued} fix${tracking.queued === 1 ? '' : 'es'} queued for retry`
                  : isNativeApp
                    ? 'A fix is sent after about 10 metres of movement, including while the screen is locked.'
                    : 'A fix is sent after about 10 metres of movement, while this page is open.'}
            </span>
          </div>
          {tracking.configured && ['tracking', 'waiting', 'starting'].includes(tracking.status) ? (
            <button
              className="mini"
              disabled={tracking.status === 'starting'}
              onClick={() => mobileTracker.stop()}>
              Pause
            </button>
          ) : (
            tracking.configured && (
              <button
                className="mini"
                onClick={() =>
                  mobileTracker
                    .stop()
                    .then(() => mobileTracker.start())
                    .then(() => toast('Location sharing resumed'))
                    .catch(error => toast(appErrorMessage(error, 'share-location'), 'error'))
                }>
                Resume
              </button>
            )
          )}
        </div>
      )}

      {phones.length ? (
        phones.map(phone => {
          const who = family.find(person => person.id === phone.userId)
          return (
            <div
              key={phone.id}
              className="flex items-center gap-3 border-b border-line py-2.5 last:border-b-0">
              <span className="avatar plain size-8">
                {who?.avatar ? (
                  <img src={who.avatar} alt="" />
                ) : (
                  (phone.name || '?')[0].toUpperCase()
                )}
              </span>
              <div className="min-w-0 flex-1">
                <b className="block text-sm">{phone.name}</b>
                <span className="text-xs text-muted">
                  {phone.pausedAt
                    ? 'Sharing paused'
                    : phone.lastSeen
                      ? `Last fix ${agoLabel(phone.lastSeen)}`
                      : 'No fixes yet'}
                  {phone.pausedAt && phone.lastSeen
                    ? ` · last fix ${agoLabel(phone.lastSeen)}`
                    : ''}
                  {who ? ` · ${who.name}` : ''}
                </span>
              </div>
              {canEdit && (
                <button
                  className="mini"
                  title="Show a pairing code for this phone; the old code stops working"
                  onClick={() => reissue(phone)}>
                  Pair
                </button>
              )}
              {canEdit && (
                <button
                  className="rounded-lg px-2 py-1.5 text-xs font-bold text-faint hover:bg-raised2
                                 hover:text-danger"
                  onClick={() => remove(phone.id)}>
                  Remove
                </button>
              )}
            </div>
          )
        })
      ) : (
        <p className="hint">
          No phones yet.
          {canEdit ? ' Add one and the map moves with it, with nobody opening the app.' : ''}
        </p>
      )}

      {canEdit && (
        <form onSubmit={add} className="flex gap-2">
          <input
            className="min-w-0 flex-1 rounded-lg border border-line bg-raised px-3 py-2.5
                            text-xs outline-none"
            placeholder={suggested}
            value={name}
            onChange={event => setName(event.target.value)}
          />
          <button className="btn btn-accent flex-none" type="submit" disabled={busy}>
            {busy ? 'Adding…' : 'Add a phone'}
          </button>
        </form>
      )}

      {card && (
        <SetupCard
          tripId={tripId}
          card={card}
          toast={toast}
          tracking={tracking}
          onEnable={enableTracking}
          onClose={() => setCard(null)}
        />
      )}

      <p className="hint">
        A phone shares its position only while a trip is running, and only with the people on that
        trip. Positions delete themselves after 30 days — sooner if the trip is deleted.
      </p>
    </>
  )
}
