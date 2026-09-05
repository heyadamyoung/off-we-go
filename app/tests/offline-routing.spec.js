import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

/* The on-device engine, end to end: real Valhalla-WASM, a real tile archive
   built by the production image (Andorra, ~3 MB), stored in OPFS the way the
   offline download stores it, routed in a worker. The fixture is not
   committed — build it with the valhalla image and drop it in tests/fixtures
   (see the offline-routing feature); without it this spec skips. */

const fixture = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'andorra_routing.tar',
)

test('the phone routes by itself from a saved pack — no server, real streets', async ({ page }) => {
  test.skip(!fs.existsSync(fixture), 'andorra_routing.tar fixture not built on this machine')
  test.setTimeout(120_000)

  const said = []
  page.on('console', message => said.push(`${message.type()}: ${message.text().slice(0, 200)}`))
  await page.goto('/trips/sample')
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: 9000 })
  await expect.poll(() => page.evaluate(() => typeof window.__offwegoLocalRoute)).toBe('function')

  // Store the pack exactly as saveRoutingPack would.
  const bytes = fs.readFileSync(fixture)
  await page.evaluate(async base64 => {
    const raw = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle('offline_maps', { create: true })
    const handle = await dir.getFileHandle('trip-proof_routing.tar', { create: true })
    const writable = await handle.createWritable()
    await writable.write(raw)
    await writable.close()
  }, bytes.toString('base64'))

  // Warm the engine once (the worker fetches its wasm on first use), then cut
  // the network entirely: the second route must come from the device alone.
  await page.evaluate(() =>
    window.__offwegoLocalRoute?.('proof', [1.5218, 42.5063], [1.526, 42.51], 'auto'),
  )
  await page.context().setOffline(true)

  // Andorra la Vella up the valley to La Massana — with the world unplugged.
  const found = await page.evaluate(() =>
    window.__offwegoLocalRoute?.('proof', [1.5218, 42.5063], [1.5341, 42.5444], 'auto'),
  )
  await page.context().setOffline(false)
  if (!found)
    console.log(
      'PAGE SAID:\n' + said.filter(s => /valhalla|offline|error|warn/i.test(s)).join('\n'),
    )
  expect(found).toBeTruthy()
  expect(found.meters).toBeGreaterThan(4000)
  expect(found.seconds).toBeGreaterThan(120)
  expect(found.shape.length).toBeGreaterThan(30)
  // The way bends through the valley — a street route, not a ruler.
  const lngs = found.shape.map(p => p[0])
  expect(Math.max(...lngs) - Math.min(...lngs)).toBeGreaterThan(0.005)
})
