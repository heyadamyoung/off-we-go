/* Which licences this deployment's places are under, as a fact rather than a
 * question asked on every pan.
 *
 * A map carries one attribution line for the whole layer — that is how OSM
 * data is attributed on every map that carries it, and it is what ODbL asks
 * for. It was computed per viewport: take the places in view, hand their ids
 * to `select distinct license from place_sources where place_id = any(...)`,
 * reduce the answer to at most three notices. That was defensible while a
 * viewport was capped at three hundred pins. The cap is gone — a zoom decides
 * what is drawn and nothing truncates it — so a view over Toronto hands over
 * seventeen hundred uuids to render one sentence that was never going to
 * differ from the sentence for Dublin.
 *
 * The set of licences we hold changes when an ingest writes a licence nobody
 * has written before, which has happened three times in the life of this
 * layer: Overture's CDLA, ODbL for the OpenStreetMap-derived records inside
 * it, and Apache-2.0 if Foursquare is ever read. So it is written where it
 * changes — one statement inside the cell transaction that writes the sources
 * — and read as three rows.
 *
 * Deliberately not derived on read with `select distinct license from
 * place_sources`: that is a scan of every source row on a box holding twelve
 * million places, for an answer of three values.
 *
 * Seeded by the places worker rather than here, because this table is empty
 * on a planet that was loaded before it existed and the seed is the one query
 * this design is avoiding — it belongs in a worker after the release is live,
 * not in the schema step of a deploy.
 */
create table if not exists place_licenses (
  license text primary key,
  /* When this deployment first held data under it. Not shown anywhere; it is
     what makes a surprising row answerable — a licence appearing months after
     the planet was loaded is a source that changed under us. */
  first_seen timestamptz not null default now()
);
