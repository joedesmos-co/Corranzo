#!/usr/bin/env node
/**
 * Production first-Play metrics: stall, readiness, first cursor movement,
 * first transport advance, CPU and heap deltas.
 *
 *   node scripts/cursor-first-play-metrics.mjs --base http://localhost:5180
 */
import { chromium, webkit } from 'playwright'
const args = process.argv.slice(2)
function arg(name, fallback) { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback }
const browserName = arg('browser', 'chromium')
const baseUrl = arg('base', 'http://localhost:5180')
const scoreTitle = arg('score', 'Hungarian Dance No. 5')
const outPath = arg('out', '')
const browserType = browserName === 'webkit' ? webkit : chromium
const browser = await browserType.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(`${baseUrl}/#library`, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: new RegExp(`Open score: ${scoreTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }).click()
await page.waitForTimeout(8000)
const client = await page.context().newCDPSession(page)
await client.send('Performance.enable')
const metricsBefore = Object.fromEntries((await client.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]))
const box = await page.locator('button.workspace-play').boundingBox()
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
      top: cursor ? Number.parseFloat(cursor.style.top) : null,
      bar: document.querySelector('.workspace-bar-reference strong')?.textContent ?? null,
    })
    if (window.__FP__.samples.length < 400) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})
const clickAt = await page.evaluate(() => performance.now())
const x = box.x + box.width / 2
const y = box.y + box.height / 2
await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
await page.waitForTimeout(3000)
const data = await page.evaluate(() => window.__FP__)
const metricsAfter = Object.fromEntries((await client.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]))
const first = data.samples[0]
const firstPlaying = data.samples.find((s) => s.playing)
const firstSeek = data.samples.find((s) => s.seek > 0.05)
const firstMove = data.samples.find((s) => s.left != null && first.left != null && Math.abs(s.left - first.left) > 0.01)
const maxLong = Math.max(0, ...data.longtasks.map((x) => x.duration))
const maxGap = Math.max(0, ...data.gaps.map((x) => x.gap))
const metricDelta = {}
for (const key of ['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration','JSHeapUsedSize','Nodes','JSEventListeners']) {
  if (metricsBefore[key] != null && metricsAfter[key] != null) metricDelta[key] = metricsAfter[key] - metricsBefore[key]
}
const result = {
  browser: browserName,
  scoreTitle,
  clickAt,
  sampleCount: data.samples.length,
  maxLongTaskMs: maxLong,
  maxRafGapMs: maxGap,
  playingAfterMs: firstPlaying ? firstPlaying.wall - clickAt : null,
  firstSeekAdvanceMs: firstSeek ? firstSeek.wall - clickAt : null,
  firstCursorMoveMs: firstMove ? firstMove.wall - clickAt : null,
  cursorMovedPct: firstMove && first.left != null ? firstMove.left - first.left : null,
  longtasks: data.longtasks,
  gaps: data.gaps,
  metricsBefore,
  metricsAfter,
  metricDelta,
}
if (outPath) {
  const { mkdir, writeFile } = await import('node:fs/promises')
  const { dirname } = await import('node:path')
  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, JSON.stringify(result, null, 2))
}
console.log(JSON.stringify(result, null, 2))
await browser.close()
