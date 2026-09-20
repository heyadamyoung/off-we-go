# The places layer

Search, enrichment and "sights nearby" for a trip anywhere on earth, from open
data we ingest and own. This is the operator's document: what it is made of,
how to refresh it, what it obliges us to say, and what it costs.

The build contract for the code is `places-layer-contract.md`. The client-side
migration is `places-client-migration.md`.

## What it is not

No Google Maps or Places API, anywhere, ever. No metered third-party place API
in any runtime path. No scraping. No ratings, no review text, no photographs —
we are not licensed to store them and do not pretend otherwise. A field we
cannot fill stays null rather than being filled with something that looks
right.

## The three tiers

**1. Ingested.** The normal path. Every place lives in our own PostgreSQL and
is served from it. Target p95 under 100 ms; measured far below (see
*Measurements*).

**2. Predictive.** A trip created or edited marks the one-degree cells its
stops touch. Anything missing or stale is queued. Trip dates give weeks of
lead time, and the queue is ordered by which trip starts soonest, so the
places for a journey are in place long before anybody lands.

**3. Fallback.** A query that lands on a cell we have not ingested is answered
by reading Overture's Parquet directly over HTTPS, marked `degraded: true`, and
the cell is queued. Slow but never empty. This tier exists so that a paying
customer planning a trip to somewhere we did not anticipate gets an answer
rather than a dead end — and so that we find out, through the fallback-rate
metric, that our coverage was wrong.

## Why PostGIS

Everything else in this database does distance by hand, deliberately (see
migration 032): over a trip's few dozen stops, a bounding box and a haversine
in JavaScript are honest and cheap.

This table is different in kind. It is the planet — seventy-three million rows
— and the questions are "the twenty nearest cafés" and "does anything match
these letters near here". That is a k-nearest-neighbour index scan, which GiST
over `geography` provides through the `<->` operator and arithmetic cannot:
without it every nearby query reads every candidate inside the radius and sorts
them, which is fine at a thousand rows and hopeless at seventy-three million.

The alternative considered and rejected was `cube` + `earthdistance`, which
ships with the stock image and can do an index-accelerated radius search. It
cannot order by distance through the index, so the sparse-area widening — the
thing that makes rural coverage work — would degrade into sorting a large
result set. PostGIS also gives a spheroid rather than a sphere, which matters
at the distances the widening ladder reaches.

The cost is one line of `docker-compose.yml`: `postgres:17-alpine` becomes
`postgis/postgis:17-3.5-alpine`. Same PostgreSQL major, same Alpine base, so
the data volume carries over untouched and migration 043 creates the extension
on first boot. CI's throwaway database uses the same image.

## Why a one-degree grid

Coverage needs a region key that answers three questions cheaply: which region
is this point in, which regions does this trip touch, and what are this
region's bounds.

Named regions (the Geofabrik extracts the routing engine uses) answer the first
two only by point-in-polygon against a downloaded index, and their sizes differ
by four orders of magnitude — Vatican City and Russia are both "a region", so
"ingest the region this stop is in" means anything from a second to a day.

A fixed grid answers all three with arithmetic, is the same everywhere, and
turns a planet run into a queue of comparable units that can be retried one at
a time. One degree is about 111 km tall, which is a comfortable "around here",
and small enough that ingesting one on demand is seconds. The planet is 64,800
cells, of which roughly 25,000 contain any land.

Keys read as a position: `N52E004`, `S34W059`. Floor semantics, so cells tile
without gaps. **Cells share their edges**, so a place exactly on a boundary
would fall in two: ingestion filters by the cell `cellKey()` computes for each
place, which assigns every point to exactly one. This is not a detail — it was
a live duplicate-key failure the first time two adjacent cells were loaded.

## The data model

- **`places`** — the merged record a traveller sees. Our own stable UUID is
  the only id anything else references. `gers_id` is Overture's Global Entity
  Reference System id where the place has one, and is the join key that makes a
  refresh an update rather than a re-insert.
- **`place_sources`** — one row per source per place: which dataset, which
  licence, which upstream id, which release, and which fields that source won.
  A record merged from three sources carries three attributions.
- **`place_coverage`** — one row per cell: status, the source releases
  ingested, the place count, the quality report, and a resume cursor.
- **`place_redirects`** — where a place went when upstream merged or dropped
  it. A stop that points at a place must never point at nothing.

`stops.place_id` is nullable on purpose and always will be. A traveller typing
"Gran's house" is creating a real stop that no open dataset contains. The
search is an offer, never a gate.

