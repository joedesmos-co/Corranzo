#!/usr/bin/env node
import { webkit } from 'playwright'
const args = process.argv.slice(2)
function arg(name, fallback) { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback }
const baseUrl = arg('base', 'http://localhost:5180')
const browser = await webkit.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(`${baseUrl}/#library`, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: /Open score: Hungarian Dance No\. 5/ }).click()
await page.waitForTimeout(8000)
await page.evaluate(() => {
  window.__FP__ = { samples: [], longtasks: [], gaps: [] }
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__FP__.longtasks.push({ start: entry.startTime, duration: entry.duration })
    }).observe({ entryTypes: ['longtask'] })
  } catch {}
  let last = performance.now()
  const tick = (now) => {
    const gap = now - last
    if (gap > 30) window.__FP__.gaps.push({ at: now, gap })
    last = now
    const seek = document.querySelector('input[aria-label="Score position"]')
    const cursor = [...document.querySelectorAll('.score-follow-cursor')].find((e) => e.style.display !== 'none')
    window.__FP__.samples.push({
      wall: now,
      seek: seek ? Number(seek.value) : null,
      playing: /Pause/.test(document.querySelector('button.workspace-play')?.getAttribute('aria-label') ?? ''),
      left: cursor ? Number.parseFloat(cursor.style.left) : null,
      bar: document.querySelector('.workspace-bar-reference strong')?.textContent ?? null,
    })
    if (window.__FP__.samples.length < 400) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})
const clickAt = await page.evaluate(() => performance.now())
await page.locator('button.workspace-play').click()
await page.waitForTimeout(3000)
const data = await page.evaluate(() => window.__FP__)
const first = data.samples[0]
const firstPlaying = data.samples.find((s) => s.playing)
const firstSeek = data.samples.find((s) => s.seek > 0.05)
const firstMove = data.samples.find((s) => s.left != null && first.left != null && Math.abs(s.left - first.left) > 0.01)
const result = {
  browser: 'webkit',
  maxLongTaskMs: Math.max(0, ...data.longtasks.map((x) => x.duration)),
  maxRafGapMs: Math.max(0, ...data.gaps.map((x) => x.gap)),
  playingAfterMs: firstPlaying ? firstPlaying.wall - clickAt : null,
  firstSeekAdvanceMs: firstSeek ? firstSeek.wall - clickAt : null,
  firstCursorMoveMs: firstMove ? firstMove.wall - clickAt : null,
  longtasks: data.longtasks,
  gaps: data.gaps,
}
console.log(JSON.stringify(result, null, 2))
await browser.close()
