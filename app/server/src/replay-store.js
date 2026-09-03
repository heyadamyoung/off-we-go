/* Where watched-back sessions live: one JSONL file per session on the VPS
   disk, one line per uploaded chunk. Self-hosted on purpose — these
   recordings show a family's GPS trail and photographs, and they belong on
   the family's own server, watched only by its owner, gone in a fortnight. */

import { appendFile, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises'
import path from 'node:path'

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const MAX_SESSION_BYTES = 60_000_000 // a marathon session ends quietly, not hugely
export const KEEP_DAYS = 14

/** The shape the browser may upload, or null. Everything else is a 400. */
export function validChunk(body) {
  if (!body || typeof body !== 'object') return null
  const { session, seq, events } = body
  if (typeof session !== 'string' || !SESSION_ID.test(session)) return null
  if (!Number.isInteger(seq) || seq < 0 || seq > 100_000) return null
  if (!Array.isArray(events) || !events.length || events.length > 5_000) return null
  return { session, seq, events }
}

export function createReplayStore({ directory, clock = () => new Date() }) {
  const fileFor = (userId, session) => path.join(directory, `${userId}__${session}.jsonl`)

  return {
    async append(userId, chunk) {
      await mkdir(directory, { recursive: true })
      const file = fileFor(userId, chunk.session)
      const size = await stat(file)
        .then(s => s.size)
        .catch(() => 0)
      if (size > MAX_SESSION_BYTES) return false // full; the tail is dropped
      const line = JSON.stringify({ seq: chunk.seq, at: clock().getTime(), events: chunk.events })
      await appendFile(file, line + '\n')
      return true
    },

    async sessions() {
      const names = await readdir(directory).catch(() => [])
      const out = []
      for (const name of names) {
        if (!name.endsWith('.jsonl')) continue
        const [userId, rest] = name.split('__')
        const session = rest?.replace(/\.jsonl$/, '')
        const file = await stat(path.join(directory, name)).catch(() => null)
        if (!file || !session || !userId) continue
        out.push({ session, userId, bytes: file.size, lastAt: file.mtime })
      }
      return out.sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime())
    },

    async events(session) {
      if (!SESSION_ID.test(String(session))) return null
      const names = await readdir(directory).catch(() => [])
      const name = names.find(n => n.endsWith(`__${session}.jsonl`))
      if (!name) return null
      const raw = await readFile(path.join(directory, name), 'utf8')
      const chunks = raw
        .split('\n')
        .filter(Boolean)
        .map(line => {
          try {
            return JSON.parse(line)
          } catch {
            return null // a torn final line from a killed process is not fatal
          }
        })
        .filter(Boolean)
        .sort((a, b) => a.seq - b.seq)
      return chunks.flatMap(chunk => chunk.events)
    },

    /** Recordings age out; the privacy promise is the deletion, not the mask. */
    async sweep() {
      const cutoff = clock().getTime() - KEEP_DAYS * 24 * 3600_000
      const names = await readdir(directory).catch(() => [])
      let removed = 0
      for (const name of names) {
        const file = path.join(directory, name)
        const found = await stat(file).catch(() => null)
        if (found && found.mtimeMs < cutoff) {
          await rm(file, { force: true })
          removed++
        }
      }
      return removed
    },
  }
}
