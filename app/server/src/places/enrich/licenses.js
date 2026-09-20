/**
 * Which licences we may store under, and how we say so.
 *
 * This is a gate, not a label. Everywhere else in the enrichment pipeline the
 * rule is the same: a picture or a paragraph whose licence this module does
 * not recognise is not stored, not shown, and not cached. Unfillable stays
 * null. That is stricter than it needs to be for the common case and it is
 * the only version that is safe to run unattended over millions of records,
 * because the failure mode of guessing is that we publish somebody's
 * photograph without the right to.
 *
 * Wikimedia Commons is the reason the gate has to be real. "It is on Commons"
 * is not a licence: Commons hosts non-free logos under fair-use rationales,
 * files with no licence at all pending deletion, and files whose licence
 * template a bot has flagged as disputed. The API tells us which, and we read
 * it rather than assuming.
 *
 * Every allowed licence here permits commercial use and redistribution. Most
 * require attribution, some require share-alike on adaptations — we adapt
 * nothing, we display, so share-alike costs us the notice and nothing else.
 * The notice is not optional and is not a footnote: `attributionFor` produces
 * it, the API sends it with the picture, and the client renders it under the
 * picture. A licence that required us to relicense our own app would not be
 * on this list at all.
 */

/* Keyed by the identifier the upstream API actually returns, lowercased.
   Commons reports `LicenseShortName` like "CC BY-SA 4.0"; Wikipedia's REST
   API reports the article licence; OSM is ODbL throughout. */
const ALLOWED = new Map(
  Object.entries({
    /* Public domain and equivalents: no notice required, but we give one
       anyway because the author line is the interesting part. */
    cc0: {
      name: 'CC0 1.0',
      url: 'https://creativecommons.org/publicdomain/zero/1.0/',
      attribution: false,
      shareAlike: false,
    },
    'cc0 1.0': {
      name: 'CC0 1.0',
      url: 'https://creativecommons.org/publicdomain/zero/1.0/',
      attribution: false,
      shareAlike: false,
    },
    'public domain': { name: 'Public domain', url: null, attribution: false, shareAlike: false },
    'pd-old': { name: 'Public domain', url: null, attribution: false, shareAlike: false },
    'pd-us': { name: 'Public domain', url: null, attribution: false, shareAlike: false },
    'pd-self': { name: 'Public domain', url: null, attribution: false, shareAlike: false },

    /* Attribution, commercial use allowed. */
    'cc by 1.0': {
      name: 'CC BY 1.0',
      url: 'https://creativecommons.org/licenses/by/1.0/',
      attribution: true,
      shareAlike: false,
    },
    'cc by 2.0': {
      name: 'CC BY 2.0',
      url: 'https://creativecommons.org/licenses/by/2.0/',
      attribution: true,
      shareAlike: false,
    },
    'cc by 2.5': {
      name: 'CC BY 2.5',
      url: 'https://creativecommons.org/licenses/by/2.5/',
      attribution: true,
      shareAlike: false,
    },
    'cc by 3.0': {
      name: 'CC BY 3.0',
      url: 'https://creativecommons.org/licenses/by/3.0/',
      attribution: true,
      shareAlike: false,
    },
    'cc by 4.0': {
      name: 'CC BY 4.0',
      url: 'https://creativecommons.org/licenses/by/4.0/',
      attribution: true,
      shareAlike: false,
    },

    /* Attribution and share-alike. We display rather than adapt, so the
       obligation is the notice. */
    'cc by-sa 1.0': {
      name: 'CC BY-SA 1.0',
      url: 'https://creativecommons.org/licenses/by-sa/1.0/',
      attribution: true,
      shareAlike: true,
    },
    'cc by-sa 2.0': {
      name: 'CC BY-SA 2.0',
      url: 'https://creativecommons.org/licenses/by-sa/2.0/',
      attribution: true,
      shareAlike: true,
    },
    'cc by-sa 2.5': {
      name: 'CC BY-SA 2.5',
      url: 'https://creativecommons.org/licenses/by-sa/2.5/',
      attribution: true,
      shareAlike: true,
    },
    'cc by-sa 3.0': {
      name: 'CC BY-SA 3.0',
      url: 'https://creativecommons.org/licenses/by-sa/3.0/',
      attribution: true,
      shareAlike: true,
    },
    'cc by-sa 4.0': {
      name: 'CC BY-SA 4.0',
      url: 'https://creativecommons.org/licenses/by-sa/4.0/',
      attribution: true,
      shareAlike: true,
    },

    /* The data licences our own records already carry. */
    'odbl-1.0': {
      name: 'ODbL 1.0',
      url: 'https://opendatacommons.org/licenses/odbl/1-0/',
      attribution: true,
      shareAlike: true,
    },
    'cdla-permissive-2.0': {
      name: 'CDLA Permissive 2.0',
      url: 'https://cdla.dev/permissive-2-0/',
      attribution: true,
      shareAlike: false,
    },
    'apache-2.0': {
      name: 'Apache 2.0',
      url: 'https://www.apache.org/licenses/LICENSE-2.0',
      attribution: true,
      shareAlike: false,
    },
  }),
)

/* Said explicitly so that a file carrying one of these is refused loudly in a
   test rather than quietly failing to match a key. Every one of them appears
   on Commons and none of them may be republished by us. */
const REFUSED = new Set([
  'fair use',
  'non-free',
  'cc by-nc 4.0',
  'cc by-nc-sa 4.0',
  'cc by-nd 4.0',
  'copyrighted',
  'all rights reserved',
  'gfdl',
])

/** The key an upstream licence name reduces to. */
export const licenseKey = name =>
  String(name ?? '')
    .toLowerCase()
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * The licence, or null if we may not store under it.
 *
 * Null is the answer for anything unrecognised, not only for the licences in
 * REFUSED: a licence nobody has taught this module about is a licence we do
 * not know the terms of.
 *
 * @param {string|null|undefined} name as the upstream API reports it
 * @returns {{id: string, name: string, url: string|null,
 *            attribution: boolean, shareAlike: boolean}|null}
 */
export function licenseFor(name) {
  const key = licenseKey(name)
  if (!key || REFUSED.has(key)) return null
  const found = ALLOWED.get(key)
  return found ? { id: key, ...found } : null
}

/** Whether this licence is one we may store and show under. */
export const mayStore = name => licenseFor(name) !== null

/**
 * The notice that goes under the picture.
 *
 * One line, in the order a reader needs it: who made it, what it is under,
 * and where it came from. The pieces are returned separately as well as
 * joined, because the client renders the author and the licence as links and
 * a pre-joined string would force it to parse its own text back apart.
 *
 * @param {{author?: string|null, license?: string|null, source?: string|null,
 *          sourceUrl?: string|null}} credit
 */
export function attributionFor(credit = {}) {
  const license = licenseFor(credit.license)
  if (!license) return null
  const author = typeof credit.author === 'string' ? credit.author.trim() : ''
  const parts = []
  if (author) parts.push(author)
  if (credit.source) parts.push(credit.source)
  parts.push(license.name)
  return {
    text: parts.join(' · '),
    author: author || null,
    license: license.name,
    licenseUrl: license.url,
    source: credit.source ?? null,
    sourceUrl: credit.sourceUrl ?? null,
  }
}
