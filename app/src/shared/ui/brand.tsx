import type { ReactNode } from 'react'

/* The canonical artwork is a true SVG, so every size uses the real portal with
   no raster fallback. It is a detailed drawing — a sunset, mountains and a road
   running to the horizon — and below about thirty pixels all of that collapses
   into an orange blob, so nothing here asks for less. */
export function Brandmark({ size = 40 }: { size?: number }) {
  return (
    <img
      src="/offwego-icon.svg"
      alt=""
      aria-hidden="true"
      width={(size * 820) / 1060}
      height={size}
      className="shrink-0 object-contain"
    />
  )
}

export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <div className={'flex items-center gap-4 text-[13px] font-bold uppercase tracking-[.16em] text-faint ' + className}>
      <Brandmark size={62} />
      Off We Go
    </div>
  )
}

/* The centred card behind booting, signing in and anything else that happens
   before there is a trip to show — the one place with room to give the portal
   its full height. */
export function Screen({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-full place-items-center bg-canvas px-5 py-10
                     [background:radial-gradient(900px_500px_at_50%_0%,var(--c-accent-soft),transparent_60%),var(--c-bg)]">
      <div className="flex w-full max-w-[420px] flex-col items-center gap-3 text-center">
        <img src="/offwego-icon.svg" alt="" aria-hidden="true"
             className="mb-2 h-[168px] object-contain sm:h-[200px]" />
        {children}
      </div>
    </main>
  )
}
