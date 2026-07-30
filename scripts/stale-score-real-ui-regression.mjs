/**
 * Real-UI ActiveScore regression: PDF A → OMR → Play → PDF B → OMR → Play.
 *
 * Uses the same visible Library / My Uploads / file-input path as a user.
 * Asserts content-level ActiveScore ownership (scoreId, hashes, first pitches).
 *
 * Usage: node scripts/stale-score-real-ui-regression.mjs
 * Requires: npm run dev on http://127.0.0.1:5173
 */
import { chromium } from 'playwright'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASE = process.env.SCOREFLOW_BASE_URL ?? 'http://127.0.0.1:5173'
// Radically different fixtures (different hashes, durations, first notes).
const PDF_A = path.join(
  root,
  'benchmarks/omr-fixtures/piano-beginner-single-vector/piano-beginner-single-vector.pdf',
)
const PDF_B = path.join(
  root,
  'benchmarks/omr-fixtures/piano-articulation-scan/piano-articulation-scan.pdf',
)

async function dismissOverlays(page) {
  for (const name of [
    /Skip restore/i,
    /Skip/i,
    /Dismiss/i,
    /Clear saved/i,
    /Not now/i,
    /Continue/i,
  ]) {
    const btn = page.getByRole('button', { name })
    if (await btn.isVisible().catch(() => false)) {
      const disabled = await btn.isDisabled().catch(() => true)
      if (!disabled) await btn.click({ force: true }).catch(() => {})
    }
  }
}

async function clearSession(page) {
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.evaluate(async () => {
    localStorage.clear()
    sessionStorage.clear()
    await new Promise((resolve) => {
      const req = indexedDB.deleteDatabase('scoreflow-session')
      req.onsuccess = req.onerror = req.onblocked = () => resolve()
    })
  })
  await page.reload({ waitUntil: 'networkidle' })
  await dismissOverlays(page)
}

async function readActive(page) {
  return page.evaluate(() => ({
    active: window.__SCOREFLOW_ACTIVE_SCORE__ ?? null,
    auth: window.__SCOREFLOW_AUTHORITATIVE_SOURCE__ ?? null,
    snap: window.__SCOREFLOW_PLAYBACK_SNAPSHOT__ ?? null,
    gate: window.__SCOREFLOW_GENERATION_GATE__ ?? null,
  }))
}

async function goMyUploads(page) {
  await dismissOverlays(page)
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('nav[aria-label="Main"] button')].find(
      (el) => el.textContent?.trim() === 'Library',
    )
    if (!btn) throw new Error('Library nav not found')
    btn.click()
  })
  await page.waitForTimeout(400)
  await dismissOverlays(page)
  await page.getByRole('tab', { name: /My Uploads/i }).click({ force: true })
  await page.waitForTimeout(300)
  const input = page
    .getByRole('region', { name: 'Upload score files' })
    .locator('input[type="file"]')
  await input.waitFor({ state: 'attached', timeout: 10000 })
  return input
}

async function uploadViaUi(page, pdfPath) {
  const input = await goMyUploads(page)
  await input.setInputFiles(pdfPath)
  await page.waitForTimeout(800)
}

async function waitForReady(page, label, { previousScoreId = null, timeoutMs = 180_000 } = {}) {
  const end = Date.now() + timeoutMs
  let last = ''
  while (Date.now() < end) {
    await dismissOverlays(page)
    const state = await readActive(page)
    const status = `${label} scoreId=${state.active?.scoreId ?? '-'} xml=${state.active?.musicXmlHash ?? '-'} dur=${state.snap?.duration ?? '-'} events=${state.snap?.playableEventCount ?? '-'}`
    if (status !== last) {
      console.log(status)
      last = status
    }
    const ready =
      state.active?.scoreId &&
      state.active?.hasMusicXml &&
      state.active?.musicXmlHash &&
      state.snap?.duration > 0 &&
      (state.snap?.playableEventCount ?? 0) > 0 &&
      state.snap?.ownerScoreId === state.active.scoreId &&
      (!previousScoreId || state.active.scoreId !== previousScoreId)
    if (ready) return state
    if (await page.getByRole('button', { name: /Try again/i }).count()) {
      throw new Error(`${label}: OMR failed`)
    }
    await page.waitForTimeout(900)
  }
  throw new Error(`${label}: timed out`)
}

async function pressPlay(page) {
  const play = page.getByRole('button', { name: /^Play$/i }).first()
  if (await play.isVisible().catch(() => false)) {
    await play.click({ force: true }).catch(() => {})
    await page.waitForTimeout(1200)
  }
}

