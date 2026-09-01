import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { createTrip, invitePerson, updateMe } from '../../../backend'
import { daysBetween, formatRange } from '../../../shared/lib/trip-dates'
import { appErrorMessage } from '../../../user-messages-core'
import Icon from '../../../shared/ui/icon'
import { useToast } from '../../../shared/ui/toast'
import useLanding from '../model/use-landing'
import HomeShell, { Crumb, PageHeading } from './home-shell'
import { globeScene } from '../model/trip-globe'

const STEPS = [[1, 'The trip'], [2, 'People'], [3, 'Your phone']] as const

interface Guest {
  email: string
  role: 'editor' | 'viewer'
}

export default function NewTripPage({ step }: { step: number }) {
  const navigate = useNavigate()
  const notify = useToast()
  const { profile } = useLanding()
  const [fields, setFields] = useState({ title: '', crew: '', startsOn: '', endsOn: '', home: '' })
  const [guests, setGuests] = useState<Guest[]>([])
  const [busy, setBusy] = useState(false)
  const span = daysBetween(fields.startsOn, fields.endsOn)
  const set = (key: string, value: string) => setFields(current => ({ ...current, [key]: value }))
  const go = (next: number) => navigate({ to: '/new', search: { step: next } })

  const create = async (thenLinkPhone: boolean) => {
    if (busy || !fields.title.trim()) return
    setBusy(true)
    try {
      const trip = await createTrip({
        title: fields.title.trim(), crew: fields.crew.trim(),
        startsOn: fields.startsOn || undefined, endsOn: fields.endsOn || undefined,
        dates: formatRange(fields.startsOn, fields.endsOn),
        dayCount: span || 1,
      })
      const failed: string[] = []
      for (const guest of guests) {
        try { await invitePerson(trip.id || '', { email: guest.email, role: guest.role }) }
        catch { failed.push(guest.email) }
      }
      if (fields.home.trim() && fields.home.trim() !== (profile?.homePlace || '')) {
        await updateMe({ homePlace: fields.home.trim() }).catch(() => {})
      }
      notify(failed.length
        ? `Trip created. These invitations did not send: ${failed.join(', ')}`
        : 'Trip created.', failed.length ? 'error' : 'success')
      navigate({
        to: '/trips/$slug', params: { slug: trip.slug || '' },
        search: thenLinkPhone ? { sheet: 'settings' as const, tab: 'phones' as const } : {},
      })
    } catch (error) {
      setBusy(false)
      notify(appErrorMessage(error, 'create-trip'), 'error')
    }
  }

  const scene = globeScene(null, profile)
  return (
    <HomeShell me={profile} wide waiting home={scene.home} places={scene.places}>
      <Crumb here="New trip" />
      <PageHeading>
        {step === 1 ? 'Where to?' : step === 2 ? "Who's coming?" : 'Almost there.'}
      </PageHeading>
      <div className="flex items-center gap-1.5">
        {STEPS.map(([number, label], index) => (
          <span key={number} className="flex items-center gap-1.5">
            {index > 0 && <b className="px-1 font-normal text-faint">—</b>}
            <span className={'flex items-center gap-2 rounded-full border px-2.5 py-1.5 pl-1.5 text-xs font-bold ' +
              (step === number ? 'border-line2 text-ink' : 'border-line text-faint')}>
              <i className={'grid size-5 place-items-center rounded-full text-[11px] not-italic ' +
                (step === number ? 'bg-accent text-accent-ink'
                  : step > number ? 'bg-accent-soft text-accent' : 'bg-raised2')}>
                {step > number ? '✓' : number}
              </i>
              {label}
            </span>
          </span>
        ))}
      </div>

      {step === 1 && (
        <>
          <section className="surface flex flex-col gap-3 p-[18px]">
            <h3 className="m-0 text-[15px] font-extrabold">The trip</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="field">Trip name
                <input autoFocus placeholder="Where are you off to?" value={fields.title}
                       onChange={event => set('title', event.target.value)} />
              </label>
              <label className="field">Who&apos;s going
                <input placeholder="e.g. Adam and Catherine" value={fields.crew}
                       onChange={event => set('crew', event.target.value)} />
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="field">Leaving
                <input type="date" value={fields.startsOn}
                       onChange={event => set('startsOn', event.target.value)} />
              </label>
              <label className="field">Coming home
                <input type="date" value={fields.endsOn} min={fields.startsOn || undefined}
                       onChange={event => set('endsOn', event.target.value)} />
              </label>
              <label className="field">Home base
                <input placeholder="Regina, Saskatchewan"
                       value={fields.home || profile?.homePlace || ''}
                       onChange={event => set('home', event.target.value)} />
              </label>
            </div>
            {span && <p className="hint">{formatRange(fields.startsOn, fields.endsOn)} · {span} days</p>}
            <p className="hint">
              Home base sets the &ldquo;left home&rdquo; and &ldquo;back home&rdquo; ends of the arc on your globe.
            </p>
          </section>
          <div className="flex items-center gap-2.5">
            <Link className="btn btn-ghost" to="/">Cancel</Link>
            <span className="flex-1" />
            <button className="btn btn-accent" disabled={!fields.title.trim()} onClick={() => go(2)}>
              Continue <Icon n="chevron" s={14} />
            </button>
          </div>
        </>
      )}

      {step === 2 && <People guests={guests} setGuests={setGuests} onBack={() => go(1)} onNext={() => go(3)} />}

      {step === 3 && (
        <>
          <section className="surface flex flex-col gap-3 p-[18px]">
            <h3 className="m-0 flex items-center justify-between text-[15px] font-extrabold">
              Link your phone <span className="text-xs font-semibold text-faint">So the map moves with you</span>
            </h3>
            <p className="hint">
              Once the trip exists you can pair a phone to it from its settings, and it reports its
              position only while the trip is running and only to the people on it. We will take you
              straight there.
            </p>
            <ul className="m-0 flex list-disc flex-col gap-1 pl-4 text-[12.5px] text-muted">
              <li>{fields.title.trim() || 'Your trip'}
                {span ? ` · ${formatRange(fields.startsOn, fields.endsOn)}` : ''}</li>
              <li>{guests.length
                ? `${guests.length} invitation${guests.length === 1 ? '' : 's'} to send`
                : 'Nobody invited yet — you can add people any time'}</li>
            </ul>
          </section>
          <div className="flex items-center gap-2.5">
            <button className="btn btn-ghost" onClick={() => go(2)}>Back</button>
            <span className="flex-1" />
            <button className="btn btn-ghost" disabled={busy} onClick={() => create(false)}>
              {busy ? 'Creating…' : 'Do this later'}
            </button>
            <button className="btn btn-accent" disabled={busy} onClick={() => create(true)}>
              {busy ? 'Creating…' : 'Create the trip'}
            </button>
          </div>
        </>
      )}
    </HomeShell>
  )
}

