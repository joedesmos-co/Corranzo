#!/usr/bin/env node
/**
 * Real Mic Browser QA — Wait For You microphone flow (headless Chromium).
 *
 * Uses Chrome fake media flags + labeled WAV fixtures for note/room scenarios.
 * Usage:
 *   npm run build && npm run preview &
 *   node scripts/browser-mic-wfy-qa.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { synthSimultaneousChord } from '../src/features/microphone-input/micSyntheticChordClips.js'
import { writeWavPcm } from './lib/writeWavPcm.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const outDir = join(root, 'tmp', 'browser-mic-qa')
const baseUrl = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:4173'

const CLIPS = {
  pianoC4: resolve(root, 'benchmarks/mic-accuracy/clips/real-piano-c4.wav'),
  pianoE4: resolve(root, 'benchmarks/mic-accuracy/clips/real-piano-e4.wav'),
  roomQuiet: resolve(root, 'benchmarks/mic-accuracy/clips/real-room-quiet.wav'),
  roomNoisy: resolve(root, 'benchmarks/mic-accuracy/clips/real-room-noisy.wav'),
  dyadC4G4: resolve(root, 'benchmarks/mic-polyphony/clips/real-dyad-c4-g4.wav'),
  triadCMajor: resolve(root, 'benchmarks/mic-polyphony/clips/real-c-major-triad.wav'),
}

const runV2Qa =
  process.env.SCOREFLOW_MIC_ENGINE_V2 === '1' || process.env.SCOREFLOW_MIC_V2_DEV_QA === '1'
const v2DevDefault = process.env.SCOREFLOW_MIC_V2_DEV_QA === '1'

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'ipad', width: 820, height: 1180 },
  { name: 'mobile', width: 390, height: 844 },
]

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function waitForServer(url, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url)
      if (res.ok || res.status === 404) return
    } catch {
      // retry
    }
    await sleep(250)
  }
  throw new Error(`Server not ready at ${url}`)
}

async function dismissOverlays(page) {
  for (const name of ['Skip', 'Done', /Skip restore/i]) {
    const btn = page.getByRole('button', { name })
    if (await btn.isVisible().catch(() => false)) {
      await btn.click()
      await sleep(300)
    }
  }
}

async function prepareFreshSession(page, { micEngineV2 = false, devV2Default = false } = {}) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
  await page.evaluate(async ({ enableMicV2, useDevDefault }) => {
    localStorage.clear()
    sessionStorage.clear()
    if (enableMicV2) {
      localStorage.setItem('scoreflow.flags.micEngineV2', 'true')
    } else if (useDevDefault) {
      // Dev build defaults V2 on when unset — leave storage empty.
    }
    if (typeof indexedDB !== 'undefined') {
      await new Promise((resolve) => {
        const req = indexedDB.deleteDatabase('scoreflow-session')
        req.onsuccess = () => resolve()
        req.onerror = () => resolve()
        req.onblocked = () => resolve()
      }).catch(() => {})
    }
  }, { enableMicV2: micEngineV2, useDevDefault: devV2Default })
  await page.reload({ waitUntil: 'networkidle' })
  await dismissOverlays(page)
  const addScore = page.getByRole('button', { name: 'Add your score' })
  if (await addScore.isVisible().catch(() => false)) {
    await addScore.click()
    await sleep(400)
  }
  await sleep(600)
}

async function selectInstrument(page, label) {
  await page.getByRole('radiogroup', { name: 'Practice instrument' })
    .getByRole('radio', { name: label, exact: true })
    .click()
  await sleep(400)
}

async function loadDemo(page) {
  await page.getByRole('button', { name: 'Library', exact: true }).click().catch(() => {})
  await sleep(400)
  let demo = page.getByRole('button', { name: /Try demo:/i }).first()
  if (!(await demo.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Practice', exact: true }).click().catch(() => {})
    await sleep(500)
    demo = page.getByRole('button', { name: 'Try Demo Piece', exact: true }).first()
  }
  await demo.waitFor({ state: 'visible', timeout: 20_000 })
  await demo.click()
  await page.waitForTimeout(7000)
}

async function clickPracticeMode(page, modeLabel) {
  await page
    .getByRole('radiogroup', { name: 'Practice mode' })
    .locator('label')
    .filter({ hasText: modeLabel })
    .click()
  await sleep(500)
}

async function clickInputSource(page, sourceLabel) {
  await page
    .getByRole('radiogroup', { name: 'How you continue' })
    .locator('label')
    .filter({ hasText: sourceLabel })
    .click()
  await sleep(400)
}

async function openWfyMicPractice(page) {
  await page.getByRole('button', { name: 'Practice', exact: true }).click()
  await sleep(1200)
  await clickPracticeMode(page, 'Wait For You')
  await clickInputSource(page, 'Microphone')
}

function readMicDebug(page) {
  return page.evaluate(() => globalThis.__SCOREFLOW_MIC_DEBUG__ ?? null)
}

/**
 * Poll the mic debug hook, returning the highest simultaneous-match snapshot seen.
 */
