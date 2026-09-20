#!/usr/bin/env node
/* What OpenStreetMap actually holds for the places layer.
 *
 * The question this answers is not "what tags exist" — the wiki says that —
 * but "how many real features in a real city carry each of them", which is
 * the only number that decides whether a description and a photograph can
 * come from here. Remembering that a tag exists is not the same as knowing
 * that one place in nine carries it.
 *
 * Run from a runner with open internet, because the development sandbox
 * cannot reach Overpass, Wikidata or Wikimedia. Same reason and same shape as
 * probe-flight-sources.mjs.
 *
 *   node server/scripts/probe-osm-places.mjs --box 4.86,52.35,4.92,52.39 --name Amsterdam
 */

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]

const argv = process.argv.slice(2)
const value = (name, fallback) => {
  const at = argv.indexOf(`--${name}`)
  return at >= 0 && argv[at + 1] ? argv[at + 1] : fallback
}

/* The places a traveller would be shown: the tourism and historic features,
   the places of worship, the parks and the museums, plus the everyday
   amenities so the comparison is honest about the long tail. */
const FILTERS = [
  'node["tourism"]',
  'way["tourism"]',
  'node["historic"]',
  'way["historic"]',
  'node["amenity"~"^(restaurant|cafe|bar|pub|museum|theatre|cinema|place_of_worship|marketplace)$"]',
  'way["amenity"~"^(restaurant|cafe|bar|pub|museum|theatre|cinema|place_of_worship|marketplace)$"]',
  'way["leisure"~"^(park|garden|nature_reserve)$"]',
]

/* Every tag that could carry a picture or a description, plus the two that
   link out to something that has both. */
const WANTED = [
  'name',
  'wikidata',
  'wikipedia',
  'image',
  'wikimedia_commons',
  'description',
  'inscription',
  'website',
  'phone',
  'opening_hours',
  'addr:street',
  'wheelchair',
  'operator',
  'heritage',
]

async function ask(query) {
  let last = null
  for (const endpoint of ENDPOINTS) {
    try {
      const started = Date.now()
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'user-agent': 'OffWeGo/1.0 (https://offwego.to; support@threadway.ai)',
        },
        body: new URLSearchParams({ data: query }),
      })
      if (!response.ok) {
        last = `${endpoint} answered ${response.status}`
        continue
      }
      const json = await response.json()
      return { json, endpoint, ms: Date.now() - started }
    } catch (error) {
      last = `${endpoint}: ${error.message}`
    }
  }
  throw new Error(`no Overpass endpoint answered — ${last}`)
}

const box = value('box', '4.86,52.35,4.92,52.39').split(',').map(Number)
const name = value('name', 'the box')
const [west, south, east, north] = box
const bbox = `${south},${west},${north},${east}`
const query = `[out:json][timeout:180];(${FILTERS.map(f => `${f}(${bbox});`).join('')});out tags center;`

console.log(`${name}: ${bbox}`)
const { json, endpoint, ms } = await ask(query)
const elements = json.elements || []
console.log(`${endpoint} answered ${elements.length} features in ${(ms / 1000).toFixed(1)}s\n`)

const counts = Object.fromEntries(WANTED.map(tag => [tag, 0]))
let named = 0
const withPicture = []
const withWords = []
for (const element of elements) {
  const tags = element.tags || {}
  if (tags.name) named += 1
  for (const tag of WANTED) if (tags[tag]) counts[tag] += 1
  if ((tags.image || tags.wikimedia_commons) && tags.name) withPicture.push(tags)
  if (tags.description && tags.name) withWords.push(tags)
}

const pad = Math.max(...WANTED.map(tag => tag.length))
const share = n => `${((n / Math.max(1, elements.length)) * 100).toFixed(1)}%`
console.log(`features        ${elements.length}`)
console.log(`with a name     ${named}  ${share(named)}\n`)
for (const tag of WANTED) {
  console.log(`  ${tag.padEnd(pad)}  ${String(counts[tag]).padStart(6)}  ${share(counts[tag])}`)
}

console.log(`\n-- a picture straight from the tags (${withPicture.length}) --`)
for (const tags of withPicture.slice(0, 8)) {
  console.log(`  ${tags.name}\n    ${tags.image || `commons: ${tags.wikimedia_commons}`}`)
}
console.log(`\n-- a description straight from the tags (${withWords.length}) --`)
for (const tags of withWords.slice(0, 8)) {
  console.log(`  ${tags.name}\n    ${String(tags.description).slice(0, 140)}`)
}

/* The reason the Wikidata link matters more than the picture tag: it is the
   handle on an item that has a picture, an article and a short description,
   rather than one field somebody happened to fill in. */
const linked = elements.filter(e => e.tags?.wikidata && e.tags?.name)
console.log(`\n-- linked to Wikidata (${linked.length}) --`)
for (const element of linked.slice(0, 10)) {
  console.log(`  ${element.tags.name} → ${element.tags.wikidata}${element.tags.wikipedia ? ` · ${element.tags.wikipedia}` : ''}`)
}
