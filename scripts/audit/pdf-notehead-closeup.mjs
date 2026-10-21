#!/usr/bin/env node
/**
 * Close-up of the drawn PDF notehead markers over the printed notation.
 *
 * Answers the question a screenshot answers best: does the drawn marker sit
 * ON the printed notehead, or float near it?
 *
 *   node scripts/audit/pdf-notehead-closeup.mjs
 *   BASE_URL=http://127.0.0.1:5173/ OUT=tmp/pdf-notehead-geometry/closeup-old.png
 */
import { mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..', '..')
const outDir = join(root, 'tmp', 'pdf-notehead-geometry')
mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5173/'
const OUT = process.env.OUT ?? join(outDir, 'closeup.png')

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 3 })
const page = await context.newPage()

try {
  await page.goto(`${BASE}?e2e-midi=1`)
  await page.getByRole('button', { name: 'Open featured score: Menuet in F, K.2' }).click()
  await page.locator('.react-pdf__Page canvas').first().waitFor({ timeout: 60_000 })
  await sleep(9000)
  await page.getByRole('radio', { name: 'Wait For You', exact: true }).click()
  await sleep(800)
  // Play a note correctly so the "played" marker is drawn too.
  const expected = await page.evaluate(() =>
    (document.querySelector('[data-score-note-state="current"]')?.dataset.scoreExpected ?? '')
      .split(',')
      .map(Number)
      .filter((n) => Number.isFinite(n)),
  )
  const hasMarkers = await page.locator('.cz-notehead').count()
  console.log('markers', hasMarkers, 'expected', JSON.stringify(expected))

  const clip = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('.cz-notehead')]
    if (!heads.length) return null
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const el of heads) {
      const r = el.getBoundingClientRect()
      x0 = Math.min(x0, r.left)
      y0 = Math.min(y0, r.top)
      x1 = Math.max(x1, r.right)
      y1 = Math.max(y1, r.bottom)
    }
    const pad = 90
    return {
      x: Math.max(0, x0 - pad),
      y: Math.max(0, y0 - pad),
      width: Math.min(1440, x1 - x0 + pad * 2),
      height: Math.min(960, y1 - y0 + pad * 2),
    }
  })
  if (clip) {
    await page.screenshot({ path: OUT, clip })
    console.log('clip', JSON.stringify(clip), '->', OUT)
  } else {
    await page.screenshot({ path: OUT })
    console.log('no markers; full page ->', OUT)
  }
} catch (e) {
  console.log(String(e.stack ?? e))
} finally {
  await context.close()
  await browser.close()
}
