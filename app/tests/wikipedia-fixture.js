/* Amsterdam, as Wikipedia would answer it.
 *
 * Four of these tests used to call the real API. That is not a test of this
 * app — it is a test of Wikipedia's uptime, of its rate limiter (its own
 * comment in the suite admitted "the public API throttles concurrent callers"),
 * and of whether the machine running the suite has the open internet. All
 * three failed here, permanently, and a suite with a permanently red corner is
 * a suite nobody reads.
 *
 * So the API is answered from here instead, in the shapes the client actually
 * asks for: a geosearch that returns nearby articles, and a page query that
 * returns their descriptions, extracts and thumbnails. Real landmarks with
 * real coordinates, so what the map draws is still worth looking at.
 */

const LANDMARKS = [
  {
    pageid: 173321,
    title: 'Rijksmuseum',
    lat: 52.36,
    lon: 4.8852,
    description: 'National museum of the Netherlands in Amsterdam',
    extract:
      'The Rijksmuseum is the national museum of the Netherlands, dedicated to Dutch arts ' +
      'and history, and is located in Amsterdam.',
    views: 42000,
  },
  {
    pageid: 189568,
    title: 'Anne Frank House',
    lat: 52.3752,
    lon: 4.8839,
    description: 'Biographical museum in Amsterdam dedicated to Anne Frank',
    extract:
      'The Anne Frank House is a writer’s house and biographical museum dedicated to the ' +
      'Jewish wartime diarist Anne Frank.',
    views: 38000,
  },
  {
    pageid: 431021,
    title: 'Van Gogh Museum',
    lat: 52.3584,
    lon: 4.8811,
    description: 'Art museum in Amsterdam dedicated to Vincent van Gogh',
    extract:
      'The Van Gogh Museum is an art museum dedicated to the works of Vincent van Gogh and ' +
      'his contemporaries.',
    views: 31000,
  },
  {
    pageid: 555102,
    title: 'Westerkerk',
    lat: 52.3747,
    lon: 4.8836,
    description: 'Protestant church in Amsterdam',
    extract: 'The Westerkerk is a Reformed church within Dutch Protestant Calvinism in Amsterdam.',
    views: 12000,
  },
  {
    pageid: 660433,
    title: 'Vondelpark',
    lat: 52.3579,
    lon: 4.8686,
    description: 'Public urban park in Amsterdam',
    extract: 'The Vondelpark is a public urban park of 47 hectares in Amsterdam, Netherlands.',
    views: 9000,
  },
  {
    pageid: 720981,
    title: 'Amsterdam Centraal station',
    lat: 52.379,
    lon: 4.9003,
    description: 'Main railway station of Amsterdam',
    extract: 'Amsterdam Centraal is the largest railway station of Amsterdam, opened in 1889.',
    views: 15000,
  },
]

/* A one-pixel PNG, so a thumbnail resolves without the test reaching for a
   picture on somebody else's server. */
const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z' +
  '8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const pageOf = (place, month) => ({
  pageid: place.pageid,
  ns: 0,
  title: place.title,
  description: place.description,
  extract: place.extract,
  fullurl: `https://en.wikipedia.org/?curid=${place.pageid}`,
  coordinates: [{ lat: place.lat, lon: place.lon, primary: '' }],
  thumbnail: { source: PIXEL, width: 1, height: 1 },
  pageimage: `${place.title.replace(/\s+/g, '_')}.jpg`,
  pageprops: { page_image_free: `${place.title.replace(/\s+/g, '_')}.jpg` },
  pageviews: { [month]: place.views },
})

/** What the API would say, for whichever of its shapes was asked for. */
export function wikipediaAnswer(url) {
  const query = new URL(url).searchParams
  const month = `${new Date().toISOString().slice(0, 7)}-01`
  const near = LANDMARKS.map(place => ({
    pageid: place.pageid,
    ns: 0,
    title: place.title,
    lat: place.lat,
    lon: place.lon,
    dist: 120,
    primary: '',
  }))
  const pages = Object.fromEntries(
    LANDMARKS.map(place => [String(place.pageid), pageOf(place, month)]),
  )

  // Coordinates only, unfiltered — the cheap first pass.
  if (query.get('list') === 'geosearch') return { batchcomplete: '', query: { geosearch: near } }
  // Everything else asks for pages, whether by generator or by id.
  return { batchcomplete: '', query: { pages } }
}

/** Answer every Wikipedia call in this page with the fixture above. */
export async function serveWikipedia(page) {
  await page.route('https://en.wikipedia.org/**', route =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(wikipediaAnswer(route.request().url())),
    }),
  )
}
