import { useMemo } from 'react'
import { creditsFor, type Place } from '../../../places-core'

/* The line that has to be under open data.

   ODbL is not optional: a record that came through OpenStreetMap must say so
   wherever it is shown, and this is the component that makes that one thing
   hard to forget — every screen that draws places draws this underneath, and
   the arithmetic of which notices are owed lives in places-core where it is
   tested.

   It renders one notice per licence rather than one per record, because the
   version of this that credited every row turned a list of eight cafés into
   eight identical sentences, which is not attribution, it is wallpaper.

   When nothing on screen demands a notice — Overture's CDLA-Permissive asks
   for none — it still names where the data came from. That costs one faint
   line and is the whole argument for owning this layer rather than renting a
   metered place API: we can say where every record came from. */
export default function PlaceAttribution({
  places,
  className = '',
}: {
  places: readonly Place[]
  className?: string
}) {
  const credits = useMemo(() => creditsFor(places), [places])
  const text =
    credits.line || (credits.sources.length ? `Data from ${credits.sources.join(', ')}` : '')
  if (!text) return null
  return (
    <p
      className={'pattrib m-0 text-[10px] leading-snug text-faint ' + className}
      title={credits.sources.length ? `Data from ${credits.sources.join(', ')}` : undefined}>
      {text}
    </p>
  )
}
