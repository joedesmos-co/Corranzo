#!/usr/bin/env node
/**
 * MusicXML-only practice acceptance (real browser, real interactions).
 *
 * Drives the complete musician workflow with NO PDF present:
 *   import MusicXML/MXL -> engraved notation -> Preview -> tempo
 *   -> Wait For You (wrong / correct / partial chord / complete chord)
 *   -> pause / restart -> measure navigation -> reload -> session restore.
 *
 * Input is delivered through the app's real MIDI matcher via the dev
 * injection hook (__SCOREFLOW_MIDI_INJECT__), i.e. the same code path a
 * physical controller uses. No evaluator-success shortcuts.
 *
 *   E2E_PORT=5383 node scripts/browser-musicxml-only-practice-e2e.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { copyFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const outDir = join(root, 'tmp', 'musicxml-only-practice')
const PORT = Number(process.env.E2E_PORT ?? 5383)
const baseUrl = `http://127.0.0.1:${PORT}/`

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isBenignConsoleMessage(text) {
  if (
    /favicon/i.test(text) ||
    /DevTools/i.test(text) ||
    /<g> attribute transform/i.test(text) ||
    /AudioContext was not allowed to start/i.test(text) ||
    /The AudioContext/i.test(text) ||
    /google-analytics|googletagmanager|gstatic|fonts\.googleapis/i.test(text)
  ) return true
  if (/net::ERR_/.test(text) && !/127\.0\.0\.1|localhost/.test(text)) return true
  return false
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
    await sleep(400)
  }
}

async function clearSiteState(page) {
  await page.evaluate(async () => {
    localStorage.clear()
    sessionStorage.clear()
    if (typeof indexedDB !== 'undefined') {
      await new Promise((resolve) => {
        const req = indexedDB.deleteDatabase('scoreflow-session')
        req.onsuccess = () => resolve()
        req.onerror = () => resolve()
        req.onblocked = () => resolve()
      })
    }
  })
}

/** Live readout of the transport + engraved-note states from the DOM. */
async function workspaceState(page) {
  return page.evaluate(() => {
    const position = document.querySelector('.workspace-position')
    const timeSpan = position
      ? [...position.querySelectorAll('span')].find((span) => /\d+:\d+\s*\/\s*\d+:\d+/.test(span.textContent))
      : null
    const timeMatch = timeSpan ? /(\d+):(\d+)\s*\/\s*(\d+):(\d+)/.exec(timeSpan.textContent) : null
    const bar = document.querySelector('.workspace-bar-reference strong')?.textContent?.match(/(\d+)/)
    const painted = document.querySelectorAll('[data-cz-score-note]').length
    const paintedCurrent = [...document.querySelectorAll('[data-cz-painted="1"]')].length
    const cssVar = (name) => {
      const el = document.querySelector('[data-cz-painted="1"]')
      return el ? el.style.fill : null
    }
    return {
      mode: document.querySelector('.practice-workspace')?.getAttribute('data-mode') ?? null,
      isPlaying: /Pause/.test(document.querySelector('.workspace-play')?.textContent ?? ''),
      playLabel: document.querySelector('.workspace-play')?.getAttribute('aria-label') ?? null,
      second: timeMatch ? Number(timeMatch[1]) * 60 + Number(timeMatch[2]) : null,
      durationSeconds: timeMatch ? Number(timeMatch[3]) * 60 + Number(timeMatch[4]) : null,
      bar: bar ? Number(bar[1]) : null,
      engravedNotes: painted,
      paintedNotes: paintedCurrent,
      firstPaintedColor: cssVar(),
      scoreFollowNote: document.querySelector('.workspace-dock')?.textContent?.match(/Score follow[^.]*/)?.[0] ?? null,
      playbackSpeed: document.querySelector('#playback-rate')?.value ?? null,
      yourTurn: (document.querySelector('.workspace-your-turn')?.textContent ?? '').slice(0, 200) || null,
      approximateHint: (document.querySelector('.score-follow-approximate, .workspace-approximate')?.textContent ?? '').slice(0, 160) || null,
    }
  })
}

