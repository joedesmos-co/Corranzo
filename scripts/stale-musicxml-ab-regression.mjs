/**
 * Browser regression: PDF score-source replacement must never keep a prior
 * piece's authoritative MusicXML / playback timeline.
 *
 * Scenarios:
 * 1. A finishes OMR → upload B → B replaces A
 * 2. A OMR in flight → upload B → late A discarded → B becomes authoritative
 * 3. Rapid A→B→C → C owns authoritative + playback
 * 4. Reload after C → newest score persists
 *
 * Usage: node scripts/stale-musicxml-ab-regression.mjs
 * Requires: npm run dev on http://localhost:5173
 */
import { chromium } from 'playwright'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASE = process.env.SCOREFLOW_BASE_URL ?? 'http://localhost:5173'
const PDF_A = path.join(
  root,
  'benchmarks/omr-fixtures/piano-beginner-single-vector/piano-beginner-single-vector.pdf',
)
const PDF_B = path.join(
  root,
  'benchmarks/omr-fixtures/piano-articulation-scan/piano-articulation-scan.pdf',
)
const PDF_C = path.join(
  root,
  'benchmarks/omr-fixtures/piano-rhythm-tuplets-vector/piano-rhythm-tuplets-vector.pdf',
)

async function dismissOverlays(page) {
  for (const name of [
    /Skip restore/i,
    /Skip/i,
    /Dismiss/i,
    /Clear saved/i,
    /Not now/i,
    /Use Microphone/i,
    /Use MIDI Keyboard/i,
    /Use MIDI/i,
    /Continue/i,
  ]) {
    const btn = page.getByRole('button', { name })
    if (await btn.isVisible().catch(() => false)) {
      const disabled = await btn.isDisabled().catch(() => true)
      if (!disabled) {
        await btn.click({ force: true }).catch(() => {})
        await page.waitForTimeout(250)
      }
    }
  }
}

async function readSourceState(page) {
  return page.evaluate(() => ({
    auth: window.__SCOREFLOW_AUTHORITATIVE_SOURCE__ ?? null,
    snap: window.__SCOREFLOW_PLAYBACK_SNAPSHOT__ ?? null,
    gate: window.__SCOREFLOW_GENERATION_GATE__ ?? null,
    trace: (window.__SCOREFLOW_SOURCE_TRACE__?.entries ?? []).slice(-40),
  }))
}

async function waitForPracticeReady(page, label, { previousHash = null, timeoutMs = 180_000 } = {}) {
  const end = Date.now() + timeoutMs
  let last = ''
  while (Date.now() < end) {
    await dismissOverlays(page)
    const playback = await page.getByRole('region', { name: /Playback/i }).isVisible().catch(() => false)
    const retry = await page.getByRole('button', { name: /Try again/i }).count()
    const state = await readSourceState(page)
    const auth = state.auth
    const snap = state.snap
    const status = `playback=${playback} retry=${retry} auth=${auth?.musicXmlHash ?? '-'} snap=${snap?.timingContentHash ?? '-'} gateRun=${state.gate?.activeOmrRunId ?? '-'}`
    if (status !== last) {
      console.log(`[${label}] ${status}`)
      last = status
    }
    if (
      playback &&
      auth?.musicXmlHash &&
      snap?.timingContentHash &&
      auth.musicXmlHash === snap.timingContentHash &&
      (!previousHash || auth.musicXmlHash !== previousHash)
    ) {
      return state
    }
    if (retry > 0) {
      throw new Error(`${label}: OMR failed (Try again visible)`)
    }
    await page.waitForTimeout(1000)
  }
  throw new Error(`${label}: timed out waiting for practice + hashes`)
}

async function goLibraryUploads(page) {
  await dismissOverlays(page)
  await page.getByRole('button', { name: 'Library', exact: true }).click({
    timeout: 8000,
    force: true,
  })
  await page.waitForTimeout(500)
  await dismissOverlays(page)
  const uploadsTab = page.getByRole('tab', { name: /My Uploads/i })
  await uploadsTab.waitFor({ state: 'visible', timeout: 8000 })
  await uploadsTab.click({ force: true })
  await page.waitForTimeout(300)
  const addFilesInput = page
    .getByRole('region', { name: 'Upload score files' })
    .locator('input[type="file"]')
  await addFilesInput.waitFor({ state: 'attached', timeout: 8000 })
  return addFilesInput
}

async function uploadPdf(page, pdfPath, { waitMs = 1500 } = {}) {
  const input = await goLibraryUploads(page)
  await input.setInputFiles(pdfPath)
  await page.waitForTimeout(waitMs)
}

