/**
 * What a Wikidata entity tells us about a place.
 *
 * Wikidata itself is CC0, so the statements are free to store. The things
 * they point at are not: an image named in P18 is a file on Commons under
 * whatever licence its uploader chose, and that is checked where the file is
 * fetched rather than assumed here.
 *
 * Three things are wanted and one of them is not content at all:
 *
 *   P18  image              the file name, to look up on Commons
 *   P373 Commons category   a whole category rather than one file, which is
 *                           where a landmark's good photographs live
 *   P856 official website   not for display — to confirm the match. Our
 *                           place carries a website on 79% of records, and
 *                           the two agreeing is independent evidence that
 *                           the name-and-distance match was right.
 *
 * Plus sitelinks, which say whether there is an article to summarise and in
 * which languages.
 */

/* Sister projects, not Wikipedias. `simple` is a real Wikipedia and stays. */
const NOT_AN_ARTICLE = new Set([
  'commons',
  'species',
  'meta',
  'wikidata',
  'incubator',
  'outreach',
  'sources',
  'foundation',
  'mediawiki',
])

const claimValue = (entity, property) => {
  const claims = entity?.claims?.[property]
  if (!Array.isArray(claims)) return null
  for (const claim of claims) {
    /* `normal` and `preferred` are usable; `deprecated` is a statement the
       community has marked as known-wrong and must not be read. */
    if (claim?.rank === 'deprecated') continue
    const value = claim?.mainsnak?.datavalue?.value
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

/** Every rank-acceptable string value of a property, in order. */
const claimValues = (entity, property) => {
  const claims = entity?.claims?.[property]
  if (!Array.isArray(claims)) return []
  return claims
    .filter(claim => claim?.rank !== 'deprecated')
    .map(claim => claim?.mainsnak?.datavalue?.value)
    .filter(value => typeof value === 'string' && value.trim())
    .map(value => value.trim())
}

/**
 * @param {object} entity as `wbgetentities` returns one
 * @returns {{id: string|null, image: string|null, commonsCategory: string|null,
 *            websites: string[], sitelinks: Record<string,string>,
 *            label: string|null, description: string|null}}
 */
export function readEntity(entity) {
  const sitelinks = {}
  for (const [wiki, link] of Object.entries(entity?.sitelinks ?? {})) {
    /* `enwiki` → `en`. The sister projects sit in the same map and end in
       the same four letters — `commonswiki`, `specieswiki`, `metawiki` — and
       none of them is an article about this place, so they are named and
       refused rather than pattern-matched away. */
    const match = /^([a-z][a-z0-9-]*)wiki$/.exec(wiki)
    if (!match || NOT_AN_ARTICLE.has(match[1])) continue
    if (typeof link?.title === 'string') sitelinks[match[1]] = link.title
  }
  return {
    id: typeof entity?.id === 'string' ? entity.id : null,
    image: claimValue(entity, 'P18'),
    commonsCategory: claimValue(entity, 'P373'),
    websites: claimValues(entity, 'P856'),
    sitelinks,
    /* The label and short description are CC0 and are a usable last resort
       when there is no article: "18th-century castle in Edinburgh" is not a
       travel write-up but it is better than a blank card. */
    label: entity?.labels?.en?.value ?? null,
    description: entity?.descriptions?.en?.value ?? null,
  }
}

/** The article to summarise, preferring the reader's language then English. */
export function articleFor(read, languages = ['en']) {
  for (const language of languages) {
    const title = read?.sitelinks?.[language]
    if (title) return { lang: language, title }
  }
  const [lang, title] = Object.entries(read?.sitelinks ?? {})[0] ?? []
  return title ? { lang, title } : null
}
