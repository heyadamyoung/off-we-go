import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, readFiles, LEAST_PIXELS } from '../src/places/enrich/commons.js'
import {
  BY_NAME_AND_PLACE,
  BY_WEBSITE,
  declaredBy,
  hostOf,
  identify,
  sameSite,
} from '../src/places/enrich/identity.js'
import { attributionFor, licenseFor, mayStore } from '../src/places/enrich/licenses.js'
import { articleFor, readEntity } from '../src/places/enrich/wikidata.js'
import { readSummary, trimToCard } from '../src/places/enrich/wikipedia.js'

/* The enrichment chain, hop by hop.
 *
 * Every module here is pure, which is deliberate: the fetching is a few lines
 * around them and the decisions are all in here, where a test can state them
 * exactly. The decisions are the part that can quietly put somebody else's
 * photograph on our map. */

test('the licence gate', async t => {
  await t.test('recognises the licences we may store under', () => {
    for (const name of ['CC0', 'CC BY 4.0', 'CC BY-SA 3.0', 'Public domain', 'ODbL-1.0']) {
      assert.ok(mayStore(name), `${name} is storable`)
    }
  })

  await t.test('refuses the ones that forbid what we would be doing', () => {
    for (const name of ['CC BY-NC 4.0', 'CC BY-ND 4.0', 'CC BY-NC-SA 4.0', 'Fair use', 'GFDL']) {
      assert.equal(mayStore(name), false, `${name} is not storable`)
    }
  })

  /* The important one: silence is not permission. A licence nobody has
     taught this module about is a licence whose terms we do not know. */
  await t.test('refuses anything it does not recognise, including nothing at all', () => {
    for (const name of [null, undefined, '', '  ', 'CC BY 9.9', 'Some bespoke terms']) {
      assert.equal(mayStore(name), false, `${JSON.stringify(name)} is not storable`)
    }
  })

  await t.test('says who to credit, and never for a licence it refused', () => {
    const credit = attributionFor({
      author: 'Jane Photographer',
      license: 'CC BY-SA 4.0',
      source: 'Wikimedia Commons',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:X.jpg',
    })
    assert.equal(credit.text, 'Jane Photographer · Wikimedia Commons · CC BY-SA 4.0')
    assert.equal(credit.licenseUrl, 'https://creativecommons.org/licenses/by-sa/4.0/')
    assert.equal(attributionFor({ author: 'Jane', license: 'CC BY-NC 4.0' }), null)
  })

  await t.test('is not confused by case or spacing', () => {
    assert.ok(licenseFor('cc by-sa 4.0'))
    assert.ok(licenseFor('  CC BY-SA 4.0  '))
    assert.ok(licenseFor('CC_BY_SA 4.0') === null || licenseFor('CC BY SA 4.0') === null)
  })
})

test('matching a place to an OpenStreetMap object', async t => {
  const castle = {
    name: 'Edinburgh Castle',
    lat: 55.9486,
    lng: -3.1999,
    category: 'historic',
    website: 'https://www.edinburghcastle.scot/',
  }

  await t.test('reads a host, and is not fooled by a missing scheme', () => {
    assert.equal(hostOf('https://www.example.com/x'), 'example.com')
    assert.equal(hostOf('example.com'), 'example.com')
    assert.equal(hostOf('not a url at all'), 'not a url at all' && hostOf('not a url at all'))
    assert.equal(hostOf(null), null)
  })

  await t.test('a subdomain is the same site; a lookalike is not', () => {
    assert.equal(sameSite('https://example.com', 'https://visit.example.com'), true)
    assert.equal(sameSite('https://www.example.com', 'http://example.com/booking'), true)
    assert.equal(sameSite('https://example.com', 'https://notexample.com'), false)
    assert.equal(sameSite('https://example.com', null), false)
  })

  await t.test('one candidate sharing the website wins on that alone', () => {
    /* The name does not match at all — a rebrand, which is the case this
       rule exists for. The site is the organisation saying where it lives. */
    const found = identify(castle, [
      {
        id: 'way/1',
        name: 'The Castle of Edinburgh (HES)',
        lat: 55.9486,
        lng: -3.1999,
        category: 'historic',
        tags: { website: 'https://edinburghcastle.scot' },
      },
      { id: 'node/2', name: 'Castle Café', lat: 55.9488, lng: -3.2001, category: 'cafe' },
    ])
    assert.equal(found.ref, 'way/1')
    assert.equal(found.method, BY_WEBSITE)
    assert.equal(found.mayPicture, true)
  })

  await t.test('a name-and-distance match the website confirms may show a picture', () => {
    const found = identify(castle, [
      {
        id: 'way/1',
        name: 'Edinburgh Castle',
        lat: 55.9487,
        lng: -3.1998,
        category: 'historic',
        tags: { website: 'https://www.edinburghcastle.scot/visit' },
      },
      {
        id: 'way/9',
        name: 'Edinburgh Castle',
        lat: 55.9489,
        lng: -3.2002,
        category: 'historic',
        tags: { website: 'https://www.edinburghcastle.scot/shop' },
      },
    ])
    assert.equal(found.method, BY_NAME_AND_PLACE)
    assert.equal(found.confirmedBy, BY_WEBSITE)
    assert.equal(found.mayPicture, true)
  })

  /* The asymmetry that the whole design turns on. A wrong sentence reads
     oddly. A wrong photograph is a different building, and nobody can tell
     by looking that it is wrong. */
  await t.test('a match nothing corroborates may carry words but not a picture', () => {
    const cafe = { name: 'The Old Bakery', lat: 55.95, lng: -3.19, category: 'cafe' }
    const found = identify(cafe, [
      { id: 'node/7', name: 'Old Bakery', lat: 55.9501, lng: -3.1901, category: 'cafe' },
    ])
    assert.equal(found.ref, 'node/7')
    assert.equal(found.confirmedBy, null)
    assert.equal(found.mayPicture, false, 'not without something else agreeing')
  })

  await t.test('nothing near enough is nothing, not the least bad thing', () => {
    assert.equal(identify(castle, []), null)
    assert.equal(
      identify(castle, [
        { id: 'node/3', name: 'Greggs', lat: 55.9486, lng: -3.1999, category: 'bakery' },
      ]),
      null,
    )
  })

  await t.test('reads the identifiers OSM editors declared, and refuses malformed ones', () => {
    const links = declaredBy({
      wikidata: 'Q209507',
      wikipedia: 'en:Edinburgh Castle',
      wikimedia_commons: 'Category:Edinburgh Castle',
    })
    assert.deepEqual(
      links.map(link => [link.kind, link.ref]),
      [
        ['wikidata', 'Q209507'],
        ['wikipedia', 'en:Edinburgh Castle'],
        ['commons', 'Category:Edinburgh Castle'],
      ],
    )
    assert.deepEqual(declaredBy({ wikidata: 'not-an-id', wikipedia: 'no-language-prefix' }), [])
    assert.deepEqual(declaredBy({}), [])
  })
})

