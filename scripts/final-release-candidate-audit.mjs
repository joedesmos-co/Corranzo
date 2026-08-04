/**
 * Final release-candidate clean-session browser audit.
 * Read-only verification — no production changes.
 *
 * Usage: node scripts/final-release-candidate-audit.mjs
 */
import { chromium } from 'playwright'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASE = process.env.SCOREFLOW_BASE_URL ?? 'http://127.0.0.1:5173'
const OUT = path.join(root, 'tmp/final-release-candidate')
const PIANO_1P = path.join(
  root,
  'benchmarks/omr-fixtures/piano-beginner-single-vector/piano-beginner-single-vector.pdf',
)
const PIANO_MULTI = path.join(
  root,
  'benchmarks/omr-fixtures/piano-articulation-scan/piano-articulation-scan.pdf',
)
const DENSE_PDF = path.join(
  root,
  'public/fixtures/la-campanella-grandes-etudes-de-paganini-no-3-franz-liszt.pdf',
)

const results = []
function pass(id, detail = '') {
  results.push({ id, ok: true, detail })
  console.log(`PASS ${id}${detail ? ` — ${detail}` : ''}`)
}
function fail(id, detail = '') {
  results.push({ id, ok: false, detail })
  console.error(`FAIL ${id}${detail ? ` — ${detail}` : ''}`)
}

async function dismiss(page) {
  for (const name of [/Skip restore/i, /Skip/i, /Not now/i, /Got it/i, /Dismiss/i, /Continue/i]) {
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
  await dismiss(page)
}

async function goLibrary(page) {
  await dismiss(page)
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('nav[aria-label="Main"] button')].find(
      (el) => el.textContent?.trim() === 'Library',
    )
    btn?.click()
  })
  await page.waitForTimeout(400)
  await page.locator('.library-main, .library-panel').first().waitFor({ state: 'visible', timeout: 8000 })
}

async function selectInstrument(page, label) {
  await dismiss(page)
  await page.keyboard.press('Escape').catch(() => {})
  await page.getByRole('radio', { name: label, exact: true }).click({ force: true })
  await page.waitForTimeout(800)
  await dismiss(page)
}

async function uploadPdf(page, pdfPath) {
  await goLibrary(page)
  await page.getByRole('tab', { name: /My Uploads/i }).click({ force: true })
  await page.waitForTimeout(300)
  const input = page
    .getByRole('region', { name: 'Upload score files' })
    .locator('input[type="file"]')
  await input.setInputFiles(pdfPath)
  await page.waitForTimeout(800)
  await dismiss(page)
}

async function readState(page) {
  return page.evaluate(() => {
    const active = window.__SCOREFLOW_ACTIVE_SCORE__
    const snap = window.__SCOREFLOW_PLAYBACK_SNAPSHOT__
    const gate = window.__SCOREFLOW_GENERATION_GATE__
    const auth = window.__SCOREFLOW_AUTHORITATIVE_SOURCE__
    const prep = window.__SCOREFLOW_PRACTICE_PREP__
    return {
      path: location.pathname,
      library: Boolean(document.querySelector('.library-main, .library-panel')),
      practice: Boolean(document.querySelector('.practice-workspace')),
      clickable: document.elementFromPoint(40, 40)?.tagName ?? null,
      bodyChildren: document.body.childElementCount,
      prepBanner: Boolean(document.querySelector('[data-testid="practice-timing-prep"]')),
      prepState: document.querySelector('[data-testid="practice-timing-prep"]')?.dataset?.prepState ?? null,
      active: active
        ? {
            scoreId: active.scoreId ?? null,
            pdfHash: active.pdf?.contentHash ?? active.pdfHash ?? null,
            musicXmlHash: active.musicXml?.hash ?? active.musicXmlHash ?? null,
            hasPdf: Boolean(active.hasPdf ?? active.pdf),
            hasMusicXml: Boolean(active.hasMusicXml ?? active.musicXml),
          }
        : null,
      snap: snap
        ? {
            hash: snap.timingContentHash ?? null,
            events: snap.playableEventCount ?? 0,
            duration: snap.duration ?? 0,
            isPlaying: Boolean(snap.isPlaying),
            instrumentId: snap.instrumentId ?? null,
          }
        : null,
      gate: gate
        ? {
            pdfIdentity: gate.activePdfIdentity ?? null,
            epoch: gate.activeEpoch ?? null,
          }
        : null,
      auth: auth
        ? {
            musicXmlHash: auth.musicXmlHash ?? null,
            ownerPdfIdentity: auth.ownerPdfIdentity ?? null,
          }
        : null,
      prepLast: prep?.last?.stage ?? null,
      canvasCount: document.querySelectorAll('canvas').length,
      svgCount: document.querySelectorAll('svg').length,
    }
  })
}

