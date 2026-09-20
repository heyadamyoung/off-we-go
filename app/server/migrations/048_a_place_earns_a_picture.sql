/* Pictures and descriptions, for the places that warrant them.
 *
 * Overture is a place identity dataset: a name, a point, a category, a
 * website. It has no descriptions and no photographs, and measured on the
 * Paris degree it has no route to any either — 8 of 302,980 records mention
 * OpenStreetMap, and `brand.wikidata` is on 2.8% and is the brand rather than
 * the place, so it offers a Starbucks logo and nothing at all for
 * Notre-Dame. Enrichment is a separate pipeline or it does not happen.
 *
 * The chain is deliberately not a guess at Wikidata. It is one fuzzy match to
 * OpenStreetMap, and from there the links are declared by human editors:
 * `wikidata=*`, `wikipedia=*`, `wikimedia_commons=*`, `image=*`. One
 * uncertain hop buying a curated chain beats four uncertain hops, and OSM
 * gives us a stable id to write down, so a match can be re-checked later
 * rather than re-guessed.
 *
 * Two tiers, one queue. A place that earns a low label_zoom is one somebody
 * sees without looking for it, and there are few enough of them to fetch
 * ahead of being asked — 1,409 in the Paris degree at zoom 11, 12,498 at 13
 * or better. Everything else is enriched the first time somebody opens its
 * card, at a priority that jumps the backfill, because then there is a person
 * waiting.
 */

/* What we decided this place is, in each of the vocabularies that carry
   content. Its own table rather than columns on `places` because it is the
   audit trail: how the match was made, what it scored, and whether anything
   independent confirmed it. A bad picture is traced back through this. */
create table if not exists place_links (
  place_id uuid not null references places(id) on delete cascade,
  /* osm | wikidata | wikipedia | commons */
  kind text not null,
  /* 'node/1234', 'Q209507', 'en:Edinburgh Castle', 'Category:Edinburgh Castle' */
  ref text not null,
  /* 0..1 from places/resolve.js for a match we made; null for one OSM
     declared, because a human wrote that down and it is not ours to score. */
  score real,
  /* website | name+geo | declared */
  method text not null,
  /* What agreed independently, if anything. A name-and-distance match that
     the official website also agrees with is a different kind of true from
     one that nothing corroborates. */
  confirmed_by text,
  linked_at timestamptz not null default now(),
  primary key (place_id, kind)
);

/* One description per place, in one language, said by somebody we may quote.
   `license` is not decoration: enrich/licenses.js refuses to store a record
   whose licence it does not recognise, so a row being here is the claim that
   we checked. */
create table if not exists place_descriptions (
  place_id uuid primary key references places(id) on delete cascade,
  text text not null,
  lang text not null default 'en',
  source text not null,
  source_url text,
  license text not null,
  retrieved_at timestamptz not null default now()
);

/* Pictures, best first. Several, because one file can be a poor crop and the
   client picks; `rank` is the order the pipeline put them in. Everything
   needed to render the notice is on the row — an image whose author or
   licence we could not read was never written. */
create table if not exists place_images (
  place_id uuid not null references places(id) on delete cascade,
  url text not null,
  thumb_url text,
  width int,
  height int,
  author text,
  license text not null,
  license_url text,
  source text not null,
  source_url text,
  rank smallint not null default 0,
  retrieved_at timestamptz not null default now(),
  primary key (place_id, url)
);

create index if not exists place_images_place_idx on place_images (place_id, rank);

/* The queue, with the same three-way honesty as place_coverage: `barren`
   means we looked and there is genuinely nothing, which is a different answer
   from `failed` and from never having asked. Without it every place with no
   Wikipedia article is retried for ever. */
create table if not exists place_enrichment (
  place_id uuid primary key references places(id) on delete cascade,
  status text not null default 'pending',
  /* 0 somebody is waiting, 1 the prominent backfill. A person beats a batch. */
  priority smallint not null default 1,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  attempts int not null default 0,
  /* As in place_coverage: a failure waits rather than being abandoned. */
  next_attempt_at timestamptz,
  error text,
  /* Bumped when the shape of what we fetch changes, so old rows re-run. */
  pipeline smallint not null default 1
);

/* The claim reads this every tick: what is waiting, most wanted first. */
create index if not exists place_enrichment_queue_idx
  on place_enrichment (priority, requested_at)
  where status in ('pending', 'stale');

create index if not exists place_enrichment_retry_idx
  on place_enrichment (next_attempt_at nulls first)
  where status = 'failed';

/* Finding the prominent places that have never been asked about. Partial on
   the zoom, so it is small: the planet has tens of millions of places and
   this index covers only the ones anybody sees at a glance. */
create index if not exists places_prominent_idx
  on places (label_zoom, id)
  where label_zoom is not null and label_zoom <= 13;

/* The OpenStreetMap objects worth matching against, in our own database.
 *
 * Overpass is a volunteer service with rate limits, and the standing rule for
 * this layer is that no third-party service sits between a traveller and
 * their map. Backfilling millions of prominent places through somebody
 * else's API would break both. So the objects we care about are loaded here
 * once from a planet extract and matched against locally, which is a spatial
 * join rather than a network call.
 *
 * "Worth matching against" is a small set: an OSM object earns a row only if
 * it carries something this pipeline can actually use — a wikidata tag, a
 * wikipedia tag, a Commons category, an image, or a description. That is a
 * couple of million objects worldwide rather than the hundreds of millions
 * in the full planet, and it is exactly the set that can produce a picture.
 *
 * Overpass stays, for one case: a place somebody opens that the extract
 * predates. One request for one place, with a person waiting, is what that
 * service is for.
 */
create table if not exists osm_landmarks (
  /* 'node/1234', 'way/5678', 'relation/9012' — the id people paste. */
  id text primary key,
  name text,
  geom geography(Point, 4326) not null,
  category text,
  website text,
  wikidata text,
  wikipedia text,
  commons text,
  description text,
  loaded_at timestamptz not null default now()
);

create index if not exists osm_landmarks_geom_idx on osm_landmarks using gist (geom);
