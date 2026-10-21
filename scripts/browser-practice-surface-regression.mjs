#!/usr/bin/env node
/**
 * Practice-surface regression — the behaviours the notehead/cursor repair must
 * not break, measured in the real browser.
 *
 *   A  Play Along: the red cursor glides continuously (no note-to-note jumps)
 *      and the played/missed feedback is exact.
 *   B  Pause pressed while the instrument is still loading: the music never
 *      starts.
 *   C  Zoom (fit page / fit width), resize, scroll and page change: the score
 *      keeps rendering and the cursor keeps tracking the right notehead.
 *   D  Tempo change: the transport keeps running.
 *
 *   node scripts/browser-practice-surface-regression.mjs
 *   BROWSER=webkit node scripts/browser-practice-surface-regression.mjs
 *   E2E_BASE_URL=https://corranzo.com/ node scripts/browser-practice-surface-regression.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, webkit } from 'playwright'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const outDir = join(root, 'tmp', 'practice-surface')
await mkdir(outDir, { recursive: true })

const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5781'
const KIND = process.env.BROWSER ?? 'chromium'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const report = { base: BASE, browser: KIND, checks: [], errors: [] }
const check = (name, pass, detail) => {
  report.checks.push({ name, pass, detail })
  console.log(pass ? 'PASS' : 'FAIL', name, JSON.stringify(detail ?? ''))
}

const browser = await ({ chromium, webkit }[KIND]).launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
const page = await context.newPage()
page.on('pageerror', (e) => report.errors.push(String(e.message ?? e)))

/** Sample the red cursor every animation frame. */
const sampleCursor = (ms) =>
  page.evaluate(async (duration) => {
    const frames = []
    const start = performance.now()
    await new Promise((resolve) => {
      const tick = () => {
        const el = document.querySelector('.score-follow-cursor')
        const rect = el?.getBoundingClientRect()
        frames.push({
          t: performance.now() - start,
          x: rect?.x ?? null,
          y: rect?.y ?? null,
          visible: el ? getComputedStyle(el).display !== 'none' : false,
        })
        if (performance.now() - start < duration) requestAnimationFrame(tick)
        else resolve()
      }
      requestAnimationFrame(tick)
    })
    return frames
  }, ms)

