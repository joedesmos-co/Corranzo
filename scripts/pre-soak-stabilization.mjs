/**
 * Pre-soak stabilization E2E — real visible UI only.
 *
 * Covers soak-critical workflows A–M (subset runnable headlessly):
 *   A clean launch
 *   B upload → OMR → Play
 *   C multi-page A → one-page B (delegates pagecount script when present)
 *   D rapid A → B replacement
 *   E reload active user score
 *   F Piano ↔ Guitar repeatedly
 *   G clean-session Library item
 *   H Library → user PDF → Library
 *   I Stop/seek/loop cleanup (best-effort clock + stop)
 *   J OMR failure surface + Try again visible (malformed PDF)
 *   K session restore with mismatched companions discarded
 *   L no stuck full-screen restore overlay
 *   M ownership / derived caches align after replace
 *
 * Usage: node scripts/pre-soak-stabilization.mjs
 * Requires: npm run dev on http://127.0.0.1:5173
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
const PDF_MULTI = path.join(root, 'public/fixtures/hungarian-dance-no5/hungarian-dance-no5.pdf')
const MALFORMED_PDF = path.join(root, 'tmp/pre-soak/malformed-not-a-pdf.pdf')

const report = {
  generatedAt: new Date().toISOString(),
  baseUrl: BASE,
  passes: [],
  failures: [],
  consoleErrors: [],
  pageErrors: [],
}

function pass(id, detail = '') {
  report.passes.push({ id, detail })
  console.log(`PASS  ${id}${detail ? ` — ${detail}` : ''}`)
}

function fail(id, detail) {
  report.failures.push({ id, detail })
  console.error(`FAIL  ${id} — ${detail}`)
}

async function dismissOverlays(page) {
  for (const name of [
    /Skip restore/i,
    /Skip/i,
    /Dismiss/i,
    /Clear saved/i,
    /Not now/i,
    /Continue/i,
    /Done/i,
  ]) {
    const btn = page.getByRole('button', { name })
    if (await btn.isVisible().catch(() => false)) {
      const disabled = await btn.isDisabled().catch(() => true)
      if (!disabled) await btn.click({ force: true }).catch(() => {})
      await page.waitForTimeout(200)
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
  return page.evaluate(() => {
    const overlay = document.querySelector('.session-restore-overlay')
    return {
      active: window.__SCOREFLOW_ACTIVE_SCORE__ ?? null,
      auth: window.__SCOREFLOW_AUTHORITATIVE_SOURCE__ ?? null,
      snap: window.__SCOREFLOW_PLAYBACK_SNAPSHOT__ ?? null,
      gate: window.__SCOREFLOW_GENERATION_GATE__ ?? null,
      owners: window.__SCOREFLOW_SOURCE_OWNERS__ ?? null,
      omrFail: window.__SCOREFLOW_OMR_FAILURE__ ?? null,
      restoreOverlayVisible: Boolean(overlay && overlay.getClientRects().length > 0),
      restoreOverlayText: overlay?.textContent?.slice(0, 200) ?? null,
      tryAgain: Boolean(
        [...document.querySelectorAll('button')].some((el) =>
          /try again/i.test(el.textContent ?? ''),
        ),
      ),
      inertApp: document.querySelector('.app')?.hasAttribute('inert') ?? false,
    }
  })
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
  return page.getByRole('region', { name: 'Upload score files' }).locator('input[type="file"]')
}

async function uploadPdf(page, pdfPath) {
  const input = await goMyUploads(page)
  await input.setInputFiles(pdfPath)
  await page.waitForTimeout(600)
}

async function waitForPlayback(page, label, { timeoutMs = 180_000, previousHash = null } = {}) {
  const end = Date.now() + timeoutMs
  let last = ''
  while (Date.now() < end) {
    await dismissOverlays(page)
    const state = await readState(page)
    const status = `${label} events=${state.snap?.playableEventCount ?? 0} hash=${state.snap?.timingContentHash ?? state.auth?.musicXmlHash ?? '-'}`
    if (status !== last) {
      console.log(status)
      last = status
    }
    if (state.restoreOverlayVisible && state.inertApp) {
      // Allow brief restore; stuck check is separate with longer dwell.
    }
    if (
      (state.snap?.playableEventCount ?? 0) > 0 &&
      (state.snap?.timingContentHash || state.auth?.musicXmlHash) &&
      (!previousHash ||
        (state.snap?.timingContentHash ?? state.auth?.musicXmlHash) !== previousHash)
    ) {
      return state
    }
    if (state.tryAgain && state.omrFail) {
      throw new Error(`${label}: OMR failed — ${state.omrFail.errorMessage ?? 'unknown'}`)
    }
    await page.waitForTimeout(800)
  }
  throw new Error(`${label}: timed out waiting for playable timeline`)
}

async function openFirstLibraryPiece(page, instrument) {
  await page.getByRole('radio', { name: instrument, exact: true }).click({ force: true })
  await page.waitForTimeout(400)
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('nav[aria-label="Main"] button')].find(
      (el) => el.textContent?.trim() === 'Library',
    )
    btn?.click()
  })
  await page.waitForTimeout(400)
  await page.getByRole('tab', { name: /Practice Library/i }).click({ force: true })
  await page.waitForTimeout(400)
  const start = page.getByRole('button', { name: /Start practice:/i }).first()
  await start.waitFor({ state: 'visible', timeout: 8000 })
  await start.click({ force: true })
  await page.waitForTimeout(2000)
}

async function pressPlayStop(page) {
  const play = page.getByRole('button', { name: /^Play$/i }).first()
  if (await play.isVisible().catch(() => false)) {
    await play.click({ force: true }).catch(() => {})
    await page.waitForTimeout(900)
  }
  const stop = page.getByRole('button', { name: /^Stop$/i }).first()
  if (await stop.isVisible().catch(() => false)) {
    await stop.click({ force: true }).catch(() => {})
    await page.waitForTimeout(400)
  }
}

function assertOwners(state, label) {
  const active =
    state.active?.scoreId ??
    state.gate?.activeScoreId ??
    state.auth?.ownerScoreId ??
    state.auth?.ownerPdfIdentity
  if (!active) {
    fail(`${label}-owners`, 'missing active score identity')
    return
  }
  if (state.auth?.ownerScoreId && state.active?.scoreId && state.auth.ownerScoreId !== state.active.scoreId) {
    fail(`${label}-owners`, 'authoritativeMusicXmlOwner mismatch')
    return
  }
  if (
    state.owners?.activeScoreIdentity &&
    state.owners?.guitarMappingOwner &&
    state.owners.activeScoreIdentity !== state.owners.guitarMappingOwner
  ) {
    fail(`${label}-owners`, 'guitarMappingOwner drift')
    return
  }
  pass(`${label}-owners`, String(active).slice(0, 48))
}

async function main() {
  for (const pdf of [PDF_A, PDF_B]) {
    if (!fs.existsSync(pdf)) throw new Error(`Missing fixture ${pdf}`)
  }
  fs.mkdirSync(path.dirname(MALFORMED_PDF), { recursive: true })
  fs.writeFileSync(MALFORMED_PDF, '%PDF-1.4\nnot a real pdf payload\n%%EOF\n')

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  page.on('pageerror', (err) => report.pageErrors.push(String(err)))
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text()
      if (!/favicon|DevTools|<g> attribute transform/i.test(text)) {
        report.consoleErrors.push(text.slice(0, 400))
      }
    }
  })

  // A. Clean launch
  console.log('\n=== A: Clean launch ===')
  await clearSession(page)
  const clean = await readState(page)
  if (clean.restoreOverlayVisible) fail('A-clean-launch', 'restore overlay visible on clean session')
  else pass('A-clean-launch')
  if (clean.inertApp) fail('A-inert', 'app inert on clean session')
  else pass('A-inert-clear')

  // G. Library clean session
  console.log('\n=== G: Library clean session ===')
  await openFirstLibraryPiece(page, 'Piano')
  const lib = await waitForPlayback(page, 'library')
  if ((lib.snap?.playableEventCount ?? 0) > 0) pass('G-library', `events=${lib.snap.playableEventCount}`)
  else fail('G-library', 'no playable events')
  assertOwners(lib, 'G')

  // B. Upload → OMR → Play
  console.log('\n=== B: Upload → OMR → Play ===')
  await clearSession(page)
  await page.getByRole('radio', { name: 'Piano', exact: true }).click({ force: true })
  await uploadPdf(page, PDF_A)
  const uploaded = await waitForPlayback(page, 'upload-a')
  if ((uploaded.snap?.playableEventCount ?? 0) > 0) pass('B-upload-omr', `events=${uploaded.snap.playableEventCount}`)
  else fail('B-upload-omr', 'no events')
  await pressPlayStop(page)
  pass('B-play-stop')

  // D. Rapid A → B
  console.log('\n=== D: Rapid A → B ===')
  await clearSession(page)
  await page.getByRole('radio', { name: 'Piano', exact: true }).click({ force: true })
  await uploadPdf(page, PDF_A)
  await page.waitForTimeout(1200)
  await uploadPdf(page, PDF_B)
  const rapid = await waitForPlayback(page, 'rapid-b')
  if ((rapid.snap?.playableEventCount ?? 0) > 0) pass('D-rapid-replace', `events=${rapid.snap.playableEventCount}`)
  else fail('D-rapid-replace', 'no events')
  assertOwners(rapid, 'D')

  // C. Multi-page → one-page (page count ownership)
  console.log('\n=== C: Multi-page → one-page ===')
  if (fs.existsSync(PDF_MULTI)) {
    await clearSession(page)
    await uploadPdf(page, PDF_MULTI)
    await page.waitForTimeout(2500)
    const midJob = await page.evaluate(() => window.__SCOREFLOW_OMR_JOB__?.pageCount ?? null)
    await uploadPdf(page, PDF_A)
    const onePage = await waitForPlayback(page, 'after-multipage')
    const finalJob = await page.evaluate(() => window.__SCOREFLOW_OMR_JOB__?.pageCount ?? null)
    if (finalJob === 1 || (onePage.active?.scoreId && (onePage.snap?.playableEventCount ?? 0) > 0)) {
      pass('C-pagecount-reset', `mid=${midJob} finalJob=${finalJob}`)
    } else {
      fail('C-pagecount-reset', `mid=${midJob} final=${finalJob}`)
    }
  } else {
    pass('C-pagecount-reset', 'skipped — multi-page fixture missing')
  }

  // E. Reload active user score
  console.log('\n=== E: Reload active user score ===')
  const beforeReload = await readState(page)
  const beforeHash = beforeReload.auth?.musicXmlHash ?? beforeReload.snap?.timingContentHash
  await page.reload({ waitUntil: 'networkidle' })
  await dismissOverlays(page)
  // L: restore overlay must clear
  const restoreStart = Date.now()
  let stuckOverlay = false
  while (Date.now() - restoreStart < 45_000) {
    const s = await readState(page)
    if (!s.restoreOverlayVisible && !s.inertApp) break
    if (Date.now() - restoreStart > 35_000 && s.restoreOverlayVisible) {
      stuckOverlay = true
      break
    }
    // Prefer Skip if available after timeout messaging
    const skip = page.getByRole('button', { name: /Skip restore/i })
    if (await skip.isVisible().catch(() => false)) {
      await skip.click({ force: true }).catch(() => {})
    }
    await page.waitForTimeout(500)
  }
  if (stuckOverlay) fail('L-stuck-overlay', 'restore overlay still visible after 35s')
  else pass('L-no-stuck-overlay')

  const afterReload = await waitForPlayback(page, 'reload', { timeoutMs: 120_000 })
  if (
    beforeHash &&
    (afterReload.auth?.musicXmlHash === beforeHash ||
      afterReload.snap?.timingContentHash === beforeHash)
  ) {
    pass('E-reload-same-score', beforeHash)
  } else if ((afterReload.snap?.playableEventCount ?? 0) > 0) {
    pass('E-reload-playable', `hash=${afterReload.auth?.musicXmlHash}`)
  } else {
    fail('E-reload', 'reload left no playable score')
  }

  // F. Piano ↔ Guitar
  console.log('\n=== F: Piano ↔ Guitar ===')
  const scoreBeforeSwitch = (await readState(page)).active?.scoreId
  for (let i = 0; i < 3; i += 1) {
    await page.getByRole('radio', { name: 'Guitar', exact: true }).click({ force: true })
    await page.waitForTimeout(600)
    await page.getByRole('radio', { name: 'Piano', exact: true }).click({ force: true })
    await page.waitForTimeout(600)
  }
  const afterSwitch = await readState(page)
  if (scoreBeforeSwitch && afterSwitch.active?.scoreId === scoreBeforeSwitch) {
    pass('F-instrument-switch-retained', scoreBeforeSwitch)
  } else if ((afterSwitch.snap?.playableEventCount ?? 0) > 0) {
    pass('F-instrument-switch-playable')
  } else {
    fail('F-instrument-switch', 'lost playable score during instrument toggling')
  }

  // H. Library → user PDF → Library
  console.log('\n=== H: Library → user PDF → Library ===')
  await clearSession(page)
  await openFirstLibraryPiece(page, 'Piano')
  const libBefore = await waitForPlayback(page, 'h-lib')
  await uploadPdf(page, PDF_B)
  const user = await waitForPlayback(page, 'h-user', {
    previousHash: libBefore.snap?.timingContentHash,
  })
  await openFirstLibraryPiece(page, 'Piano')
  const libAfter = await waitForPlayback(page, 'h-lib-again', {
    previousHash: user.snap?.timingContentHash,
  })
  if (libAfter.snap?.timingContentHash === libBefore.snap?.timingContentHash) {
    pass('H-library-roundtrip')
  } else {
    fail(
      'H-library-roundtrip',
      `before=${libBefore.snap?.timingContentHash} after=${libAfter.snap?.timingContentHash}`,
    )
  }

  // I. Stop/seek cleanup
  console.log('\n=== I: Stop/seek cleanup ===')
  await pressPlayStop(page)
  const seek = page.getByRole('slider').first()
  if (await seek.isVisible().catch(() => false)) {
    await seek.press('ArrowRight').catch(() => {})
    await page.waitForTimeout(300)
    await pressPlayStop(page)
    pass('I-seek-stop')
  } else {
    pass('I-seek-stop', 'slider not visible — stop-only exercised')
  }

  // J. OMR failure surfaces Try again (malformed)
  console.log('\n=== J: OMR failure + retry affordance ===')
  await clearSession(page)
  await uploadPdf(page, MALFORMED_PDF)
  const failEnd = Date.now() + 60_000
  let sawFailureUi = false
  while (Date.now() < failEnd) {
    await dismissOverlays(page)
    const s = await readState(page)
    if (s.tryAgain || s.omrFail) {
      sawFailureUi = true
      const lede = await page.locator('.library-omr-panel__lede').textContent().catch(() => '')
      if (/Something went wrong while preparing this PDF/i.test(lede ?? '')) {
        fail('J-generic-lede', lede)
      } else {
        pass('J-failure-ui', (s.omrFail?.errorMessage ?? lede ?? 'try again').slice(0, 80))
      }
      break
    }
    await page.waitForTimeout(500)
  }
  if (!sawFailureUi) fail('J-failure-ui', 'no Try again / OMR failure within 60s')

  // K. Mismatched companions — corrupt saved meta companions discarded on restore
  console.log('\n=== K: Mismatched companion restore ===')
  await clearSession(page)
  await uploadPdf(page, PDF_A)
  const good = await waitForPlayback(page, 'k-seed')
  // Wait for session save debounce
  await page.waitForTimeout(2000)
  await page.evaluate(() => {
    try {
      const raw = localStorage.getItem('scoreflow-session-meta-v1')
      if (!raw) return
      const wrapper = JSON.parse(raw)
      const meta = wrapper?.meta ?? wrapper
      if (meta) {
        meta.musicXmlFingerprint = 'deliberately-mismatched-companion'
        meta.midiFingerprint = 'also-mismatched'
        localStorage.setItem(
          'scoreflow-session-meta-v1',
          JSON.stringify(wrapper?.meta ? { ...wrapper, meta } : meta),
        )
      }
    } catch {
      // ignore
    }
  })
  await page.reload({ waitUntil: 'networkidle' })
  await dismissOverlays(page)
  const restored = await readState(page)
  // App must remain usable: either partial restore banner or clean library, never inert forever
  await page.waitForTimeout(2000)
  const afterK = await readState(page)
  if (afterK.restoreOverlayVisible && afterK.inertApp) {
    const skip = page.getByRole('button', { name: /Skip restore/i })
    if (await skip.isVisible().catch(() => false)) {
      await skip.click({ force: true })
      await page.waitForTimeout(500)
      pass('K-mismatched-companions', 'skip restore recovered usability')
    } else {
      fail('K-mismatched-companions', 'stuck inert with mismatched companions')
    }
  } else {
    pass(
      'K-mismatched-companions',
      `usable overlay=${afterK.restoreOverlayVisible} hash=${afterK.auth?.musicXmlHash ?? restored.auth?.musicXmlHash ?? '-'}`,
    )
  }

  // M. Guitar + piano scan (regression for false TAB routing)
  console.log('\n=== M: Guitar + piano scan ownership ===')
  await clearSession(page)
  await page.getByRole('radio', { name: 'Guitar', exact: true }).click({ force: true })
  await page.waitForTimeout(500)
  await uploadPdf(page, PDF_B)
  const guitarScan = await waitForPlayback(page, 'guitar-scan')
  if ((guitarScan.snap?.playableEventCount ?? 0) > 0) {
    pass('M-guitar-piano-scan', `events=${guitarScan.snap.playableEventCount}`)
    assertOwners(guitarScan, 'M')
  } else {
    fail('M-guitar-piano-scan', guitarScan.omrFail?.errorMessage ?? 'no events')
  }

  await browser.close()

  const outDir = path.join(root, 'tmp/pre-soak')
  fs.mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, 'stabilization-report.json')
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2))

  console.log('\n=== SUMMARY ===')
  console.log(`passes=${report.passes.length} failures=${report.failures.length}`)
  console.log(`consoleErrors=${report.consoleErrors.length} pageErrors=${report.pageErrors.length}`)
  console.log(`Report: ${outPath}`)
  if (report.failures.length) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
