#!/usr/bin/env node
/**
 * Audio Vision — unified Practice Engine acceptance (real Chromium).
 *
 * Proves that an Audio Vision arrangement now opens the SAME workspace as a
 * PDF-imported score: the full score controls, the three practice modes, the
 * transport, the red cursor on the engraved noteheads, and the tools panel.
 *
 * Usage: E2E_BASE_URL=https://corranzo.com/ node scripts/browser-audio-vision-unified-engine.mjs
 */
import { mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const outDir = join(root, 'tmp', 'audio-vision-unified-engine')
const PORT = Number(process.env.E2E_PORT ?? 5641)
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

const { writeFile } = await import('node:fs/promises')

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

const { chromium } = await import('playwright')
const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
const page = await context.newPage()
page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(m.text()) })
page.on('pageerror', (e) => report.pageErrors.push(e.message))

async function shot(name) {
  try { await page.screenshot({ path: join(outDir, `${name}.png`) }) } catch { /* noop */ }
}

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
  await page.getByRole('button', { name: /arrange for/i }).click()
  await page.getByText('Your arrangement is ready', { exact: false }).first().waitFor({ timeout: 300000 })
  await page.getByRole('button', { name: /open in corranzo practice/i }).click()
  await page.getByText('Arranged from your recording', { exact: false }).first().waitFor({ timeout: 60000 })
  await page.getByRole('button', { name: /open score/i }).click()
  await page.locator('.osmd-score__container[data-osmd-ready="true"]').first().waitFor({ timeout: 90000 })
  await sleep(1500)
  await shot('01-unified-workspace')

  const surface = await page.evaluate(() => {
    const workspace = document.querySelector('.practice-workspace')
    const dock = document.querySelector('.workspace-dock')
    const header = document.querySelector('.workspace-header')
    const modes = [...document.querySelectorAll('.workspace-modes [role="radio"]')].map((b) => b.textContent?.trim())
    const status = document.querySelector('.workspace-status')?.textContent?.replace(/\s+/g, ' ').trim()
    return {
      hasWorkspaceFrame: Boolean(document.querySelector('.workspace-frame')),
      hasHeader: Boolean(header),
      hasDock: Boolean(dock),
      hasEngravedScore: Boolean(document.querySelector('.osmd-score__container svg')),
      hasArrangementSurface: Boolean(document.querySelector('.arrangement-practice')),
      modes,
      status,
      title: header?.querySelector('h1')?.textContent?.trim() ?? null,
      seek: Boolean(document.querySelector('.workspace-seek-wrap input[type="range"]')),
      focusButton: Boolean(document.querySelector('.workspace-focus')),
      noteGuide: Boolean(document.querySelector('.workspace-representation button')),
      text: (workspace?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 220),
    }
  })
  if (surface.hasWorkspaceFrame && surface.hasHeader && surface.hasDock) {
    pass('unified workspace chrome', `title=${surface.title}`)
  } else {
    fail('unified workspace chrome', JSON.stringify(surface).slice(0, 300))
  }
  if (surface.hasEngravedScore && !surface.hasArrangementSurface) {
    pass('the score is the engraved arrangement inside the normal workspace')
  } else {
    fail('the score is the engraved arrangement inside the normal workspace', JSON.stringify(surface).slice(0, 240))
  }
  if (surface.modes.join('|').includes('Preview') && surface.modes.join('|').includes('Play Along') && surface.modes.join('|').includes('Wait For You')) {
    pass('all three practice modes are present', surface.modes.join(' · '))
  } else {
    fail('all three practice modes are present', JSON.stringify(surface.modes))
  }
  if (surface.seek && surface.focusButton && surface.noteGuide) {
    pass('full score controls present', 'seek · focus · note guide')
  } else {
    fail('full score controls present', JSON.stringify(surface).slice(0, 240))
  }
  if (/follow/i.test(surface.status ?? '')) {
    pass('the workspace reports that the score follows the music', surface.status)
  } else {
    fail('the workspace reports that the score follows the music', String(surface.status))
  }

  // Preview + red cursor.
  await page.getByRole('button', { name: /^play \(space\)$/i }).first().click()
  await sleep(1500)
  const cursor = await page.evaluate(() => {
    const element = document.querySelector('[data-engraved-cursor="true"]')
    if (!element) return { present: false }
    const style = getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    const noteheads = [...document.querySelectorAll('.osmd-score__container svg path, .osmd-score__container svg ellipse')]
    return {
      present: true,
      display: style.display,
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      height: Math.round(rect.height),
      measure: element.getAttribute('data-engraved-cursor-measure'),
      midi: element.getAttribute('data-engraved-cursor-midi'),
      noteheadCount: noteheads.length,
    }
  })
  if (cursor.present && cursor.display !== 'none' && cursor.height > 4) {
    pass('the red cursor is on the engraved score', JSON.stringify(cursor))
  } else {
    fail('the red cursor is on the engraved score', JSON.stringify(cursor))
  }
  await shot('02-preview-cursor')

  // Cursor moves with the music.
  const before = await page.evaluate(() => document.querySelector('[data-engraved-cursor="true"]')?.getBoundingClientRect().left ?? null)
  await sleep(1800)
  const after = await page.evaluate(() => document.querySelector('[data-engraved-cursor="true"]')?.getBoundingClientRect().left ?? null)
  if (before != null && after != null && Math.abs(after - before) > 0.5) {
    pass('the cursor moves with the music', `${Math.round(before)} -> ${Math.round(after)}`)
  } else {
    fail('the cursor moves with the music', `before=${before} after=${after}`)
  }

  // Play Along.
  await page.getByRole('radio', { name: /play along/i }).first().click()
  await sleep(1200)
  const playAlong = await page.evaluate(() => ({
    mode: document.querySelector('.practice-workspace')?.getAttribute('data-mode'),
    status: document.querySelector('.workspace-status')?.textContent?.replace(/\s+/g, ' ').trim(),
  }))
  if (playAlong.mode === 'play-along') {
    pass('Play Along mode engages', playAlong.status)
  } else {
    fail('Play Along mode engages', JSON.stringify(playAlong))
  }
  await shot('03-play-along')

  // Wait For You.
  await page.getByRole('radio', { name: /wait for you/i }).first().click()
  await sleep(1500)
  const wfy = await page.evaluate(() => ({
    mode: document.querySelector('.practice-workspace')?.getAttribute('data-mode'),
    yourTurn: Boolean(document.querySelector('.workspace-your-turn')),
    status: document.querySelector('.workspace-status')?.textContent?.replace(/\s+/g, ' ').trim(),
  }))
  if (wfy.mode === 'wait-for-you' && wfy.yourTurn) {
    pass('Wait For You initializes with a target', wfy.status)
  } else {
    fail('Wait For You initializes with a target', JSON.stringify(wfy))
  }
  await shot('04-wait-for-you')

  // Tempo + seek.
  await page.getByRole('radio', { name: /preview/i }).first().click()
  await sleep(600)
  const tempoBefore = await page.evaluate(() => document.querySelector('.workspace-transport-row')?.textContent?.replace(/\s+/g, ' ').trim() ?? '')
  const seek = page.locator('.workspace-seek-wrap input[type="range"]').first()
  if (await seek.count()) {
    await seek.fill('1.5')
    await sleep(1200)
    const time = await page.evaluate(() => document.querySelector('.workspace-position')?.textContent?.replace(/\s+/g, ' ').trim() ?? '')
    if (/0:0[1-9]|0:0[1-9]\d/.test(time)) {
      pass('seeking moves the practice clock', time.slice(0, 60))
    } else {
      fail('seeking moves the practice clock', time.slice(0, 80))
    }
  } else {
    fail('seeking moves the practice clock', 'no seek control')
  }
  const tempoBtn = page.getByRole('button', { name: /slower|faster|\+|-/i }).first()
  await shot('05-transport')
  void tempoBefore
  void tempoBtn

  // Tools panel (workspace settings) must open and show the arrangement note.
  const settings = page.getByRole('button', { name: /workspace settings/i }).first()
  if (await settings.count()) {
    await settings.click()
    await sleep(900)
    const panel = await page.evaluate(() => (document.querySelector('.workspace-tool-panel')?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 260))
    if (/engraved/i.test(panel)) {
      pass('workspace settings explains the engraved score', panel.slice(0, 120))
    } else {
      fail('workspace settings explains the engraved score', panel.slice(0, 160))
    }
    await shot('06-settings')
    await page.keyboard.press('Escape')
  } else {
    fail('workspace settings explains the engraved score', 'no settings button')
  }
} catch (error) {
  fail('harness', String(error?.stack ?? error).slice(0, 600))
  await shot('99-error')
} finally {
  try { await browser.close() } catch { /* noop */ }
  try { await vite?.close() } catch { /* noop */ }
}

console.log(`\npass=${report.passes.length} fail=${report.failures.length} consoleErrors=${report.consoleErrors.length} pageErrors=${report.pageErrors.length}`)
process.exit(report.failures.length ? 1 : 0)
