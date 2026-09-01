const timeOf = value => value instanceof Date ? value.getTime() : new Date(value).getTime()

export function liveRetryDelay(failures) {
  return Math.min(30_000, 1_000 * (2 ** Math.max(0, Math.min(30, failures))))
}

export function mergeLiveFixes(current, incoming, maxPerDevice = 50_000) {
  const byDevice = new Map()
  for (const fix of [...current, ...incoming]) {
    if (!fix?.deviceId || !Number.isFinite(timeOf(fix.at))) continue
    if (!byDevice.has(fix.deviceId)) byDevice.set(fix.deviceId, new Map())
    byDevice.get(fix.deviceId).set(timeOf(fix.at), fix)
  }
  return [...byDevice.values()]
    .flatMap(values => [...values.values()].sort((a, b) => timeOf(a.at) - timeOf(b.at)).slice(-maxPerDevice))
    .sort((a, b) => timeOf(a.at) - timeOf(b.at))
}


