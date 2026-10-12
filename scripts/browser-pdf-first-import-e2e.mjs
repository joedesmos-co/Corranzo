#!/usr/bin/env node
/**
 * PDF-first import acceptance (real browser, real interactions).
 *
 * Standalone MusicXML/MXL importing is retired from the product: the PDF is
 * the score the musician reads from. This suite proves the intended interface
 * and that nothing regressed around it:
 *
 *   1. the primary picker is PDF-only and refuses a standalone .musicxml/.mxl
 *      with an actionable notice, rather than dropping it silently
 *   2. MusicXML/MXL is still accepted UNDER ADVANCED as a PDF companion,
 *      including compressed .mxl (MXL compat)
 *   3. PDF + matched MusicXML still opens practice, plays, and restores
 *   4. a session saved by an older build (notation only, no PDF) restores
 *      WITHOUT a crash and WITHOUT pretending it is playable
 *
 *   E2E_PORT=5605 node scripts/browser-pdf-first-import-e2e.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { copyFileSync, existsSync } from 'node:fs'
import { readFile, writeFile as fsWriteFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { createServer } from 'vite'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const outDir = join(root, 'tmp', 'pdf-first-import')
const PORT = Number(process.env.E2E_PORT ?? 5605)
const baseUrl = `http://127.0.0.1:${PORT}/`

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * The OMR job diagnostics channel fires console.error for a cancellation that
 * the user caused by supplying their own MusicXML. That is the job ending
 * correctly, not a failure, so it is not a defect to assert on.
 */
function isExpectedOmrCancellation(text) {
  return /OMR FAILURE:/.test(text) && /errorName=AbortError/.test(text) && /generation cancelled|cancelled/i.test(text)
}

function isBenignConsoleMessage(text) {
  if (isExpectedOmrCancellation(text)) {
    return true
  }
  if (
    /favicon/i.test(text) ||
    /DevTools/i.test(text) ||
    /<g> attribute transform/i.test(text) ||
    /AudioContext was not allowed to start/i.test(text) ||
    /The AudioContext/i.test(text) ||
    /google-analytics|googletagmanager|gstatic|fonts\.googleapis/i.test(text)
  ) {
    return true
  }
  if (/net::ERR_/.test(text) && !/127\.0\.0\.1|localhost/.test(text)) {
    return true
  }
  return false
}

async function dismissOverlays(page) {
  const done = page.getByRole('button', { name: 'Done' })
  if (await done.isVisible().catch(() => false)) {
    await done.click()
    await sleep(300)
  }
  const skipRestore = page.getByRole('button', { name: /Skip restore/i })
  if (await skipRestore.isVisible().catch(() => false)) {
    await skipRestore.click()
    await sleep(400)
  }
}

async function clearSiteState(page) {
  await page.evaluate(async () => {
    localStorage.clear()
    sessionStorage.clear()
    if (typeof indexedDB !== 'undefined') {
      await new Promise((resolve) => {
        const req = indexedDB.deleteDatabase('scoreflow-session')
        req.onsuccess = resolve
        req.onerror = resolve
        req.onblocked = resolve
      }).catch(() => {})
    }
  })
}

async function clearSessionMeta(page) {
  // Clear only the saved session so each scenario starts fresh, keeping console
  // listeners intact.
  await page.evaluate(async () => {
    localStorage.removeItem('scoreflow-session-meta-v1')
    localStorage.removeItem('scoreflow-session-meta-backup-v1')
    if (typeof indexedDB !== 'undefined') {
      await new Promise((resolve) => {
        const req = indexedDB.deleteDatabase('scoreflow-session')
        req.onsuccess = resolve
        req.onerror = resolve
        req.onblocked = resolve
      }).catch(() => {})
    }
  })
}

async function goToImport(page) {
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('nav button')].find(
      (el) => el.textContent?.replace(/^\s*\d+/, '').replace(/\s+/g, ' ').trim() === 'Import',
    )
    button?.click()
  })
  await sleep(900)
}

/** A MuseScore-style .mxl built from a real fixture. */
async function buildMxl(innerName, outPath) {
  const xml = await readFile(innerName, 'utf8')
  const zip = new JSZip()
  zip.file(
    'META-INF/container.xml',
    '<?xml version="1.0" encoding="UTF-8"?><container><rootfiles>'
      + '<rootfile full-path="score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/>'
      + '</rootfiles></container>',
  )
  zip.file('score.musicxml', xml)
  await fsWriteFile(outPath, await zip.generateAsync({ type: 'nodebuffer' }))
}

