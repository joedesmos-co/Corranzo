/**
 * Clean-session E2E: Guitar + Library practice regressions.
 *
 * Covers:
 * A. Piano PDF → switch Guitar → same score identity
 * B. Upload PDF B while Guitar active → no A-derived events remain
 * C. Rapid A→B replacement while Guitar mode active
 * D. Piano↔Guitar switch without losing score
 * E/F. Bundled Library pieces from clean session (Piano + Guitar)
 * G. User PDF after Library / Library after user PDF
 *
 * Usage: node scripts/guitar-library-regression.mjs
 * Requires: npm run dev on http://localhost:5173
 */
import { chromium } from 'playwright'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASE = process.env.SCOREFLOW_BASE_URL ?? 'http://127.0.0.1:5173'
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
      if (!disabled) {
        await btn.click({ force: true }).catch(() => {})
        await page.waitForTimeout(200)
      }
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

async function readState(page) {
  return page.evaluate(() => ({
    auth: window.__SCOREFLOW_AUTHORITATIVE_SOURCE__ ?? null,
    snap: window.__SCOREFLOW_PLAYBACK_SNAPSHOT__ ?? null,
    gate: window.__SCOREFLOW_GENERATION_GATE__ ?? null,
    owners: window.__SCOREFLOW_SOURCE_OWNERS__ ?? null,
    guitarTrace: window.__SCOREFLOW_GUITAR_PLAYBACK_TRACE__ ?? null,
    instrumentReady: document.body.innerText.match(/Guitar ready|Piano ready/)?.[0] ?? null,
  }))
}

function eventCount(state) {
  return state.snap?.playableEventCount ?? state.snap?.events?.count ?? 0
}

async function waitForPlayback(page, label, { timeoutMs = 120_000, previousHash = null } = {}) {
  const end = Date.now() + timeoutMs
  let last = ''
  while (Date.now() < end) {
    await dismissOverlays(page)
    const state = await readState(page)
    const status = `${label} dur=${state.snap?.duration ?? '-'} events=${eventCount(state)} hash=${state.snap?.timingContentHash ?? '-'} auth=${state.auth?.musicXmlHash ?? '-'}`
    if (status !== last) {
      console.log(status)
      last = status
    }
    if (
      state.snap?.duration > 0 &&
      eventCount(state) > 0 &&
      state.snap?.timingContentHash &&
      (!previousHash || state.snap.timingContentHash !== previousHash)
    ) {
      return state
    }
    if (await page.getByRole('button', { name: /Try again/i }).count()) {
      throw new Error(`${label}: OMR failed`)
    }
    await page.waitForTimeout(800)
  }
  throw new Error(`${label}: timed out waiting for playable timeline`)
}

async function goLibraryWorkspace(page) {
  await dismissOverlays(page)
  // Playwright force-click can miss TopBar handlers while Practice is open;
  // native click reliably switches activeView back to Library.
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('nav[aria-label="Main"] button')].find(
      (el) => el.textContent?.trim() === 'Library',
    )
    if (!btn) throw new Error('Library nav button not found')
    btn.click()
  })
  await page.waitForTimeout(400)
  await dismissOverlays(page)
  await page.locator('.library-main, .library-panel').first().waitFor({ state: 'visible', timeout: 8000 })
}

async function uploadPdf(page, pdfPath) {
  await goLibraryWorkspace(page)
  const uploadsTab = page.getByRole('tab', { name: /My Uploads/i })
  await uploadsTab.waitFor({ state: 'visible', timeout: 8000 })
  await uploadsTab.click({ force: true })
  await page.waitForTimeout(300)
  const input = page
    .getByRole('region', { name: 'Upload score files' })
    .locator('input[type="file"]')
  await input.waitFor({ state: 'attached', timeout: 8000 })
  await input.setInputFiles(pdfPath)
  await page.waitForTimeout(1000)
}

