import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { track } from '../lib/telemetry'
import type { ToastTone } from '../model/types'

export interface ToastNotice {
  message: string
  tone: ToastTone
}

type Notify = (message: string, tone?: ToastTone) => void

const ToastContext = createContext<Notify>(() => {})

/* One host for the whole app rather than a copy of the same timer in every
   screen. An error stays up longer than a confirmation because it is the only
   one anybody needs to read twice. */
export function ToastHost({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<ToastNotice | null>(null)
  const timer = useRef(0)

  const notify = useCallback<Notify>((message, tone = 'success') => {
    // "A user saw an error" is the browser's canonical wide event, and this
    // is the one place every error toast passes through.
    if (tone === 'error') track('show error toast', { message })
    setNotice({ message, tone })
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setNotice(null), tone === 'error' ? 5200 : 3000)
  }, [])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const value = useMemo(() => notify, [notify])
  return (
    <ToastContext.Provider value={value}>
      {children}
      <Toast notice={notice} />
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)

export default function Toast({ notice }: { notice: ToastNotice | null }) {
  if (!notice) return null
  const error = notice.tone === 'error'
  return (
    <div
      className={
        /* An announcement, never a target. It sits above everything at z-300
           and has nothing in it to click, so a toast that takes pointer events
           is a toast that blocks whatever it happens to land on — the viewer's
           edit and close buttons live exactly under it, and an error is on
           screen for five seconds. Longer, if the thing that failed retries. */
        'toast toast-rise pointer-events-none fixed left-1/2 z-[300] flex ' +
        'top-[calc(1.5rem+env(safe-area-inset-top,0px))] ' +
        'max-w-[min(520px,calc(100vw-28px))] ' +
        (error ? 'error ' : 'success ') +
        'items-center gap-2 rounded-full px-4 py-2.5 text-xs font-semibold shadow-panel ' +
        (error ? 'bg-danger text-white' : 'bg-ink text-canvas')
      }
      role={error ? 'alert' : 'status'}
      aria-live={error ? 'assertive' : 'polite'}
      aria-atomic="true">
      <span
        aria-hidden="true"
        className={
          'grid size-5 flex-none place-items-center rounded-full text-xs font-black ' +
          (error ? 'bg-white/25 text-white' : 'bg-accent text-accent-ink')
        }>
        {error ? '!' : '✓'}
      </span>
      {notice.message}
    </div>
  )
}
