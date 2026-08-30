const timeOf = value => value instanceof Date ? value.getTime() : new Date(value).getTime()

export function mergeLiveFixes(current, incoming, maxPerDevice = 6000) {
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
