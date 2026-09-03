import { test, expect } from '@playwright/test'
const measure = async page => {
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: 25000 })
  await page.waitForTimeout(5000)
  return page.evaluate(() => {
    const r = performance.getEntriesByType('resource')
    const at = re => { const e = r.find(x => re.test(x.name)); return e ? [Math.round(e.startTime), Math.round(e.responseEnd)] : null }
    const t = r.filter(x => /\/planet\/.*\.pbf$/.test(x.name)).sort((a, b) => a.startTime - b.startTime)[0]
    return { routeJs: at(/trips\._slug/), mapChunk: at(/assets\/map-/), mapCreated: window.__mapAt ?? null,
             firstTile: t ? [Math.round(t.startTime), Math.round(t.responseEnd)] : null,
             fcp: Math.round(performance.getEntriesByType('paint').find(p => p.name === 'first-contentful-paint')?.startTime ?? -1) }
  })
}
test('warm x3', async ({ page }) => {
  await page.addInitScript(() => { const i = setInterval(() => { if (window.__offwegoMap) { window.__mapAt = Math.round(performance.now()); clearInterval(i) } }, 5) })
  await page.goto('/trips/sample'); await measure(page)
  for (let n = 0; n < 3; n++) { await page.goto('about:blank'); await page.goto('/trips/sample'); console.log('WARM:', JSON.stringify(await measure(page))) }
})
