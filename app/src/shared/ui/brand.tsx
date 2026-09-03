import type { ReactNode } from 'react'

/* The canonical artwork is a true SVG, so every size uses the real portal with
   no raster fallback. It is a detailed drawing — a sunset, mountains and a road
   running to the horizon — and below about thirty pixels all of that collapses
   into an orange blob, so nothing here asks for less. */
export function Brandmark({ size = 40, className = '' }: { size?: number; className?: string }) {
  return (
    <img
      src="/offwego-icon.svg"
      alt=""
      aria-hidden="true"
      width={(size * 820) / 1060}
      height={size}
      className={'shrink-0 object-contain ' + className}
    />
  )
}

/* The brand in chrome is type, not the badge: the portal drawing reads as a
   logo only at hero sizes, and both marks are still under review — the words
   and the amber full stop carry the identity fine on their own. */
export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <div
      className={
        'font-display whitespace-nowrap text-lg font-extrabold tracking-[-.01em] text-ink ' +
        className
      }>
      Off we go<span className="text-accent">.</span>
    </div>
  )
}

/* The same lockup at hero size, for the screens the badge used to fill. */
export function WordmarkHero({ className = '' }: { className?: string }) {
  return (
    <div
      className={
        'font-display whitespace-nowrap text-[40px] font-extrabold leading-none tracking-[-.02em] text-ink ' +
        className
      }>
      Off we go<span className="text-accent">.</span>
    </div>
  )
}

/* The centred card behind booting, signing in and anything else that happens
   before there is a trip to show — the one place with room to give the portal
   its full height. */
export function Screen({ children }: { children: ReactNode }) {
  return (
    <main
      className="grid min-h-full place-items-center bg-canvas px-5
                     pb-[calc(2.5rem+env(safe-area-inset-bottom,0px))]
                     pt-[calc(2.5rem+env(safe-area-inset-top,0px))]
                     [background:radial-gradient(900px_500px_at_50%_0%,var(--c-accent-soft),transparent_60%),var(--c-bg)]">
      <div className="flex w-full max-w-[420px] flex-col items-center gap-3 text-center">
        <WordmarkHero className="mb-3" />
        {children}
      </div>
    </main>
  )
}
