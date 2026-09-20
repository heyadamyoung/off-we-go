/**
 * Reading and writing what we found out about a place.
 *
 * The write is one transaction because the three tables are one fact. A place
 * whose links landed and whose pictures did not is a place that claims to
 * have been enriched and shows nothing, and the queue would never look at it
 * again. Either all of it is true or none of it happened.
 */

import { retryAfterMs } from '../retry.js'

/** Somebody is waiting for this one. */
export const WANTED_NOW = 0
/** The backfill of places people see without asking. */
export const WANTED_SOON = 1

/**
 * Put places in the queue. Existing rows keep their state unless this ask is
 * more urgent than the one already there — a person opening a card promotes
 * a place the backfill had merely queued, and never demotes one.
 */
export async function enqueue(db, placeIds, priority = WANTED_SOON) {
  const ids = [...new Set((placeIds ?? []).filter(id => typeof id === 'string' && id))]
  if (!ids.length) return 0
  const { rowCount } = await db.query(
    `insert into place_enrichment (place_id, status, priority, requested_at)
     select id, 'pending', $2::smallint, now() from unnest($1::uuid[]) as id
     on conflict (place_id) do update set
       priority = least(place_enrichment.priority, excluded.priority),
       /* A finished place is not re-queued by being looked at; only a
          pipeline change or an explicit refresh does that. */
       status = case when place_enrichment.status in ('ready', 'barren')
                     then place_enrichment.status else 'pending' end,
       requested_at = case when excluded.priority < place_enrichment.priority
                           then now() else place_enrichment.requested_at end`,
    [ids, priority],
  )
  return rowCount
}

/**
 * Queue the prominent places nobody has asked about yet.
 *
 * "Prominent" is label_zoom, which is already the answer to "would somebody
 * see this without looking for it" — the density pass computed it per square
 * rather than per category, so this is the set that is actually on screen at
 * a glance rather than a guess at which categories matter.
 */
export async function enqueueProminent(db, { zoom = 13, limit = 500, pipeline = 1 } = {}) {
  const { rows } = await db.query(
    `insert into place_enrichment (place_id, status, priority)
     select p.id, 'pending', $3::smallint
       from places p
       left join place_enrichment e on e.place_id = p.id
      where p.label_zoom is not null and p.label_zoom <= $1::real
        and (e.place_id is null or e.pipeline <> $4::smallint)
      order by p.label_zoom asc, p.id asc
      limit $2
     on conflict (place_id) do update set
       status = 'pending', pipeline = $4::smallint, next_attempt_at = null
     returning place_id`,
    [zoom, limit, WANTED_SOON, pipeline],
  )
  return rows.map(row => row.place_id)
}

/* Claimed rather than read, for the same reason the coverage queue is: two
   drains taking the same place both fetch it and both write it. `for update
   skip locked` and the status move in one statement. Priority first, so a
   person waiting on a card goes before a backfill queued an hour ago. */
const CLAIM = `
  with waiting as (
    (select place_id, priority, requested_at from place_enrichment
      where status in ('pending', 'stale')
      order by priority asc, requested_at asc limit $1)
    union all
    (select place_id, 2 as priority, requested_at from place_enrichment
      where status = 'failed' and coalesce(next_attempt_at, requested_at) <= now()
      order by next_attempt_at asc nulls first limit $1)
  ),
  picked as (
    select e.place_id from place_enrichment e
    join waiting w on w.place_id = e.place_id
    order by w.priority, w.requested_at
    limit $1
    for update of e skip locked
  )
  update place_enrichment set status = 'working', started_at = now(),
         attempts = attempts + 1
   where place_id in (select place_id from picked)
  returning place_id`

/** The places this tick has taken, with what the enricher needs to work. */
export async function claimEnrichment(db, count = 4) {
  if (count <= 0) return []
  const claimed = await db.query(CLAIM, [count])
  if (!claimed.rowCount) return []
  const { rows } = await db.query(
    `select p.id, p.name, p.website, p.category,
            ST_Y(p.geom::geometry) as lat, ST_X(p.geom::geometry) as lng
       from places p where p.id = any($1::uuid[])`,
    [claimed.rows.map(row => row.place_id)],
  )
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    website: row.website,
    category: row.category,
    lat: Number(row.lat),
    lng: Number(row.lng),
  }))
}