async function openFirstLibraryPiece(page, instrument) {
  await page.getByRole('radio', { name: instrument, exact: true }).click({ force: true })
  await page.waitForTimeout(400)
  await goLibraryWorkspace(page)
  await page.getByRole('tab', { name: /Practice Library/i }).click({ force: true })
  await page.waitForTimeout(400)
  const start = page.getByRole('button', { name: /Start practice:/i }).first()
  await start.waitFor({ state: 'visible', timeout: 8000 })
  await start.click({ force: true })
  await page.waitForTimeout(2000)
}

async function pressPlay(page) {
  const play = page.getByRole('button', { name: /^Play$/i }).first()
  if (await play.isVisible().catch(() => false)) {
    await play.click({ force: true }).catch(() => {})
    await page.waitForTimeout(1200)
  }
}

function assertOwnersAligned(state, failures, label) {
  const active = state.gate?.activePdfIdentity ?? state.auth?.ownerPdfIdentity
  if (!active) {
    failures.push(`${label}: missing active score identity`)
    return
  }
  if (state.auth?.ownerPdfIdentity && state.auth.ownerPdfIdentity !== active) {
    failures.push(`${label}: authoritative MusicXML owner mismatch`)
  }
  if (
    state.owners?.guitarMappingOwner &&
    state.owners.guitarMappingOwner !== state.owners.activeScoreIdentity
  ) {
    failures.push(`${label}: guitarMappingOwner drifted from active score`)
  }
}