test('reading a Wikidata entity', async t => {
  const entity = {
    id: 'Q209507',
    labels: { en: { value: 'Edinburgh Castle' } },
    descriptions: { en: { value: 'castle in Edinburgh, Scotland' } },
    claims: {
      P18: [{ rank: 'normal', mainsnak: { datavalue: { value: 'Edinburgh Castle.jpg' } } }],
      P373: [{ rank: 'normal', mainsnak: { datavalue: { value: 'Edinburgh Castle' } } }],
      P856: [
        { rank: 'normal', mainsnak: { datavalue: { value: 'https://www.edinburghcastle.scot/' } } },
      ],
    },
    sitelinks: {
      enwiki: { title: 'Edinburgh Castle' },
      frwiki: { title: 'Château d’Édimbourg' },
      commonswiki: { title: 'Category:Edinburgh Castle' },
    },
  }

  await t.test('takes the image, the category and the official website', () => {
    const read = readEntity(entity)
    assert.equal(read.image, 'Edinburgh Castle.jpg')
    assert.equal(read.commonsCategory, 'Edinburgh Castle')
    assert.deepEqual(read.websites, ['https://www.edinburghcastle.scot/'])
  })

  /* A deprecated claim is one the community has marked as known-wrong. */
  await t.test('never reads a deprecated statement', () => {
    const read = readEntity({
      ...entity,
      claims: { P18: [{ rank: 'deprecated', mainsnak: { datavalue: { value: 'Wrong.jpg' } } }] },
    })
    assert.equal(read.image, null)
  })

  await t.test('keeps only the language wikis as articles', () => {
    const read = readEntity(entity)
    assert.deepEqual(Object.keys(read.sitelinks).sort(), ['en', 'fr'])
    assert.equal(read.sitelinks.commons, undefined, 'a Commons category is not an article')
  })

  await t.test('prefers the reader’s language, then falls back', () => {
    const read = readEntity(entity)
    assert.deepEqual(articleFor(read, ['fr', 'en']), { lang: 'fr', title: 'Château d’Édimbourg' })
    assert.deepEqual(articleFor(read, ['de']), { lang: 'en', title: 'Edinburgh Castle' })
    assert.equal(articleFor({ sitelinks: {} }, ['en']), null)
  })

  await t.test('survives an entity with nothing on it', () => {
    const read = readEntity({})
    assert.deepEqual(read, {
      id: null,
      image: null,
      commonsCategory: null,
      websites: [],
      sitelinks: {},
      label: null,
      description: null,
    })
  })
})

