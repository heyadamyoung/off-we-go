/* The trip route's own chunk is a dynamic import, so the browser cannot see it
   until the entry bundle has executed and the router has decided where it is.
   Measured, that put it at ~55ms with nothing else in flight.

   Only the route chunk: preloading MapLibre's 965kb alongside it measurably
   *delayed* the first tile, because it competes for the same bandwidth as the
   things actually on the critical path.

   The single-page shell is served for every route, so this cannot be a plain
   head link — the home screen would fetch a route it never renders. */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const client = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'client')
const assets = await readdir(join(client, 'assets'))

const chunk = assets.find(name => name.startsWith('trips._slug-') && name.endsWith('.js'))
if (!chunk) throw new Error('No trips route chunk in the build — has the route been renamed?')

const inject =
  `<script>try{if(location.pathname.indexOf('/trips/')===0){` +
  `var l=document.createElement('link');l.rel='modulepreload';` +
  `l.href='/assets/${chunk}';document.head.appendChild(l)}}catch(e){}</script>`

const page = join(client, 'index.html')
const html = await readFile(page, 'utf8')
const at = html.indexOf('<link rel="modulepreload"')
await writeFile(page, at < 0 ? html.replace('</head>', `${inject}</head>`) : html.slice(0, at) + inject + html.slice(at))
console.log(`preloading on /trips/: /assets/${chunk}`)
