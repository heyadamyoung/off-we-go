import { useEffect, type ReactNode } from 'react'
import Icon from './icon'

interface SheetProps {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  tabs?: ReactNode
  footer?: ReactNode
  wide?: boolean
}

/* The centred dialog the whole app uses. Escape and a click on the backdrop
   both close it, because one of them is always the one you reach for. */
export default function Sheet({ title, onClose, children, tabs, footer, wide }: SheetProps) {
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])

  return (
    <div className="scrim fixed inset-0 z-[200] grid place-items-center bg-black/60 p-5 backdrop-blur-[6px]"
         onClick={onClose}>
      <div className={'modal dlg rise flex max-h-full w-full flex-col overflow-hidden rounded-[18px] ' +
        'border border-line bg-solid shadow-panel ' + (wide ? 'max-w-[640px]' : 'max-w-[520px]')}
           role="dialog" aria-modal="true" onClick={event => event.stopPropagation()}>
        <div className="flex flex-none items-center justify-between border-b border-line px-[18px] pb-3 pt-4">
          <b className="text-[18px] font-extrabold tracking-[-.01em]">{title}</b>
          <button className="grid size-8 place-items-center rounded-lg text-muted hover:bg-raised2 hover:text-ink"
                  onClick={onClose} aria-label="Close"><Icon n="x" s={16} /></button>
        </div>
        {tabs && <div className="flex flex-none gap-0.5 border-b border-line px-[18px]">{tabs}</div>}
        <div className="mb flex flex-col gap-3.5 overflow-y-auto overscroll-contain p-[18px]">{children}</div>
        {footer && (
          <div className="flex flex-none justify-end gap-2 border-t border-line px-[18px] pb-4 pt-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

export function SheetTab({ on, children, onClick }:
  { on: boolean; children: ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick}
            className={'-mb-px border-b-2 px-3 pb-2.5 pt-3 text-[13px] font-bold ' +
              (on ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink')}>
      {children}
    </button>
  )
}
