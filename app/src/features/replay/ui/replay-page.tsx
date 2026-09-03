import { useEffect, useRef, useState } from 'react'
import { authClient } from '../../../backend'

/* The owner's screening room: sessions the family's browsers recorded,
   played back with rrweb-player. The server refuses everyone but the admin
   email, so this page's only politeness is saying so more kindly than a 403.
   The player itself is a lazy import — nobody else ever pays for it. */

interface ReplaySession {
  session: string
  userId: string
  bytes: number
  lastAt: string
}

const when = (value: string) => new Date(value).toLocaleString()
const size = (bytes: number) =>
  bytes > 1_000_000 ? (bytes / 1_000_000).toFixed(1) + ' MB' : Math.round(bytes / 1000) + ' KB'

export default function ReplayPage() {
  const [sessions, setSessions] = useState<ReplaySession[] | null>(null)
  const [refused, setRefused] = useState(false)
  const [watching, setWatching] = useState<string | null>(null)
  const stage = useRef<HTMLDivElement>(null)

  useEffect(() => {
    authClient
      .request<{ sessions: ReplaySession[] }>('/replay/sessions')
      .then(found => setSessions(found.sessions))
      .catch(error => {
        if ((error as { status?: number }).status === 403) setRefused(true)
        else setSessions([])
      })
  }, [])

  useEffect(() => {
    if (!watching || !stage.current) return
    let gone = false
    const holder = stage.current
    holder.replaceChildren()
    Promise.all([
      import('rrweb-player'),
      import('rrweb-player/dist/style.css'),
      authClient.request<{ events: unknown[] }>(
        `/replay/sessions/${encodeURIComponent(watching)}/events`,
      ),
    ])
      .then(([player, _style, found]) => {
        if (gone || !found.events.length) return
        new player.default({
          target: holder,
          props: { events: found.events as never[], autoPlay: true, width: 920, height: 560 },
        })
      })
      .catch(() => {})
    return () => {
      gone = true
      holder.replaceChildren()
    }
  }, [watching])

  if (refused) {
    return (
      <div className="mx-auto max-w-xl p-8 text-muted">
        Session replays are only for the owner's account.
      </div>
    )
  }
  return (
    <div className="mx-auto max-w-5xl p-6">
      <h1 className="mb-4 text-xl font-bold">Session replays</h1>
      <p className="mb-5 text-sm text-muted">
        What the family's screens did, kept two weeks on our own server, inputs masked.
      </p>
      <div className="mb-6 flex flex-wrap gap-2">
        {(sessions || []).map(item => (
          <button
            key={item.session}
            className={
              'rounded-lg border border-line px-3 py-2 text-left text-xs ' +
              (watching === item.session ? 'bg-accent text-accent-ink' : 'bg-raised2')
            }
            onClick={() => setWatching(item.session)}>
            <div className="font-bold">{when(item.lastAt)}</div>
            <div className="opacity-70">{size(item.bytes)}</div>
          </button>
        ))}
        {sessions && !sessions.length && (
          <p className="text-sm text-muted">No sessions recorded yet.</p>
        )}
      </div>
      <div ref={stage} className="noreplay overflow-x-auto" />
    </div>
  )
}