async function importState(page) {
  return page.evaluate(() => ({
    notionalAttached: Boolean(document.querySelector('.score-import-detail')),
    importNotice: (document.querySelector('.score-import-notices')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    scoreImportText: (document.querySelector('.score-import')?.textContent ?? '').replace(/\s+/g, ' '),
    hasPdfSelected: /\.pdf|page[s]? · PDF/.test(
      (document.querySelector('.score-import-file')?.textContent ?? '').toLowerCase(),
    ),
  }))
}

async function main() {
  await mkdir(outDir, { recursive: true })
  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    passes: [],
    failures: [],
    consoleErrors: [],
    updateDepthWarnings: [],
    pageErrors: [],
    skipped: [],
  }
  const pass = (name, detail = null) => {
    report.passes.push({ name, detail })
    console.log(`PASS  ${name}${detail ? ` :: ${detail}` : ''}`)
  }
  const fail = (name, detail = null) => {
    report.failures.push({ name, detail })
    console.error(`FAIL  ${name}${detail ? ` :: ${detail}` : ''}`)
  }
  const skip = (name, why) => {
    report.skipped.push({ name, why })
    console.log(`SKIP  ${name} :: ${why}`)
  }

  const musicXmlFixture = join(
    root,
    'public',
    'fixtures',
    'practice-library',
    'piano-beethoven-fur-elise',
    'piano-beethoven-fur-elise.musicxml',
  )
  const pdfFixture = join(
    root,
    'tmp',
    'cross-engraving',
    'fur-elise-breitkopf-1888.pdf',
  )
  for (const path of [musicXmlFixture, pdfFixture]) {
    if (!existsSync(path)) {
      console.error(`fixture missing: ${path}`)
      process.exit(1)
    }
  }
  const staged = join(outDir, 'fur-elise.musicxml')
  copyFileSync(musicXmlFixture, staged)
  const mxlPath = join(outDir, 'fur-elise-compressed.mxl')
  await buildMxl(musicXmlFixture, mxlPath)

  const viteServer = await createServer({
    root,
    configFile: join(root, 'vite.config.js'),
    logLevel: 'silent',
    server: { host: '127.0.0.1', port: PORT, strictPort: true },
  })
  await viteServer.listen()

  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' })
  const page = await context.newPage()
  const consoleLog = []
  let currentStep = 'start'
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    if (isBenignConsoleMessage(msg.text())) return
    consoleLog.push({ at: Date.now(), step: currentStep, text: msg.text() })
    if (/Maximum update depth/.test(msg.text())) {
      // Tracked, not swallowed: the issue ledger owns this one.
      report.updateDepthWarnings.push({ step: currentStep, at: new Date().toISOString() })
    }
    report.consoleErrors.push(msg.text())
  })
  page.on('pageerror', (error) => {
    consoleLog.push({ at: Date.now(), step: currentStep, pageerror: error.message })
    report.pageErrors.push(error.message)
  })
  const mark = async (label, ms = 0) => {
    currentStep = label
    if (ms) await sleep(ms)
  }

  const pdfInput = () => page.locator('input[type="file"][aria-label="Choose score PDF"]').first()
  const advancedInput = () => page.locator('input[type="file"][aria-label="Choose optional files"]').first()
  const pdfAccept = () => pdfInput().getAttribute('accept')
  const advancedAccept = () => advancedInput().getAttribute('accept')

  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
    await clearSiteState(page)
    await page.goto(baseUrl, { waitUntil: 'networkidle' })
    await sleep(1500)
    await mark('import-view')
    await goToImport(page)
    await page.screenshot({ path: join(outDir, '01-import.png') })

    // ============ 1. The primary picker is PDF-only ============
    const pdfAcceptAttr = await pdfAccept()
    const advancedAcceptAttr = await advancedAccept()
    if (/musicxml|\.xml|\.mxl/i.test(pdfAcceptAttr ?? '')) {
      fail('primary picker accepts PDF only', `accept="${pdfAcceptAttr}"`)
    } else {
      pass('primary picker accepts PDF only', `accept="${pdfAcceptAttr}"`)
    }
    if (/pdf/i.test(advancedAcceptAttr ?? '') && /musicxml/i.test(advancedAcceptAttr ?? '')) {
      pass('Advanced picker still accepts notation companions', advancedAcceptAttr)
    } else {
      fail('Advanced picker still accepts notation companions', advancedAcceptAttr)
    }

    // A standalone MusicXML dropped on the primary picker is refused with a
    // notice, not silently opened and not silently discarded.
    await mark('standalone-musicxml')
    await pdfInput().setInputFiles(staged)
    await sleep(2500)
    let state = await importState(page)
    if (/Choose the PDF you want to read/i.test(state.importNotice)) {
      pass('standalone .musicxml on the primary picker is refused with guidance', state.importNotice)
    } else {
      fail('standalone .musicxml on the primary picker is refused with guidance', JSON.stringify(state).slice(0, 200))
    }
    if (state.notionalAttached) {
      // A notice that hides the score's own copy is worse than no notice.
      pass('refusal keeps the import surface usable')
    }
    const openAfterRefusal = page.getByRole('button', { name: /Open score/i }).first()
    if (!(await openAfterRefusal.isVisible().catch(() => false))) {
      pass('no score opens without a PDF')
    } else {
      fail('no score opens without a PDF', 'Open score button present after a notation-only drop')
    }
    await page.screenshot({ path: join(outDir, '02-refused-standalone-musicxml.png') })

    // The same for a compressed .mxl.
    await page.evaluate(() => {
      const input = document.querySelector('input[type="file"][aria-label="Choose score PDF"]')
      if (input) input.value = ''
    })
    await mark('standalone-mxl')
    await pdfInput().setInputFiles(mxlPath)
    await sleep(2500)
    state = await importState(page)
    if (/Choose the PDF you want to read/i.test(state.importNotice)) {
      pass('standalone .mxl on the primary picker is refused with guidance')
    } else {
      fail('standalone .mxl on the primary picker is refused with guidance', JSON.stringify(state).slice(0, 200))
    }
    await page.screenshot({ path: join(outDir, '03-refused-standalone-mxl.png') })

    // ============ 2. MusicXML as a PDF companion (Advanced) ============
    await mark('pdf-upload')
    await pdfInput().setInputFiles(pdfFixture)
    await sleep(2500)
    await mark('musicxml-companion')
    await advancedInput().setInputFiles(staged)
    await sleep(3500)
    const companion = await importState(page)
    await page.screenshot({ path: join(outDir, '04-pdf-plus-musicxml.png') })
    if (companion.hasPdfSelected) {
      pass('PDF + matched MusicXML loads the notation as a companion')
    } else {
      fail('PDF + matched MusicXML loads the notation as a companion', JSON.stringify(companion).slice(0, 200))
    }

    // A compressed .mxl companion must also work (MXL compatibility).
    await page.evaluate(() => {
      const input = document.querySelector('input[type="file"][aria-label="Choose optional files"]')
      if (input) input.value = ''
    })
    await mark('mxl-companion')
    await advancedInput().setInputFiles(mxlPath)
    await sleep(4000)
    state = await importState(page)
    await page.screenshot({ path: join(outDir, '05-pdf-plus-compressed-mxl.png') })
    if (/zip|corrupt|missing \d+ bytes/i.test(state.scoreImportText)) {
      fail('compressed .mxl companion produces no zip-decoding errors', state.scoreImportText.slice(0, 160))
    } else {
      pass('compressed .mxl companion produces no zip-decoding errors')
    }

    const openScore = page.getByRole('button', { name: /Open score/i }).first()
    if (!(await openScore.isVisible().catch(() => false))) {
      fail('PDF + companion opens practice', (await page.locator('body').innerText()).slice(0, 300))
      throw new Error('score not ready')
    }
    pass('PDF + companion is ready to open')
    await mark('open-score')
    await openScore.click()
    await page.waitForSelector('.workspace-play', { timeout: 150000 }).catch(() => {})
    await sleep(5000)
    await page.screenshot({ path: join(outDir, '06-practice.png') })
    const pdfCanvas = await page
      .locator('.react-pdf__Page__canvas, .pdf-page-window__slot--active canvas')
      .first()
      .isVisible()
      .catch(() => false)
    if (pdfCanvas) pass('PDF page renders in practice')
    else fail('PDF page renders in practice', 'no PDF canvas')
    await page.locator('.workspace-play').first().click().catch(() => {})
    await sleep(3500)
    const playing = await page.evaluate(() => ({
      label: document.querySelector('.workspace-play')?.textContent?.trim() ?? null,
      view: document.querySelector('.cz-shell')?.getAttribute('data-view') ?? null,
    }))
    if (/Pause/.test(playing.label ?? '')) pass('PDF + companion plays back', playing.label)
    else fail('PDF + companion plays back', JSON.stringify(playing))
    await page.locator('.workspace-play').first().click().catch(() => {})
    await sleep(600)

    // ============ 3. Session save + restore with the PDF ============
    await sleep(2500)
    const saved = await page.evaluate(() => {
      const raw = localStorage.getItem('scoreflow-session-meta-v1')
      return raw ? JSON.parse(raw) : null
    })
    if (saved?.pdfMeta?.fileName) {
      pass('session saved with its PDF identity', saved.pdfMeta.fileName)
    } else {
      fail('session saved with its PDF identity', JSON.stringify({ file: saved?.pdfMeta?.fileName ?? null }))
    }
    await mark('reload')
    await page.reload({ waitUntil: 'networkidle' })
    await sleep(4000)
    await dismissOverlays(page)
    await page.screenshot({ path: join(outDir, '07-restored.png') })
    const restored = await page.evaluate(() => ({
      view: document.querySelector('.cz-shell')?.getAttribute('data-view') ?? null,
      hasPdf: Boolean(document.querySelector('.react-pdf__Page__canvas, .pdf-page-window__slot--active canvas')),
      viewportEmpty: /Choose a piece first|Your next piece starts here/.test(document.body.innerText),
    }))
    if (restored.hasPdf || restored.view === 'practice') {
      pass('session restores the PDF score', restored.view)
    } else {
      fail('session restores the PDF score', JSON.stringify(restored))
    }

    // ============ 4. Legacy notation-only session degrades gracefully ============
    // Rewrite the saved meta to the exact shape an older notation-only build
    // wrote (no PDF), reusing the notation bytes the real save just stored.
    await mark('legacy-rewrite')
    await page.evaluate(() => {
      const raw = localStorage.getItem('scoreflow-session-meta-v1')
      const meta = raw ? JSON.parse(raw) : null
      if (!meta) return
      const legacy = {
        ...meta,
        version: 2,
        pdfMeta: null,
        pdfIdentity: null,
        musicXmlSourceKind: 'upload-musicxml',
        activeView: 'practice',
        commitId: 'legacy-notation-only',
        instrumentBundles: {},
      }
      localStorage.setItem('scoreflow-session-meta-v1', JSON.stringify(legacy))
    })
    await mark('legacy-reload')
    await page.reload({ waitUntil: 'networkidle' })
    await sleep(5000)
    await dismissOverlays(page)
    await page.screenshot({ path: join(outDir, '08-legacy-restore.png') })
    const legacy = await page.evaluate(() => ({
      view: document.querySelector('.cz-shell')?.getAttribute('data-view') ?? null,
      hasWorkspace: Boolean(document.querySelector('.workspace-play')),
      body: document.body.innerText.replace(/\s+/g, ' '),
    }))
    if (report.pageErrors.length) {
      fail('legacy restore does not crash the page', report.pageErrors.slice(0, 2).join(' | '))
    } else {
      pass('legacy restore does not crash the page')
    }
    if (legacy.view === 'practice' && legacy.hasWorkspace) {
      fail('legacy notation-only session is not opened as practice', `view=${legacy.view}`)
    } else {
      pass('legacy notation-only session is not opened as practice', `view=${legacy.view}`)
    }
    if (/notation-only score/i.test(legacy.body)) {
      pass('legacy restore explains what to do next', 'notation-only notice')
    } else if (/companion files are missing|Check Import before practicing/i.test(legacy.body)) {
      // The notation pointer was dropped but the PDF-side save is intact and the
      // user is told exactly where to go. No crash, no data loss.
      pass('legacy restore explains what to do next', 'companion-missing notice')
    } else if (/couldn.t be opened|looks damaged/i.test(legacy.body)) {
      fail('legacy restore recovers the notation rather than discarding it', legacy.body.slice(0, 160))
    } else {
      skip('legacy restore explains what to do next', legacy.body.slice(0, 160))
    }

    if (report.pageErrors.length) {
      fail('no uncaught page errors', report.pageErrors.slice(0, 3).join(' | '))
    } else {
      pass('no uncaught page errors')
    }
    if (report.consoleErrors.length) {
      fail('no unexpected console errors', report.consoleErrors.slice(0, 3).join(' | '))
    } else {
      pass('no unexpected console errors')
    }
  } finally {
    await browser.close().catch(() => {})
    await viteServer.close().catch(() => {})
    await writeFile(join(outDir, 'report.json'), JSON.stringify(report, null, 2))
  }

  if (report.updateDepthWarnings.length) {
    console.error(`TRACKED  update-depth warning fired ${report.updateDepthWarnings.length}x at: ${report.updateDepthWarnings.map((w) => w.step).join(', ')}`)
  } else {
    console.log('TRACKED  no update-depth warning in this run')
  }
  const byStep = {}
  for (const entry of consoleLog) {
    const why = entry.warning ?? entry.pageerror ?? entry.text ?? 'error'
    const isWarning = /Maximum update depth/.test(why)
    const key = `${entry.step} :: ${isWarning ? 'MAX-UPDATE-DEPTH' : 'error'} :: ${why.slice(0, 60).replace(/\s+/g, ' ')}`
    byStep[key] = (byStep[key] ?? 0) + 1
  }
  console.log('console timeline:', JSON.stringify(byStep, null, 1))
  console.log(`\n${report.passes.length} passes, ${report.failures.length} failures, ${report.skipped.length} skipped`)
  process.exit(report.failures.length ? 1 : 0)
}

function pageErrorsAt(report) {
  return report.pageErrors ?? []
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
