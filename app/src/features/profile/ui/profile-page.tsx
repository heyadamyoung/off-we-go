import { useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { deleteAccount, hasBackend, loadAccountArchive, signOut } from '../../../backend'
import { formatRange } from '../../../shared/lib/trip-dates'
import { appErrorMessage } from '../../../user-messages-core'
import Boot from '../../../shared/ui/boot'
import AccountMenu from '../../../shared/ui/account-menu'
import { Wordmark } from '../../../shared/ui/brand'
import Icon from '../../../shared/ui/icon'
import { useToast } from '../../../shared/ui/toast'
import useProfile from '../model/use-profile'
import { Card, NotificationsCard, PrivacyCard, Row } from './profile-cards'
import { useTripList } from '../model/use-trip-list'

const TIME_ZONES = ['America/Regina', 'America/Toronto', 'America/Vancouver', 'Europe/London',
  'Europe/Amsterdam', 'Europe/Paris', 'Australia/Sydney', 'UTC']

export default function ProfilePage() {
  const notify = useToast()
  const { profile, preferences, loading, error, saving, reload, save, savePreferences, saveAvatar } = useProfile()
  const { trips } = useTripList()
  const picker = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<Record<string, string> | null>(null)

  if (error) return <Boot what="Your profile" error={error} action="load-profile" onRetry={reload} />
  if (loading || !profile) return <Boot what="your profile" />

  const field = (key: string, fallback = '') => draft?.[key] ?? String(profile[key] ?? fallback)
  const set = (key: string, value: string) => setDraft(current => ({ ...current, [key]: value }))
  const saveDetails = () => {
    if (!draft) return
    const changes: Record<string, unknown> = {}
    if (draft.name !== undefined) changes.name = draft.name
    if (draft.handle !== undefined) changes.handle = draft.handle
    if (draft.homePlace !== undefined) changes.homePlace = draft.homePlace
    if (draft.timeZone !== undefined) changes.timeZone = draft.timeZone
    save(changes).then(() => setDraft(null))
  }

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
    } catch (caught) { notify(appErrorMessage(caught, 'load-trip'), 'error') }
  }

  const removeAccount = async () => {
    if (window.prompt('Permanently delete this Off We Go account? Type DELETE to continue.') !== 'DELETE') return
    try { await deleteAccount(); window.location.assign('/') }
    catch (caught) { notify(appErrorMessage(caught, 'delete-account'), 'error') }
  }

  const name = profile.name || 'You'
  const joined = profile.joinedAt ? new Date(profile.joinedAt).getFullYear() : null

  return (
    <main className="min-h-full overflow-y-auto bg-canvas text-ink
                     [background:radial-gradient(900px_500px_at_85%_0%,var(--c-accent-soft),transparent_60%),var(--c-bg)]">
      <div className="mx-auto flex max-w-[1040px] flex-col gap-5 px-7
                      pb-[calc(5rem+env(safe-area-inset-bottom,0px))]
                      pt-[calc(2.5rem+env(safe-area-inset-top,0px))]">
        <div className="relative z-30 flex items-center justify-between">
          <Link to="/"><Wordmark /></Link>
          <AccountMenu me={profile} />
        </div>

        <header className="surface flex items-center gap-5 p-[22px]">
          <button className="relative size-[76px] flex-none overflow-hidden rounded-full bg-[#5B8DEF]
                             text-[30px] font-extrabold text-[#10141C]"
                  onClick={() => picker.current?.click()} title="Change your picture">
            {profile.avatar
              ? <img src={profile.avatar} alt="" className="size-full object-cover" />
              : <span className="grid size-full place-items-center">{name.slice(0, 1).toUpperCase()}</span>}
          </button>
          <input ref={picker} type="file" accept="image/*" className="hidden"
                 onChange={event => {
                   const file = event.target.files?.[0]
                   if (file) saveAvatar(file)
                   event.target.value = ''
                 }} />
          <div className="flex flex-1 flex-col gap-1">
            <h1 className="m-0 text-[28px] font-extrabold tracking-[-.02em]">{name}</h1>
            <div className="text-[13px] text-muted">
              {[profile.handle ? `@${profile.handle}` : null, profile.homePlace,
                joined ? `joined ${joined}` : null].filter(Boolean).join(' · ')}
            </div>
            <div className="mt-1.5 flex gap-4 text-[12.5px] text-muted">
              <span><b className="tnum mr-1 text-[15px] text-ink">{profile.tripCount ?? trips.length}</b>
                trip{(profile.tripCount ?? trips.length) === 1 ? '' : 's'}</span>
              <span><b className="tnum mr-1 text-[15px] text-ink">{profile.photoCount ?? 0}</b>photos</span>
            </div>
          </div>
        </header>

        <div className="grid gap-4 md:grid-cols-2">
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

          <NotificationsCard preferences={preferences} onChange={savePreferences} />
          <PrivacyCard preferences={preferences} onChange={savePreferences} />

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
        </div>
      </div>
    </main>
  )
}
