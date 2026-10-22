#!/usr/bin/env node
/**
 * Regression guard: the PDF-first path must still work after the Audio Vision
 * repair. Imports a real PDF, opens the score, and proves the PDF practice
 * workspace (canvas + page follow) is what opens - not the arrangement
 * surface, and not an empty state.
 *
 * Usage: E2E_BASE_URL=https://corranzo.com/ node scripts/browser-pdf-first-regression.mjs
 */
import { mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const outDir = join(root, 'tmp', 'pdf-first-regression')
const PORT = Number(process.env.E2E_PORT ?? 5631)
const baseUrl = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}/`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const report = { pass: [], fail: [] }
const pass = (name, detail = '') => { report.pass.push(name); console.log(`PASS  ${name} ${detail}`) }
const fail = (name, detail = '') => { report.fail.push(name); console.error(`FAIL  ${name} ${detail}`) }

await mkdir(outDir, { recursive: true })
const pdfFixture = join(root, 'public', 'fixtures', 'demo-minuet-in-g.pdf')

const externalBase = Boolean(process.env.E2E_BASE_URL)
const vite = externalBase ? null : await createServer({
  root,
  configFile: join(root, 'vite.config.js'),
  logLevel: 'silent',
  server: { host: '127.0.0.1', port: PORT, strictPort: true },
})
if (vite) { await vite.listen(); await sleep(800) }

const { chromium } = await import('playwright')
const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] })
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await context.newPage()
const consoleErrors = []
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`))

try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await sleep(2500)
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('nav button')].find((el) =>
      el.textContent?.replace(/^\s*\d+/, '').replace(/\s+/g, ' ').trim() === 'Import')
    button?.click()
  })
  await sleep(900)
  await page.locator('input[type="file"][aria-label="Choose score PDF"]').first().setInputFiles(pdfFixture)
  await page.getByText(/pages? · PDF|PDF selected/i).first().waitFor({ timeout: 60000 })
  pass('pdf imported', pdfFixture.split('/').pop())

  // The import view must still show the PDF, and the arrangement banner must
  // NOT be there (no arrangement has been generated yet).
  const importState = await page.evaluate(() => ({
    hasPdfCard: Boolean(document.querySelector('.score-import-file')),
    hasArrangementBanner: /Arranged from your recording/.test(document.querySelector('.score-import')?.textContent ?? ''),
    fileText: (document.querySelector('.score-import-file')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
  }))
  if (importState.hasPdfCard && !importState.hasArrangementBanner) {
    pass('import view shows the PDF, not an arrangement', importState.fileText.slice(0, 60))
  } else {
    fail('import view shows the PDF, not an arrangement', JSON.stringify(importState))
  }

  await page.getByRole('button', { name: /open score/i }).click()
  await page.waitForTimeout(6000)
  const practiceState = await page.evaluate(() => ({
    hasPdfWorkspace: Boolean(document.querySelector('.workspace-frame')),
    hasCanvas: Boolean(document.querySelector('.workspace-frame canvas')),
    hasArrangementSurface: Boolean(document.querySelector('.arrangement-practice')),
    header: (document.querySelector('.practice-workspace')?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 120),
  }))
  if (practiceState.hasPdfWorkspace && practiceState.hasCanvas && !practiceState.hasArrangementSurface) {
    pass('Open score opens the PDF practice workspace (page follow intact)', practiceState.header.slice(0, 60))
  } else {
    fail('Open score opens the PDF practice workspace (page follow intact)', JSON.stringify(practiceState).slice(0, 240))
  }
  await page.screenshot({ path: join(outDir, 'pdf-practice.png') })

  // The transport must still offer Preview / Play Along / Wait For You.
  const modes = await page.evaluate(() => {
    const groups = [...document.querySelectorAll('[role="radiogroup"]')]
    const el = groups.find((g) => /practice mode/i.test(g.getAttribute('aria-label') ?? ''))
    return (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
  })
  if (/preview/i.test(modes) && /play along/i.test(modes)) {
    pass('practice modes intact', modes.slice(0, 80))
  } else {
    fail('practice modes intact', modes.slice(0, 120))
  }
} catch (error) {
  fail('harness', String(error?.message ?? error).slice(0, 300))
} finally {
  try { await browser.close() } catch { /* noop */ }
  try { await vite?.close() } catch { /* noop */ }
}

report.consoleErrors = consoleErrors
console.log(`\npass=${report.pass.length} fail=${report.fail.length} consoleErrors=${consoleErrors.length}`)
process.exit(report.fail.length ? 1 : 0)
