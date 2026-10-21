#!/usr/bin/env node
/**
 * Diagnostic: why did "Open score" not open the practice workspace in the
 * PDF-then-arrangement flow? Reports the button's state, what is on top of
 * it, and the view after the click.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const outDir = join(root, 'tmp', 'audio-vision-open-score-diag')
const PORT = Number(process.env.E2E_PORT ?? 5671)
const baseUrl = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}/`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function writeFigureWav(path, seconds = 4) {
  const SR = 44100
  const data = new Float32Array(SR * seconds)
  const seq = [57, 61, 64, 69, 64, 61]
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
  for (let b = 0; b * beat < seconds; b += 1) tone(seq[b % seq.length], b * beat, 0.45)
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
const wavPath = await writeFigureWav(join(outDir, 'figure.wav'))
const pdfFixture = join(root, 'public', 'fixtures', 'demo-minuet-in-g.pdf')

const externalBase = Boolean(process.env.E2E_BASE_URL)
const vite = externalBase ? null : await createServer({
  root,
  configFile: join(root, 'vite.config.js'),
  logLevel: 'silent',
  server: { host: '127.0.0.1', port: PORT, strictPort: true },
})
if (vite) { await vite.listen(); await sleep(800) }

const { chromium } = await import('playwright')
const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
const page = await context.newPage()
const log = []
try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await sleep(3000)
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('nav button')].find((el) => el.textContent?.replace(/^\s*\d+/, '').replace(/\s+/g, ' ').trim() === 'Import')
    button?.click()
  })
  await sleep(1200)
  await page.locator('input[type="file"][aria-label="Choose score PDF"]').first().setInputFiles(pdfFixture)
  await page.getByText(/pages? · PDF|PDF selected/i).first().waitFor({ timeout: 60000 })
  log.push('pdf imported')
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('nav button')].find((el) => /library/i.test(el.textContent ?? ''))
    button?.click()
  })
  await sleep(1000)
  const uploadsTab = page.getByRole('tab', { name: /my uploads/i })
  if (await uploadsTab.count()) { await uploadsTab.click(); await sleep(700) }
  await page.getByText('Create from audio', { exact: false }).first().waitFor({ timeout: 20000 })
  await page.locator('.audio-vision-card input[type="file"]').setInputFiles(wavPath)
  await page.getByText(/recording length/i).first().waitFor({ timeout: 60000 })
  await page.locator('.audio-vision-card input[name="audio-vision-target"][value="solo-guitar"]').check()
  await page.getByRole('button', { name: /arrange for/i }).click()
  await page.getByText('Your arrangement is ready', { exact: false }).first().waitFor({ timeout: 300000 })
  log.push('arrangement ready')
  await page.getByRole('button', { name: /open in corranzo practice/i }).click()
  await page.getByText('Arranged from your recording', { exact: false }).first().waitFor({ timeout: 60000 })
  log.push('import view shows the arrangement')

  // Watch the import view for the ready section.
  for (let i = 0; i < 20; i += 1) {
    const state = await page.evaluate(() => {
      const button = [...document.querySelectorAll('button')].find((el) => /^open score$/i.test(el.textContent?.trim() ?? ''))
      const ready = Boolean(document.querySelector('.score-import-ready'))
      const preparing = /preparing your arrangement/i.test(document.querySelector('.score-import')?.textContent ?? '')
      return { ready, preparing, hasButton: Boolean(button), disabled: button?.disabled ?? null }
    })
    log.push(`poll ${i}: ${JSON.stringify(state)}`)
    if (state.hasButton) break
    await sleep(1000)
  }

  const before = await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((el) => /^open score$/i.test(el.textContent?.trim() ?? ''))
    if (!button) return { found: false }
    const rect = button.getBoundingClientRect()
    const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return {
      found: true,
      disabled: button.disabled,
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      topElement: top ? `${top.tagName}.${top.className}`.slice(0, 90) : null,
      topIsButton: top === button,
      view: document.querySelector('.app')?.className ?? null,
    }
  })
  log.push(`before click: ${JSON.stringify(before)}`)
  await page.getByRole('button', { name: /^open score$/i }).first().click()
  await sleep(2500)
  const after = await page.evaluate(() => ({
    libraryVisible: Boolean(document.querySelector('.library-main')),
    dockVisible: (() => {
      const dock = document.querySelector('.workspace-dock')
      if (!dock) return false
      const rect = dock.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0 && getComputedStyle(dock).visibility !== 'hidden'
    })(),
    path: window.location.pathname + window.location.hash,
    practiceText: (document.querySelector('.practice-workspace')?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 120),
  }))
  log.push(`after click: ${JSON.stringify(after)}`)
  await page.screenshot({ path: join(outDir, 'after-open-score.png') })
} catch (error) {
  log.push(`ERROR ${String(error?.message ?? error)}`)
} finally {
  try { await browser.close() } catch { /* noop */ }
  try { await vite?.close() } catch { /* noop */ }
}
console.log(log.join('\n'))
await writeFile(join(outDir, 'report.txt'), log.join('\n'))
