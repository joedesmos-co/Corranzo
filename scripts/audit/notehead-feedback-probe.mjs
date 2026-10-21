#!/usr/bin/env node
/**
 * Native notehead feedback — real-browser verification of the three modes.
 *
 *   node scripts/audit/notehead-feedback-probe.mjs
 *   BROWSER=webkit node scripts/audit/notehead-feedback-probe.mjs
 *   AUDIT_URL=https://corranzo.com/ node scripts/audit/notehead-feedback-probe.mjs
 */
import { mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..', '..')
const outDir = join(root, 'tmp', 'notehead')
mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const BASE = process.env.AUDIT_URL ?? 'http://127.0.0.1:4199/'
const BROWSER = process.env.BROWSER ?? 'chromium'
const LABEL = `${BROWSER}`

const { chromium, webkit } = await import('playwright')
const launcher = BROWSER === 'webkit' ? webkit : chromium
const browser = await launcher.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const pageErrors = []
const consoleErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)))
page.on('console', (m) => {
  if (m.type() !== 'error') return
  const t = m.text()
  if (/favicon|DevTools|google|gstatic|fonts\.|cloudflareinsights|net::ERR_|AudioContext/.test(t)) return
  consoleErrors.push(t.slice(0, 200))
})

const results = []
let midiAvailable = true
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` :: ${detail}` : ''}`)
}

const readState = () =>
  page.evaluate(() => {
    const norm = (el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim()
    const noteheads = [...document.querySelectorAll('.cz-notehead')].map((el) => {
      const glyph = el.querySelector('.cz-notehead__glyph')
      return {
        shape: el.getAttribute('data-cz-notehead-shape'),
        state: el.getAttribute('data-cz-notehead-state'),
        fill: glyph?.getAttribute('fill') ?? null,
        stroke: glyph?.getAttribute('stroke') ?? null,
        left: el.style.left,
        top: el.style.top,
        width: el.style.width,
      }
    })
    const line = document.querySelector('.score-follow-cursor__line')
    const lineRect = line?.getBoundingClientRect()
    return {
      noteheads,
      // The floating geometry marker must be gone in normal practice.
      floatingMarkers: document.querySelectorAll('.score-follow-overlay__note-target-ring, .score-follow-overlay__note-target-dot').length,
      legacyBoxes: document.querySelectorAll('.score-follow-overlay__note-highlight').length,
      nowTicks: document.querySelectorAll('.score-follow-overlay__now-tick').length,
      redCursor: Boolean(line) && getComputedStyle(line.parentElement).display !== 'none',
      redCursorX: lineRect ? Math.round(lineRect.x) : null,
      boxes: [...document.querySelectorAll('[data-score-note-state]')].map((el) => ({
        state: el.getAttribute('data-score-note-state'),
        expected: el.getAttribute('data-score-expected') ?? '',
        key: el.getAttribute('data-practice-note-target-key'),
      })),
      requirement: norm(document.querySelector('.workspace-your-turn') ?? document.createElement('span')).slice(0, 120),
      inputSource: norm(document.querySelector('.workspace-tool-button--input, [aria-label="Practice input"]') ?? document.createElement('span')).slice(0, 40),
      wfyStatus: norm(document.querySelector('.workspace-wfy-feedback, .workspace-your-turn__feedback') ?? document.createElement('span')).slice(0, 60),
    }
  })

const injectMidi = (midi) =>
  page.evaluate((value) => {
    const inject = window.__SCOREFLOW_MIDI_INJECT__
    if (typeof inject !== 'function') return { ok: false, reason: 'no-hook' }
    return { ok: true, delivered: Boolean(inject(value)) }
  }, midi)

const switchMode = async (label) => {
  await page.evaluate((l) => {
    const b = [...document.querySelectorAll('button')].find((e) => (e.textContent ?? '').trim().startsWith(l))
    b?.click()
  }, label)
  await sleep(1500)
}

await page.goto(`${BASE}${BASE.includes('?') ? '&' : '?'}e2e-midi=1`, { waitUntil: 'domcontentloaded' })
await sleep(3500)

// Open the demo piece (the user's Menuet in F, K.2 scenario)
const openScore = page.getByRole('button', { name: 'Open score' }).first()
if (await openScore.isVisible().catch(() => false)) {
  await openScore.click()
} else {
  await page.getByRole('button', { name: 'Library', exact: true }).click().catch(() => {})
  await sleep(600)
  const start = page.getByRole('button', { name: /Start practice:/i }).first()
  if (await start.isVisible().catch(() => false)) await start.click()
}
await sleep(9000)
for (const label of ['Done', 'Skip restore', 'Dismiss']) {
  const b = page.getByRole('button', { name: label }).first()
  if (await b.isVisible().catch(() => false)) await b.click().catch(() => {})
  await sleep(300)
}

// ---------------- PREVIEW ----------------
await switchMode('Preview')
await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => /^(Play|Pause)$/.test((b.textContent ?? '').trim()))?.click() })
await sleep(3000)
let state = await readState()
await page.screenshot({ path: join(outDir, `preview-${LABEL}.png`) })
check('Preview: red cursor visible', state.redCursor, `x=${state.redCursorX}`)
check('Preview: no floating marker circles', state.floatingMarkers === 0, `found ${state.floatingMarkers}`)
check('Preview: no notehead feedback', state.noteheads.length === 0, `found ${state.noteheads.length}`)
check('Preview: no legacy note boxes', state.legacyBoxes === 0, `found ${state.legacyBoxes}`)
await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => /^(Play|Pause)$/.test((b.textContent ?? '').trim()))?.click() })
await sleep(500)

// ---------------- WAIT FOR YOU ----------------
await switchMode('Wait For You')
await sleep(1500)
// Choose the MIDI input source (the WFY input-source dialog).
{
  const dialog = page.getByRole('dialog', { name: 'How should Corranzo hear you?' })
  if (await dialog.isVisible().catch(() => false)) {
    const button = dialog.getByRole('button', { name: /Use MIDI/i })
    if (await button.isVisible().catch(() => false)) {
      await button.click()
      await sleep(700)
    }
  }
  const connect = page.getByRole('button', { name: 'Practice input' })
  if (await connect.isVisible().catch(() => false)) {
    await connect.click()
    await sleep(600)
    const option = page.getByRole('button', { name: 'MIDI keyboard' })
    if (await option.isVisible().catch(() => false)) {
      if (await option.isDisabled().catch(() => true)) {
        // No Web MIDI in this engine (Safari): the input source cannot be
        // chosen, so the MIDI-only checks are untestable here. Report that
        // honestly instead of pretending they passed.
        midiAvailable = false
        console.log('   NOTE: this engine has no Web MIDI — the MIDI WFY checks are skipped (not a failure).')
      } else {
        await option.click()
        await sleep(700)
        await page.keyboard.press('Escape').catch(() => {})
        await sleep(400)
      }
    }
  }
}
state = await readState()
const currentBox = state.boxes.find((b) => b.state === 'current' || b.state === 'current-partial') ?? null
const focusNoteheads = state.noteheads.filter((n) => n.state === 'focus')
check('WFY: the required note carries a subtle focus treatment', focusNoteheads.length > 0, `focus=${focusNoteheads.length}`)
const expected = (currentBox?.expected ?? '').split(',').map(Number).filter(Number.isFinite)
check('WFY: exposes the required pitches', expected.length > 0, currentBox?.expected ?? 'none')
check('WFY: no floating marker circles', state.floatingMarkers === 0, `found ${state.floatingMarkers}`)

if (!midiAvailable) {
  console.log('   (skipping the MIDI-injection checks in this engine)')
} else if (expected.length > 0) {
  // A wrong note must not light anything up.
  const wrong = expected.includes(61) ? 60 : 61
  await injectMidi(wrong)
  await sleep(1200)
  const afterWrong = await readState()
  const blueAfterWrong = afterWrong.noteheads.filter((n) => (n.fill ?? '').toLowerCase() === '#1d4ed8')
  const blueBefore = state.noteheads.filter((n) => (n.fill ?? '').toLowerCase() === '#1d4ed8')
  check(
    'WFY: a wrong note does not light a correct notehead blue',
    blueAfterWrong.length === blueBefore.length,
    `blue ${blueBefore.length} -> ${blueAfterWrong.length}`,
  )
  const indexOf = (text) => Number((text ?? '').match(/(\d+) of \d+/)?.[1] ?? -1)
  check(
    'WFY: a wrong note does not advance the requirement',
    indexOf(afterWrong.requirement) <= indexOf(state.requirement),
    `${state.requirement} -> ${afterWrong.requirement}`,
  )
  await page.screenshot({ path: join(outDir, `wfy-wrong-${LABEL}.png`) })

  // The correct note(s) light the notehead(s) up blue. A chord needs every
  // member, so play the whole checkpoint.
  for (const midi of expected) {
    const res = await injectMidi(midi)
    console.log('   injected', midi, JSON.stringify(res))
    await sleep(350)
  }
  await sleep(1500)
  const afterCorrect = await readState()
  const blue = afterCorrect.noteheads.filter((n) => (n.fill ?? '').toLowerCase() === '#1d4ed8')
  check('WFY: the correct note lights its notehead blue', blue.length > 0, `blue=${blue.length} shapes=${JSON.stringify(afterCorrect.noteheads.map((n) => n.shape))}`)
  check(
    'WFY: the correct note advances the requirement',
    afterCorrect.requirement !== state.requirement,
    `${state.requirement} -> ${afterCorrect.requirement}`,
  )
  await page.screenshot({ path: join(outDir, `wfy-correct-${LABEL}.png`) })
  console.log('   noteheads:', JSON.stringify(afterCorrect.noteheads))
}

// ---------------- PLAY ALONG ----------------
await switchMode('Play Along')
await sleep(1200)
await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => /^(Play|Pause)$/.test((b.textContent ?? '').trim()))?.click() })
await sleep(3500)
const playState = await readState()
await page.screenshot({ path: join(outDir, `play-along-${LABEL}.png`) })
check('Play Along: red cursor visible', playState.redCursor, `x=${playState.redCursorX}`)
check('Play Along: no floating marker circles', playState.floatingMarkers === 0, `found ${playState.floatingMarkers}`)
check('Play Along: no legacy note boxes', playState.legacyBoxes === 0, `found ${playState.legacyBoxes}`)
// Play Along paints feedback on the noteheads it judged: blue for a note that
// was played, red for an expected note that was missed.
const playColors = new Set(playState.noteheads.map((n) => n.fill ?? n.stroke).filter(Boolean))
console.log('   play-along notehead colours:', JSON.stringify([...playColors]))
check(
  'Play Along: feedback colours come from the notehead palette',
  [...playColors].every((c) => ['#1d4ed8', '#a16207', '#b91c1c', 'none'].includes(c)),
  JSON.stringify([...playColors]),
)

console.log('\npage errors:', JSON.stringify(pageErrors))
console.log('console errors:', JSON.stringify(consoleErrors.slice(-5)))
const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
await browser.close()
process.exitCode = failed.length === 0 ? 0 : 1
