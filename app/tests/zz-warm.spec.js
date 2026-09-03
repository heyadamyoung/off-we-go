import { test, expect } from '@playwright/test'

const phases = async page => {
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: 20000 })
  await page.waitForTimeout(6000)
  return page.evaluate(() => {
    const r = performance.getEntriesByType('resource')
    const at = re => { const e = r.find(x => re.test(x.name)); return e ? [Math.round(e.startTime), Math.round(e.responseEnd)] : null }
    const tiles = r.filter(x => /\/planet\/.*\.pbf$/.test(x.name)).sort((a, b) => a.startTime - b.startTime)
    return {
      planet: at(/\/planet$/),
      style: at(/map-dark\.json/),
      firstTile: tiles[0] ? [Math.round(tiles[0].startTime), Math.round(tiles[0].responseEnd)] : null,
      mapCreated: window.__mapAt ?? null,
      fcp: Math.round(performance.getEntriesByType('paint').find(p => p.name === 'first-contentful-paint')?.startTime ?? -1),
    }
  })
}

test('cold then warm', async ({ page }) => {
  await page.addInitScript(() => {
    const t = setInterval(() => { if (window.__offwegoMap) { window.__mapAt = Math.round(performance.now()); clearInterval(t) } }, 8)
  })
  await page.goto('/trips/sample')
  console.log('COLD:', JSON.stringify(await phases(page)))

  // Same profile, everything the first visit cached still there.
  await page.goto('about:blank')
  await page.goto('/trips/sample')
  console.log('WARM:', JSON.stringify(await phases(page)))

  await page.goto('about:blank')
  await page.goto('/trips/sample')
  console.log('WARM2:', JSON.stringify(await phases(page)))
})