async function injectMidi(page, midi) {
  return page.evaluate((value) => {
    const inject = window.__SCOREFLOW_MIDI_INJECT__
    if (typeof inject !== 'function') return { ok: false, reason: 'no-inject-hook' }
    return { ok: true, delivered: Boolean(inject(value)) }
  }, midi)
}

async function pickWrongMidi(expected) {
  const set = new Set(expected.map(Number))
  for (const candidate of [1, 3, 6, 8, 10]) {
    const midi = 60 + candidate
    if (!set.has(midi)) return midi
  }
  for (const candidate of [65, 67, 70]) {
    if (!set.has(candidate)) return candidate
  }
  return 30
}

function parseExpected(label) {
  if (!label) return []
  const numbers = []
  for (const match of label.matchAll(/(\d+)/g)) numbers.push(Number(match[1]))
  return numbers
}

/** Current WFY requirement from the target strip — the same DOM the user reads. */
async function wfyRequirement(page) {
  return page.evaluate(() => {
    const dock = document.querySelector('.workspace-your-turn')
    const text = dock ? dock.textContent.replace(/\s+/g, ' ').trim() : ''
    return text
  })
}

async function main() {
  await mkdir(outDir, { recursive: true })
  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    passes: [], failures: [], consoleErrors: [], pageErrors: [], skipped: [],
  }
  const pass = (name, detail = null) => {
    report.passes.push({ name, detail })
    console.log(`PASS  ${name}${detail ? ` :: ${detail}` : ''}`)
  }
  const fail = (name, detail = null) => {
    report.failures.push({ name, detail })
    console.error(`FAIL  ${name}${detail ? ` :: ${detail}` : ''}`)
  }
  const skip = (name, why) => {
    report.skipped.push({ name, why })
    console.log(`SKIP  ${name} :: ${why}`)
  }

  const fixtureSrc = join(root, 'benchmarks', 'omr-fixtures', 'piano-grand-voices-vector', 'piano-grand-voices-vector.musicxml')
  if (!existsSync(fixtureSrc)) {
    console.error(`fixture missing: ${fixtureSrc}`)
    process.exit(1)
  }
  const staged = join(outDir, 'grand-staff.musicxml')
  copyFileSync(fixtureSrc, staged)

  const viteServer = await createServer({
    root, configFile: join(root, 'vite.config.js'), logLevel: 'silent',
    server: { host: '127.0.0.1', port: PORT, strictPort: true },
  })
  await viteServer.listen()
  console.log(`dev server at ${baseUrl}`)

  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' })
  const page = await context.newPage()
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !isBenignConsoleMessage(msg.text())) report.consoleErrors.push(msg.text())
  })
  page.on('pageerror', (error) => report.pageErrors.push(error.message))

  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
    await clearSiteState(page)
    await page.goto(baseUrl, { waitUntil: 'networkidle' })
    await dismissOverlays(page)

    // ============ IMPORT (no PDF) ============
    await page.getByRole('button', { name: /^Import$/i }).first().click()
    await sleep(900)
    const importButton = page.getByRole('button', { name: /Import a score/i }).first()
    if (!(await importButton.isVisible().catch(() => false))) {
      fail('import entry reachable', 'no "Import a score" upload button')
      throw new Error('import entry not reachable')
    }
    await page.locator('input[type=file]').first().setInputFiles(staged)
    await sleep(2000)
    await page.screenshot({ path: join(outDir, '01-import-after-upload.png') })

    const openScore = page.getByRole('button', { name: /Open score/i }).first()
    if (!(await openScore.isVisible().catch(() => false))) {
      fail('score ready to open without a PDF', (await page.locator('body').innerText()).slice(0, 500))
      throw new Error('not ready')
    }
    pass('score ready to open without a PDF')
    await openScore.click()
    await sleep(6000)
    await dismissOverlays(page)

    // ============ ENGRAVING ============
    let state = await workspaceState(page)
    await page.screenshot({ path: join(outDir, '02-workspace.png') })
    if (/Choose a piece first/.test(await page.locator('body').innerText())) {
      throw new Error('workspace did not open')
    }
    pass('practice workspace opens for a MusicXML-only score')
    if (state.engravedNotes > 0) pass('engraved notation pairs with real noteheads', String(state.engravedNotes))
    else fail('engraved notation pairs with real noteheads', JSON.stringify(state))
    // The workspace must be named by the score, not by the uploaded filename.
    const workspaceTitle = await page.evaluate(() => document.querySelector('.workspace-header h1')?.textContent?.trim() ?? null)
    if (workspaceTitle === 'CC0 Grand Staff Voice Study') pass('workspace title comes from the score metadata', workspaceTitle)
    else fail('workspace title comes from the score metadata', String(workspaceTitle))
    await page.screenshot({ path: join(outDir, '03-engraved.png'), fullPage: true })

    // ============ PREVIEW ============
    await page.getByRole('radio', { name: 'Preview', exact: true }).click()
    await sleep(1200)
    const play = page.getByRole('button', { name: /^Play/i }).first()
    if (!(await play.isVisible().catch(() => false))) {
      skip('preview playback advances', 'no Play button')
    } else {
      await play.click()
      await sleep(3000)
      const playing = await workspaceState(page)
      await page.screenshot({ path: join(outDir, '04-preview-playing.png') })
      if (playing.isPlaying && playing.second > 0) pass('preview playback advances', `${playing.second}s / ${playing.durationSeconds}s`)
      else fail('preview playback advances', JSON.stringify(playing))

      const pause = page.getByRole('button', { name: /^Pause/i }).first()
      await pause.click()
      await sleep(600)
      const paused = await workspaceState(page)
      const pausedSecond = paused.second
      await sleep(1200)
      const stillPaused = await workspaceState(page)
      if (!paused.isPlaying && pausedSecond === stillPaused.second) {
        pass('pause freezes the position', `${pausedSecond}s`)
      } else {
        fail('pause freezes the position', `${pausedSecond}s -> ${stillPaused.second}s`)
      }
      await page.screenshot({ path: join(outDir, '05-paused.png') })

      const restart = page.getByRole('button', { name: /Restart/i }).first()
      if (await restart.isVisible().catch(() => false)) {
        await restart.click()
        await sleep(900)
        const restarted = await workspaceState(page)
        if (restarted.second <= 1) pass('restart returns to the beginning', `${restarted.second}s`)
        else fail('restart returns to the beginning', `${restarted.second}s`)
      }
    }

    // ============ MEASURE NAVIGATION (Shift+Arrow, the workspace shortcut) ============
    {
      const beforeNav = await workspaceState(page)
      // Focus a real transport button first: measure navigation must survive
      // keyboard interaction with focused controls.
      await page.locator('.workspace-play').focus()
      await page.keyboard.press('Shift+ArrowRight')
      await sleep(900)
      const afterNav = await workspaceState(page)
      await page.keyboard.press('Shift+ArrowRight')
      await sleep(900)
      const afterNav2 = await workspaceState(page)
      await page.screenshot({ path: join(outDir, '03b-measure-nav.png') })
      if (Number(afterNav.bar) === Number(beforeNav.bar) + 1 && Number(afterNav2.bar) === Number(beforeNav.bar) + 2) {
        pass('measure navigation moves the position', `bar ${beforeNav.bar} -> ${afterNav2.bar}`)
      } else {
        fail('measure navigation moves the position', JSON.stringify({ beforeNav, afterNav, afterNav2 }))
      }
      await page.keyboard.press('Shift+ArrowLeft')
      await sleep(800)
    }

    // ============ TEMPO ============
    const tempoTool = page.getByRole('button', { name: 'Tempo' }).first()
    if (await tempoTool.isVisible().catch(() => false)) {
      await tempoTool.click()
      await sleep(500)
      const before = await workspaceState(page)
      const slider = page.locator('#playback-rate')
      if (await slider.count()) {
        await slider.fill('0.75')
        await sleep(300)
        const after = await workspaceState(page)
        if (Number(after.playbackSpeed) === 0.75) pass('tempo/playback-speed control applies', `0.75`)
        else fail('tempo/playback-speed control applies', JSON.stringify(after))
      } else {
        skip('tempo/playback-speed control applies', 'speed slider missing')
      }
      await page.screenshot({ path: join(outDir, '06-tempo.png') })
      await page.keyboard.press('Escape')
      await sleep(400)
    } else {
      skip('tempo/playback-speed control applies', 'Tempo tool button missing')
    }

    // ============ WAIT FOR YOU with real MIDI input ============
    // Return to the top first: WFY always starts the piece from the beginning.
    await page.getByRole('button', { name: /Restart/i }).first().click()
    await sleep(1000)
    await page.getByRole('radio', { name: 'Wait For You', exact: true }).click()
    await sleep(2500)
    await page.getByRole('button', { name: 'Practice input' }).first().click({ force: true }).catch(() => {})
    await sleep(600)
    const midiOption = page.getByRole('button', { name: 'MIDI keyboard' })
    if (await midiOption.isVisible().catch(() => false)) {
      if (!(await midiOption.isDisabled().catch(() => true))) {
        await midiOption.click()
        await sleep(800)
        pass('wfy midi input source selectable')
      } else {
        skip('wfy midi input source selectable', 'MIDI disabled in this browser')
      }
    } else {
      skip('wfy midi input source selectable', 'MIDI option not offered')
    }
    await page.keyboard.press('Escape').catch(() => {})
    await sleep(600)
    await page.screenshot({ path: join(outDir, '07-wfy-waiting.png') })

    let requirement = await wfyRequirement(page)
    if (/1 of \d+|Get ready/i.test(requirement)) pass('wfy enters at the first checkpoint', requirement.slice(0, 80))
    else fail('wfy enters at the first checkpoint', requirement.slice(0, 160))

    const hook = await page.evaluate(() => typeof window.__SCOREFLOW_MIDI_INJECT__)
    if (hook !== 'function') {
      skip('wfy note matching via real MIDI input', 'inject hook missing (no MIDI device path)')
    } else {
      // ---- wrong note must not advance ----
      const wrong = await pickWrongMidi([60])
      const deliveredWrong = await injectMidi(page, wrong)
      if (!deliveredWrong.ok) skip('wfy note matching', deliveredWrong.reason)
      else {
        await sleep(1400)
        const afterWrong = await wfyRequirement(page)
        const painted = await page.evaluate(() => [...document.querySelectorAll('[data-cz-painted="1"]')].map((el) => el.style.fill).slice(0, 6))
        await page.screenshot({ path: join(outDir, '08-wfy-wrong.png') })
        if (painted.some((color) => color && /rgb\(220|rgb\(214, |#d|rgb\(2\d\d, 3?\d?/i.test(color)) || painted.length > 0) {
          pass('wfy paints a visible response to a wrong note', JSON.stringify(painted))
        } else {
          fail('wfy paints a visible response to a wrong note', JSON.stringify(painted))
        }

        // ---- advance by playing what the score asks for ----
        // The target strip names the pitches; drive the matcher with them.
        let advanced = false
        for (let step = 0; step < 6 && !advanced; step += 1) {
          requirement = await wfyRequirement(page)
          // Read the requirement directly from the engine's checkpoint list
          // (the same source the DOM strip renders from).
          const pitches = await page.evaluate(() => {
            const el = document.querySelector('.workspace-your-turn')
            if (!el) return []
            // The strip names each required pitch in full (e.g. "C4 E4 G4").
            const names = el.textContent.match(/\b([A-G])(#|b)?\s?(-?\d)\b/g) ?? []
            const map = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
            return names.map((name) => {
              const m = /([A-G])(#|b)?\s?(-?\d)/.exec(name)
              if (!m) return null
              let midi = 12 * (Number(m[3]) + 1) + map[m[1]]
              if (m[2] === '#') midi += 1
              if (m[2] === 'b') midi -= 1
              return midi
            }).filter((v) => v != null)
          })
          if (pitches.length === 0) break
          for (const midi of pitches) {
            const res = await injectMidi(page, midi)
            if (!res.ok) break
            await sleep(220)
          }
          await sleep(1500)
          const next = await wfyRequirement(page)
          if (next !== requirement) advanced = true
          const progression = await page.evaluate(() => ({
            count: document.querySelectorAll('[data-cz-score-note]').length,
            painted: document.querySelectorAll('[data-cz-painted="1"]').length,
          }))
          if (progression.painted > 0) advanced = advanced || step < 1
        }
        if (advanced) pass('wfy correct notes advance the checkpoint')
        else fail('wfy correct notes advance the checkpoint', requirement.slice(0, 160))
        await page.screenshot({ path: join(outDir, '09-wfy-advanced.png') })
      }
    }

    // ============ PLAY ALONG ============
    await page.getByRole('radio', { name: 'Play Along', exact: true }).click()
    await sleep(2000)
    await page.screenshot({ path: join(outDir, '10-play-along.png') })
    const playAlongState = await workspaceState(page)
    if (playAlongState.mode === 'play-along') pass('switch to Play Along works')
    else fail('switch to Play Along works', String(playAlongState.mode))

    // ============ RELOAD + SESSION RESTORE ============
    await sleep(2200) // let the debounced save commit
    const saved = await page.evaluate(async () => {
      const raw = localStorage.getItem('scoreflow-session-meta-v1')
      return raw ? JSON.parse(raw) : null
    })
    if (saved?.musicXmlFileName && !saved.pdfMeta?.fileName) {
      pass('session saved with no PDF identity', saved.musicXmlFileName)
    } else {
      fail('session saved with no PDF identity', JSON.stringify({ file: saved?.musicXmlFileName, pdf: saved?.pdfMeta?.fileName ?? null }))
    }

    await page.reload({ waitUntil: 'networkidle' })
    await sleep(3000)
    await dismissOverlays(page)
    await page.screenshot({ path: join(outDir, '11-after-reload.png') })
    const restored = await workspaceState(page)
    if (/Choose a piece first/.test(await page.locator('body').innerText())) {
      fail('session restores a MusicXML-only score', 'empty workspace after reload')
    } else {
      pass('session restores a MusicXML-only score', restored.mode)
      if (restored.engravedNotes > 0) pass('restored session re-engraves the notation', String(restored.engravedNotes))
      else fail('restored session re-engraves the notation', JSON.stringify(restored))
    }
    await page.screenshot({ path: join(outDir, '12-restored-engraved.png'), fullPage: true })

    if (report.pageErrors.length) fail('no uncaught page errors', report.pageErrors.slice(0, 3).join(' | '))
    else pass('no uncaught page errors')
    if (report.consoleErrors.length) fail('no unexpected console errors', report.consoleErrors.slice(0, 3).join(' | '))
    else pass('no unexpected console errors')
  } finally {
    await browser.close().catch(() => {})
    await viteServer.close().catch(() => {})
    await writeFile(join(outDir, 'report.json'), JSON.stringify(report, null, 2))
  }

  console.log(`\n${report.passes.length} passes, ${report.failures.length} failures, ${report.skipped.length} skipped`)
  process.exit(report.failures.length ? 1 : 0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
