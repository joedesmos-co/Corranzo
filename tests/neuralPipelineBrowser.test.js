/**
 * Neural pipeline browser test (Stage 8, L7) — REAL Chromium, no TF.js.
 *
 * Exercises the experimental notes→feedback modules inside a real
 * browser JS engine on genuine Basic Pitch outputs: stream → confirm →
 * canonical → bounded evaluator. Always runnable (no vendor needed);
 * skipped only when tmp/basicpitch/notes.json is absent (regenerate via
 * the Stage-5 transcribe script).
 *
 * Asserts: true chord completes, wrong chord refused, silence empty,
 * plus in-page pipeline latency.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { chromium } from 'playwright'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startNeuralBrowserServer } from '../scripts/neural-browser/server.mjs'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const hasNotes = existsSync(join(projectRoot, 'tmp', 'basicpitch', 'notes.json'))

describe.skipIf(!hasNotes)('neural pipeline in real browser', () => {
  let server
  let browser
  let baseUrl

  beforeAll(async () => {
    server = await startNeuralBrowserServer(0)
    baseUrl = `http://127.0.0.1:${server.address().port}`
    browser = await chromium.launch({ headless: true })
  }, 60_000)

  afterAll(async () => {
    await browser?.close()
    await new Promise((done) => server?.close(done))
  })

  async function runPipeline(query) {
    const page = await browser.newPage()
    await page.goto(`${baseUrl}/harness/pipeline.html?${query}`, { waitUntil: 'load' })
    await page.waitForFunction(() => document.title === 'DONE', null, { timeout: 60_000 })
    const results = await page.evaluate(() => window.__pipelineResults)
    await page.close()
    return results
  }

  it('completes a real dense chord end to end in-browser', async () => {
    const results = await runPipeline('clip=acoustic-power-dense&expected=42,49,52,58&anchor=0.5')
    expect(results.status).toBe('done')
    expect(results.complete).toBe(true)
    expect(results.outcome).toBe('complete')
    expect(results.pipelineMs).toBeLessThan(2000)
  })

  it('refuses a transposed chord in-browser', async () => {
    const results = await runPipeline('clip=acoustic-power-dense&expected=43,50,53,59&anchor=0.5')
    expect(results.status).toBe('done')
    expect(results.complete).toBe(false)
  })

  it('stays silent on silence in-browser', async () => {
    const results = await runPipeline('clip=pause-mozart&expected=60,64,67&anchor=0.5')
    expect(results.status).toBe('done')
    expect(results.complete).toBe(false)
    expect(results.confirmed).toEqual([])
  })
})
