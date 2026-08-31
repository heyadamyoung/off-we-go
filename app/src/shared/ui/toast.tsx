import type { ToastTone } from '../model/types'

export interface ToastNotice {
  message: string
  tone: ToastTone
}

export default function Toast({ notice }: { notice: ToastNotice | null }) {
  if (!notice) return null
  return (
    <div className={`toast ${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}
      aria-live={notice.tone === 'error' ? 'assertive' : 'polite'} aria-atomic="true">
      <span aria-hidden="true">{notice.tone === 'error' ? '!' : '✓'}</span>
      {notice.message}
    </div>
  )
}
