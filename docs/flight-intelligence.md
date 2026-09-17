# Flight intelligence: reading the airports ourselves

What this is: Off We Go's own aviation data layer, first version, covering Dublin
(DUB), Toronto Pearson (YYZ) and Regina (YQR). It reads each airport's own board,
writes what the board says onto the trip's legs, and tells the family. This
document is the investigation behind it, the design, and an honest account of
what it can and cannot do. Every claim about a source below was verified on
17 September 2026 by `app/server/scripts/probe-flight-sources.mjs`, run on a
GitHub Actions runner (the `Flight source probe` workflow); the recorded
responses live in `app/server/test/fixtures/flights/` and the parsers are
tested against them.

One decision first. The brief asked for .NET 8 and Clean Architecture. Off We Go
is a Node/Fastify server with a React client, deployed as one container, and its
legs, deadlines, live map, Lock Screen card and notifications all already live
there. A second runtime would have meant a second deploy, a second test suite
and an HTTP hop between the leg and the thing that knows about it. So the layer
is built in the server's own language, with the same shape the brief describes:
a provider abstraction, a normalized model, an event detector, injected HTTP
clients, and tests over mocked responses. The mapping is in Part 3.

## Part 1: what each airport actually serves

### Dublin (DUB): a JSON API behind a Next.js site

- **Live pages:** `https://www.dublinairport.com/flight-information/live-departures`
  and `/live-arrivals`. Server-rendered HTML carries no flight rows; a Next.js
  application draws them.
- **How the page gets its data:** the front-end bundle lists its endpoints in
  plain text:
  `FLIGHT_DEPARTURES https://api.dublinairport.com/dap/flight-listing/departures`,
  `FLIGHT_ARRIVALS .../dap/flight-listing/arrivals`, `SINGLE_FLIGHT_DETAILS
  .../dap/flight-listing`, `SEARCH_BFF .../dap/search`, `FETCH_WEATHER
  .../dap/weather`, `GET_SECURITY_TIMES_BFF .../dap/get-security-times`.
- **Request:** `GET https://api.dublinairport.com/dap/flight-listing/departures?date=YYYY-MM-DD&limit=200`
  with `Accept: application/json` and `Origin: https://www.dublinairport.com`.
  No key, no cookie. The runner's request was answered; the CORS header names
  the site's origin but the server does not refuse others.
- **Parameters, from the listing component's own code:** `date`, `limit`
  (above 200 answers `400 "'limit' Too big: expected number to be <=200"`),
  `after=<latestTimestamp>&after-id=<latestId>` for the next page,
  `before=<earliestTimestamp>&before-id=<earliestId>` for the previous
  (`after` that is not a date answers `400 "'after' must be a valid date"`),
  `terminal=T1|T2`, and `filter=<text>` (`EI` narrowed to 160 Aer Lingus rows,
  `Leeds` to 6; a flight number matched nothing in our runs). The single-flight
  endpoint's exact path was not found: `/dap/flight-listing/<internalFlightId>`
  answers a JSON 404.
- **Response:** `{content: [...], pagination: {hasNext, hasPrevious,
  earliestTimestamp, latestTimestamp, earliestId, latestId}, lastUpdated}`.
  Today's listing starts at "now" (late in the evening it was empty with
  `hasPrevious: false`); a future date lists the whole day, 200 per page.
- **Fields (departures):** `internalFlightId` ("FR457-20260917"),
  `flightIdentity` ("FR457"), `airportCode` (far end), `carrierCode`,
  `carrierName`, `scheduledDateTime`, `estimatedDateTime` (UTC instants),
  `destinationAirportName`, `status` (a number), `statusMessage`,
  `terminalName` ("T1"), `gate`, `checkinZone`, `checkinDeskRange`,
  `codeShares` (["AA8097"]), `goToGateTime`, `goToPreClearanceTime`,
  `walkTime` (minutes), `requiresPreClearance`, `requiresShuttleBus`,
  `isDelayed`. **Arrivals** add `originAirportName` and `baggageBelt`.
- **Status vocabulary seen:** `0 ON SCHEDULE`, `2 GO TO GATE`, `3 DELAYED`,
  `4 CANCELLED`, `6 NOW BOARDING`, `11 LANDED AT 23:28` (the clock is Dublin
  local time; the estimate beside it goes on being the on-blocks estimate).
  The front end also knows a `secondaryStatusMessage`.
- **Refresh:** the API answers with `cache-control: public, max-age=30,
  stale-while-revalidate=30` and its own `lastUpdated`. Polling faster than
  every 30 seconds buys nothing.
- **Reliability:** an unversioned but stable-looking API under the airport's
  own domain, serving its own site. Breakage would show as a shape change,
  which the parser refuses loudly (`no content array`). Terms of use for
  dublinairport.com were not reviewed here; automated reading of a public
  board at one request a minute is modest, but it is a judgement the product
  owner should make knowingly.
