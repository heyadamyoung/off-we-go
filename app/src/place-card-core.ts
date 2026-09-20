import type { PlaceAbout, PlaceCredit } from './places-about'

/**
 * What a place card shows, once everything that might know something has
 * spoken.
 *
 * Three sources, in a deliberate order, and the order is the whole content of
 * this module:
 *
 *   what the pin carried     already on screen. A card that blanks and then
 *                            refills is worse than one that starts partly
 *                            filled, so the pin's own caption wins.
 *   what we found out        the enrichment pipeline — one match to
 *                            OpenStreetMap and then the links its editors
 *                            declared. This is the good stuff and the reason
 *                            any of it exists.
 *   the legacy article       the Wikipedia pin, for as long as one can still
 *                            be drawn. Last, because it is being replaced.
 *
 * Pure so the precedence can be stated in a test rather than inferred from a
 * chain of `||` inside a component.
 */
export interface CardParts {
  picture: string
  note: string
  source: string
  /** the picture's and the paragraph's, in that order; either may be absent */
  credits: (PlaceCredit | null | undefined)[]
}

export interface CardSources {
  /** the pin's own caption and thumbnail, already on screen */
  pinNote?: string | null
  pinPicture?: string | null
  /** what the enrichment pipeline found, or null until it has run */
  about?: PlaceAbout | null
  /** the place's own website, when upstream knew one */
  website?: string | null
  /** the legacy Wikipedia summary, where one is still drawn */
  article?: { image?: string | null; note?: string | null; source?: string | null } | null
}

export function cardFrom({ pinNote, pinPicture, about, website, article }: CardSources): CardParts {
  const shot = about?.images?.[0] ?? null
  return {
    picture: shot?.thumbUrl || shot?.url || article?.image || pinPicture || '',
    note: pinNote || about?.description?.text || article?.note || '',
    /* The article we found if there is one, else the place's own website.
       Both beat nothing, and the article beats the website: it is about the
       place rather than sold by it. */
    source: about?.description?.sourceUrl || website || article?.source || '',
    credits: [shot?.attribution, about?.description?.attribution],
  }
}
