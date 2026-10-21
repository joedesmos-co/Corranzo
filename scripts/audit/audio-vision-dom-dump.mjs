#!/usr/bin/env node
/**
 * Dump the engraved (OSMD) SVG structure of a generated Audio Vision
 * arrangement, so the engraving checks can be written against the real DOM
 * instead of guesses.
 *
 *   node scripts/audit/audio-vision-dom-dump.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..', '..')
const outDir = join(root, 'tmp', 'audio-vision-dom')
await mkdir(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function writeFigureWav(path, seconds = 4) {
  const SR = 44100
  const data = new Float32Array(SR * seconds)
  const seq = [57, 61, 64, 69, 64, 61]
  for (let i = 0; i < data.length; i += 1) {
    const t = i / SR
    const idx = Math.min(seq.length - 1, Math.floor(t / (seconds / seq.length)))
    data[i] = Math.sin(2 * Math.PI * 440 * Math.pow(2, (seq[idx] - 69) / 12) * t) * 0.4
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length * 2, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(SR, 24)
  header.writeUInt32LE(SR * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length * 2, 40)
  const pcm = Buffer.alloc(data.length * 2)
  for (let i = 0; i < data.length; i += 1) pcm.writeInt16LE(Math.max(-1, Math.min(1, data[i])) * 32767, i * 2)
  await writeFile(path, Buffer.concat([header, pcm]))
}

const PORT = Number(process.env.E2E_PORT ?? 5671)
const server = await createServer({ root, server: { port: PORT, host: '127.0.0.1' } })
await server.listen()
const { chromium } = await import('playwright')
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
const page = await context.newPage()
const wav = join(outDir, 'figure.wav')
await writeFigureWav(wav)

try {
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await sleep(3000)
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('nav button')].find((el) => /library/i.test(el.textContent ?? ''))
    button?.click()
  })
  await sleep(1200)
  const uploadsTab = page.getByRole('tab', { name: /my uploads/i })
  if (await uploadsTab.count()) { await uploadsTab.click(); await sleep(800) }
  await page.getByText('Create from audio', { exact: false }).first().waitFor({ timeout: 30000 })
  await page.locator('.audio-vision-card input[type="file"]').setInputFiles(wav)
  await page.getByText(/recording length/i).first().waitFor({ timeout: 90000 })
  await page.locator('.audio-vision-card input[name="audio-vision-target"][value="solo-guitar"]').check()
  await page.getByRole('button', { name: /arrange for/i }).click()
  await page.getByText('Your arrangement is ready', { exact: false }).first().waitFor({ timeout: 420000 })
  await page.getByRole('button', { name: /open in corranzo practice/i }).click()
  await page.getByText('Arranged from your recording', { exact: false }).first().waitFor({ timeout: 60000 })
  await page.getByRole('button', { name: /open score/i }).click()
  await page.locator('.osmd-score__container[data-osmd-ready="true"]').first().waitFor({ timeout: 120000 })
  await sleep(1500)

  const dump = await page.evaluate(() => {
    const container = document.querySelector('.osmd-score__container')
    const svg = container?.querySelector('svg')
    const rect = svg?.getBoundingClientRect()
    const classes = new Set()
    for (const el of svg?.querySelectorAll('g') ?? []) {
      const c = el.getAttribute('class')
      if (c) classes.add(c)
    }
    const staffGroups = [...(svg?.querySelectorAll('g.vf-staff, g[class*="vf-staff"]') ?? [])].map((g) => {
      const r = g.getBoundingClientRect()
      return { class: g.getAttribute('class'), top: Math.round(r.top), height: Math.round(r.height), left: Math.round(r.left), width: Math.round(r.width) }
    })
    const noteGroups = [...(svg?.querySelectorAll('g.vf-stavenote') ?? [])].slice(0, 6).map((g) => {
      const r = g.getBoundingClientRect()
      return { class: g.getAttribute('class'), top: Math.round(r.top), height: Math.round(r.height), left: Math.round(r.left), width: Math.round(r.width), paths: g.querySelectorAll('path').length }
    })
    const heads = [...(svg?.querySelectorAll('g.vf-stavenote path') ?? [])].slice(0, 8).map((p) => {
      const r = p.getBoundingClientRect()
      return { cls: p.getAttribute('class'), top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) }
    })
    return {
      containerClasses: container?.className,
      svgRect: rect ? { top: Math.round(rect.top), left: Math.round(rect.left), width: Math.round(rect.width), height: Math.round(rect.height) } : null,
      viewBox: svg?.getAttribute('viewBox'),
      svgAttrWidth: svg?.getAttribute('width'),
      groupClasses: [...classes].slice(0, 40),
      staffGroups,
      noteGroups,
      heads,
    }
  })
  console.log(JSON.stringify(dump, null, 2))
  await writeFile(join(outDir, 'dom.json'), JSON.stringify(dump, null, 2))
  await page.screenshot({ path: join(outDir, 'arrangement.png') })
} catch (e) {
  console.log(String(e.stack ?? e))
} finally {
  await context.close()
  await browser.close()
  await server.close()
}