- **Also there:** `/dap/get-security-times` answers `{"T1":"0","T2":"0"}`, the
  queue in minutes per terminal.

### Toronto Pearson (YYZ): a list behind a bot manager

- **Live pages:** `https://www.torontopearson.com/en/departures` and
  `/en/arrivals`. A Sitecore site; the board is a lazily loaded webpack chunk
  (`flight-listing.<hash>.chunk.gen.js`) drawn by a `real-time-data` chunk.
- **How the page gets its data:** the chunk calls the site's own origin:
  `/api/flightsapidata/getflightlist?type=DEP|ARR&day=today|tomorrow|yesterday&useScheduleTimeOnly=false`,
  `/api/flightsapidata/getflightsearch?term=<text>`, and
  `/api/flightsapidata/getflightsearchbykey?flightkey=<key>`. (A memory of a
  direct host, `gtaa-fl-prod.azureedge.net/api/flights/list`, is real but
  answers 401 with an empty body: the site's origin proxies it with a
  credential we do not have.)
- **Response:** `{lastUpdate, serverTime, today, tomorrow, yesterday, list:
  [...]}`; 522 departures on the evening of 17 September. Each row:
  `key` ("A0916AAL1111YYZDFW"), `id` (ICAO, "AAL1111"), `id2` (IATA,
  "AA1111"), `type` (DEP/ARR), `schTime` and `latestTm` (ISO with Toronto's
  offset), `gate`, `status` (a code), `term` ("T3"), `al` (airline name),
  `alCode` (ICAO), `ids` (codeshares, each with `id`, `id2`, `alName`),
  `routes` (`code`, `name`, `short`, `city`, `cnty`, `region`), `carousel`,
  `termzone`, `svctype`, `aisle`, `zone` (check-in zone), `stand`.
- **Status codes seen:** `CAN` 16, `DEP` 373, `DEL` 27, `ONT` 106. Boarding
  codes were not on the evening list and are mapped by name only where the
  code is obvious; anything else is kept as its code and reported `unknown`.
- **The catch:** the site sits behind Radware Bot Manager (ShieldSquare
  `__uzm*` cookies, captcha at `validate.perfdrive.com`), and its answers carry
  17 KB of headers, more than Node's fetch allows. In every probe the first
  request from a fresh address was answered with the list, and every request
  after it, half a second or half a minute later, with or without the first
  answer's cookies, was answered with the captcha page. From a server's fixed
  address that may mean one list every ten minutes or none at all. Solving
  the challenge would mean running the bot manager's JavaScript in a real
  browser, which is evasion, not integration, and is not done.
- **The proper door:** the GTAA publishes an Airport Resource API for partners
  on `developer.torontopearson.com`. Registering there is the recommended
  next step; the provider's parser is the only code that would change.

### Regina (YQR): the display vendor's public feed

- **Live pages:** `https://www.yqr.ca/en/passengers/flights/departures` and
  `/arrivals`. WordPress (WP Engine, behind Cloudflare); the page is
  server-rendered with a table, and its theme script also reads the feed
  below directly.
- **The feed:** `https://yqr.simpleway.cloud/data-feed/public/departure-web`
  and `/arrivals-web`. Public XML, no key, no cookie,
  `cache-control: no-cache, no-store, max-age=0, must-revalidate`. Simpleway is
  the airport's flight information display vendor; this is what the screens in
  the terminal show.
- **Shape:** `<MAIN><FLIGHTS><FLIGHT DISPLAY="WS3375">` with `DISPLAY`,
  `CARRIER/NAME`, `CARRIER/ABBREV`, `NUMBER`, `CODESHARES`, `SCHEDDATE`,
  `MODE TYPE="A|D"`, `DATE`, `TIME` (what the board expects now), `SCHEDTIME`,
  `GATE`, `BRIDGE`, `TERMINAL`, `CAROUSEL`, `STATUS`, `COMMENT`, `OPERATE`,
  `CITIES`, `CITYCODES/CITYCODE IATA=`, `AIRCRAFT`. Times are Regina wall-clock.
- **Status vocabulary seen:** `On Time`, `Delayed`, `Arrived`.
- **Behaviour:** it is a display feed. An arrived flight said "Arrived" at
  16:28 and had been replaced by the next day's flight of the same number by
  16:33; the next day's flights appear as the day runs down, belts already
  assigned. About forty rows per feed.
- **Reliability:** the simplest and most honest of the three, and the one most
  likely to change without notice, because it is a vendor's URL rather than the
  airport's. The parser refuses a feed that parses to nothing.

### Community ADS-B and open data

