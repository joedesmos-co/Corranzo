#!/usr/bin/env node
/**
 * Audio Vision 90% stall — reproduction / verification harness.
 *
 * Runs a REAL audio generation in a real browser and records:
 *   - the pitch worker's own URL, console and errors
 *   - the progress panel's stage + percentage over time
 *   - the terminal state: a real arrangement (review), a refusal, or an error
 *
 *   node scripts/audit/av-90-stall-probe.mjs
 *   BROWSER=webkit node scripts/audit/av-90-stall-probe.mjs
 *   AUDIT_URL=https://corranzo.com/ node scripts/audit/av-90-stall-probe.mjs
 *   AUDIT_SECONDS=30 AUDIT_TARGET=guitar node scripts/audit/av-90-stall-probe.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..', '..')
const outDir = join(root, 'tmp', 'av-stall')
mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const BASE = process.env.AUDIT_URL ?? 'http://127.0.0.1:4199/'
const BROWSER = process.env.BROWSER ?? 'chromium'
const SECONDS = Number(process.env.AUDIT_SECONDS ?? 12)
const WAIT_MS = Number(process.env.AUDIT_WAIT_MS ?? 300000)
const TARGET = process.env.AUDIT_TARGET ?? 'piano'
const LABEL = process.env.AUDIT_LABEL ?? `${BROWSER}-${TARGET}-${SECONDS}s`

/** A real PCM WAV: a short melody so the model has something to hear. */
function writeFigureWav(path, seconds = 12, sampleRate = 44100) {
  const total = Math.floor(seconds * sampleRate)
  const data = Buffer.alloc(total * 2)
  const seq = [57, 61, 64, 69, 64, 61]
  for (let i = 0; i < total; i += 1) {
    const t = i / sampleRate
    const note = seq[Math.floor(t / (seconds / seq.length)) % seq.length]
    const freq = 440 * Math.pow(2, (note - 69) / 12)
    const env = Math.min(1, (t % (seconds / seq.length)) * 12)
    data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(Math.sin(2 * Math.PI * freq * t) * 0.4 * env * 32767))), i * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8)
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34)
  header.write('data', 36); header.writeUInt32LE(data.length, 40)
  writeFileSync(path, Buffer.concat([header, data]))
  return path
}

const wavPath = writeFigureWav(join(outDir, `figure-${SECONDS}s.wav`), SECONDS)

const { chromium, webkit } = await import('playwright')
const launcher = BROWSER === 'webkit' ? webkit : chromium
const browser = await launcher.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await context.newPage()

const consoleLines = []
const pageErrors = []
const workerLines = []
page.on('console', (m) => consoleLines.push(`[${m.type()}] ${m.text().slice(0, 300)}`))
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 400)))
page.on('worker', (w) => {
  workerLines.push(`worker created: ${w.url()}`)
  w.on('console', (m) => workerLines.push(`[worker:${m.type()}] ${m.text().slice(0, 300)}`))
  w.on('close', () => workerLines.push('worker closed'))
})

console.log(`=== ${LABEL} :: ${BASE} :: ${SECONDS}s :: ${TARGET} ===`)
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await sleep(3000)

await page.evaluate(() => {
  const b = [...document.querySelectorAll('nav button')].find((e) => (e.textContent ?? '').replace(/^\s*\d+/, '').replace(/\s+/g, ' ').trim() === 'Library')
  b?.click()
})
await sleep(1500)
await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => /My Uploads/.test(b.textContent ?? ''))?.click() })
await sleep(2000)
await page.setInputFiles('input[type=file]', wavPath)
await sleep(3500)

if (TARGET === 'guitar') {
  await page.evaluate(() => { [...document.querySelectorAll('input[type=radio]')].find((e) => e.value === 'solo-guitar')?.click() })
  await sleep(600)
}

await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => /Arrange for/i.test(b.textContent ?? ''))?.click() })
const t0 = Date.now()
const timeline = []
let last = ''
let terminal = null
while (Date.now() - t0 < WAIT_MS) {
  await sleep(700)
  const state = await page.evaluate(() => {
    const norm = (el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim()
    const panel = document.querySelector('.audio-vision-progress')
    const card = norm(document.querySelector('.audio-vision-card'))
    // innerText is unreliable for this card in WebKit (it can be empty for
    // content that is laid out but not yet painted), so detect the review and
    // the refusal from the DOM structure instead.
    const review = document.querySelectorAll('.audio-vision-review').length > 0
    const refused = Boolean(
      document.querySelector('.audio-vision-error--refused') ??
      [...document.querySelectorAll('.audio-vision-card strong')].find((el) =>
        /Not enough to go on/i.test(el.textContent ?? ''),
      ),
    )
    const facts = norm(document.querySelector('.audio-vision-facts') ?? document.createElement('span')).slice(0, 160)
    const allCards = [...document.querySelectorAll('.audio-vision-card')]
    const cardEl = allCards[0]
    return {
      panel: panel ? norm(panel).slice(0, 80) : null,
      review,
      refused,
      facts,
      cardHead: norm(cardEl).slice(0, 90),
      cardChildren: cardEl ? cardEl.children.length : -1,
      cardCount: allCards.length,
      cardStates: allCards.map((c) => ({
        panels: c.querySelectorAll('.audio-vision-progress').length,
        reviews: c.querySelectorAll('.audio-vision-review').length,
        text: c.textContent.replace(/\s+/g, ' ').slice(0, 60),
        visible: c.getBoundingClientRect().height > 0,
      })),
      phaseAttr: cardEl ? String(cardEl.getAttribute('data-phase')) : null,
    }
  })
  const key = JSON.stringify(state)
  if (key !== last) {
    last = key
    timeline.push({ at: Math.round((Date.now() - t0) / 1000), panel: state.panel, review: state.review, refused: state.refused })
  }
  if (Date.now() - t0 > 8000) {
    console.log(`  +${Math.round((Date.now() - t0) / 1000)}s cards=${state.cardCount} ${JSON.stringify(state.cardStates)}`)
  }
  if (state.review) { terminal = { kind: 'review', facts: state.facts, at: Math.round((Date.now() - t0) / 1000) }; break }
  if (state.refused) { terminal = { kind: 'refused', at: Math.round((Date.now() - t0) / 1000) }; break }
}
const elapsed = Math.round((Date.now() - t0) / 1000)
await page.screenshot({ path: join(outDir, `${LABEL}.png`) })
console.log(`\nRESULT ${LABEL}: ${terminal ? terminal.kind : 'NO TERMINAL STATE (STALLED)'} in ${elapsed}s`)
if (terminal?.facts) console.log('FACTS:', terminal.facts)
console.log('WORKER:', JSON.stringify(workerLines, null, 1))
console.log('PAGE ERRORS:', JSON.stringify(pageErrors))
const errs = consoleLines.filter((l) => l.startsWith('[error]'))
console.log('CONSOLE ERRORS:', JSON.stringify(errs.slice(-6), null, 1))
await browser.close()
process.exitCode = terminal?.kind === 'review' ? 0 : 1
