import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { callsignFor, readAircraft, verdictFromPosition } from '../src/flights/providers/adsb.js'
import {
  clockInMessage,
  createDublinProvider,
  parseDublinBoard,
  readDublinStatus,
} from '../src/flights/providers/dublin.js'
import {
  createPearsonProvider,
  parsePearsonBoard,
  pearsonDayFor,
  readPearsonStatus,
} from '../src/flights/providers/pearson.js'
import { createReginaProvider, parseReginaBoard } from '../src/flights/providers/regina.js'
import { createFlightSources } from '../src/flights/registry.js'

/* The parsers, against what the boards actually served. Every fixture here
   is a recorded response: Dublin's JSON from api.dublinairport.com and
   Regina's XML from its display vendor, fetched by the source probe on a
   runner with open internet on 17 September 2026. A parser that only ever
   met a hand-written sample is a parser that meets the real thing in
   production. */

const fixture = name => readFileSync(new URL(`./fixtures/flights/${name}`, import.meta.url), 'utf8')
const AT = '2026-09-17T22:33:00.000Z'

test('Regina: the display feed becomes rows with Regina wall-clock times as instants', () => {
  const departures = parseReginaBoard(fixture('regina-departures.xml'), 'departure', {
    fetchedAt: AT,
  })
  const arrivals = parseReginaBoard(fixture('regina-arrivals.xml'), 'arrival', { fetchedAt: AT })
  assert.equal(departures.length, 40)
  assert.equal(arrivals.length, 39)

  const first = departures[0]
  assert.equal(first.flightNumber, 'WS3375')
  assert.equal(first.carrierCode, 'WS')
  assert.equal(first.carrierName, 'WestJet')
  assert.equal(first.airportCode, 'YQR')
  assert.equal(first.origin, 'YQR')
  assert.equal(first.destination, 'YYC')
  assert.equal(first.destinationName, 'Calgary')
  // SCHEDTIME 16:15 and TIME 16:26 in Regina are 22:15Z and 22:26Z.
  assert.equal(first.scheduledDeparture, '2026-09-17T22:15:00.000Z')
  assert.equal(first.estimatedDeparture, '2026-09-17T22:26:00.000Z')
  assert.equal(first.actualDeparture, null)
  assert.equal(first.gate, '4')
  assert.equal(first.status, 'scheduled', 'the board says On Time, and the board decides')
  assert.equal(first.statusText, 'On Time')
  assert.equal(first.source, 'yqr.simpleway.cloud')
  assert.equal(first.lastUpdated, AT)

  /* By the time this copy was taken the day's WS3364 had arrived and gone
     from the feed, and tomorrow's had taken its place — with the belt
     already assigned. */
  const tomorrow = arrivals.find(row => row.flightNumber === 'WS3364')
  assert.equal(tomorrow.direction, 'arrival')
  assert.equal(tomorrow.origin, 'YYC')
  assert.equal(tomorrow.originName, 'Calgary')
  assert.equal(tomorrow.destination, 'YQR')
  assert.equal(tomorrow.status, 'scheduled')
  assert.equal(tomorrow.baggageBelt, '1')
  assert.equal(tomorrow.scheduledArrival, '2026-09-18T21:40:00.000Z')
  assert.equal(tomorrow.estimatedArrival, '2026-09-18T21:40:00.000Z')
  assert.equal(tomorrow.actualArrival, null)

  const delayed = arrivals.find(row => row.status === 'delayed')
  assert.ok(delayed, 'the feed carried one Delayed arrival that evening')
  assert.equal(delayed.statusText, 'Delayed')
})

/* One row in the vendor's shape, as the first probe saw the day's WS3364
   half an hour after it arrived, before the feed dropped it. */