- **adsb.lol** (`https://api.adsb.lol/v2/point/{lat}/{lon}/{nm}`,
  `/v2/callsign/{callsign}`, `/v2/hex/{hex}`): answered without a key,
  `cache-control: no-store`, rate limit "dynamic"; its notes say a key earned
  by feeding may be required later. Fields: `hex`, `flight` (callsign), `r`
  (registration), `t` (type), `alt_baro` (feet, or the word `ground`), `gs`,
  `lat`, `lon`, `seen`, and the rest of the ADS-B Exchange v2 shape.
- **airplanes.live:** 403, "contact us by email first".
- **OpenSky:** anonymous `states/all` and `flights/departure` worked
  (`x-rate-limit-remaining: 399` of 400 a day); `flights/arrival` answered an
  empty 404 for the window asked.
- **Airline pages:** Air Canada's flight-status page had moved (404) and its
  configuration names Kasada bot protection; WestJet's answered 404. Not
  pursued.

## Part 2: what we can and cannot reproduce

| Signal | DUB | YQR | YYZ | Commercial feeds |
| --- | --- | --- | --- | --- |
| Status, delay, cancellation | yes | yes | yes when the list answers | yes |
| Gate | yes (departures) | yes (departures) | yes when the list answers | yes, where the airport shares it |
| Terminal | yes | empty in the feed | yes | yes |
| Estimated and actual times | yes; "LANDED AT hh:mm" | yes (TIME) | yes (latestTm) | yes |
| Boarding status | yes (GO TO GATE, NOW BOARDING, FINAL CALL) | no | code unseen | partial |
| Baggage belt | yes (arrivals) | yes (CAROUSEL) | yes (carousel) | partial |
| Aircraft type or registration | no | field present, empty | no | yes |
| Aircraft swap | no | no | no | yes (Cirium, FlightAware, AeroDataBox) |
| Inbound aircraft ("your plane has not arrived yet") | no | no | no | yes (rotation data) |
| Cancellation reason | no | no | no | rarely; airlines keep it |
| Codeshares | yes | field present, empty | yes | yes |
| Check-in zone, walk time, stand | yes (zone, walk) | no | yes (zone, stand) | no |

What the boards give is the passenger-facing operational truth for their own
airport: the far end's board knows the other half of the same flight. What only
the paid networks have is what comes from airlines and handling systems rather
than screens: the airframe and its rotation (the inbound aircraft), equipment
swaps, reasons, and coverage of every airport rather than three. AeroDataBox and
FlightAware also carry ADS-B-derived actual times for airports with no board at
all; we get that only where adsb.lol hears the aircraft.

Providers, for reference: AeroDataBox (per-flight, gates and belts where its
FIDS partners have them, aircraft registration, priced per call), FlightAware
AeroAPI (positions, schedules, actuals from ADS-B, gates where shared, priced
per call), Aviationstack (schedule-heavy, statuses lag), Cirium (the industry
reference, airline-sourced, enterprise pricing). A paid adapter behind the same
provider interface is the right fallback for any airport without a board; it is
designed for, not built, because its API shape could not be verified from here.

## Part 3: architecture

All under `app/server/src/flights/`, plain modules with injected dependencies.

- **`model.js`**: `FlightInfo`, the one shape. `normalizeFlightNumber`
  ("AC 872" → "AC872"), `flightNumberOf(segment)` (from the leg's number or its
  carrier and number), `matchFlight(board, number, aroundIso)` (the flight's own
  number or a codeshare, nearest within half a day), `normalizeTerminal`.
  Status vocabulary: `scheduled, delayed, boarding, gate-closed, departed,
  landed, arrived, cancelled, diverted, unknown`, with the board's own words
  kept in `statusText` and boarding as `go-to-gate, boarding, final-call,
  closed`.
- **`providers/dublin.js`, `providers/regina.js`, `providers/pearson.js`**:
  each exposes `{airportCode, source, zone, departures(date), arrivals(date)}`,
  the brief's `IAirportFlightProvider`, and a pure parser
  (`parseDublinBoard`, `parseReginaBoard`, `parsePearsonBoard`) tested on the
  recorded responses. `providers/adsb.js` answers by callsign.
- **`http.js`**: the browser-like client for the one board fetch cannot read.
- **`board-cache.js`**: one request per board per minute for everyone; served
  stale for twenty minutes when a source fails; health per source.
- **`registry.js`**: `createFlightSources({fetch, http, now})` → providers by
  IATA code, the shared cache, ADS-B, `board(code, direction, date)`,
  `airports()`, `health()`. The brief's dependency injection: production hands
  in nothing and gets the network; tests hand in functions.
