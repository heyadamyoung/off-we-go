import Icon from './icon'
import { describeOfflineAge } from '../../offline-trip-core'

/* Says two things at once, because both matter: this is the trip you already
   had, and this is how old it is. Quiet rather than accent-coloured — amber is
   the colour of what is happening now, and this is the opposite of that. */
export default function OfflineNote({ at, className = '' }: { at: number; className?: string }) {
  return (
    <div
      className={
        'glass pointer-events-none flex items-center gap-1.5 rounded-full px-3 py-1.5 ' +
        'text-[11px] font-semibold text-muted ' +
        className
      }
      title="Showing the copy saved on this device. It will refresh when you are back online.">
      <Icon n="clock" s={12} />
      <span>Offline · synced {describeOfflineAge(at)}</span>
    </div>
  )
}
