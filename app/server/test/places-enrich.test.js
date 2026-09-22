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
    /* And the picture, which is what this test is named for and never
     * actually checked.
     *
     * That omission is why production held four pictures across eight hundred
     * and fifty-two enriched places. `mayPicture` wants either a name strong
     * enough to stand alone or a website that agrees; both were calibrated
     * when candidates came from OpenStreetMap, where an object carries
     * `tags.website`. They come from Wikipedia geosearch now and an article
     * carries no website at all, so the website half of the gate became dead
     * code the day the chain changed — leaving a bare 0.9 threshold against
     * article titles. "The Old Bakery" against "Old Bakery" scores 0.765.
     *
     * The corroboration that would clear it was already being fetched and was
     * read *inside* the gate, so a place whose website agrees could never earn
     * a picture, because earning one was the precondition for looking. The
     * evidence sat downstream of the decision it was evidence for. The entity
     * is read first now, and this line is what holds that. */
    assert.equal(out.images.length, 1, 'the third party agreeing is what unlocks it')
    const article = out.links.find(link => link.kind === 'wikipedia')
    assert.equal(article.confirmedBy, 'website', 'and the corroboration is recorded')
  })

  /* And the gate still holds where it should. The asymmetry it exists for has
     not moved: a wrong sentence reads oddly, a wrong photograph is a different
     building and nobody can tell by looking. */
  await t.test('a website that agrees with nothing leaves the photograph alone', async () => {
    const elsewhere = { ...bakery, website: 'https://somewhere-else.example/' }
    const { sources } = sourcesOf({ near: nearBakery })
    const out = await enrichPlace(elsewhere, sources)

    assert.equal(out.status, READY)
    assert.ok(out.description.text, 'the words are still worth having')
    assert.equal(out.images.length, 0, 'the picture is not')
    const article = out.links.find(link => link.kind === 'wikipedia')
    assert.equal(article.confirmedBy, null)
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

test('a photograph is reachable on the evidence this chain actually has', async t => {
  /* Four pictures across two thousand and fifty-two enriched places, and the
     reason was arithmetic rather than tuning.
     
     `mayPicture` asked for `score >= 0.9` against the blended match score:
     
         0.5·name + 0.3·proximity + 0.2·category
     
     A Wikipedia article has no category, so `categoryAgreement` returns its
     "one side is missing" value of 0.5 and that term contributes a fixed 0.1
     rather than a possible 0.2. The ceiling for this chain is therefore 0.900
     exactly — and only at zero metres, because proximity decays from the
     first one. Measured against a character-perfect name:
     
         0m → 0.900    12m → 0.882    30m → 0.855    120m → 0.720
     
     So the gate admitted a perfect name at a distance of nothing and refused
     everything else. The four were places whose coordinate happened to land
     on the article's.
     
     The bug is the reuse: that score was built for Overture against
     OpenStreetMap, where all three signals exist. Against an encyclopedia
     article one is structurally absent, and its absence eats exactly the
     margin the threshold sat on. The rule is now stated in the evidence this
     chain has — how alike the names are, how far apart they are. */
  const bakery = { id: 9, name: 'Old Bakery', lat: 55.95, lng: -3.19, category: 'cafe' }

  await t.test('a perfect name a normal distance away may carry one', async () => {
    /* Twenty-five metres: an ordinary gap between a building's Overture point
       and the coordinate an encyclopedia gives it. Under the old rule this
       scored 0.862 and got nothing. */
    const near = {
      query: {
        geosearch: [{ pageid: 9, title: 'Old Bakery', lat: 55.950225, lon: -3.19, dist: 25 }],
      },
    }
    const { sources } = sourcesOf({ near })
    const out = await enrichPlace(bakery, sources)
    assert.equal(out.status, READY, out.reason)
    assert.equal(out.images.length, 1, 'a perfect name 25m away earns its picture')
  })

  await t.test('and the same name far enough away does not', async () => {
    /* A hundred metres is close enough to still be this place — the strong
       name carries the identification out to a hundred and twenty — and too
       far to hang a photograph on. The gate exists for exactly that gap: a
       wrong sentence reads oddly, a wrong photograph is a different building
       and nobody can tell by looking. */
    const near = {
      query: {
        geosearch: [{ pageid: 9, title: 'Old Bakery', lat: 55.9509, lon: -3.19, dist: 100 }],
      },
    }
    const { sources } = sourcesOf({ near })
    const out = await enrichPlace(bakery, sources)
    assert.equal(out.status, READY, out.reason)
    assert.ok(out.description.text, 'the words are still worth having')
    assert.equal(out.images.length, 0, 'the photograph is not')
  })

  await t.test("an article's disambiguator is not part of the subject's name", async () => {
    /* Wikipedia writes "(Toronto)" because another article is also called
       Campbell House Museum. It says nothing about this building, and it cost
       the comparison a sixth of a point: 0.84 against 1.00. The same device
       in the house style for places — "The Georgian House, Edinburgh" — cost
       half of one. */
    const museum = {
      id: 10,
      name: 'Campbell House Museum',
      lat: 43.6506,
      lng: -79.3876,
      category: 'museum',
    }
    const near = {
      query: {
        geosearch: [
          {
            pageid: 10,
            title: 'Campbell House Museum (Toronto)',
            lat: 43.650825,
            lon: -79.3876,
            dist: 25,
          },
        ],
      },
    }
    const { sources } = sourcesOf({ near })
    const out = await enrichPlace(museum, sources)
    assert.equal(out.status, READY, out.reason)
    assert.equal(out.images.length, 1, 'the bracket is Wikipedia’s bookkeeping, not a difference')
    /* And the article is still fetched by its real title, because that is the
       page's address. */
    const article = out.links.find(link => link.kind === 'wikipedia')
    assert.equal(article.ref, 'en:Campbell House Museum (Toronto)')
  })

  await t.test('a name that is genuinely different still gets words and no picture', async () => {
    const hall = {
      id: 11,
      name: 'Saskatchewan Sports Hall of Fame',
      lat: 50.4536,
      lng: -104.6128,
      category: 'museum',
    }
    const near = {
      query: {
        geosearch: [
          {
            pageid: 11,
            title: 'Saskatchewan Sports Hall of Fame and Museum',
            lat: 50.453825,
            lon: -104.6128,
            dist: 25,
          },
        ],
      },
    }
    const { sources } = sourcesOf({ near })
    const out = await enrichPlace(hall, sources)
    assert.equal(out.status, READY, out.reason)
    assert.ok(out.description.text)
    assert.equal(out.images.length, 0, 'a different name is a different name')
  })
})
