import { test, expect } from '@playwright/test'
test('container size at map creation', async ({ page }) => {
  await page.addInitScript(() => {
    window.__s = {}
    const i = setInterval(() => {
      const m = window.__offwegoMap
      if (!m) return
      clearInterval(i)
      const c = m.getContainer()
      window.__s.atCreate = { w: c.clientWidth, h: c.clientHeight, t: Math.round(performance.now()) }
      window.__s.canvasAtCreate = { w: m.getCanvas().width, h: m.getCanvas().height }
      window.__s.zoomAtCreate = m.getZoom()
      window.__s.centerAtCreate = m.getCenter().toArray().map(n => +n.toFixed(3))
      m.on('resize', () => {
        window.__s.resizes = (window.__s.resizes || [])
        window.__s.resizes.push({ t: Math.round(performance.now()), w: c.clientWidth, h: c.clientHeight })
      })
      m.on('moveend', () => {
        window.__s.moves = (window.__s.moves || [])
        if (window.__s.moves.length < 6) window.__s.moves.push({ t: Math.round(performance.now()), z: +m.getZoom().toFixed(2), c: m.getCenter().toArray().map(n => +n.toFixed(3)) })
      })
    }, 4)
  })
  await page.goto('/trips/sample'); await page.waitForTimeout(4000)
  for (let n = 0; n < 2; n++) {
    await page.goto('about:blank'); await page.goto('/trips/sample')
    await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: 25000 })
    await page.waitForTimeout(5000)
    const out = await page.evaluate(() => {
      const t = performance.getEntriesByType('resource').filter(x => /\/planet\/.*\.pbf$/.test(x.name)).sort((a, b) => a.startTime - b.startTime)[0]
      return { ...window.__s, tile: t ? Math.round(t.startTime) : null }
    })
    console.log('SIZE:', JSON.stringify(out))
  }
})
