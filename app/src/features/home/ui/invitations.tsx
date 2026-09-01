import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { acceptInvite } from '../../../backend'
import { appErrorMessage } from '../../../user-messages-core'
import Boot from '../../../shared/ui/boot'
import { useToast } from '../../../shared/ui/toast'
import useLanding from '../model/use-landing'
import { globeScene } from '../model/trip-globe'
import HomeShell, { Crumb, PageHeading } from './home-shell'
import type { Id } from '../../../shared/model/types'

export default function InvitationsPage() {
  const { invites, profile, loading, error, reload } = useLanding()
  const [busy, setBusy] = useState<Id | null>(null)
  const notify = useToast()
  const navigate = useNavigate()
  const scene = globeScene(null, profile)

  const accept = async (id: Id) => {
    if (busy) return
    setBusy(id)
    try {
      const accepted = await acceptInvite(id)
      notify(`You are on ${accepted.tripTitle}.`)
      navigate({ to: '/trips/$slug', params: { slug: accepted.tripSlug }, search: {} })
    } catch (caught) {
      notify(appErrorMessage(caught, 'accept-invite'), 'error')
      setBusy(null)
    }
  }

  if (error) return <Boot what="Your invitations" error={error} action="accept-invite" onRetry={reload} />

  return (
    <HomeShell me={profile} wide home={scene.home} places={scene.places}>
      <Crumb here="Invitations" />
      <PageHeading>Invitations</PageHeading>
      <section className="surface flex flex-col gap-2.5 p-[18px]">
        <h3 className="m-0 text-[15px] font-extrabold">Waiting for you</h3>
        {loading && <p className="hint">Loading…</p>}
        {!loading && !invites.length && (
          <div className="rounded-2xl border-[1.5px] border-dashed border-line2 p-6 text-center text-[13px] text-faint">
            Nothing waiting. When somebody invites you along, it shows up here.
          </div>
        )}
        {invites.map(invite => (
          <div key={invite.id}
               className="grid grid-cols-[auto_1fr_auto] items-center gap-4 rounded-2xl bg-raised2 p-4">
            <span className="avatar size-11 bg-[#C77DFF] text-base">
              {(invite.tripTitle || '?').slice(0, 1).toUpperCase()}
            </span>
            <div>
              <b className="block text-[15px]">
                You have been invited to{' '}
                <em className="not-italic text-accent">{invite.tripTitle}</em>
              </b>
              <span className="block text-[12.5px] text-muted">
                {invite.role === 'editor' ? 'As a traveller — you can add stops and photos'
                  : 'As a viewer — you see everything, live'}
              </span>
            </div>
            <div className="flex gap-2">
              <button className="btn btn-accent" disabled={!!busy} onClick={() => accept(invite.id)}>
                {busy === invite.id ? 'Joining…' : invite.role === 'editor' ? 'Join' : 'Follow'}
              </button>
            </div>
          </div>
        ))}
        <p className="hint">
          Accepting adds the trip to your list and turns on the notifications you chose in your
          profile. You can leave a trip any time from its people list.
        </p>
      </section>
    </HomeShell>
  )
}
