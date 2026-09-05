// The prebuilt Valhalla WASM module must be served from the site root — the
// routing worker importScripts('/valhalla.js') and the loader finds its .wasm
// beside it. Copied out of the package on install so dev and build both serve
// them without committing 7 MB of binary to the repository.
import { copyFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const from = path.join(root, 'node_modules', 'valhalla-wasm')
const to = path.join(root, 'public')
await mkdir(to, { recursive: true })
for (const name of ['valhalla.js', 'valhalla.wasm']) {
  await copyFile(path.join(from, name), path.join(to, name))
}
console.log('valhalla wasm artifacts copied to public/')
