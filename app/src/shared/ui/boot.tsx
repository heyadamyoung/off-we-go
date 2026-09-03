import { Screen } from './brand'
import { appErrorMessage, type AppAction } from '../../user-messages-core'

interface BootProps {
  what?: string
  error?: unknown
  action?: AppAction
  onRetry?: () => void
}

export default function Boot({
  what = 'your trips',
  error,
  action = 'load-trip',
  onRetry,
}: BootProps) {
  if (!error) {
    return (
      <Screen>
        <p className="hint">Loading {what}…</p>
      </Screen>
    )
  }
  return (
    <Screen>
      <h1 className="text-xl font-extrabold tracking-tight">{what} would not load</h1>
      <p className="hint max-w-[380px]">{appErrorMessage(error, action)}</p>
      {onRetry && (
        <button className="btn btn-ghost mt-1" onClick={onRetry}>
          Try again
        </button>
      )}
    </Screen>
  )
}
