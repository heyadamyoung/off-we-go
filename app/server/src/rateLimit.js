/* The address a limiter should key on. Cloudflare fronts everything, and
   trusting it via trustProxy would also trust the client-editable leftmost
   X-Forwarded-For — so the edge's own header carries the truth instead:
   cf-connecting-ip is stamped per connection by Cloudflare and cannot be
   forged through it. Keying on request.ip lumped every phone behind one
   Cloudflare address into a shared bucket — a family at one airport split
   thirty lookups between them, and the second phone starved while the
   first worked. */
export function clientAddress(request) {
  const header = request.headers?.['cf-connecting-ip']
  const value = Array.isArray(header) ? header[0] : header
  return String(value || request.ip || 'unknown')
}

export function createWindowRateLimiter({ clock = Date.now, maxEntries = 10_000 } = {}) {
  const windows = new Map()
  let operations = 0

  const sweep = now => {
    for (const [key, value] of windows) {
      if (value.expiresAt <= now) windows.delete(key)
    }
  }

  return {
    hit(key, { max, windowMs }) {
      const now = clock()
      operations++
      if (operations % 128 === 0 || windows.size >= maxEntries) sweep(now)
      let value = windows.get(key)
      if (!value || value.expiresAt <= now) {
        if (!value && windows.size >= maxEntries) {
          const oldest = windows.keys().next().value
          if (oldest !== undefined) windows.delete(oldest)
        }
        value = { count: 0, expiresAt: now + windowMs }
        windows.set(key, value)
      }
      value.count++
      return value.count > max ? Math.max(1, Math.ceil((value.expiresAt - now) / 1000)) : 0
    },
    size() {
      return windows.size
    },
  }
}
