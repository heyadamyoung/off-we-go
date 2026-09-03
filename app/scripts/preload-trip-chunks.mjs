/* The trip screen's two big chunks — its route and MapLibre — are dynamic
   imports, so the browser cannot see them until the entry bundle has parsed.
   Measured, that put them at ~55ms and the map's own creation at ~105ms, with
   the first tile behind that again.

   The single-page shell is served for every route, so these cannot simply be
   preloaded in the head: the home screen would pull a megabyte of map it never
   draws. This appends the hints from the shell itself, only on a trip path,
   with whatever hashed names this build produced.

   Runs after `vite build`; see the build script. */
import { readFile, writeFile } from 'node:fs/promises'
import { readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const client = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'client')
const assets = await readdir(join(client, 'assets'))

/* By prefix, because the hash changes every build and the prefix comes from
   the source filename. A rename that breaks this fails the build rather than
   quietly shipping without the hints. */
const find = prefix => {
  const hit = assets.find(name => name.startsWith(prefix) && name.endsWith('.js'))
  if (!hit) throw new Error(`No built chunk starts with "${prefix}" — has it been renamed?`)
  return `/assets/${hit}`
}

const wanted = [find('trips._slug-'), find('map-')]
const inject =
  `<script>try{if(location.pathname.indexOf('/trips/')===0){` +
  `for(var f=${JSON.stringify(wanted)},i=0;i<f.length;i++){` +
  `var l=document.createElement('link');l.rel='modulepreload';l.href=f[i];` +
  `document.head.appendChild(l)}}}catch(e){}</script>`

const page = join(client, 'index.html')
const html = await readFile(page, 'utf8')
if (html.includes('modulepreload')) {
  // Put ours first: the hints are only useful before the entry bundle parses.
  const at = html.indexOf('<link rel="modulepreload"')
  await writeFile(page, html.slice(0, at) + inject + html.slice(at))
} else {
  await writeFile(page, html.replace('</head>', `${inject}</head>`))
}
console.log(`preloading on /trips/: ${wanted.join(' ')}`)
