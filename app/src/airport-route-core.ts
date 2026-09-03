/* Walking to the gate. OSM maps a terminal's corridors as ways with level
   tags, its staircases as steps spanning two levels, its lifts as nodes — a
   graph in all but name. This module names it: build the graph, snap the two
   ends onto it, run A*, and slice the answer per floor for drawing. All pure,
   all tested without a map. */

import type { Feature, LineString, Point } from 'geojson'
// Type-only, so the mutual reference with airport-indoor-core never runs.
import type { IndoorFeature, IndoorProperties } from './airport-indoor-core'

const R = 6371000
const rad = (d: number) => (d * Math.PI) / 180

export function stepMetres(a: number[], b: number[]) {
  const dLat = rad(b[1] - a[1]),
    dLng = rad(b[0] - a[0])
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/* Changing floors costs more than the metres say: finding the stairs, waiting
   for the lift. The penalty keeps a route on its floor unless crossing is the
   point, without ever forbidding it. */
const VERTICAL_COST = 25
const SNAP_METRES = 300 // further than this and the network is not yours
const STITCH_METRES = 500 // the widest unmapped stretch a route may cross
const START_REACH = 2000 // the walker finds the network from anywhere on the airfield
const GATE_REACH = 500 // a pier can be half-unmapped and its gates still reachable

interface WalkNode {
  lng: number
  lat: number
  level: number
  edges: Array<{ to: string; cost: number; kind: string }>
}

const keyOf = (lng: number, lat: number, level: number) => lng + ',' + lat + '@' + level

export function walkGraph(features: IndoorFeature[]) {
  const nodes = new Map<string, WalkNode>()
  const at = (lng: number, lat: number, level: number) => {
    const key = keyOf(lng, lat, level)
    if (!nodes.has(key)) nodes.set(key, { lng, lat, level, edges: [] })
    return key
  }
  const join = (a: string, b: string, cost: number, kind: string) => {
    if (a === b) return
    nodes.get(a)!.edges.push({ to: b, cost, kind })
    nodes.get(b)!.edges.push({ to: a, cost, kind })
  }
  for (const f of features) {
    const p = f.properties
    if (p.kind === 'path' && f.geometry.type === 'LineString') {
      const levels: number[] = p.levels.length ? p.levels : [0]
      const coords: number[][] = f.geometry.coordinates
      for (const level of levels) {
        for (let i = 1; i < coords.length; i++) {
          join(
            at(coords[i - 1][0], coords[i - 1][1], level),
            at(coords[i][0], coords[i][1], level),
            stepMetres(coords[i - 1], coords[i]),
            'walk',
          )
        }
      }
      // A staircase exists on each of its floors; hop between them anywhere
      // along it, since OSM rarely says which end is the bottom.
      if (p.stair && levels.length > 1) {
        for (const c of coords)
          for (let i = 1; i < levels.length; i++) {
            join(at(c[0], c[1], levels[i - 1]), at(c[0], c[1], levels[i]), VERTICAL_COST, 'stairs')
          }
      }
    }
    if (p.kind === 'lift' && f.geometry.type === 'Point') {
      const [lng, lat] = f.geometry.coordinates
      const levels: number[] = p.levels
      for (let i = 1; i < levels.length; i++) {
        join(at(lng, lat, levels[i - 1]), at(lng, lat, levels[i]), VERTICAL_COST, 'lift')
      }
    }
  }

  /* Halls connect what corridors do not. OSM maps a departure hall as a
     walkable polygon, and the linear footways dead-end at its edge — so to
     the graph every hall is a hole. Every node standing in the same hall on
     the same floor is joined through a hub at its middle: you can walk
     across a hall, which is the entire point of a hall. */
  for (const f of features) {
    const p = f.properties
    if (p.kind !== 'walk' || f.geometry.type !== 'Polygon') continue
    const ring = f.geometry.coordinates[0]
    for (const level of p.levels.length ? p.levels : [0]) {
      const members: string[] = []
      for (const [key, node] of nodes) {
        if (node.level === level && inRing([node.lng, node.lat], ring)) members.push(key)
      }
      if (members.length < 2) continue
      const centre = ringCentroid(ring)
      const hub = at(centre[0], centre[1], level)
      for (const member of members) {
        const node = nodes.get(member)!
        join(hub, member, stepMetres(centre, [node.lng, node.lat]), 'hall')
      }
    }
  }

  stitchIslands(nodes)
  return nodes
}

function inRing(point: number[], ring: number[][]) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i],
      [xj, yj] = ring[j]
    if (
      yi > point[1] !== yj > point[1] &&
      point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi
    )
      inside = !inside
  }
  return inside
}

