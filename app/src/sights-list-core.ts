import type { SightPlace } from './features/sights'

/* The sights list as a list: filtered by a word, sorted the way the reader
   asked, and with the ones already on the trip out of the way when they
   want them gone. The search itself ranks by readership; this is what the
   panel does with forty results once it has them. */

export type SightSort = 'popular' | 'nearest' | 'name' | 'kind'

export const SIGHT_SORTS: Array<{ value: SightSort; label: string }> = [
  { value: 'popular', label: 'Most visited' },
  { value: 'nearest', label: 'Nearest' },
  { value: 'name', label: 'A to Z' },
  { value: 'kind', label: 'By kind' },
]

export const SIGHT_SORT_KEY = 'offwego.sights.sort'

export function isSightSort(value: unknown): value is SightSort {
  return SIGHT_SORTS.some(sort => sort.value === value)
}

const fold = (text: string | null | undefined) =>
  String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

/** Every word typed must be found somewhere in the name, the kind or the note. */
export function filterSights(items: readonly SightPlace[], query: string): SightPlace[] {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (!words.length) return [...items]
  return items.filter(place => {
    const haystack = fold(`${place.name} ${place.kind} ${place.note}`)
    return words.every(word => haystack.includes(word))
  })
}

const far = (place: SightPlace) => place.metres ?? Number.POSITIVE_INFINITY

export function sortSights(items: readonly SightPlace[], sort: SightSort): SightPlace[] {
  const list = [...items]
  switch (sort) {
    case 'nearest':
      return list.sort((a, b) => far(a) - far(b) || b.readers - a.readers)
    case 'name':
      return list.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
    case 'kind':
      return list.sort(
        (a, b) =>
          fold(a.kind).localeCompare(fold(b.kind)) ||
          b.readers - a.readers ||
          a.name.localeCompare(b.name),
      )
    default:
      return list.sort((a, b) => b.readers - a.readers || far(a) - far(b))
  }
}

export interface SightsListView {
  shown: SightPlace[]
  /** how many the search found, before the word and the hiding */
  total: number
  /** how many of the found are already on the trip */
  onTrip: number
}

/** The list the panel draws, from what the search found. */
export function sightsListView(
  items: readonly SightPlace[],
  options: {
    query: string
    sort: SightSort
    hideOnTrip: boolean
    onTrip: (place: SightPlace) => boolean
  },
): SightsListView {
  const onTrip = items.filter(options.onTrip).length
  const kept = options.hideOnTrip ? items.filter(place => !options.onTrip(place)) : [...items]
  return {
    shown: sortSights(filterSights(kept, options.query), options.sort),
    total: items.length,
    onTrip,
  }
}