const ARRIVED_ROW = `<?xml version="1.0"?>
<MAIN><FLIGHTS>
  <FLIGHT DISPLAY="WS3364">
    <DISPLAY>WS3364</DISPLAY>
    <CARRIER><NAME>WestJet</NAME><ABBREV>WS</ABBREV></CARRIER>
    <NUMBER>3364</NUMBER>
    <CODESHARES><CODESHARE>DL7212</CODESHARE></CODESHARES>
    <SCHEDDATE YEAR="2026" MONTH="09" DAY="17"></SCHEDDATE>
    <MODE TYPE="A"></MODE>
    <DATE YEAR="2026" MONTH="09" DAY="17"></DATE>
    <TIME HOUR="15" MIN="54"></TIME>
    <SCHEDTIME HOUR="15" MIN="40"></SCHEDTIME>
    <GATE></GATE><BRIDGE></BRIDGE><TERMINAL></TERMINAL>
    <CAROUSEL>1</CAROUSEL>
    <STATUS>Arrived</STATUS>
    <COMMENT>Bags &amp; belts</COMMENT><OPERATE></OPERATE>
    <CITIES>Calgary</CITIES>
    <CITYCODES><CITYCODE IATA="YYC" CITYTEMP="" CITYWTR="" CITYWTRTEXT="">Calgary</CITYCODE></CITYCODES>
    <AIRCRAFT>DH8D</AIRCRAFT>
  </FLIGHT>
  <FLIGHT DISPLAY="AC8193">
    <DISPLAY>AC8193</DISPLAY>
    <CARRIER><NAME>Air Canada</NAME><ABBREV>AC</ABBREV></CARRIER>
    <NUMBER>8193</NUMBER><CODESHARES></CODESHARES>
    <SCHEDDATE YEAR="2026" MONTH="09" DAY="17"></SCHEDDATE>
    <MODE TYPE="D"></MODE>
    <DATE YEAR="2026" MONTH="09" DAY="17"></DATE>
    <TIME HOUR="17" MIN="40"></TIME><SCHEDTIME HOUR="17" MIN="40"></SCHEDTIME>
    <GATE>3</GATE><BRIDGE></BRIDGE><TERMINAL></TERMINAL><CAROUSEL></CAROUSEL>
    <STATUS>On Time</STATUS><COMMENT></COMMENT><OPERATE></OPERATE>
    <CITIES>Vancouver</CITIES>
    <CITYCODES><CITYCODE IATA="YVR">Vancouver</CITYCODE></CITYCODES>
    <AIRCRAFT></AIRCRAFT>
  </FLIGHT>
</FLIGHTS></MAIN>`

test('Regina: an arrived flight’s TIME is the actual, a departure on the arrivals feed is skipped', () => {
  const rows = parseReginaBoard(ARRIVED_ROW, 'arrival', { fetchedAt: AT })
  assert.equal(rows.length, 1, 'the MODE D row does not belong on the arrivals side')
  const [landed] = rows
  assert.equal(landed.status, 'arrived')
  assert.equal(landed.actualArrival, '2026-09-17T21:54:00.000Z')
  assert.equal(landed.estimatedArrival, null)
  assert.equal(landed.scheduledArrival, '2026-09-17T21:40:00.000Z')
  assert.equal(landed.baggageBelt, '1')
  assert.equal(landed.aircraft, 'DH8D')
  assert.deepEqual(landed.codeshares, ['DL7212'])
  assert.deepEqual(landed.extra, { comment: 'Bags & belts', bridge: null, operator: null })
  assert.equal(parseReginaBoard(ARRIVED_ROW, 'departure')[0].flightNumber, 'AC8193')
})

test('Regina: a feed that is not the feed fails loudly rather than parsing to nothing', async () => {
  assert.deepEqual(parseReginaBoard('<html>maintenance</html>', 'departure'), [])
  const fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => '<html>maintenance</html>',
  })
  const provider = createReginaProvider({ fetch })
  await assert.rejects(provider.departures(), /parsed to nothing/)
  const down = createReginaProvider({
    fetch: async () => ({ ok: false, status: 503, text: async () => '' }),
  })
  await assert.rejects(down.arrivals(), /answered 503/)
})

test('Regina: the provider reads the departure feed for departures and the arrivals feed for arrivals', async () => {
  const asked = []
  const fetch = async url => {
    asked.push(url)
    return {
      ok: true,
      status: 200,
      text: async () =>
        fixture(url.includes('departure') ? 'regina-departures.xml' : 'regina-arrivals.xml'),
    }
  }
  const provider = createReginaProvider({ fetch, now: () => Date.parse(AT) })
  assert.equal((await provider.departures()).length, 40)
  assert.equal((await provider.arrivals()).length, 39)
  assert.deepEqual(asked, [
    'https://yqr.simpleway.cloud/data-feed/public/departure-web',
    'https://yqr.simpleway.cloud/data-feed/public/arrivals-web',
  ])
})

