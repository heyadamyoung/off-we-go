/* The notification and privacy choices on the settings page. Kept out of React
   so the defaults, the merge and the validation can be tested directly — and so
   a preference added later cannot quietly read as "off" for everybody who saved
   their settings before it existed. */

export type Channel = 'push' | 'email'

export interface NotificationChoice {
  on: boolean
  channels: Channel[]
}

export type Discoverability = 'anyone' | 'shared' | 'nobody'

export interface Preferences {
  notify: Record<NotificationKey, NotificationChoice>
  privacy: {
    discoverable: Discoverability
    showLivePosition: boolean
    keepTrail: boolean
    stripPhotoLocation: boolean
  }
}

export const NOTIFICATIONS = [
  {
    key: 'photos', label: 'New photos on trips I follow',
    detail: 'Batched, at most once an hour', channels: ['push', 'email'] as Channel[],
  },
  {
    key: 'arrivals', label: 'Travellers arrive somewhere new',
    detail: 'Landed, checked in, crossed a border', channels: ['push'] as Channel[],
  },
  {
    key: 'social', label: 'Comments and likes on my photos',
    detail: '', channels: ['push', 'email'] as Channel[],
  },
  {
    key: 'digest', label: 'Daily digest while a trip is live',
    detail: "Yesterday's route, photos and today's plan, every morning",
    channels: ['email'] as Channel[],
  },
  {
    key: 'product', label: 'Product news from Off We Go',
    detail: '', channels: ['email'] as Channel[],
  },
] as const

export type NotificationKey = (typeof NOTIFICATIONS)[number]['key']

export const DISCOVERABILITY: Array<{ value: Discoverability; label: string }> = [
  { value: 'anyone', label: 'Anyone with the handle' },
  { value: 'shared', label: "People I've travelled or followed with" },
  { value: 'nobody', label: 'Nobody — invitations only' },
]

export const DEFAULT_PREFERENCES: Preferences = {
  notify: {
    photos: { on: true, channels: ['push'] },
    arrivals: { on: true, channels: ['push'] },
    social: { on: true, channels: ['push'] },
    digest: { on: false, channels: ['email'] },
    product: { on: false, channels: ['email'] },
  },
  privacy: {
    discoverable: 'shared',
    showLivePosition: true,
    keepTrail: false,
    stripPhotoLocation: true,
  },
}

const KNOWN_CHANNELS = new Set<Channel>(['push', 'email'])

/* Anything stored that we do not recognise is dropped, and anything missing
   falls back to the default rather than to false. */
export function readPreferences(stored: unknown): Preferences {
  const source = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>
  const notifySource = (source.notify && typeof source.notify === 'object'
    ? source.notify : {}) as Record<string, { on?: unknown; channels?: unknown }>
  const privacySource = (source.privacy && typeof source.privacy === 'object'
    ? source.privacy : {}) as Record<string, unknown>

  const notify = {} as Record<NotificationKey, NotificationChoice>
  for (const item of NOTIFICATIONS) {
    const fallback = DEFAULT_PREFERENCES.notify[item.key]
    const saved = notifySource[item.key]
    const channels = Array.isArray(saved?.channels)
      ? (saved.channels as unknown[]).filter((value): value is Channel =>
          KNOWN_CHANNELS.has(value as Channel) && (item.channels as readonly Channel[]).includes(value as Channel))
      : fallback.channels
    notify[item.key] = {
      on: typeof saved?.on === 'boolean' ? saved.on : fallback.on,
      channels: channels.length ? channels : fallback.channels,
    }
  }

  const discoverable = DISCOVERABILITY.some(option => option.value === privacySource.discoverable)
    ? (privacySource.discoverable as Discoverability)
    : DEFAULT_PREFERENCES.privacy.discoverable
  const flag = (key: keyof Preferences['privacy']) =>
    typeof privacySource[key] === 'boolean'
      ? (privacySource[key] as boolean)
      : (DEFAULT_PREFERENCES.privacy[key] as boolean)

  return {
    notify,
    privacy: {
      discoverable,
      showLivePosition: flag('showLivePosition'),
      keepTrail: flag('keepTrail'),
      stripPhotoLocation: flag('stripPhotoLocation'),
    },
  }
}

export const toggleChannel = (choice: NotificationChoice, channel: Channel): NotificationChoice => {
  const channels = choice.channels.includes(channel)
    ? choice.channels.filter(value => value !== channel)
    : [...choice.channels, channel]
  // A notification with no channel left has nowhere to arrive: turn it off
  // rather than leaving it on and silent.
  return channels.length ? { ...choice, channels } : { on: false, channels: choice.channels }
}