async function main() {
  for (const pdf of [PDF_A, PDF_B]) {
    if (!fs.existsSync(pdf)) throw new Error(`Missing fixture ${pdf}`)
  }

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const failures = []
  const report = { scenarios: {} }

  // E: Piano library clean session
  console.log('\n=== E: Piano Library clean session ===')
  await clearSession(page)
  await openFirstLibraryPiece(page, 'Piano')
  const pianoLib = await waitForPlayback(page, 'piano-lib')
  await pressPlay(page)
  if (!pianoLib.auth?.musicXmlHash) failures.push('E: piano library missing authoritative source')
  if (!(pianoLib.snap?.duration > 0)) failures.push('E: piano library duration not > 0')
  if (!(eventCount(pianoLib) > 0)) failures.push('E: piano library has zero playable events')
  if (pianoLib.auth?.sourceType !== 'library') failures.push('E: piano library sourceType not library')
  assertOwnersAligned(pianoLib, failures, 'E-piano')
  report.scenarios.pianoLibrary = {
    auth: pianoLib.auth,
    duration: pianoLib.snap?.duration,
    events: eventCount(pianoLib),
  }

  // E: Guitar library clean session
  console.log('\n=== E: Guitar Library clean session ===')
  await clearSession(page)
  await openFirstLibraryPiece(page, 'Guitar')
  const guitarLib = await waitForPlayback(page, 'guitar-lib')
  await pressPlay(page)
  const visual = page.getByRole('button', { name: /^Visual$/i }).first()
  if (await visual.isVisible().catch(() => false)) {
    await visual.click({ force: true }).catch(() => {})
    await page.waitForTimeout(800)
  }
  const guitarLibOwners = await readState(page)
  if (!guitarLib.auth?.musicXmlHash) failures.push('E: guitar library missing authoritative source')
  if (!(guitarLib.snap?.duration > 0)) failures.push('E: guitar library duration not > 0')
  if (!(eventCount(guitarLib) > 0)) failures.push('E: guitar library has zero playable events')
  if (guitarLib.snap?.instrumentId && guitarLib.snap.instrumentId !== 'guitar') {
    failures.push('E: guitar library playback instrumentId mismatch')
  }
  if (guitarLib.auth?.sourceType !== 'library') failures.push('E: guitar library sourceType not library')
  assertOwnersAligned(guitarLibOwners, failures, 'E-guitar')
  report.scenarios.guitarLibrary = {
    auth: guitarLib.auth,
    duration: guitarLib.snap?.duration,
    events: eventCount(guitarLib),
    guitarTrace: guitarLib.guitarTrace,
    owners: guitarLibOwners.owners,
  }

  // F: Reload guitar library
  console.log('\n=== F: Reload guitar library ===')
  const beforeReload = guitarLib.auth?.musicXmlHash
  await page.reload({ waitUntil: 'networkidle' })
  await dismissOverlays(page)
  for (const name of [/Restore session/i, /Restore/i, /Continue/i]) {
    const btn = page.getByRole('button', { name }).first()
    if (await btn.isVisible().catch(() => false)) {
      await btn.click({ force: true }).catch(() => {})
    }
  }
  const reloadEnd = Date.now() + 60_000
  let afterReload = null
  while (Date.now() < reloadEnd) {
    await dismissOverlays(page)
    afterReload = await readState(page)
    if (afterReload.auth?.musicXmlHash || afterReload.snap?.duration > 0) break
    const practiceNav = page.getByRole('button', { name: 'Practice', exact: true })
    if (await practiceNav.isVisible().catch(() => false)) {
      await practiceNav.click({ force: true }).catch(() => {})
    }
    await page.waitForTimeout(800)
  }
  if (beforeReload && afterReload?.auth?.musicXmlHash && afterReload.auth.musicXmlHash !== beforeReload) {
    failures.push('F: reload changed library MusicXML hash')
  }
  if (!(eventCount(afterReload) > 0) && !(afterReload?.snap?.duration > 0)) {
    failures.push('F: reload left no playable timeline')
  }
  report.scenarios.reloadGuitarLibrary = { beforeReload, after: afterReload?.auth ?? null }

  // A + D: Piano OMR → Guitar switch keeps identity
  console.log('\n=== A/D: Piano OMR → Guitar switch ===')
  await clearSession(page)
  await page.getByRole('radio', { name: 'Piano', exact: true }).click({ force: true })
  await uploadPdf(page, PDF_A)
  const pianoOmr = await waitForPlayback(page, 'piano-omr')
  const pianoHash = pianoOmr.snap?.timingContentHash
  const pianoOwner = pianoOmr.auth?.ownerPdfIdentity ?? pianoOmr.gate?.activePdfIdentity
  await page.getByRole('radio', { name: 'Guitar', exact: true }).click({ force: true })
  await page.waitForTimeout(2000)
  const afterGuitarSwitch = await readState(page)
  if (afterGuitarSwitch.snap?.timingContentHash !== pianoHash) {
    failures.push(
      `A: Guitar switch lost score identity (${afterGuitarSwitch.snap?.timingContentHash} vs ${pianoHash})`,
    )
  }
  if (!(eventCount(afterGuitarSwitch) > 0)) {
    failures.push('A: Guitar switch left zero playable events')
  }
  await pressPlay(page)
  await page.getByRole('radio', { name: 'Piano', exact: true }).click({ force: true })
  await page.waitForTimeout(1500)
  const backToPiano = await readState(page)
  if (backToPiano.snap?.timingContentHash !== pianoHash) {
    failures.push('D: Piano↔Guitar round-trip lost score identity')
  }
  report.scenarios.instrumentSwitchCarry = {
    pianoHash,
    pianoOwner,
    afterGuitar: afterGuitarSwitch.snap?.timingContentHash,
    backToPiano: backToPiano.snap?.timingContentHash,
    guitarEvents: eventCount(afterGuitarSwitch),
  }

  // B: Upload PDF B while Guitar active — no A-derived events
  console.log('\n=== B: Guitar active → upload PDF B ===')
  await page.getByRole('radio', { name: 'Guitar', exact: true }).click({ force: true })
  await page.waitForTimeout(800)
  const beforeB = await readState(page)
  await uploadPdf(page, PDF_B)
  const afterB = await waitForPlayback(page, 'guitar-pdf-b', {
    previousHash: beforeB.snap?.timingContentHash,
  })
  if (afterB.snap?.timingContentHash === beforeB.snap?.timingContentHash) {
    failures.push('B: PDF B did not replace A MusicXML while Guitar active')
  }
  if (afterB.auth?.ownerPdfIdentity === beforeB.auth?.ownerPdfIdentity) {
    failures.push('B: PDF B kept A owner identity')
  }
  if (!(eventCount(afterB) > 0)) failures.push('B: PDF B left zero playable events on Guitar')
  report.scenarios.guitarReplaceWhileActive = {
    before: beforeB.snap?.timingContentHash,
    after: afterB.snap?.timingContentHash,
    beforeOwner: beforeB.auth?.ownerPdfIdentity,
    afterOwner: afterB.auth?.ownerPdfIdentity,
  }

  // C: Rapid A→B while Guitar active
  console.log('\n=== C: Rapid A→B while Guitar active ===')
  await clearSession(page)
  await page.getByRole('radio', { name: 'Guitar', exact: true }).click({ force: true })
  await uploadPdf(page, PDF_A)
  await page.waitForTimeout(1500)
  await uploadPdf(page, PDF_B)
  const rapidB = await waitForPlayback(page, 'rapid-b', { timeoutMs: 180_000 })
  if (!(eventCount(rapidB) > 0)) failures.push('C: rapid A→B left zero playable events')
  if (!rapidB.auth?.musicXmlHash) failures.push('C: rapid A→B missing authoritative MusicXML')
  if (
    rapidB.gate?.activePdfIdentity &&
    rapidB.auth?.ownerPdfIdentity &&
    rapidB.gate.activePdfIdentity !== rapidB.auth.ownerPdfIdentity
  ) {
    failures.push('C: gate identity != authoritative owner after rapid replace')
  }
  report.scenarios.rapidReplaceGuitar = {
    hash: rapidB.snap?.timingContentHash,
    owner: rapidB.auth?.ownerPdfIdentity,
    gate: rapidB.gate?.activePdfIdentity,
    events: eventCount(rapidB),
  }

  // G: Library → user PDF → Library
  console.log('\n=== G: Library → user PDF → Library ===')
  await clearSession(page)
  await openFirstLibraryPiece(page, 'Piano')
  const libBefore = await waitForPlayback(page, 'lib-before-user')
  await uploadPdf(page, PDF_B)
  const userPdf = await waitForPlayback(page, 'user-after-lib', {
    previousHash: libBefore.snap?.timingContentHash,
  })
  if (userPdf.snap?.timingContentHash === libBefore.snap?.timingContentHash) {
    failures.push('G: user PDF did not replace library MusicXML')
  }
  await openFirstLibraryPiece(page, 'Piano')
  const libAfterUser = await waitForPlayback(page, 'lib-after-user', {
    previousHash: userPdf.snap?.timingContentHash,
  })
  if (libAfterUser.auth?.sourceType !== 'library') {
    failures.push('G: reopening library piece did not stamp library source')
  }
  if (libAfterUser.snap?.timingContentHash === userPdf.snap?.timingContentHash) {
    failures.push('G: library reopen kept user PDF MusicXML')
  }
  report.scenarios.libraryThenUser = {
    library: libBefore.snap?.timingContentHash,
    user: userPdf.snap?.timingContentHash,
    libraryAgain: libAfterUser.snap?.timingContentHash,
  }

  report.failures = failures
  const outDir = path.join(root, 'tmp/guitar-library-regression')
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2))

  await browser.close()
  console.log('\n=== ASSERTIONS ===')
  if (failures.length) {
    console.error('FAIL', failures)
    process.exit(1)
  }
  console.log('PASS: Guitar library + instrument-switch + ownership regressions')
  console.log(`Report: ${path.join(outDir, 'report.json')}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
