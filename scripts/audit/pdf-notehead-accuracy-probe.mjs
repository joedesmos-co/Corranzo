#!/usr/bin/env node
/**
 * PDF notehead geometry accuracy + WFY cursor smoothness — real-browser probe.
 *
 * Answers two questions with pixels, not assertions:
 *   1. How far is the app's computed notehead geometry from the PRINTED ink
 *      in the PDF canvas? (A fabricated marker is only honest if this is ~0.)
 *   2. Does the red cursor glide between Wait-For-You checkpoints, or teleport?
 *
 *   node scripts/audit/pdf-notehead-accuracy-probe.mjs
 *   BROWSER=webkit node scripts/audit/pdf-notehead-accuracy-probe.mjs
 */
import { mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, webkit } from 'playwright'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..', '..')
const outDir = join(root, 'tmp', 'pdf-notehead-accuracy')
mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const BASE = process.env.AUDIT_URL ?? 'http://127.0.0.1:5781/'
const BROWSER = process.env.BROWSER ?? 'chromium'

const browser = await ({ chromium, webkit }[BROWSER]).launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e.message ?? e)))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`)
})

const report = { base: BASE, browser: BROWSER, checks: [], errors }
const check = (name, pass, detail) => {
  report.checks.push({ name, pass, detail })
  console.log(pass ? 'PASS' : 'FAIL', name, JSON.stringify(detail ?? ''))
}

try {
  await page.goto(`${BASE}?e2e-midi=1&debugNoteMarkers=1`)
  await page.getByRole('button', { name: 'Open featured score: Menuet in F, K.2' }).click()
  await page.locator('.react-pdf__Page canvas').first().waitFor({ timeout: 60_000 })
  await sleep(9000)
  await page.getByRole('radio', { name: 'Wait For You', exact: true }).click()
  await sleep(700)

  // ---------------------------------------------------------------- geometry
  // The debug flag renders the app's own computed highlight rects. Compare
  // each rect against the ink actually printed in the PDF canvas.
  const geometry = await page.evaluate(() => {
    const canvas = document.querySelector('.react-pdf__Page canvas')
    if (!canvas) return { error: 'no canvas' }
    const overlay = document.querySelector('.score-follow-overlay')
    if (!overlay) return { error: 'no overlay' }
    const canvasRect = canvas.getBoundingClientRect()
    const overlayRect = overlay.getBoundingClientRect()
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const dpr = canvas.width / canvasRect.width

    const boxes = [...overlay.querySelectorAll('.score-follow-overlay__note-highlight--debug')].map((el) => {
      const r = el.getBoundingClientRect()
      return {
        left: r.left - overlayRect.left,
        top: r.top - overlayRect.top,
        width: r.width,
        height: r.height,
      }
    })

    // Ink centroid + coverage inside each box, measured in CANVAS pixels.
    const measured = boxes.map((box) => {
      const sx = (box.left + overlayRect.left - canvasRect.left) * dpr
      const sy = (box.top + overlayRect.top - canvasRect.top) * dpr
      const sw = Math.max(1, Math.round(box.width * dpr))
      const sh = Math.max(1, Math.round(box.height * dpr))
      if (sx < 0 || sy < 0 || sx + sw > canvas.width || sy + sh > canvas.height) {
        return { out: true }
      }
      const data = ctx.getImageData(Math.round(sx), Math.round(sy), sw, sh).data
      let count = 0
      let sumX = 0
      let sumY = 0
      let minX = Infinity
      let maxX = -Infinity
      let minY = Infinity
      let maxY = -Infinity
      for (let y = 0; y < sh; y += 1) {
        for (let x = 0; x < sw; x += 1) {
          const i = (y * sw + x) * 4
          const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
          if (data[i + 3] > 40 && lum < 160) {
            count += 1
            sumX += x
            sumY += y
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
          }
        }
      }
      if (!count) {
        return { inkPixels: 0, boxW: sw, boxH: sh }
      }
      return {
        inkPixels: count,
        boxW: sw,
        boxH: sh,
        coverage: count / (sw * sh),
        centroidDxCanvasPx: sumX / count - sw / 2,
        centroidDyCanvasPx: sumY / count - sh / 2,
        inkW: maxX - minX + 1,
        inkH: maxY - minY + 1,
      }
    })

    return { canvasRect: canvasRect.toJSON(), overlayRect: overlayRect.toJSON(), dpr, boxes, measured }
  })

  console.log('GEOMETRY', JSON.stringify(geometry, null, 2))
  await page.screenshot({ path: join(outDir, `${BROWSER}-geometry.png`) })

  // ------------------------------------------------------- cursor smoothness
  await page.evaluate(() => {
    window.__motion = []
    const start = performance.now()
    const tick = () => {
      const el = document.querySelector('.score-follow-cursor')
      const r = el?.getBoundingClientRect()
      window.__motion.push({
        t: performance.now() - start,
        x: r?.x ?? null,
        y: r?.y ?? null,
        visible: el ? getComputedStyle(el).display !== 'none' : false,
      })
      if (performance.now() - start < 1400) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  await sleep(200)
  await page.getByRole('button', { name: 'Continue (Enter)', exact: true }).click()
  await sleep(1500)
  const motion = await page.evaluate(() => window.__motion)
  await page.screenshot({ path: join(outDir, `${BROWSER}-after-continue.png`) })

  const xs = motion.filter((f) => f.visible && f.x != null).map((f) => Math.round(f.x * 100) / 100)
  const distinct = [...new Set(xs)]
  // Largest single-frame jump — a teleport shows up as one huge step.
  let maxJump = 0
  for (let i = 1; i < xs.length; i += 1) {
    maxJump = Math.max(maxJump, Math.abs(xs[i] - xs[i - 1]))
  }
  console.log('MOTION', JSON.stringify({ distinct, maxJump, samples: xs.length }, null, 2))
  check('WFY cursor produced intermediate frames', distinct.length >= 5, {
    distinct: distinct.length,
    maxJump,
  })
  check('WFY cursor never teleported (no jump > 12px/frame)', maxJump <= 12, { maxJump })

  report.motion = { distinct, maxJump }
  report.geometry = geometry
  check('No page exceptions', errors.length === 0, errors)
} catch (e) {
  check('probe completed', false, String(e.stack ?? e))
  await page.screenshot({ path: join(outDir, `${BROWSER}-failure.png`) }).catch(() => {})
}

console.log(JSON.stringify(report, null, 2))
await context.close()
await browser.close()
process.exitCode = report.checks.some((c) => !c.pass) ? 1 : 0
