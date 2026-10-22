#!/usr/bin/env node
/**
 * A6 tempo acceptance: hand-computed onsets, real playback, real pixels.
 *
 * The demo piece is 3/4 at quarter = 60, starting on a downbeat (verified
 * in-app transport + printed time signature). Expected downbeats below are
 * HAND constants (measure k starts at (k-1)*3.0 score-seconds) — computed
 * from the notation, never read from the app's timing map.
 *
 * Part 1 — tempo accuracy: play Preview from 0, record wall-clock times of
 * required-box switches, compare against hand onsets. Tolerance ±0.45s
 * covers React render + 100ms sampling, not mapping error.
 *
 * Part 2 — static geometry (mission item 5): paused, step the Score
 * position slider in 0.1s increments across the m2 downbeat (t=3.0) and
 * measure bar-vs-box with zero sampling lag. If static error is a few px
 * while playing-transition error was ~11px, the remainder is sampling
 * artifact, not geometry error.
 *
 *   E2E_PORT=5211 node scripts/browser-tempo-acceptance-e2e.mjs
 *
 * Output: tmp/tempo-acceptance/{report.json,*.png}
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const outDir = join(root, 'tmp', 'tempo-acceptance')
const PORT = Number(process.env.E2E_PORT ?? 5244)
const baseUrl = `http://127.0.0.1:${PORT}/?e2e-midi=1`

// HAND-COMPUTED from the printed notation: 3/4, quarter = 60bpm,
// downbeat start. Measure k downbeat at (k-1)*3.0 score-seconds.
const EXPECTED_DOWNBEATS = [3.0, 6.0, 9.0, 12.0]
const SWITCH_TOLERANCE_S = 0.45

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function isBenignConsoleMessage(text) {
  return (
    /favicon/i.test(text) ||
    /DevTools/i.test(text) ||
    /<g> attribute transform/i.test(text) ||
    /AudioContext was not allowed to start/i.test(text) ||
    /The AudioContext/i.test(text)
  )
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
    await sleep(500)
  }
}

async function chooseWfyInputSource(page, pattern) {
  const dialog = page.getByRole('dialog', { name: 'How should Corranzo hear you?' })
  if (await dialog.isVisible().catch(() => false)) {
    const button = dialog.getByRole('button', { name: pattern })
    if (await button.isVisible().catch(() => false)) {
      const disabled = await button.isDisabled().catch(() => true)
      if (!disabled) {
        await button.click()
        await sleep(500)
        return true
      }
    }
    return false
  }
  return false
}

async function loadDemo(page) {
  const openScore = page.getByRole('button', { name: 'Open score' }).first()
  if (await openScore.isVisible().catch(() => false)) {
    await openScore.click()
    await page.waitForTimeout(8000)
    await chooseWfyInputSource(page, /Use MIDI/i)
    await dismissOverlays(page)
    return
  }
  const demo = page.getByRole('button', { name: /Try demo:/i }).first()
  await demo.waitFor({ state: 'visible', timeout: 20_000 })
  await demo.click()
  await page.waitForTimeout(8000)
  await chooseWfyInputSource(page, /Use MIDI/i)
  await dismissOverlays(page)
}

async function switchMode(page, modeName) {
  await page.getByRole('radiogroup', { name: 'Practice mode' })
    .getByRole('radio', { name: modeName, exact: true })
    .click()
  await sleep(1200)
  await chooseWfyInputSource(page, /Use MIDI/i)
  await dismissOverlays(page)
}

async function setSlider(page, seconds) {
  return page.evaluate((value) => {
    const input = document.querySelector('input[aria-label="Score position"]')
    if (!input) {
      return null
    }
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, String(value))
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return Number(input.value)
  }, seconds)
}

async function sampleBox(page) {
  return page.evaluate(() => {
    const boxes = [...document.querySelectorAll('[data-score-note-state="current"], [data-score-note-state="current-partial"]')]
    const current = boxes
      .map((box) => ({ box, rect: box.getBoundingClientRect() }))
      .filter(({ box: element, rect }) => rect.width > 0 && rect.height > 0 && element.offsetParent !== null)
      .sort((a, b) => a.rect.left - b.rect.left)[0] ?? null
    const bar = document.querySelector('.score-follow-cursor')
    let barX = null
    if (bar && bar.style.display !== 'none' && bar.offsetParent !== null) {
      const line = bar.querySelector?.('.score-follow-cursor__line') ?? bar
      const rect = line.getBoundingClientRect()
      barX = rect.left + rect.width / 2
    }
    const slider = document.querySelector('input[aria-label="Score position"]')
    return {
      wallNow: Date.now(),
      key: current?.box.getAttribute('data-practice-note-target-key') ?? null,
      boxCenterX: current ? current.rect.left + current.rect.width / 2 : null,
      barX,
      sliderTime: slider ? Number(slider.value) : null,
    }
  })
}

async function main() {
  await mkdir(outDir, { recursive: true })
  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    handDownbeats: EXPECTED_DOWNBEATS,
    passes: [],
    failures: [],
    skipped: [],
    consoleErrors: [],
    pageErrors: [],
  }
  const pass = (name, detail = null) => {
    report.passes.push({ name, detail })
    console.log(`PASS  ${name}`)
  }
  const fail = (name, detail = null) => {
    report.failures.push({ name, detail })
    console.error(`FAIL  ${name}${detail ? `: ${detail}` : ''}`)
  }

  const viteServer = await createServer({
    root,
    configFile: join(root, 'vite.config.js'),
    logLevel: 'silent',
    server: { host: '127.0.0.1', port: PORT, strictPort: true },
  })
  await viteServer.listen()

  const { chromium } = await import('playwright')
  const browser = await chromium.launch({
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'],
  })
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !isBenignConsoleMessage(msg.text())) {
      report.consoleErrors.push(msg.text())
    }
  })
  page.on('pageerror', (error) => {
    report.pageErrors.push(error.message)
  })

  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
    await page.evaluate(async () => {
      localStorage.clear()
      sessionStorage.clear()
    })
    await page.goto(baseUrl, { waitUntil: 'networkidle' })
    await dismissOverlays(page)
    await loadDemo(page)
    await switchMode(page, 'Preview')

    // ---- Part 1: box-switch wall times vs hand downbeats ----
    await setSlider(page, 0)
    await sleep(600)
    const playButton = page.locator('.workspace-play').first()
    await playButton.click()
    const playWall = Date.now()
    await sleep(400)
    const label = await playButton.getAttribute('aria-label').catch(() => '')
    if (!/pause/i.test(label ?? '')) {
      fail('tempo: playback starts', 'play did not start headless')
    } else {
      pass('tempo: playback starts')
      const samples = []
      for (let i = 0; i < 150; i += 1) {
        samples.push(await sampleBox(page))
        await sleep(100)
      }
      // Wall time of each box-key switch, relative to play press.
      const switches = []
      for (let i = 1; i < samples.length; i += 1) {
        if (samples[i].key && samples[i - 1].key && samples[i].key !== samples[i - 1].key) {
          switches.push({
            atWall: (samples[i].wallNow - playWall) / 1000,
            sliderTime: samples[i].sliderTime,
            key: samples[i].key,
          })
        }
      }
      report.switches = switches
      // Downbeat switches: slider time within 0.3 of a hand downbeat.
      const downbeatHits = []
      for (const expected of EXPECTED_DOWNBEATS) {
        const hit = switches.find(
          (s) => s.sliderTime != null && Math.abs(s.sliderTime - expected) < 0.35,
        )
        if (hit) {
          downbeatHits.push({ expected, wallAt: hit.atWall, sliderAt: hit.sliderTime })
        }
      }
      report.downbeatHits = downbeatHits
      console.log(`      switches=${switches.length} downbeatHits=${downbeatHits.length}/${EXPECTED_DOWNBEATS.length}`)
      for (const hit of downbeatHits) {
        console.log(`      hand ${hit.expected.toFixed(1)}s -> wall ${hit.wallAt.toFixed(2)}s (slider ${hit.sliderAt})`)
      }
      if (downbeatHits.length >= 3) {
        // Wall-time spacing between consecutive downbeat hits must equal
        // 3.0s (the notated measure length at 60bpm 3/4), whatever the
        // absolute startup offset is. This is tempo accuracy proper.
        const gaps = []
        for (let i = 1; i < downbeatHits.length; i += 1) {
          gaps.push(downbeatHits[i].wallAt - downbeatHits[i - 1].wallAt)
        }
        report.measureGaps = gaps
        const gapErrors = gaps.map((g) => Math.abs(g - 3.0))
        const maxGapError = Math.max(...gapErrors)
        console.log(`      measure gaps: ${gaps.map((g) => g.toFixed(2)).join(', ')} (expect 3.00)`)
        if (maxGapError <= SWITCH_TOLERANCE_S) {
          pass('tempo: measures elapse at the notated 3.0s', `max gap error ${maxGapError.toFixed(2)}s`)
        } else {
          fail('tempo: measures elapse at the notated 3.0s', `max gap error ${maxGapError.toFixed(2)}s`)
        }
        // Startup sync: first downbeat hit (m2 @3.0) wall time minus 3.0 is
        // the playback startup offset (count-in + unlock latency).
        const startupOffset = downbeatHits[0].wallAt - downbeatHits[0].expected
        report.startupOffsetS = startupOffset
        console.log(`      startup offset: ${startupOffset.toFixed(2)}s`)
        if (Math.abs(startupOffset) <= 1.5) {
          pass('startup: first downbeat within 1.5s of hand time', `${startupOffset.toFixed(2)}s offset`)
        } else {
          fail('startup: first downbeat within 1.5s of hand time', `${startupOffset.toFixed(2)}s offset`)
        }
      } else {
        fail('tempo: downbeat switches observed', `${downbeatHits.length}/${EXPECTED_DOWNBEATS.length} hand downbeats hit`)
      }
      await page.screenshot({ path: join(outDir, 'tempo-playing.png') })
      await playButton.click()
      await sleep(400)
    }

    // ---- Part 2: static step-through across the m2 downbeat ----
    await setSlider(page, 2.6)
    await sleep(700)
    const steps = []
    for (let t = 2.6; t <= 3.41; t += 0.1) {
      await setSlider(page, Math.round(t * 10) / 10)
      await sleep(400)
      const sample = await sampleBox(page)
      steps.push({ requested: Math.round(t * 10) / 10, ...sample })
    }
    report.staticSteps = steps
    let crossError = null
    for (let i = 1; i < steps.length; i += 1) {
      if (steps[i].key && steps[i - 1].key && steps[i].key !== steps[i - 1].key) {
        if (steps[i].barX != null && steps[i].boxCenterX != null) {
          crossError = Math.abs(steps[i].barX - steps[i].boxCenterX)
          report.staticCrossing = { from: steps[i - 1], to: steps[i], errorPx: crossError }
        }
        break
      }
    }
    await page.screenshot({ path: join(outDir, 'tempo-static.png') })
    if (crossError == null) {
      fail('static: onset crossing observed while stepping', 'no box switch between 2.6 and 3.4')
    } else {
      console.log(`      static onset error: ${crossError.toFixed(1)}px`)
      if (crossError <= 12) {
        pass('static: bar sits on the notehead at the onset (no sampling lag)', `${crossError.toFixed(1)}px`)
      } else {
        fail('static: bar sits on the notehead at the onset (no sampling lag)', `${crossError.toFixed(1)}px`)
      }
    }

    if (report.consoleErrors.length === 0 && report.pageErrors.length === 0) {
      pass('no console or page errors')
    } else {
      fail('no console or page errors', JSON.stringify({
        console: report.consoleErrors.slice(0, 5),
        page: report.pageErrors.slice(0, 5),
      }))
    }
  } catch (error) {
    fail('e2e completed without exception', error?.message ?? String(error))
  } finally {
    await writeFile(join(outDir, 'report.json'), JSON.stringify(report, null, 2))
    await browser.close().catch(() => {})
    await viteServer.close().catch(() => {})
  }

  console.log(`\n${report.passes.length} passed, ${report.failures.length} failed, ${report.skipped.length} skipped`)
  process.exit(report.failures.length > 0 ? 1 : 0)
}

main().catch((error) => {
  console.error(error)
  process.exit(2)
})
