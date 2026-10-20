#!/usr/bin/env node
/**
 * Focused diagnostic: is the UI responsive while an arrangement is generated?
 *
 * Reports, for one real recording:
 *   - how long after Generate the progress panel became visible
 *   - the stage labels the panel showed, in order (does progress advance?)
 *   - the worst main-thread block (a 50 ms heartbeat measures the gap)
 *   - every long task (>50 ms) the browser reported
 *   - which pitch source produced the notes (worker path vs inline vs spectral)
 *
 * Usage: E2E_PORT=5612 node scripts/browser-audio-vision-progress-probe.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const outDir = join(root, 'tmp', 'audio-vision-progress-probe')
const PORT = Number(process.env.E2E_PORT ?? 5612)
const baseUrl = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}/`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 30 s of a repeating guitar figure — long enough to expose blocking. */
async function writeFigureWav(path, seconds = 30) {
  const SR = 44100
  const data = new Float32Array(SR * seconds)
  const seq = [57, 61, 64, 69, 64, 61, 59, 64]
  const beat = 0.5
  const tone = (midi, start, dur, amp = 0.4) => {
    const freq = 440 * 2 ** ((midi - 69) / 12)
    const s0 = Math.floor(start * SR)
    const s1 = Math.min(data.length, Math.floor((start + dur) * SR))
    for (let i = s0; i < s1; i += 1) {
      const t = (i - s0) / SR
      data[i] += amp * Math.exp(-2.5 * t) * Math.sin(2 * Math.PI * freq * t)
    }
  }
  for (let b = 0; b * beat < seconds; b += 1) {
    tone(seq[b % seq.length], b * beat, 0.45)
  }
  const n = data.length
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + n * 2, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(SR, 24)
  buf.writeUInt32LE(SR * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i += 1) {
    const v = Math.max(-1, Math.min(1, data[i]))
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2)
  }
  await writeFile(path, buf)
  return path
}

await mkdir(outDir, { recursive: true })
const wavPath = await writeFigureWav(join(outDir, 'figure-30s.wav'))

const externalBase = Boolean(process.env.E2E_BASE_URL)
const vite = externalBase ? null : await createServer({
  root,
  configFile: join(root, 'vite.config.js'),
  logLevel: 'silent',
  server: { host: '127.0.0.1', port: PORT, strictPort: true },
})
if (vite) {
  await vite.listen()
  await sleep(800)
}

const { chromium } = await import('playwright')
const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] })
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await context.newPage()
const consoleErrors = []
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`))

const result = { consoleErrors }
try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await sleep(2500)
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('nav button')].find((el) => /library/i.test(el.textContent ?? ''))
    button?.click()
  })
  await sleep(900)
  const uploadsTab = page.getByRole('tab', { name: /my uploads/i })
  if (await uploadsTab.count()) { await uploadsTab.click(); await sleep(600) }
  await page.getByText('Create from audio', { exact: false }).first().waitFor({ timeout: 20000 })
  await page.locator('.audio-vision-card input[type="file"]').setInputFiles(wavPath)
  await page.getByText(/recording length/i).first().waitFor({ timeout: 60000 })
  await page.locator('.audio-vision-card input[name="audio-vision-target"][value="solo-guitar"]').check()
  await page.locator('.audio-vision-card input[name="audio-vision-difficulty"][value="easy"]').check()

  await page.evaluate(() => {
    window.__probe = { gaps: [], longTasks: [], stages: [], labelAt: [], ticks: [] }
    let last = performance.now()
    window.__timer = setInterval(() => {
      const now = performance.now()
      window.__probe.gaps.push({ gap: Math.round(now - last), at: Math.round(now) })
      last = now
      const el = document.querySelector('.audio-vision-progress')
      const label = el ? (el.textContent ?? '').replace(/\s+/g, ' ').trim() : null
      window.__probe.ticks.push({ at: Math.round(now), label: label ? label.split('Analyzing your recording')[0].trim() : null })
      if (label && window.__probe.stages.at(-1) !== label) {
        window.__probe.stages.push(label)
        window.__probe.labelAt.push(Math.round(now))
      }
    }, 50)
    try {
      window.__obs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) window.__probe.longTasks.push(Math.round(e.duration))
      })
      window.__obs.observe({ entryTypes: ['longtask'] })
    } catch { /* unsupported */ }
  })

  const t0 = Date.now()
  await page.getByRole('button', { name: /arrange for/i }).click()
  await page.locator('.audio-vision-progress').first().waitFor({ state: 'visible', timeout: 15000 })
  const progressLatencyMs = Date.now() - t0
  await page.getByText('Your arrangement is ready', { exact: false }).first().waitFor({ timeout: 300000 })
  const totalMs = Date.now() - t0

  const probe = await page.evaluate(() => {
    clearInterval(window.__timer)
    window.__obs?.disconnect()
    return window.__probe
  })
  const facts = await page.evaluate(() => (document.querySelector('.audio-vision-facts')?.textContent ?? '').replace(/\s+/g, ' '))
  result.progressLatencyMs = progressLatencyMs
  result.totalMs = totalMs
  result.stages = probe.stages
  result.stageTimeline = probe.stages.map((label, i) => ({
    label,
    atMs: i === 0 ? probe.labelAt[0] : probe.labelAt[i] - probe.labelAt[0],
  }))
  result.maxGapMs = Math.max(0, ...probe.gaps.map((g) => g.gap))
  result.topGaps = [...probe.gaps].sort((a, b) => b.gap - a.gap).slice(0, 5)
  result.longTasks = probe.longTasks
  result.longTaskTotalMs = probe.longTasks.reduce((a, b) => a + b, 0)
  result.facts = facts
  result.ticks = probe.ticks.filter((t, i) => i === 0 || t.label !== probe.ticks[i - 1].label).slice(0, 60)
  await page.screenshot({ path: join(outDir, 'review.png') })
} catch (error) {
  result.error = String(error?.stack ?? error)
} finally {
  try { await browser.close() } catch { /* noop */ }
  try { await vite?.close() } catch { /* noop */ }
}

await writeFile(join(outDir, 'report.json'), JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))
