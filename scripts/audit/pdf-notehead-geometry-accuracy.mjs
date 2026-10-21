#!/usr/bin/env node
/**
 * How accurate is the PDF notehead geometry, in real pixels?
 *
 * The PDF surface is a raster canvas: its noteheads are printed ink. The
 * pre-fix build drew a replacement note shape at the app's computed
 * notehead geometry. This probe measures that geometry against the ink that
 * is ACTUALLY printed in the PDF canvas, so the decision "colour the printed
 * ink" vs "report the feedback in the practice controls" is made on evidence.
 *
 *   node scripts/audit/pdf-notehead-geometry-accuracy.mjs
 *   BASE_URL=http://127.0.0.1:5173/ node scripts/audit/pdf-notehead-geometry-accuracy.mjs
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

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e.message ?? e)))

const report = { base: BASE, errors }
try {
  await page.goto(`${BASE}?e2e-midi=1`)
  await page.getByRole('button', { name: 'Open featured score: Menuet in F, K.2' }).click()
  await page.locator('.react-pdf__Page canvas').first().waitFor({ timeout: 60_000 })
  await sleep(9000)
  await page.getByRole('radio', { name: 'Wait For You', exact: true }).click()
  await sleep(800)

  const measured = await page.evaluate(() => {
    const canvas = document.querySelector('.react-pdf__Page canvas')
    const overlay = document.querySelector('.score-follow-overlay')
    if (!canvas || !overlay) return { error: 'missing canvas/overlay' }
    const canvasRect = canvas.getBoundingClientRect()
    const overlayRect = overlay.getBoundingClientRect()
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const dpr = canvas.width / canvasRect.width

    const heads = [...overlay.querySelectorAll('.cz-notehead')].map((el) => {
      const r = el.getBoundingClientRect()
      return {
        left: r.left - overlayRect.left,
        top: r.top - overlayRect.top,
        width: r.width,
        height: r.height,
        shape: el.getAttribute('data-cz-notehead-shape'),
        state: el.getAttribute('data-cz-notehead-state'),
      }
    })

    // For each drawn notehead, find the PRINTED ink in the canvas and report
    // how far the drawn centre is from the ink's centre.
    const results = heads.map((head) => {
      const sx = Math.round((head.left + overlayRect.left - canvasRect.left) * dpr)
      const sy = Math.round((head.top + overlayRect.top - canvasRect.top) * dpr)
      const sw = Math.max(1, Math.round(head.width * dpr))
      const sh = Math.max(1, Math.round(head.height * dpr))
      // Search a generous window around the drawn box for ink.
      const pad = Math.round(Math.max(sw, sh) * 2.2)
      const x0 = Math.max(0, sx - pad)
      const y0 = Math.max(0, sy - pad)
      const x1 = Math.min(canvas.width, sx + sw + pad)
      const y1 = Math.min(canvas.height, sy + sh + pad)
      if (x1 <= x0 || y1 <= y0) return { head, error: 'out of canvas' }
      const data = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data
      const w = x1 - x0
      const h = y1 - y0
      // Ink pixels, and the "thick ink" pixels (noteheads are thicker than a
      // staff line) — a notehead blob is where the ink is vertically deep.
      const ink = []
      for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
          const i = (y * w + x) * 4
          const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
          if (data[i + 3] > 40 && lum < 170) ink.push([x + x0, y + y0])
        }
      }
      if (ink.length === 0) return { head, inkPixels: 0 }
      let sumX = 0
      let sumY = 0
      for (const [px, py] of ink) {
        sumX += px
        sumY += py
      }
      const inkCx = sumX / ink.length
      const inkCy = sumY / ink.length
      const drawnCx = (sx + sw / 2)
      const drawnCy = (sy + sh / 2)
      return {
        head,
        inkPixels: ink.length,
        drawnCentre: { x: drawnCx, y: drawnCy },
        inkCentre: { x: inkCx, y: inkCy },
        offsetPx: {
          x: Math.round((drawnCx - inkCx) * 10) / 10,
          y: Math.round((drawnCy - inkCy) * 10) / 10,
          distance: Math.round(Math.hypot(drawnCx - inkCx, drawnCy - inkCy) * 10) / 10,
        },
      }
    })

    return { canvasRect: canvasRect.toJSON(), overlayRect: overlayRect.toJSON(), dpr, count: heads.length, results }
  })

  console.log(JSON.stringify(measured, null, 2))
  report.measured = measured
  await page.screenshot({ path: join(outDir, 'noteheads.png') })
} catch (e) {
  report.error = String(e.stack ?? e)
  console.log(report.error)
  await page.screenshot({ path: join(outDir, 'failure.png') }).catch(() => {})
}

console.log(JSON.stringify(report, null, 2))
await context.close()
await browser.close()
