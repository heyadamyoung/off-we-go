/* A tile is built once and then it is a lookup.
 *
 * Reported from the road: panning across a large part of the map is "slow as
 * fuck", with the ask that we load everything up front instead. The whole of
 * the places layer is seventy-three million rows and about fifty gigabytes,
 * so "everything" is not a thing a browser can hold — but the complaint was
 * right about what it feels like, and the cause is here rather than in the
 * browser.
 *
 * Every tile was a query: a bounding-box scan over the geography index, a
 * CASE per row for the zoom and the rank, a sort, a limit, and a protobuf
 * encode. For a dense tile that is tens of thousands of rows touched to
 * produce at most forty-eight places. One is a few hundred milliseconds; a
 * fast pan across a country asks for dozens at once, and they queue behind
 * each other on the one database this box has.
 *
 * Every map that is quick serves tiles that already exist. So do we now: the
 * first request for a square builds it and writes it here, and every request
 * after — from anybody, on any device — is a primary key lookup returning
 * bytes. The places worker builds them ahead of being asked as it ingests, so
 * in the normal case nobody pays the first one either.
 *
 * The bytes are the whole point: this is not a cache of rows to re-encode, it
 * is the encoded tile. A hit does no geometry work at all.
 */

create table if not exists place_tiles (
  /* The slippy-map address, which is the whole key. */
  z smallint not null,
  x integer not null,
  y integer not null,
  /* The encoded vector tile. Empty for a square of the world with nothing in
     it — which is a real answer worth remembering, because the sea is most of
     the planet and re-deciding that it is empty is the same query as deciding
     a city is full. */
  body bytea not null,
  /* How many places went into it, for an operator asking why a square looks
     thin without decoding a protobuf to find out. */
  places integer not null default 0,
  built_at timestamptz not null default now(),
  primary key (z, x, y)
);

/* Sweeping a re-ingested cell's tiles means asking which tiles overlap a
   box, and that is a geometry question over ST_TileEnvelope. Kept as a plain
   index on z so the sweep at least reads one zoom at a time rather than the
   whole table per zoom; the sweep runs once per cell ingested, not per
   request, so this is as much index as it is worth. */
create index if not exists place_tiles_z_idx on place_tiles (z);
/* And by age, for the one operational question this table invites: what is
   stale, and how much of it. */
create index if not exists place_tiles_built_idx on place_tiles (built_at);
