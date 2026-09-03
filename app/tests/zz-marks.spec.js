import { test, expect } from '@playwright/test'
test('where the time goes', async ({ page }) => {
  await page.addInitScript(() => { const i = setInterval(() => { if (window.__offwegoMap) { window.__mapAt = Math.round(performance.now()); clearInterval(i) } }, 5) })
  await page.goto('/trips/sample'); await page.waitForTimeout(4000)
  for (let n = 0; n < 4; n++) {
    await page.goto('about:blank'); await page.goto('/trips/sample')
    await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: 25000 })
    await page.waitForTimeout(4000)
    const out = await page.evaluate(() => {
      const marks = Object.fromEntries(performance.getEntriesByType('mark').filter(m => m.name.startsWith('mk:')).map(m => [m.name.slice(3), Math.round(m.startTime)]))
      const r = performance.getEntriesByType('resource')
      const at = re => { const e = r.find(x => re.test(x.name)); return e ? Math.round(e.responseEnd) : null }
      const t = r.filter(x => /\/planet\/.*\.pbf$/.test(x.name)).sort((a, b) => a.startTime - b.startTime)[0]
      return { ...marks, appJsDone: at(/assets\/index-/), mapChunkDone: at(/assets\/map-/),
               mapCreated: window.__mapAt, tile: t ? Math.round(t.startTime) : null }
    })
    console.log('MARKS:', JSON.stringify(out))
  }
})
