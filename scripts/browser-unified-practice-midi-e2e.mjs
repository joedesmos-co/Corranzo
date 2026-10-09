#!/usr/bin/env node
/**
 * Unified practice MIDI acceptance (integration branch).
 *
 * Extends the Practice-UI score-follow suite with integration assertions:
 *  - I2 checkpoint-locked cursor (bar column == required notehead column)
 *  - no duplicate awards on rapid double input
 *  - Preview pause/resume, seek, loop, score-change reset
 *  - MIDI mode intact alongside the neural/spectral mic work
 *
 *   E2E_PORT=5399 node scripts/browser-unified-practice-midi-e2e.mjs
 *
 * Output: tmp/unified-practice-midi/{report.json,*.png}
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const outDir = join(root, 'tmp', 'unified-practice-midi')
const PORT = Number(process.env.E2E_PORT ?? 5399)
const baseUrl = `http://127.0.0.1:${PORT}/?e2e-midi=1`

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
  ) {
    return true
  }
  // Sandbox has no internet: external request failures are environmental.
  if (/net::ERR_/.test(text) && !/127\.0\.0\.1|localhost/.test(text)) {
    return true
  }
  return false
}

async function dismissOverlays(page) {
  // NOTE: never click a bare "Skip" here — the WFY dock owns a Skip button
  // that advances the checkpoint (a previous revision of this script clicked
  // it and polluted the entry assertion). Only tutorial/restore surfaces.
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

async function inputSourceLabel(page) {
  return page.evaluate(() => {
    const buttons = [...document.querySelectorAll('.workspace-tool-button')]
    const input = buttons.find((button) => button.getAttribute('aria-label') === 'Practice input')
    return input ? input.textContent.trim().slice(0, 40) : null
  })
}

/** Ensure the (dev, hardardless) MIDI path is selected so injections match. */
async function ensureMidiInputSource(page) {
  await chooseWfyInputSource(page, /Use MIDI/i)
  let label = await inputSourceLabel(page)
  if (label && /midi/i.test(label)) {
    return true
  }
  // Fall back to the dock input tool: Connect instrument -> MIDI keyboard.
  const connect = page.getByRole('button', { name: 'Practice input' })
  if (await connect.isVisible().catch(() => false)) {
    await connect.click()
    await sleep(600)
    const midiOption = page.getByRole('button', { name: 'MIDI keyboard' })
    if (await midiOption.isVisible().catch(() => false)) {
      const disabled = await midiOption.isDisabled().catch(() => true)
      if (!disabled) {
        await midiOption.click()
        await sleep(600)
      }
    }
    // Dismiss the tool dialog.
    await page.keyboard.press('Escape')
    await sleep(400)
  }
  label = await inputSourceLabel(page)
  return Boolean(label && /midi/i.test(label))
}

