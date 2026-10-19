#!/usr/bin/env node
/**
 * Diagnostic: what does the session actually persist for an Audio Vision
 * arrangement, and what does a reload restore?
 *
 * Usage: E2E_PORT=5614 node scripts/browser-audio-vision-session-probe.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const outDir = join(root, 'tmp', 'audio-vision-session-probe')
const PORT = Number(process.env.E2E_PORT ?? 5614)
const baseUrl = `http://127.0.0.1:${PORT}/`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function writeFigureWav(path, seconds = 3) {
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

const readMeta = (page) => page.evaluate(() => {
  const raw = localStorage.getItem('scoreflow-session-meta-v1')
  if (!raw) return { raw: null }
  try {
    const parsed = JSON.parse(raw)
    const m = parsed?.meta ?? parsed
    return {
      raw: raw.slice(0, 400),
      activeViewRaw: m?.activeView ?? null,
      topKeys: Object.keys(parsed ?? {}),
      activeView: m?.activeView ?? null,
      pdfFileName: m?.pdfMeta?.fileName ?? null,
      musicXmlFileName: m?.musicXmlFileName ?? null,
      musicXmlSourceKind: m?.musicXmlSourceKind ?? null,
      musicXmlSize: m?.musicXmlSize ?? null,
      commitId: m?.commitId ?? null,
      instrumentId: m?.instrumentId ?? null,
    }
  } catch (error) {
    return { error: String(error) }
  }
})

const readStore = (page) => page.evaluate(async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('scoreflow-session')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
  })
  const entries = await new Promise((resolve, reject) => {
    const tx = db.transaction('files', 'readonly')
    const store = tx.objectStore('files')
    const keysReq = store.getAllKeys()
    const valuesReq = store.getAll()
    tx.oncomplete = () => resolve(keysReq.result.map((key, i) => [key, valuesReq.result[i]?.byteLength ?? 0]))
    tx.onerror = () => reject(tx.error)
  })
  return entries
})

await mkdir(outDir, { recursive: true })
const wavPath = await writeFigureWav(join(outDir, 'figure.wav'))
const pdfFixture = join(root, 'public', 'fixtures', 'demo-minuet-in-g.pdf')

const vite = await createServer({
  root,
  configFile: join(root, 'vite.config.js'),
  logLevel: 'silent',
  server: { host: '127.0.0.1', port: PORT, strictPort: true },
})
await vite.listen()
await sleep(800)

const { chromium } = await import('playwright')
const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] })
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await context.newPage()
const out = { steps: [] }
const step = async (label) => {
  const meta = await readMeta(page)
  const store = await readStore(page)
  out.steps.push({ label, meta, store })
  console.log(label, JSON.stringify(meta), JSON.stringify(store))
}

try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await sleep(2500)
  // Import a PDF first, exactly as the bug report described.
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('nav button')].find((el) =>
      el.textContent?.replace(/^\s*\d+/, '').replace(/\s+/g, ' ').trim() === 'Import')
    button?.click()
  })
  await sleep(900)
  await page.locator('input[type="file"][aria-label="Choose score PDF"]').first().setInputFiles(pdfFixture)
  await sleep(4000)
  await step('after-pdf-import')

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
  await page.getByRole('button', { name: /arrange for/i }).click()
  await page.getByText('Your arrangement is ready', { exact: false }).first().waitFor({ timeout: 300000 })
  await step('after-generation')

  await page.getByRole('button', { name: /open in corranzo practice/i }).click()
  await page.getByText('Arranged from your recording', { exact: false }).first().waitFor({ timeout: 60000 })
  await step('after-open-arrangement')

  await page.getByRole('button', { name: /open score/i }).click()
  await page.getByText(/all targets/i).first().waitFor({ timeout: 90000 })
  await step('after-open-score')
  await sleep(3000)
  await step('after-3s')
} catch (error) {
  out.error = String(error?.stack ?? error)
  console.error(out.error)
} finally {
  try { await browser.close() } catch { /* noop */ }
  try { await vite.close() } catch { /* noop */ }
}

await writeFile(join(outDir, 'report.json'), JSON.stringify(out, null, 2))
