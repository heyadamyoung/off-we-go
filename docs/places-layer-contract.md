# The places layer — build contract

The shared brief for everyone working on `server/src/places/`. It states what
exists, what each piece must do, and the facts already measured so nobody
re-derives them. The prose README for operators is a separate deliverable
(`docs/places-layer.md`); this is the contract between the parts.

## What this is

Search, enrichment and "sights nearby" for a trip anywhere on earth, from open
data we ingest and own. No Google. No metered place API in any runtime path.
No ratings, review text or photographs from anywhere. An unfillable field
stays null.

## Measured facts — use these, do not re-derive

| Fact | Value |
| --- | --- |
| Overture places release | `s3://overturemaps-us-west-2/release/2026-08-19.0/theme=places/type=place/*.parquet` |
| Parts / size / rows | 16 / 10.5 GB / 73,631,092 |
| Releases live at once | 2 (`2026-07-22.0`, `2026-08-19.0`); they expire after ~60 days |
| Release index build | 10.8 s, ~528 KB of JSON for the planet |
| Fallback bbox query, warm | ~300–500 ms (one part, one row group) |
| Fallback bbox query, cold | ~1.7 s — 335 ms HEAD + 907 ms footer + ~500 ms read |
| Page index in Overture files | **none** — a row group (~20k rows, 1.65 MB) is the smallest read |
| Field completeness | address 100%, phone 82.5%, website 46.6% |
| Mean Overture confidence | 0.665 |
| Foursquare OS Places | `s3://fsq-os-places-us-east-1/release/...`, Apache-2.0 |

The absence of a page index is why the serving path is PostgreSQL and the
Parquet reader is only the road in. Do not try to make the fallback fast
enough to serve from; make it rare.

## Stack and house rules

- App root `app/`. Server is Fastify, ESM, plain `.js` with JSDoc types under
  `server/src/`. Client is React + TypeScript under `src/`.
- **The 400-line limit applies only to `src/` (`.ts`/`.tsx`).** `server/src`
  is not checked, but keep modules to one job anyway.
- Filenames kebab-case. British spelling in prose.
- Every module opens with a comment explaining *why it exists and what would
  go wrong without it* — decisions and the bugs they prevent, never a
  restatement of the code. Read `server/src/flights/watch.js` or
  `server/src/places/cells.js` for the register.
- Migrations: `server/migrations/NNN_name.sql`, applied in order and
  checksummed. **Migration 043 is already applied — never edit it.** Add 044+.
- Lint only your own files: `npx biome check --write <paths>`. Then
  `npx tsc --noEmit` from `app/`.
- **Do not edit `package.json`.** Hand the list of test files you added to the
  integrator instead.
- Server tests live in `server/test/*.test.js`, run with
  `TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/wayfare_test node --test server/test/<file>`.
  A test that resets schema must take its own database via
  `server/test/private-database.js`.
- PostGIS 3.4 is installed locally and enabled in `wayfare_test`. Production
  moves to the `postgis/postgis:17-3.5` image.

## Already written — import these, do not reimplement

### `places/cells.js`
The world in 1° cells, keyed `N52E004`. `cellKey(lng, lat)`,
`cellBounds(key) → {west,south,east,north}`, `cellsForBounds(bounds)`,
`cellsForPoints(points)`, `cellsWithin(lng, lat, metres)`,
`missingCells(wanted, covered)`, `isCellKey`, `wrapLongitude`, `clampLatitude`.

### `places/taxonomy.js`
`CATEGORIES` — the twenty: sights, viewpoint, museum, gallery, historic,
religious, nature, beach, food, cafe, bar, market, lodging, shopping,
entertainment, sport, transit, services, health, other.
`categoryFor({basic, leaf}) → string`, `relatedCategories(a, b) → boolean`,
`isCategory(value)`.

### `places/resolve.js`
`MATCH_METRES` 200, `ACCEPT` 0.72, `STRONG_NAME` 0.92.
`metresBetween(a, b)`, `foldName`, `trigrams`, `nameSimilarity(a, b)`,
`categoryAgreement(a, b)`, `matchScore(subject, other)`, `merges(scored)`,
`bestMatch(subject, candidates)`, `mergeFields(records, order)`,
`MERGED_FIELDS`.