test('Dublin: the listing becomes rows, statuses in one vocabulary with the board’s words kept', () => {
  const evening = parseDublinBoard(
    JSON.parse(fixture('dublin-departures-evening.json')),
    'departure',
  )
  assert.equal(evening.length, 2)
  const [delayed, boarding] = evening
  assert.equal(delayed.flightNumber, 'FR457')
  assert.equal(delayed.destination, 'LBA')
  assert.equal(delayed.destinationName, 'Leeds Bradford')
  assert.equal(delayed.origin, 'DUB')
  assert.equal(delayed.status, 'delayed')
  assert.equal(delayed.statusText, 'DELAYED')
  assert.equal(delayed.terminal, '1', 'T1 becomes 1')
  assert.equal(delayed.gate, '106')
  assert.equal(delayed.scheduledDeparture, '2026-09-17T22:35:00.000Z')
  assert.equal(delayed.lastUpdated, '2026-09-17T22:33:32.648Z', 'the listing’s own stamp')
  assert.deepEqual(delayed.extra, {
    internalFlightId: 'FR457-20260917',
    statusCode: 3,
    checkinZone: '13',
    checkinDeskRange: '1204-1319',
    goToGateTime: '2026-09-17T23:05:00.000Z',
    walkMinutes: 10,
  })
  assert.equal(boarding.status, 'boarding')
  assert.equal(boarding.boardingStatus, 'boarding')
  assert.equal(boarding.statusText, 'NOW BOARDING')
  assert.equal(boarding.estimatedDeparture, '2026-09-17T22:50:00.000Z')
})

test('Dublin: arrivals carry the belt, and "LANDED AT 23:28" is the touchdown in Dublin’s clock', () => {
  const arrivals = parseDublinBoard(JSON.parse(fixture('dublin-arrivals-evening.json')), 'arrival')
  assert.equal(arrivals.length, 24)
  const landed = arrivals.find(row => row.flightNumber === 'FR557')
  assert.equal(landed.status, 'landed')
  assert.equal(landed.statusText, 'LANDED AT 23:28')
  assert.equal(landed.actualArrival, '2026-09-17T22:28:00.000Z', 'Irish summer time, made UTC')
  assert.equal(
    landed.estimatedArrival,
    '2026-09-17T22:35:00.000Z',
    'the on-blocks estimate goes on beside it',
  )
  assert.equal(landed.baggageBelt, '10')
  assert.equal(landed.origin, 'MAN')
  assert.equal(landed.destination, 'DUB')

  const late = arrivals.find(row => row.flightNumber === 'FR3087')
  assert.equal(late.status, 'delayed')
  assert.equal(late.scheduledArrival, '2026-09-17T22:40:00.000Z')
  assert.equal(late.estimatedArrival, '2026-09-17T23:45:00.000Z')
  assert.equal(late.baggageBelt, '5')

  const onTime = arrivals.find(row => row.statusText === 'ON SCHEDULE')
  assert.equal(onTime.status, 'scheduled')
  const shared = arrivals.find(row => row.codeshares.length)
  assert.deepEqual(shared.codeshares, ['AA8097'])
})

test('Dublin: a full day parses whole, charters aside, and a cancellation is a cancellation', () => {
  const body = JSON.parse(fixture('dublin-departures-full-day.json'))
  const day = parseDublinBoard(body, 'departure')
  assert.equal(day.length, 198, 'two hundred records, two of them a three-letter charter code')
  assert.ok(
    day.every(row => row.status === 'scheduled'),
    'the day before, everything is on schedule',
  )
  assert.ok(day.every(row => row.terminal === '1' || row.terminal === '2'))
  assert.ok(
    day.some(row => row.codeshares.length > 3),
    'long-haul departures carry many codeshares',
  )
  assert.ok(
    day.every(row => row.gate === null),
    'gates are not assigned the day before',
  )

  /* The one cancellation that day was a charter, which the number rule
     drops; the same record under an airline's number is a cancellation. */
  const charter = body.content.find(record => record.statusMessage === 'CANCELLED')
  assert.equal(charter.flightIdentity, 'SIG108')
  const [cancelled] = parseDublinBoard(
    { ...body, content: [{ ...charter, flightIdentity: 'EI999', carrierCode: 'EI' }] },
    'departure',
  )
  assert.equal(cancelled.status, 'cancelled')
  assert.equal(cancelled.statusText, 'CANCELLED')
  assert.equal(cancelled.extra.statusCode, 4)
})

