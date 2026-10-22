#!/usr/bin/env node
/**
 * Audio Vision terminal-state scenarios:
 *   F. cancellation during generation
 *   G. failure (unsupported file) followed by a successful retry
 *   H. generate twice without reloading
 *
 *   node scripts/audit/av-terminal-state-probe.mjs
 *   BROWSER=webkit node scripts/audit/av-terminal-state-probe.mjs
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
const BROWSER = process.env.BROWSER ?? 'webkit'

function writeFigureWav(path, seconds = 30, sampleRate = 44100) {
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

const wavPath = writeFigureWav(join(outDir, 'scenarios.wav'), 30)
const textPath = join(outDir, 'not-audio.txt')
writeFileSync(textPath, 'this is not an audio file at all\n')

const { chromium, webkit } = await import('playwright')
const launcher = BROWSER === 'webkit' ? webkit : chromium
const browser = await launcher.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await context.newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)))

const state = () =>
  page.evaluate(() => {
    const norm = (el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim()
    const card = document.querySelector('.audio-vision-card')
    return {
      hasProgress: Boolean(document.querySelector('.audio-vision-progress')),
      review: document.querySelectorAll('.audio-vision-review').length > 0,
      error: norm(card?.querySelector('.audio-vision-error') ?? document.createElement('span')).slice(0, 100),
      hasArrangeButton: [...document.querySelectorAll('button')].some((b) => /Arrange for/i.test(b.textContent ?? '')),
      hasCancel: [...document.querySelectorAll('button')].some((b) => /Cancel/.test(b.textContent ?? '')),
      facts: norm(card?.querySelector('.audio-vision-facts') ?? document.createElement('span')).slice(0, 120),
    }
  })

const openCard = async () => {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('nav button')].find((e) => (e.textContent ?? '').replace(/^\s*\d+/, '').replace(/\s+/g, ' ').trim() === 'Library')
    b?.click()
  })
  await sleep(1500)
  await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => /My Uploads/.test(b.textContent ?? ''))?.click() })
  await sleep(1800)
}

const results = []
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await sleep(3000)
await openCard()

// ---------- G: failure with an unsupported file ----------
console.log('--- G: unsupported file is refused, not hung ---')
await page.setInputFiles('input[type=file]', textPath)
await sleep(2500)
await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => /Arrange for/i.test(b.textContent ?? ''))?.click() })
await sleep(6000)
const afterBad = await state()
console.log('   after bad file:', JSON.stringify(afterBad))
results.push({ case: 'G-failure', pass: !afterBad.hasProgress && (afterBad.error.length > 0 || afterBad.hasArrangeButton), detail: afterBad })

// ---------- G2: retry with a real file in the same page ----------
console.log('--- G2: retry with a real file, no reload ---')
await page.setInputFiles('input[type=file]', wavPath)
await sleep(3000)
await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => /Arrange for/i.test(b.textContent ?? ''))?.click() })
let t0 = Date.now()
let afterRetry = null
while (Date.now() - t0 < 180000) {
  await sleep(800)
  const s = await state()
  if (s.review || s.error) { afterRetry = s; break }
}
console.log(`   retry -> ${afterRetry ? (afterRetry.review ? 'REVIEW' : 'ERROR: ' + afterRetry.error) : 'STALLED'} in ${Math.round((Date.now() - t0) / 1000)}s`)
console.log('   facts:', afterRetry?.facts)
results.push({ case: 'G2-retry', pass: Boolean(afterRetry?.review), detail: afterRetry })

// ---------- H: generate twice without reloading ----------
console.log('--- H: generate twice without reloading ---')
await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => /Rebuild with this tempo/i.test(b.textContent ?? ''))?.click() })
t0 = Date.now()
let afterRebuild = null
while (Date.now() - t0 < 180000) {
  await sleep(800)
  const s = await state()
  if (s.review) { afterRebuild = s; break }
}
console.log(`   rebuild -> ${afterRebuild ? 'REVIEW' : 'STALLED'} in ${Math.round((Date.now() - t0) / 1000)}s`)
console.log('   facts:', afterRebuild?.facts)
results.push({ case: 'H-generate-twice', pass: Boolean(afterRebuild?.review), detail: afterRebuild })

// ---------- F: cancel during generation ----------
console.log('--- F: cancel during generation ---')
await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => /Arrange something else/i.test(b.textContent ?? ''))?.click() })
await sleep(1200)
await page.setInputFiles('input[type=file]', wavPath)
await sleep(2500)
await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => /Arrange for/i.test(b.textContent ?? ''))?.click() })
await sleep(1200)
const cancelClicked = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /Cancel/.test(x.textContent ?? ''))
  if (b) { b.click(); return true }
  return false
})
await sleep(2500)
const afterCancel = await state()
console.log('   cancel clicked:', cancelClicked, '->', JSON.stringify(afterCancel))
results.push({ case: 'F-cancel', pass: cancelClicked && !afterCancel.hasProgress && afterCancel.hasArrangeButton, detail: afterCancel })

// after cancel the panel must be usable again
await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => /Arrange for/i.test(b.textContent ?? ''))?.click() })
t0 = Date.now()
let afterCancelRetry = null
while (Date.now() - t0 < 180000) {
  await sleep(800)
  const s = await state()
  if (s.review || s.error) { afterCancelRetry = s; break }
}
console.log(`   after cancel, regenerate -> ${afterCancelRetry?.review ? 'REVIEW' : 'STALLED'} in ${Math.round((Date.now() - t0) / 1000)}s`)
results.push({ case: 'F2-regenerate-after-cancel', pass: Boolean(afterCancelRetry?.review), detail: afterCancelRetry })

console.log('\n========== TERMINAL STATE RESULTS ==========')
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.case}`)
console.log('page errors:', JSON.stringify(pageErrors))
await browser.close()
process.exitCode = results.every((r) => r.pass) ? 0 : 1
