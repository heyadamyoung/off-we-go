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
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])

  /* The bottom padding follows the keyboard: on iOS the page keeps its full
     height behind it, so a centred dialog centres behind it too. */
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the scrim is the pointer way out; Escape is wired on window above
    // biome-ignore lint/a11y/useKeyWithClickEvents: the scrim is the pointer way out; Escape is wired on window above
    <div
      className="scrim fixed inset-0 z-[200] grid place-items-center bg-black/60 p-5
                    pb-[calc(1.25rem+var(--keyboard,0px))] backdrop-blur-[6px]"
      onClick={onClose}>
      {/* A tabbed sheet keeps one height whichever tab is showing. Sized to its
          content it grew and shrank as you moved between them, and since it is
          centred, the title, the tabs and the buttons all jumped with it —
          every tab arrived with its controls somewhere new. */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation only fences clicks off the scrim; it is not an interaction */}
      <div
        className={
          'modal dlg rise flex max-h-full w-full flex-col overflow-hidden rounded-2xl ' +
          'border border-line bg-solid shadow-panel ' +
          (wide ? 'max-w-[640px] ' : 'max-w-[520px] ') +
          (tabs ? 'h-[min(100%,560px)]' : '')
        }
        role="dialog"
        aria-modal="true"
        onClick={event => event.stopPropagation()}>
        <div className="flex flex-none items-center justify-between border-b border-line px-[18px] pb-3 pt-4">
          <b className="text-lg font-extrabold tracking-[-.01em]">{title}</b>
          <button
            className="grid size-8 place-items-center rounded-lg text-muted hover:bg-raised2 hover:text-ink"
            onClick={onClose}
            aria-label="Close">
            <Icon n="x" s={16} />
          </button>
        </div>
        {tabs && (
          <div className="flex flex-none gap-0.5 border-b border-line px-[18px]">{tabs}</div>
        )}
        {/* overflow-x-hidden explicitly: a box that scrolls on one axis computes
            the other to auto, so anything a little too wide — a device name, a
            long address — turned the whole panel into a sideways scroller. */}
        {/* flex-1: the body takes what is left of the sheet, so the buttons stay
            on the bottom edge instead of floating up to meet short content. */}
        <div
          className="mb flex flex-1 flex-col gap-3.5 overflow-y-auto overflow-x-hidden
                        overscroll-contain break-words p-[18px]">
          {children}
        </div>
        {footer && (
          <div
            className="dlgfoot flex flex-none items-center justify-end gap-2 border-t border-line
                          px-[18px] pb-[calc(1rem+env(safe-area-inset-bottom,0px))] pt-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

export function SheetTab({
  on,
  children,
  onClick,
}: {
  on: boolean
  children: ReactNode
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={
        '-mb-px flex-none whitespace-nowrap border-b-2 px-3 pb-2.5 pt-3 ' +
        'text-xs font-bold ' +
        // Selection is ink everywhere; amber stays the journey's.
        (on ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink')
      }>
      {children}
    </button>
  )
}
