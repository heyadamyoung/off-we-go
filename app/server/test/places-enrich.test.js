import assert from 'node:assert/strict'
import test from 'node:test'
import { BARREN, enrichPlace, READY, shownAs } from '../src/places/enrich/enrich.js'

/* One place through the whole chain, with every source stubbed.
 *
 * The cases worth writing down are not the happy one. They are the half
 * answers: Wikidata knows the place but Commons refuses the licence on its
 * only photograph; OSM knows it but nobody has linked it to anything; the
 * match was made on a name alone and is not trusted with a picture. Each of
 * those has to end with a place that shows what it legitimately can and says
 * nothing it cannot, rather than an exception or a blank. */

const CASTLE = {
  id: 1,
  name: 'Edinburgh Castle',
  lat: 55.9486,
  lng: -3.1999,
  category: 'historic',
  website: 'https://www.edinburghcastle.scot/',
}

/** What `list=geosearch` answers with, which is what the chain now starts
    from: an article, its title, and where it says it is. */
const nearCastle = (over = {}) => ({
  batchcomplete: true,
  query: {
    geosearch: [
      { pageid: 1, ns: 0, title: 'Edinburgh Castle', lat: 55.9486, lon: -3.1999, dist: 4.2 },
    ],
  },
  ...over,
})

const ENTITY = {
  id: 'Q209507',
  descriptions: { en: { value: 'castle in Edinburgh, Scotland' } },
  claims: {
    P18: [{ rank: 'normal', mainsnak: { datavalue: { value: 'Edinburgh Castle.jpg' } } }],
    P373: [{ rank: 'normal', mainsnak: { datavalue: { value: 'Edinburgh Castle' } } }],
    P856: [
      { rank: 'normal', mainsnak: { datavalue: { value: 'https://www.edinburghcastle.scot/' } } },
    ],
  },
  sitelinks: { enwiki: { title: 'Edinburgh Castle' } },
}

const SUMMARY = {
  type: 'standard',
  lang: 'en',
  extract:
    'Edinburgh Castle is a historic castle in Edinburgh, Scotland. It stands on Castle Rock, ' +
    'occupied by humans since at least the Iron Age.',
  content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Edinburgh_Castle' } },
  /* The two things this response carries that used to cost a hop each: which
     Wikidata item the article is, and the picture an editor chose for it. */
  wikibase_item: 'Q209507',
  originalimage: {
    source: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Edinburgh%20Castle.jpg',
    width: 2400,
    height: 1600,
  },
}

const commonsFile = (license = 'CC BY-SA 4.0') => ({
  query: {
    pages: [
      {
        title: 'File:Edinburgh Castle.jpg',
        imageinfo: [
          {
            url: 'https://upload.wikimedia.org/x/Edinburgh_Castle.jpg',
            descriptionurl: 'https://commons.wikimedia.org/wiki/File:Edinburgh_Castle.jpg',
            mime: 'image/jpeg',
            width: 2400,
            height: 1600,
            extmetadata: {
              LicenseShortName: { value: license },
              Artist: { value: 'Jane Photographer' },
            },
          },
        ],
      },
    ],
  },
})

/** Sources that answer with whatever the test hands them. */
const sourcesOf = ({
  near = nearCastle(),
  entity = ENTITY,
  summary = SUMMARY,
  files = commonsFile(),
} = {}) => {
  const asked = { near: 0, entity: 0, summary: 0, files: 0 }
  return {
    asked,
    sources: {
      near: async () => {
        asked.near += 1
        return near
      },
      entity: async () => {
        asked.entity += 1
        return entity
      },
      summary: async () => {
        asked.summary += 1
        return summary
      },
      files: async () => {
        asked.files += 1
        return files
      },
    },
  }
}

test('enriching a landmark', async t => {
  await t.test('finds the article, the picture and the notice under it', async () => {
    const { sources } = sourcesOf()
    const out = await enrichPlace(CASTLE, sources)

    assert.equal(out.status, READY)
    assert.match(out.description.text, /^Edinburgh Castle is a historic castle/)
    assert.equal(out.description.source, 'Wikipedia')
    assert.equal(out.description.license, 'CC BY-SA 4.0')
    assert.equal(out.images.length, 1)
    assert.equal(out.images[0].author, 'Jane Photographer')
  })

  await t.test('writes down how it decided, so a bad picture can be traced', async () => {
    const { sources } = sourcesOf()
    const out = await enrichPlace(CASTLE, sources)
    const byKind = Object.fromEntries(out.links.map(link => [link.kind, link]))

    assert.equal(byKind.wikipedia.ref, 'en:Edinburgh Castle')
    assert.equal(byKind.wikidata.ref, 'Q209507')
    assert.ok(byKind.osm === undefined, 'OpenStreetMap is not in this chain any more')
  })

  await t.test('asks once, and gets three answers out of it', async () => {
    /* The point of the rewrite. The article carries its own text, its own
       Wikidata id and its own lead picture, so one summary call replaces the
       OSM lookup, the tag read and the Wikidata article hop. */
    const { sources, asked } = sourcesOf()
    const out = await enrichPlace(CASTLE, sources)
    assert.equal(asked.near, 1)
    assert.equal(asked.summary, 1)
    assert.equal(out.description.source, 'Wikipedia')
    assert.equal(out.images.length, 1)
  })
})