### `places/rank.js`
`CONFIDENCE_FLOOR` 0.3, `CATEGORY_WEIGHT`, `weightOf`, `distanceDecay`,
`confidenceFactor`, `nearbyScore`, `rankNearby(places, query)`,
`WIDENING`, `MAX_RADIUS_METRES` 50000, `ENOUGH` 8, `widen(found, attempt, base)`,
`searchScore(row, query)`, `rankSearch(rows, query)`.

### `places/parquet.js`
`createParquetReader({fetch, loadFooter, saveFooter})` →
`{ open(part), readBox(index, bounds, columns, {signal, onGroup}), warmed() }`.
`buildIndex(parts, {fetch})` → `{parts, builtAt}` where each part is
`{url, size, rows, xmin, xmax, ymin, ymax, groups:[{s, e, xmin, xmax, ymin, ymax}]}`.
Also `remoteFile`, `fetchFooter`, `overlaps`, `inside`.

### `places/overture.js`
`COLUMNS`, `placeFromOverture(row, release)`, `placesFromOverture(rows, release)`,
`licensesFor(sources)`, `upstreamIds(sources)`, `OVERTURE_LICENSE`, `OSM_LICENSE`.

### The normalized place every source produces

```js
{
  source: 'overture'|'fsq'|'osm',
  upstreamId, gersId|null,
  name, alternateNames: string[],
  lng, lat, cell,
  category, categoryRaw,
  address: {freeform,locality,region,postcode,country}|null,
  website|null, phone|null, hours|null, operating|null,
  confidence: 0..1,
  licenses: string[], upstreamIds: string[], version
}
```

### Migration 043 (applied)

- `places` — `id uuid pk`, `gers_id unique`, `name`, `alternate_names text[]`,
  `geom geography(Point,4326)`, `category`, `category_raw`, `address jsonb`,
  `website`, `phone`, `hours jsonb`, `confidence real`, `operating`, `cell`,
  `first_seen`, `last_refreshed`, `search_name` (generated, accent-folded).
  Indexes: GiST on `geom`, GIN trigram on `search_name`, btree on `cell` and
  on `(category, confidence desc)`.
- `place_sources` — `(place_id, source, upstream_id)` pk, `license`, `version`,
  `confidence`, `fields text[]`, `recorded_at`.
- `place_coverage` — `cell` pk, `west/south/east/north`, `status`
  (`pending|ingesting|ready|stale|failed|empty`), `versions jsonb`,
  `place_count`, `quality jsonb`, `cursor jsonb`, `requested_at`, `started_at`,
  `last_refresh`, `attempts`, `error`.
- `place_redirects` — `old_id` pk, `new_id`, `reason`, `at`.
- `stops.place_id` — nullable FK, `on delete set null`.
- `place_searchable(text)` — the IMMUTABLE accent-folding function. Every query
  that compares names **must** use it, so lookups and the index agree.

## The three tiers

1. **Ingested** — the normal path, served from `places` by PostGIS. Target p95
   ≤ 100 ms.
2. **Predictive** — a trip created or edited marks the cells its stops touch,
   and ingestion fills them before the traveller arrives. Trip dates give weeks.
3. **Fallback** — a query landing on an uncovered cell is answered from the
   Parquet reader, marked `degraded: true`, and the cell is enqueued. Capped in
   latency and concurrency so it cannot take the API down.

## API shape (all under `/api`)

- `GET /places/search?q=&near=lng,lat&trip_id=&limit=` — prefix + trigram,
  biased to trip geography. Free-text stops with no match stay legal.
- `GET /places/:id` — the full record with provenance and attribution.
- `GET /places/nearby?lat=&lng=&radius=&category=&limit=`.

Every response carries, per record, `confidence`, `sources[]` (source, licence,
upstream id) and the attribution notices the client must render. List responses
carry `degraded` and, when degraded, `coverage: {cell, status}`.

## Non-goals

Star ratings, review text, photographs, guaranteed "open now", booking links.
A licensed premium source may layer on later — keep the per-field source model
open to it, build none of it now.
