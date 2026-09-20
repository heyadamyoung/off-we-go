/* Presenting what the places layer sends back.

   The server answers out of open data we ingest and own: a record, the sources
   behind it, the licence each source carries, and a confidence between nought
   and one. None of that can go on a screen as it stands, and each part has a
   way of going wrong that stays invisible until somebody spots it in the wild.

   Licences first, because that one is not a matter of taste. An ODbL record
   must say "© OpenStreetMap contributors" wherever it is shown, and a list of
   forty results that says it forty times is a line nobody reads. So notices
   are deduplicated by licence, not by record. A licence this file has never
   heard of is rendered rather than dropped: the failure we can live with is an
   ugly line, the one we cannot is a missing attribution.

   Confidence next. The measured mean across Overture is 0.665, so a screen
   that hid everything under some tidy threshold would hide most of the world.
   Low confidence is softened, never hidden — the record is shown and told
   plainly that it is roughly located, which is what somebody needs in order to
   look at the map before walking there.

   And a degraded answer has words: a cell nobody has ingested yet comes back
   marked `degraded`, and without a sentence for that state it draws as a
   spinner that never ends, which reads as the search being broken.

   Pure on purpose — no React, no fetch — so every rule above is a unit test
   rather than something checked by eye on a screen. */

/** One source behind a record, and the licence it travels under. */
export interface PlaceSource {
  source: string
  license: string
  upstreamId?: string | null
}

export interface PlaceAddress {
  freeform?: string | null
  locality?: string | null
  region?: string | null
  postcode?: string | null
  country?: string | null
}

/** A record as the API serves it. Everything unfillable is null, never absent
    prose: an empty field means we do not know, and says so by being empty. */
export interface Place {
  id: string
  name: string
  category: string
  lat: number
  lng: number
  address?: PlaceAddress | string | null
  website?: string | null
  phone?: string | null
  /** opening hours as the upstream release wrote them — jsonb, unrendered */
  hours?: unknown
  confidence?: number | null
  sources?: PlaceSource[] | null
  /** notices the server says must be rendered for this record */
  attribution?: PlaceNotice[] | null
  /** metres from the point asked about, on a nearby answer */
  metres?: number | null
}

/* One notice as the server sends it — licence, words to print, where to read
   the licence — or as a bare string from anything simpler. Both, here, rather
   than in every caller. */
export type PlaceNotice =
  | string
  | { license?: string | null; notice?: string | null; url?: string | null }

export interface PlaceCoverage {
  cell: string
  status: string
}

/** A list answer: the records, and whether they came the slow honest way. */
export interface PlaceList {
  places: Place[]
  degraded: boolean
  coverage?: PlaceCoverage | null
}

export const EMPTY_PLACE_LIST: PlaceList = { places: [], degraded: false, coverage: null }

/* The twenty, in the order a screen shows them. Mirrors CATEGORIES in
   server/src/places/taxonomy.js, which the client cannot import across the
   tier boundary — the same list, so a category the server invents tomorrow
   lands in "other" here rather than vanishing. */
export const PLACE_CATEGORIES = [
  'sights',
  'viewpoint',
  'museum',
  'gallery',
  'historic',
  'religious',
  'nature',
  'beach',
  'food',
  'cafe',
  'bar',
  'market',
  'lodging',
  'shopping',
  'entertainment',
  'sport',
  'transit',
  'services',
  'health',
  'other',
] as const

export type PlaceCategory = (typeof PLACE_CATEGORIES)[number]

const CATEGORY_SET = new Set<string>(PLACE_CATEGORIES)

export function isPlaceCategory(value: unknown): value is PlaceCategory {
  return typeof value === 'string' && CATEGORY_SET.has(value)
}

/** The category a record is filed under, with anything unrecognised in "other"
    rather than in a group of its own that the ordering knows nothing about. */
export function categoryOf(place: Pick<Place, 'category'>): PlaceCategory {
  return isPlaceCategory(place.category) ? place.category : 'other'
}

/* Two registers, because a heading and a line under a name are not the same
   sentence: "Cafés" over a group of them, "Café" beside one. */