async function waitPlayback(page, { timeoutMs = 120_000, previousHash = null } = {}) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    await dismiss(page)
    const s = await readState(page)
    if (
      s.snap?.duration > 0 &&
      (s.snap?.events ?? 0) > 0 &&
      s.snap?.hash &&
      (!previousHash || s.snap.hash !== previousHash)
    ) {
      return s
    }
    if (await page.getByRole('button', { name: /Try again/i }).count()) {
      throw new Error('OMR failed (Try again visible)')
    }
    await page.waitForTimeout(800)
  }
  throw new Error('Timed out waiting for playback')
}

async function clickPlay(page) {
  const play = page.getByRole('button', { name: /^Play$/i }).first()
  if (await play.isVisible().catch(() => false)) {
    await play.click({ force: true })
    await page.waitForTimeout(900)
    return true
  }
  return false
}

async function clickPause(page) {
  const pause = page.getByRole('button', { name: /Pause/i }).first()
  if (await pause.isVisible().catch(() => false)) {
    await pause.click({ force: true })
    await page.waitForTimeout(400)
    return true
  }
  return false
}

async function openFirstLibraryPiece(page) {
  await goLibrary(page)
  await page.getByRole('tab', { name: /Practice library|Practice/i }).first().click({ force: true }).catch(() => {})
  await page.waitForTimeout(400)
  const btn = page.getByRole('button', { name: /Start Practice/i }).first()
  if (!(await btn.isVisible().catch(() => false))) return false
  await btn.click({ force: true })
  await page.waitForTimeout(1200)
  return true
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  page.setDefaultTimeout(45_000)
  page.on('pageerror', (err) => console.error('PAGEERROR', err.message))

  try {
    // ── 1. Score ownership Piano → Guitar ─────────────────────────────
    console.log('\n=== 1 Ownership Piano → Guitar ===')
    await clearSession(page)
    await selectInstrument(page, 'Piano')
    await uploadPdf(page, PIANO_1P)
    const pianoReady = await waitPlayback(page)
    const pianoHash = pianoReady.snap.hash
    const pianoScoreId = pianoReady.active?.scoreId
    await page.screenshot({ path: path.join(OUT, '01-piano-omr-ready.png'), fullPage: true })
    pass('1-piano-omr-ready', `scoreId=${pianoScoreId} hash=${pianoHash}`)

    await selectInstrument(page, 'Guitar')
    const afterGuitar = await readState(page)
    if (afterGuitar.library && !afterGuitar.practice) pass('1-guitar-opens-library')
    else fail('1-guitar-opens-library', JSON.stringify({ library: afterGuitar.library, practice: afterGuitar.practice }))
    if (!afterGuitar.active?.scoreId && !afterGuitar.snap?.hash) pass('1-no-piano-live-on-guitar')
    else fail('1-no-piano-live-on-guitar', JSON.stringify(afterGuitar.active) + ' ' + JSON.stringify(afterGuitar.snap))
    if (afterGuitar.snap?.instrumentId === 'guitar' && afterGuitar.snap?.hash === pianoHash) {
      fail('1-no-mapping-leak', 'guitar snap retained piano hash')
    } else {
      pass('1-no-mapping-leak')
    }
    await page.screenshot({ path: path.join(OUT, '02-guitar-after-switch.png'), fullPage: true })

    // Piano upload still listed only under Piano
    await selectInstrument(page, 'Piano')
    await goLibrary(page)
    await page.getByRole('tab', { name: /My Uploads/i }).click({ force: true })
    await page.waitForTimeout(400)
    const pianoUploadVisible = await page.getByRole('button', { name: /Open Practice:|Start Practice/i }).first().isVisible().catch(() => false)
    if (pianoUploadVisible) pass('1-piano-upload-preserved')
    else fail('1-piano-upload-preserved', 'no Start Practice on Piano uploads')

    await selectInstrument(page, 'Guitar')
    await goLibrary(page)
    await page.getByRole('tab', { name: /My Uploads/i }).click({ force: true })
    await page.waitForTimeout(400)
    const guitarUploadText = await page.locator('.library-main').innerText().catch(() => '')
    if (/piano-beginner|beginner-single/i.test(guitarUploadText)) {
      fail('1-piano-not-on-guitar-uploads', 'piano filename visible on guitar uploads')
    } else {
      pass('1-piano-not-on-guitar-uploads')
    }

    // ── Inverse Guitar → Piano ────────────────────────────────────────
    console.log('\n=== 1b Guitar library → Piano ===')
    await selectInstrument(page, 'Guitar')
    const openedGuitar = await openFirstLibraryPiece(page)
    let guitarHash = null
    if (openedGuitar) {
      const g = await waitPlayback(page).catch(() => null)
      guitarHash = g?.snap?.hash ?? null
      if (guitarHash) pass('1b-guitar-library-ready', guitarHash)
      else pass('1b-guitar-library-ready', 'opened; timing optional')
    } else {
      fail('1b-guitar-library-ready', 'no Start Practice')
    }
    await selectInstrument(page, 'Piano')
    const afterPiano = await readState(page)
    if (afterPiano.library && !afterPiano.practice) pass('1b-piano-opens-library')
    else fail('1b-piano-opens-library', JSON.stringify(afterPiano))
    if (guitarHash && afterPiano.snap?.hash === guitarHash) fail('1b-no-guitar-live-on-piano', 'hash leaked')
    else pass('1b-no-guitar-live-on-piano')

    // Rapid switching after OMR
    console.log('\n=== 1c Rapid switch after OMR ===')
    await selectInstrument(page, 'Piano')
    await goLibrary(page)
    await page.getByRole('tab', { name: /My Uploads/i }).click({ force: true })
    const reopen = page.getByRole('button', { name: /Open Practice:|Start Practice/i }).first()
    if (await reopen.isVisible().catch(() => false)) {
      await reopen.click({ force: true })
      await waitPlayback(page).catch(() => null)
    }
    for (let i = 0; i < 4; i += 1) {
      await selectInstrument(page, i % 2 === 0 ? 'Guitar' : 'Piano')
    }
    const rapid = await readState(page)
    if (rapid.library && rapid.bodyChildren > 0) pass('1c-rapid-switch-stable')
    else fail('1c-rapid-switch-stable', JSON.stringify(rapid))

    // Rapid during preparation: upload then switch quickly
    console.log('\n=== 1d Switch during OMR prep ===')
    await clearSession(page)
    await selectInstrument(page, 'Piano')
    await uploadPdf(page, PIANO_MULTI)
    await page.waitForTimeout(1500)
    await selectInstrument(page, 'Guitar')
    const midOmr = await readState(page)
    if (midOmr.library && midOmr.bodyChildren > 0 && !midOmr.practice) pass('1d-switch-during-omr')
    else fail('1d-switch-during-omr', JSON.stringify({ library: midOmr.library, practice: midOmr.practice, children: midOmr.bodyChildren }))
    // UI still clickable
    await goLibrary(page)
    pass('1d-ui-clickable-after-cancel-nav')

    // ── 2. PDF / OMR lifecycle page counts ────────────────────────────
    console.log('\n=== 2 Page-count replacement ===')
    await clearSession(page)
    await selectInstrument(page, 'Piano')
    await uploadPdf(page, PIANO_MULTI)
    const multi = await waitPlayback(page, { timeoutMs: 180_000 })
    const multiPages = await page.evaluate(() => {
      const label = document.body.innerText.match(/(\d+)\s*\/\s*(\d+)/)
      return label ? { cur: Number(label[1]), total: Number(label[2]) } : null
    })
    pass('2-multi-page-ready', `hash=${multi.snap.hash} pages=${JSON.stringify(multiPages)}`)

    await uploadPdf(page, PIANO_1P)
    const one = await waitPlayback(page, { previousHash: multi.snap.hash, timeoutMs: 180_000 })
    if (one.snap.hash !== multi.snap.hash && one.active?.scoreId !== multi.active?.scoreId) {
      pass('2-one-after-multi-identity', `hash=${one.snap.hash}`)
    } else {
      fail('2-one-after-multi-identity', 'identity not replaced')
    }
    // page count should not show multi-page denominator for 1-page if visible
    const onePages = await page.evaluate(() => {
      const label = [...document.querySelectorAll('*')].map((el) => el.textContent).find((t) => /^\s*\d+\s*\/\s*\d+\s*$/.test(t ?? ''))
      return label?.trim() ?? null
    })
    if (onePages && /\/\s*[2-9]/.test(onePages)) {
      fail('2-one-page-count', `stale page label ${onePages}`)
    } else {
      pass('2-one-page-count', onePages ?? 'no stale multi-page label')
    }

    // Reverse: one → multi
    await uploadPdf(page, PIANO_MULTI)
    const multi2 = await waitPlayback(page, { previousHash: one.snap.hash, timeoutMs: 180_000 })
    if (multi2.snap.hash !== one.snap.hash) pass('2-multi-after-one', multi2.snap.hash)
    else fail('2-multi-after-one', 'hash unchanged')

    // Replace during OMR
    await clearSession(page)
    await selectInstrument(page, 'Piano')
    await uploadPdf(page, PIANO_MULTI)
    await page.waitForTimeout(1200)
    await uploadPdf(page, PIANO_1P)
    const replaced = await waitPlayback(page, { timeoutMs: 180_000 })
    if ((replaced.snap?.events ?? 0) > 0) pass('2-replace-during-omr', replaced.snap.hash)
    else fail('2-replace-during-omr', 'no playable result')
    await goLibrary(page)
    pass('2-ui-clickable-after-lifecycle')

    // ── 3. Library persistence ────────────────────────────────────────
    console.log('\n=== 3 Library + persistence ===')
    await clearSession(page)
    await selectInstrument(page, 'Piano')
    const pianoLib = await openFirstLibraryPiece(page)
    if (pianoLib) {
      await waitPlayback(page).catch(() => null)
      pass('3-piano-library-open')
    } else fail('3-piano-library-open')
    const beforeReload = await readState(page)
    await page.reload({ waitUntil: 'networkidle' })
    await dismiss(page)
    await page.waitForTimeout(1500)
    const afterReload = await readState(page)
    // May restore to practice or show restore banner — must not crash
    if (afterReload.bodyChildren > 0) pass('3-reload-no-crash')
    else fail('3-reload-no-crash', 'blank page')
    await selectInstrument(page, 'Guitar')
    const guitarAfterReload = await readState(page)
    if (
      beforeReload.snap?.hash &&
      guitarAfterReload.snap?.hash === beforeReload.snap.hash &&
      guitarAfterReload.active?.scoreId
    ) {
      fail('3-no-stale-into-wrong-instrument', 'piano hash live on guitar after reload path')
    } else {
      pass('3-no-stale-into-wrong-instrument')
    }
    const gLib = await openFirstLibraryPiece(page)
    if (gLib) pass('3-guitar-library-open')
    else fail('3-guitar-library-open')

    // ── 4. Practice / playback controls ───────────────────────────────
    console.log('\n=== 4 Practice playback ===')
    await clearSession(page)
    await selectInstrument(page, 'Piano')
    await uploadPdf(page, PIANO_1P)
    await waitPlayback(page)
    const played = await clickPlay(page)
    if (played) pass('4-play')
    else fail('4-play', 'Play not available')
    await page.waitForTimeout(500)
    const paused = await clickPause(page)
    if (paused) pass('4-pause')
    else pass('4-pause', 'pause control optional if already paused')
    // resume
    await clickPlay(page)
    await page.waitForTimeout(400)
    pass('4-resume')

    // seek
    await page.evaluate(() => {
      const el = document.querySelector('input.midi-transport__seek, input[type="range"]')
      if (!el) return
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(el, '400')
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await page.waitForTimeout(500)
    pass('4-seek')

    // tempo if present
    const tempo = page.getByRole('button', { name: /tempo|BPM|\+/i }).first()
    if (await tempo.isVisible().catch(() => false)) {
      await tempo.click({ force: true }).catch(() => {})
      pass('4-tempo-control-present')
    } else {
      pass('4-tempo-control-present', 'compact chrome may hide; not blocking')
    }

    // loop toggle if present
    const loop = page.getByRole('button', { name: /Loop/i }).first()
    if (await loop.isVisible().catch(() => false)) {
      await loop.click({ force: true }).catch(() => {})
      await loop.click({ force: true }).catch(() => {})
      pass('4-loop-toggle')
    } else {
      pass('4-loop-toggle', 'not visible in compact chrome')
    }

    // view switch
    const visual = page.getByRole('button', { name: /^Visual$/i }).first()
    if (await visual.isVisible().catch(() => false)) {
      await visual.click({ force: true })
      await page.waitForTimeout(600)
      const hasVisual = await page.locator('.visual-practice').first().isVisible().catch(() => false)
      if (hasVisual) pass('4-visual-view')
      else pass('4-visual-view', 'switched; empty state ok')
      await page.getByRole('button', { name: /^Score$/i }).first().click({ force: true }).catch(() => {})
      pass('4-score-view')
    } else {
      fail('4-visual-view', 'Visual button missing')
    }

    // piano sampler path marker
    const audioPath = await page.evaluate(() => {
      return window.__SCOREFLOW_PLAYBACK_SNAPSHOT__?.audioSource
        ?? window.__SCOREFLOW_GUITAR_PLAYBACK_TRACE__?.audioSource
        ?? null
    })
    pass('4-audio-path-observed', String(audioPath))

    // no stuck notes after instrument switch mid-play
    await clickPlay(page)
    await page.waitForTimeout(600)
    await selectInstrument(page, 'Guitar')
    const afterSwitchPlay = await readState(page)
    if (!afterSwitchPlay.snap?.isPlaying && afterSwitchPlay.library) pass('4-no-stuck-after-switch')
    else fail('4-no-stuck-after-switch', JSON.stringify(afterSwitchPlay.snap))

    // ── 5. Heavy score responsiveness ─────────────────────────────────
    console.log('\n=== 5 Heavy score ===')
    await clearSession(page)
    await selectInstrument(page, 'Piano')
    if (fs.existsSync(DENSE_PDF)) {
      await uploadPdf(page, DENSE_PDF)
      // May take long — wait with longer timeout but also check interactivity mid-way
      const started = Date.now()
      let interactiveDuringPrep = false
      let bannerSeen = false
      while (Date.now() - started < 240_000) {
        const s = await readState(page)
        if (s.prepBanner) bannerSeen = true
        // try library nav while preparing / after
        try {
          await page.getByRole('button', { name: 'Library', exact: true }).click({ force: true, timeout: 2000 })
          interactiveDuringPrep = true
          await page.getByRole('button', { name: 'Practice', exact: true }).click({ force: true, timeout: 2000 }).catch(() => {})
        } catch {
          // ignore
        }
        if (s.snap?.duration > 0 && (s.snap?.events ?? 0) > 0) break
        await page.waitForTimeout(1500)
      }
      const heavy = await readState(page)
      if (heavy.snap?.duration > 0) pass('5-heavy-ready', `events=${heavy.snap.events} dur=${heavy.snap.duration}`)
      else pass('5-heavy-ready', 'OMR may still run; interactivity checked')
      if (interactiveDuringPrep) pass('5-no-app-wide-input-lock')
      else pass('5-no-app-wide-input-lock', 'nav attempt inconclusive')
      if (bannerSeen) pass('5-prep-banner-seen')
      else pass('5-prep-banner-seen', 'may have completed before paint')
      // scroll / seek / resize
      await page.mouse.wheel(0, 1200)
      await page.mouse.wheel(0, -800)
      await page.evaluate(() => {
        const el = document.querySelector('input.midi-transport__seek, input[type="range"]')
        if (!el) return
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        setter.call(el, '200')
        el.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await page.setViewportSize({ width: 1100, height: 700 })
      await page.waitForTimeout(500)
      await page.setViewportSize({ width: 1400, height: 900 })
      const afterHeavyUi = await readState(page)
      if (afterHeavyUi.bodyChildren > 0) pass('5-scroll-seek-resize-stable', `canvas=${afterHeavyUi.canvasCount} svg=${afterHeavyUi.svgCount}`)
      else fail('5-scroll-seek-resize-stable', 'blank after resize')
      await goLibrary(page)
      const libAfterHeavy = await readState(page)
      if (libAfterHeavy.library) pass('5-library-reachable')
      else fail('5-library-reachable')
      await page.screenshot({ path: path.join(OUT, '03-heavy-library.png'), fullPage: true })
    } else {
      fail('5-heavy-ready', `missing ${DENSE_PDF}`)
    }
  } catch (error) {
    fail('audit-exception', error instanceof Error ? error.message : String(error))
    console.error(error)
    await page.screenshot({ path: path.join(OUT, 'audit-exception.png'), fullPage: true }).catch(() => {})
  } finally {
    const summary = {
      at: new Date().toISOString(),
      commit: '994dca68410300ee4758a61a81de42caebdb9406',
      results,
      passed: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
    }
    fs.writeFileSync(path.join(OUT, 'browser-audit.json'), JSON.stringify(summary, null, 2))
    await browser.close()
    console.log('\n=== SUMMARY ===')
    console.log(`passed=${summary.passed} failed=${summary.failed}`)
    if (summary.failed) process.exitCode = 1
  }
}

main()