const ringCentroid = (ring: number[][]) =>
  ring.reduce((sum, c) => [sum[0] + c[0] / ring.length, sum[1] + c[1] / ring.length], [0, 0])

/* Nobody has finished mapping the inside of an airport. Corridors come back
   as one big network and dozens of fragments — a pier here, a stub of
   walkway there, two halves of a hall drawn without a shared node — and a
   gate that snaps onto a fragment would honestly but uselessly get "no
   route". So every pair of nearby fragments is sewn with a synthetic
   same-floor edge: the route crosses the unmapped stretch in a straight
   line, priced above real corridors so a mapped way always wins when one
   exists. Sewing pairs rather than everything-to-the-biggest matters: at
   Heathrow two pier networks sit centimetres apart with the main network
   half a kilometre away, and each deserves the other. Fragments further
   apart than the ceiling — a separate terminal building, a shuttle-train
   ride away — stay honestly unconnected. */
function stitchIslands(nodes: Map<string, WalkNode>) {
  const seen = new Set<string>()
  const islands: string[][] = []
  for (const key of nodes.keys()) {
    if (seen.has(key)) continue
    const members: string[] = []
    const queue = [key]
    seen.add(key)
    while (queue.length) {
      const k = queue.pop()!
      members.push(k)
      for (const e of nodes.get(k)!.edges)
        if (!seen.has(e.to)) {
          seen.add(e.to)
          queue.push(e.to)
        }
    }
    islands.push(members)
  }
  if (islands.length < 2) return

  // Bounding boxes first: most pairs of fragments are terminals apart, and
  // a box check is free where a node-by-node sweep is not.
  const degLat = STITCH_METRES / 111320
  const degLng =
    degLat / Math.max(0.2, Math.cos((nodes.values().next().value!.lat * Math.PI) / 180))
  const boxes = islands.map(island => {
    const box = { w: Infinity, e: -Infinity, s: Infinity, n: -Infinity }
    for (const k of island) {
      const node = nodes.get(k)!
      box.w = Math.min(box.w, node.lng)
      box.e = Math.max(box.e, node.lng)
      box.s = Math.min(box.s, node.lat)
      box.n = Math.max(box.n, node.lat)
    }
    return box
  })

  for (let i = 0; i < islands.length; i++) {
    for (let j = i + 1; j < islands.length; j++) {
      const a = boxes[i],
        b = boxes[j]
      if (a.w - b.e > degLng || b.w - a.e > degLng || a.s - b.n > degLat || b.s - a.n > degLat)
        continue
      let pair: [string, string] | null = null
      let gap = STITCH_METRES
      for (const ka of islands[i]) {
        const na = nodes.get(ka)!
        for (const kb of islands[j]) {
          const nb = nodes.get(kb)!
          if (nb.level !== na.level) continue
          if (Math.abs(na.lat - nb.lat) > degLat || Math.abs(na.lng - nb.lng) > degLng) continue
          const d = stepMetres([na.lng, na.lat], [nb.lng, nb.lat])
          if (d < gap) {
            gap = d
            pair = [ka, kb]
          }
        }
      }
      if (!pair) continue
      nodes.get(pair[0])!.edges.push({ to: pair[1], cost: Math.max(gap, 1) * 1.5, kind: 'gap' })
      nodes.get(pair[1])!.edges.push({ to: pair[0], cost: Math.max(gap, 1) * 1.5, kind: 'gap' })
    }
  }
}

