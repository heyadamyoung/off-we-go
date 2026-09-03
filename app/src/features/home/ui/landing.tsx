import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { sampleTrip } from '../../../sample-trip-core'
import { Wordmark } from '../../../shared/ui/brand'
import { SignInScreen } from '../../auth'
import { tripPlaces } from '../model/trip-globe'
import Globe from './globe'

/* The front door for someone with no account: what this is, the planet it
   happens on, and two ways in — an account, or a wander through the sample
   trip first. Until this existed, a first-time visitor's whole impression of
   the product was a form that said "Welcome back". */
export default function LandingPage() {
  const [auth, setAuth] = useState(false)
  if (auth) return <SignInScreen />

  const value = sampleTrip()
  const places = tripPlaces({
    ...value.trip,
    id: 'sample',
    slug: 'sample',
    role: 'viewer',
    places: value.stops.map(stop => ({
      name: stop.name,
      lng: stop.lng,
      lat: stop.lat,
      status: stop.status,
    })),
  })

  return (
    <main className="fixed inset-x-0 top-0 h-[100dvh] overflow-hidden bg-canvas text-ink">
      <Globe places={places} />
      {/* The same two scrim regimes as the signed-in shell: the planet yields
          to the reading column, side-on for a desktop, top-down for a phone. */}
      <div
        className="pointer-events-none absolute inset-0
                      max-md:[background:linear-gradient(180deg,var(--c-bg)_0%,color-mix(in_srgb,var(--c-bg)_88%,transparent)_48%,color-mix(in_srgb,var(--c-bg)_40%,transparent)_70%,transparent_90%)]
                      md:[background:linear-gradient(90deg,var(--c-bg)_0%,var(--c-bg)_36%,transparent_66%),linear-gradient(0deg,var(--c-bg)_0%,transparent_22%)]"
      />
      {/* Ultrawide monitors keep the planet edge to edge; the words and the
          buttons pin to this centred band instead of the screen's corners. */}
      <div className="pointer-events-none absolute inset-0 mx-auto max-w-[1760px]">
        <div
          className="passthrough absolute left-8 right-7 z-30 flex items-center justify-between
                      top-[calc(1.5rem+env(safe-area-inset-top,0px))] md:left-16">
          <Wordmark />
          <button className="btn btn-ghost" onClick={() => setAuth(true)}>
            Sign in
          </button>
        </div>
        <div
          className="passthrough absolute left-8 z-10 flex w-[min(560px,calc(100%-4rem))] flex-col
                      gap-5 pr-4 top-[calc(7rem+env(safe-area-inset-top,0px))] md:left-16
                      md:top-[calc(150px+env(safe-area-inset-top,0px))]">
          <h1 className="m-0 text-[56px] font-extrabold leading-none tracking-[-.03em] max-sm:text-[40px]">
            Go places, together.
          </h1>
          <p className="m-0 max-w-[46ch] text-base leading-relaxed text-muted">
            Plan the stops on a real map, and watch the trip happen on it: photos land where they
            were taken, phones draw the travelled line as you go, and the family following from home
            sees it all live — every trip an arc on your own globe.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn btn-accent" onClick={() => setAuth(true)}>
              Create your account
            </button>
            <Link
              to="/trips/$slug"
              params={{ slug: 'sample' }}
              className="btn btn-ghost text-ink hover:text-ink">
              Wander the sample trip
            </Link>
          </div>
          <p className="hint m-0">
            The sample is a real, explorable trip — no account needed to look around.
          </p>
        </div>
      </div>
    </main>
  )
}