const GROUP_LABELS: Record<PlaceCategory, string> = {
  sights: 'Sights',
  viewpoint: 'Viewpoints',
  museum: 'Museums',
  gallery: 'Galleries',
  historic: 'Historic places',
  religious: 'Places of worship',
  nature: 'Parks and nature',
  beach: 'Beaches',
  food: 'Places to eat',
  cafe: 'Cafés',
  bar: 'Bars',
  market: 'Markets',
  lodging: 'Places to stay',
  shopping: 'Shops',
  entertainment: 'Entertainment',
  sport: 'Sport',
  transit: 'Getting around',
  services: 'Services',
  health: 'Health',
  other: 'Other places',
}

const PLACE_WORDS: Record<PlaceCategory, string> = {
  sights: 'Sight',
  viewpoint: 'Viewpoint',
  museum: 'Museum',
  gallery: 'Gallery',
  historic: 'Historic place',
  religious: 'Place of worship',
  nature: 'Park or nature',
  beach: 'Beach',
  food: 'Somewhere to eat',
  cafe: 'Café',
  bar: 'Bar',
  market: 'Market',
  lodging: 'Somewhere to stay',
  shopping: 'Shop',
  entertainment: 'Entertainment',
  sport: 'Sport',
  transit: 'Getting around',
  services: 'Services',
  health: 'Health',
  other: 'Place',
}

/** The heading over a group of them. */
export const categoryLabel = (category: string) => GROUP_LABELS[categoryOf({ category })]

/** The word for one of them, under its name. */
export const categoryWord = (category: string) => PLACE_WORDS[categoryOf({ category })]

/* ---- confidence ------------------------------------------------------- */

/* Two thresholds, and the reason they are not one. Above FIRM several sources
   agreed on where this is and what it is called; between the two it is one
   source's word, which is ordinary. Neither is worth a caveat. Below ROUGH the
   coordinates are a guess good enough to walk towards and not good enough to
   stand on — the one case somebody has to be told about before they set off. */
export const CONFIDENCE_FIRM = 0.75
export const CONFIDENCE_ROUGH = 0.5

export type ConfidenceBand = 'firm' | 'reported' | 'rough'

/** A record with no confidence at all is treated as rough: we cannot claim a
    precision nobody stated, and the hint costs a line rather than a record. */
export function confidenceBand(confidence?: number | null): ConfidenceBand {
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) return 'rough'
  if (confidence >= CONFIDENCE_FIRM) return 'firm'
  if (confidence >= CONFIDENCE_ROUGH) return 'reported'
  return 'rough'
}

/** What to draw beside a record, or nothing when it has nothing to answer for. */
export function confidenceHint(confidence?: number | null): string | null {
  return confidenceBand(confidence) === 'rough' ? 'Roughly located' : null
}

/* ---- attribution ------------------------------------------------------ */

/* Matched loosely on purpose: the licence arrives as a string from an upstream
   release, and `ODbL-1.0` becoming `ODbL-1.0+` one morning must not silently
   cost OpenStreetMap its credit. */
const LICENCE_NOTICES: Array<[RegExp, string | null]> = [
  [/^odbl/i, '© OpenStreetMap contributors'],
  [/^cdla-permissive/i, null],
  [/^apache-2/i, null],
]

const SOURCE_NAMES: Record<string, string> = {
  overture: 'Overture Maps Foundation',
  osm: 'OpenStreetMap',
  openstreetmap: 'OpenStreetMap',
  fsq: 'Foursquare',
  foursquare: 'Foursquare',
}

/** The notice a licence demands, or null when it demands none. An unknown
    licence is named rather than swallowed — see the header. */
export function licenceNotice(license: string): string | null {
  const licence = String(license || '').trim()
  if (!licence) return null
  for (const [pattern, notice] of LICENCE_NOTICES) {
    if (pattern.test(licence)) return notice
  }
  return `Contains data licensed ${licence}`
}

/** What a source is called in front of a person. */
export const sourceName = (source: string) =>
  SOURCE_NAMES[String(source || '').toLowerCase()] || String(source || '').trim()

export interface PlaceCredits {
  /** one per licence that asks for a notice, deduplicated across the screen */
  notices: string[]
  /** every source behind what is on screen, nameable even when it is silent */
  sources: string[]
  /** the line that must be rendered, or '' when nothing on screen needs one */
  line: string
}

/** The smallest set of notices that covers everything currently on screen.

    Deduplicated by licence rather than by record: twenty ODbL results are one
    "© OpenStreetMap contributors", which is both what the licence asks for and
    the only version anybody reads. */