export function nearestNode(
  nodes: Map<string, WalkNode>,
  point: number[],
  level?: number,
  within = SNAP_METRES,
) {
  let best: string | null = null,
    bestDistance = within
  for (const [key, node] of nodes) {
    if (level != null && node.level !== level) continue
    const d = stepMetres(point, [node.lng, node.lat])
    if (d < bestDistance) {
      bestDistance = d
      best = key
    }
  }
  return best
}

/* A*. Terminals are a few thousand nodes at most, so the open set is a plain
   array scanned for its minimum — not elegant, never slow enough to matter. */
function routeBetween(nodes: Map<string, WalkNode>, fromKey: string, toKey: string) {
  const goal = nodes.get(toKey)!
  const h = (k: string) => {
    const n = nodes.get(k)!
    return stepMetres([n.lng, n.lat], [goal.lng, goal.lat])
  }
  const dist = new Map([[fromKey, 0]])
  const via = new Map<string, { from: string; kind: string }>()
  const open = new Map([[fromKey, h(fromKey)]])
  const done = new Set<string>()
  while (open.size) {
    let u = '',
      best = Infinity
    for (const [k, f] of open)
      if (f < best) {
        best = f
        u = k
      }
    open.delete(u)
    if (u === toKey) break
    done.add(u)
    for (const edge of nodes.get(u)!.edges) {
      if (done.has(edge.to)) continue
      const tentative = dist.get(u)! + edge.cost
      if (tentative < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, tentative)
        via.set(edge.to, { from: u, kind: edge.kind })
        open.set(edge.to, tentative + h(edge.to))
      }
    }
  }
  if (fromKey !== toKey && !via.has(toKey)) return null

  const steps: Array<{ lng: number; lat: number; level: number; via: string }> = []
  let walked = 0
  for (let k: string | undefined = toKey; k; k = via.get(k)?.from) {
    const n = nodes.get(k)!
    const arrived = via.get(k)
    steps.unshift({ lng: n.lng, lat: n.lat, level: n.level, via: arrived?.kind || 'start' })
    if (arrived?.kind === 'walk' || arrived?.kind === 'gap' || arrived?.kind === 'hall') {
      // real ground covered, not the discouraging price a gap edge carries
      const p = nodes.get(arrived.from)!
      walked += stepMetres([p.lng, p.lat], [n.lng, n.lat])
    }
    if (!arrived) break
  }
  return { steps, metres: walked }
}

export interface GateRoute {
  ref: string
  steps: Array<{ lng: number; lat: number; level: number; via: string }>
  metres: number
  transitions: Array<{ lng: number; lat: number; from: number; to: number; kind: string }>
}

