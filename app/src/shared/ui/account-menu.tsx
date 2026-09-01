import { useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { hasBackend, signOut } from '../../backend'
import Icon from './icon'
import type { Person } from '../model/types'

/* The same control in the corner of every screen: who you are, and the two
   places that are not a trip. */
export default function AccountMenu({ me }: { me?: Person | null }) {
  const [open, setOpen] = useState(false)
  const holder = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const clickAway = (event: PointerEvent) => {
      if (!holder.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', clickAway)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', clickAway)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  const name = me?.name || 'You'
  const item = 'flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left text-[13px] ' +
    'text-ink hover:bg-raised2'

  return (
    <div className="relative" ref={holder}>
      <button className="glass flex items-center gap-2 rounded-full py-1 pl-1 pr-2.5"
              aria-label="Account" aria-haspopup="menu" aria-expanded={open}
              onClick={() => setOpen(value => !value)}>
        <span className="avatar bg-[#5B8DEF]">
          {me?.avatar ? <img src={me.avatar} alt="" /> : name.slice(0, 1).toUpperCase()}
        </span>
        <Icon n="chevron" s={14}
              className={'transition-transform ' + (open ? 'rotate-90' : '')} />
      </button>
      {open && (
        <div className="glass absolute right-0 top-[calc(100%+8px)] z-40 flex w-56 flex-col rounded-xl p-1.5"
             role="menu" aria-label="Account">
          <div className="mb-1 border-b border-line px-2.5 pb-2.5 pt-2 text-xs text-muted">
            <b className="block text-[13px] text-ink">{name}</b>
            {me?.handle ? `@${me.handle}` : me?.email}
          </div>
          <Link className={item} to="/" role="menuitem" onClick={() => setOpen(false)}>
            <Icon n="trips" s={14} />Your trips
          </Link>
          <Link className={item} to="/profile" role="menuitem" onClick={() => setOpen(false)}>
            <Icon n="cog" s={14} />Profile &amp; settings
          </Link>
          {hasBackend && (
            <button className={item} role="menuitem"
                    onClick={() => signOut().then(() => window.location.assign('/'))}>
              <Icon n="logout" s={14} />Sign out
            </button>
          )}
        </div>
      )}
    </div>
  )
}