## Merge rules

Two sources describing the same shopfront must become one record, and merging
them wrongly is worse than not merging: two pins forty metres apart is untidy,
but one pin carrying the other's phone number is a lie somebody rings.

Three signals, fixed weights, written down in `places/resolve.js`:

| Signal | Weight | Notes |
| --- | --- | --- |
| Name similarity | 0.5 | Dice coefficient over character trigrams of accent-folded names |
| Proximity | 0.3 | Linear inside a hard 200 m gate; beyond it, different places |
| Category agreement | 0.2 | Same, related (one family), or contradictory |

Nothing merges below 0.72. Names 0.92 alike within 120 m merge regardless of
category, because a museum filed as a shop is a miscategorised museum rather
than a second building. Ties break on the upstream id, so the same inputs
always produce the same output whatever order they arrive in — a merge that
depends on iteration order cannot be reproduced when it goes wrong.

Per field, the winner is the most confident source that has a value at all: a
low-confidence record with a phone number still knows the phone number, and
taking a blank from a confident one loses information for nothing. Alternate
names gather from every source rather than competing. The position comes from
the most confident source and is never averaged — averaging two coordinates
puts the pin in the road between them.

## Licensing and what we must say

Licence is a per-record fact, not a per-dataset one, because Overture's rows
are themselves merges.

| Source | Licence | Obligation |
| --- | --- | --- |
| Overture places | CDLA-Permissive-2.0 | None beyond keeping the notice |
| …where the record came from OpenStreetMap | ODbL-1.0 | **Must attribute**: "© OpenStreetMap contributors" |
| Foursquare OS Places | Apache-2.0 | Keep the notice |

`places/overture.js` decides which apply by reading each record's `sources`
list, and stores them per record in `place_sources.license`. The client
deduplicates to one notice per licence and renders it wherever those records
are shown. A record whose licence we cannot establish is not ingested.

Overture release URLs expire after about sixty days and two releases are live
at a time. A stored release identifier must never be assumed still to resolve;
the refresh re-discovers and says loudly when the pinned release has gone.

## Refreshing

Monthly, when Overture publishes.

1. Discover the newest release and build its index (about eleven seconds and
   half a megabyte for the planet — cached, so queries never pay for it).
2. Cells whose recorded source version is older than the new release become
   `stale`.
3. Stale cells are re-ingested into a staging table and swapped in one
   transaction, so readers never see a half-loaded cell.
4. Places that vanished or merged upstream get a `place_redirects` row rather
   than a silent delete, so stops keep resolving.
5. Each cell writes a quality report: counts by category, and the share with a
   website, a phone, an address and hours. Thin data shows up here before a
   traveller finds it.

Ingestion is resumable a cell at a time: a run that dies at hour six re-runs
only the cells it had not finished, because a cell's whole load is one
transaction and `--resume` skips the ones already `ready` or `empty`. The
`place_coverage.cursor` is a note about where a cell had got to, for reading
after the fact — it is not a restart point inside a cell. Ingestion is
idempotent: running the same cell twice leaves the same rows.

```
node server/scripts/places-ingest.mjs --cells N52E004,N51E004
node server/scripts/places-ingest.mjs --bbox 4,52,5,53
node server/scripts/places-ingest.mjs --planet --resume
```

### The sweep

Asking cell by cell is the wrong question for anything bigger than a country.
A row group is the smallest thing Parquet can read, neighbouring cells share
groups, and so the same bytes are fetched over and over: measured against
2026-08-19.0, Amsterdam's square touches 14 row groups and reads about 37 MB,
Toronto's touches 22 and reads 61 MB, and **asking all 53,333 candidate cells
in turn reads about 190 GB to fetch a release that is 10.5 GB**.

`--sweep` turns the question round. It walks the 4,096 row groups in file
order, reads each one exactly once, and posts its rows into the cells they
fall in; a cell is written the moment the last group overlapping it has been
read, which the index knows before a byte is fetched. Each cell then goes
through the ordinary load — same transaction, same collapse guard, same
redirects, same tile sweep — so it is the same ingest reading in a better
order, not a second implementation. `server/src/places/sweep.js`.

```
node server/scripts/places-ingest.mjs --planet --sweep --resume    # pnpm places:sweep
node server/scripts/places-ingest.mjs --bbox 3,50,8,54 --sweep
```

