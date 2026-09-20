/* What a cell's data is actually like, counted at the moment it is loaded.
 *
 * Coverage says "ready", and ready is not the same as good. A cell in central
 * Amsterdam comes back with eleven thousand places, a website on half of them
 * and a telephone on four fifths; a cell over rural Anatolia comes back with
 * ninety, a website on three, and is just as "ready". The difference matters
 * to a traveller and it matters to us — thin data is where "sights nearby"
 * returns a petrol station — and the only cheap moment to notice it is while
 * the rows are already in memory during the ingest.
 *
 * So every cell stores a report in `place_coverage.quality`, and the report
 * is the thing an operator sorts by when asking which country to re-ingest
 * from a better source. Without it the answer is a full table scan per
 * question, and in practice the answer is nobody asks and a user finds out.
 *
 * Everything here is pure arithmetic over the places of one cell: no clock,
 * no database, no upstream. That is what lets the numbers be asserted exactly
 * in a test, and what lets the same function be run over a query result later
 * without an ingest.
 *
 * The shares are percentages — 46.6, not "46.6%" and not 0.466. Numbers
 * because this lands in JSONB and gets compared with `>` in SQL; percentages
 * because the measured facts everybody quotes (address 100, phone 82.5,
 * website 46.6) are quoted that way, and two scales for one quantity is how
 * somebody eventually files a cell with 0.9% coverage as excellent.
 */

/** Below this a place is worth counting separately: it is the floor rank.js
    applies before a place is shown at all, so a cell that is mostly below it
    is a cell whose count is a lie. Held here as its own constant rather than
    imported so that changing what a search hides cannot silently rewrite
    history in a coverage row that was already stored. */
export const CONFIDENCE_FLOOR = 0.3

/** One decimal place. The inputs are counts of a few thousand; more digits
    would be noise, and rounding here means the same cell re-ingested twice
    produces the same JSON rather than two that differ in the ninth place. */
const share = (count, total) => (total ? Math.round((count / total) * 1000) / 10 : 0)

const has = value => {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.trim() !== ''
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.values(value).some(has)
  return true
}

/**
 * The report for one cell's places.
 *
 * @param {Array<{category?: string, website?: any, phone?: any, hours?: any,
 *                address?: any, confidence?: number}>} places
 * @returns {{count: number, byCategory: Record<string, number>, withWebsite: number,
 *            withPhone: number, withHours: number, withAddress: number,
 *            meanConfidence: number, belowFloor: number}}
 */
export function qualityReport(places) {
  const rows = Array.isArray(places) ? places : []
  const count = rows.length
  /** Counts, not shares: a category's share of a cell is not a useful number
      but "eleven museums" is, and the share is one division away. */
  const byCategory = {}
  let website = 0
  let phone = 0
  let hours = 0
  let address = 0
  let confidence = 0
  let below = 0
  for (const place of rows) {
    const category = place?.category || 'other'
    byCategory[category] = (byCategory[category] || 0) + 1
    if (has(place?.website)) website += 1
    if (has(place?.phone)) phone += 1
    if (has(place?.hours)) hours += 1
    if (has(place?.address)) address += 1
    const score = Number(place?.confidence)
    if (Number.isFinite(score)) {
      confidence += score
      if (score < CONFIDENCE_FLOOR) below += 1
    } else {
      /* No score is worse than a low one: it cannot be ranked at all. */
      below += 1
    }
  }
  return {
    count,
    /* Sorted so two ingests of the same cell produce byte-identical JSON and
       a diff of two coverage rows is about the data, not about key order. */
    byCategory: Object.fromEntries(Object.entries(byCategory).sort(([a], [b]) => (a < b ? -1 : 1))),
    withWebsite: share(website, count),
    withPhone: share(phone, count),
    withHours: share(hours, count),
    withAddress: share(address, count),
    meanConfidence: count ? Math.round((confidence / count) * 1000) / 1000 : 0,
    /* A count, not a share, and deliberately the odd one out: the question it
       answers is "how many of these would a search refuse to show", which is
       a number of places, not a proportion of them. */
    belowFloor: below,
  }
}

/**
 * Whether a report describes data too thin to call a cell done well. Not a
 * failure — a cell over the Sahara is honestly empty — but the flag an
 * operator filters on.
 *
 * @param {ReturnType<typeof qualityReport>} report
 */
export function looksThin(report) {
  if (!report || report.count === 0) return false
  return report.count < 25 || report.belowFloor / report.count > 0.5 || report.withAddress < 25
}