test('Dublin: the words decide the status, and the delayed flag outranks a word that says nothing about time', () => {
  assert.deepEqual(readDublinStatus({ statusMessage: 'GO TO GATE' }), {
    status: 'scheduled',
    boardingStatus: 'go-to-gate',
  })
  assert.deepEqual(readDublinStatus({ statusMessage: 'GO TO GATE', isDelayed: true }), {
    status: 'delayed',
    boardingStatus: 'go-to-gate',
  })
  assert.deepEqual(readDublinStatus({ statusMessage: 'FINAL CALL' }), {
    status: 'boarding',
    boardingStatus: 'final-call',
  })
  assert.deepEqual(readDublinStatus({ statusMessage: 'GATE CLOSED' }), {
    status: 'gate-closed',
    boardingStatus: 'closed',
  })
  assert.deepEqual(readDublinStatus({ statusMessage: 'DEPARTED AT 22:41' }), {
    status: 'departed',
    boardingStatus: null,
  })
  assert.deepEqual(readDublinStatus({ statusMessage: 'DIVERTED' }), {
    status: 'diverted',
    boardingStatus: null,
  })
  assert.deepEqual(readDublinStatus({ statusMessage: 'SOMETHING NEW' }), {
    status: 'unknown',
    boardingStatus: null,
  })
  assert.deepEqual(readDublinStatus({}), { status: 'unknown', boardingStatus: null })
  assert.equal(
    clockInMessage('LANDED AT 00:10', '2026-09-17T22:55:00.000Z'),
    '2026-09-17T23:10:00.000Z',
    'just after midnight files with the evening it belongs to',
  )
  assert.equal(clockInMessage('DELAYED', '2026-09-17T22:55:00.000Z'), null)
})

test('Dublin: the provider walks the day forward a page at a time, the way the site does, and never loops', async () => {
  const asked = []
  const page = (from, hasNext, hasPrevious = false) => ({
    content: [
      {
        internalFlightId: `EI${from}-20260918`,
        flightIdentity: `EI${from}`,
        airportCode: 'LHR',
        carrierCode: 'EI',
        carrierName: 'Aer Lingus',
        scheduledDateTime: `2026-09-18T${String(from).padStart(2, '0')}:00:00.000Z`,
        status: 0,
        statusMessage: 'ON SCHEDULE',
        terminalName: 'T2',
        codeShares: [],
      },
    ],
    pagination: {
      hasNext,
      hasPrevious,
      earliestTimestamp: `2026-09-18T${String(from).padStart(2, '0')}:00:00.000Z`,
      latestTimestamp: `2026-09-18T${String(from).padStart(2, '0')}:00:00.000Z`,
      earliestId: String(1000 + from),
      latestId: String(1000 + from),
    },
    lastUpdated: '2026-09-18T05:00:00.000Z',
  })
  const fetch = async url => {
    asked.push(url)
    const query = new URL(url).searchParams
    const after = query.get('after')
    const hour = after ? Number(after.slice(11, 13)) + 1 : 6
    return { ok: true, status: 200, json: async () => page(hour, hour < 8) }
  }
  const provider = createDublinProvider({
    fetch,
    now: () => Date.parse('2026-09-18T05:00:00.000Z'),
  })
  const rows = await provider.departures('2026-09-18')
  assert.deepEqual(
    rows.map(row => row.flightNumber),
    ['EI6', 'EI7', 'EI8'],
  )
  assert.equal(asked.length, 3)
  assert.match(asked[1], /after=2026-09-18T06%3A00%3A00\.000Z&after-id=1006/)
  assert.ok(
    asked.every(url =>
      url.startsWith(
        'https://api.dublinairport.com/dap/flight-listing/departures?date=2026-09-18&limit=200',
      ),
    ),
  )

  /* A paginator that always says next stops at the ceiling. */
  const endless = createDublinProvider({
    fetch: async () => ({ ok: true, status: 200, json: async () => page(6, true) }),
  })
  assert.equal(
    (await endless.arrivals('2026-09-18')).length,
    1,
    'the same row on every page is one row',
  )
})

test('Dublin: the provider says what went wrong, by name', async () => {
  const provider = createDublinProvider({
    fetch: async () => ({ ok: false, status: 429, json: async () => ({}) }),
  })
  await assert.rejects(provider.departures('2026-09-18'), /api\.dublinairport\.com answered 429/)
  const shapeless = createDublinProvider({
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ message: 'changed' }) }),
  })
  await assert.rejects(shapeless.departures('2026-09-18'), /no content array/)
})