async function waitForPreparing(page, { timeoutMs = 15_000 } = {}) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    const preparing = await page.locator('.library-omr-panel').isVisible().catch(() => false)
    const phases = await page.evaluate(() =>
      (window.__SCOREFLOW_SOURCE_TRACE__?.entries ?? []).map((e) => e.phase),
    )
    if (preparing || phases.includes('omr-run-start') || phases.includes('pdf-selected')) {
      return true
    }
    await page.waitForTimeout(200)
  }
  return false
}

async function clearBrowserState(page) {
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
  await page.getByRole('radio', { name: 'Piano', exact: true }).click().catch(() => {})
  await page.waitForTimeout(200)
}

function assertNewestOwnsPlayback(label, state, { forbiddenHashes = [] } = {}) {
  const failures = []
  const authHash = state.auth?.musicXmlHash
  const snapHash = state.snap?.timingContentHash ?? state.snap?.playbackInputIdentity
  if (!authHash) failures.push(`${label}: missing authoritative MusicXML hash`)
  if (!snapHash) failures.push(`${label}: missing playback timeline hash`)
  if (authHash && snapHash && authHash !== snapHash) {
    failures.push(`${label}: playback ${snapHash} !== authoritative ${authHash}`)
  }
  for (const forbidden of forbiddenHashes) {
    if (forbidden && authHash === forbidden) {
      failures.push(`${label}: authoritative still equals forbidden prior hash`)
    }
    if (forbidden && snapHash === forbidden) {
      failures.push(`${label}: playback still equals forbidden prior hash`)
    }
  }
  return failures
}

