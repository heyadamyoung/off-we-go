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

/* How long each kind stays: a confirmation is read once, a warning is worth
   a second look, and an error is the only one anybody needs to read twice. */
const STAYS: Record<ToastTone, number> = { success: 3000, warning: 4200, error: 5200 }

/* One host for the whole app rather than a copy of the same timer in every
   screen. */
export function ToastHost({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<ToastNotice | null>(null)
  const timer = useRef(0)

  const notify = useCallback<Notify>((message, tone = 'success') => {
    // "A user saw an error" is the browser's canonical wide event, and this
    // is the one place every error toast passes through.
    if (tone === 'error') track('show error toast', { message })
    setNotice({ message, tone })
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setNotice(null), STAYS[tone])
  }, [])

  useEffect(() => () => window.clearTimeout(timer.current), [])
  /* A handle for the test suite: a toast is raised by whatever just happened,
     and the suite wants one of each tone on demand to measure. */
  useEffect(() => {
    window.__offwegoToast = notify
    return () => {
      delete window.__offwegoToast
    }
  }, [notify])

  const value = useMemo(() => notify, [notify])
  return (
    <ToastContext.Provider value={value}>
      {children}
      <Toast notice={notice} />
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)

const MARK: Record<ToastTone, string> = { success: '✓', warning: '!', error: '✕' }

/* One sentence reads without its full stop, the way a banner does; a message
   of two sentences keeps its punctuation, because without it the two run
   together. Every toast then ends the same way whichever screen raised it. */
const said = (message: string) =>
  /\.\s+\S/.test(message) ? message : message.replace(/\.\s*$/, '')

/* Green for what worked, yellow for what to know, red for what failed — each
   a tinted surface of its own with the mark in the tone's colour, solid
   enough to read over a map in either theme (see .toast in styles.css).

   It is centred by a full-width row rather than by a transform: the old
   pill's centring lived only in its entrance keyframes, so at the end of
   the animation it snapped to the right of the screen and sat there over
   the header. Now nothing moves sideways, on a phone or at a desk: the row
   is the width of the screen, the pill sits in the middle of it from its
   first frame, and it only fades in from a few pixels above its place. */
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
           screen for five seconds. */
        'toasts pointer-events-none fixed inset-x-0 z-[300] flex justify-center px-3.5 ' +
        'top-[calc(0.75rem+env(safe-area-inset-top,0px))]'
      }>
      <div
        className={`toast toast-rise ${notice.tone} flex max-w-[520px] items-start gap-2.5 rounded-2xl border px-3.5 py-2.5 text-xs font-semibold leading-snug shadow-panel`}
        data-tone={notice.tone}
        role={error ? 'alert' : 'status'}
        aria-live={error ? 'assertive' : 'polite'}
        aria-atomic="true">
        <span
          aria-hidden="true"
          className="tmark mt-px grid size-4 flex-none place-items-center rounded-full text-[10px] font-black">
          {MARK[notice.tone]}
        </span>
        <span className="min-w-0">{said(notice.message)}</span>
      </div>
    </div>
  )
}
