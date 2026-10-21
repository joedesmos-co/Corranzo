#!/usr/bin/env node
/**
 * Audio Vision — unified engine + musical quality acceptance.
 *
 * Runs the same checks in Chromium AND WebKit (Safari's engine), because the
 * engraved score, the red cursor and the Web Worker all behave differently
 * there. WebKit is the browser the user reported from.
 *
 * Usage: E2E_PORT=5661 node scripts/browser-audio-vision-unified-webkit.mjs
 */
import { mkdir } from 'node:fs/promises'
import { writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const outDir = join(root, 'tmp', 'audio-vision-unified-webkit')
const PORT = Number(process.env.E2E_PORT ?? 5661)
const baseUrl = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}/`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const report = { passes: [], failures: [], consoleErrors: [], pageErrors: [] }
const pass = (name, detail = '') => { report.passes.push({ name, detail }); console.log(`PASS  ${name} ${detail}`) }
const fail = (name, detail = '') => { report.failures.push({ name, detail }); console.error(`FAIL  ${name} ${detail}`) }

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

const externalBase = Boolean(process.env.E2E_BASE_URL)
const vite = externalBase ? null : await createServer({
  root,
  configFile: join(root, 'vite.config.js'),
  logLevel: 'silent',
  server: { host: '127.0.0.1', port: PORT, strictPort: true },
})
if (vite) { await vite.listen(); await sleep(800) }

const { webkit } = await import('playwright')
let browser = null
try {
  browser = await webkit.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  const page = await context.newPage()
  page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(m.text()) })
  page.on('pageerror', (e) => report.pageErrors.push(e.message))

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await sleep(3000)
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('nav button')].find((el) => /library/i.test(el.textContent ?? ''))
    button?.click()
  })
  await sleep(1200)
  const uploadsTab = page.getByRole('tab', { name: /my uploads/i })
  if (await uploadsTab.count()) { await uploadsTab.click(); await sleep(800) }
  await page.getByText('Create from audio', { exact: false }).first().waitFor({ timeout: 30000 })
  await page.locator('.audio-vision-card input[type="file"]').setInputFiles(wavPath)
  await page.getByText(/recording length/i).first().waitFor({ timeout: 90000 })
  pass('webkit: the file probe works')
  await page.locator('.audio-vision-card input[name="audio-vision-target"][value="solo-guitar"]').check()
  await page.getByRole('button', { name: /arrange for/i }).click()
  await page.getByText('Your arrangement is ready', { exact: false }).first().waitFor({ timeout: 420000 })
  pass('webkit: the arrangement is generated (Web Worker inference)')
  await page.getByRole('button', { name: /open in corranzo practice/i }).click()
  await page.getByText('Arranged from your recording', { exact: false }).first().waitFor({ timeout: 60000 })
  await page.getByRole('button', { name: /open score/i }).click()
  await page.locator('.osmd-score__container[data-osmd-ready="true"]').first().waitFor({ timeout: 120000 })
  await sleep(1500)
  await page.screenshot({ path: join(outDir, '01-unified-workspace.png') })

  const surface = await page.evaluate(() => ({
    hasWorkspaceFrame: Boolean(document.querySelector('.workspace-frame')),
    hasDock: Boolean(document.querySelector('.workspace-dock')),
    modes: [...document.querySelectorAll('.workspace-modes [role="radio"]')].map((b) => b.textContent?.trim()),
    status: document.querySelector('.workspace-status')?.textContent?.replace(/\s+/g, ' ').trim(),
    hasArrangementSurface: Boolean(document.querySelector('.arrangement-practice')),
  }))
  if (surface.hasWorkspaceFrame && surface.hasDock && !surface.hasArrangementSurface) {
    pass('webkit: the unified workspace is the normal Practice Engine')
  } else {
    fail('webkit: the unified workspace is the normal Practice Engine', JSON.stringify(surface))
  }
  if (surface.modes.length === 3) {
    pass('webkit: all three practice modes', surface.modes.join(' · '))
  } else {
    fail('webkit: all three practice modes', JSON.stringify(surface.modes))
  }

  // The red cursor must be on the engraved score and must move.
  await page.getByRole('button', { name: /^play \(space\)$/i }).first().click()
  await sleep(1800)
  const cursor = await page.evaluate(() => {
    const element = document.querySelector('[data-engraved-cursor="true"]')
    if (!element) return { present: false }
    const rect = element.getBoundingClientRect()
    return {
      present: true,
      display: getComputedStyle(element).display,
      left: Math.round(rect.left),
      height: Math.round(rect.height),
      measure: element.getAttribute('data-engraved-cursor-measure'),
    }
  })
  if (cursor.present && cursor.display !== 'none' && cursor.height > 4) {
    pass('webkit: the red cursor is on the engraved score', JSON.stringify(cursor))
  } else {
    fail('webkit: the red cursor is on the engraved score', JSON.stringify(cursor))
  }
  const before = cursor.left
  await sleep(1800)
  const after = await page.evaluate(() => Math.round(document.querySelector('[data-engraved-cursor="true"]')?.getBoundingClientRect().left ?? 0))
  if (before != null && Math.abs(after - before) > 0.5) {
    pass('webkit: the cursor moves with the music', `${before} -> ${after}`)
  } else {
    fail('webkit: the cursor moves with the music', `before=${before} after=${after}`)
  }
  await page.screenshot({ path: join(outDir, '02-cursor.png') })

  // Wait For You + seeking.
  await page.getByRole('radio', { name: /wait for you/i }).first().click()
  await sleep(1500)
  const wfy = await page.evaluate(() => ({
    mode: document.querySelector('.practice-workspace')?.getAttribute('data-mode'),
    yourTurn: Boolean(document.querySelector('.workspace-your-turn')),
  }))
  if (wfy.mode === 'wait-for-you' && wfy.yourTurn) {
    pass('webkit: Wait For You initializes with a target')
  } else {
    fail('webkit: Wait For You initializes with a target', JSON.stringify(wfy))
  }
  await page.getByRole('radio', { name: /preview/i }).first().click()
  await sleep(500)
  const seek = page.locator('.workspace-seek-wrap input[type="range"]').first()
  if (await seek.count()) {
    await seek.fill('1.5')
    await sleep(1000)
    const time = await page.evaluate(() => document.querySelector('.workspace-position')?.textContent?.replace(/\s+/g, ' ').trim() ?? '')
    if (/0:0[1-9]/.test(time)) {
      pass('webkit: seeking moves the practice clock', time.slice(0, 50))
    } else {
      fail('webkit: seeking moves the practice clock', time.slice(0, 70))
    }
  } else {
    fail('webkit: seeking moves the practice clock', 'no seek control')
  }
  await page.screenshot({ path: join(outDir, '03-transport.png') })
} catch (error) {
  fail('webkit harness', String(error?.stack ?? error).slice(0, 500))
} finally {
  try { await browser?.close() } catch { /* noop */ }
  try { await vite?.close() } catch { /* noop */ }
}

console.log(`\npass=${report.passes.length} fail=${report.failures.length} consoleErrors=${report.consoleErrors.length} pageErrors=${report.pageErrors.length}`)
if (report.consoleErrors.length) console.log(`console: ${report.consoleErrors.slice(0, 5).join(' | ').slice(0, 500)}`)
process.exit(report.failures.length ? 1 : 0)
