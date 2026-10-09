#!/usr/bin/env node
/**
 * Score-follow PRECISION browser pass (S9/S10 pixel truth).
 *
 * Headless Chromium against a vite DEV server (?e2e-midi=1 enables the
 * synthetic MIDI path). Measures in REAL pixels what the node harness
 * cannot: the painted bar vs the painted required-note box on the real
 * demo PDF with its bundled anchors.
 *
 * Per sample (during Preview playback):
 *  - barX: horizontal center of .score-follow-cursor__line (getBoundingClientRect)
 *  - box: current [data-score-note-state="current"] highlight rect
 *  - errorPx = |barX - boxCenterX|, normalized by the box width
 *    (a notehead is ~1 staff space wide) -> errorStaffSpaces
 *  - page agreement: bar and box must share the same .pdf-page-frame
 *
 * Also: pause freeze (sub-pixel), seek relocation, WFY checkpoint-lock
 * proximity, zoom persistence, zero console/page errors.
 *
 *   node scripts/browser-score-follow-precision-e2e.mjs
 *
 * Output: tmp/score-follow-precision-browser/{report.json,*.png}
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const outDir = join(root, 'tmp', 'score-follow-precision-browser')
const PORT = Number(process.env.E2E_PORT ?? 5198)
const baseUrl = `http://127.0.0.1:${PORT}/?e2e-midi=1`

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
  await page.getByRole('button', { name: 'Library', exact: true }).click().catch(() => {})
  await sleep(400)
  const libraryStart = page.getByRole('button', { name: /Start practice:/i }).first()
  if (await libraryStart.isVisible().catch(() => false)) {
    await libraryStart.click()
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

/** One pixel-truth sample of bar vs required-note box. */
async function pixelSample(page) {
  return page.evaluate(() => {
    const frames = [...document.querySelectorAll('.pdf-page-frame, .pdf-page-window__slot--active')]
    const frameIndexOf = (element) => {
      const frame = element?.closest?.('.pdf-page-frame, .pdf-page-window__slot--active')
      return frame ? frames.indexOf(frame) : -1
    }
    const bar = document.querySelector('.score-follow-cursor .score-follow-cursor__line, .score-follow-cursor')
    const boxes = [...document.querySelectorAll('[data-score-note-state="current"], [data-score-note-state="current-partial"]')]
    const barRect = bar && bar.style?.display !== 'none' && bar.offsetParent !== null
      ? bar.getBoundingClientRect()
      : null
    // The visible bar may be the zero-width cursor wrapper: fall back to its line child.
    let barX = null
    let barFrame = -1
    if (bar) {
      const line = bar.querySelector?.('.score-follow-cursor__line') ?? bar
      const rect = line.getBoundingClientRect()
      if (rect.width >= 0 && bar.style.display !== 'none' && bar.offsetParent !== null) {
        barX = rect.left + rect.width / 2
        barFrame = frameIndexOf(bar)
      }
    }
    void barRect
    const positionLine = document.querySelector('.workspace-position')
    const transportText = positionLine ? positionLine.textContent.replace(/\s+/g, ' ').trim().slice(0, 48) : null
    const slider = document.querySelector('input[aria-label="Score position"]')
    const sliderTime = slider ? Number(slider.value) : null
    const current = boxes
      .map((box) => ({ box, rect: box.getBoundingClientRect() }))
      .filter(({ box: element, rect }) => rect.width > 0 && rect.height > 0 && element.offsetParent !== null)
      .sort((a, b) => a.rect.left - b.rect.left)[0] ?? null
    if (barX == null || !current) {
      return {
        ok: false,
        barVisible: barX != null,
        boxesVisible: boxes.length,
      }
    }
    const boxesVisible = boxes.length
    const boxCenterX = current.rect.left + current.rect.width / 2
    // A printed notehead is ~1 staff space wide; the highlight hugs it.
    const staffSpacePx = Math.max(4, current.rect.width)
    return {
      ok: true,
      boxesVisible,
      errorPx: Math.abs(barX - boxCenterX),
      signedErrorPx: barX - boxCenterX,
      errorStaffSpaces: Math.abs(barX - boxCenterX) / staffSpacePx,
      barX,
      boxCenterX,
      boxWidth: current.rect.width,
      boxHeight: current.rect.height,
      samePage: barFrame !== -1 && barFrame === frameIndexOf(current.box),
      barFrame,
      boxFrame: frameIndexOf(current.box),
      state: current.box.getAttribute('data-score-note-state'),
      key: current.box.getAttribute('data-practice-note-target-key'),
      label: (current.box.getAttribute('aria-label') ?? '').slice(0, 80),
      transportText,
      sliderTime,
    }
  })
}

