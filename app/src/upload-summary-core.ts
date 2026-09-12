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
}

export interface ChosenSummary {
  total: number
  located: number
  unplaced: number
}

/* No itinerary item is counted. There used to be a third number here — how
   many would be grouped at the nearest stop, and which stop — and the sheet
   said so before you pressed Add. Nothing files a located photograph any more:
   it goes on the map where it was taken, which is what the first sentence
   already promises, and the clause was the app promising to do the thing that
   was moving people's pictures off the spot they were taken. */
export function summarise(placements: readonly ChosenPlacement[]): ChosenSummary {
  const total = placements.length
  const located = placements.filter(item => !!item.previewPoint).length
  return { total, located, unplaced: total - located }
}

const these = (count: number, of: number) => (count === of ? (of === 1 ? 'It' : 'All') : `${count}`)

/**
 * The sentence itself. Written to be read rather than parsed: it says what
 * will happen, and what to do about the ones it cannot place — which is now a
 * real answer rather than an apology, because a person can file those at a
 * stop afterwards in a couple of taps.
 */
export function placementSentence(summary: ChosenSummary): string {
  const { total, located, unplaced } = summary
  if (!total) return ''
  const parts: string[] = []
  if (located)
    parts.push(
      `${these(located, total)} ${located === 1 && total === 1 ? 'goes' : 'go'} on the map where ${
        located === 1 ? 'it was' : 'they were'
      } taken.`,
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