export function creditsFor(places: readonly Place[]): PlaceCredits {
  const notices: string[] = []
  const sources: string[] = []
  const seenLicence = new Set<string>()
  const seenNotice = new Set<string>()
  const seenSource = new Set<string>()

  const addNotice = (notice: string | null | undefined) => {
    const text = String(notice || '').trim()
    if (!text || seenNotice.has(text)) return
    seenNotice.add(text)
    notices.push(text)
  }

  for (const place of places) {
    for (const source of place.sources || []) {
      const name = sourceName(source?.source || '')
      if (name && !seenSource.has(name)) {
        seenSource.add(name)
        sources.push(name)
      }
      const licence = String(source?.license || '')
        .trim()
        .toLowerCase()
      if (!licence || seenLicence.has(licence)) continue
      seenLicence.add(licence)
      addNotice(licenceNotice(source.license))
    }
    /* Whatever the server said to render, verbatim, and it has the last word:
       it knows about sources and licence terms this build has never been told
       of. Overture is the live example — nothing in CDLA-Permissive demands a
       notice, and the server asks for one anyway, so one is printed. The Set
       above means saying the same thing twice costs nothing. */
    for (const notice of place.attribution || []) {
      addNotice(typeof notice === 'string' ? notice : notice?.notice)
    }
  }

  return { notices, sources, line: notices.join(' · ') }
}

/* ---- grouping --------------------------------------------------------- */

export interface PlaceGroup {
  category: PlaceCategory
  label: string
  places: Place[]
}

/** Nearby results grouped for display, in CATEGORIES order, empty groups gone.
    Order within a group is left exactly as the server ranked it. */
export function groupByCategory(places: readonly Place[]): PlaceGroup[] {
  const bins = new Map<PlaceCategory, Place[]>()
  for (const place of places) {
    const category = categoryOf(place)
    const bin = bins.get(category)
    if (bin) bin.push(place)
    else bins.set(category, [place])
  }
  return PLACE_CATEGORIES.filter(category => bins.has(category)).map(category => ({
    category,
    label: GROUP_LABELS[category],
    places: bins.get(category)!,
  }))
}

/* ---- saying what is missing ------------------------------------------- */

const COVERAGE_WORDS: Record<string, string> = {
  failed: 'We could not finish gathering places here — this is what we already had.',
  empty: 'Not much is mapped around here — this is everything we have.',
}

const STILL_GATHERING = 'Still gathering places here — this is what we have so far.'

/** The line under a degraded list. Null when the answer was the normal one:
    a list that came back whole says nothing, which is the point. */
export function coverageNote(
  list: { degraded?: boolean; coverage?: PlaceCoverage | null } | null | undefined,
): string | null {
  if (!list?.degraded) return null
  return COVERAGE_WORDS[String(list.coverage?.status || '')] || STILL_GATHERING
}

/* ---- one record on a row ---------------------------------------------- */

/** Enough of an address to tell two places of the same name apart — the street
    and the town, or the town and the country when there is no street. */
export function addressLine(address: Place['address']): string {
  if (!address) return ''
  if (typeof address === 'string') return address.trim()
  const street = String(address.freeform || '').trim()
  const town = String(address.locality || '').trim()
  const wider = String(address.region || address.country || '').trim()
  const parts = street ? [street, town] : [town, wider]
  const kept: string[] = []
  for (const part of parts) {
    if (part && !kept.some(other => other.toLowerCase() === part.toLowerCase())) kept.push(part)
  }
  return kept.join(', ')
}

/** The second line of a result: what it is, and where — so that two places
    called The Crown are two visibly different places rather than one repeated. */
export function placeSubtitle(place: Place): string {
  return [categoryWord(place.category), addressLine(place.address)].filter(Boolean).join(' · ')
}

/* ---- reading the wire ------------------------------------------------- */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

/** A list answer, read defensively: the typeahead runs on every keystroke, and
    a payload that is a bare array, or that calls its rows something else, must
    come back empty rather than as an exception inside a React render. */
export function placeListFrom(payload: unknown): PlaceList {
  const rows = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.places)
      ? payload.places
      : []
  const places = rows.filter(
    (row): row is Place =>
      isRecord(row) && typeof row.id === 'string' && typeof row.name === 'string',
  )
  const degraded = isRecord(payload) && payload.degraded === true
  const coverage = isRecord(payload) && isRecord(payload.coverage) ? payload.coverage : null
  return {
    places,
    degraded,
    coverage:
      coverage && typeof coverage.cell === 'string'
        ? { cell: coverage.cell, status: String(coverage.status || '') }
        : null,
  }
}
