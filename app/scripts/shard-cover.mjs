/* Which browser shards have no runner yet, and whether this one's tests
   were run for it.

   A runner is sometimes handed a job forty seconds after the rest of the
   run has begun — one job in perhaps every other run, any of them — and
   the deploy waited on it: a shard's own work is under a minute, so the
   late one was the whole test phase. The shards that were given machines
   on time cover for the one that was not.

   Twenty seconds into the run, each punctual shard asks which sibling
   shards have not started, takes a fixed share of each such sibling's deal
   on top of its own (see `cover` in shard-tests.mjs), and says so with a
   marker artifact named for the shards it covered. The late shard, when
   its machine arrives, looks for a marker from every sibling and runs
   nothing if they are all there. If any is missing — a sibling that asked
   too late to see it as late, or whose marker never landed — it runs its
   own deal, and a test is run twice rather than not at all. Nothing here
   can lose a test: a shard runs its own deal unless every other shard has
   said in writing that it ran a share of it.

     node scripts/shard-cover.mjs <count> <index>    (index from 1)

   prints `late=` (the late siblings, dash-joined) and `skip=` (yes when
   this shard is late and covered) for the workflow's step outputs, and
   writes covered.txt for the marker. Anything that goes wrong on the way
   — no token, an API that will not answer — prints neither, and the shard
   runs its own deal as it always did. */
import { writeFile } from 'node:fs/promises'

/** How long after the run's first job was created a shard may start and
    still count as punctual. On time is three to five seconds; late is
    forty. */
export const PUNCTUAL_MS = 20_000

/** The shard a job's name denotes, or null for any other job. */
export function shardOf(name) {
  const found = /^Browser tests \((\d+) of \d+\)$/.exec(name || '')
  return found ? Number(found[1]) : null
}

/** Who is late, judged from the run's jobs: a shard that has not started, or
    started more than `punctualMs` after the run's first job was created. A
    job has started when it says so, not when it carries a start time: a
    queued job has been seen to carry the time it was queued. */
export function judge({ jobs, me, punctualMs = PUNCTUAL_MS }) {
  const origin = Math.min(...jobs.map(job => Date.parse(job.created_at)))
  const started = new Map()
  for (const job of jobs) {
    const shard = shardOf(job.name)
    const running = job.status === 'in_progress' || job.status === 'completed'
    if (shard) started.set(shard, running && job.started_at ? Date.parse(job.started_at) : null)
  }
  const delay = shard => {
    const at = started.get(shard)
    return at == null ? Number.POSITIVE_INFINITY : at - origin
  }
  const late = [...started.keys()].filter(shard => shard !== me && delay(shard) > punctualMs)
  return { mine: delay(me) > punctualMs ? 'late' : 'punctual', late: late.sort((a, b) => a - b) }
}

/** The marker a punctual shard leaves: the shards it covered, and itself. */
export const marker = (late, me) => `cover-${late.join('-')}-by-${me}`

/** Whether every other shard has left a marker that names this one. */
export function covered({ me, count, artifacts }) {
  const by = new Set()
  for (const { name } of artifacts) {
    const found = /^cover-([\d-]+)-by-(\d+)$/.exec(name || '')
    if (found?.[1].split('-').map(Number).includes(me)) by.add(Number(found[2]))
  }
  for (let shard = 1; shard <= count; shard++) {
    if (shard !== me && !by.has(shard)) return false
  }
  return true
}

async function fetchAll(path) {
  const api = process.env.GITHUB_API_URL || 'https://api.github.com'
  const response = await fetch(
    `${api}/repos/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}/${path}?per_page=100`,
    {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        'x-github-api-version': '2022-11-28',
      },
    },
  )
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`)
  return response.json()
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ''))) {
  const [count, me] = process.argv.slice(2).map(Number)
  let late = []
  let skip = false
  try {
    if (!process.env.GITHUB_TOKEN) throw new Error('no GITHUB_TOKEN')
    const verdict = judge({ jobs: (await fetchAll('jobs')).jobs, me })
    if (verdict.mine === 'punctual') {
      late = verdict.late
      if (late.length) await writeFile('covered.txt', `${late.join('\n')}\n`)
    } else {
      skip = covered({ me, count, artifacts: (await fetchAll('artifacts')).artifacts })
    }
    process.stderr.write(
      verdict.mine === 'punctual'
        ? `shard ${me} of ${count} is punctual; late: ${late.length ? late.join(', ') : 'none'}\n`
        : `shard ${me} of ${count} is late; ${skip ? 'covered by every other shard, running nothing' : 'not covered by every other shard, running its own deal'}\n`,
    )
  } catch (error) {
    process.stderr.write(
      `::warning::could not ask about the other shards, running this one's own deal: ${error.message}\n`,
    )
    late = []
    skip = false
  }
  process.stdout.write(`late=${late.join('-')}\nskip=${skip ? 'yes' : ''}\n`)
}
