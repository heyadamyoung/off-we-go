/**
 * Reading and writing what we found out about a place.
 *
 * The write is one transaction because the three tables are one fact. A place
 * whose links landed and whose pictures did not is a place that claims to
 * have been enriched and shows nothing, and the queue would never look at it
 * again. Either all of it is true or none of it happened.
 */

import { VIEW_WEIGHT } from '../rank.js'
import { markRankSql, weightPairs } from '../store.js'

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
export async function enqueueProminent(
  db,
  { zoom = 13, limit = 500, pipeline = 1, weights = VIEW_WEIGHT } = {},
) {
  /* In the order somebody would want them, which is not the order they were
     inserted in.
   *
   * This was `order by p.label_zoom asc, p.id asc`. The zoom half is right —
   * a place drawn from far out is one people see without looking for it — but
   * the tiebreak was a uuid, which is to say random. Every place at zoom 11
   * queued in an arbitrary order, so a museum and a bus stop on the same
   * street went in by the flip of a hash, and at four hundred at a time it
   * would be days before the museum's turn came up.
   *
   * So the second key is what the place is worth: markRankSql, the same
   * expression that decides which marks a crowded tile keeps and which name
   * survives a collision. Viewpoints, museums, historic sites and galleries
   * carry the weight; launderettes and car parks do not. One taxonomy, spent
   * in a third place rather than restated. */
  const rank = markRankSql(weightPairs(weights, 'the enrichment queue'))
  const { rows } = await db.query(
    `insert into place_enrichment (place_id, status, priority)
     select p.id, 'pending', $3::smallint
       from places p
       left join place_enrichment e on e.place_id = p.id
      where p.label_zoom is not null and p.label_zoom <= $1::real
        and (e.place_id is null or e.pipeline <> $4::smallint)
      order by p.label_zoom asc, ${rank} desc, p.id asc
      limit $2
     on conflict (place_id) do update set
       status = 'pending', pipeline = $4::smallint, next_attempt_at = null
     returning place_id`,
    [zoom, limit, WANTED_SOON, pipeline],
  )
  return rows.map(row => row.place_id)
}

/**
 * How many places the backfill still has to reach, and how many it has.
 *
 * For the census, and for one question it could not answer: the enrichment
 * tables held thirty-three rows on a box holding thirty million places, and
 * "the top-up has only just started" and "the top-up is matching almost
 * nothing" look identical from outside. One indexed count each settles it.
 */
