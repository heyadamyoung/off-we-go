/* The places layer: one canonical record per real-world place, merged from
   open data we ingest and own.

   Why PostGIS, when everything else in this database does distance by hand
   (see 032): those are single-point questions over a trip's few dozen stops,
   where a bounding box and the haversine in JavaScript are honest and cheap.
   This table is the planet — tens of millions of rows — and the questions are
   "the twenty nearest cafés" and "does anything match these letters near
   here", answered in under a tenth of a second. That is a k-nearest-neighbour
   index scan, which GiST over geography gives and arithmetic cannot: without
   it every nearby query reads every candidate in the radius and sorts them.
   The image gains PostGIS for this; nothing already written changes.

   Three tables, and a fourth that keeps promises:
     places          — the merged record a traveller sees
     place_sources   — who said what, under which licence, at which version
     place_coverage  — which cells of the world we hold, and how fresh
     place_redirects — where a place went when upstream merged or dropped it,
                       so a stop that points at one never points at nothing. */

create extension if not exists postgis;
create extension if not exists pg_trgm;
create extension if not exists unaccent;

/* unaccent(text) is STABLE — it reads a dictionary that could be reloaded —
   so it cannot be indexed. The two-argument form names the dictionary and is
   IMMUTABLE, which is the documented way to index accent-folded text. One
   wrapper, used by the generated column below and by every search query, so
   the index and the lookup can never disagree about what "Café" folds to. */
create or replace function place_searchable(value text)
returns text language sql immutable parallel safe strict as $$
  select lower(unaccent('unaccent'::regdictionary, value))
$$;

create table if not exists places (
  id uuid primary key default gen_random_uuid(),
  /* Overture's Global Entity Reference System id, where the place has one.
     It is the canonical join key across releases and the thing that makes a
     refresh an update rather than a re-insert. Null for a place only another
     source knows. */
  gers_id text unique,
  name text not null,
  alternate_names text[] not null default '{}',
  geom geography(Point, 4326) not null,
  /* One of the ~20 traveller-facing categories in places/taxonomy.js. The
     upstream string is kept beside it: taxonomies change, and re-deriving our
     category from a stored raw value beats re-downloading the planet. */
  category text not null,
  category_raw text,
  address jsonb,
  website text,
  phone text,
  hours jsonb,
  /* Normalized to 0..1 across sources by places/confidence.js. The floor a
     query applies is a policy decision made there, never here. */
  confidence real not null check (confidence >= 0 and confidence <= 1),
  /* Whether upstream believes it still trades. Null means nobody said. */
  operating text,
  /* The one-degree cell this point falls in, as places/cells.js names it
     ("N52E004"). Coverage, refresh and the fallback all pivot on it. */
  cell text not null,
  first_seen timestamptz not null default now(),
  last_refreshed timestamptz not null default now(),
  /* Accent-folded, lower-cased name for trigram search, kept by the database
     so no writer can forget it. */
  search_name text generated always as (place_searchable(name)) stored
);

/* The geography GiST index is what makes `order by geom <-> $point limit n` a
   k-nearest-neighbour scan rather than a sort of everything in range, and what
   makes ST_DWithin index-accelerated. It is the single most important line in
   this file. */
create index if not exists places_geom_idx on places using gist (geom);
/* Typeahead: trigram similarity over the folded name. GIN because the table is
   read far more than written, and a monthly bulk refresh can afford the build. */
create index if not exists places_search_name_idx on places using gin (search_name gin_trgm_ops);
/* And a prefix index beside it, because a trigram index needs three characters
   to have a trigram at all. Without this a two-letter typeahead can use no
   index on either branch of the search and falls to a sequential scan of the
   whole table — which at seventy-three million rows is minutes, from a single
   GET. text_pattern_ops is what makes `search_name like 'ri%'` an index range
   scan; the column is already folded, so no function sits on the query side. */
create index if not exists places_search_prefix_idx on places (search_name text_pattern_ops);
/* Refresh and coverage both work a cell at a time. */
create index if not exists places_cell_idx on places (cell);
/* Category browsing, best first. */
create index if not exists places_category_idx on places (category, confidence desc);

/* Who told us, and under what licence. One row per source per place, so a
   record merged from three sources carries three attributions and we can say
   exactly which fields each one won. Dropping a source's rows is then a
   delete, not an archaeology exercise. */
create table if not exists place_sources (
  place_id uuid not null references places(id) on delete cascade,
  source text not null,
  license text not null,
  upstream_id text not null,
  /* The dataset release these values came from: Overture's "2026-08-19.0",
     Foursquare's dated release. Refresh compares against it. */
  version text not null,
  confidence real,
  /* Which columns of `places` this source supplied, so the README's merge
     rules can be checked against what actually happened. */
  fields text[] not null default '{}',
  recorded_at timestamptz not null default now(),
  primary key (place_id, source, upstream_id)
);
create index if not exists place_sources_upstream_idx on place_sources (source, upstream_id);

/* One row per one-degree cell we have ingested, or have been asked to.
   This is what tier two consults before a trip needs it and what tier three
   consults before falling back to the network. */
create table if not exists place_coverage (
  cell text primary key,
  west double precision not null,
  south double precision not null,
  east double precision not null,
  north double precision not null,
  status text not null default 'pending'
    check (status in ('pending', 'ingesting', 'ready', 'stale', 'failed', 'empty')),
  /* {"overture": "2026-08-19.0", "fsq": "2026-08-05"} — a cell is stale when
     a source's current release is newer than the one recorded here. */
  versions jsonb not null default '{}'::jsonb,
  place_count integer not null default 0,
  /* The per-ingest quality report: counts by category, share with hours,
     website, phone. Thin data shows up here before a traveller finds it. */
  quality jsonb,
  /* Resumability: how far through the source's row groups this cell got, so a
     planet run that dies at hour six continues rather than restarts. */
  cursor jsonb,
  requested_at timestamptz,
  started_at timestamptz,
  last_refresh timestamptz,
  attempts integer not null default 0,
  error text
);
create index if not exists place_coverage_status_idx on place_coverage (status, requested_at);

/* Upstream merges two records into one, or drops one. A stop that referenced
   the loser must not break, so the old id keeps pointing somewhere: at its
   successor where there is one, and at nothing where the place genuinely
   closed — which is a different, sayable answer from "no such place". */
create table if not exists place_redirects (
  old_id uuid primary key,
  new_id uuid references places(id) on delete cascade,
  reason text not null,
  at timestamptz not null default now()
);

/* A stop may name a place from the layer. It stays nullable on purpose: a
   traveller types "Gran's house" and that is a real stop with no row in any
   open dataset, and always will be. On delete set null so a place vanishing
   upstream never takes somebody's itinerary with it. */
alter table stops add column if not exists place_id uuid references places(id) on delete set null;
create index if not exists stops_place_idx on stops (place_id) where place_id is not null;