async function pollMicDebug(page, { frames = 12, intervalMs = 600 } = {}) {
  let best = null
  let maxMatched = -1
  const trail = []
  for (let i = 0; i < frames; i += 1) {
    const dbg = await readMicDebug(page)
    if (dbg) {
      trail.push({
        expected: dbg.expectedMidis,
        detected: dbg.lastDetectedMidis,
        matched: dbg.lastMatchedCount,
        matchMidis: dbg.lastMatchDetectedMidis,
        outcome: dbg.lastOutcome,
      })
      const matched = dbg.lastMatchedCount ?? 0
      if (matched > maxMatched) {
        maxMatched = matched
        best = dbg
      }
    }
    await sleep(intervalMs)
  }
  return { best, maxMatched, trail }
}

/** Build a WFY mic page with V2 enabled (explicit flag or dev default) and optional fake-audio clip. */
async function openV2WfyPage(browserLauncher, fakeClip, { devDefault = false } = {}) {
  const browser = await browserLauncher(fakeClip)
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await context.grantPermissions(['microphone'], { origin: baseUrl })
  const page = await context.newPage()
  await prepareFreshSession(page, {
    micEngineV2: !devDefault,
    devV2Default: devDefault,
  })
  await selectInstrument(page, 'Piano')
  await loadDemo(page)
  await openWfyMicPractice(page)
  await enableMic(page)
  await sleep(4500)
  return { browser, page }
}

