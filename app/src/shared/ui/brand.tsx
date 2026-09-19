import type { ReactNode } from 'react'

/* The brand is type: the words and the amber full stop, in the display face.
   The app icon is the same words stacked on a dark tile, drawn by
   scripts/render-wordmark.mjs from this same font, so the mark on a home
   screen and the mark in this corner are one mark. */
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
   before there is a trip to show. */
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