export async function enrichmentBacklog(db, { zoom = 13, pipeline = 1 } = {}) {
  const { rows } = await db.query(
    `select
       (select count(*) from place_enrichment where pipeline = $2::smallint) as held,
       (select count(*) from places p
          left join place_enrichment e on e.place_id = p.id
         where p.label_zoom is not null and p.label_zoom <= $1::real
           and (e.place_id is null or e.pipeline <> $2::smallint)) as owing`,
    [zoom, pipeline],
  )
  return { held: Number(rows[0]?.held ?? 0), owing: Number(rows[0]?.owing ?? 0) }
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
  returning place_id, priority`

/**
 * The places this tick has taken, with what the enricher needs to work.
 *
 * `priority` travels with them: the claim sorts a person waiting on an open
 * card in front of a backfill queued an hour ago, and returning six rows
 * that looked identical meant nothing downstream could tell them apart.
 *
 * It was load-bearing for a while. `fromTableThenOverpass` used it to decide
 * whether a place was worth asking a volunteer API about — a gate that only
 * existed because the chain went through OpenStreetMap at all. It does not
 * any more, so nothing reads this to protect somebody else's service. It is
 * kept because the ordering it records is real, and a claim that sorts by a
 * field and then discards it is a claim you cannot debug.
 */
export async function claimEnrichment(db, count = 4) {
  if (count <= 0) return []
  const claimed = await db.query(CLAIM, [count])
  if (!claimed.rowCount) return []
  const priorities = new Map(claimed.rows.map(row => [row.place_id, Number(row.priority)]))
  const { rows } = await db.query(
    `select p.id, p.name, p.website, p.category,
            ST_Y(p.geom::geometry) as lat, ST_X(p.geom::geometry) as lng
       from places p where p.id = any($1::uuid[])`,
    [[...priorities.keys()]],
  )
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    website: row.website,
    category: row.category,
    lat: Number(row.lat),
    lng: Number(row.lng),
    /* WANTED_NOW when a card is open on it. A row claimed here always has a
       priority; the fallback is for a caller that built a place by hand. */
    priority: priorities.get(row.id) ?? WANTED_SOON,
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

/** How long the one unavoidably expensive count is allowed to take. */
export const CENSUS_BUDGET_MS = 3000

/**
 * The prominent set's size — the only number here that has to touch `places`.
 *
 * On its own, bounded, and null rather than fatal when it will not answer in
 * time. The first production read of the status route timed out at twenty
 * seconds because the census asked this as a CTE and then joined it three
 * times: `label_zoom <= 13` over thirty-five million rows is millions of index
 * entries, and every other count hung off it. A public route that can be taken
 * down by its own denominator is worse than one that says "I could not count
 * that quickly".
 *
 * Its own checked-out client with its own timeout, so a slow count is a null in
 * one field rather than a connection left with a statement_timeout on it for
 * whoever gets it next.
 */
export async function prominentPlaces(db, { zoom = 13, budgetMs = CENSUS_BUDGET_MS } = {}) {
  if (typeof db.connect !== 'function') {
    const { rows } = await db.query(
      `select count(*)::bigint as n from places
        where label_zoom is not null and label_zoom <= $1::real`,
      [zoom],
    )
    return Number(rows[0]?.n ?? 0)
  }
  const client = await db.connect()
  try {
    await client.query('begin')
    await client.query(`set local statement_timeout = ${Math.max(1, Math.floor(budgetMs))}`)
    const { rows } = await client.query(
      `select count(*)::bigint as n from places
        where label_zoom is not null and label_zoom <= $1::real`,
      [zoom],
    )
    await client.query('commit')
    return Number(rows[0]?.n ?? 0)
  } catch {
    /* 57014 is the timeout; anything else here is equally not worth failing a
       status read over. Rolled back so the client goes home clean. */
    await client.query('rollback').catch(() => {})
    return null
  } finally {
    client.release()
  }
}

/**
 * What the enrichment has actually achieved, and whether it did the important
 * places first.
 *
 * Asked entirely of the small tables, which is the fix for the twenty-second
 * timeout the first version earned. `place_enrichment`, `place_descriptions`
 * and `place_images` hold one row per place we have *looked at* — tens of
 * thousands at the very most — while `places` holds a planet. Every question
 * below is answerable from the small side, and the one that is not gets its own
 * bounded query above.
 *
 * The arithmetic that removes the joins: `enqueueProminent` only ever inserts
 * prominent places, so the number of rows in `place_enrichment` for this
 * pipeline *is* the number reached, and what is left to reach is subtraction
 * rather than a left join over millions.
 *
 * And the ordering question — which is the one worth asking, because the
 * backfill's tiebreak was a random uuid for three releases and a planet's worth
 * of launderettes went ahead of the Rijksmuseum. It is asked as a shape rather
 * than a proportion: the zoom a place is drawn from is what makes it prominent,
 * so if the queue is working, the places it has reached cluster at the low
 * zooms and in the categories the map weights. A random order smears them
 * evenly across every zoom instead. Read off the enrichment table's side, so it
 * costs what that table costs and nothing more.
 */
export async function enrichmentCensus(
  db,
  { zoom = 13, pipeline = 1, budgetMs = CENSUS_BUDGET_MS } = {},
) {
  const [prominent, states, words, pictures, shape] = await Promise.all([
    prominentPlaces(db, { zoom, budgetMs }),
    db.query(
      `select status, count(*)::int as n from place_enrichment
        where pipeline = $1::smallint group by status`,
      [pipeline],
    ),
    db.query('select count(*)::int as n from place_descriptions'),
    db.query('select count(distinct place_id)::int as n from place_images'),
    /* The shape of what was reached, from the small side. Joining the
       enrichment rows to their places is bounded by how many we have looked
       at, which is the point. */
    db.query(
      `select p.label_zoom::int as zoom, count(*)::int as n
         from place_enrichment e
         join places p on p.id = e.place_id
        where e.pipeline = $1::smallint and p.label_zoom is not null
        group by p.label_zoom
        order by p.label_zoom asc`,
      [pipeline],
    ),
  ])

  const byStatus = {}
  let reached = 0
  for (const row of states.rows) {
    byStatus[row.status] = Number(row.n)
    reached += Number(row.n)
  }
  const at = key => Number(byStatus[key] ?? 0)
  return {
    /* Null when it would not count in time, and the route says so rather than
       printing a zero it does not believe. */
    prominent,
    reached,
    toReach: prominent === null ? null : Math.max(0, prominent - reached),
    withWords: Number(words.rows[0]?.n ?? 0),
    withPicture: Number(pictures.rows[0]?.n ?? 0),
    ready: at('ready'),
    barren: at('barren'),
    queued: at('pending') + at('stale') + at('working'),
    failed: at('failed'),
    /* Zoom by zoom, lowest first: the ordering check. Working order front-loads
       this at 11 and 12; random order spreads it evenly to 13. */
    byZoom: shape.rows.map(row => ({ zoom: Number(row.zoom), reached: Number(row.n) })),
  }
}
