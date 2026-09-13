/* Which build is this one?

   A question that came up three times in one evening and was never
   answerable. The app's web assets are baked into the binary, so a fix
   deployed to the site is not a fix on a phone until a new build is
   installed — and "it is still broken" reads identically whether the fix is
   wrong or simply not there yet. Nobody could tell, so nobody could say.

   So the app states what it is, somewhere a person can read it out. The short
   sha is the commit the bundle was built from, which is also what the
   telemetry is tagged with, so a report and its events meet. Beside it, on a
   phone, the version and build number — the two things a TestFlight screen
   shows, which is what somebody comparing the two actually has in front of
   them. */

export interface AppBuild {
  version?: string | null
  build?: string | null
}

const SHORT = 7

/** The commit, short, or nothing if the build never carried one. */
export const shortSha = (sha?: string | null) =>
  /^[0-9a-f]{7,40}$/i.test(String(sha || '').trim())
    ? String(sha).trim().slice(0, SHORT).toLowerCase()
    : ''

/** One line, or an empty string when there is nothing true to say. */
export function buildLabel(sha?: string | null, app?: AppBuild | null): string {
  const commit = shortSha(sha)
  const version = String(app?.version || '').trim()
  const number = String(app?.build || '').trim()
  /* A version with no build number is still worth saying; a build number
     with no version is not, because on its own it names nothing. */
  const released = version ? (number ? `${version} (${number})` : version) : ''
  return [released, commit].filter(Boolean).join(' · ')
}
