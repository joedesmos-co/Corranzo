/**
 * A8 — Full product-path UI acceptance in real Chromium.
 *
 * Drives the actual user flow with a generated 3 s guitar-figure WAV:
 *  Library → My Uploads → Create from audio → upload → Solo Guitar/Easy →
 *  Arrange → review → Open in Corranzo Practice → import banner → Open score
 *  → practice view with checkpoints. Screenshots at each stage.
 * No ground-truth injection; the app analyzes the uploaded file for real
 * (browser Basic Pitch path, CPU backend headless).
 *
 * Usage: E2E_PORT=5593 node scripts/browser-audio-vision-uiflow.mjs
 * Output: tmp/audio-vision-uiflow/{report.json,*.png}
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const outDir = join(root, 'tmp', 'audio-vision-uiflow')
const PORT = Number(process.env.E2E_PORT ?? 5593)

const report = { pass: [], fail: [], startedAt: new Date().toISOString() }
function pass(name, detail = '') {
  report.pass.push({ name, detail })
  console.log(`PASS ${name} ${detail}`)
}
function fail(name, detail = '') {
  report.fail.push({ name, detail })
  console.log(`FAIL ${name} ${detail}`)
}
async function shot(page, name) {
  try {
    await page.screenshot({ path: join(outDir, `${name}.png`) })
  } catch { /* noop */ }
}

/** Original 3 s guitar-figure WAV (A2–E4 arpeggio @120 BPM + clicks). */
async function writeFixtureWav(path) {
  const SR = 44100
  const DUR = 3
  const data = new Float32Array(SR * DUR)
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
  for (let b = 0; b < 6; b += 1) {
    tone(seq[b % seq.length], b * beat, 0.45)
    const s0 = Math.floor(b * beat * SR)
    for (let i = 0; i < 300 && s0 + i < data.length; i += 1) {
      data[s0 + i] += 0.35 * Math.exp(-i / 40) * Math.sin((2 * Math.PI * 150 * i) / SR)
    }
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
const wavPath = await writeFixtureWav(join(outDir, 'uiflow-figure.wav'))
const vite = await createServer({ root, server: { port: PORT, strictPort: true, host: '127.0.0.1' }, logLevel: 'silent' })
await vite.listen()
await new Promise((r) => setTimeout(r, 800))
const baseUrl = `http://127.0.0.1:${PORT}/`

let browser = null
try {
  const { chromium } = await import('playwright')
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
  const page = await browser.newPage()
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(2500)

  // 1. Library via sidebar.
  const libraryBtn = page.getByRole('button', { name: /library/i }).first()
  if ((await libraryBtn.count()) === 0) {
    fail('library navigation', 'no Library button')
    throw new Error('no-library')
  }
  await libraryBtn.click()
  await page.waitForTimeout(1200)
  pass('library navigation')

  // 2. My Uploads tab.
  const uploadsTab = page.getByRole('tab', { name: /my uploads/i })
  if ((await uploadsTab.count()) > 0) {
    await uploadsTab.click()
    await page.waitForTimeout(800)
  }
  const createCard = page.getByText('Create from audio', { exact: false }).first()
  if ((await createCard.count()) === 0) {
    fail('create-from-audio visible', 'card not found')
    throw new Error('no-card')
  }
  pass('create-from-audio visible')
  await shot(page, '01-create-card')

  // 3. Upload the fixture WAV.
  const fileInput = page.locator('.audio-vision-card input[type="file"]')
  await fileInput.setInputFiles(wavPath)
  await page.getByText(/recording length/i).first().waitFor({ timeout: 30000 })
  pass('upload + duration probe')
  await shot(page, '02-uploaded')

  // 4. Solo Guitar + Easy, then arrange.
  await page.locator('.audio-vision-card input[name="audio-vision-target"][value="solo-guitar"]').check()
  await page.locator('.audio-vision-card input[name="audio-vision-difficulty"][value="easy"]').check()
  await page.getByRole('button', { name: /arrange for solo guitar/i }).click()
  await page.getByText('Your arrangement is ready', { exact: false }).first().waitFor({ timeout: 240000 })
  pass('arrangement review reached')
  await shot(page, '03-review')

  // 5. Open in Corranzo Practice -> import banner.
  await page.getByRole('button', { name: /open in corranzo practice/i }).click()
  await page.getByText('Arranged from your recording', { exact: false }).first().waitFor({ timeout: 30000 })
  pass('import view arrangement banner')
  await shot(page, '04-import')

  // 6. Open score -> arrangement practice surface (modes, transport, targets).
  await page.getByRole('button', { name: /open score/i }).click()
  await page.getByText(/all targets/i).first().waitFor({ timeout: 60000 })
  const playBtn = page.getByRole('button', { name: /^play$/i })
  const targetCard = page.getByText(/now (hear|play)/i).first()
  const playCount = await playBtn.count()
  const targetCount = await targetCard.count()
  await shot(page, '05-practice')
  if (playCount >= 1 && targetCount >= 1) {
    pass('arrangement practice surface', 'transport + targets, no PDF needed')
  } else {
    fail('arrangement practice surface', `play=${playCount} target=${targetCount}`)
  }

  // 7. Transport engages the shared playback engine (Pause appears = playing).
  await playBtn.first().click()
  await page.getByRole('button', { name: /^pause$/i }).first().waitFor({ timeout: 30000 })
  pass('practice transport plays arrangement')
  await shot(page, '06-playing')
} catch (error) {
  fail('uiflow harness', String(error?.message ?? error).slice(0, 250))
  try {
    const pages = browser ? await browser.contexts().then((c) => c[0]?.pages() ?? []) : []
    if (pages[0]) await shot(pages[0], '99-error')
  } catch { /* noop */ }
} finally {
  try { await browser?.close() } catch { /* noop */ }
  try { await vite.close() } catch { /* noop */ }
}

report.finishedAt = new Date().toISOString()
await writeFile(join(outDir, 'report.json'), JSON.stringify(report, null, 2))
console.log(`\npass=${report.pass.length} fail=${report.fail.length}`)
process.exit(report.fail.length ? 1 : 0)