/* The first row the probe read off the GTAA's list on 17 September 2026,
   verbatim: a cancelled American departure sold under three other numbers. */
const PEARSON_ROW = {
  key: 'A0916AAL1111YYZDFW',
  id: 'AAL1111',
  id2: 'AA1111',
  type: 'DEP',
  schTime: '2026-09-16T18:15:00-04:00',
  latestTm: '2026-09-17T07:00:00-04:00',
  gate: 'A10',
  status: 'CAN',
  term: 'T3',
  al: 'American Airlines',
  alCode: 'AAL',
  ids: [
    { id: 'POE6046', id2: 'PD6046', alName: 'Porter Airlines' },
    { id: 'QFA4371', id2: 'QF4371', alName: 'Qantas' },
    { id: 'QTR2334', id2: 'QR2334', alName: 'Qatar Airways' },
  ],
  routes: [
    {
      code: 'DFW',
      name: 'Dallas Fort Worth International Airport',
      short: '',
      city: 'Dallas-Fort Worth',
      cnty: 'USA',
      region: '',
    },
  ],
  carousel: null,
  termzone: 'USA',
  svctype: 'J',
  aisle: null,
  zone: '169-182',
  stand: 'B10',
}

test('Pearson: the list becomes rows, with the IATA number, the codeshares and the times as instants', () => {
  const body = {
    lastUpdate: '2026-09-17T18:59:30-04:00',
    serverTime: '2026-09-17T19:00:01-04:00',
    today: '2026-09-17',
    tomorrow: '2026-09-18',
    yesterday: '2026-09-16',
    list: [
      PEARSON_ROW,
      { ...PEARSON_ROW, type: 'ARR', id2: 'AC873', id: 'ACA873', status: 'LND', carousel: '7' },
    ],
  }
  const rows = parsePearsonBoard(body, 'departure', { fetchedAt: AT })
  assert.equal(rows.length, 1, 'the arrival row is not on the departures side')
  const [row] = rows
  assert.equal(row.flightNumber, 'AA1111')
  assert.equal(row.carrierCode, 'AA')
  assert.equal(row.carrierName, 'American Airlines')
  assert.equal(row.origin, 'YYZ')
  assert.equal(row.destination, 'DFW')
  assert.equal(row.destinationName, 'Dallas-Fort Worth')
  assert.equal(
    row.scheduledDeparture,
    '2026-09-16T22:15:00.000Z',
    'the list’s own offset, honoured',
  )
  assert.equal(row.estimatedDeparture, '2026-09-17T11:00:00.000Z')
  assert.equal(row.status, 'cancelled')
  assert.equal(row.statusText, 'Cancelled', 'the code, said as the board says it')
  assert.equal(row.terminal, '3')
  assert.equal(row.gate, 'A10')
  assert.equal(row.baggageBelt, null)
  assert.deepEqual(row.codeshares, ['PD6046', 'QF4371', 'QR2334'])
  assert.equal(row.lastUpdated, '2026-09-17T22:59:30.000Z', 'the list’s own stamp')
  assert.deepEqual(row.extra, {
    key: 'A0916AAL1111YYZDFW',
    icao: 'AAL1111',
    stand: 'B10',
    checkinDeskRange: '169-182',
    region: 'USA',
    serviceType: 'J',
    farAirportName: 'Dallas Fort Worth International Airport',
  })

  const [landed] = parsePearsonBoard(body, 'arrival', { fetchedAt: AT })
  assert.equal(landed.flightNumber, 'AC873')
  assert.equal(landed.status, 'landed')
  assert.equal(
    landed.actualArrival,
    '2026-09-17T11:00:00.000Z',
    'a landed flight’s latest time is the actual',
  )
  assert.equal(landed.baggageBelt, '7')
  assert.deepEqual(parsePearsonBoard({ unexpected: true }, 'departure'), [])
})

test('Pearson: a code the list has not been seen to use is kept as its code and reported unknown', () => {
  assert.deepEqual(readPearsonStatus('BRD'), { status: 'boarding', boardingStatus: 'boarding' })
  assert.deepEqual(readPearsonStatus('Departed'), { status: 'departed', boardingStatus: null })
  assert.deepEqual(readPearsonStatus('XYZ'), { status: 'unknown', boardingStatus: null })
  assert.deepEqual(readPearsonStatus(''), { status: 'unknown', boardingStatus: null })
})

