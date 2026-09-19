import type { ReactNode } from 'react'

/* The route block as a button when there is a screen to open, and a plain
   block when there is not — the same markup either way. */
export default function TicketDoor({
  open,
  label,
  className,
  children,
}: {
  open?: () => void
  label: string
  className: string
  children: ReactNode
}) {
  if (!open) return <div className={className}>{children}</div>
  return (
    <button className={`tkopen ${className}`} aria-label={label} onClick={open}>
      {children}
    </button>
  )
}
