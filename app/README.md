# Wayfare — Wide

The trip viewer from design 09, built as a React app with the interactions wired up.

```bash
pnpm install
pnpm dev         # http://localhost:5173
```

## What is real

* **Map** — [MapLibre GL](https://maplibre.org) rendering CARTO's open vector styles
  (Dark Matter / Positron — no API key, no account). Vector tiles are drawn on the GPU as
  geometry, so zoom is continuous instead of stepping between whole raster levels, and a
  pan is a camera move rather than several dozen `<img>` elements being re-laid-out.
  Trip pins, photo stacks and the live marker stay as DOM markers so they keep their own
  styling and click handling; the route is a GeoJSON line layer.

* **Daylight** — the map's colour follows the sun *over the family's own position*, not
  the viewer's clock, so someone following from home sees Amsterdam's dusk while it is
  still afternoon where they are. Warm cream basemap (Voyager) while the sun is up,
  dark (Dark Matter) once it is down, with a colour wash that creeps from pale warm at
  noon through gold and apricot at sunset to deep blue at night. Sun altitude is a
  function of the instant and the coordinates alone, so this needs no timezone lookup;
  it tracks the real seasons too. Pressing the sun/moon button takes the map with it and
  turns the automatic behaviour off.
* **Coordinates** — every stop and photo sits on its real Amsterdam location. The travelled
  route follows the actual streets from Hotel Jakarta through the centre to the Foodhallen.
* **Photos** — Creative-Commons photography by keyword, with a fallback source if a request
  fails. Replace `pic()` in `data.js` with your storage URLs.

## What works

| | |
|---|---|
| Live tracking | The marker walks the route every few seconds, the trail grows, distance recalculates, the "updated Xs ago" pill ticks |
| Follow mode | On by default; panning the map turns it off, the crosshair button turns it back on |
| Map | Pan, zoom, fit-whole-trip, click any pin or photo |
| Stop card | Hero image, status, times, notes, photo grid, open in Google Maps |
| Photo viewer | Prev/next, arrow keys, Esc, filmstrip, like, contributors, minimap centred on the shot |
| Upload | Pick a file from your device; it uploads to storage, is pinned at the live position and attached to the nearest stop within 400 m |
| Timeline | Day-grouped stops with photo strips; "show on map" jumps back |
| Photos | Grid with per-person filters |
| Family | Who is travelling, who is following |
| Search | Filters stops by name, kind, note, day and the captions of photos taken there |
| Day filter | All days, or a single day |
| Theme | Dark and light chrome; the map picks its own from daylight at the trip until you press the toggle |
| People | Invite by email, choose view or edit, cancel a pending invite |
| Comments | Post against your own account; everyone on the trip sees them; delete your own |
| Editing | Click the map to add a stop, drag pins to move them, reorder, retitle, redraw the walked route |
| Attractions | Castles, museums, lochs and monuments drawn on the map everywhere it goes — Amsterdam, the Highlands, anywhere; click one for a picture, a description and a way to add it |
| Sights | A list of what is worth seeing around the map, each with a picture, a name and a description; add any of them to the trip in one click |
| Find places | Search what is on screen and drop in a real place — name, description and photograph already filled in |
| Photos | Change a caption, move a photo to another stop, delete it |
| Live updates | Changes made by one person appear for everyone else without a refresh |

## Running it against your own trip

With no configuration the app runs on the bundled sample trip and everything — editor,
invites, comments — works; it just does not outlive a refresh. To make it real:

1. **Create a Supabase project** (free tier). Project Settings -> Data API gives you a
   *Project URL* and an *anon/public* key.
2. **Run `supabase/schema.sql`** in the SQL Editor. It creates the tables, the row level
   security policies, the invite-claiming function and the photo bucket. It is idempotent,
   and it also migrates an install of the earlier link-based version.
3. **`cp .env.example .env.local`** and paste those two values in. The anon key belongs in
   a browser — it identifies the project, not the caller, and RLS decides what it reaches.
   The `service_role` key does **not**: it bypasses RLS entirely and must never ship.
4. **Sign in.** Everyone does, including followers. It emails a magic link — no passwords
   to store or reset, and the same link creates the account if there is not one yet.
   Supabase sends these itself on the free tier; past light use, point it at your own SMTP
   under Authentication -> Emails.
5. **Start a trip.** Sign in and the app offers it — you become the owner. No SQL needed.
6. **Invite everyone else** with the People button — name, email, and whether they can view
   or edit. They get access the first time they sign in with that address.
7. **Add the itinerary from the map.** Pencil button -> click the map to drop a stop, fill
   in name, day, time and note, drag pins to nudge them, and the arrows in the editor
   reorder them. "Edit route" turns clicks into the walked line. Nobody types a coordinate.

### Who can see what

| | |
|---|---|
| Owners, editors | Read and write the trip, and manage who is on it. |
| Viewers | Read the trip, and post comments and likes as themselves. |
| Everyone else | Nothing. There is no policy granting the anonymous role access to any table. |

**Access comes from the invitation, not from the link.** The URL is only where the trip
lives; handing it to a stranger gets them a sign-in screen and then "no trip yet".

Invitations are by email address, issued before that person has an account. On their first
sign-in the client calls `accept_invites()`, which turns every invitation addressed to their
verified email into a membership. That function is `security definer` — an invitee cannot
read `trip_invites` directly — so **matching on `auth.jwt() ->> 'email'` is the whole
authorisation**. Treat that WHERE clause as security-critical.

Membership doubles as the cast list: owners and editors show as *Travelling*, viewers as
*Following*, and pending invitations appear greyed until claimed. There is no separate
people table to keep in step.

Photos live in a **private** bucket, fetched with short-lived signed URLs, since there are
no anonymous viewers to serve.

## Where the place details come from

**Stops with no picture of their own get one on load**, without anyone asking. That is
the difference between a trip that arrives looking like something and one you fill in by
hand a stop at a time. It happens once and, if you can edit the trip, the result is saved
so it is not paid for again.

Matching is deliberately strict, and it does not fill everything in. Of the eight sample
stops it finds five. The three it skips are the right answer rather than a shortfall:
*Hotel Jakarta* has no article, *Foodhallen* has none within range, and *Canal cruise* is
not a place at all — its nearest article is the Westerkerk, and a looser rule would have
confidently given it a photograph of a church. Anything unmatched keeps its placeholder,
and **Fill in from Wikipedia** in the stop editor will take the nearest match if you want
it anyway.


### Attractions on the map

The map is not just the trip drawn on a basemap: the castles, museums, lochs and
monuments are already on it, everywhere it goes. Click one for a picture, what it is
and a line about it, and add it to the itinerary from there. The pin button in the
header turns the layer off.

They come from a table, seeded once:

```
SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SECRET_KEY=sb_secret_... npm run seed:attractions
```

That walks the Netherlands and Scotland in ten-kilometre cells — the largest circle
Wikipedia's geosearch will answer — and upserts what it finds. It is about 1,700 cells
and a quarter of an hour, once, on one machine. `--dry-run` reports what a region comes
to without credentials or writes; `--box=w,s,e,n` seeds anywhere else. Re-running is
safe: rows are upserted by page id, so a second pass refreshes rather than duplicates
and an interrupted run can just be started again.

It then makes a second pass for the opening lines of each article, twenty at a time,
because that is where TextExtracts silently stops. That pass asks the table what is
still missing rather than starting from the top, so it resumes on its own and an
article with nothing to say is stored as an empty string rather than being asked about
for ever. With those seeded, a card opens complete: the picture comes from the stored
filename, the paragraph from the row, and the Wikipedia link from the page id, which
resolves to the article without a request. Clicking a pin costs nothing at all.

The point of seeding is that a visitor's device does none of that. Opening the app is
one indexed bounding-box query — measured at **0.18 ms** for a city-sized view over
60,000 rows, and 1.2 ms for the whole of Scotland asking only for the headline ones.
Grandma Jo's phone does not rediscover Edinburgh Castle; it asks for what is on
screen and gets it in a single round trip.

Nobody but the seeder can write. The table has a read policy for signed-in accounts and
no insert, update or delete policy at all, so only the `service_role` key can change it
— which is why that key is passed on the command line for one run and never put in a
file beside the app. Both halves were checked against a real Postgres rather than
assumed: the schema applies clean, and `anon` and `authenticated` are each refused an
insert by row level security.

**Without a database it still works**, which is how it was built before there was one:
the map falls back to asking Wikipedia directly, ten kilometres at a time, keeping what
it finds in that browser. Every visitor then pays for it again, and only for the ground
they personally wandered over — hence the table. The fallback is per region, not per
session, so panning somewhere the seeder never reached fills in live and the seeded
regions still come back in one query.

Two things matter for it to stay smooth, and both were measured rather than assumed:

- The pins are a GeoJSON source and two map layers, not DOM markers. A thousand
  absolutely positioned elements re-laid-out per frame is exactly the jank this map was
  rebuilt to be rid of; as map layers they cost the GPU almost nothing.
- On the fallback path, arrivals are published to the map on a slow timer rather than
  per cell, and the fill holds its breath while a hand is on the map. Rebuilding the
  collection per cell put a pan at 8.1s of task time; batching brought it to 3.2s
  against a 2.9s baseline with the layer switched off. The first fill of a new area is
  still felt — 3.7 to 7.6s in that same measure — which is the cost seeding removes.

Wikidata's SPARQL endpoint and OpenStreetMap's Overpass were both tried first and both
rejected: 41 seconds and then a 502 for the one, a throttled IP after three queries for
the other.

The **Sights** tab lists what is around the middle of the map — a picture, a name and a
description each — without going near edit mode, because choosing where to go and editing
an itinerary are different jobs. Anywhere already on the itinerary is marked rather than
offered again, and one click adds the rest. "Find places" in edit mode is the same search
drawn on the map instead, and there is **Fill in from Wikipedia** in the stop editor for a
stop you placed by hand.

The obvious way to build that list is wrong, and measurably so. Geosearch returns the
*nearest* articles, and the forty nearest to the middle of Amsterdam are canals, squats
and side streets — the Rijksmuseum is only the sixty-ninth. No amount of filtering
recovers what the limit already discarded. So `findSights` casts a wide net and ranks
afterwards:

1. one `list=geosearch` call for 500 articles, coordinates only — cheap and unfiltered
2. drop the streets and districts by title
3. keep every plausible destination, plus the nearest thirty regardless
4. fetch description, extract, picture and readership for those, **in batches of twenty**
5. rank by daily readers, then by distance

Twenty is not a round number chosen for tidiness: both `TextExtracts` and `PageViewInfo`
return nothing above it — no error and no warning, just absent fields, which reads as
"nobody visits the Rijksmuseum" rather than "you asked for too much". Readership is the
closest free stand-in for "worth going to", and it needs no taste of mine encoded in a
keyword list.

Three more things in `places.js` are doing real work, and all three exist because the raw
results were unusable without them:

* **Streets and neighbourhoods are dropped.** Geosearch returns every geotagged article,
  which in a city centre is mostly administrative areas — accurate, useless.
* **Locator maps, flags and logos are rejected as photographs.** Matched against the file
  name with separators either side, never the whole url: `map` is a substring of
  *Amsterdam*, which silently stripped the photo off half the results in a Dutch city.
* **Destinations sort above everything else**, then by distance.

Some articles genuinely lead with a logo — the Van Gogh Museum does. For those the first
usable image in the article body is used instead, fetched only when you actually add that
place. It is not always the building; a museum often yields its most famous work, which
is a fair hero for a trip card and replaceable by one of your own photos.

Content is CC BY-SA and images carry their own licences, so every stop keeps the page it
came from and the editor links back to it.

## Tests

```bash
pnpm test          # headless
pnpm test:ui       # watch them run
```

`tests/trip.spec.js` runs against a production build in sample mode, so it needs no
credentials and no database. The cases are regression guards for things that genuinely
broke during development — a save that created two stops, a reorder that flung rows to
the end, a photo viewer holding a stale snapshot, pins that stopped being clickable, the
map going blank mid-gesture — rather than a smoke test that everything renders.

First run downloads a browser: `npx playwright install chromium`.

## Deploying

Static build, so anything that serves files works. `netlify.toml` and `vercel.json` are
here and set two things that matter:

* **The SPA rewrite.** Magic links return to the URL they were sent from; without every
  path serving `index.html` that callback is a 404 and sign-in appears to silently fail.
* **`VITE_SUPABASE_*` as build-time variables.** They are baked into the bundle, so
  changing either needs a rebuild, not just a restart.

Then add your deployed origin to Supabase under **Authentication -> URL Configuration**,
as both Site URL and a Redirect URL. Magic links to an origin that is not listed are
rejected, and the failure looks like a link that just does not work.

## Wiring it to a backend

`src/backend.js` is the seam. It exposes `loadTrip` plus the stop mutations, and picks
between Supabase and the bundled sample depending on whether credentials are configured —
so the app has no `if (supabase)` scattered through it and the editor can be exercised
with no database at all. `src/data.js` is now just that sample content. Swap `STOPS`, `PHOTOS`, `ROUTE`
and `FAMILY` for fetched data and the rest of the app is unchanged. The live position is
simulated in `App.jsx` (`step` / `AHEAD`) — replace that effect with a realtime subscription.

If you replace `pic()`, keep the size ladder. Callers ask for whatever suits their box and
`pic()` snaps it to one of three rungs, so a photo shown in the grid, the filmstrip and the
hero card is one download rather than three. Without that, a CDN that varies its response by
requested dimensions gets asked for the same picture six or seven different ways.

## Performance notes

The map used to be a slippy-map renderer written from scratch: raster tiles as `<img>`
elements, positioned by hand. It was replaced because its remaining problems were
inherent rather than fixable — raster tiles only exist at whole zoom levels, so zooming
between them means scaling bitmaps, and every tile is a DOM node the browser has to
composite. At one point the layer tree held 32-36 composited layers totalling ~23
megapixels just to show a map.

What the GL map changes, measured over a pan plus eight wheel-zoom notches:

| | raster | MapLibre |
|---|---|---|
| Layerize | 192 ms | **88 ms** |
| Paint | 23.3 ms / 317 | **3.5 ms / 148** |
| Rasterisation | 6.5 ms | **1.8 ms** |
| Layout | 5 ms | **0 ms** |

It costs more JavaScript in exchange (the GL renderer runs a frame loop), and adds
~250 kB gzip to the bundle — kept in its own chunk so the app shell parses without
waiting on it.

**Total bytes went down, not up.** Vector tiles are small and one tile serves many zoom
levels, where the raster build refetched a fresh set per level. Cold load at 4 Mbps with
the cache disabled: **2071 kB → 1054 kB**.

The rest of the loading work still applies and is independent of the map:

* Photo urls are snapped to a three-rung size ladder so one photo is one download per
  rung — see `pic()` in `data.js`. This took unique photo requests from 41 to 30.
* `preconnect` to the tile CDN (~210 ms of handshake off the critical path).
* One variable font file instead of five static weights, loaded off the critical path.
* `Ticker`, `Filmstrip` and `HeroCard` are memoised, and the callbacks they receive read
  the current view through a ref — a callback closing over `view.zoom` gets a new
  identity every frame and silently defeats the memo.
* The "updated Xs ago" pill owns its own state (`LivePill`). Hoisted into `App` it
  re-rendered the whole tree, map included, once a second.
* The two infinite CSS animations use transform/opacity only. The live pill previously
  animated `box-shadow`, which cannot be composited and repainted the ticker forever.

### Tuning the daylight colours

`TINT` in `App.jsx` is the ramp: a list of sun altitudes in degrees, each with a colour
and an opacity, interpolated between. `LIGHT_ABOVE` is the altitude at which the basemap
swaps between the warm and dark styles — it sits slightly *below* the horizon on purpose,
because the world stays bright for a while after sunset and because a bright wash over a
near-black basemap turns it to mud rather than gold. That is also why the alphas drop
sharply once past the horizon.

The wash is a MapLibre `background` layer inserted beneath the route, so the route keeps
its true accent colour, and DOM markers sit above the canvas entirely so they never tint.

### Two things worth knowing before changing the map

* **MapLibre v6 ships its tile-parsing worker as a separate module** and resolves it
  against `import.meta.url`, which points nowhere useful once bundled. Without the
  `setWorkerUrl(...)` wiring in `App.jsx` the map builds, loads its style, reports
  itself loaded — and then silently never requests a single tile.
* **Marker `pointer-events` are disabled during a drag, not during any camera move.**
  Follow mode glides the map every few seconds; scoping that rule to all movement made
  every marker unclickable for the duration of each glide.

The previous raster implementation is kept in `.raster-backup/` with restore notes.

On loading, the wins are mostly about not asking third parties for the same bytes twice:
the photo size ladder above, `preconnect` to the tile CDN (~210ms of handshake off the
critical path), one variable font file instead of five static weights loaded off the
critical path, and `@2x` tiles only on screens that can show them.
