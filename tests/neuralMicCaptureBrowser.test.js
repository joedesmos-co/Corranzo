/**
 * Neural mic capture browser test (Stage M7) — REAL headless Chromium
 * with the built-in fake audio device (no file, no permission UI).
 *
 * Proves the live capture path the neural hook depends on works in a
 * real browser: permission grant, analyser polling cadence, and the
 * committed silence-skip gate evaluated on live meter frames. Always
 * runnable (no model vendor needed). Recognition on live audio still
 * needs an attended session (file-backed capture hangs headless).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium } from 'playwright'
import { startNeuralBrowserServer } from '../scripts/neural-browser/server.mjs'

describe('neural mic capture in real browser', () => {
  let server
  let browser
  let baseUrl

  beforeAll(async () => {
    server = await startNeuralBrowserServer(0)
    baseUrl = `http://127.0.0.1:${server.address().port}`
    browser = await chromium.launch({
      headless: true,
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    })
  }, 60_000)

  afterAll(async () => {
    await browser?.close()
    await new Promise((done) => server?.close(done))
  })

  it('grants capture, polls analyser frames, and evaluates the silence gate', async () => {
    const page = await browser.newPage()
    await page.goto(`${baseUrl}/harness/mic-probe.html`, { waitUntil: 'load' })
    await page.waitForFunction(() => document.title === 'DONE', null, { timeout: 60_000 })
    const results = await page.evaluate(() => window.__micResults)
    await page.close()
    expect(results.status).toBe('done')
    // ~2 s at 100 ms cadence.
    expect(results.frames).toBeGreaterThanOrEqual(15)
    expect(results.meanRms).toBeGreaterThanOrEqual(0)
    expect(typeof results.skipDecision).toBe('boolean')
    expect(results.sampleRate).toBeGreaterThan(0)
  })
})
