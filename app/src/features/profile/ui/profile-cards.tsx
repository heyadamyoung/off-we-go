import type { ReactNode } from 'react'
import {
  DISCOVERABILITY,
  NOTIFICATIONS,
  toggleChannel,
  type Channel,
  type Discoverability,
  type NotificationChoice,
  type NotificationKey,
  type Preferences,
} from '../../../preferences-core'

export function Card({
  title,
  aside,
  children,
  wide,
}: {
  title: string
  aside?: ReactNode
  children: ReactNode
  wide?: boolean
}) {
  return (
    <section className={'surface flex flex-col gap-3 p-[18px] ' + (wide ? 'md:col-span-2' : '')}>
      <h3 className="m-0 flex items-center justify-between text-[15px] font-extrabold tracking-[-.01em]">
        {title}
        {aside && <span className="text-xs font-semibold text-faint">{aside}</span>}
      </h3>
      {children}
    </section>
  )
}

/* A row of label, sub-label and one action — the shape most of this page is
   made of. */
export function Row({
  lead,
  title,
  detail,
  action,
}: {
  lead?: ReactNode
  title: ReactNode
  detail?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex items-center gap-3 border-b border-line py-2.5 text-[13px] last:border-b-0">
      {lead}
      <div className="min-w-0 flex-1">
        <b className="block">{title}</b>
        {detail && <span className="text-xs text-muted">{detail}</span>}
      </div>
      {action}
    </div>
  )
}

export function NotificationsCard({
  preferences,
  onChange,
}: {
  preferences: Preferences
  onChange: (next: Preferences) => void
}) {
  const set = (key: NotificationKey, value: NotificationChoice) =>
    onChange({ ...preferences, notify: { ...preferences.notify, [key]: value } })

  return (
    <Card title="Notifications">
      {NOTIFICATIONS.map(item => {
        const choice = preferences.notify[item.key]
        return (
          <label key={item.key} className="sw border-b border-line last:border-b-0">
            <input
              type="checkbox"
              checked={choice.on}
              onChange={event => set(item.key, { ...choice, on: event.target.checked })}
            />
            <i />
            <div className="flex flex-1 flex-col">
              {item.label}
              {item.detail && <span className="text-[11.5px] text-faint">{item.detail}</span>}
            </div>
            <div className="flex gap-1.5">
              {item.channels.map(channel => (
                <button
                  key={channel}
                  type="button"
                  disabled={!choice.on}
                  onClick={event => {
                    event.preventDefault()
                    set(item.key, toggleChannel(choice, channel as Channel))
                  }}
                  className={
                    'rounded px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-[.06em] ' +
                    (choice.on && choice.channels.includes(channel as Channel)
                      ? 'bg-accent-soft text-accent'
                      : 'bg-raised2 text-muted') +
                    (choice.on ? '' : ' opacity-50')
                  }>
                  {channel}
                </button>
              ))}
            </div>
          </label>
        )
      })}
      <p className="hint">
        Turning every channel off turns the notification off — nothing is delivered silently.
      </p>
    </Card>
  )
}

export function PrivacyCard({
  preferences,
  onChange,
}: {
  preferences: Preferences
  onChange: (next: Preferences) => void
}) {
  const privacy = preferences.privacy
  const set = (changes: Partial<Preferences['privacy']>) =>
    onChange({ ...preferences, privacy: { ...privacy, ...changes } })

  const toggle = (
    key: 'showLivePosition' | 'keepTrail' | 'stripPhotoLocation',
    label: string,
    detail?: string,
  ) => (
    <label className="sw border-b border-line last:border-b-0">
      <input
        type="checkbox"
        checked={privacy[key]}
        onChange={event => set({ [key]: event.target.checked })}
      />
      <i />
      <div className="flex flex-1 flex-col">
        {label}
        {detail && <span className="text-[11.5px] text-faint">{detail}</span>}
      </div>
    </label>
  )

  return (
    <Card title="Privacy">
      <div className="text-xs font-bold text-ink">Who can find me by handle</div>
      <div className="flex flex-col gap-1.5">
        {DISCOVERABILITY.map(option => (
          <label
            key={option.value}
            className={
              'flex cursor-pointer items-center gap-2.5 rounded-lg border px-2.5 py-2 text-[13px] ' +
              (privacy.discoverable === option.value
                ? 'border-accent bg-accent-soft'
                : 'border-line')
            }>
            <input
              type="radio"
              name="discoverable"
              className="sr-only"
              checked={privacy.discoverable === option.value}
              onChange={() => set({ discoverable: option.value as Discoverability })}
            />
            <i
              className={
                'size-3.5 flex-none rounded-full ' +
                (privacy.discoverable === option.value
                  ? 'border-4 border-accent'
                  : 'border-[1.5px] border-line2')
              }
            />
            {option.label}
          </label>
        ))}
      </div>
      {toggle(
        'showLivePosition',
        "Show my live position on trips I'm travelling",
        'Followers see the marker; nobody else does',
      )}
      {toggle(
        'keepTrail',
        'Keep my GPS trail after a trip ends',
        'Off: the trail is thinned to the route line 30 days after the trip',
      )}
      {toggle('stripPhotoLocation', 'Strip location data from photos I download')}
    </Card>
  )
}
