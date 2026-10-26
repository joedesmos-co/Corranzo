#!/usr/bin/env node
/**
 * Smoke test for the physical-acceptance page (research only).
 *
 * Launches Chromium with a FAKE audio device (a room-tone WAV) so the real
 * capture + hook plumbing can be verified without hardware. This is NOT
 * hardware acceptance: the report labels the input as simulated.
 *
 * Usage: node scripts/mic-acceptance/smoke.mjs
 */
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const roomTone = join(ROOT, 'benchmarks/mic-accuracy/clips/real-room-quiet.wav')

const viteServer = await createServer({
  root: ROOT,
  configFile: resolve(ROOT, 'vite.config.js'),
  logLevel: 'silent',
  server: { host: '127.0.0.1', port: 0, strictPort: false },
})
await viteServer.listen()
const baseUrl = `http://127.0.0.1:${viteServer.httpServer.address().port}`

const browser = await chromium.launch({
  headless: true,
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${roomTone}`,
    '--autoplay-policy=no-user-gesture-required',
    '--disable-background-timer-throttling',
  ],
})
const page = await browser.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(String(error)))
await page.goto(`${baseUrl}/scripts/mic-acceptance/index.html`, { waitUntil: 'load' })

// The page mounts the real capture; wait for a settled mic status.
await page.waitForFunction(
  () => document.body.innerText.includes('Mic status:') && !document.body.innerText.includes('Mic status: unknown'),
  null,
  { timeout: 30_000, polling: 500 },
)
const status = await page.evaluate(() => {
  const text = document.body.innerText
  const match = /Mic status: ([^\n·]+)/.exec(text)
  return match ? match[1].trim() : null
})

// Walk one step to prove the flow records a result.
await page.getByRole('button', { name: 'Start this step' }).first().click()
await page.waitForTimeout(6_000)
await page.getByRole('button', { name: 'Finish / record result' }).click()
await page.waitForTimeout(500)
const resultText = await page.evaluate(() => {
  const blocks = [...document.querySelectorAll('.result')].map((node) => node.textContent)
  return blocks.join('\n')
})

console.log(JSON.stringify({
  kind: 'mic-acceptance-smoke (SIMULATED INPUT — not hardware acceptance)',
  micStatus: status,
  recordedResult: resultText.includes('advanced='),
  resultPreview: resultText.slice(0, 200),
  pageErrors: errors,
}, null, 1))

await browser.close()
await viteServer.close()
