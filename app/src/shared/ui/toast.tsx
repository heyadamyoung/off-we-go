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
        'toast toast-rise fixed left-1/2 top-6 z-[300] flex ' +
        'max-w-[min(520px,calc(100vw-28px))] ' +
        (error ? 'error ' : 'success ') +
        'items-center gap-2.5 rounded-full px-4 py-2.5 text-xs font-semibold shadow-panel ' +
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