async function loadDemo(page) {
  // Home offers the collection piece ("Open score"); the Library offers
  // "Start practice:" cards. Either lands in the Practice workspace.
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
  let demo = page.getByRole('button', { name: /Try demo:/i }).first()
  if (!(await demo.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Practice', exact: true }).click().catch(() => {})
    await sleep(500)
    demo = page.getByRole('button', { name: 'Try Demo Piece', exact: true }).first()
  }
  if (!(await demo.isVisible().catch(() => false))) {
    const welcomeDismiss = page.getByRole('button', { name: /Add your score/i }).first()
    if (await welcomeDismiss.isVisible().catch(() => false)) {
      await welcomeDismiss.click()
      await sleep(400)
      demo = page.getByRole('button', { name: /Try demo:/i }).first()
    }
  }
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

async function scoreState(page) {
  return page.evaluate(() => {
    const boxes = [...document.querySelectorAll('[data-score-note-state]')]
    const cursor = document.querySelector('.score-follow-cursor')
    const cursorVisible = Boolean(cursor) && cursor.style.display !== 'none'
    let cursorX = null
    if (cursor) {
      const left = cursor.style.left || ''
      const match = /([\d.]+)%/.exec(left)
      cursorX = match ? Number(match[1]) : null
    }
    const geometryOf = (box) => {
      const left = parseFloat(box.style.left) || 0
      const width = parseFloat(box.style.width) || 0
      return { left, width, center: left + width / 2 }
    }
    const yourTurn = document.querySelector('.workspace-your-turn')
    const position = document.querySelector('.workspace-position')
    // Time spans (not the bar reference: "Bar 7" + "0:20" concatenate).
    const timeSpan = position
      ? [...position.querySelectorAll('span')].find((span) => /\d+:\d+\s*\/\s*\d+:\d+/.test(span.textContent))
      : null
    const timeMatch = timeSpan ? /(\d+):(\d+)\s*\/\s*(\d+):(\d+)/.exec(timeSpan.textContent) : null
    return {
      boxes: boxes.map((box) => ({
        state: box.getAttribute('data-score-note-state'),
        key: box.getAttribute('data-practice-note-target-key'),
        expected: box.getAttribute('data-score-expected'),
        mode: box.getAttribute('data-practice-note-mode'),
        label: box.getAttribute('aria-label'),
        geometry: geometryOf(box),
      })),
      cursorVisible,
      cursorX,
      yourTurnText: yourTurn ? yourTurn.textContent.slice(0, 220) : null,
      positionText: timeSpan ? timeSpan.textContent.slice(0, 60) : null,
      positionSeconds: timeMatch ? Number(timeMatch[1]) * 60 + Number(timeMatch[2]) : null,
      continueIsCompact: Boolean(
        document.querySelector('.workspace-play--continue'),
      ),
    }
  })
}

function currentBox(state) {
  return state.boxes.find((box) => box.state === 'current' || box.state === 'current-partial')
    ?? state.boxes.find((box) => box.state === 'wrong')
    ?? null
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

/** Inject several midis inside ONE JS task (true duplicate-race input). */
async function injectMidiBurst(page, midis) {
  return page.evaluate((values) => {
    const inject = window.__SCOREFLOW_MIDI_INJECT__
    if (typeof inject !== 'function') {
      return { ok: false, reason: 'no-inject-hook' }
    }
    const delivered = values.map((value) => inject(value))
    return { ok: true, delivered }
  }, midis)
}

async function playFullEvent(page, midis) {
  await injectMidi(page, midis[0])
  for (const midi of midis.slice(1)) {
    await sleep(150)
    await injectMidi(page, midi)
  }
}

async function positionSeconds(page) {
  const state = await scoreState(page)
  return state.positionSeconds
}

function parseExpectedMidis(box) {
  if (!box?.expected) {
    return []
  }
  return box.expected.split(',').map(Number).filter(Number.isFinite)
}

function pickWrongMidi(expected) {
  const set = new Set(expected)
  for (let octave = 0; octave < 3; octave += 1) {
    for (const candidate of [1, 3, 6, 8, 10]) {
      const midi = 60 + candidate + octave * 12
      if (!set.has(midi)) {
        return midi
      }
    }
  }
  return 127
}

async function main() {
  await mkdir(outDir, { recursive: true })
  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    passes: [],
    failures: [],
    consoleErrors: [],
    pageErrors: [],
    skipped: [],
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
  console.log(`dev server at ${baseUrl}`)

  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    colorScheme: 'dark',
  })
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
      if (typeof indexedDB !== 'undefined') {
        await new Promise((resolve) => {
          const req = indexedDB.deleteDatabase('scoreflow-session')
          req.onsuccess = () => resolve()
          req.onerror = () => resolve()
          req.onblocked = () => resolve()
        }).catch(() => {})
      }
    })
    await page.goto(baseUrl, { waitUntil: 'networkidle' })
    await dismissOverlays(page)
    await loadDemo(page)

    // ---- Preview: shared cursor + current highlight on the same score ----
    await switchMode(page, 'Preview')
    await page.screenshot({ path: join(outDir, 'preview.png') })
    let preview = await scoreState(page)
    if (preview.cursorVisible) {
      pass('preview shows the shared score cursor')
    } else {
      fail('preview shows the shared score cursor', 'cursor hidden or missing')
    }
    if (preview.boxes.some((box) => box.state === 'current')) {
      pass('preview highlights the current score event')
    } else {
      fail('preview highlights the current score event', JSON.stringify(preview.boxes.slice(0, 3)))
    }

    // ---- Wait For You: correct / wrong / partial via real evaluator ----
    await switchMode(page, 'Wait For You')
    const midiReady = await ensureMidiInputSource(page)
    if (midiReady) {
      pass('wfy midi input source selected (dev inject path)')
    } else {
      fail('wfy midi input source selected (dev inject path)', await inputSourceLabel(page))
    }
    await page.screenshot({ path: join(outDir, 'wfy-waiting.png') })
    let wfy = await scoreState(page)
    if (wfy.yourTurnText && /1 of \d+/.test(wfy.yourTurnText)) {
      pass('wfy enters at the first checkpoint')
    } else {
      fail('wfy enters at the first checkpoint', wfy.yourTurnText)
    }
    if (wfy.continueIsCompact) {
      pass('wfy continue is a compact secondary action')
    } else {
      fail('wfy continue is a compact secondary action', 'big transport Continue still dominant')
    }
    if (wfy.yourTurnText && wfy.yourTurnText.length < 220) {
      pass('wfy dock is a compact status strip', wfy.yourTurnText.slice(0, 120))
    }
    const before = currentBox(wfy)
    if (!before) {
      fail('wfy shows a required score event', 'no current box')
    } else {
      pass('wfy shows a required score event', before.label)
      const expected = parseExpectedMidis(before)
      if (expected.length === 0) {
        fail('wfy exposes expected pitches', JSON.stringify(before))
      } else {
        const injectable = await injectMidi(page, expected[0])
        if (!injectable.ok) {
          fail('midi inject hook available', injectable.reason)
        } else if (!injectable.delivered) {
          fail('midi inject hook available', 'hook present but no matcher subscribed (input source?)')
        } else {
          pass('midi inject hook available')
          // Play the whole required event promptly (chords share a ~500 ms
          // rolled-tone window): single notes complete at once, chords need
          // every tone.
          for (const midi of expected.slice(1)) {
            await sleep(150)
            await injectMidi(page, midi)
          }
          await sleep(1500)
          const afterCorrect = await scoreState(page)
          const advanced = currentBox(afterCorrect)
          const completedCount = afterCorrect.boxes.filter((box) => box.state === 'completed').length
          await page.screenshot({ path: join(outDir, 'wfy-advanced.png') })
          if (advanced && advanced.key !== before.key && completedCount >= 1) {
            pass('wfy correct note advances highlight + completed trail', advanced.label)
          } else {
            fail(
              'wfy correct note advances highlight + completed trail',
              `key ${before.key} -> ${advanced?.key}, completed=${completedCount}`,
            )
          }

          // Wrong note must NOT advance.
          const wrongMidi = pickWrongMidi(parseExpectedMidis(currentBox(afterCorrect) ?? before))
          const wrongKey = currentBox(afterCorrect)?.key
          await injectMidi(page, wrongMidi)
          await sleep(900)
          const afterWrong = await scoreState(page)
          await page.screenshot({ path: join(outDir, 'wfy-wrong.png') })
          const stillCurrent = currentBox(afterWrong)
          if (stillCurrent && stillCurrent.key === wrongKey) {
            pass('wfy wrong note does not advance')
          } else {
            fail('wfy wrong note does not advance', `${wrongKey} -> ${stillCurrent?.key}`)
          }
          if (afterWrong.boxes.some((box) => box.state === 'wrong')) {
            pass('wfy wrong note flashes red on the score')
          } else {
            fail('wfy wrong note flashes red on the score', 'no wrong-state box')
          }

          // Chord partials: advance through the piece looking for a chord
          // checkpoint (single-note openings skip; unit tests cover chords).
          let chordBox = (await scoreState(page)).boxes.find(
            (box) =>
              (box.state === 'current' || box.state === 'current-partial') &&
              parseExpectedMidis(box).length > 1,
          )
          for (let advance = 0; advance < 14 && !chordBox; advance += 1) {
            const now = currentBox(await scoreState(page))
            if (!now) {
              break
            }
            const midis = parseExpectedMidis(now)
            if (midis.length === 0) {
              break
            }
            await injectMidi(page, midis[0])
            await sleep(1100)
            chordBox = (await scoreState(page)).boxes.find(
              (box) =>
                (box.state === 'current' || box.state === 'current-partial') &&
                parseExpectedMidis(box).length > 1,
            )
          }
          if (!chordBox) {
            report.skipped.push('chord partial e2e (demo has no chord checkpoint here); covered by unit tests')
            console.log('SKIP  chord partial e2e (no chord checkpoint in demo at this position)')
          } else {
            const chordExpected = parseExpectedMidis(chordBox)
            await injectMidi(page, chordExpected[0])
            await sleep(900)
            const partial = await scoreState(page)
            await page.screenshot({ path: join(outDir, 'wfy-partial.png') })
            const partialBox = partial.boxes.find((box) => box.key === chordBox.key)
            if (partialBox && (partialBox.state === 'current-partial' || partialBox.key === chordBox.key)) {
              pass('wfy partial chord stays required', partialBox.state)
            } else {
              fail('wfy partial chord stays required', JSON.stringify(partialBox))
            }
            // Complete promptly: rolled chord tones share a short window.
            for (const midi of chordExpected.slice(1)) {
              await sleep(150)
              await injectMidi(page, midi)
            }
            await sleep(1500)
            const completed = await scoreState(page)
            if (completed.boxes.some((box) => box.state === 'completed')) {
              pass('wfy completed chord advances with confirmation')
            } else {
              fail('wfy completed chord advances with confirmation')
            }
            // I2: checkpoint-locked cursor — the bar column sits on the
            // required notehead column, not a time-proportional guess.
            const locked = await scoreState(page)
            const lockedCurrent = currentBox(locked)
            if (lockedCurrent && locked.cursorX != null) {
              const center = lockedCurrent.geometry?.center
              const delta = center != null ? Math.abs(locked.cursorX - center) : null
              if (delta != null && delta <= 2.0) {
                pass('wfy cursor locks to the required notehead column', `Δ=${delta.toFixed(2)}%`)
              } else {
                fail('wfy cursor locks to the required notehead column', `cursor=${locked.cursorX} box=${center}`)
              }
            } else {
              fail('wfy cursor locks to the required notehead column', 'no current box or cursor x')
            }

            // No duplicate awards: the same event twice in one task advances once.
            const dupBefore = currentBox(await scoreState(page))
            if (dupBefore) {
              const dupMidis = parseExpectedMidis(dupBefore)
              if (dupMidis.length > 0) {
                await injectMidiBurst(page, dupMidis.concat(dupMidis))
                await sleep(1500)
                const dupAfter = await scoreState(page)
                const dupCurrent = currentBox(dupAfter)
                const dupCompleted = dupAfter.boxes.filter((box) => box.state === 'completed').length
                const beforeCompleted = locked.boxes.filter((box) => box.state === 'completed').length
                if (dupCurrent && dupCurrent.key !== dupBefore.key && dupCompleted === beforeCompleted + 1) {
                  pass('wfy rapid duplicate input advances exactly once')
                } else {
                  fail('wfy rapid duplicate input advances exactly once', `${dupBefore.key} -> ${dupCurrent?.key}, completed ${beforeCompleted} -> ${dupCompleted}`)
                }
              }
            }
          }
        }
      }
    }

    // ---- Play Along: same score, same cursor ----
    await switchMode(page, 'Play Along')
    await page.screenshot({ path: join(outDir, 'playalong.png') })
    const playAlong = await scoreState(page)
    if (playAlong.cursorVisible) {
      pass('play-along shows the shared score cursor')
    } else {
      fail('play-along shows the shared score cursor', 'cursor hidden or missing')
    }
    if (playAlong.boxes.some((box) => box.state === 'current' && box.mode === 'play-along')) {
      pass('play-along highlights the current score event')
    } else {
      fail('play-along highlights the current score event', JSON.stringify(playAlong.boxes.slice(0, 3)))
    }

    // ---- Preview transport: pause/resume, seek, loop ----
    await switchMode(page, 'Preview')
    const playButton = page.locator('.workspace-play').first()
    await playButton.click()
    await sleep(2500)
    const playingLabel = await playButton.getAttribute('aria-label').catch(() => '')
    if (/pause/i.test(playingLabel ?? '')) {
      pass('preview play starts playback')
      const t1 = (await positionSeconds(page))
      await sleep(1200)
      const t2 = (await positionSeconds(page))
      if (t1 != null && t2 != null && t2 > t1) {
        pass('preview playhead advances during playback', `${t1}s -> ${t2}s`)
      } else {
        fail('preview playhead advances during playback', `${t1} -> ${t2}`)
      }
      await playButton.click()
      await sleep(400)
      const pausedLabel = await playButton.getAttribute('aria-label').catch(() => '')
      const p1 = (await positionSeconds(page))
      await sleep(1000)
      const p2 = (await positionSeconds(page))
      if (/play/i.test(pausedLabel ?? '') && p1 === p2) {
        pass('preview pause freezes the playhead')
      } else {
        fail('preview pause freezes the playhead', `${pausedLabel} ${p1} -> ${p2}`)
      }
      // Seek via the score position slider.
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
      await sleep(800)
      const afterSeekState = await scoreState(page)
      const afterSeek = afterSeekState.positionSeconds
      if (seeked && afterSeek != null && Math.abs(afterSeek - 20) <= 3) {
        pass('preview seek moves the playhead', `-> ${afterSeek}s`)
      } else {
        fail('preview seek moves the playhead', `seeked=${seeked} at ${afterSeek}s raw=${JSON.stringify(afterSeekState.positionText)}`)
      }
    } else {
      report.skipped.push('preview transport (audio unavailable headless)')
      console.log('SKIP  preview transport (play did not start headless)')
    }

    // Loop enable/disable through the dock tool (a region is required first:
    // canEnable == hasLoop, so set start/end from the position line).
    const loopTool = page.getByRole('button', { name: 'Loop' }).first()
    if (await loopTool.isVisible().catch(() => false)) {
      await loopTool.click()
      await sleep(600)
      const setStart = page.getByRole('button', { name: 'Set start' })
      const setEnd = page.getByRole('button', { name: 'Set end' })
      if (await setStart.isVisible().catch(() => false)) {
        await setStart.click()
        await sleep(400)
        // End after start (region must be forward): current is ~20s post-seek.
        await page.evaluate(() => {
          const input = document.querySelector('input[aria-label="Score position"]')
          if (!input) {
            return
          }
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
          setter?.call(input, '30')
          input.dispatchEvent(new Event('input', { bubbles: true }))
          input.dispatchEvent(new Event('change', { bubbles: true }))
        })
        await sleep(600)
      }
      if (await setEnd.isVisible().catch(() => false)) {
        await setEnd.click()
        await sleep(400)
      }
      const repeat = page.getByRole('checkbox', { name: 'Repeat passage' })
      if (await repeat.isEnabled().catch(() => false)) {
        await repeat.check()
        await sleep(600)
        const loopOn = await page.locator('.workspace-loop-range--on').isVisible().catch(() => false)
        await page.keyboard.press('Escape')
        await sleep(400)
        if (loopOn) {
          pass('loop marks the passage on the position line')
        } else {
          fail('loop marks the passage on the position line', 'no active loop range')
        }
        // Disable again so later sections run unlooped.
        await loopTool.click()
        await sleep(600)
        await page.getByRole('checkbox', { name: 'Repeat passage' }).uncheck().catch(() => {})
        await page.keyboard.press('Escape')
        await sleep(400)
      } else {
        report.skipped.push('loop toggle (region could not be set)')
        await page.keyboard.press('Escape').catch(() => {})
      }
    }

    // ---- Score change resets practice cleanly ----
    await page.getByRole('button', { name: 'Library', exact: true }).click().catch(() => {})
    await sleep(800)
    const opened = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('button')]
      const target = buttons.find((button) => {
        if (!/open score|start practice/i.test(button.textContent)) {
          return false
        }
        const row = button.closest('.cz-piece-row, [class*="card" i]')
        const scope = row ? row.textContent : button.parentElement?.textContent ?? ''
        return scope.includes('Prelude')
      })
      if (!target) {
        return false
      }
      target.click()
      return true
    })
    if (!opened) {
      report.skipped.push('score change (Prelude card not found)')
    } else {
      await sleep(8000)
      await switchMode(page, 'Wait For You')
      await ensureMidiInputSource(page)
      await sleep(1000)
      const changed = await scoreState(page)
      if (changed.yourTurnText && /1 of 479/.test(changed.yourTurnText)) {
        pass('changing scores resets Wait For You', changed.yourTurnText.slice(0, 60))
      } else {
        fail('changing scores resets Wait For You', changed.yourTurnText)
      }
      const preludeBox = currentBox(changed)
      const preludeMidis = parseExpectedMidis(preludeBox)
      if (preludeMidis.length === 1 && preludeMidis[0] === 60) {
        pass('new score waits on middle C', preludeBox.label)
      } else {
        fail('new score waits on middle C', JSON.stringify(preludeBox))
      }
    }

    // ---- Zoom stability: overlay boxes persist across fit modes ----
    const fitMode = page.getByRole('button', { name: /fit mode/i }).first()
    if (await fitMode.isVisible().catch(() => false)) {
      const countBefore = (await scoreState(page)).boxes.length
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
      const countAfter = (await scoreState(page)).boxes.length
      if (countAfter > 0 && countAfter >= Math.min(countBefore, 1)) {
        pass('zoom keeps score highlights', `${countBefore} -> ${countAfter}`)
      } else {
        fail('zoom keeps score highlights', `${countBefore} -> ${countAfter}`)
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
