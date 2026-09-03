import { test, expect } from '@playwright/test'

test('phases', async ({ page }) => {
  await page.addInitScript(() => {
    window.__marks = {}
    const poll = setInterval(() => {
      if (window.__offwegoMap && !window.__marks.mapCreated) {
        window.__marks.mapCreated = Math.round(performance.now())
        window.__offwegoMap.once('styledata', () => { window.__marks.styleReady = Math.round(performance.now()) })
        window.__offwegoMap.once('idle', () => { window.__marks.idle = Math.round(performance.now()) })
      }
      if (document.querySelector('.mapcanvas canvas') && !window.__marks.canvas) {
        window.__marks.canvas = Math.round(performance.now())
      }
      if (window.__marks.idle) clearInterval(poll)
    }, 8)
  })
  await page.goto('/trips/sample')
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: 20000 })
  await page.waitForTimeout(8000)
  const out = await page.evaluate(() => {
    const r = performance.getEntriesByType('resource')
    const at = re => { const e = r.find(x => re.test(x.name)); return e ? [Math.round(e.startTime), Math.round(e.responseEnd)] : null }
    const tiles = r.filter(x => /\/planet\/.*\.pbf$/.test(x.name)).sort((a, b) => a.startTime - b.startTime)
    return {
      marks: window.__marks,
      appJs: at(/assets\/index-/),
      routeJs: at(/trips\._slug/),
      mapChunk: at(/assets\/map-/),
      worker: at(/maplibre-gl-worker/),
      style: at(/map-dark\.json/),
      planet: at(/\/planet$/),
      tiles: tiles.slice(0, 3).map(t => [Math.round(t.startTime), Math.round(t.responseEnd)]),
      tileCount: tiles.length,
      fcp: Math.round(performance.getEntriesByType('paint').find(p => p.name === 'first-contentful-paint')?.startTime ?? -1),
    }
  })
  console.log('PHASES:', JSON.stringify(out, null, 1))
})