test('Pearson: the list knows three days by Toronto’s calendar, and a captcha is reported as one', async () => {
  const now = Date.parse('2026-09-17T23:30:00.000Z') // 19:30 in Toronto, still the 17th
  assert.equal(pearsonDayFor('2026-09-17', now), 'today')
  assert.equal(pearsonDayFor('2026-09-18', now), 'tomorrow')
  assert.equal(pearsonDayFor('2026-09-16', now), 'yesterday')
  assert.equal(pearsonDayFor('2026-09-20', now), null)
  assert.equal(pearsonDayFor(null, now), 'today')

  const asked = []
  const provider = createPearsonProvider({
    fetch: async (url, options) => {
      asked.push({ url, headers: options.headers })
      return {
        ok: true,
        status: 200,
        challenged: false,
        json: async () => ({ list: [PEARSON_ROW] }),
      }
    },
    now: () => now,
  })
  assert.equal(provider.configured, true)
  assert.equal((await provider.departures('2026-09-17')).length, 1)
  assert.deepEqual(
    await provider.departures('2026-09-25'),
    [],
    'a day the list does not know is empty, not an error',
  )
  assert.equal(asked.length, 1)
  assert.equal(
    asked[0].url,
    'https://www.torontopearson.com/api/flightsapidata/getflightlist?type=DEP&day=today&useScheduleTimeOnly=false',
  )
  assert.equal(asked[0].headers.referer, 'https://www.torontopearson.com/en/departures')

  const challenged = createPearsonProvider({
    fetch: async () => ({ ok: false, status: 302, challenged: true, json: async () => ({}) }),
  })
  await assert.rejects(challenged.arrivals(), /asked for a captcha/)
  const shapeless = createPearsonProvider({
    fetch: async () => ({
      ok: true,
      status: 200,
      challenged: false,
      json: async () => ({ html: true }),
    }),
  })
  await assert.rejects(shapeless.departures(), /no list array/)
})

test('ADS-B: a callsign is the ICAO code and the number, and a position is a verdict', () => {
  assert.equal(callsignFor('AC872'), 'ACA872')
  assert.equal(callsignFor('FR457'), 'RYR457')
  assert.equal(callsignFor('ZZ1'), null)
  /* The carriers that fly an airline's numbers file their own callsigns. */
  assert.equal(callsignFor('AC8123'), 'JZA8123')
  assert.equal(callsignFor('AC7501'), 'JZA7501')
  assert.equal(callsignFor('AC1938'), 'ROU1938')
  assert.equal(callsignFor('WS3412'), 'WEN3412')
  assert.equal(callsignFor('KL1234'), 'KLC1234')
  assert.equal(callsignFor('KL677'), 'KLM677')
  assert.equal(callsignFor('EI3211'), 'EAI3211')
  const airborne = readAircraft(
    {
      hex: '4caa58',
      flight: 'RYR37MH ',
      r: 'EI-EVS',
      t: 'B738',
      alt_baro: 20525,
      gs: 402.5,
      lat: 53.166,
      lon: -7.444,
      seen: 0,
    },
    { now: Date.parse(AT) },
  )
  assert.equal(airborne.callsign, 'RYR37MH')
  assert.equal(airborne.airborne, true)
  assert.equal(airborne.onGround, false)
  assert.equal(airborne.heardAt, AT)
  const parked = readAircraft({ hex: 'abc', alt_baro: 'ground', lat: 43.68, lon: -79.62, seen: 12 })
  assert.equal(parked.onGround, true)
  assert.equal(parked.airborne, false)
  const yyz = { lat: 43.6777, lon: -79.6248 }
  const dub = { lat: 53.4213, lon: -6.2701 }
  assert.equal(verdictFromPosition(airborne, { from: yyz, to: dub }), 'departed')
  assert.equal(verdictFromPosition(parked, { from: dub, to: yyz }), 'landed')
  assert.equal(
    verdictFromPosition(parked, { from: yyz, to: dub }),
    null,
    'on the ground at the origin is nothing yet',
  )
  assert.equal(verdictFromPosition(null, { from: yyz, to: dub }), null)
})

