#!/usr/bin/env node
/**
 * Measure click → first scheduled audio source start in a production build.
 * Patches AudioBufferSourceNode/OscillatorNode.start before app code loads so
 * the first real note (sampled or synth) is captured.
 */
import { chromium } from 'playwright'
const args = process.argv.slice(2)
function arg(name, fallback) { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback }
const baseUrl = arg('base', 'http://localhost:5180')
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.addInitScript(() => {
  window.__AUDIO_STARTS__ = []
  const record = (kind, node, args) => {
    window.__AUDIO_STARTS__.push({
      kind,
      at: performance.now(),
      contextTime: node?.context?.currentTime ?? null,
      when: args?.[0] ?? null,
    })
  }
  if (window.AudioBufferSourceNode) {
    const original = AudioBufferSourceNode.prototype.start
    AudioBufferSourceNode.prototype.start = function (...args) {
      record('buffer', this, args)
      return original.apply(this, args)
    }
  }
  if (window.OscillatorNode) {
    const original = OscillatorNode.prototype.start
    OscillatorNode.prototype.start = function (...args) {
      record('oscillator', this, args)
      return original.apply(this, args)
    }
  }
})
await page.goto(`${baseUrl}/#library`, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: /Open score: Hungarian Dance No\. 5/ }).click()
await page.waitForTimeout(8000)
const box = await page.locator('button.workspace-play').boundingBox()
const client = await page.context().newCDPSession(page)
const clickAt = await page.evaluate(() => performance.now())
const x = box.x + box.width / 2
const y = box.y + box.height / 2
await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
await page.waitForTimeout(1500)
const starts = await page.evaluate(() => window.__AUDIO_STARTS__)
const first = starts.find((entry) => entry.at >= clickAt) ?? starts[0] ?? null
const result = {
  clickAt,
  firstAudioStartAt: first?.at ?? null,
  clickToFirstAudioMs: first ? first.at - clickAt : null,
  firstKind: first?.kind ?? null,
  firstContextTime: first?.contextTime ?? null,
  totalStarts: starts.length,
  starts: starts.slice(0, 8),
}
console.log(JSON.stringify(result, null, 2))
await browser.close()