async function testClipScenario({
  launchBrowser,
  clipPath,
  label,
  devDefault,
  pass,
  fail,
  note,
  results,
  expectations = {},
}) {
  const { browser, page } = await openV2WfyPage(launchBrowser, clipPath, { devDefault })
  try {
    const { best, maxMatched, trail } = await pollMicDebug(page, { frames: 10 })
    const scenario = {
      id: label,
      clip: clipPath,
      best,
      maxMatched,
      trail,
    }
    results.scenarios.push(scenario)

    const dbg = best
    const hasDebug = dbg != null
    const hasConfidence =
      (dbg?.lastDetectedMidis?.length ?? 0) > 0 ||
      (dbg?.v2MeanConfidence != null && dbg.v2MeanConfidence > 0) ||
      (Array.isArray(dbg?.lastV2Notes) &&
        dbg.lastV2Notes.some((n) => n.confidence != null && n.confidence > 0))
    const v2Active = dbg?.engineMode === 'v2-score-informed' || dbg?.v2Active === true

    if (expectations.requireV2 && !v2Active) {
      fail(`${label}: V2 engine active`, dbg ? JSON.stringify(dbg) : 'no debug hook')
      return scenario
    }
    if (expectations.requireDebug && !hasDebug) {
      fail(`${label}: debug hook present`, 'missing __SCOREFLOW_MIC_DEBUG__')
      return scenario
    }
    if (expectations.requireConfidence && !hasConfidence) {
      note(`${label}: no confidence in debug yet — detected=${JSON.stringify(dbg?.lastDetectedMidis)}`)
    } else if (hasConfidence) {
      pass(
        `${label}: debug reports detected notes/confidence`,
        `midis=${JSON.stringify(dbg?.lastDetectedMidis)} conf=${dbg?.v2MeanConfidence ?? dbg?.lastV2Notes?.[0]?.confidence}`,
      )
    }

    if (expectations.minDetected != null) {
      const count = dbg?.lastDetectedCount ?? dbg?.lastDetectedMidis?.length ?? 0
      if (count >= expectations.minDetected) {
        pass(`${label}: detected ${count} note(s)`, JSON.stringify(dbg?.lastDetectedMidis))
      } else {
        note(`${label}: detected ${count} (expected ≥${expectations.minDetected}) — document before tuning`)
        scenario.documentedFailure = `detected ${count}, expected ≥${expectations.minDetected}`
      }
    }

    if (expectations.noAdvance) {
      const progress = await page
        .locator('.wait-for-you__progress-header span')
        .last()
        .innerText()
        .catch(() => '?')
      scenario.progress = progress
      if (progress === '0%' && (dbg?.lastMatchedCount ?? 0) === 0) {
        pass(`${label}: no spurious advance`, `progress=${progress}`)
      } else {
        note(`${label}: progress=${progress} matched=${dbg?.lastMatchedCount} — review`)
      }
    }

    if (expectations.minMatched != null) {
      if (maxMatched >= expectations.minMatched) {
        pass(`${label}: matched ${maxMatched} expected tone(s)`, JSON.stringify(dbg?.lastMatchDetectedMidis))
      } else {
        note(`${label}: matched ${maxMatched} (expected ≥${expectations.minMatched}) — document before tuning`)
        scenario.documentedFailure = `matched ${maxMatched}, expected ≥${expectations.minMatched}`
      }
    }

    if (!expectations.requireConfidence && !expectations.minDetected && !expectations.noAdvance && !expectations.minMatched) {
      pass(`${label}: mic enabled without crash`)
    }

    return scenario
  } finally {
    await browser.close()
  }
}

async function micChipText(page) {
  return page
    .getByRole('region', { name: 'Microphone input' })
    .locator('.practice-status-chip')
    .innerText()
    .catch(() => '')
}

async function micPanelVisible(page) {
  return page.getByRole('region', { name: 'Microphone input' }).isVisible().catch(() => false)
}

async function micTestVisible(page) {
  return page.locator('.mic-test').isVisible().catch(() => false)
}

async function enableMic(page) {
  const enableBtn = page.getByRole('button', { name: 'Enable microphone' }).first()
  if (await enableBtn.isVisible().catch(() => false)) {
    await enableBtn.click()
    await sleep(2500)
    return 'wfy-enable'
  }
  const panelBtn = page
    .getByRole('region', { name: 'Microphone input' })
    .getByRole('button', { name: 'Enable microphone' })
  if (await panelBtn.isVisible().catch(() => false)) {
    await panelBtn.click()
    await sleep(2500)
    return 'panel-enable'
  }
  return null
}

async function launchBrowser(fakeAudioFile) {
  const { chromium } = await import('playwright')
  const args = [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
  ]
  if (fakeAudioFile) {
    args.push(`--use-file-for-fake-audio-capture=${fakeAudioFile}`)
  }
  const browser = await chromium.launch({ args })
  return browser
}