Proved rather than asserted: the same nine cells loaded both ways give
**971,789 places either way, row for row, with identical coverage and quality
rows** (`server/test/places-sweep.test.js` runs the comparison on every CI
run against a real PostGIS). The sweep took 134 s and 123 MB; cell by cell
took 217 s and 193 MB, and the gap widens with the number of cells because
the re-read factor does.

Two properties worth knowing. It is single-source: two sources have to be
clustered together inside a cell, so `loadSwept` refuses outright rather than
loading one of them and deleting what the other said. And a cell no row group
touches — open sea — is written `empty` rather than skipped, because a cell
with no coverage row is one the map reports as still loading for ever.

Interrupting is supported: the group in flight finishes, cells still open are
abandoned unwritten, and `--resume` reads only the groups that still owe
somebody rows.

#### When a read fails

The rule the whole thing protects is that **a failed read must never become a
loaded cell** — a cell built from a short read has quietly lost part of a city
and the collapse guard cannot see the difference. Everything else is about
making sure that rule does not also cost the planet.

There is no attempt count. A row group is asked for again with the delay
doubling from 1s to a ceiling of 60s, for up to ten minutes, so a link that is
down for a minute and a half costs a minute and a half. Two things end that,
and neither ends the run:

| | what happens | why |
| --- | --- | --- |
| The release moved | the run stops, exits non-zero | Overture deletes a release at about sixty days; every later read 404s, so asking again is a hot loop. The restart discovers the new release and carries on — self-healing, not a failure. |
| The group will not decode | set aside; its cells stay **unwritten**, the walk carries on | a decode that throws the same way every time is not waiting on anything. The other 4,095 groups have nothing to do with it. |

Nothing is abandoned by either path. Cells left unwritten keep whatever
coverage they had, so `--resume` reads exactly the groups that still owe
somebody rows.

The exit code is the contract with the supervisor: **non-zero means there is
more to do and it is worth doing again**, zero means the planet is loaded —
or that a run made no progress at all, which is a thing to look at rather than
to retry. The compose service runs `restart: on-failure`, so a crash, an
out-of-memory kill, a reboot and a deleted release all come back by
themselves, and a finished sweep stays finished. That restart is the retry of
last resort and the only one a bug in `sweep.js` cannot defeat.

## The drain

Nothing above happens on its own unless something reads the queue. On the box
that serves queries, that is `places/worker.js`, started from the server's
entrypoint beside the media worker and the travel watch.

Once a minute it takes a few cells, ingests them, and sleeps. Specifically:

- **A few cells a tick.** `PLACES_CELLS_PER_TICK`, four by default. A cell is
  seconds of network and one transaction, and a queue of four hundred drained
  flat out is the API server reading Parquet instead of answering people.
- **A claim, not a read.** The cells are moved to `ingesting` in the same
  statement that selects them, under `for update skip locked`, so two drains —
  two boxes, or a box and somebody's terminal — cannot take the same cell.
- **Five attempts.** A cell that fails for a reason that will not change keeps
  its old `requested_at` and would otherwise sort to the front of the queue
  for ever. After five it is left alone with its error on the row.
- **Half an hour to reclaim.** `started_at` is a heartbeat: the ingest moves
  it every couple of seconds while it reads. An `ingesting` row older than
  that belonged to a process that is gone, and goes back in the queue.
- **Eight cells a tick marked stale** when a new release appears, oldest
  refresh first — so a publication is a slow tide rather than the whole map
  going degraded at once while the queue catches up.

Switches: `PLACES_UPSTREAM=off` turns off the third tier and the drain with it
(there would be nothing to ingest from); `PLACES_WORKER=off` turns off only the
drain, for the day this work lives somewhere that is not the web node;
`PLACES_RELEASE` pins a release; `PLACES_INDEX_DIR` is where release indexes
and Parquet footers are cached, shared with the ingest script so a planet run
leaves the footers warm for the server.

### When a cell is stuck

```sql
-- what the queue looks like
select status, count(*) from place_coverage group by status;

-- the ones that have given up, and why
select cell, attempts, error, requested_at from place_coverage
where status = 'failed' order by requested_at limit 20;

-- put one back in the queue by hand
update place_coverage set status = 'pending', attempts = 0, error = null
where cell = 'N50W105';
```

A cell in `ingesting` with a recent `started_at` is being worked on; leave it.
One with an old `started_at` is reclaimed automatically within half an hour.

