import { useEffect, useState, type FormEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { invitePerson, listInvites, removeMember, revokeInvite } from '../../../backend'
import { daysBetween, formatRange } from '../../../shared/lib/trip-dates'
import { appErrorMessage } from '../../../user-messages-core'
import Icon from '../../../shared/ui/icon'
import Sheet, { SheetTab } from '../../../shared/ui/sheet'
import PhonesTab from './phones-tab'
import type { SettingsTab } from '../../../trip-search-core'
import { OfflineMapCard } from '../../map'
import type { Coordinates, Device, Invite, Person, Toast, Trip } from '../../../shared/model/types'

interface SettingsProps {
  tab: SettingsTab
  onTab: (tab: SettingsTab) => void
  onClose: () => void
  tripId: string
  trip: Trip
  family: Person[]
  me: Person
  canEdit: boolean
  phones: Device[]
  onPhones: (phones: Device[]) => void
  onSaveTrip: (fields: Partial<Trip>) => void
  appLink: string
  toast: Toast
  /** The trip's stops, for working out which corner of the map to save. */
  mapPoints: Coordinates[]
}

const TABS: Array<[SettingsTab, string]> = [
  ['trip', 'Trip'],
  ['people', 'People'],
  ['phones', 'Location'],
]

export default function TripSettingsSheet(props: SettingsProps) {
  const form = useTripFields(props)
  return (
    <Sheet
      wide
      title="Trip settings"
      onClose={props.onClose}
      tabs={TABS.map(([key, label]) => (
        <SheetTab key={key} on={props.tab === key} onClick={() => props.onTab(key)}>
          {label}
        </SheetTab>
      ))}
      /* Saving and closing are both ways of finishing with this sheet, so
              they finish it from the same row rather than one being stranded
              at the end of the scrolling content above the other. */
      footer={
        <>
          <button className="btn btn-ghost" onClick={props.onClose}>
            Close
          </button>
          {props.tab === 'trip' && props.canEdit && (
            <button className="btn btn-accent" disabled={!form.dirty} onClick={form.save}>
              Save
            </button>
          )}
        </>
      }>
      {props.tab === 'trip' && (
        <>
          <TripTab {...props} form={form} />
          {/* Below the trip's own details, and offered to everyone on the trip:
              somebody following along abroad needs the map as much as the
              person who wrote the itinerary. */}
          <OfflineMapCard points={props.mapPoints} toast={props.toast} />
        </>
      )}
      {props.tab === 'people' && <PeopleTab {...props} />}
      {props.tab === 'phones' && (
        <PhonesTab
          tripId={props.tripId}
          family={props.family}
          canEdit={props.canEdit}
          me={props.me}
          toast={props.toast}
          phones={props.phones}
          onChange={props.onPhones}
        />
      )}
    </Sheet>
  )
}

/* The form's state lives out here because the button that commits it lives in
   the sheet's footer, beside the one that closes the sheet. */
function useTripFields({ trip, onSaveTrip }: SettingsProps) {
  const [fields, setFields] = useState({
    title: trip.title || '',
    crew: trip.crew || '',
    startsOn: trip.startsOn || '',
    endsOn: trip.endsOn || '',
  })
  const [dirty, setDirty] = useState(false)
  const set = (key: string, value: string) => {
    setFields(current => ({ ...current, [key]: value }))
    setDirty(true)
  }
  const save = () => {
    onSaveTrip({
      ...fields,
      dates: formatRange(fields.startsOn, fields.endsOn),
      dayCount: daysBetween(fields.startsOn, fields.endsOn) || 1,
    })
    setDirty(false)
  }
  return { fields, set, dirty, save }
}

type TripFields = ReturnType<typeof useTripFields>

function TripTab({ canEdit, form }: SettingsProps & { form: TripFields }) {
  const { fields, set } = form

  if (!canEdit) {
    return <p className="hint">Only the people running this trip can change its details.</p>
  }

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="field">
          Trip name
          <input value={fields.title} onChange={event => set('title', event.target.value)} />
        </label>
        <label className="field">
          Who&apos;s going
          <input
            value={fields.crew}
            placeholder="e.g. Adam and Catherine"
            onChange={event => set('crew', event.target.value)}
          />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="field">
          Leaving
          <input
            type="date"
            value={fields.startsOn}
            onChange={event => set('startsOn', event.target.value)}
          />
        </label>
        <label className="field">
          Coming home
          <input
            type="date"
            value={fields.endsOn}
            min={fields.startsOn || undefined}
            onChange={event => set('endsOn', event.target.value)}
          />
        </label>
      </div>
      <p className="hint">
        Stops and photos are shown in local time where they happened; followers at home see both.
      </p>
    </>
  )
}