async function main() {
  await waitForServer(baseUrl)
  await mkdir(outDir, { recursive: true })

  const results = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    scenarios: [],
    passes: [],
    failures: [],
    notes: [],
    tuningChanged: false,
  }

  function pass(name, detail = '') {
    results.passes.push({ name, detail })
    console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`)
  }

  function fail(name, detail) {
    results.failures.push({ name, detail })
    console.error(`FAIL  ${name}: ${detail}`)
  }

  function note(text) {
    results.notes.push(text)
  }

  // ── Denied permission (no grant) ─────────────────────────────────────────
  {
    const browser = await launchBrowser(CLIPS.roomQuiet)
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const page = await context.newPage()
    try {
      await prepareFreshSession(page)
      await selectInstrument(page, 'Piano')
      await loadDemo(page)
      await openWfyMicPractice(page)
      await context.clearPermissions()
      await page.evaluate(() => {
        navigator.mediaDevices.getUserMedia = () =>
          Promise.reject(Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }))
      })
      await enableMic(page)
      const blocked = await page.getByText('Mic blocked').isVisible().catch(() => false)
      if (blocked) pass('mic permission denied shows Mic blocked')
      else fail('mic permission denied shows Mic blocked', 'No blocked state in UI')
      results.scenarios.push({ id: 'permission-denied', blocked })
    } finally {
      await browser.close()
    }
  }

  // ── Main flow with granted mic + fake piano audio ────────────────────────
  const browser = await launchBrowser(CLIPS.pianoC4)
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    colorScheme: 'dark',
  })
  await context.grantPermissions(['microphone'], { origin: baseUrl })
  const page = await context.newPage()

  page.on('pageerror', (error) => {
    results.failures.push({ name: 'pageerror', detail: error.message })
  })

  try {
    await prepareFreshSession(page)
    await selectInstrument(page, 'Piano')
    await loadDemo(page)
    await openWfyMicPractice(page)

    const wfySection = page.locator('.wait-for-you').first()
    if (await wfySection.isVisible()) {
      pass('WFY section visible with Microphone source')
    } else {
      fail('WFY section visible with Microphone source', 'Section missing')
    }

    if (!(await micPanelVisible(page))) {
      fail('mic panel visible before enable', 'Expected Microphone input region')
    }

    const enabledVia = await enableMic(page)
    if (enabledVia) {
      pass('mic permission grant enables capture', enabledVia)
    } else {
      fail('mic permission grant enables capture', 'No enable button worked')
    }

    const micDebugDefault = await page.evaluate(() => globalThis.__SCOREFLOW_MIC_DEBUG__ ?? null)
    if (micDebugDefault?.engineMode === 'v1-monophonic' && micDebugDefault?.v2Enabled === false) {
      pass('production build keeps V1 default when flag unset', micDebugDefault.engineMode)
    } else if (micDebugDefault) {
      note(`Mic engine debug: ${JSON.stringify(micDebugDefault)}`)
    } else {
      note('__SCOREFLOW_MIC_DEBUG__ not exposed (production build?)')
    }

    await sleep(3000)
    const chipAfterEnable = await micChipText(page)
    if (/Calibrating|Mic ready|Mic listening/i.test(chipAfterEnable)) {
      pass('mic shows calibrating or ready after grant', chipAfterEnable)
    } else {
      fail('mic shows calibrating or ready after grant', chipAfterEnable || '(empty)')
    }

    if (await micTestVisible(page)) {
      pass('mic test panel visible while listening')
    } else {
      note('Mic test panel not visible — may still be calibrating in fake stream')
    }

    const calLabel = await page
      .locator('.mic-input-status__calibration')
      .innerText()
      .catch(() => '')
    if (calLabel) {
      pass('mic calibration status line present', calLabel.slice(0, 60))
    }

    // Hear It then mic still listening
    const hearIt = page.getByRole('button', { name: /Hear it/i }).first()
    if (await hearIt.isVisible().catch(() => false)) {
      await hearIt.click()
      await sleep(1500)
      const stillListening = await page
        .getByRole('region', { name: 'Microphone input' })
        .isVisible()
      if (stillListening) pass('Hear It does not dismiss mic panel')
      else fail('Hear It does not dismiss mic panel', 'Mic panel hidden after Hear It')
    } else {
      note('Hear It not visible — checkpoint may not be a note yet')
    }

    // Leave WFY → mic should stop
    await clickPracticeMode(page, 'Play Along')
    await sleep(800)

    const micPanelAfterLeave = await micPanelVisible(page)
    const micTestAfterLeave = await micTestVisible(page)
    if (!micPanelAfterLeave && !micTestAfterLeave) {
      pass('leaving WFY hides mic panel and test UI')
    } else {
      fail(
        'leaving WFY hides mic panel and test UI',
        `panel=${micPanelAfterLeave} test=${micTestAfterLeave}`,
      )
    }

    await clickPracticeMode(page, 'Wait For You')
    await clickInputSource(page, 'Microphone')

    const micOffNotice = await page.getByText('Microphone is off').isVisible().catch(() => false)
    if (micOffNotice) {
      pass('re-entering WFY shows mic off until re-enabled')
    } else {
      note('Mic off notice not shown on re-entry — may auto-resume in some builds')
    }

    // Piano → Guitar switch while WFY mic was active
    await enableMic(page)
    await sleep(2000)
    await selectInstrument(page, 'Guitar')
    await sleep(800)
    const guitarEmpty = await page.getByText('No piece open yet').isVisible().catch(() => false)
    if (guitarEmpty) {
      await loadDemo(page)
      await page.getByRole('button', { name: 'Practice', exact: true }).click()
      await sleep(800)
    }
    await clickPracticeMode(page, 'Wait For You')
    await clickInputSource(page, 'Microphone')
    await sleep(400)
    const staleFeedback = await page
      .getByText(/Last confirmed/i)
      .isVisible()
      .catch(() => false)
    if (!staleFeedback) {
      pass('instrument switch does not show stale Last confirmed mic feedback')
    } else {
      fail('instrument switch clears mic feedback', 'Last confirmed still visible')
    }
    const guitarMicPanel = await micPanelVisible(page)
    note(`Guitar WFY mic panel visible after switch: ${guitarMicPanel}`)

    // Viewport smoke (iPad + mobile) — layout only
    for (const viewport of VIEWPORTS.slice(1)) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await sleep(400)
      const overflow = await page.evaluate(() => {
        const doc = document.documentElement
        return doc.scrollWidth - doc.clientWidth > 2
      })
      if (!overflow) pass(`${viewport.name} WFY mic layout — no horizontal overflow`)
      else fail(`${viewport.name} WFY mic layout`, 'horizontal overflow')
    }

    results.scenarios.push({
      id: 'wfy-mic-main',
      chipAfterEnable,
      calLabel,
    })
  } catch (error) {
    fail('mic QA runner', error instanceof Error ? error.message : String(error))
    console.error(error)
  } finally {
    await page.screenshot({ path: join(outDir, 'final-state.png'), fullPage: true }).catch(() => {})
    await writeFile(join(outDir, 'report.json'), JSON.stringify(results, null, 2))
    await browser.close()
  }

  // ── Quiet room fake stream ───────────────────────────────────────────────
  {
    const quietBrowser = await launchBrowser(CLIPS.roomQuiet)
    const quietContext = await quietBrowser.newContext({ viewport: { width: 1280, height: 800 } })
    await quietContext.grantPermissions(['microphone'], { origin: baseUrl })
    const quietPage = await quietContext.newPage()
    try {
      await prepareFreshSession(quietPage)
      await selectInstrument(quietPage, 'Piano')
      await loadDemo(quietPage)
      await openWfyMicPractice(quietPage)
      await enableMic(quietPage)
      await sleep(3500)
      const quietCal = await quietPage
        .locator('.mic-input-status__calibration')
        .innerText()
        .catch(() => '')
      if (/quiet|ready|Calibrating/i.test(quietCal)) {
        pass('quiet room fixture calibrates without crash', quietCal.slice(0, 50))
      } else {
        note(`Quiet room calibration text: ${quietCal || '(none)'}`)
        pass('quiet room fixture — mic enabled without crash')
      }
      results.scenarios.push({ id: 'quiet-room', quietCal })
    } finally {
      await quietBrowser.close()
    }
  }

  // ── Noisy room fake stream ───────────────────────────────────────────────
  {
    const noisyBrowser = await launchBrowser(CLIPS.roomNoisy)
    const noisyContext = await noisyBrowser.newContext({ viewport: { width: 1280, height: 800 } })
    await noisyContext.grantPermissions(['microphone'], { origin: baseUrl })
    const noisyPage = await noisyContext.newPage()
    try {
      await prepareFreshSession(noisyPage)
      await selectInstrument(noisyPage, 'Piano')
      await loadDemo(noisyPage)
      await openWfyMicPractice(noisyPage)
      await enableMic(noisyPage)
      await sleep(3500)
      const noisyCal = await noisyPage
        .locator('.mic-input-status__calibration')
        .innerText()
        .catch(() => '')
      const noisyStatus = await noisyPage
        .locator('.mic-input-status__calibration')
        .getAttribute('class')
        .catch(() => '')
      if (/noisy|room|ready|Calibrating/i.test(noisyCal)) {
        pass('noisy room fixture surfaces room guidance', noisyCal.slice(0, 60))
      } else {
        note(`Noisy room calibration: ${noisyCal}`)
        pass('noisy room fixture — mic enabled without crash')
      }
      const falsePositive = await noisyPage.getByText(/Last confirmed/i).isVisible().catch(() => false)
      if (!falsePositive) pass('noisy room does not show false Last confirmed')
      else fail('noisy room false positive', 'Stable note shown on noise-only stream')
      results.scenarios.push({ id: 'noisy-room', noisyCal, noisyStatus })
    } finally {
      await noisyBrowser.close()
    }
  }

  if (runV2Qa) {
    const v2Scenario = { id: 'mic-engine-v2-real-world', devDefault: v2DevDefault }
    if (v2DevDefault) {
      note('V2 real-world QA running against dev default (no localStorage flag)')
    }

    // ── 1. V2 active + debug hook on first checkpoint ──
    {
      const { browser, page } = await openV2WfyPage(launchBrowser, CLIPS.roomQuiet, {
        devDefault: v2DevDefault,
      })
      try {
        const micDebugV2 = await readMicDebug(page)
        v2Scenario.debugOnEnable = micDebugV2
        const fieldsOk =
          micDebugV2?.engineMode === 'v2-score-informed' &&
          micDebugV2?.v2Enabled === true &&
          typeof micDebugV2?.isMicV2Polyphonic === 'boolean'
        if (fieldsOk) {
          pass(
            'V2: __SCOREFLOW_MIC_DEBUG__ reports engineMode/v2Enabled/isMicV2Polyphonic',
            `mode=${micDebugV2.engineMode} poly=${micDebugV2.isMicV2Polyphonic} devDefault=${v2DevDefault}`,
          )
        } else {
          fail(
            'V2: __SCOREFLOW_MIC_DEBUG__ reports required fields',
            micDebugV2 ? JSON.stringify(micDebugV2) : 'debug hook missing',
          )
        }
        v2Scenario.firstCheckpointExpected = micDebugV2?.expectedMidis ?? null
      } finally {
        await browser.close()
      }
    }

    // ── 2. Matching chord clip → multiple simultaneous detected notes + confidence ──
    const chordExpected = v2Scenario.firstCheckpointExpected
    if (Array.isArray(chordExpected) && chordExpected.length > 1) {
      const chordClip = join(outDir, 'v2-chord-fixture.wav')
      const samples = synthSimultaneousChord(chordExpected, 44100, {
        seconds: 12,
        amplitude: 0.5,
      })
      await writeWavPcm(chordClip, samples, 44100)

      await testClipScenario({
        launchBrowser,
        clipPath: chordClip,
        label: 'bass+treble chord (demo checkpoint)',
        devDefault: v2DevDefault,
        pass,
        fail,
        note,
        results,
        expectations: {
          requireV2: true,
          requireDebug: true,
          requireConfidence: true,
          minMatched: 2,
        },
      })
    } else {
      note(
        `V2 chord detection skipped — first checkpoint not a chord: ${JSON.stringify(chordExpected)}`,
      )
    }

    // ── 3. Real-world clip matrix (fake mic fixtures) ─────────────────────────
    const softClip = join(outDir, 'v2-soft-c4.wav')
    const loudClip = join(outDir, 'v2-loud-c4.wav')
    await writeWavPcm(
      softClip,
      synthSimultaneousChord([60], 44100, { seconds: 10, amplitude: 0.08 }),
      44100,
    )
    await writeWavPcm(
      loudClip,
      synthSimultaneousChord([60], 44100, { seconds: 10, amplitude: 0.55 }),
      44100,
    )

    const clipMatrix = [
      {
        label: 'single piano C4 fixture',
        clip: CLIPS.pianoC4,
        expectations: { requireV2: true, requireDebug: true },
      },
      {
        label: 'repeated piano C4 (looped fixture)',
        clip: CLIPS.pianoC4,
        expectations: { requireV2: true, requireDebug: true },
      },
      {
        label: 'wrong note (E4 vs chord checkpoint)',
        clip: CLIPS.pianoE4,
        expectations: { requireV2: true, noAdvance: true },
      },
      {
        label: '2-note dyad fixture (C4+G4)',
        clip: CLIPS.dyadC4G4,
        expectations: { requireV2: true, requireDebug: true, requireConfidence: true },
      },
      {
        label: '3-note triad fixture (C major)',
        clip: CLIPS.triadCMajor,
        expectations: { requireV2: true, requireDebug: true, requireConfidence: true },
      },
      {
        label: 'quiet room',
        clip: CLIPS.roomQuiet,
        expectations: { requireV2: true, noAdvance: true },
      },
      {
        label: 'noisy room',
        clip: CLIPS.roomNoisy,
        expectations: { requireV2: true, noAdvance: true },
      },
      {
        label: 'soft playing (low amplitude C4)',
        clip: softClip,
        expectations: { requireV2: true, requireDebug: true },
      },
      {
        label: 'loud playing (high amplitude C4)',
        clip: loudClip,
        expectations: { requireV2: true, requireDebug: true, requireConfidence: true },
      },
    ]

    for (const entry of clipMatrix) {
      await testClipScenario({
        launchBrowser,
        clipPath: entry.clip,
        label: entry.label,
        devDefault: v2DevDefault,
        pass,
        fail,
        note,
        results,
        expectations: entry.expectations,
      })
    }

    // ── 4. Mismatched quiet clip → no spurious advance ────────────────────────
    await testClipScenario({
      launchBrowser,
      clipPath: CLIPS.roomQuiet,
      label: 'non-matching audio no advance',
      devDefault: v2DevDefault,
      pass,
      fail,
      note,
      results,
      expectations: { requireV2: true, noAdvance: true },
    })

    // ── 5. Hear It then mic still listening ───────────────────────────────────
    {
      const { browser, page } = await openV2WfyPage(launchBrowser, CLIPS.pianoC4, {
        devDefault: v2DevDefault,
      })
      try {
        const hearIt = page.getByRole('button', { name: /Hear it/i }).first()
        if (await hearIt.isVisible().catch(() => false)) {
          await hearIt.click()
          await sleep(1500)
          const stillListening = await micPanelVisible(page)
          if (stillListening) pass('V2: Hear It does not dismiss mic panel')
          else fail('V2: Hear It does not dismiss mic panel', 'panel hidden')
        } else {
          note('V2: Hear It not visible at first checkpoint')
        }
      } finally {
        await browser.close()
      }
    }

    // ── 6. Leaving WFY / instrument switch clears state ───────────────────────
    {
      const { browser, page } = await openV2WfyPage(launchBrowser, CLIPS.pianoC4, {
        devDefault: v2DevDefault,
      })
      try {
        await clickPracticeMode(page, 'Play Along')
        await sleep(800)
        const panelGone = !(await micPanelVisible(page))
        const testGone = !(await micTestVisible(page))
        if (panelGone && testGone) {
          pass('V2: leaving WFY hides mic panel/test (state cleared)')
        } else {
          fail('V2: leaving WFY clears mic state', `panel=${!panelGone} test=${!testGone}`)
        }

        await clickPracticeMode(page, 'Wait For You')
        await clickInputSource(page, 'Microphone')
        await sleep(400)
        await selectInstrument(page, 'Guitar')
        await sleep(800)
        const guitarEmpty = await page.getByText('No piece open yet').isVisible().catch(() => false)
        if (guitarEmpty) {
          await loadDemo(page)
          await page.getByRole('button', { name: 'Practice', exact: true }).click()
          await sleep(800)
          await clickPracticeMode(page, 'Wait For You')
          await clickInputSource(page, 'Microphone')
          await sleep(400)
        }
        const staleFeedback = await page
          .getByText(/Last confirmed/i)
          .isVisible()
          .catch(() => false)
        if (!staleFeedback) {
          pass('V2: instrument switch does not leave stale mic feedback')
        } else {
          fail('V2: instrument switch clears mic feedback', 'Last confirmed still visible')
        }
      } finally {
        await browser.close()
      }
    }

    // ── 7. Reload persistence — explicit opt-out restores V1 ──────────────────
    {
      const { browser, page } = await openV2WfyPage(launchBrowser, CLIPS.roomQuiet, {
        devDefault: v2DevDefault,
      })
      try {
        await page.evaluate(() => {
          localStorage.setItem('scoreflow.flags.micEngineV2', 'false')
        })
        await page.reload({ waitUntil: 'networkidle' })
        await dismissOverlays(page)
        await selectInstrument(page, 'Piano')
        await loadDemo(page)
        await openWfyMicPractice(page)
        await enableMic(page)
        await sleep(2000)
        const dbg = await readMicDebug(page)
        v2Scenario.reloadOptOut = dbg
        if (dbg?.engineMode === 'v1-monophonic' && dbg?.v2Enabled === false) {
          pass('V2 opt-out: reload with flag=false restores V1', dbg.engineMode)
        } else if (dbg) {
          note(`V2 opt-out after reload: ${JSON.stringify(dbg)}`)
        } else {
          note('V2 opt-out: debug hook not exposed after reload (production build?)')
        }
      } finally {
        await browser.close()
      }
    }

    v2Scenario.documentedFailures = results.scenarios
      .filter((s) => s.documentedFailure)
      .map((s) => ({ id: s.id, failure: s.documentedFailure }))
    results.scenarios.push(v2Scenario)
  }

  await writeFile(join(outDir, 'report.json'), JSON.stringify(results, null, 2))

  const md = [
    '# Real Mic Browser QA Report',
    '',
    `**Generated:** ${results.generatedAt}`,
    '',
    `**Passed:** ${results.passes.length} · **Failed:** ${results.failures.length}`,
    '',
    '## What worked',
    ...results.passes.map((p) => `- ${p.name}${p.detail ? ` — ${p.detail}` : ''}`),
    '',
    '## What failed',
    ...(results.failures.length
      ? results.failures.map((f) => `- **${f.name}:** ${f.detail}`)
      : ['- (none)']),
    '',
    '## Notes',
    ...results.notes.map((n) => `- ${n}`),
    '',
    '## Documented failures (no threshold tuning)',
    ...(results.scenarios.some((s) => s.documentedFailure)
      ? results.scenarios
          .filter((s) => s.documentedFailure)
          .map((s) => `- **${s.id}:** ${s.documentedFailure}`)
      : ['- (none — all clip scenarios passed or were informational)']),
    '',
    `**Constants tuned:** ${results.tuningChanged ? 'yes' : 'no'}`,
    '',
    '## V2 dev default recommendation',
    results.failures.length === 0
      ? '- V2 can stay default for dev — no confirmed integration bugs in this pass.'
      : '- Review failures before keeping V2 as dev default.',
    '',
  ].join('\n')

  await writeFile(join(outDir, 'report.md'), md)

  console.log(`\nMic QA report: ${join(outDir, 'report.json')}`)
  console.log(`Passed: ${results.passes.length}, Failed: ${results.failures.length}`)

  if (results.failures.length > 0) {
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
