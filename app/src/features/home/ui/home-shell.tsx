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

export default function HomeShell({
  me,
  places,
  home,
  live,
  waiting,
  wide,
  children,
}: HomeShellProps) {
  /* h-[100dvh], not inset-0: the layout viewport runs on behind the phone
     browser's toolbar, so anything anchored to its bottom sits behind that
     toolbar rather than above it. */
  return (
    <main className="fixed inset-x-0 top-0 h-[100dvh] overflow-hidden bg-canvas text-ink">
      <Globe places={places} home={home} live={live} waiting={waiting} />
      {/* Reading over a spinning planet needs the planet to give way, not the
          text to grow a box. Two regimes: side by side on a desktop the left
          third goes solid; stacked on a phone the percentages put the text
          over bare planet, so there the wash runs top-down instead — solid
          behind the reading column, the planet coming through below it. */}
      <div
        className="pointer-events-none absolute inset-0
                      max-md:[background:linear-gradient(180deg,var(--c-bg)_0%,color-mix(in_srgb,var(--c-bg)_88%,transparent)_44%,color-mix(in_srgb,var(--c-bg)_45%,transparent)_66%,transparent_88%)]
                      md:[background:linear-gradient(90deg,var(--c-bg)_0%,var(--c-bg)_34%,transparent_64%),linear-gradient(0deg,var(--c-bg)_0%,transparent_22%)]"
      />
      {/* The wide sub-pages read to the bottom of the screen, so the planet
          stays a backdrop the whole way down rather than surfacing under the
          last paragraph. */}
      {wide && (
        <div
          className="pointer-events-none absolute inset-0 md:hidden
                        [background:color-mix(in_srgb,var(--c-bg)_82%,transparent)]"
        />
      )}
      {/* The chrome's positioning frame: on an ultrawide monitor the planet
          keeps the whole glass, but the words and controls stop spreading —
          everything pins to the edges of this centred band instead of the
          screen's. pointer-events pass through it to the globe. */}
      <div className="pointer-events-none absolute inset-0 mx-auto max-w-[1760px]">
        {/* Above the column below it, not level with it: the account menu opens
            out of this bar, and a menu that shares a z-index with the page it
            covers is painted over by whatever comes later in the document. */}
        {/* The page is drawn under the status bar — viewport-fit=cover — so on a
            phone with an island the mark and the account button sat beneath it,
            visible and untappable. Everything here starts below the safe area. */}
        <div
          className="passthrough absolute left-8 right-7 z-30 flex items-center justify-between
                        top-[calc(1.5rem+env(safe-area-inset-top,0px))] md:left-16">
          <Link to="/">
            <Wordmark />
          </Link>
          <AccountMenu me={me} />
        </div>
        <div
          className={
            'passthrough absolute left-8 z-10 flex flex-col gap-5 pr-4 md:left-16 ' +
            (wide
              ? 'bottom-[calc(1.5rem+env(safe-area-inset-bottom,0px))] ' +
                'top-[calc(6rem+env(safe-area-inset-top,0px))] ' +
                'w-[min(660px,calc(100%-4rem))] overflow-y-auto'
              : 'top-[calc(8rem+env(safe-area-inset-top,0px))] w-[min(560px,calc(100%-4rem))] ' +
                'md:top-[calc(150px+env(safe-area-inset-top,0px))]')
          }>
          {children}
        </div>
      </div>
    </main>
  )
}

export function Crumb({ here }: { here: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-faint">
      <Link to="/" className="text-muted">
        Your trips
      </Link>
      <span>/</span>
      <span>{here}</span>
    </div>
  )
}

export function PageHeading({ children }: { children: ReactNode }) {
  return (
    <h1 className="m-0 text-[40px] font-extrabold leading-none tracking-[-.03em]">{children}</h1>
  )
}

/* The bordered list of onward links under the lead paragraph. */
export function MoreLink({
  icon,
  title,
  detail,
  note,
  to,
}: {
  icon: string
  title: string
  detail: string
  note?: string
  to: string
}) {
  return (
    <Link
      to={to}
      className="group flex items-center gap-3 border-b border-line py-3 text-sm text-ink">
      <span
        className="grid size-[26px] flex-none place-items-center rounded-lg bg-raised text-muted
                       group-hover:bg-accent group-hover:text-accent-ink">
        <Icon n={icon} s={14} />
      </span>
      <span className="flex-1">
        {title}
        <span className="block text-xs text-faint">{detail}</span>
      </span>
      {note && <span className="text-xs font-bold text-faint">{note}</span>}
    </Link>
  )
}
