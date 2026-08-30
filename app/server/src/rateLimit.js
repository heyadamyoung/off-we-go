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
    size() { return windows.size },
  }
}