/**
 * What we found, written down. One transaction, or none of it.
 *
 * The links, description and images are replaced rather than merged: a
 * re-run is the current answer, and leaving a picture behind that this run
 * would not have chosen means the row says one thing and the pipeline says
 * another.
 */
export async function writeEnrichment(db, placeId, outcome, pipeline = 1) {
  const client = await db.connect()
  try {
    await client.query('begin')
    await client.query('delete from place_links where place_id = $1', [placeId])
    for (const link of outcome.links ?? []) {
      await client.query(
        `insert into place_links (place_id, kind, ref, score, method, confirmed_by)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (place_id, kind) do update set
           ref = excluded.ref, score = excluded.score,
           method = excluded.method, confirmed_by = excluded.confirmed_by`,
        [placeId, link.kind, link.ref, link.score, link.method, link.confirmedBy ?? null],
      )
    }

    await client.query('delete from place_descriptions where place_id = $1', [placeId])
    if (outcome.description) {
      const said = outcome.description
      await client.query(
        `insert into place_descriptions
           (place_id, text, lang, source, source_url, license)
         values ($1, $2, $3, $4, $5, $6)`,
        [placeId, said.text, said.lang ?? 'en', said.source, said.sourceUrl, said.license],
      )
    }

    await client.query('delete from place_images where place_id = $1', [placeId])
    for (const image of outcome.images ?? []) {
      await client.query(
        `insert into place_images
           (place_id, url, thumb_url, width, height, author, license, license_url,
            source, source_url, rank)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         on conflict (place_id, url) do nothing`,
        [
          placeId,
          image.url,
          image.thumbUrl,
          image.width,
          image.height,
          image.author,
          image.license,
          image.licenseUrl,
          image.source,
          image.sourceUrl,
          image.rank ?? 0,
        ],
      )
    }

    /* Upserted rather than updated. A place enriched without having been
       queued — the first person to open a card for it, before the backfill
       ever reached it — has no row to update, and an UPDATE that matches
       nothing writes the pictures and loses the fact that we found them. */
    await client.query(
      `insert into place_enrichment
         (place_id, status, priority, finished_at, error, attempts, next_attempt_at, pipeline)
       values ($1, $2, $5::smallint, now(), $3, 0, null, $4::smallint)
       on conflict (place_id) do update set
         status = excluded.status, finished_at = now(), error = excluded.error,
         attempts = 0, next_attempt_at = null, pipeline = excluded.pipeline`,
      [placeId, outcome.status, outcome.reason ?? null, pipeline, WANTED_SOON],
    )
    await client.query('commit')
  } catch (error) {
    await client.query('rollback').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

/** A failure waits its turn again. It is never abandoned — see retry.js. */
export async function failEnrichment(db, placeId, error) {
  const { rows } = await db.query('select attempts from place_enrichment where place_id = $1', [
    placeId,
  ])
  const attempts = Number(rows[0]?.attempts ?? 1)
  await db.query(
    `update place_enrichment
        set status = 'failed', error = $2,
            next_attempt_at = now() + make_interval(secs => $3::double precision)
      where place_id = $1`,
    [placeId, String(error?.message || error).slice(0, 500), retryAfterMs(attempts) / 1000],
  )
}

/** Everything known about one place, for its card. */
export async function readEnrichment(db, placeId) {
  const [said, pictures, state] = await Promise.all([
    db.query(
      'select text, lang, source, source_url, license from place_descriptions where place_id = $1',
      [placeId],
    ),
    db.query(
      `select url, thumb_url, width, height, author, license, license_url, source, source_url
         from place_images where place_id = $1 order by rank asc`,
      [placeId],
    ),
    db.query('select status from place_enrichment where place_id = $1', [placeId]),
  ])
  const row = said.rows[0]
  return {
    status: state.rows[0]?.status ?? null,
    description: row
      ? {
          text: row.text,
          lang: row.lang,
          source: row.source,
          sourceUrl: row.source_url,
          license: row.license,
        }
      : null,
    images: pictures.rows.map(image => ({
      url: image.url,
      thumbUrl: image.thumb_url,
      width: image.width,
      height: image.height,
      author: image.author,
      license: image.license,
      licenseUrl: image.license_url,
      source: image.source,
      sourceUrl: image.source_url,
    })),
  }
}
