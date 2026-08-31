import type { Person } from '../../../shared/model/types'
import { appErrorMessage } from '../../../user-messages-core'

interface UserProfileProps {
  profile: Person
}

function UserProfile({ profile }: UserProfileProps) {
  return (
    <main className="tripLanding">
      <div className="tripLandingIn userProfilePage">
        <header className="landingHead">
          <a className="mk brand" href="/" aria-label="All trips"><img src="/wayfare-icon.png" alt="" /></a>
          <div><span className="eyebrow">OFF WE GO</span><h1>{profile.name}</h1>
            <p>@{profile.handle}</p>
          </div>
        </header>
        <section className="landingPanel userProfileCard">
          {profile.avatar
            ? <img className="userProfileAvatar" src={profile.avatar} alt="" />
            : <span className="userProfileAvatar ini">{(profile.name || '?')[0]}</span>}
          <p>You can see this profile because you share a trip.</p>
          <a className="btn" href="/">Back to your trips</a>
        </section>
      </div>
    </main>
  )
}

interface UserProfileUnavailableProps {
  error: Error & { status?: number }
  onRetry: () => void
}

export function UserProfileUnavailable({ error, onRetry }: UserProfileUnavailableProps) {
  const missing = error.status === 404
  return (
    <main className="tripLanding">
      <div className="tripLandingIn userProfilePage">
        <header className="landingHead">
          <a className="mk brand" href="/" aria-label="All trips"><img src="/wayfare-icon.png" alt="" /></a>
          <div><span className="eyebrow">OFF WE GO</span>
            <h1>{missing ? 'Profile unavailable' : 'Profile could not load'}</h1>
          </div>
        </header>
        <section className="landingPanel userProfileCard">
          <p>{missing
            ? 'This profile does not exist, or you do not share a trip with this person.'
            : appErrorMessage(error, 'load-profile')}</p>
          {!missing && <button className="btn" onClick={onRetry}>Try again</button>}
          <a className="btn" href="/">Back to your trips</a>
        </section>
      </div>
    </main>
  )
}

export default UserProfile
