// Guitar import lifecycle browser suite (real app, real PDF.js).
//
// Prereq: dev server running (default http://localhost:5200).
// Usage:  node scripts/guitar-import-lifecycle-suite.mjs [baseUrl]
//
// Every scenario runs in a FRESH browser context (no restored score) and must
// end in an actionable state:
//   READY (usable score) | RECOVERABLE (clear message + Try again)
// "CHECKING" at the end of a scenario is a hard failure.

import { chromium, webkit } from 'playwright'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { writeFileSync } from 'node:fs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FIX = join(ROOT, 'benchmarks/omr-fixtures/import-lifecycle')
const BASE = process.argv[2] || process.env.CORRANZO_BASE_URL || 'http://localhost:5200'
const MAX_MS = 60000
const CORRUPT = '/tmp/corranzo-corrupt.pdf'
writeFileSync(CORRUPT, '%PDF-1.4 not really a pdf')

const SCENARIOS = [
  { name: 'valid five-page standard', pdf: join(FIX, 'valid-standard-5p.pdf'), expect: 'READY' },
  { name: 'partial-measure five-page', pdf: join(FIX, 'partial-measure-5p.pdf'), expect: 'RECOVERABLE' },
  { name: 'corrupt PDF', pdf: CORRUPT, expect: 'RECOVERABLE' },
  { name: 'failure then retry with valid PDF', pdf: join(FIX, 'partial-measure-5p.pdf'), thenPdf: join(FIX, 'valid-standard-5p.pdf'), expect: 'READY' },
]

function classifier(text) {
  if (/Cancel preparation|Starting…|Cleaning up page|Detecting notes/.test(text)) return 'PREPARING'
  if (/Your score is ready/.test(text)) return 'READY'
  if (/isn.t ready to open/.test(text)) return 'AVAILABLE_ERROR'
  if (/Checking your score/.test(text) && !/Try again/.test(text)) return 'CHECKING'
  if (/Try again/.test(text)) return 'RECOVERABLE'
  return 'OTHER'
}

async function waitSettled(page, maxMs = MAX_MS) {
  const start = Date.now()
  let last = ''
  let sawPreparing = false
  while (Date.now() - start < maxMs) {
    const text = await page.locator('body').innerText().catch(() => '')
    const state = classifier(text)
    if (state === 'PREPARING') sawPreparing = true
    if (state !== last) { console.log(`    [${Date.now() - start}ms] ${state}`); last = state }
    if (state === 'READY' || state === 'RECOVERABLE' || state === 'AVAILABLE_ERROR') {
      // A stale READY frame can appear before the new run starts; failures
      // (corrupt PDF) legitimately land here before any PREPARING frame.
      if (state === 'READY' && !sawPreparing) { await page.waitForTimeout(1200); continue }
      return state
    }
    await page.waitForTimeout(1000)
  }
  return 'CHECKING'
}

async function waitForNewRun(page, maxMs = 20000) {
  const start = Date.now()
  while (Date.now() - start < maxMs) {
    const text = await page.locator('body').innerText().catch(() => '')
    if (/Cancel preparation|Starting…|Cleaning up page|Detecting notes|Your score is ready/.test(text)) return true
    await page.waitForTimeout(500)
  }
  return false
}

async function startImport(page, file) {
  const acoustic = page.getByRole('button', { name: 'Acoustic Guitar' })
  if (await acoustic.count()) await acoustic.first().click()
  const importBtn = page.getByRole('button', { name: /^Import$/ }).first()
  if (await importBtn.count()) await importBtn.click()
  await page.waitForTimeout(500)
  await page.locator('input[type=file]').first().setInputFiles(file)
}

const engine = (process.env.BROWSER || 'chromium').toLowerCase() === 'webkit' ? webkit : chromium
const browser = await engine.launch()
let failures = 0
for (const scenario of SCENARIOS) {
  console.log(`\n== ${scenario.name} ==`)
  const context = await browser.newContext()
  const page = await context.newPage()
  const consoleErrors = []
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 180)) })
  page.on('pageerror', e => consoleErrors.push(`pageerror: ${e.message.slice(0, 180)}`))
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(800)
  const t0 = Date.now()
  await startImport(page, scenario.pdf)
  let state = await waitSettled(page)
  console.log(`  -> ${state} in ${Date.now() - t0}ms`)
  if (scenario.thenPdf) {
    await page.locator('input[type=file]').first().setInputFiles(scenario.thenPdf)
    await waitForNewRun(page)
    state = await waitSettled(page)
    console.log(`  -> retry ${state} in ${Date.now() - t0}ms`)
  }
  const acceptable = scenario.expect === 'READY' ? ['READY'] : ['RECOVERABLE', 'AVAILABLE_ERROR']
  if (!acceptable.includes(state)) { failures += 1; console.log(`  FAIL: expected ${acceptable.join('|')}, got ${state}`) }
  const relevant = consoleErrors.filter(e => !/InvalidPDF|UnknownError|Setting up fake worker|Failed to load resource/.test(e))
  if (relevant.length) console.log('  console errors:', relevant.slice(0, 3))
  const buttons = (await page.locator('button').allInnerTexts().catch(() => []))
    .map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean)
  console.log('  actions:', buttons.filter(b => /Try again|Open score|Cancel|Choose another|Report/.test(b)).join(' | ') || '(none)')
  await context.close()
}

await browser.close()
console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} (${process.env.BROWSER || 'chromium'}) — ${SCENARIOS.length - failures}/${SCENARIOS.length} scenarios`)
process.exitCode = failures === 0 ? 0 : 1
