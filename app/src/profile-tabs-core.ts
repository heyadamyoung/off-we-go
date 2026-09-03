/* Which part of your profile you are looking at, kept in the address so it can
   be linked to and come back on a Back. The same shape as the trip's settings
   tabs, because they are the same idea and should not need learning twice. */

export const PROFILE_TABS = ['profile', 'signin', 'alerts', 'connections', 'trips', 'data'] as const

export type ProfileTab = (typeof PROFILE_TABS)[number]

export const PROFILE_TAB_LABELS: Array<[ProfileTab, string]> = [
  ['profile', 'Profile'],
  // Not "Account": the menu in the corner is already called that, and two
  // controls of the same name on one screen is a coin toss for anyone
  // reading it aloud.
  ['signin', 'Sign-in'],
  ['alerts', 'Alerts'],
  ['connections', 'Connections'],
  ['trips', 'Trips'],
  ['data', 'Your data'],
]

export const DEFAULT_PROFILE_TAB: ProfileTab = 'profile'

/** Anything that is not a tab is the first one, rather than an empty page. */
export function parseProfileSearch(input: Record<string, unknown>): { tab?: ProfileTab } {
  const value = typeof input?.tab === 'string' ? input.tab.toLowerCase() : ''
  const tab = (PROFILE_TABS as readonly string[]).includes(value) ? (value as ProfileTab) : null
  return tab && tab !== DEFAULT_PROFILE_TAB ? { tab } : {}
}