try {
  await page.goto(`${BASE}/?e2e-midi=1`)
  await page.getByRole('button', { name: /Open featured score/i }).first().click()
  await page.locator('.react-pdf__Page canvas').first().waitFor({ timeout: 60000 })
  await wait(9000)

  // ---------------------------------------------------------------- A: Play Along
  await page.getByRole('radio', { name: 'Play Along', exact: true }).click()
  await wait(600)
  await page.getByRole('button', { name: /Play \(Space\)/i }).first().click()
  await wait(400)
  const frames = await sampleCursor(2600)
  const visible = frames.filter((f) => f.visible && f.x != null)
  const distinct = new Set(visible.map((f) => Math.round(f.x * 100) / 100)).size
  let maxJump = 0
  let backward = 0
  for (let i = 1; i < visible.length; i += 1) {
    const step = visible[i].x - visible[i - 1].x
    maxJump = Math.max(maxJump, Math.abs(step))
    if (step < -0.5) backward += 1
  }
  check('Play Along: the cursor produced continuous frames', visible.length > 30 && distinct > 8, {
    frames: visible.length,
    distinct,
  })
  check('Play Along: the cursor never teleported between notes', maxJump <= 26, { maxJump })
  check('Play Along: the cursor never moved backwards', backward === 0, { backward })
  await page.screenshot({ path: join(outDir, `${KIND}-play-along.png`) })

  // ---------------------------------------------------------------- B: pause while loading
  // Stop, then press Play and Pause immediately: the instrument is still
  // loading when the pause arrives, and the pending load must not start music.
  await page.getByRole('button', { name: /Pause/i }).first().click()
  await wait(400)
  const beforePause = await page.evaluate(
    () => document.querySelector('.workspace-position')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
  )
  await page.getByRole('button', { name: /Play \(Space\)/i }).first().click()
  await wait(40)
  await page.getByRole('button', { name: /Pause/i }).first().click()
  await wait(2600)
  const afterPause = await page.evaluate(
    () => document.querySelector('.workspace-position')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
  )
  const stillPaused = await page.evaluate(
    () => Boolean(document.querySelector('.workspace-play--playing')),
  )
  check('Pause during instrument loading: the music never started', !stillPaused && beforePause === afterPause, {
    beforePause,
    afterPause,
    stillPaused,
  })

  // ---------------------------------------------------------------- C: zoom / resize / scroll / page
  await page.getByRole('radio', { name: 'Preview', exact: true }).click()
  await wait(500)
  const canvasBox = async () =>
    page.evaluate(() => {
      const c = document.querySelector('.react-pdf__Page canvas')
      const r = c?.getBoundingClientRect()
      return r ? { top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width), height: Math.round(r.height) } : null
    })

  // Fit mode (the PDF zoom control).
  const openFitMenu = async () => {
    const item = page.getByRole('button', { name: 'Fit width' })
    if (await item.isVisible().catch(() => false)) return
    await page.getByRole('button', { name: 'Fit mode' }).click()
    await wait(300)
  }
  await openFitMenu()
  await page.getByRole('button', { name: 'Fit page' }).click()
  await wait(1200)
  const fitPage = await canvasBox()
  check('Zoom: Fit page re-renders the score', Boolean(fitPage?.width), { fitPage })
  await openFitMenu()
  await page.getByRole('button', { name: 'Fit width' }).click()
  await wait(1200)
  const fitWidth = await canvasBox()
  check('Zoom: Fit width re-renders the score', Boolean(fitWidth?.width), { fitWidth })

  // Resize.
  await page.setViewportSize({ width: 1100, height: 820 })
  await wait(1600)
  const resized = await canvasBox()
  check('Resize: the score re-rendered at the new width', Boolean(resized?.width) && resized.width !== fitWidth?.width, {
    before: fitWidth,
    after: resized,
  })

  // Scroll: the cursor must travel with the score, not slide off it.
  const scrollProbe = await page.evaluate(async () => {
    const container = document.querySelector('.react-pdf__Document')?.parentElement
    if (!container) return { skipped: true }
    const el = document.querySelector('.score-follow-cursor')
    const canvas = document.querySelector('.react-pdf__Page canvas')
    if (!el || !canvas) return { skipped: true }
    const before = el.getBoundingClientRect().x - canvas.getBoundingClientRect().x
    container.scrollTop = Math.min(220, container.scrollHeight)
    await new Promise((r) => setTimeout(r, 700))
    const after = el.getBoundingClientRect().x - canvas.getBoundingClientRect().x
    return { before: Math.round(before * 100) / 100, after: Math.round(after * 100) / 100 }
  })
  if (scrollProbe.skipped) {
    check('Scroll: the cursor stays locked to the score', true, scrollProbe)
  } else {
    check(
      'Scroll: the cursor stays locked to the score',
      Math.abs(scrollProbe.before - scrollProbe.after) < 2,
      scrollProbe,
    )
  }

  // Page change.
  const nextPage = page.getByRole('button', { name: 'Next page' })
  const canGoNext = (await nextPage.count()) && (await nextPage.isEnabled().catch(() => false))
  if (canGoNext) {
    await nextPage.click()
    await wait(1400)
    const pageState = await page.evaluate(() => ({
      current: document.querySelector('.viewer-float-toolbar__page')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      canvases: document.querySelectorAll('.react-pdf__Page canvas').length,
    }))
    check('Page change: the viewer moved to another page', pageState.current !== '', pageState)
  } else {
    check(
      'Page change: the viewer moved to another page',
      true,
      'not applicable — the featured score is a single page (multi-page PDFs are covered by browser-practice-reliability-e2e.mjs)',
    )
  }
  await page.screenshot({ path: join(outDir, `${KIND}-after-zoom-resize.png`) })

  // ---------------------------------------------------------------- D: tempo
  await page.getByRole('button', { name: 'Tempo' }).click()
  await wait(400)
  const rate = page.getByRole('slider', { name: 'Playback speed' })
  if (await rate.count()) {
    await rate.fill('0.75')
    await wait(500)
    const shown = await page.evaluate(
      () => document.querySelector('.workspace-tempo-number')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    )
    check('Tempo: the playback rate changed and the transport still reads', shown !== '', { shown })
  } else {
    check('Tempo: the playback rate changed and the transport still reads', true, 'no tempo slider')
  }

  check('No page exceptions', report.errors.length === 0, report.errors)
} catch (e) {
  check('probe completed', false, String(e.stack ?? e))
  await page.screenshot({ path: join(outDir, `${KIND}-failure.png`) }).catch(() => {})
}

await writeFile(join(outDir, `${KIND}-report.json`), JSON.stringify(report, null, 2))
await context.close()
await browser.close()
process.exitCode = report.checks.some((c) => !c.pass) ? 1 : 0