test('the registry knows three airports, and reads each board through one cache', async () => {
  let fetches = 0
  const fetch = async url => {
    fetches += 1
    if (url.includes('simpleway')) {
      return { ok: true, status: 200, text: async () => fixture('regina-departures.xml') }
    }
    return {
      ok: true,
      status: 200,
      json: async () => JSON.parse(fixture('dublin-arrivals-evening.json')),
    }
  }
  const http = async () => ({
    ok: true,
    status: 200,
    challenged: false,
    json: async () => ({ list: [PEARSON_ROW] }),
  })
  const sources = createFlightSources({ fetch, http, now: () => Date.parse(AT) })
  assert.deepEqual(
    sources.airports().map(one => [one.code, one.configured]),
    [
      ['DUB', true],
      ['YQR', true],
      ['YYZ', true],
    ],
  )
  const first = await sources.board('yqr', 'departure')
  const again = await sources.board('YQR', 'departure')
  assert.equal(first.value.length, 40)
  assert.equal(again.value, first.value)
  assert.equal(fetches, 1, 'the second read is the cache')
  const dublin = await sources.board('DUB', 'arrival', '2026-09-17')
  assert.equal(dublin.value.length, 24)
  assert.equal(await sources.board('LHR', 'arrival'), null)
  const pearson = await sources.board('YYZ', 'departure', '2026-09-17')
  assert.equal(pearson.value.length, 1, 'read through the browser-like client, not fetch')
  assert.equal(pearson.value[0].source, 'www.torontopearson.com')
  assert.equal(sources.health()['www.torontopearson.com'].failures, 0)
  /* Regina once, Dublin's first page and the two it walks back from a
     listing that says it has earlier flights; Pearson never through fetch. */
  assert.equal(fetches, 4)
})

test('Pearson: a whole day off the list, as served on 17 September 2026', () => {
  const body = JSON.parse(fixture('pearson-departures.json'))
  const rows = parsePearsonBoard(body, 'departure', { fetchedAt: AT })
  assert.equal(rows.length, 522)
  const statuses = {}
  for (const row of rows) statuses[row.status] = (statuses[row.status] || 0) + 1
  assert.deepEqual(statuses, { cancelled: 16, departed: 373, delayed: 27, scheduled: 106 })
  assert.ok(rows.every(row => row.terminal === '1' || row.terminal === '3'))
  assert.equal(rows.filter(row => row.gate).length, 519)
  assert.equal(
    rows[0].lastUpdated,
    '2026-09-17T23:00:00.029Z',
    'the list’s stamp, with its seven fractional digits, still parses',
  )
  const departed = rows.find(row => row.flightNumber === 'BA98')
  assert.equal(departed.status, 'departed')
  assert.equal(departed.scheduledDeparture, '2026-09-17T02:00:00.000Z')
  assert.equal(
    departed.actualDeparture,
    '2026-09-17T04:17:00.000Z',
    'a departed flight’s latest time is the actual',
  )
  assert.equal(departed.estimatedDeparture, null)
  assert.deepEqual(departed.codeshares, ['AY5998', 'EI8798', 'IB3532', 'AA6921'])
  assert.equal(departed.destinationName, 'London')
})

test('Pearson: the list is asked slowly, one board at a time, and a captcha means silence for a while', async () => {
  let clock = Date.parse('2026-09-17T23:30:00.000Z')
  const slept = []
  const asked = []
  let challenge = false
  const provider = createPearsonProvider({
    fetch: async url => {
      asked.push({ url, at: clock })
      if (challenge) return { ok: false, status: 302, challenged: true, json: async () => ({}) }
      return {
        ok: true,
        status: 200,
        challenged: false,
        json: async () => ({ list: [PEARSON_ROW] }),
      }
    },
    now: () => clock,
    sleep: async ms => {
      slept.push(ms)
      clock += ms
    },
    spacingMs: 30_000,
    backoffMs: 600_000,
  })
  const [departures, arrivals] = await Promise.all([provider.departures(), provider.arrivals()])
  assert.equal(departures.length, 1)
  assert.equal(arrivals.length, 0, 'the recorded row is a departure, so the arrivals side is empty')
  assert.deepEqual(slept, [30_000], 'the second board waited its turn')
  assert.equal(asked[1].at - asked[0].at, 30_000)

  challenge = true
  clock += 31_000
  await assert.rejects(provider.departures(), /asked for a captcha$/)
  clock += 60_000
  await assert.rejects(provider.arrivals(), /not asking again for 9 min/)
  assert.equal(asked.length, 3, 'a challenged door is not knocked on again')

  clock += 600_000
  challenge = false
  assert.equal((await provider.departures()).length, 1)
})

