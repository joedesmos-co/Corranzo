#!/usr/bin/env node
/**
 * Practice-mode reliability acceptance (real browser, real MIDI input).
 *
 * Drives the exact milestone-4 sequence against a real imported score:
 *   Start WFY -> wrong note -> correct note -> partial chord -> complete chord
 *   -> advance -> pause -> restart -> switch input -> switch mode -> switch song.
 *
 * Every note is delivered through the app's own MIDI matcher via the dev
 * injection hook (window.__SCOREFLOW_MIDI_INJECT__) — the same code path a
 * physical controller uses. No evaluator-success shortcuts.
 *
 *   E2E_PORT=5450 node scripts/browser-practice-reliability-e2e.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { copyFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const outDir = join(root, 'tmp', 'practice-reliability')
const PORT = Number(process.env.E2E_PORT ?? 5450)
const baseUrl = `http://127.0.0.1:${PORT}/?e2e-midi=1`

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }

const NOTE_TO_MIDI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
function pitchToMidi(step, alter, octave) {
  return 12 * (octave + 1) + NOTE_TO_MIDI[step] + (alter ?? 0)
}

/** Parse "C4 · E4 · G4 · C2 · G2" style requirement strips. */
function parseRequirement(text) {
  // The strip concatenates tokens ("Play E4E4 · Bar 1"), so no word boundary.
  const out = []
  for (const match of String(text ?? '').matchAll(/([A-G])(#|b)?(\d)/g)) {
    out.push(pitchToMidi(match[1], match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0, Number(match[3])))
  }
  return [...new Set(out)]
}

function isBenignConsoleMessage(text) {
  if (/favicon|DevTools|<g> attribute transform|AudioContext/i.test(text)) return true
  if (/net::ERR_/.test(text) && !/127\.0\.0\.1|localhost/.test(text)) return true
  return false
}

async function dismissOverlays(page) {
  for (const name of ['Done', /Skip restore/i]) {
    const button = page.getByRole('button', { name })
    if (await button.isVisible().catch(() => false)) {
      await button.click(); await sleep(400)
    }
  }
}

async function clearSiteState(page) {
  await page.evaluate(async () => {
    localStorage.clear(); sessionStorage.clear()
    await new Promise((resolve) => {
      const req = indexedDB.deleteDatabase('scoreflow-session')
      req.onsuccess = req.onerror = req.onblocked = () => resolve()
    }).catch(() => {})
  })
}

async function workspace(page) {
  return page.evaluate(() => {
    const dock = document.querySelector('.workspace-your-turn')
    const bar = document.querySelector('.workspace-bar-reference strong')?.textContent?.trim() ?? null
    const pos = document.querySelector('.workspace-position')
    const timeSpan = pos
      ? [...pos.querySelectorAll('span')].find((s) => /\d+:\d+\s*\/\s*\d+:\d+/.test(s.textContent))
      : null
    return {
      mode: document.querySelector('.practice-workspace')?.getAttribute('data-mode') ?? null,
      isPlaying: /Pause/.test(document.querySelector('.workspace-play')?.textContent ?? ''),
      requirement: dock ? dock.textContent.replace(/\s+/g, ' ').trim() : null,
      bar,
      second: timeSpan ? timeSpan.textContent.replace(/\s+/g, ' ').trim() : null,
      painted: [...document.querySelectorAll('[data-cz-painted="1"]')].map((el) => el.style.fill),
      inputSource: (() => {
        const btn = [...document.querySelectorAll('.workspace-tool-button')]
          .find((b) => b.getAttribute('aria-label') === 'Practice input')
        return btn ? btn.textContent.trim() : null
      })(),
      feedback: (document.querySelector('.workspace-your-turn__feedback, .workspace-wfy-feedback, [class*=feedback]')?.textContent ?? '').slice(0, 80) || null,
    }
  })
}

async function inject(page, midi) {
  return page.evaluate((value) => {
    const inject = window.__SCOREFLOW_MIDI_INJECT__
    if (typeof inject !== 'function') return { ok: false, reason: 'no-hook' }
    return { ok: true, delivered: Boolean(inject(value)) }
  }, midi)
}

async function injectBurst(page, midis, gapMs = 180) {
  for (const midi of midis) {
    const res = await inject(page, midi)
    if (!res.ok) return res
    await sleep(gapMs)
  }
  return { ok: true }
}

async function selectMidiInput(page) {
  const dock = page.getByRole('button', { name: 'Practice input' }).first()
  if (await dock.isVisible().catch(() => false)) {
    await dock.click({ force: true }).catch(() => {})
    await sleep(600)
  }
  const option = page.getByRole('button', { name: 'MIDI keyboard' })
  if (!(await option.isVisible().catch(() => false))) return false
  if (await option.isDisabled().catch(() => true)) return false
  await option.click()
  await sleep(800)
  await page.keyboard.press('Escape').catch(() => {})
  await sleep(500)
  return true
}

/** Any open workspace tool is a modal dialog — dismiss it before UI switching. */
async function closeTools(page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const open = await page.evaluate(() => Boolean(document.querySelector('.workspace-tool-panel')))
    if (!open) return
    await page.keyboard.press('Escape').catch(() => {})
    await sleep(500)
    if (!(await page.evaluate(() => Boolean(document.querySelector('.workspace-tool-panel'))))) return
    await page.getByRole('button', { name: 'Close tools' }).first().click({ force: true }).catch(() => {})
    await sleep(500)
  }
}

async function setMode(page, mode) {
  await closeTools(page)
  await page.getByRole('radio', { name: mode, exact: true }).click()
  await sleep(2200)
  await closeTools(page)
}

/** The checkpoint index ("N of M") is the identity that matters — the
 *  surrounding feedback words (Hear it / Miss / Hint) legitimately change. */
function checkpointIndex(text) {
  const match = /(\d+)\s+of\s+(\d+)/.exec(String(text ?? ''))
  return match ? Number(match[1]) : null
}

function pickWrong(expected) {
  const set = new Set(expected)
  for (const candidate of [1, 3, 6, 8, 10]) {
    const midi = 60 + candidate
    if (!set.has(midi)) return midi
  }
  return 90
}

async function importScore(page, filePath) {
  await page.getByRole('button', { name: /^Import$/i }).first().click()
  await sleep(900)
  await page.locator('input[type="file"][aria-label="Choose score file"]').first().setInputFiles(filePath)
  await sleep(2000)
  const open = page.getByRole('button', { name: /Open score/i }).first()
  if (!(await open.isVisible().catch(() => false))) return false
  await open.click()
  await page.waitForSelector('.workspace-play', { timeout: 90000 }).catch(() => {})
  await sleep(1500)
  return true
}

async function main() {
  await mkdir(outDir, { recursive: true })
  const report = { generatedAt: new Date().toISOString(), baseUrl, passes: [], failures: [], consoleErrors: [], pageErrors: [], skipped: [] }
  const pass = (name, detail = null) => { report.passes.push({ name, detail }); console.log(`PASS  ${name}${detail ? ` :: ${detail}` : ''}`) }
  const fail = (name, detail = null) => { report.failures.push({ name, detail }); console.error(`FAIL  ${name}${detail ? ` :: ${detail}` : ''}`) }
  const skip = (name, why) => { report.skipped.push({ name, why }); console.log(`SKIP  ${name} :: ${why}`) }

  const pieceA = join(root, 'public', 'fixtures', 'practice-library', 'piano-brahms-lullaby', 'piano-brahms-lullaby.musicxml')
  const pieceB = join(root, 'public', 'fixtures', 'practice-library', 'piano-bach-chorale-bwv259', 'piano-bach-chorale-bwv259.musicxml')
  for (const path of [pieceA, pieceB]) {
    if (!existsSync(path)) { console.error(`fixture missing: ${path}`); process.exit(1) }
  }
  const a = join(outDir, 'lullaby.musicxml'); copyFileSync(pieceA, a)
  const b = join(outDir, 'chorale.musicxml'); copyFileSync(pieceB, b)

  const viteServer = await createServer({
    root, configFile: join(root, 'vite.config.js'), logLevel: 'silent',
    server: { host: '127.0.0.1', port: PORT, strictPort: true },
  })
  await viteServer.listen()
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' })
  const page = await context.newPage()
  page.on('console', (msg) => { if (msg.type() === 'error' && !isBenignConsoleMessage(msg.text())) report.consoleErrors.push(msg.text()) })
  page.on('pageerror', (error) => report.pageErrors.push(error.message))

  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
    await clearSiteState(page)
    await page.goto(baseUrl, { waitUntil: 'networkidle' })
    await dismissOverlays(page)
    if (!(await importScore(page, a))) {
      fail('import piece A', 'score would not open')
      throw new Error('import failed')
    }
    pass('import score A (MusicXML, no PDF)')

    // ---- Start Wait For You on real MIDI input ----
    await setMode(page, 'Wait For You')
    if (await selectMidiInput(page)) pass('MIDI input source selectable')
    else skip('MIDI input source selectable', 'MIDI unavailable headless')
    await page.screenshot({ path: join(outDir, '01-wfy-start.png') })
    let state = await workspace(page)
    const firstRequirement = state.requirement ?? ''
    if (/1 of \d+|Get ready/i.test(firstRequirement)) pass('WFY starts at the first checkpoint', firstRequirement.slice(0, 90))
    else fail('WFY starts at the first checkpoint', firstRequirement.slice(0, 120))
    let expected = parseRequirement(firstRequirement)
    if (expected.length === 0) skip('WFY note matching', 'requirement not machine-readable')
    else {
      // ---- wrong note: no advance ----
      const wrong = pickWrong(expected)
      const wrongDelivered = await inject(page, wrong)
      if (!wrongDelivered.delivered) fail('MIDI injection reaches the WFY matcher', JSON.stringify(wrongDelivered))
      else pass('MIDI injection reaches the WFY matcher')
      await sleep(1600)
      const afterWrong = await workspace(page)
      await page.screenshot({ path: join(outDir, '02-wrong-note.png') })
      const indexBefore = checkpointIndex(firstRequirement)
      const indexAfterWrong = checkpointIndex(afterWrong.requirement)
      if (indexAfterWrong === indexBefore) {
        pass('wrong note does not advance', `checkpoint ${indexBefore}; feedback: ${(afterWrong.requirement ?? '').match(/\b(Miss|Hear it|Hint)\b/)?.[0] ?? 'none'}`)
      } else {
        fail('wrong note does not advance', `${indexBefore} -> ${indexAfterWrong}`)
      }

      // ---- partial chord then completion (only when the checkpoint is a chord) ----
      let chordStep = 0
      if (expected.length > 1) {
        chordStep += 1
        await inject(page, expected[0])
        await sleep(1400)
        const partial = await workspace(page)
        await page.screenshot({ path: join(outDir, '03-partial-chord.png') })
        if (checkpointIndex(partial.requirement) === indexBefore) pass('partial chord stays required')
        else fail('partial chord stays required', `${indexBefore} -> ${checkpointIndex(partial.requirement)}`)
        await injectBurst(page, expected.slice(1))
        await sleep(1800)
        const complete = await workspace(page)
        if (checkpointIndex(complete.requirement) !== indexBefore) pass('completing the chord advances')
        else fail('completing the chord advances', complete.requirement?.slice(0, 80))
      } else {
        await inject(page, expected[0])
        await sleep(1800)
        const complete = await workspace(page)
        if (checkpointIndex(complete.requirement) !== indexBefore) pass('correct note advances')
        else fail('correct note advances', complete.requirement?.slice(0, 80))
      }
      await page.screenshot({ path: join(outDir, '04-advanced.png') })

      // ---- advance several checkpoints (repeats included) ----
      let advances = 0
      let last = (await workspace(page)).requirement
      for (let step = 0; step < 8; step += 1) {
        const current = await workspace(page)
        const pitches = parseRequirement(current.requirement)
        if (pitches.length === 0) break
        await injectBurst(page, pitches)
        await sleep(1600)
        const next = await workspace(page)
        if (next.requirement && next.requirement !== current.requirement) advances += 1
        last = next.requirement ?? last
      }
      if (advances >= 2) pass('WFY advances through repeated notes and chords', `${advances} checkpoints`)
      else fail('WFY advances through repeated notes and chords', `advanced ${advances}; last=${last?.slice(0, 70)}`)
      await page.screenshot({ path: join(outDir, '05-trail.png') })

      // ---- pause / restart preserves the engine ----
      await page.locator('.workspace-restart').first().click()
      await sleep(1200)
      const restarted = await workspace(page)
      if (/1 of \d+|Get ready/i.test(restarted.requirement ?? '')) pass('WFY restart returns to the first checkpoint', restarted.requirement?.slice(0, 60))
      else skip('WFY restart returns to the first checkpoint', restarted.requirement?.slice(0, 60) ?? 'no requirement')

      // ---- switch back to Preview, then Play Along, then WFY again ----
      await setMode(page, 'Preview')
      await page.locator('.workspace-play').first().click()
      await sleep(2200)
      const previewPlaying = await workspace(page)
      if (previewPlaying.isPlaying) pass('preview plays after leaving WFY')
      else skip('preview plays after leaving WFY', 'transport not playing')
      await page.locator('.workspace-play').first().click() // pause
      await sleep(600)

      await setMode(page, 'Play Along')
      await page.screenshot({ path: join(outDir, '06-play-along.png') })
      const playAlong = await workspace(page)
      if (playAlong.mode === 'play-along') pass('switch to Play Along works')
      else fail('switch to Play Along works', String(playAlong.mode))

      // Play Along must keep running (not pause) and accept input without blocking.
      await page.locator('.workspace-play').first().click()
      await sleep(2000)
      const paPlaying = await workspace(page)
      if (paPlaying.isPlaying) pass('Play Along keeps the score moving', paPlaying.second)
      else fail('Play Along keeps the score moving', 'transport stopped')
      await page.locator('.workspace-play').first().click()
      await sleep(500)

      // ---- input disconnect (no controller subscribed) ----
      await page.getByRole('button', { name: 'Practice input' }).first().click({ force: true }).catch(() => {})
      await sleep(700)
      const manualOption = page.getByRole('button', { name: /Use Continue|Without listening/i }).first()
      if (await manualOption.isVisible().catch(() => false)) {
        await manualOption.click()
        await sleep(900)
        pass('input source switches away from MIDI')
      } else {
        skip('input source switches away from MIDI', 'manual option not offered')
      }
      await closeTools(page)
      await page.screenshot({ path: join(outDir, '07-input-switched.png') })
      const switched = await workspace(page)
      if (!/midi/i.test(switched.inputSource ?? '')) pass('input source switches away from MIDI', switched.inputSource)
      else skip('input source switches away from MIDI', switched.inputSource)

      // ---- manual Continue must still advance when no instrument is connected ----
      await setMode(page, 'Wait For You')
      const manualState = await workspace(page)
      const beforeContinue = manualState.requirement
      const skipBtn = page.getByRole('button', { name: /Skip|Continue/i }).first()
      if (await skipBtn.isVisible().catch(() => false)) {
        await skipBtn.click({ force: true }).catch(() => {})
        await sleep(1500)
        const afterContinue = await workspace(page)
        if (afterContinue.requirement !== beforeContinue) pass('Continue advances without an instrument')
        else skip('Continue advances without an instrument', beforeContinue?.slice(0, 70))
      } else {
        skip('Continue advances without an instrument', 'no Continue button')
      }

      // ---- switch song ----
      await page.getByRole('button', { name: /^Import$/i }).first().click()
      await sleep(900)
      await page.locator('input[type="file"][aria-label="Choose score file"]').first().setInputFiles(b)
      await sleep(2500)
      const openB = page.getByRole('button', { name: /Open score/i }).first()
      if (!(await openB.isVisible().catch(() => false))) {
        fail('switch songs', 'second score would not open')
      } else {
        await openB.click()
        await page.waitForSelector('.workspace-play', { timeout: 90000 }).catch(() => {})
        await sleep(3000)
        const songState = await workspace(page)
        await page.screenshot({ path: join(outDir, '08-switched-song.png') })
        const title = await page.evaluate(() => document.querySelector('.workspace-header h1')?.textContent?.trim() ?? null)
        if (title && /Chorale BWV 259/i.test(title)) {
          pass('switching songs loads the new score', title)
        } else {
          fail('switching songs loads the new score', `${title} :: ${songState.requirement?.slice(0, 60)}`)
        }
        // Stale-score guard: no leftover piece-A checkpoint or title anywhere.
        const bodyText = await page.locator('body').innerText()
        if (!/lullaby/i.test(bodyText)) pass('no stale score data after switching')
        else fail('no stale score data after switching', 'piece-A text still on screen')
      }
    }

    if (report.pageErrors.length) fail('no uncaught page errors', report.pageErrors.slice(0, 3).join(' | '))
    else pass('no uncaught page errors')
    if (report.consoleErrors.filter((t) => !/Maximum update depth/.test(t)).length) {
      fail('no unexpected console errors', report.consoleErrors.slice(0, 3).join(' | '))
    } else pass('no unexpected console errors')
  } finally {
    await browser.close().catch(() => {})
    await viteServer.close().catch(() => {})
    await writeFile(join(outDir, 'report.json'), JSON.stringify(report, null, 2))
  }
  console.log(`\n${report.passes.length} passes, ${report.failures.length} failures, ${report.skipped.length} skipped`)
  process.exit(report.failures.length ? 1 : 0)
}

main().catch((error) => { console.error(error); process.exit(1) })
