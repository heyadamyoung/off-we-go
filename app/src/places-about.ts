/**
 * A picture and a paragraph, and the notice each of them is owed.
 *
 * Its own module because the notice is the point. A photograph is licensed by
 * whoever took it and a paragraph by whoever wrote it, and the two are
 * usually different people under different terms — so one shared credit line
 * at the bottom of a card would be wrong about at least one of them. Every
 * image carries its own, and the shape here is what makes that hard to get
 * wrong: there is nowhere to put a picture except beside its credit.
 *
 * Filled by the enrichment pipeline — server/src/places/enrich — which
 * refuses to store anything it cannot identify a free licence for. A picture
 * arriving here without a credit means something went wrong in between, and
 * places-wire drops it rather than showing somebody's photograph unnamed.
 */

export interface PlaceCredit {
  /** the line to print: who made it, where it came from, what it is under */
  text: string
  author?: string | null
  license: string
  licenseUrl?: string | null
  source?: string | null
  sourceUrl?: string | null
}

export interface PlacePicture {
  url: string
  thumbUrl?: string | null
  width?: number | null
  height?: number | null
  attribution: PlaceCredit | null
}

export interface PlaceAbout {
  description: {
    text: string
    source?: string | null
    sourceUrl?: string | null
    attribution: PlaceCredit | null
  } | null
  images: PlacePicture[]
  /** ready | barren | pending | working | failed */
  status: string
  /** true while we are still finding out — the card should not look final */
  waiting: boolean
}
