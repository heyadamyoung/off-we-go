import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { loadUserProfile } from '../../../backend'
import { appErrorMessage } from '../../../user-messages-core'
import { Screen } from '../../../shared/ui/brand'
import Boot from '../../../shared/ui/boot'
import type { Person } from '../../../shared/model/types'

/* Somebody else's profile. Deliberately thin: you can see it because you share
   a trip, and it says only what that entitles you to. */
export default function UserProfilePage({ handle }: { handle: string }) {
  const [profile, setProfile] = useState<Person | null>(null)
  const [error, setError] = useState<(Error & { status?: number }) | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    setError(null)
    loadUserProfile(handle)
      .then(value => {
        if (alive) setProfile(value)
      })
      .catch((caught: unknown) => {
        if (alive) setError(caught instanceof Error ? caught : new Error(String(caught)))
      })
    return () => {
      alive = false
    }
  }, [handle, attempt])

  if (error) {
    const missing = error.status === 404
    return (
      <Screen>
        <h1 className="text-xl font-extrabold tracking-tight">
          {missing ? 'Profile unavailable' : 'Profile could not load'}
        </h1>
        <p className="hint max-w-[380px]">
          {missing
            ? 'This profile does not exist, or you do not share a trip with this person.'
            : appErrorMessage(error, 'load-profile')}
        </p>
        {!missing && (
          <button className="btn btn-ghost" onClick={() => setAttempt(value => value + 1)}>
            Try again
          </button>
        )}
        <Link className="btn btn-ghost" to="/">
          Back to your trips
        </Link>
      </Screen>
    )
  }
  if (!profile) return <Boot what="this profile" />

  return (
    <Screen>
      <span className="avatar size-20 border-0 bg-[#5B8DEF] text-3xl">
        {profile.avatar ? (
          <img src={profile.avatar} alt="" />
        ) : (
          (profile.name || '?')[0].toUpperCase()
        )}
      </span>
      <h1 className="break-words text-2xl font-extrabold tracking-tight">{profile.name}</h1>
      <p className="hint">@{profile.handle}</p>
      <p className="hint max-w-[380px]">You can see this profile because you share a trip.</p>
      <Link className="btn btn-ghost mt-1" to="/">
        Back to your trips
      </Link>
    </Screen>
  )
}
