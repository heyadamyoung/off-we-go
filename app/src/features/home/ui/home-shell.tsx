import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { Wordmark } from '../../../shared/ui/brand'
import AccountMenu from '../../../shared/ui/account-menu'
import Icon from '../../../shared/ui/icon'
import Globe from './globe'
import type { GlobePlace } from '../model/globe-core'
import type { MyProfile } from '../../../shared/model/types'

interface HomeShellProps {
  me?: MyProfile | null
  places?: GlobePlace[]
  home?: GlobePlace | null
  live?: GlobePlace | null
  waiting?: boolean
  /** the reading column widens and scrolls on the sub-pages */
  wide?: boolean
  children: ReactNode
}

export default function HomeShell({ me, places, home, live, waiting, wide, children }: HomeShellProps) {
  return (
    <main className="fixed inset-0 overflow-hidden bg-canvas text-ink">
      <Globe places={places} home={home} live={live} waiting={waiting} />
      {/* Reading over a spinning planet needs the planet to give way on the
          left, not the text to grow a box. */}
      <div className="pointer-events-none absolute inset-0
                      [background:linear-gradient(90deg,var(--c-bg)_0%,var(--c-bg)_34%,transparent_64%),linear-gradient(0deg,var(--c-bg)_0%,transparent_22%)]" />
      <div className="absolute left-8 right-7 top-6 z-10 flex items-center justify-between md:left-16">
        <Link to="/"><Wordmark markSize={44} /></Link>
        <AccountMenu me={me} />
      </div>
      <div className={'absolute left-8 z-10 flex flex-col gap-5 pr-4 md:left-16 ' + (wide
        ? 'bottom-6 top-24 w-[min(660px,calc(100%-4rem))] overflow-y-auto'
        : 'top-32 w-[min(560px,calc(100%-4rem))] md:top-[150px]')}>
        {children}
      </div>
    </main>
  )
}

export function Crumb({ here }: { here: string }) {
  return (
    <div className="flex items-center gap-2 text-[13px] text-faint">
      <Link to="/" className="text-muted">Your trips</Link>
      <span>/</span>
      <span>{here}</span>
    </div>
  )
}

export function PageHeading({ children }: { children: ReactNode }) {
  return <h1 className="m-0 text-[40px] font-extrabold leading-none tracking-[-.03em]">{children}</h1>
}

/* The bordered list of onward links under the lead paragraph. */
export function MoreLink({ icon, title, detail, note, to }:
  { icon: string; title: string; detail: string; note?: string; to: string }) {
  return (
    <Link to={to}
          className="group flex items-center gap-3.5 border-b border-line py-3 text-[14px] text-ink">
      <span className="grid size-[26px] flex-none place-items-center rounded-lg bg-raised text-muted
                       group-hover:bg-accent group-hover:text-accent-ink">
        <Icon n={icon} s={14} />
      </span>
      <span className="flex-1">
        {title}
        <span className="block text-[12.5px] text-faint">{detail}</span>
      </span>
      {note && <span className="text-xs font-bold text-faint">{note}</span>}
    </Link>
  )
}