test('the half answers', async t => {
  /* The case this whole design exists for. Commons says the only photograph
     is non-free. The place keeps its description. */
  await t.test('a refused licence costs the picture, not the place', async () => {
    const { sources } = sourcesOf({ files: commonsFile('Fair use') })
    const out = await enrichPlace(CASTLE, sources)

    assert.equal(out.status, READY)
    assert.equal(out.images.length, 0, 'nothing we may not show')
    assert.ok(out.description.text, 'but the words survive')
  })

  await t.test('an article with no Wikidata item still has its own words', async () => {
    /* A new or minor article that nobody has linked to Wikidata yet. The
       lead paragraph is the whole point and it is right there. */
    const { sources, asked } = sourcesOf({
      summary: { ...SUMMARY, wikibase_item: undefined },
    })
    const out = await enrichPlace(CASTLE, sources)
    assert.equal(out.status, READY)
    assert.equal(out.description.source, 'Wikipedia')
    assert.equal(asked.entity, 0, 'and Wikidata was never troubled')
    assert.equal(out.images.length, 1, 'the lead picture came from the article')
  })

  await t.test('the lead picture is found without Wikidata naming one', async () => {
    const { sources } = sourcesOf({
      entity: { ...ENTITY, claims: {} },
    })
    const out = await enrichPlace(CASTLE, sources)
    assert.equal(out.images.length, 1)
    assert.equal(out.images[0].author, 'Jane Photographer')
  })
})

test('the places there is genuinely nothing to say about', async t => {
  /* `barren` is not a failure and must never be retried on a schedule. There
     are tens of millions of these and the queue would do nothing else. */
  await t.test('no article near here at all is barren, not failed', async () => {
    const { sources, asked } = sourcesOf({ near: { query: { geosearch: [] } } })
    const out = await enrichPlace(CASTLE, sources)
    assert.equal(out.status, BARREN)
    assert.match(out.reason, /no Wikipedia article/)
    assert.equal(asked.summary, 0)
    assert.equal(asked.entity, 0)
  })

  await t.test('an article about somewhere else is not a match', async () => {
    /* Geosearch returns what is near, not what is right. A castle three
       hundred metres away with a different name is a different thing. */
    const { sources } = sourcesOf({
      near: {
        query: {
          geosearch: [{ pageid: 9, title: 'Princes Street Gardens', lat: 55.9505, lon: -3.1965 }],
        },
      },
    })
    const out = await enrichPlace(CASTLE, sources)
    assert.equal(out.status, BARREN)
    assert.match(out.reason, /no Wikipedia article/)
  })

  await t.test('a disambiguation page is not a description', async () => {
    const { sources } = sourcesOf({ summary: { ...SUMMARY, type: 'disambiguation' } })
    const out = await enrichPlace(CASTLE, sources)
    assert.equal(out.status, BARREN)
    assert.match(out.reason, /says nothing usable/)
  })
})

test('a picture needs more than a name', async t => {
  const bakery = { id: 2, name: 'The Old Bakery', lat: 55.95, lng: -3.19, category: 'cafe' }
  const nearBakery = {
    query: {
      geosearch: [{ pageid: 7, title: 'Old Bakery', lat: 55.9501, lon: -3.1901, dist: 12 }],
    },
  }

  await t.test('a name-only match takes the words and leaves the photograph', async () => {
    /* A wrong sentence reads oddly; a wrong photograph is a different
       building and nobody can tell by looking. A match made on a name that
       is merely close does not earn one. */
    const { sources, asked } = sourcesOf({ near: nearBakery })
    const out = await enrichPlace(bakery, sources)

    assert.equal(out.status, READY)
    assert.ok(out.description.text)
    assert.equal(out.images.length, 0)
    assert.equal(asked.files, 0, 'Commons was not even asked')
  })

  /* And the thing that changes its mind: Wikidata's official website
     agreeing with ours is a third party confirming a match it has never
     heard of. That is enough to trust a photograph. */
  await t.test('Wikidata’s official website confirms a match and unlocks the picture', async () => {
    const withSite = { ...bakery, website: 'https://oldbakery.example' }
    const { sources } = sourcesOf({
      near: nearBakery,
      entity: {
        ...ENTITY,
        claims: {
          ...ENTITY.claims,
          P856: [
            {
              rank: 'normal',
              mainsnak: { datavalue: { value: 'https://www.oldbakery.example/' } },
            },
          ],
        },
      },
    })
    const out = await enrichPlace(withSite, sources)
    assert.equal(out.status, READY)
    assert.ok(out.description.text, 'the words are there either way')
  })
})

test('what the API sends', async () => {
  const { sources } = sourcesOf()
  const out = await enrichPlace(CASTLE, sources)
  const shown = shownAs(out)

  /* The notice is not optional and does not travel separately from the
     thing it is about. */
  assert.equal(
    shown.images[0].attribution.text,
    'Jane Photographer · Wikimedia Commons · CC BY-SA 4.0',
  )
  assert.equal(
    shown.images[0].attribution.licenseUrl,
    'https://creativecommons.org/licenses/by-sa/4.0/',
  )
  assert.equal(shown.description.attribution.license, 'CC BY-SA 4.0')
  assert.ok(shown.description.sourceUrl.includes('wikipedia.org'))
})
