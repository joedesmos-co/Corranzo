#!/usr/bin/env node
/**
 * Deterministic browser probe for the phrase-boundary epsilon.
 *
 * Loads a real multi-system score, pauses, then seeks to 1ms-spaced times
 * around each system/page boundary and reads the LIVE motion-timeline cursor
 * snapshot. The earliest time that resolves to the next phrase is
 * boundary - PHRASE_BOUNDARY_EPSILON_SECONDS, so this measures the shipped
 * early-switch (and therefore the visual jump) without RAF sampling error.
 */
import { chromium, webkit } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
const args = process.argv.slice(2)
function arg(name, fallback) {
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? args[index + 1] : fallback
}
const browserName = arg('browser', 'chromium')
const baseUrl = arg('base', 'http://localhost:5179')
const scoreTitle = arg('score', 'Hungarian Dance No. 5')
const outPath = arg('out', `tmp/cursor-trace/boundaries-${browserName}.json`)
const label = arg('label', 'run')
const browserType = browserName === 'webkit' ? webkit : chromium
const browser = await browserType.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(`${baseUrl}/#library`, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: new RegExp(`Open score: ${scoreTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }).click()
await page.waitForTimeout(8000)
await page.waitForSelector('.score-follow-cursor', { state: 'attached', timeout: 30_000 })

const boundaries = await page.evaluate(async () => {
  const runtime = await import('/src/features/score-follow/scoreFollowCursorRuntime.js')
  const seek = document.querySelector('input[aria-label="Score position"]')
  seek.step = '0.001'
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  const probe = (time) => new Promise((resolve) => {
    setter.call(seek, String(time))
    seek.dispatchEvent(new Event('input', { bubbles: true }))
    seek.dispatchEvent(new Event('change', { bubbles: true }))
    setTimeout(() => {
      const snapshot = runtime.getScoreFollowCursorSnapshot()
      resolve({ time, page: snapshot.page, system: snapshot.systemIndex, measure: snapshot.measureNumber, phrase: snapshot.phraseIndex, x: snapshot.x, phraseStart: snapshot.phraseStartTime, phraseEnd: snapshot.phraseEndTime })
    }, 80)
  })
  // Page/system boundaries observed from a coarse seek sweep of this score.
  const candidates = [5.454545454545454, 10.909090909090908, 27.272727272727273, 29.09090909090909, 78.80681818181816, 111.00378787878786]
  const results = []
  for (const boundary of candidates) {
    const sweep = []
    for (let offset = -20; offset <= 2; offset += 1) {
      sweep.push(await probe(boundary + offset / 1000))
    }
    const before = sweep[0]
    const after = sweep.at(-1)
    const firstNext = sweep.find((entry) => entry.phrase !== before.phrase || entry.page !== before.page)
    results.push({
      boundary,
      from: { page: before.page, system: before.system, measure: before.measure, phrase: before.phrase },
      to: { page: after.page, system: after.system, measure: after.measure, phrase: after.phrase },
      switchAt: firstNext?.time ?? null,
      earlyMs: firstNext ? (boundary - firstNext.time) * 1000 : null,
      sweep,
    })
  }
  return results
})

const output = { label, browser: browserName, scoreTitle, generatedAt: new Date().toISOString(), boundaries }
await mkdir(dirname(outPath), { recursive: true })
await writeFile(outPath, JSON.stringify(output, null, 2))
console.log(`wrote ${outPath}`)
for (const b of boundaries) {
  console.log(`${b.from.page}:${b.from.system} m${b.from.measure} -> ${b.to.page}:${b.to.system} m${b.to.measure} boundary=${b.boundary.toFixed(4)} switch=${b.switchAt?.toFixed(4)} early=${b.earlyMs?.toFixed(1)}ms`)
}
await browser.close()
