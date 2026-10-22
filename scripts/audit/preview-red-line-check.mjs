#!/usr/bin/env node
/**
 * Live check: Preview mode must show the RED LINE and NO blue notehead
 * highlight boxes. Captures a screenshot as evidence.
 */
import { mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..', '..')
const outDir = join(root, 'tmp', 'cursor-alignment')
mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const BASE = process.env.AUDIT_URL ?? 'https://corranzo.com/'
const FIXTURE = process.env.AUDIT_FIXTURE ?? 'piano-mozart-turkish-march/piano-mozart-turkish-march.pdf'
const MODE = process.env.AUDIT_MODE ?? 'Preview'

const { chromium } = await import('playwright')
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const consoleErrors = []
page.on('console', (m) => {
  if (m.type() !== 'error') return
  const t = m.text()
  if (/favicon|DevTools|google|gstatic|fonts\.|cloudflareinsights|net::ERR_|AudioContext/.test(t)) return
  consoleErrors.push(t.slice(0, 200))
})

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await sleep(3000)
await page.evaluate(() => {
  const b = [...document.querySelectorAll('nav button')].find((e) => (e.textContent ?? '').replace(/^\s*\d+/, '').replace(/\s+/g, ' ').trim() === 'Import')
  b?.click()
})
await sleep(1200)
await page.setInputFiles('input[type=file]', join(root, 'public', 'fixtures', 'practice-library', FIXTURE))
await page.waitForFunction(
  () => [...document.querySelectorAll('button')].some((b) => /Open score/.test((b.textContent ?? '').trim())),
  { timeout: 300000 },
)
await sleep(1500)
await page.evaluate((m) => {
  const b = [...document.querySelectorAll('button')].find((e) => (e.textContent ?? '').trim().startsWith(m))
  b?.click()
}, MODE)
await sleep(500)
await page.evaluate(() => { [...document.querySelectorAll('button')].find((e) => /Open score/.test((e.textContent ?? '').trim()))?.click() })
await sleep(6000)
for (const label of ['Done', 'Skip restore', 'Dismiss']) {
  const b = page.getByRole('button', { name: label }).first()
  if (await b.isVisible().catch(() => false)) await b.click().catch(() => {})
  await sleep(300)
}
await page.evaluate(() => { [...document.querySelectorAll('button')].find((e) => /^(Play|Pause)$/.test((e.textContent ?? '').trim()))?.click() })
await sleep(2500)

const state = await page.evaluate(() => {
  const line = document.querySelector('.score-follow-cursor__line')
  const lineRect = line ? line.getBoundingClientRect() : null
  const blueBoxes = [...document.querySelectorAll('.score-follow-overlay__note-highlight')]
  const blueStateBoxes = blueBoxes.filter((b) => /state-current|state-completed|tone-needed/.test(b.className))
  return {
    redLinePresent: Boolean(line),
    redLineX: lineRect ? Math.round(lineRect.x) : null,
    redLineVisible: line ? getComputedStyle(line.parentElement).display !== 'none' : false,
    noteHighlightBoxes: blueBoxes.length,
    blueStateBoxes: blueStateBoxes.length,
    scoreNoteStateElements: document.querySelectorAll('[data-score-note-state]').length,
    consoleErrors: 0,
  }
})
await page.screenshot({ path: join(outDir, `live-preview-${MODE.toLowerCase()}.png`) })
console.log(JSON.stringify({ ...state, consoleErrors }, null, 2))
if (MODE === 'Preview') {
  if (!state.redLinePresent) { console.error('FAIL: no red line in Preview'); process.exitCode = 1 }
  else if (state.blueStateBoxes > 0) { console.error(`FAIL: ${state.blueStateBoxes} blue notehead boxes in Preview`); process.exitCode = 1 }
  else console.log('PASS: Preview shows the red line and no blue notehead highlight boxes')
} else {
  console.log(`Play Along keeps ${state.noteHighlightBoxes} note highlight box(es) — expected`)
}
await browser.close()