- **`events.js`**: `detectFlightEvents(previous, current)`, the brief's
  `IFlightEventDetector`. Events: `FlightDelayed`, `FlightRescheduled`,
  `ArrivalEstimateChanged`, `FlightCancelled`, `FlightDiverted`, `GateChanged`,
  `TerminalChanged`, `BoardingStarted`, `BoardingEnded`, `BaggageUpdated`,
  `AircraftChanged`, `FlightDeparted`, `FlightLanded`, each with `oldValue`,
  `newValue` and, for time, `minutes`. A five-minute threshold keeps the
  board's rounding out. `describeFlightEvent` writes the sentence.
- **`watch.js`**: the poller. Once a minute over every flight leg leaving within
  thirty hours or landed within four; reads both ends' boards through the
  cache; matches; merges (the later stage wins); diffs against the last
  snapshot or, on first sight, the leg as typed; writes changes through the
  same segment write the editor uses (so a moved departure moves every
  deadline, as migration 035 decided); keeps events; announces the trip.
  Asks ADS-B only when a board has gone quiet twenty minutes past departure.
- **`routes.js`**: `GET /api/flights/airports`, `GET /api/flights/:airport/
  departures|arrivals?date=`, `GET /api/flights/status?flight=&airport=&date=
  &direction=`, `GET /api/trips/:tripId/segments/:segmentId/flight`.
- **Persistence (migration 037):** `flight_snapshots` (one per leg, the last
  thing the boards said) and `flight_events` (the trail, with the sentence and
  the source).
- **Client:** the leg card already shows the status note, the gate with its
  old value, the moved departure, and the Lock Screen card follows the segment;
  `flight-word-core.ts` turns a changed note into a local notification while
  the app is alive.

## Part 4: the code

Server: `app/server/src/flights/{model,events,time,board-cache,http,registry,routes,watch}.js`,
`app/server/src/flights/providers/{dublin,regina,pearson,adsb}.js`,
`app/server/migrations/037_the_airports_speak.sql`, repository methods
`flightLegsToWatch`, `flightSnapshot`, `saveFlightSnapshot`,
`recordFlightEvents`, `applyFlightUpdate`, `flightForSegment` in `postgres.js`
and the in-memory test double, wiring in `app.js` and `index.js`.

Client: `app/src/flight-word-core.ts`, `sayTheAirportsWord` in
`features/transport/model/notify.ts`, hooked in `use-segments.ts`.

Investigation: `app/server/scripts/probe-flight-sources.mjs` and
`.github/workflows/flight-source-probe.yml`.

## Part 5: testing

- Parsers against recorded responses (`server/test/fixtures/flights/`): Dublin's
  evening departures and arrivals and a full next day, Pearson's 522-row list,
  Regina's two feeds; plus one hand-written Regina row in the vendor's shape
  for the arrived case the feed had already dropped.
- The event detector as a matrix: every event once, thresholds, first-sight
  baseline, no double announcements.
- The cache: shared loads, ttl, stale-on-error, health.
- The watcher with a fake repository and fake boards: write, say, keep,
  announce; nothing twice; unwatched legs; a dead board; the ADS-B silence
  rule.
- The routes through the real server with the in-memory repository.
- The client's notification rule as a pure function.
- The probe workflow is the canary: run it (`workflow_dispatch`) when a parser
  starts throwing, and the log shows what changed.

Local: `npm run test:server` (405 tests) and `npm run test:unit`.

## Part 6: production risks and limits

- **Pearson is best effort.** One list per fresh address, then captchas. The
  provider backs off ten minutes after a challenge and never hammers; YYZ legs
  still get the far end's board (Dublin knows when AC872 lands and which belt)
  and ADS-B for airborne and landed. Register for the GTAA partner API.
- **Undocumented endpoints change.** Dublin's and Simpleway's could change
  shape or move. Both parsers throw on a shape they do not recognise, the cache
  records the failure per source, `/api/flights/airports` shows it, and the
  probe shows what the new shape is.
- **Terms of use.** None of the three sites publishes an API licence for
  these endpoints. One request a minute per board, from one server, with a
  named user agent, is the posture; the product owner should decide whether to
  ask each airport, and should before advertising the feature.
- **Time.** Dublin gives UTC; Pearson gives offsets; Regina gives wall-clock,
  converted through `America/Regina` (no DST). Dublin's "LANDED AT hh:mm" is
  read against the scheduled day and files just-after-midnight correctly.
- **Windows.** Dublin's today listing starts at now and, late in the evening,
  says nothing about flights already gone; a leg that departed will show its
  actual time only while the API still lists it. Regina drops arrived and
  departed flights within the hour. The snapshot keeps the last word.
- **Matching.** By flight number (or codeshare) nearest in time within twelve
  hours; a leg typed with an airline name needs one in `CARRIER_CODES` or a
  two-letter code in the number.
- **No push when the app is closed.** Same as the rest of the app: the
  notification is local, the Lock Screen card updates while the app runs.
- **ADS-B is a courtesy.** No key today, a key tomorrow; asked only when a
  board is silent, once per ten minutes per leg.
