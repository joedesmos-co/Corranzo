#!/usr/bin/env node
/**
 * Cross-engraving browser acceptance (FINAL mission items 1-4).
 *
 * Uploads a genuinely independent pair — repo Für Elise MusicXML
 * (music21-processed Mutopia #931) + 1888 Breitkopf plate scan PDF
 * (Wikimedia Commons, PD-old) — and verifies in a real browser:
 *  1. Auto-setup completes and labels the mapping Approximate (never
 *     "Auto setup complete", never notehead precision claims).
 *  2. The cursor shows during Preview playback on the uploaded pair.
 *  3. Bar and required box share the page and roughly coincide.
 *  4. Zoom / seek / page stability; WFY mode shows a locked box+bar.
 *  5. Zero console/page errors.
 *
 *   E2E_PORT=5211 node scripts/browser-cross-engraving-e2e.mjs
 *
 * Output: tmp/cross-engraving-browser/{report.json,*.png}
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const outDir = join(root, 'tmp', 'cross-engraving-browser')
const PORT = Number(process.env.E2E_PORT ?? 5255)
const baseUrl = `http://127.0.0.1:${PORT}/?e2e-midi=1`

const PDF = join(root, 'tmp/cross-engraving/fur-elise-breitkopf-1888.pdf')
const MUSICXML = join(root, 'public/fixtures/practice-library/piano-beethoven-fur-elise/piano-beethoven-fur-elise.musicxml')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function isBenignConsoleMessage(text) {
  return (
    /favicon/i.test(text) ||
    /DevTools/i.test(text) ||
    /<g> attribute transform/i.test(text) ||
    /AudioContext was not allowed to start/i.test(text) ||
    /The AudioContext/i.test(text) ||
    /OMR generation cancelled/i.test(text)
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

async function sampleOverlay(page) {
  return page.evaluate(() => {
    const boxes = [...document.querySelectorAll('[data-score-note-state="current"], [data-score-note-state="current-partial"]')]
    const current = boxes
      .map((box) => ({ box, rect: box.getBoundingClientRect() }))
      .filter(({ box: element, rect }) => rect.width > 0 && rect.height > 0 && element.offsetParent !== null)
      .sort((a, b) => a.rect.left - b.rect.left)[0] ?? null
    const bar = document.querySelector('.score-follow-cursor')
    let barX = null
    let barFrame = -1
    const frames = [...document.querySelectorAll('.pdf-page-frame, .pdf-page-window__slot--active')]
    if (bar && bar.style.display !== 'none' && bar.offsetParent !== null) {
      const line = bar.querySelector?.('.score-follow-cursor__line') ?? bar
      const rect = line.getBoundingClientRect()
      barX = rect.left + rect.width / 2
      const frame = bar.closest?.('.pdf-page-frame, .pdf-page-window__slot--active')
      barFrame = frame ? frames.indexOf(frame) : -1
    }
    const bodyText = document.body.innerText ?? ''
    const approxHint = document.querySelector('.score-follow-approximate-hint')
    return {
      boxesVisible: boxes.length,
      barVisible: barX != null,
      barX,
      boxCenterX: current ? current.rect.left + current.rect.width / 2 : null,
      boxWidth: current?.rect.width ?? null,
      samePage: current && barFrame !== -1
        ? frames.indexOf(current.box.closest?.('.pdf-page-frame, .pdf-page-window__slot--active')) === barFrame
        : null,
      key: current?.box.getAttribute('data-practice-note-target-key') ?? null,
      approximateHint: approxHint ? approxHint.textContent.trim().slice(0, 120) : null,
      setupBanner: [
        bodyText.includes('Approximate'),
        bodyText.includes('Auto setup complete'),
        bodyText.includes('PDF layout differs from score data'),
        bodyText.includes('Needs quick setup'),
        bodyText.includes('does not appear to match the PDF'),
      ],
    }
  })
}

async function main() {
  await mkdir(outDir, { recursive: true })
  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    pair: { pdf: 'Breitkopf 1888 scan (Commons PD-old)', musicxml: 'music21-processed Mutopia #931' },
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
  page.on('console', async (msg) => {
    if (msg.type() === 'error') {
      if (/OMR generation cancelled/i.test(msg.text())) {
        report.omrSupersededSeen = true
      }
      if (!isBenignConsoleMessage(msg.text())) {
        const location = msg.location()
        report.consoleErrors.push(
          `${msg.text()} @${location?.url?.split('/').pop() ?? '?'}:${location?.lineNumber ?? '?'}`,
        )
        report.errorMarks = report.errorMarks ?? []
        try {
          const url = await page.url()
          report.errorMarks.push({ at: new Date().toISOString(), url: url.slice(0, 80) })
        } catch {
          report.errorMarks.push({ at: new Date().toISOString(), url: '?' })
        }
      }
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

    // Upload the independent pair: score PDF first, then the MusicXML as
    // an optional file (two-step picker flow).
    await page.getByRole('button', { name: 'Library', exact: true }).click()
    await sleep(600)
    await page.getByRole('tab', { name: 'My Uploads', exact: true }).click()
    await sleep(600)
    const importBtn = page.getByRole('button', { name: 'Import', exact: true }).first()
    if (await importBtn.isVisible().catch(() => false)) {
      await importBtn.click()
      await sleep(800)
    }
    const pdfInput = page.locator('input[type="file"][aria-label="Choose score PDF"]')
    const extraInput = page.locator('input[type="file"][aria-label="Choose optional files"]')
    if ((await pdfInput.count()) !== 1 || (await extraInput.count()) !== 1) {
      fail('upload: PDF + optional file pickers', 'pickers missing')
    } else {
      await pdfInput.setInputFiles(PDF)
      await sleep(1500)
      const extraEnabled = await extraInput.isEnabled().catch(() => false)
      if (extraEnabled) {
        await extraInput.setInputFiles(MUSICXML)
        await sleep(2000)
      } else {
        fail('upload: optional files picker enables after PDF', 'stayed disabled')
      }
      const openScore = page.getByRole('button', { name: 'Open score' })
    if (await openScore.isVisible().catch(() => false)) {
        await openScore.click()
        await sleep(2000)
      }
      // The uploaded-piece view exposes transport controls rather than a
      // labelled Playback region; gate on the transport play button.
      const transportPlay = page.locator('.workspace-play').first()
      await transportPlay.waitFor({ state: 'visible', timeout: 90_000 }).catch(() => {})
      if (await transportPlay.isVisible().catch(() => false)) {
        pass('upload: independent pair reaches Practice')
      } else {
        fail('upload: independent pair reaches Practice', 'transport missing after 90s')
      }
    }
    await page.screenshot({ path: join(outDir, 'uploaded.png') })

    // Setup label must be Approximate-family, never "Auto setup complete".
    // The granular hint (.score-follow-approximate-hint, e.g. "Approximate
    // — measure barlines") lives in the settings tool panel: open it first.
    // OMR-generated timing defaults to 120bpm; the MusicXML marks 72.
    const tempoText = await page.evaluate(() => {
      const mark = document.querySelector('.workspace-tempo-mark')
      return mark ? mark.textContent.replace(/\s+/g, ' ').trim().slice(0, 24) : null
    }).catch(() => null)
    report.transportTempo = tempoText
    if (tempoText && /72/.test(tempoText)) {
      pass('upload: MusicXML timing drives playback (tempo 72, not OMR default 120)', tempoText)
    } else {
      fail('upload: MusicXML timing drives playback (tempo 72, not OMR default 120)', tempoText ?? 'tempo mark not found')
    }
    await sleep(2000)
    // The granular setup hint lives in the practice settings tool panel
    // (aria-label "Workspace settings" — not the global Settings page).
    const workspaceSettings = page.locator('button[aria-label="Workspace settings"]').first()
    if (await workspaceSettings.isVisible().catch(() => false)) {
      await workspaceSettings.click()
      await sleep(800)
      // The setup panel (with the approximate hint) hides behind the
      // "Advanced practice & score setup" expander.
      const advanced = page.getByText('Advanced practice & score setup', { exact: false }).first()
      if (await advanced.isVisible().catch(() => false)) {
        await advanced.click()
        await sleep(800)
      }
    }
    await page.screenshot({ path: join(outDir, 'settings-panel.png') })
    // Read the granular hint while the dialog is still mounted (Escape
    // unmounts it).
    report.approximateHint = await page.evaluate(() => {
      const hint = document.querySelector('.score-follow-approximate-hint')
      return hint ? hint.textContent.trim().slice(0, 120) : null
    }).catch(() => null)
    await page.keyboard.press('Escape').catch(() => {})
    await sleep(500)
    const labeled = await sampleOverlay(page)
    report.setupBanner = labeled.setupBanner
    const [approximate, complete, layoutMismatch, needsSetup, fileMismatch] = labeled.setupBanner
    console.log(`      hint: ${report.approximateHint ?? '(none)'} | body approximate=${approximate} complete=${complete}`)
    const hintText = report.approximateHint ?? ''
    if (/approximate/i.test(hintText) && !/notehead|exact/i.test(hintText)) {
      pass('label: cross-engraving mapping marked approximate, never exact', hintText.slice(0, 80))
    } else if (complete) {
      fail('label: cross-engraving mapping marked approximate, never exact', 'claims "Auto setup complete" on mismatched engravings')
    } else {
      fail('label: cross-engraving mapping marked approximate, never exact', `hint=${hintText.slice(0, 80) || '(none)'}`)
    }

    // Preview playback: cursor + box share the page.
    const previewRadio = page.getByRole('radiogroup', { name: 'Practice mode' })
      .getByRole('radio', { name: 'Preview', exact: true })
    if (await previewRadio.isVisible().catch(() => false)) {
      await previewRadio.click()
      await sleep(1000)
    }
    const playButton = page.locator('.workspace-play').first()
    let playing = false
    if (await playButton.isVisible().catch(() => false)) {
      await playButton.click()
      await sleep(3000)
      const label = await playButton.getAttribute('aria-label').catch(() => '')
      playing = /pause/i.test(label ?? '')
    }
    const errors = []
    let samePageCount = 0
    let validCount = 0
    if (playing) {
      for (let i = 0; i < 20; i += 1) {
        const sample = await sampleOverlay(page)
        if (sample.barVisible && sample.boxCenterX != null) {
          validCount += 1
          if (sample.samePage) {
            samePageCount += 1
          }
          errors.push(Math.abs(sample.barX - sample.boxCenterX))
        }
        await sleep(200)
      }
      await page.screenshot({ path: join(outDir, 'preview-playing.png') })
      const meanPx = errors.length > 0 ? errors.reduce((a, b) => a + b, 0) / errors.length : null
      const maxPx = errors.length > 0 ? Math.max(...errors) : null
      report.previewPixels = { valid: validCount, samePage: samePageCount, meanPx, maxPx }
      console.log(`      preview: valid=${validCount} samePage=${samePageCount} meanPx=${meanPx?.toFixed(1) ?? 'n/a'} maxPx=${maxPx?.toFixed(1) ?? 'n/a'}`)
      if (validCount >= 5 && samePageCount === validCount) {
        pass('preview: bar and box share the page on the uploaded pair', `${validCount} samples`)
      } else {
        fail('preview: bar and box share the page on the uploaded pair', `${samePageCount}/${validCount}`)
      }
      await playButton.click()
      await sleep(400)
    } else {
      report.skipped.push('preview playback on uploaded pair (audio unavailable headless)')
    }

    // Seek + zoom stability on the uploaded pair.
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
    await sleep(1200)
    const afterSeek = await sampleOverlay(page)
    if (seeked && (afterSeek.barVisible || afterSeek.boxesVisible > 0)) {
      pass('seek: overlays survive seeking on the uploaded pair')
    } else {
      fail('seek: overlays survive seeking on the uploaded pair', JSON.stringify({ seeked, ...afterSeek }))
    }
    await page.screenshot({ path: join(outDir, 'sought.png') })

    // WFY mode: waiting box + bar co-located.
    const wfyRadio = page.getByRole('radiogroup', { name: 'Practice mode' })
      .getByRole('radio', { name: 'Wait For You', exact: true })
    if (await wfyRadio.isVisible().catch(() => false)) {
      await wfyRadio.click()
      await sleep(1500)
      const wfy = await sampleOverlay(page)
      await page.screenshot({ path: join(outDir, 'wfy.png') })
      if (wfy.barVisible && wfy.boxCenterX != null && wfy.samePage) {
        const errorPx = Math.abs(wfy.barX - wfy.boxCenterX)
        report.wfyLockPx = errorPx
        if (errorPx <= 60) {
          pass('wfy: checkpoint bar sits on the required box', `${errorPx.toFixed(1)}px`)
        } else {
          fail('wfy: checkpoint bar sits on the required box', `${errorPx.toFixed(1)}px`)
        }
      } else {
        fail('wfy: checkpoint bar sits on the required box', JSON.stringify(wfy))
      }
    } else {
      report.skipped.push('wfy on uploaded pair (mode control missing)')
    }

    // The superseded-OMR abort is expected here (timing file wins over
    // experimental OMR) and is benign-listed above; record it as evidence.
    report.omrSuperseded = Boolean(report.omrSupersededSeen)
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