async function injectMidi(page, midi) {
  return page.evaluate((value) => {
    const inject = window.__SCOREFLOW_MIDI_INJECT__
    if (typeof inject !== 'function') {
      return { ok: false, reason: 'no-inject-hook' }
    }
    return { ok: true, delivered: inject(value) }
  }, midi)
}

async function main() {
  await mkdir(outDir, { recursive: true })
  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    passes: [],
    failures: [],
    skipped: [],
    consoleErrors: [],
    pageErrors: [],
    pixelSamples: [],
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

    // ---- Preview pixel pass during real playback ----
    await switchMode(page, 'Preview')
    const playButton = page.locator('.workspace-play').first()
    let playbackRuns = false
    if (await playButton.isVisible().catch(() => false)) {
      await playButton.click()
      await sleep(2500)
      const label = await playButton.getAttribute('aria-label').catch(() => '')
      playbackRuns = /pause/i.test(label ?? '')
      if (playbackRuns) {
        pass('preview playback starts headless')
      }
    }
    if (!playbackRuns) {
      report.skipped.push('playback pixel pass (audio unavailable headless)')
      console.log('SKIP  playback pixel pass (play did not start headless)')
    } else {
      const samples = []
      for (let i = 0; i < 40; i += 1) {
        const sample = await pixelSample(page)
        sample.at = Date.now()
        samples.push(sample)
        report.pixelSamples.push(sample)
        await sleep(150)
      }
      const valid = samples.filter((s) => s.ok)
      const wrongPage = valid.filter((s) => !s.samePage).length
      // Onset-lock transitions: the first sample after the required box
      // switches. The bar must be AT the new dot then — mid-glide lead is
      // by design, onset error is the defect.
      const transitions = []
      for (let i = 1; i < samples.length; i += 1) {
        if (samples[i].ok && samples[i - 1].ok && samples[i].key !== samples[i - 1].key) {
          // Fraction of the previous inter-onset spacing: onset-lock quality
          // in musical units (1.0 = a full event behind/ahead).
          const spacing = Math.abs(samples[i].boxCenterX - samples[i - 1].boxCenterX)
          transitions.push({
            ...samples[i],
            eventSpacingPx: spacing,
            errorEventFraction: spacing > 1 ? samples[i].errorPx / spacing : null,
          })
        }
      }
      await page.screenshot({ path: join(outDir, 'preview-playing.png') })
      if (valid.length >= 10) {
        const errors = valid.map((s) => s.errorStaffSpaces)
        const mean = errors.reduce((a, b) => a + b, 0) / errors.length
        const max = Math.max(...errors)
        const meanPx = valid.map((s) => s.errorPx).reduce((a, b) => a + b, 0) / valid.length
        const signedMeanPx = valid.map((s) => s.signedErrorPx).reduce((a, b) => a + b, 0) / valid.length
        const transErrors = transitions.map((s) => s.errorPx)
        const transMeanPx = transErrors.length > 0
          ? transErrors.reduce((a, b) => a + b, 0) / transErrors.length
          : null
        const transMaxPx = transErrors.length > 0 ? Math.max(...transErrors) : null
        const transFractions = transitions
          .map((s) => s.errorEventFraction)
          .filter((value) => value != null)
        const transMeanFraction = transFractions.length > 0
          ? transFractions.reduce((a, b) => a + b, 0) / transFractions.length
          : null
        const transMaxFraction = transFractions.length > 0 ? Math.max(...transFractions) : null
        report.pixelSummary = {
          samples: valid.length,
          meanErrorStaffSpaces: mean,
          maxErrorStaffSpaces: max,
          meanErrorPx: meanPx,
          signedMeanErrorPx: signedMeanPx,
          transitions: transitions.length,
          transitionMeanErrorPx: transMeanPx,
          transitionMaxErrorPx: transMaxPx,
          transitionMeanEventFraction: transMeanFraction,
          transitionMaxEventFraction: transMaxFraction,
          transitionKeys: transitions.map((s) => s.key),
          wrongPage,
        }
        console.log(`      pixels: n=${valid.length} mean=${mean.toFixed(2)}ss max=${max.toFixed(2)}ss meanPx=${meanPx.toFixed(1)} signedPx=${signedMeanPx.toFixed(1)} wrongPage=${wrongPage}`)
        console.log(`      transitions: n=${transitions.length} meanPx=${transMeanPx?.toFixed(1) ?? 'n/a'} maxPx=${transMaxPx?.toFixed(1) ?? 'n/a'} meanFrac=${transMeanFraction?.toFixed(2) ?? 'n/a'} maxFrac=${transMaxFraction?.toFixed(2) ?? 'n/a'}`)
        if (wrongPage === 0) {
          pass('pixel: bar and required box share the page', `${valid.length} samples`)
        } else {
          fail('pixel: bar and required box share the page', `${wrongPage}/${valid.length} split`)
        }
        // Onset-lock gate: right after the required box switches (the new
        // note sounds), the gliding bar must be at the dot. Mid-glide lead
        // is by design and reported separately, not gated.
        if (transitions.length >= 3 && transMeanFraction != null && transMeanFraction <= 0.35) {
          pass('pixel: bar lands on each new note at its onset', `transition mean ${transMeanFraction.toFixed(2)} of event spacing over ${transitions.length} onsets`)
        } else if (transitions.length >= 3) {
          fail('pixel: bar lands on each new note at its onset', `transition mean ${transMeanFraction?.toFixed(2) ?? 'n/a'} of event spacing over ${transitions.length} onsets`)
        } else {
          fail('pixel: bar lands on each new note at its onset', `only ${transitions.length} box switches observed`)
        }
        if (transMaxFraction != null && transMaxFraction <= 0.6) {
          pass('pixel: no onset overshoot beyond 0.6 event spacing', `max ${transMaxFraction.toFixed(2)}`)
        } else {
          fail('pixel: no onset overshoot beyond 0.6 event spacing', `max ${transMaxFraction?.toFixed(2) ?? 'n/a'}`)
        }
      } else {
        fail('pixel: enough bar+box samples during playback', `${valid.length}/40 valid`)
      }

      // ---- Pause freezes the bar (sub-pixel) ----
      const beforePause = await pixelSample(page)
      await playButton.click()
      await sleep(300)
      const paused1 = await pixelSample(page)
      await sleep(1000)
      const paused2 = await pixelSample(page)
      await page.screenshot({ path: join(outDir, 'preview-paused.png') })
      if (beforePause.ok && paused1.ok && paused2.ok) {
        const drift = Math.abs(paused1.barX - paused2.barX)
        if (drift < 1) {
          pass('pixel: paused bar is frozen', `drift ${drift.toFixed(2)}px`)
        } else {
          fail('pixel: paused bar is frozen', `drift ${drift.toFixed(2)}px`)
        }
      } else {
        fail('pixel: paused bar is frozen', 'bar/box not measurable while paused')
      }

      // ---- Seek relocates the bar onto the sought event ----
      const seeked = await page.evaluate(() => {
        const input = document.querySelector('input[aria-label="Score position"]')
        if (!input) {
          return false
        }
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
        setter?.call(input, '20')
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      })
      await sleep(1000)
      const afterSeek = await pixelSample(page)
      await page.screenshot({ path: join(outDir, 'preview-sought.png') })
      if (seeked && afterSeek.ok && afterSeek.samePage && afterSeek.errorStaffSpaces <= 4) {
        pass('pixel: seek relocates the bar onto the event', `${afterSeek.errorStaffSpaces.toFixed(2)}ss`)
      } else {
        fail('pixel: seek relocates the bar onto the event', JSON.stringify({ seeked, ...afterSeek }))
      }
    }

    // ---- WFY checkpoint lock sits on the required box ----
    await switchMode(page, 'Wait For You')
    const wfySample = await pixelSample(page)
    await page.screenshot({ path: join(outDir, 'wfy-waiting.png') })
    if (wfySample.ok && wfySample.samePage && wfySample.errorStaffSpaces <= 4) {
      pass('pixel: wfy waiting bar sits on the required box', `${wfySample.errorStaffSpaces.toFixed(2)}ss`)
    } else {
      fail('pixel: wfy waiting bar sits on the required box', JSON.stringify(wfySample))
    }

    // ---- Zoom keeps overlay boxes ----
    const fitMode = page.getByRole('button', { name: /fit mode/i }).first()
    if (await fitMode.isVisible().catch(() => false)) {
      await fitMode.click()
      await sleep(600)
      const fitOption = page.getByRole('menuitemradio').first()
      if (await fitOption.isVisible().catch(() => false)) {
        await fitOption.click()
        await sleep(1000)
      } else {
        await page.keyboard.press('Escape')
        await sleep(400)
      }
      // Fit change re-renders PDF pages; overlays remount asynchronously.
      // Poll briefly rather than sampling the transient gap.
      let zoomed = await pixelSample(page)
      for (let retry = 0; retry < 20 && zoomed.boxesVisible === 0; retry += 1) {
        await sleep(250)
        zoomed = await pixelSample(page)
      }
      if (zoomed.boxesVisible > 0) {
        pass('zoom keeps score highlights', `${zoomed.boxesVisible} boxes`)
      } else {
        fail('zoom keeps score highlights', 'no boxes after zoom')
      }
      await page.screenshot({ path: join(outDir, 'zoomed.png') })
    } else {
      report.skipped.push('zoom check (no fit-mode control found)')
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
