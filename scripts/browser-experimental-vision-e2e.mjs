#!/usr/bin/env node
/**
 * Experimental Piano/Guitar Vision — real browser acceptance.
 *
 * Uploads real PDFs through Corranzo's import workflow, opts in with the
 * explicit localStorage flag, checks the experimental draft gate, opens the
 * engraved score, saves/reloads, and verifies honest fallback for an
 * unsupported/scanned input.
 *
 * Usage:
 *   BROWSER=chromium node scripts/browser-experimental-vision-e2e.mjs
 *   BROWSER=webkit   node scripts/browser-experimental-vision-e2e.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'tmp', 'oct25-release')
const PORT = Number(process.env.E2E_PORT ?? 5692)
const BROWSER = (process.env.BROWSER ?? 'chromium').toLowerCase()
const EXTERNAL = process.env.E2E_BASE_URL ?? null
const BASE = EXTERNAL ?? `http://127.0.0.1:${PORT}/`
const FLAG = 'corranzo-experimental-vision-engine-v1'
const report = { browser: BROWSER, passes: [], failures: [], consoleErrors: [], pageErrors: [] }
const pass = (name, detail = '') => { report.passes.push({ name, detail }); console.log(`PASS  ${name}${detail ? ` :: ${detail}` : ''}`) }
const fail = (name, detail = '') => { report.failures.push({ name, detail }); console.error(`FAIL  ${name}${detail ? ` :: ${detail}` : ''}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const pianoPdf = join(ROOT, 'benchmarks/omr-fixtures/piano-beginner-single-vector/piano-beginner-single-vector.pdf')
const guitarPdf = join(ROOT, 'benchmarks/omr-fixtures/guitar-paired-chords-vector/guitar-paired-chords-vector.pdf')
const scannedGuitarPdf = join(ROOT, 'benchmarks/omr-fixtures/guitar-paired-scan/guitar-paired-scan.pdf')
const mixedGuitarPdf = join(ROOT, 'benchmarks/omr-fixtures/guitar-mixed-rhythm-vector/guitar-mixed-rhythm-vector.pdf')
const realPianoPdf = join(ROOT, 'public/fixtures/demo-minuet-in-g.pdf')

await mkdir(OUT, { recursive: true })
const vite = EXTERNAL ? null : await createServer({
  root: ROOT,
  configFile: join(ROOT, 'vite.config.js'),
  logLevel: 'silent',
  server: { host: '127.0.0.1', port: PORT, strictPort: true },
})
if (vite) { await vite.listen(); await sleep(600) }

const { chromium, webkit } = await import('playwright')
let browser = null
try {
  browser = await ({ chromium, webkit }[BROWSER] ?? chromium).launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage()
  page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(m.text().slice(0, 240)) })
  page.on('pageerror', (e) => report.pageErrors.push(String(e?.message ?? e).slice(0, 240)))

  const shot = async (name) => { try { await page.screenshot({ path: join(OUT, `experimental-vision-${BROWSER}-${name}.png`) }) } catch {} }
  const setMode = async (mode) => page.evaluate(({ flag, mode }) => {
    if (mode) localStorage.setItem(flag, mode); else localStorage.removeItem(flag)
  }, { flag: FLAG, mode })

  const openImport = async ({ mode, instrument }) => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await sleep(2200)
    await setMode(mode)
    if (instrument === 'guitar') {
      await page.evaluate(() => {
        const option = [...document.querySelectorAll('.instrument-selector__option')].find((el) => /acoustic guitar/i.test(el.textContent ?? ''))
        option?.click()
      })
      await sleep(600)
    }
    await page.evaluate(() => {
      const button = [...document.querySelectorAll('nav button')].find((el) => /import/i.test(el.textContent ?? ''))
      button?.click()
    })
    await sleep(800)
  }

  const upload = async (pdfPath, label) => {
    await page.locator('input[type="file"][aria-label="Choose score PDF"]').first().setInputFiles(pdfPath)
    await page.getByText(/pages? · PDF|PDF selected/i).first().waitFor({ timeout: 60_000 })
    pass(`${label}: PDF uploaded through the real import workflow`)
  }

  const readSaved = async ({ tries = 30 } = {}) => {
    let last = null
    for (let i = 0; i < tries; i += 1) {
      last = await page.evaluate(async () => {
        const raw = localStorage.getItem('scoreflow-session-meta-v1')
        const meta = raw ? JSON.parse(raw) : null
        if (!meta?.commitId) return { meta, xml: null }
        try {
          const dbs = await indexedDB.databases?.()
          if (Array.isArray(dbs) && !dbs.some((d) => d.name === 'scoreflow-session')) return { meta, xml: null }
        } catch {}
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open('scoreflow-session')
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        if (!db.objectStoreNames.contains('files')) { db.close(); return { meta, xml: null } }
        const read = (key) => new Promise((resolve) => {
          const tx = db.transaction('files', 'readonly')
          const req = tx.objectStore('files').get(key)
          req.onsuccess = () => resolve(req.result ?? null)
          req.onerror = () => resolve(null)
        })
        let buffer = await read(`gen:${meta.commitId}:musicXml`)
        if (!buffer) buffer = await read('musicXml')
        db.close()
        return { meta, xml: buffer ? new TextDecoder().decode(buffer) : null }
      })
      if (last?.xml && last?.meta?.omrMeta?.experimentalVision) return last
      await sleep(500)
    }
    return last
  }

  const scoreStats = async (xml) => page.evaluate((text) => {
    const doc = new DOMParser().parseFromString(text, 'application/xml')
    return {
      pitches: doc.querySelectorAll('pitch').length,
      technical: doc.querySelectorAll('technical string').length,
      tabStaff: [...doc.querySelectorAll('clef sign')].some((el) => (el.textContent ?? '').trim() === 'TAB'),
      hasWorkTitle: Boolean(doc.querySelector('work-title')),
    }
  }, xml)

  const waitReady = async (label, { expectExperimental }) => {
    await page.waitForFunction(() => {
      const button = [...document.querySelectorAll('button')].find((el) => /^open score$/i.test(el.textContent?.trim() ?? ''))
      return Boolean(button && !button.disabled)
    }, null, { timeout: 120_000 })
    const experimental = await page.evaluate(() => /Experimental recognition draft/.test(document.body.innerText ?? ''))
    if (experimental === expectExperimental) pass(`${label}: ${expectExperimental ? 'experimental draft gate visible' : 'standard fallback used, no experimental gate'}`)
    else fail(`${label}: experimental gate mismatch`, `expected=${expectExperimental} got=${experimental}`)
  }

  const openScoreAndInspect = async ({ label, expectTab = false }) => {
    await page.getByRole('button', { name: /^open score$/i }).first().click()
    await page.locator('.workspace-dock').first().waitFor({ state: 'visible', timeout: 60_000 })
    await page.locator('.osmd-score__container[data-osmd-ready="true"]').first().waitFor({ timeout: 60_000 })
    await sleep(1200)
    const state = await page.evaluate(() => ({
      pdfCanvas: Boolean(document.querySelector('.workspace-frame canvas')),
      notationNotes: document.querySelectorAll('.vf-stavenote').length,
      tabNotes: document.querySelectorAll('.vf-tabnote').length,
      modes: [...document.querySelectorAll('.workspace-modes [role="radio"]')].map((b) => ({ label: b.textContent.trim(), disabled: b.disabled })),
      title: document.querySelector('.workspace-header h1')?.textContent?.trim() ?? null,
    }))
    const engravedSurface = !state.pdfCanvas && (expectTab ? state.tabNotes > 0 : state.notationNotes > 0)
    if (engravedSurface) {
      pass(`${label}: engraved MusicXML is the score surface`, expectTab ? `${state.tabNotes} TAB notes` : `${state.notationNotes} notation notes`)
    } else {
      fail(`${label}: engraved MusicXML is the score surface`, JSON.stringify(state))
    }
    if (expectTab && state.tabNotes > 0) pass(`${label}: six-line TAB engraving present`, `${state.tabNotes} TAB notes`)
    else if (expectTab) fail(`${label}: six-line TAB engraving present`, JSON.stringify(state))
    const byLabel = Object.fromEntries(state.modes.map((m) => [m.label, m.disabled]))
    if (byLabel.Preview === false && byLabel['Play Along'] === true && byLabel['Wait For You'] === true) {
      pass(`${label}: Preview available; Play Along and Wait For You gated off`)
    } else {
      fail(`${label}: practice mode gate`, JSON.stringify(state.modes))
    }
    return state
  }

  const reopenSaved = async ({ label }) => {
    await sleep(2200)
    const saved = await readSaved()
    if (!saved?.xml) { fail(`${label}: score persisted`, 'no saved MusicXML'); return }
    const stats = await scoreStats(saved.xml)
    pass(`${label}: score persisted with metadata`, `${stats.pitches} pitches`)
    const meta = saved.meta?.omrMeta?.experimentalVision ?? null
    if (meta && meta.practiceReady === false) pass(`${label}: experimental practice gate persisted`, meta.engine)
    else fail(`${label}: experimental practice gate persisted`, JSON.stringify(meta))
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 })
    await sleep(3000)
    await page.locator('.workspace-dock').first().waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {})
    const reopened = await page.evaluate(() => ({
      dock: Boolean(document.querySelector('.workspace-dock')),
      osmd: Boolean(document.querySelector('.osmd-score__container[data-osmd-ready="true"]')),
      modes: [...document.querySelectorAll('.workspace-modes [role="radio"]')].map((b) => ({ label: b.textContent.trim(), disabled: b.disabled })),
      gate: /Experimental recognition draft/.test(document.body.innerText ?? ''),
    }))
    const byLabel = Object.fromEntries(reopened.modes.map((m) => [m.label, m.disabled]))
    if ((reopened.dock || reopened.osmd) && byLabel['Play Along'] === true) {
      pass(`${label}: saved score reopened with the practice gate intact`)
    } else {
      fail(`${label}: saved score reopened with the practice gate intact`, JSON.stringify(reopened))
    }
  }

  // ---------------------------------------------------------------- piano
  await openImport({ mode: 'piano-vector', instrument: 'piano' })
  await upload(pianoPdf, 'piano')
  await waitReady('piano', { expectExperimental: true })
  await shot('piano-import')
  const pianoSaved = await readSaved()
  if (pianoSaved?.xml) {
    const stats = await scoreStats(pianoSaved.xml)
    if (stats.pitches > 0 && stats.hasWorkTitle) pass('piano: MusicXML has notes and a work title', `${stats.pitches} pitches`)
    else fail('piano: MusicXML has notes and a work title', JSON.stringify(stats))
  }
  await openScoreAndInspect({ label: 'piano' })
  await shot('piano-score')
  await reopenSaved({ label: 'piano' })

  // ---------------------------------------------------------------- guitar
  await openImport({ mode: 'guitar-vector', instrument: 'guitar' })
  await upload(guitarPdf, 'guitar')
  await waitReady('guitar', { expectExperimental: true })
  await shot('guitar-import')
  const guitarSaved = await readSaved()
  if (guitarSaved?.xml) {
    const stats = await scoreStats(guitarSaved.xml)
    if (stats.pitches === 232 && stats.technical === 232 && stats.tabStaff) {
      pass('guitar: 116 events mirrored on standard notation + TAB', JSON.stringify(stats))
    } else {
      fail('guitar: 116 string/fret events and TAB staff in MusicXML', JSON.stringify(stats))
    }
  } else fail('guitar: score persisted', 'no saved MusicXML')
  await openScoreAndInspect({ label: 'guitar', expectTab: true })
  await shot('guitar-score')

  // ------------------------------------------------------ scanned fallback
  await openImport({ mode: 'guitar-vector', instrument: 'guitar' })
  await upload(scannedGuitarPdf, 'scanned guitar')
  await waitReady('scanned guitar', { expectExperimental: false })
  const fallbackSaved = await readSaved()
  const fallbackMeta = fallbackSaved?.meta?.omrMeta?.experimentalVision ?? null
  if (!fallbackMeta) pass('scanned guitar: honest standard fallback, no experimental metadata')
  else fail('scanned guitar: honest standard fallback', JSON.stringify(fallbackMeta))
  await shot('scanned-fallback')

  // ------------------------------------- uncertain guitar mixed rhythm
  await openImport({ mode: 'guitar-vector', instrument: 'guitar' })
  await upload(mixedGuitarPdf, 'mixed guitar rhythm')
  await waitReady('mixed guitar rhythm', { expectExperimental: false })
  const mixedSaved = await readSaved()
  if (!(mixedSaved?.meta?.omrMeta?.experimentalVision)) {
    pass('mixed guitar rhythm: unknown timing stays experimental-disabled')
  } else {
    fail('mixed guitar rhythm: unknown timing stays experimental-disabled', JSON.stringify(mixedSaved?.meta?.omrMeta?.experimentalVision))
  }

  // ------------------------------------------------ unsupported piano PDF
  await openImport({ mode: 'piano-vector', instrument: 'piano' })
  await upload(realPianoPdf, 'real piano PDF')
  await waitReady('real piano PDF', { expectExperimental: false })
  const realPianoSaved = await readSaved()
  if (!(realPianoSaved?.meta?.omrMeta?.experimentalVision)) {
    pass('real piano PDF: honest standard fallback, no experimental metadata')
  } else {
    fail('real piano PDF: honest standard fallback', JSON.stringify(realPianoSaved?.meta?.omrMeta?.experimentalVision))
  }

  // --------------------------------------------------------- flag off default
  await openImport({ mode: null, instrument: 'piano' })
  await upload(pianoPdf, 'flag off')
  await waitReady('flag off', { expectExperimental: false })

  const meaningfulConsole = report.consoleErrors.filter((text) => !/Outdated Optimize Dep|504/.test(text))
  if (meaningfulConsole.length === 0) pass('no application console errors')
  else fail('no application console errors', meaningfulConsole.slice(0, 3).join(' | '))
  if (report.pageErrors.length === 0) pass('no page errors')
  else fail('no page errors', report.pageErrors.slice(0, 3).join(' | '))
} catch (error) {
  fail('harness', String(error?.stack ?? error?.message ?? error).slice(0, 700))
  try { await page.screenshot({ path: join(OUT, `experimental-vision-${BROWSER}-error.png`) }) } catch {}
} finally {
  try { await browser?.close() } catch {}
  try { await vite?.close() } catch {}
}

report.finishedAt = new Date().toISOString()
await writeFile(join(OUT, `experimental-vision-${BROWSER}-report.json`), JSON.stringify(report, null, 2))
console.log(`\n${BROWSER}: pass=${report.passes.length} fail=${report.failures.length} consoleErrors=${report.consoleErrors.length} pageErrors=${report.pageErrors.length}`)
process.exit(report.failures.length ? 1 : 0)
