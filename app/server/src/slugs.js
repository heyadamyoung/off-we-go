const reservedHandles = new Set([
  'admin',
  'administrator',
  'api',
  'auth',
  'help',
  'mcp',
  'off-we-go',
  'offwego',
  'owner',
  'privacy',
  'root',
  'safety',
  'security',
  'staff',
  'support',
  'system',
  'trips',
])

export function normalizeProfileHandle(value) {
  const handle = String(value || '')
    .trim()
    .replace(/^@/, '')
    .toLowerCase()
  if (handle.length < 3 || handle.length > 30) return null
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(handle)) return null
  if (reservedHandles.has(handle)) return null
  return handle
}

export function slugBase(value, fallback = 'trip', maxLength = 72) {
  const normalized = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return (normalized || fallback).slice(0, maxLength).replace(/-$/g, '') || fallback
}

export async function availableSlug(value, isTaken, { fallback = 'trip', maxLength = 72 } = {}) {
  const base = slugBase(value, fallback, maxLength)
  for (let suffix = 1; suffix < 10_000; suffix++) {
    const ending = suffix === 1 ? '' : `-${suffix}`
    const candidate = `${base.slice(0, maxLength - ending.length).replace(/-$/g, '')}${ending}`
    if (!(await isTaken(candidate))) return candidate
  }
  throw new Error('Could not allocate a readable slug')
}