function PeopleTab({ tripId, family, me, appLink, toast, trip }: SettingsProps) {
  const [invites, setInvites] = useState<Invite[]>([])
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState('viewer')
  const [busy, setBusy] = useState(false)
  const canManage = me?.memberRole === 'owner'

  useEffect(() => {
    if (!canManage) return
    listInvites(tripId)
      .then(setInvites)
      .catch(() => {})
  }, [tripId, canManage])

  const pending = invites.filter(invite => !invite.claimedAt && !invite.claimed_at)

  const add = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!email.trim() || busy) return
    setBusy(true)
    try {
      const row = await invitePerson(tripId, { email, name, role })
      setInvites(list => [...list.filter(item => item.id !== row.id), row])
      setEmail('')
      setName('')
      // The invitation stands either way; say plainly which happened, because
      // "Invited" over a mail that never went is how somebody ends up waiting.
      toast(
        row.mailed
          ? `Invited ${row.email} — invitation email sent`
          : `${row.email} can join, but the invitation email could not be sent.`,
        row.mailed ? 'success' : 'error',
      )
    } catch (error) {
      toast(appErrorMessage(error, 'send-invite'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (id = '') => {
    try {
      await revokeInvite(tripId, id)
      setInvites(list => list.filter(item => item.id !== id))
      toast('Invitation cancelled')
    } catch (error) {
      toast(appErrorMessage(error, 'remove-invite'), 'error')
    }
  }

  const remove = async (person: Person) => {
    if (
      !window.confirm(
        `Remove ${person.name} from this trip? Their registered phones will stop reporting.`,
      )
    )
      return
    try {
      await removeMember(tripId, person.id || '')
      toast(`${person.name} removed from the trip`)
      window.location.reload()
    } catch (error) {
      toast(appErrorMessage(error, 'remove-member'), 'error')
    }
  }

  return (
    <>
      <div>
        {family.map(person => (
          <div
            key={person.id}
            className="flex items-center gap-3 border-b border-line py-2.5 last:border-b-0">
            <span
              className={
                'avatar size-8 ' + (person.memberRole === 'viewer' ? 'plain' : 'bg-[#5B8DEF]')
              }>
              {person.avatar ? (
                <img src={person.avatar} alt="" />
              ) : (
                (person.name || '?')[0].toUpperCase()
              )}
            </span>
            <div className="min-w-0 flex-1">
              <b className="block text-sm">{person.name}</b>
              <span className="text-xs text-muted">
                {person.handle && (
                  <Link to="/users/$handle" params={{ handle: person.handle }}>
                    @{person.handle}
                  </Link>
                )}
                {person.handle ? ' · ' : ''}
                {person.memberRole === 'viewer' ? 'following' : 'travelling'}
              </span>
            </div>
            <span className="rounded-lg border border-line px-2 py-1.5 text-[11px] font-bold text-faint">
              {person.memberRole === 'owner'
                ? 'Owner'
                : person.memberRole === 'editor'
                  ? 'Editor'
                  : 'Viewer'}
            </span>
            {canManage && person.id !== me.id && (
              <button
                className="rounded-lg px-2 py-1.5 text-xs font-bold text-faint hover:bg-raised2
                                 hover:text-danger"
                onClick={() => remove(person)}>
                Remove
              </button>
            )}
          </div>
        ))}
        {pending.map(invite => (
          <div
            key={invite.id}
            className="flex items-center gap-3 border-b border-line py-2.5 opacity-70 last:border-b-0">
            <span className="avatar plain size-8">
              {(invite.name || invite.email || '?')[0].toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <b className="block text-sm">{invite.name || invite.email}</b>
              <span className="text-xs text-muted">Invited — not signed in yet</span>
            </div>
            {canManage && (
              <button
                className="grid size-7 place-items-center rounded-lg text-faint hover:text-danger"
                onClick={() => revoke(invite.id)}
                title="Cancel invitation">
                <Icon n="x" s={13} />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Trust is the product here; say it where the people are listed, for
          the follower reading over morning coffee as much as for the owner. */}
      <div className="surface flex flex-col gap-1.5 p-3.5">
        <b className="text-[11px] font-extrabold uppercase tracking-[.08em] text-accent">
          Who can see what
        </b>
        <p className="hint">
          Everyone listed here — travelling or following — sees the live position, the trail, the
          itinerary and the photos. Nobody else does; there are no public links.
        </p>
        <p className="hint">
          Positions come only from phones registered on the Phones tab, only while the trip is
          running. Anyone can pause their own phone, and a pause is shown as a pause — never
          disguised as a lost signal. GPS history deletes itself after 30 days, and a saved home on
          a profile keeps the trail away from that person&apos;s front door.
        </p>
      </div>

      {canManage ? (
        <>
          <p className="hint">
            Everyone signs in, including people just following along. Invite them by the email
            address they will use — that is what grants access.
          </p>
          <form onSubmit={add} className="flex flex-col gap-2">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="field">
                Name
                <input
                  placeholder="Name"
                  value={name}
                  onChange={event => setName(event.target.value)}
                />
              </label>
              <label className="field">
                Role
                <select value={role} onChange={event => setRole(event.target.value)}>
                  <option value="viewer">Can view</option>
                  <option value="editor">Can edit</option>
                </select>
              </label>
            </div>
            <div className="flex gap-2">
              <input
                className="min-w-0 flex-1 rounded-lg border border-line bg-raised px-3 py-2.5
                                text-xs outline-none"
                type="email"
                required
                placeholder="them@example.com"
                value={email}
                onChange={event => setEmail(event.target.value)}
              />
              <button
                className="btn btn-accent flex-none"
                type="submit"
                disabled={busy || !email.trim()}>
                {busy ? 'Inviting…' : 'Invite'}
              </button>
            </div>
          </form>
          <div className="flex gap-2">
            <input
              readOnly
              value={appLink}
              onFocus={event => event.target.select()}
              className="min-w-0 flex-1 rounded-lg border border-line bg-raised px-3 py-2.5
                              text-xs text-muted outline-none"
            />
            <button
              className="btn btn-ghost flex-none"
              onClick={() =>
                navigator.clipboard
                  ?.writeText(appLink)
                  .then(() => toast('Link copied'))
                  .catch(error => toast(appErrorMessage(error, 'copy'), 'error'))
              }>
              <Icon n="copy" s={14} />
              Copy
            </button>
          </div>
          <p className="hint">
            The link is only where the trip lives — it grants nothing on its own.{' '}
            <a
              href={
                `mailto:safety@threadway.ai?subject=${encodeURIComponent('Off We Go safety concern')}` +
                `&body=${encodeURIComponent(`Trip: ${trip?.title || tripId}\n`)}`
              }>
              Report a safety concern
            </a>
            .
          </p>
        </>
      ) : (
        <p className="hint">Only the people running this trip can invite others.</p>
      )}
    </>
  )
}