Two failures worth recognising by sight. `refusing to load it` means the read
came back with less than half of what the cell already holds — a truncated
read, not a town that emptied — and the cell was left exactly as it was; retry
it, and if it repeats, the release or the network is the problem, not the data.
`place_coverage.quality` disagreeing with `place_count` would mean the opposite
and cannot now happen, because such a read is refused rather than half loaded.

## Operations

**Disk.** Measured over 2,185,041 real rows rather than extrapolated from one
cell: `places` and its four indexes come to 761 bytes a row, `place_sources`
to another 402, so **1,191 bytes per place all in**. Seventy-three million
rows is therefore **about 88 GB**, and the box wants headroom above that for
index builds, WAL and refresh churn: **130 GB** is a comfortable allowance for
the planet, 20 GB for a continent. The production box has 544 GB free.

Leave the indexes up. Dropping the trigram indexes for a bulk load used to be
the advice here and `--planet` did it automatically; it is now `--drop-indexes`
and asked for, because it was measured and it is not worth what it costs. Nine
dense cells swept with every index live loaded 971,789 places in 134 seconds —
7,250 a second, which puts the whole planet under three hours. Dropping them
buys a fraction of that and makes place search a sequential scan of a growing
table for the whole run, which on a deployment people are using while
travelling is the worse trade.

**Backup and restore.** The places tables are derived data: they can be rebuilt
from open sources in hours, and they are the largest thing we run. So they are
excluded from the application backup, which stays small and fast, and are
restored by re-ingesting. What must be backed up is `place_coverage` (so a
rebuild knows what to fetch) and `place_redirects` (which cannot be rederived,
because it records history). Both are tiny.

A dev copy is one cell:
`node server/scripts/places-ingest.mjs --cells N52E004` — about fifteen seconds
and 115 MB, against a local PostGIS.

**Metrics.** Ingest duration and failures, coverage gaps hit, fallback rate,
query latency. **Alert on the fallback rate rising**: it means coverage or
freshness has slipped, and it is the only signal that tells us before a
traveller does.

## Measurements

All against Overture release 2026-08-19.0, from this development machine.

### The source

| | |
| --- | --- |
| Parts / size / rows | 16 / 10.5 GB / 73,631,092 |
| Release index build | 10.8 s, 528 KB |
| Field completeness | address 100%, phone 82.5%, website 46.6% |
| Mean confidence | 0.665 |

### Ingest, one dense cell (N52E004, Amsterdam)

| Step | Time |
| --- | --- |
| Read from S3 | 9.6 s |
| COPY into PostGIS | 2.5 s |
| Build four indexes | 2.7 s |
| **Total** | **14.8 s for 168,523 places** |

### The sweep, nine dense cells (Randstad and the Ruhr)

| | Sweep | Cell by cell |
| --- | --- | --- |
| Places loaded | 971,789 | 971,789 |
| Wall clock | 134 s | 217 s |
| Off the network | 123 MB | 193 MB |
| Row groups read | each once | once per overlapping cell |

Projected from that rate, with indexes live: **the planet in under three
hours and 10.5 GB**, against 190 GB and days the other way.

### Serving (tier 1), 168,523 places

| Query | p50 | p95 |
| --- | --- | --- |
| nearby, 1 km radius, 40 rows | 1.5 ms | 2.6 ms |
| nearby, dense city centre | 22.1 ms | 23.4 ms |
| search, trigram typeahead | 17.3 ms | 32.2 ms |
| search, biased to trip geography | 17.4 ms | 32.0 ms |

### Fallback (tier 3)

| | |
| --- | --- |
| Cold | ~1.7 s — 335 ms size probe, 907 ms footer, ~500 ms read |
| Warm | ~300–500 ms |

The cold cost is paid once per Parquet part and then cached: the size probe is
avoided entirely by keeping byte lengths in the release index, and the footer
is cached in memory and on disk. What cannot be improved is the read itself —
**Overture's files carry no page index**, so a row group of about twenty
thousand rows and 1.65 MB is the smallest unit that can be read, and a query
wanting six hundred of them still reads all twenty thousand. That is the floor
for querying the published files, and it is the reason the serving path is
PostgreSQL and this tier exists only to avoid dead ends.

## Known limits

- Overture publishes no opening hours for places, so `hours` is null for every
  Overture-sourced record. It is kept in the schema because Foursquare and OSM
  do publish some.
- Confidence is Overture's own for Overture records and derived for others;
  derived values are visibly derived and the formula is in `places/fsq.js`.
- The search index is global. At planet scale a trigram search over seventy-
  three million names is materially slower than over one city, which is why a
  search carrying a trip is filtered to that trip's cells first.
