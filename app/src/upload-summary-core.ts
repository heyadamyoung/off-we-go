/* What will happen to the pictures somebody has just chosen, in one line.

   The sheet used to answer this with a map of ONE of them and three
   paragraphs about where its coordinates came from — which is the truth about
   photograph seven of twenty and silence about the rest. What a person
   actually wants before pressing Add is the shape of the batch: how many know
   where they were taken, how many will land at a place on the itinerary, and
   what becomes of the ones that know nothing.

   Counting is all this is, so it lives out here where the sentence can be
   argued with in a test rather than by picking twenty photographs. */

export interface ChosenPlacement {
  /** Somewhere to put it on the map, from its own EXIF or the phone's. */
  previewPoint?: [number, number] | null
  /** Its own, rather than borrowed from where the phone happens to be. */
  hasEmbeddedGps?: boolean
  /** The itinerary item it will be grouped at, if it is near one. */
  stopId?: string | null
  stopName?: string | null
}

export interface ChosenSummary {
  total: number
  located: number
  unplaced: number
  /** The place most of them will land at, when there is one. */
  stopName: string | null
  atStop: number
}

export function summarise(placements: readonly ChosenPlacement[]): ChosenSummary {
  const total = placements.length
  const located = placements.filter(item => !!item.previewPoint).length
  const byStop = new Map<string, { name: string; count: number }>()
  for (const item of placements) {
    if (!item.stopId) continue
    const seen = byStop.get(item.stopId)
    if (seen) seen.count += 1
    else byStop.set(item.stopId, { name: item.stopName || 'a stop', count: 1 })
  }
  let best: { name: string; count: number } | null = null
  for (const entry of byStop.values()) if (!best || entry.count > best.count) best = entry
  return {
    total,
    located,
    unplaced: total - located,
    stopName: best?.name ?? null,
    atStop: best?.count ?? 0,
  }
}

const these = (count: number, of: number) => (count === of ? (of === 1 ? 'It' : 'All') : `${count}`)

/**
 * The sentence itself. Written to be read rather than parsed: it says what
 * will happen, and what to do about the ones it cannot place — which is now a
 * real answer rather than an apology, because a person can file those at a
 * stop afterwards in a couple of taps.
 */
export function placementSentence(summary: ChosenSummary): string {
  const { total, located, unplaced, stopName, atStop } = summary
  if (!total) return ''
  const parts: string[] = []
  if (located)
    parts.push(
      `${these(located, total)} ${located === 1 && total === 1 ? 'goes' : 'go'} on the map where ${
        located === 1 ? 'it was' : 'they were'
      } taken.`,
    )
  if (stopName && atStop)
    parts.push(
      atStop === 1
        ? `One will be grouped at ${stopName}.`
        : `${atStop} will be grouped at ${stopName}.`,
    )
  if (unplaced)
    parts.push(
      unplaced === total
        ? `${total === 1 ? 'It has no location' : 'None of them have a location'} — you can file ${
            total === 1 ? 'it' : 'them'
          } at a place afterwards.`
        : `${unplaced} ${unplaced === 1 ? 'has' : 'have'} no location, and can be filed at a place afterwards.`,
    )
  return parts.join(' ')
}