test('Dublin’s security queue is read per terminal, in minutes, in the app’s own terminal names', async () => {
  const { parseDublinQueues, createDublinProvider, DUBLIN_QUEUES } = await import(
    '../src/flights/providers/dublin.js'
  )
  assert.deepEqual(parseDublinQueues({ T1: '12', T2: '0' }), { 1: 12, 2: 0 })
  assert.deepEqual(parseDublinQueues({ T1: 'closed', T2: '7.6' }), { 2: 8 })
  assert.deepEqual(parseDublinQueues(null), {})
  const urls = []
  const provider = createDublinProvider({
    fetch: async url => {
      urls.push(url)
      return { ok: true, status: 200, json: async () => ({ T1: '25', T2: '5' }) }
    },
  })
  assert.deepEqual(await provider.securityQueues(), { 1: 25, 2: 5 })
  assert.deepEqual(urls, [DUBLIN_QUEUES])
})

test('the aircraft’s track is read as a heading for the map', () => {
  const heard = readAircraft(
    {
      hex: 'abc',
      flight: 'KLM677 ',
      alt_baro: 36000,
      gs: 471,
      track: 289.4,
      lat: 55.1,
      lon: -20.2,
      seen: 3,
    },
    { now: Date.parse('2026-09-14T12:00:03.000Z') },
  )
  assert.equal(heard.trackDegrees, 289.4)
  assert.equal(heard.airborne, true)
  assert.equal(heard.heardAt, '2026-09-14T12:00:00.000Z')
  assert.equal(readAircraft({ hex: 'abc', alt_baro: 'ground' }).trackDegrees, null)
})

test('Pearson’s aisle is the check-in zone, in the airport’s own word, beside the desks', () => {
  const body = JSON.parse(fixture('pearson-departures.json'))
  const rows = parsePearsonBoard(body, 'departure', { fetchedAt: AT })
  const aisled = rows.find(row => row.extra.checkinZone)
  assert.ok(aisled, 'the recording has flights with an aisle')
  assert.match(aisled.extra.checkinZone, /^Aisle \S+$/)
  const desked = rows.find(row => row.extra.checkinDeskRange)
  assert.ok(desked, 'the recording has flights with a run of desks')
  assert.match(desked.extra.checkinDeskRange, /^\d+-\d+$/)
  assert.equal(
    rows.some(row => 'aisle' in row.extra),
    false,
    'kept under the ticket’s name only',
  )
})

test('ADS-B: the networks are asked in turn until one hears; a network down is skipped, not the answer', async () => {
  const { createAdsbProvider } = await import('../src/flights/providers/adsb.js')
  const heard = {
    hex: 'c05f1a',
    flight: 'ACA1115 ',
    t: 'BCS3',
    alt_baro: 31000,
    lat: 50.4,
    lon: -104.6,
    seen: 3,
  }
  const answers = {
    'api.adsb.lol': { ok: true, status: 200, json: async () => ({ ac: [] }) },
    'opendata.adsb.fi': { ok: true, status: 200, json: async () => ({ ac: [heard] }) },
  }
  const asked = []
  const fetch = async url => {
    const host = new URL(url).host
    asked.push(host)
    const answer = answers[host]
    if (!answer) throw new Error(`${host} unreachable`)
    return answer
  }
  const sky = createAdsbProvider({ fetch, now: () => Date.parse('2026-09-19T19:10:00Z') })
  /* The first network hears nothing; the second has it. */
  const found = await sky.byCallsign('ACA1115')
  assert.equal(found.type, 'BCS3')
  assert.equal(found.network, 'opendata.adsb.fi')
  assert.deepEqual(asked, ['api.adsb.lol', 'opendata.adsb.fi'])
  /* The first network down is skipped for the second. */
  answers['api.adsb.lol'] = { ok: false, status: 503 }
  assert.equal((await sky.byCallsign('ACA1115')).type, 'BCS3')
  /* Nobody hears: null, not a failure — one network did answer. */
  answers['opendata.adsb.fi'] = { ok: true, status: 200, json: async () => ({ ac: [] }) }
  assert.equal(await sky.byCallsign('ACA1115'), null)
  /* Every network down is the failure it is. */
  delete answers['opendata.adsb.fi']
  await assert.rejects(sky.byCallsign('ACA1115'), /unreachable|503/)
})
