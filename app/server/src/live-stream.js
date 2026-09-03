/* Who is watching which trip, so a position that arrives can be handed
   straight to them instead of waited for.
   
   In process, deliberately: the phones post to the same server the browsers
   are listening to, and there is one of it. The day there are two, this
   becomes Postgres LISTEN/NOTIFY and nothing else changes — the shape here is
   the same either way. */
export function createLiveStream() {
  const watchers = new Map()

  return {
    /** Called by a listening browser. Returns the way to stop listening.
        The notify is given the kind of thing that changed. */
    watch(tripId, notify) {
      const key = String(tripId)
      if (!watchers.has(key)) watchers.set(key, new Set())
      const group = watchers.get(key)
      group.add(notify)
      return () => {
        group.delete(notify)
        if (!group.size) watchers.delete(key)
      }
    },

    /** Called when a phone reports. Never throws at the caller: a browser that
        has gone away must not fail the phone's request. */
    announce(tripId, kind = 'positions') {
      const group = watchers.get(String(tripId))
      if (!group) return 0
      for (const notify of [...group]) {
        try {
          notify(kind)
        } catch {
          group.delete(notify)
        }
      }
      return group.size
    },

    /** For tests and for a health endpoint to say what is connected. */
    watching(tripId) {
      return watchers.get(String(tripId))?.size || 0
    },
  }
}