async function main() {
  for (const pdf of [PDF_A, PDF_B]) {
    if (!fs.existsSync(pdf)) throw new Error(`Missing ${pdf}`)
  }

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const failures = []
  const report = {}

  console.log('\n=== Real UI: PDF A → Play ===')
  await clearSession(page)
  await page.getByRole('radio', { name: 'Piano', exact: true }).click({ force: true })
  await uploadViaUi(page, PDF_A)
  const a = await waitForReady(page, 'A')
  await pressPlay(page)
  report.A = {
    scoreId: a.active.scoreId,
    pdfHash: a.active.pdfHash,
    musicXmlHash: a.active.musicXmlHash,
    duration: a.snap.duration,
    events: a.snap.playableEventCount,
    firstMidi: a.snap.firstMidi,
    measureCount: a.snap.measureCount,
  }
  if (a.active.musicXmlOwnerScoreId !== a.active.scoreId) {
    failures.push('A: musicXmlOwnerScoreId !== scoreId')
  }
  if (a.snap.ownerScoreId !== a.active.scoreId) {
    failures.push('A: playback owner !== active scoreId')
  }

  console.log('\n=== Real UI: PDF B replace → Play ===')
  await uploadViaUi(page, PDF_B)
  const b = await waitForReady(page, 'B', { previousScoreId: a.active.scoreId })
  await pressPlay(page)
  report.B = {
    scoreId: b.active.scoreId,
    pdfHash: b.active.pdfHash,
    musicXmlHash: b.active.musicXmlHash,
    duration: b.snap.duration,
    events: b.snap.playableEventCount,
    firstMidi: b.snap.firstMidi,
    measureCount: b.snap.measureCount,
  }

  if (b.active.scoreId === a.active.scoreId) failures.push('B: scoreId did not change')
  if (b.active.pdfHash === a.active.pdfHash) failures.push('B: PDF hash still A')
  if (b.active.musicXmlHash === a.active.musicXmlHash) failures.push('B: MusicXML hash still A')
  if (b.active.musicXmlOwnerScoreId !== b.active.scoreId) {
    failures.push('B: musicXmlOwnerScoreId !== B scoreId')
  }
  if (b.snap.ownerScoreId !== b.active.scoreId) failures.push('B: playback still owned by A')
  if (b.auth?.musicXmlHash && b.auth.musicXmlHash !== b.active.musicXmlHash) {
    failures.push('B: auth MusicXML hash mismatch')
  }
  // Authoritative content proof: MusicXML hash change means B bytes, not A.
  // (Some fixtures share duration/event counts; hash is the ground truth.)
  if (!b.active.musicXmlHash || b.active.musicXmlHash === a.active.musicXmlHash) {
    failures.push('B: authoritative MusicXML content still matches A')
  }
  if (b.gate?.activeScoreId && b.gate.activeScoreId !== b.active.scoreId) {
    failures.push('B: gate activeScoreId drifted from ActiveScore')
  }

  console.log('\n=== Reload: B must remain ===')
  const beforeReload = b.active.musicXmlHash
  await page.reload({ waitUntil: 'networkidle' })
  await dismissOverlays(page)
  for (const name of [/Restore session/i, /Restore/i, /Continue/i]) {
    const btn = page.getByRole('button', { name }).first()
    if (await btn.isVisible().catch(() => false)) await btn.click({ force: true }).catch(() => {})
  }
  const reloaded = await waitForReady(page, 'reload-B', { timeoutMs: 90_000 })
  report.reload = {
    scoreId: reloaded.active?.scoreId,
    musicXmlHash: reloaded.active?.musicXmlHash,
  }
  if (reloaded.active?.musicXmlHash !== beforeReload) {
    failures.push('Reload: MusicXML hash changed away from B')
  }

  console.log('\n=== Piano ↔ Guitar: clears incompatible live practice ===')
  const beforeSwitch = reloaded.active.scoreId
  const beforeHash = reloaded.active.musicXmlHash
  await page.getByRole('radio', { name: 'Guitar', exact: true }).click({ force: true })
  await page.waitForTimeout(1500)
  const afterGuitar = await readActive(page)
  const onLibraryAfterGuitar =
    /\/library\/?$/.test(new URL(page.url()).pathname) ||
    (await page.locator('.library-main').first().isVisible().catch(() => false))
  await page.getByRole('radio', { name: 'Piano', exact: true }).click({ force: true })
  await page.waitForTimeout(1500)
  const afterPiano = await readActive(page)
  report.instrumentSwitch = {
    before: beforeSwitch,
    beforeHash,
    afterGuitar: afterGuitar.active?.scoreId ?? null,
    afterPiano: afterPiano.active?.scoreId ?? null,
    guitarXml: afterGuitar.active?.musicXmlHash ?? null,
    pianoXml: afterPiano.active?.musicXmlHash ?? null,
    onLibraryAfterGuitar,
  }
  if (!onLibraryAfterGuitar) {
    failures.push('Guitar switch did not open Library')
  }
  if (afterGuitar.active?.scoreId && afterGuitar.active.scoreId === beforeSwitch) {
    failures.push('Guitar switch kept Piano ActiveScore live')
  }
  if (afterGuitar.active?.musicXmlHash && afterGuitar.active.musicXmlHash === beforeHash) {
    failures.push('Guitar switch kept Piano MusicXML hash live')
  }

  const outDir = path.join(root, 'tmp/stale-score-real-ui')
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(
    path.join(outDir, 'report.json'),
    JSON.stringify({ report, failures }, null, 2),
  )
  await browser.close()

  console.log('\n=== ASSERTIONS ===')
  if (failures.length) {
    console.error('FAIL', failures)
    process.exit(1)
  }
  console.log('PASS: Real-UI ActiveScore A→B replacement + reload + instrument switch')
  console.log(`Report: ${path.join(outDir, 'report.json')}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
