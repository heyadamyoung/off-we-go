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

const osmCastle = (tags = {}) => ({
  id: 'way/1',
  name: 'Edinburgh Castle',
  lat: 55.9486,
  lng: -3.1999,
  category: 'historic',
  tags: { website: 'https://www.edinburghcastle.scot/', wikidata: 'Q209507', ...tags },
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
  osm = [osmCastle()],
  entity = ENTITY,
  summary = SUMMARY,
  files = commonsFile(),
} = {}) => {
  const asked = { osm: 0, entity: 0, summary: 0, files: 0 }
  return {
    asked,
    sources: {
      osmNear: async () => {
        asked.osm += 1
        return osm
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

    assert.equal(byKind.osm.ref, 'way/1')
    assert.equal(byKind.osm.method, 'website', 'the site agreed, so that is how')
    assert.equal(byKind.wikidata.ref, 'Q209507')
    assert.equal(byKind.wikidata.method, 'declared', 'a human wrote that tag')
    assert.equal(byKind.wikidata.score, null, 'and it is not ours to score')
  })
})

test('the half answers', async t => {
  /* The case this whole design exists for. Wikidata names a photograph and
     Commons says it is non-free. The place keeps its description. */
  await t.test('a refused licence costs the picture, not the place', async () => {
    const { sources } = sourcesOf({ files: commonsFile('Fair use') })
    const out = await enrichPlace(CASTLE, sources)

    assert.equal(out.status, READY)
    assert.equal(out.images.length, 0, 'nothing we may not show')
    assert.ok(out.description.text, 'but the words survive')
  })

  await t.test('no article falls back to Wikidata’s own line, not to nothing', async () => {
    const { sources } = sourcesOf({
      entity: { ...ENTITY, sitelinks: {} },
      summary: null,
    })
    const out = await enrichPlace(CASTLE, sources)
    assert.equal(out.status, READY)
    assert.equal(out.description.text, 'castle in Edinburgh, Scotland')
    assert.equal(out.description.source, 'Wikidata')
    assert.equal(out.description.license, 'CC0')
  })

  await t.test('a disambiguation page is not a description', async () => {
    const { sources } = sourcesOf({
      entity: { ...ENTITY, descriptions: {} },
      summary: { ...SUMMARY, type: 'disambiguation' },
    })
    const out = await enrichPlace(CASTLE, sources)
    assert.equal(out.description, null)
    assert.equal(out.status, READY, 'the picture is still worth having')
  })

  /* An OSM object with a description tag and no Wikidata link — the common
     shape for a village hall or a viewpoint. */
  await t.test('an OSM description carries a place that links to nothing', async () => {
    const { sources, asked } = sourcesOf({
      osm: [
        osmCastle({
          wikidata: undefined,
          description: 'A ruined 15th-century tower house above the glen, open to walkers.',
        }),
      ],
    })
    const out = await enrichPlace(CASTLE, sources)
    assert.equal(out.status, READY)
    assert.equal(out.description.source, 'OpenStreetMap')
    assert.equal(out.description.license, 'ODbL-1.0')
    assert.equal(asked.entity, 0, 'and Wikidata was never troubled')
  })
})

test('the places there is genuinely nothing to say about', async t => {
  /* `barren` is not a failure and must never be retried on a schedule. There
     are tens of millions of these and the queue would do nothing else. */
  await t.test('no OSM object at all is barren, not failed', async () => {
    const { sources, asked } = sourcesOf({ osm: [] })
    const out = await enrichPlace(CASTLE, sources)
    assert.equal(out.status, BARREN)
    assert.match(out.reason, /no OpenStreetMap object/)
    assert.equal(asked.entity, 0)
  })

  await t.test('an OSM object linked to nothing is barren', async () => {
    const { sources } = sourcesOf({ osm: [osmCastle({ wikidata: undefined })] })
    const out = await enrichPlace(CASTLE, sources)
    assert.equal(out.status, BARREN)
    assert.match(out.reason, /names no Wikidata/)
  })

  await t.test('an item with no words and no free picture is barren', async () => {
    const { sources } = sourcesOf({
      entity: { ...ENTITY, descriptions: {}, sitelinks: {} },
      summary: null,
      files: commonsFile('CC BY-NC 4.0'),
    })
    const out = await enrichPlace(CASTLE, sources)
    assert.equal(out.status, BARREN)
    assert.match(out.reason, /nothing licensed/)
  })
})

test('a picture needs more than a name', async t => {
  const bakery = { id: 2, name: 'The Old Bakery', lat: 55.95, lng: -3.19, category: 'cafe' }
  const osmBakery = {
    id: 'node/7',
    name: 'Old Bakery',
    lat: 55.9501,
    lng: -3.1901,
    category: 'cafe',
    tags: { wikidata: 'Q1' },
  }

  await t.test('a name-only match takes the words and leaves the photograph', async () => {
    const { sources, asked } = sourcesOf({ osm: [osmBakery] })
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
      osm: [{ ...osmBakery, tags: { wikidata: 'Q1' } }],
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
    assert.equal(out.images.length, 1)
    assert.equal(out.links[0].confirmedBy, 'website')
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
