import type { Id, TripLeg } from './shared/model/types'

/* How a travel leg reads on the timeline: people plan in minutes and know
   roads in kilometres, so seconds and metres both round to what a person
   would actually say out loud. */

const MODE_WORDS: Record<string, string> = { auto: 'drive', pedestrian: 'walk', bicycle: 'ride' }

export function legLabel(leg: TripLeg, mode = 'auto'): string {
  const minutes = Math.max(1, Math.round(leg.seconds / 60))
  const time =
    minutes >= 60
      ? `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`
      : `${minutes} min`
  const distance =
    leg.meters >= 950
      ? `${(leg.meters / 1000).toFixed(leg.meters >= 9500 ? 0 : 1)} km`
      : `${Math.max(10, Math.round(leg.meters / 10) * 10)} m`
  return `${time} ${MODE_WORDS[mode] || 'drive'} · ${distance}`
}

/** The timeline asks "what follows this stop?" — answer in O(1). */
export function legsByFrom(legs: TripLeg[]): Map<Id, TripLeg> {
  return new Map(legs.map(leg => [leg.fromId, leg]))
}
