import { useRef, useState } from 'react'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { deleteAccount, loadAccountArchive } from '../../../backend'
import { appErrorMessage } from '../../../user-messages-core'
import Boot from '../../../shared/ui/boot'
import AccountMenu from '../../../shared/ui/account-menu'
import { Wordmark } from '../../../shared/ui/brand'
import { useToast } from '../../../shared/ui/toast'
import useProfile from '../model/use-profile'
import { SheetTab } from '../../../shared/ui/sheet'
import {
  AccountSection,
  AlertsSection,
  ConnectionsSection,
  DataSection,
  ProfileSection,
  TripsSection,
} from './profile-sections'
import { DEFAULT_PROFILE_TAB, PROFILE_TAB_LABELS } from '../../../profile-tabs-core'
import { useTripList } from '../model/use-trip-list'

export default function ProfilePage() {
  const notify = useToast()
  const {
    profile,
    preferences,
    loading,
    error,
    saving,
    reload,
    save,
    savePreferences,
    saveAvatar,
  } = useProfile()
  const { trips } = useTripList()
  const picker = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<Record<string, string> | null>(null)
  const navigate = useNavigate({ from: '/profile' })
  const tab = useSearch({ from: '/profile' }).tab || DEFAULT_PROFILE_TAB

  if (error)
    return <Boot what="Your profile" error={error} action="load-profile" onRetry={reload} />
  if (loading || !profile) return <Boot what="your profile" />

  const field = (key: string, fallback = '') =>
    draft?.[key] ?? String((profile as unknown as Record<string, unknown>)[key] ?? fallback)
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
    } catch (caught) {
      notify(appErrorMessage(caught, 'load-trip'), 'error')
    }
  }

  const removeAccount = async () => {
    if (
      window.prompt('Permanently delete this Off We Go account? Type DELETE to continue.') !==
      'DELETE'
    )
      return
    try {
      await deleteAccount()
      window.location.assign('/')
    } catch (caught) {
      notify(appErrorMessage(caught, 'delete-account'), 'error')
    }
  }

  const name = profile.name || 'You'
  const joined = profile.joinedAt ? new Date(profile.joinedAt).getFullYear() : null

  const sections = {
    profile,
    trips,
    preferences,
    savePreferences,
    field,
    set,
    saveDetails,
    saving,
    draft,
    download,
    removeAccount,
    toast: notify,
  }

  return (
    <main
      className="min-h-full overflow-y-auto bg-canvas text-ink
                     [background:radial-gradient(900px_500px_at_85%_0%,var(--c-accent-soft),transparent_60%),var(--c-bg)]">
      <div
        className="mx-auto flex max-w-[1040px] flex-col gap-5 px-7
                      pb-[calc(5rem+env(safe-area-inset-bottom,0px))]
                      pt-[calc(2.5rem+env(safe-area-inset-top,0px))]">
        <div className="relative z-30 flex items-center justify-between">
          <Link to="/">
            <Wordmark />
          </Link>
          <AccountMenu me={profile} />
        </div>

        <header className="surface flex items-center gap-5 p-[22px] max-sm:gap-4 max-sm:p-4">
          <button
            className="relative size-[76px] flex-none overflow-hidden rounded-full bg-[#5B8DEF]
                             text-[30px] font-extrabold text-[#10141C] max-sm:size-[60px]
                             max-sm:text-2xl"
            onClick={() => picker.current?.click()}
            title="Change your picture">
            {profile.avatar ? (
              <img src={profile.avatar} alt="" className="size-full object-cover" />
            ) : (
              <span className="grid size-full place-items-center">
                {name.slice(0, 1).toUpperCase()}
              </span>
            )}
          </button>
          <input
            ref={picker}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={event => {
              const file = event.target.files?.[0]
              if (file) saveAvatar(file)
              event.target.value = ''
            }}
          />
          {/* min-w-0: a flex child will not shrink below its content by default,
              so a long name pushed itself out through the side of the card
              rather than ending in an ellipsis. */}
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h1
              className="m-0 truncate text-[34px] font-extrabold tracking-[-.02em]
                           max-sm:text-xl">
              {name}
            </h1>
            <div className="truncate text-xs text-muted">
              {[
                profile.handle ? `@${profile.handle}` : null,
                profile.homePlace,
                joined ? `joined ${joined}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
            <div className="mt-1.5 flex gap-4 text-xs text-muted">
              <span>
                <b className="tnum mr-1 text-base text-ink">{profile.tripCount ?? trips.length}</b>
                trip{(profile.tripCount ?? trips.length) === 1 ? '' : 's'}
              </span>
              <span>
                <b className="tnum mr-1 text-base text-ink">{profile.photoCount ?? 0}</b>photos
              </span>
            </div>
          </div>
        </header>

        {/* The same row of tabs as the trip's settings, because it is the same
            idea: one thing at a time rather than a wall of everything. */}
        <div
          className="flex gap-0.5 overflow-x-auto overflow-y-hidden border-b border-line
                        [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {PROFILE_TAB_LABELS.map(([key, label]) => (
            <SheetTab
              key={key}
              on={tab === key}
              onClick={() => navigate({ search: key === DEFAULT_PROFILE_TAB ? {} : { tab: key } })}>
              {label}
            </SheetTab>
          ))}
        </div>

        <div className="flex flex-col gap-4">
          {tab === 'profile' && <ProfileSection {...sections} />}
          {tab === 'signin' && <AccountSection {...sections} />}
          {tab === 'alerts' && <AlertsSection {...sections} />}
          {tab === 'connections' && <ConnectionsSection {...sections} />}
          {tab === 'trips' && <TripsSection {...sections} />}
          {tab === 'data' && <DataSection {...sections} />}
        </div>
      </div>
    </main>
  )
}