async function main() {
  for (const pdf of [PDF_A, PDF_B, PDF_C]) {
    if (!fs.existsSync(pdf)) {
      throw new Error(`Missing fixture: ${pdf}`)
    }
  }

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const contentLogs = []
  page.on('console', (msg) => {
    const text = msg.text()
    if (
      text.includes('[score-source-content]') ||
      text.includes('[score-source-lifecycle]') ||
      text.includes('[score-source]')
    ) {
      contentLogs.push(text.slice(0, 500))
    }
  })

  const report = { scenarios: {}, contentLogs: [] }
  const failures = []

  // -------------------------------------------------------------------------
  // Scenario 1: A finishes → B replaces
  // -------------------------------------------------------------------------
  console.log('\n=== Scenario 1: A finishes → upload B ===')
  await clearBrowserState(page)
  await uploadPdf(page, PDF_A)
  const pieceA = await waitForPracticeReady(page, 'A')
  console.log('Piece A authoritative', pieceA.auth)

  await uploadPdf(page, PDF_B)
  const pieceB = await waitForPracticeReady(page, 'B', {
    previousHash: pieceA.auth.musicXmlHash,
  })
  console.log('Piece B authoritative', pieceB.auth)
  failures.push(
    ...assertNewestOwnsPlayback('scenario1-B', pieceB, {
      forbiddenHashes: [pieceA.auth.musicXmlHash],
    }),
  )
  const discardedAfterB = pieceB.trace.some(
    (e) => e.phase === 'omr-result-discarded' || e.discardReason || e.discarded === true,
  )
  report.scenarios.aThenB = {
    pieceA: pieceA.auth,
    pieceB: pieceB.auth,
    pieceBPlayback: pieceB.snap,
    discardedSeen: discardedAfterB,
  }

  // -------------------------------------------------------------------------
  // Scenario 2: A in flight → upload B → late A discarded
  // -------------------------------------------------------------------------
  console.log('\n=== Scenario 2: A in flight → upload B ===')
  await clearBrowserState(page)
  await uploadPdf(page, PDF_A, { waitMs: 400 })
  await waitForPreparing(page)
  // Do not wait for A to finish — replace immediately.
  await uploadPdf(page, PDF_B, { waitMs: 800 })
  const lateB = await waitForPracticeReady(page, 'late-B')
  const lateTrace = lateB.trace
  const sawDiscard = lateTrace.some(
    (e) =>
      e.phase === 'omr-result-discarded' ||
      (e.phase === 'omr-result-apply-attempt' && e.allowed === false) ||
      Boolean(e.discardReason),
  )
  const sawCancellation = lateTrace.some((e) => e.phase === 'omr-cancellation-requested')
  const sawBStart = lateTrace.some((e) => e.phase === 'omr-run-start')
  console.log('late-A discard signals', { sawDiscard, sawCancellation, sawBStart })
  failures.push(
    ...assertNewestOwnsPlayback('scenario2-B', lateB, {
      forbiddenHashes: [],
    }),
  )
  if (!sawCancellation) {
    failures.push('scenario2: missing omr-cancellation-requested lifecycle log')
  }
  if (!sawBStart) {
    failures.push('scenario2: Piece B OMR never started')
  }
  // Authoritative owner must be B's active PDF identity when present.
  if (
    lateB.auth?.ownerPdfIdentity &&
    lateB.gate?.activePdfIdentity &&
    lateB.auth.ownerPdfIdentity !== lateB.gate.activePdfIdentity
  ) {
    failures.push('scenario2: authoritative ownerPdfIdentity !== activePdfIdentity')
  }
  report.scenarios.lateADiscarded = {
    auth: lateB.auth,
    snap: lateB.snap,
    gate: lateB.gate,
    sawDiscard,
    sawCancellation,
    sawBStart,
  }

  // -------------------------------------------------------------------------
  // Scenario 3: Rapid A→B→C
  // -------------------------------------------------------------------------
  console.log('\n=== Scenario 3: Rapid A→B→C ===')
  await clearBrowserState(page)
  await uploadPdf(page, PDF_A, { waitMs: 250 })
  await uploadPdf(page, PDF_B, { waitMs: 250 })
  await uploadPdf(page, PDF_C, { waitMs: 800 })
  const pieceC = await waitForPracticeReady(page, 'C')
  failures.push(...assertNewestOwnsPlayback('scenario3-C', pieceC))
  if (
    pieceC.auth?.ownerPdfIdentity &&
    pieceC.gate?.activePdfIdentity &&
    pieceC.auth.ownerPdfIdentity !== pieceC.gate.activePdfIdentity
  ) {
    failures.push('scenario3: authoritative owner does not match active PDF')
  }
  report.scenarios.rapidABC = {
    auth: pieceC.auth,
    snap: pieceC.snap,
    gate: pieceC.gate,
  }

  // -------------------------------------------------------------------------
  // Scenario 4: Reload persists newest (C)
  // -------------------------------------------------------------------------
  console.log('\n=== Scenario 4: Reload after C ===')
  const beforeReloadHash = pieceC.auth?.musicXmlHash
  await page.reload({ waitUntil: 'networkidle' })
  await dismissOverlays(page)
  const restore = page.getByRole('button', { name: /Restore|Continue/i }).first()
  if (await restore.isVisible().catch(() => false)) {
    await restore.click({ force: true }).catch(() => {})
  }
  // Wait for restored practice / authoritative source.
  const reloadEnd = Date.now() + 90_000
  let afterReload = null
  while (Date.now() < reloadEnd) {
    await dismissOverlays(page)
    // Prefer explicit restore CTA when present.
    for (const name of [/Restore session/i, /Restore/i, /Continue/i]) {
      const btn = page.getByRole('button', { name }).first()
      if (await btn.isVisible().catch(() => false)) {
        await btn.click({ force: true }).catch(() => {})
        await page.waitForTimeout(500)
      }
    }
    afterReload = await readSourceState(page)
    const playbackVisible = await page
      .getByRole('region', { name: /Playback/i })
      .isVisible()
      .catch(() => false)
    if (
      afterReload.auth?.musicXmlHash &&
      afterReload.snap?.timingContentHash &&
      afterReload.auth.musicXmlHash === afterReload.snap.timingContentHash
    ) {
      break
    }
    if (afterReload.auth?.musicXmlHash && !playbackVisible) {
      const practiceNav = page.getByRole('button', { name: 'Practice', exact: true })
      if (await practiceNav.isVisible().catch(() => false)) {
        await practiceNav.click({ force: true }).catch(() => {})
      }
    }
    await page.waitForTimeout(1000)
  }
  report.scenarios.reloadAfterC = {
    beforeReloadHash,
    afterReload: afterReload?.auth ?? null,
    afterReloadPlayback: afterReload?.snap ?? null,
  }
  if (!afterReload?.auth?.musicXmlHash) {
    failures.push('scenario4: no authoritative source after reload')
  } else if (beforeReloadHash && afterReload.auth.musicXmlHash !== beforeReloadHash) {
    failures.push(
      `scenario4: reload hash ${afterReload.auth.musicXmlHash} !== pre-reload ${beforeReloadHash}`,
    )
  }
  if (
    afterReload?.auth?.musicXmlHash &&
    afterReload?.snap?.timingContentHash &&
    afterReload.auth.musicXmlHash !== afterReload.snap.timingContentHash
  ) {
    failures.push('scenario4: playback hash diverged from authoritative after reload')
  }
  if (pieceA.auth?.musicXmlHash && afterReload?.auth?.musicXmlHash === pieceA.auth.musicXmlHash) {
    failures.push('scenario4: reload reverted to Piece A')
  }

  report.contentLogs = contentLogs.slice(-80)
  report.failures = failures

  const outDir = path.join(root, 'tmp/stale-musicxml-ab')
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2))

  await browser.close()

  console.log('\n=== ASSERTIONS ===')
  if (failures.length) {
    console.error('FAIL', failures)
    console.error(`Report: ${path.join(outDir, 'report.json')}`)
    process.exit(1)
  }
  console.log('PASS: newest PDF owns authoritative + playback across A→B, late-A, A→B→C, reload')
  console.log(`Report: ${path.join(outDir, 'report.json')}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