export function planGateRoute(
  nodes: Map<string, WalkNode>,
  start: number[],
  gate: { ref: string; lng: number; lat: number; levels: number[] },
): GateRoute | null {
  /* The start joins the network from far away if it must — at a sprawling
     airport the pin can sit hundreds of metres from the nearest mapped
     corridor, and the drawn approach leg is honest about the gap. Ground
     level is preferred, but not when it means walking half again as far. */
  const nearGround = nearestNode(nodes, start, 0, START_REACH)
  const nearAny = nearestNode(nodes, start, undefined, START_REACH)
  let fromKey = nearAny
  if (nearGround && nearAny && nearGround !== nearAny) {
    const g = nodes.get(nearGround)!,
      a = nodes.get(nearAny)!
    fromKey =
      stepMetres(start, [g.lng, g.lat]) <= stepMetres(start, [a.lng, a.lat]) * 1.5
        ? nearGround
        : nearAny
  } else fromKey = nearGround || nearAny
  // The gate's own floor first, any floor as the fallback — a gate tagged
  // level 2 above corridors mapped only on 1 still deserves a walk.
  const gatePoint = [gate.lng, gate.lat]
  const toKey =
    (gate.levels.length ? nearestNode(nodes, gatePoint, gate.levels[0], GATE_REACH) : null) ||
    nearestNode(nodes, gatePoint, undefined, GATE_REACH)
  if (!fromKey || !toKey) return null
  const route = routeBetween(nodes, fromKey, toKey)
  if (!route) return null

  /* The network rarely runs right up to a gate desk or under your feet, so
     the drawn walk gets a first and last leg to the true endpoints — a line
     that stops a hundred metres short of the gate reads as broken. */
  const steps = route.steps
  let metres = route.metres
  const snappedFrom = nodes.get(fromKey)!
  const toStart = stepMetres(start, [snappedFrom.lng, snappedFrom.lat])
  if (toStart > 2) {
    steps.unshift({ lng: start[0], lat: start[1], level: snappedFrom.level, via: 'start' })
    steps[1] = { ...steps[1], via: 'approach' }
    metres += toStart
  }
  const snappedTo = nodes.get(toKey)!
  const toGate = stepMetres([gate.lng, gate.lat], [snappedTo.lng, snappedTo.lat])
  if (toGate > 2) {
    steps.push({ lng: gate.lng, lat: gate.lat, level: snappedTo.level, via: 'approach' })
    metres += toGate
  }

  const transitions: Array<{ lng: number; lat: number; from: number; to: number; kind: string }> =
    []
  for (let i = 1; i < steps.length; i++) {
    const a = steps[i - 1],
      b = steps[i]
    if (a.level !== b.level) {
      transitions.push({ lng: b.lng, lat: b.lat, from: a.level, to: b.level, kind: b.via })
    }
  }
  return { ref: gate.ref, steps, metres, transitions }
}

/* The line the map draws: solid where the route is on the floor you are
   looking at, faint where it runs on another one, and a marker at each stair
   or lift saying where it goes. */
export function routeSlices(route: GateRoute, level: number) {
  const out: Array<Feature<LineString | Point, IndoorProperties>> = []
  const line = (coords: number[][], lvl: number) => {
    if (coords.length < 2) return
    out.push({
      type: 'Feature',
      properties: {
        kind: lvl === level ? 'route-here' : 'route-away',
        name: '',
        ref: '',
        levels: [lvl],
      },
      geometry: { type: 'LineString', coordinates: coords },
    })
  }
  let run: number[][] = []
  let lvl = route.steps[0]?.level ?? 0
  for (const step of route.steps) {
    if (step.level !== lvl) {
      line(run, lvl)
      const mode = step.via === 'lift' ? 'Lift' : 'Stairs'
      for (const [on, text] of [
        [lvl, `${mode} to level ${step.level}`],
        [step.level, `${mode} from level ${lvl}`],
      ] as const) {
        if (on !== level) continue
        out.push({
          type: 'Feature',
          properties: { kind: 'transfer', name: text, ref: '', levels: [on] },
          geometry: { type: 'Point', coordinates: [step.lng, step.lat] },
        })
      }
      run = []
      lvl = step.level
    }
    run.push([step.lng, step.lat])
  }
  line(run, lvl)
  return out
}

export function describeIndoorRoute(route: GateRoute) {
  const distance =
    route.metres < 950
      ? Math.max(10, Math.round(route.metres / 10) * 10) + ' m'
      : (route.metres / 1000).toFixed(1) + ' km'
  const moves = route.transitions.map(
    t => `${t.kind === 'lift' ? 'lift' : 'stairs'} to level ${t.to}`,
  )
  return [distance + ' walk', ...moves].join(' · ')
}