function People({ guests, setGuests, onBack, onNext }: {
  guests: Guest[]
  setGuests: (next: Guest[]) => void
  onBack: () => void
  onNext: () => void
}) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Guest['role']>('viewer')
  const add = () => {
    const value = email.trim().toLowerCase()
    if (!value.includes('@') || guests.some(guest => guest.email === value)) return
    setGuests([...guests, { email: value, role }])
    setEmail('')
  }
  const group = (which: Guest['role']) => guests.filter(guest => guest.role === which)

  const list = (which: Guest['role']) => (
    <div className="flex flex-wrap gap-1.5">
      {group(which).length
        ? group(which).map(guest => (
          <span key={guest.email}
                className="inline-flex items-center gap-2 rounded-full bg-raised2 py-1 pl-1 pr-2.5 text-[12.5px] font-semibold">
            <span className="avatar plain size-[22px] border-0 text-[10px]">
              {guest.email.slice(0, 1).toUpperCase()}
            </span>
            {guest.email}
            <button className="flex text-faint" aria-label={`Remove ${guest.email}`}
                    onClick={() => setGuests(guests.filter(value => value.email !== guest.email))}>
              <Icon n="x" s={12} />
            </button>
          </span>
        ))
        : <span className="hint">Nobody yet.</span>}
    </div>
  )

  return (
    <>
      <section className="surface flex flex-col gap-3 p-[18px]">
        <h3 className="m-0 flex items-center justify-between text-[15px] font-extrabold">
          Travelling <span className="text-xs font-semibold text-faint">Add photos and stops, share their position</span>
        </h3>
        {list('editor')}
      </section>
      <section className="surface flex flex-col gap-3 p-[18px]">
        <h3 className="m-0 flex items-center justify-between text-[15px] font-extrabold">
          Following from home
          <span className="text-xs font-semibold text-faint">See everything live; can like and comment</span>
        </h3>
        {list('viewer')}
        <div className="flex gap-2">
          <input className="flex-1 rounded-lg border border-line bg-raised px-3 py-2.5 text-[12.5px] outline-none"
                 placeholder="them@example.com" type="email" value={email}
                 onChange={event => setEmail(event.target.value)}
                 onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); add() } }} />
          <select className="rounded-lg border border-line bg-raised px-2.5 text-[12.5px]"
                  aria-label="Role" value={role}
                  onChange={event => setRole(event.target.value as Guest['role'])}>
            <option value="viewer">Can view</option>
            <option value="editor">Can edit</option>
          </select>
          <button className="btn btn-ghost" onClick={add}>Add</button>
        </div>
        <p className="hint">
          Everyone signs in, including people just following along. Nobody can see the trip from the
          link alone — access comes from the invitation, which is sent when the trip is created.
        </p>
      </section>
      <div className="flex items-center gap-2.5">
        <button className="btn btn-ghost" onClick={onBack}>Back</button>
        <span className="flex-1" />
        <button className="btn btn-accent" onClick={onNext}>Continue <Icon n="chevron" s={14} /></button>
      </div>
    </>
  )
}
