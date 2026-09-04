/* What a request changed, from the path it changed it at. One rule rather than
   an announce buried in seventeen routes, because the eighteenth route is the
   one that gets forgotten and then a browser sits there showing yesterday. */

const RULES = [
  [/^\/api\/trips\/[^/]+\/photos\/[^/]+\/comments/, 'comments'],
  [/^\/api\/trips\/[^/]+\/comments\//, 'comments'],
  [/^\/api\/trips\/[^/]+\/photos/, 'photos'],
  [/^\/api\/trips\/[^/]+\/(stops|route)/, 'stops'],
  [/^\/api\/trips\/[^/]+\/segments/, 'segments'],
  [/^\/api\/trips\/[^/]+\/messages/, 'chat'],
  [/^\/api\/trips\/[^/]+\/(invites|members|devices)/, 'people'],
  [/^\/api\/trips\/[^/]+$/, 'trip'],
]

const CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export function changeKind(method, url) {
  if (!CHANGING.has(String(method || '').toUpperCase())) return null
  const path = String(url || '').split('?')[0]
  // Presence has its own heartbeat and would otherwise announce every fifteen
  // seconds per viewer, which is the polling this replaced wearing a hat.
  if (/\/presence$/.test(path)) return null
  for (const [pattern, kind] of RULES) {
    if (pattern.test(path)) return kind
  }
  return null
}