test('reading a Wikipedia summary', async t => {
  const summary = {
    type: 'standard',
    lang: 'en',
    extract:
      'Edinburgh Castle is a historic castle in Edinburgh, Scotland. It stands on Castle Rock, ' +
      'which has been occupied by humans since at least the Iron Age.',
    content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Edinburgh_Castle' } },
  }

  await t.test('takes the lead paragraph and says what it is under', () => {
    const read = readSummary(summary)
    assert.match(read.text, /^Edinburgh Castle is a historic castle/)
    assert.equal(read.license, 'CC BY-SA 4.0')
    assert.equal(read.sourceUrl, 'https://en.wikipedia.org/wiki/Edinburgh_Castle')
  })

  /* "Victoria" resolves to a list of forty Victorias and describes none. */
  await t.test('refuses a disambiguation page', () => {
    assert.equal(readSummary({ ...summary, type: 'disambiguation' }), null)
  })

  await t.test('refuses a list article however it was labelled', () => {
    assert.equal(
      readSummary({ ...summary, extract: 'List of castles in Scotland by region and county.' }),
      null,
    )
  })

  await t.test('refuses a stub too short to be worth a card', () => {
    assert.equal(readSummary({ ...summary, extract: 'A castle.' }), null)
    assert.equal(readSummary(null), null)
  })

  await t.test('trims to a card on a sentence, not mid-word', () => {
    const long = `${'A castle stands here. '.repeat(40)}`
    const card = trimToCard(long, 200)
    assert.ok(card.length <= 200)
    assert.ok(card.endsWith('.'), `${card} ends on a sentence`)
    assert.equal(trimToCard('Short enough.', 200), 'Short enough.')
  })
})

test('choosing photographs from Commons', async t => {
  const photo = (over = {}) => ({
    title: 'File:Edinburgh Castle.jpg',
    imageinfo: [
      {
        url: 'https://upload.wikimedia.org/…/Edinburgh_Castle.jpg',
        descriptionurl: 'https://commons.wikimedia.org/wiki/File:Edinburgh_Castle.jpg',
        mime: 'image/jpeg',
        width: 2400,
        height: 1600,
        extmetadata: {
          LicenseShortName: { value: 'CC BY-SA 4.0' },
          Artist: { value: '<a href="/wiki/User:Jane">Jane Photographer</a>' },
        },
        ...over,
      },
    ],
    ...(over.title ? { title: over.title } : {}),
  })

  await t.test('takes a freely licensed photograph and credits it', () => {
    const file = readFile(photo())
    assert.equal(file.license, 'CC BY-SA 4.0')
    assert.equal(file.author, 'Jane Photographer', 'the HTML is stripped out of the artist')
    assert.equal(file.attribution.text, 'Jane Photographer · Wikimedia Commons · CC BY-SA 4.0')
  })

  await t.test('refuses a non-free file however good it looks', () => {
    const file = readFile(photo({ extmetadata: { LicenseShortName: { value: 'Fair use' } } }))
    assert.equal(file, null)
  })

  await t.test('refuses a file with no licence stated at all', () => {
    assert.equal(readFile(photo({ extmetadata: {} })), null)
  })

  /* Freely licensed, but depicting something with its own restriction. We
     decline rather than reason about which country the reader is in. */
  await t.test('refuses a file carrying a depiction restriction', () => {
    const file = readFile(
      photo({
        extmetadata: {
          LicenseShortName: { value: 'CC BY-SA 4.0' },
          Restrictions: { value: 'trademarked' },
        },
      }),
    )
    assert.equal(file, null)
  })

  await t.test('refuses drawings, plans and coats of arms', () => {
    assert.equal(readFile({ ...photo(), title: 'File:Coat of arms of Edinburgh.png' }), null)
    assert.equal(readFile({ ...photo(), title: 'File:Edinburgh Castle plan.jpg' }), null)
    assert.equal(readFile(photo({ mime: 'image/svg+xml' })), null)
  })

  await t.test('refuses anything too small to fill a card', () => {
    assert.equal(readFile(photo({ width: LEAST_PIXELS - 1, height: 400 })), null)
  })

  await t.test('puts the widest landscape photograph first, deterministically', () => {
    const response = {
      query: {
        pages: [
          { ...photo({ width: 800, height: 600 }), title: 'File:B small.jpg' },
          { ...photo({ width: 1200, height: 2000 }), title: 'File:C portrait.jpg' },
          { ...photo({ width: 3000, height: 2000 }), title: 'File:A big.jpg' },
          {
            ...photo({ extmetadata: { LicenseShortName: { value: 'CC BY-NC 4.0' } } }),
            title: 'File:D nc.jpg',
          },
        ],
      },
    }
    const files = readFiles(response)
    assert.equal(files.length, 3, 'the non-commercial one is not among them')
    assert.deepEqual(
      files.map(file => file.width),
      [3000, 800, 1200],
      'landscape before portrait, larger before smaller',
    )
    assert.deepEqual(
      files.map(file => file.rank),
      [0, 1, 2],
    )
    assert.deepEqual(
      readFiles(response).map(f => f.url),
      files.map(f => f.url),
      'and stable',
    )
  })

  await t.test('an empty response is no pictures, not an error', () => {
    assert.deepEqual(readFiles({}), [])
    assert.deepEqual(readFiles({ query: { pages: {} } }), [])
  })
})
