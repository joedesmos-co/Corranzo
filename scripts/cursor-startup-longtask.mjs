#!/usr/bin/env node
/**
 * Reproduce the remaining first-Play main-thread stall (the startup cursor
 * jump that is NOT a spline/resolver discontinuity).
 *
 *   node scripts/cursor-startup-longtask.mjs --base http://localhost:5180
 *
 * Reports long tasks and RAF gaps while Preview playback starts. On the
 * production build this is ~170-190 ms in headless Chromium; the cursor cannot
 * paint during the task, so it advances by that much music in one frame.
 */
import { chromium } from 'playwright'
const args = process.argv.slice(2)
function arg(name, fallback) { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback }
const baseUrl = arg('base', 'http://localhost:5180')
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(`${baseUrl}/#library`, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: /Open score: Hungarian Dance No\. 5/ }).click()
await page.waitForTimeout(8000)
await page.evaluate(() => {
  window.__LT__ = { longtasks: [], gaps: [] }
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__LT__.longtasks.push({ start: entry.startTime, duration: entry.duration })
      }
    }).observe({ entryTypes: ['longtask'] })
  } catch {
    // Long Task API is Chromium-only; WebKit still shows the RAF gap.
  }
  let last = performance.now()
  const tick = (now) => {
    const gap = now - last
    if (gap > 50) window.__LT__.gaps.push({ at: now, gap })
    last = now
    if (window.__LT__.gaps.length < 100) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})
await page.locator('button.workspace-play').click()
await page.waitForTimeout(4000)
console.log(JSON.stringify(await page.evaluate(() => window.__LT__), null, 2))
await browser.close()
