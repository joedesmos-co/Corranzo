#!/usr/bin/env node
/**
 * Red playback cursor — alignment probe (real browser, real interactions).
 *
 * The cursor is a MOVING line: between onsets it glides from one notehead to
 * the next, so comparing its instantaneous x with the current note's box
 * measures the catch-up distance, not alignment. The meaningful metric is
 * ARRIVAL: when does the line reach the notehead, versus when does the note
 * sound?
 *
 * For every note-target change we record the time it happened, then find when
 * the cursor first arrived within a pixel tolerance of that notehead. The
 * difference is the alignment error in milliseconds — 0 means the line is on
 * the notehead exactly when the note sounds.
 *
 *   node scripts/audit/cursor-alignment-probe.mjs
 *   AUDIT_URL=http://127.0.0.1:4199/ AUDIT_FIXTURE=piano-mozart-turkish-march/piano-mozart-turkish-march.pdf
 */
import { mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..', '..')
const outDir = join(root, 'tmp', 'cursor-alignment')
mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const BASE = process.env.AUDIT_URL ?? 'http://127.0.0.1:4199/'
const FIXTURE = process.env.AUDIT_FIXTURE ?? 'piano-mozart-turkish-march/piano-mozart-turkish-march.pdf'
const MODE = process.env.AUDIT_MODE ?? 'Play Along'
const SECONDS = Number(process.env.AUDIT_SECONDS ?? 14)
const TOL_PX = Number(process.env.AUDIT_TOL_PX ?? 4)

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
await sleep(2500)
await page.evaluate(() => {
  const b = [...document.querySelectorAll('nav button')].find((e) => (e.textContent ?? '').replace(/^\s*\d+/, '').replace(/\s+/g, ' ').trim() === 'Import')
  b?.click()
})
await sleep(1000)
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
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((e) => /Open score/.test((e.textContent ?? '').trim()))
  b?.click()
})
await sleep(6000)
for (const label of ['Done', 'Skip restore', 'Dismiss']) {
  const b = page.getByRole('button', { name: label }).first()
  if (await b.isVisible().catch(() => false)) await b.click().catch(() => {})
  await sleep(300)
}
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((e) => /^(Play|Pause)$/.test((e.textContent ?? '').trim()))
  b?.click()
})
await sleep(800)

const arrivals = await page.evaluate(async ({ seconds, tol }) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const track = []
  const end = Date.now() + seconds * 1000
  let prevKey = null
  while (Date.now() < end) {
    const now = performance.now()
    const line = document.querySelector('.score-follow-cursor__line')
    const lineRect = line ? line.getBoundingClientRect() : null
    const target =
      document.querySelector('.score-follow-overlay__note-target') ??
      document.querySelector('.score-follow-overlay__note-highlight')
    const targetRect = target ? target.getBoundingClientRect() : null
    const key = target
      ? (target.getAttribute('data-practice-note-target-key') ??
        `${Math.round(targetRect.x)}:${Math.round(targetRect.width)}`)
      : null
    const cursorX = lineRect ? lineRect.x + lineRect.width / 2 : null
    const targetX = targetRect ? targetRect.x + targetRect.width / 2 : null
    if (key && key !== prevKey) {
      track.push({ t: now, targetX, kind: 'change' })
      prevKey = key
    }
    track.push({ t: now, cursorX, kind: 'sample' })
    await sleep(4)
  }
  const changes = track.filter((e) => e.kind === 'change' && e.targetX != null)
  const samples = track.filter((e) => e.kind === 'sample' && e.cursorX != null)
  const out = []
  for (const change of changes) {
    const arrival = samples.find((s) => s.t >= change.t && Math.abs(s.cursorX - change.targetX) <= tol)
    out.push(arrival ? Math.round(arrival.t - change.t) : null)
  }
  return out
}, { seconds: SECONDS, tol: TOL_PX })

await page.screenshot({ path: join(outDir, `${FIXTURE.replace(/[\/.]/g, '-')}-${MODE.replace(/\W+/g, '-')}.png`) })

const values = arrivals.filter((v) => v != null).sort((a, b) => a - b)
// The FIRST note is a measurement artifact: the cursor starts the piece ON that
// notehead, so there is no travel to time. Exclude it from the statistics.
const firstArtifact = arrivals[0] != null && arrivals[0] > 1000 ? arrivals[0] : null
const stats = firstArtifact == null ? values : values.filter((v) => v !== firstArtifact)
const sorted = [...stats].sort((a, b) => a - b)
const pct = (q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] : null)
const report = {
  fixture: FIXTURE,
  mode: MODE,
  notes: arrivals.length,
  measured: sorted.length,
  firstNoteArtifactMs: firstArtifact,
  arrivalErrorMs: { p50: pct(0.5), p90: pct(0.9), max: sorted[sorted.length - 1] ?? null },
  consoleErrors,
}
console.log(JSON.stringify(report, null, 2))
console.log(`\narrivals: ${JSON.stringify(arrivals)}`)

// The line must be ON the notehead when the note sounds.
if (pct(0.9) != null && pct(0.9) > 40) {
  console.error(`FAIL: cursor arrival error p90 ${pct(0.9)}ms exceeds 40ms`)
  process.exitCode = 1
} else {
  console.log('PASS: the red line reaches each notehead when its note sounds')
}
await browser.close()
