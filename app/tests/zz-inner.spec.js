import { test, expect } from '@playwright/test'
test('inside maplibre', async ({ page }) => {
  await page.addInitScript(() => {
    window.__m = {}
    const i = setInterval(() => {
      const m = window.__offwegoMap
      if (!m) return
      clearInterval(i)
      window.__m.created = Math.round(performance.now())
      m.once('style.load', () => { window.__m.styleLoad = Math.round(performance.now()) })
      m.once('sourcedata', () => { window.__m.firstSourceData = Math.round(performance.now()) })
      m.once('load', () => { window.__m.load = Math.round(performance.now()) })
      m.once('idle', () => { window.__m.idle = Math.round(performance.now()) })
    }, 4)
  })
  await page.goto('/trips/sample'); await page.waitForTimeout(4000)
  for (let n = 0; n < 3; n++) {
    await page.goto('about:blank'); await page.goto('/trips/sample')
    await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: 25000 })
    await page.waitForTimeout(5000)
    const out = await page.evaluate(() => {
      const r = performance.getEntriesByType('resource')
      const pick = re => { const e = r.find(x => re.test(x.name)); return e ? [Math.round(e.startTime), Math.round(e.responseEnd)] : null }
      const t = r.filter(x => /\/planet\/.*\.pbf$/.test(x.name)).sort((a, b) => a.startTime - b.startTime)[0]
      return { ...window.__m, worker: pick(/maplibre-gl-worker/), style: pick(/map-dark\.json/),
               planet: pick(/\/planet$/), tile: t ? [Math.round(t.startTime), Math.round(t.responseEnd)] : null }
    })
    console.log('INNER:', JSON.stringify(out))
  }
})
