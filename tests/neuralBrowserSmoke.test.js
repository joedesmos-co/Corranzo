/**
 * Neural browser smoke test (Stage 6, N1/N6) — REAL headless Chromium.
 *
 * Runs ONLY when CORRANZO_NEURAL_VENDOR points at a directory containing
 * @spotify/basic-pitch and @tensorflow/tfjs (see scripts/neural-browser).
 * Skipped otherwise (CI-safe): unit coverage lives in
 * tests/micNeuralStream.test.js.
 *
 * Measures, per clip: model init (fetch+compile), full + chunked TF.js
 * inference, backend, JS heap, and note accuracy on real recordings.
 * Also verifies IndexedDB model round-trip, including a network-blocked
 * reload that proves offline inference. Writes tmp/neural-browser.json
 * (untracked working artifact; headline numbers go in the Stage-6 report).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startNeuralBrowserServer } from '../scripts/neural-browser/server.mjs'
import { preparePatchedVendor } from '../scripts/neural-browser/prepare-vendor.mjs'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const neuralVendor = globalThis.process?.env?.CORRANZO_NEURAL_VENDOR ?? null
const hasVendor = Boolean(neuralVendor)

const CLIPS = [
  { file: 'acoustic-power-dyad.wav', anchor: [49, 56] },
  { file: 'piano-mozart-triad.wav', anchor: [57, 64, 73] },
  { file: 'acoustic-strum-dense.wav', anchor: [45, 52, 57, 60] },
  { file: 'electric-eg10-dense.wav', anchor: [40, 47, 52, 55, 59, 64] },
  { file: 'electric-gtechs-quiet.wav', anchor: [60] },
]

describe.skipIf(!hasVendor)('neural browser smoke (real Chromium + TF.js)', () => {
  let server
  let browser
  let baseUrl
  const measured = { clips: [], offline: null }

  beforeAll(async () => {
    preparePatchedVendor(projectRoot)
    server = await startNeuralBrowserServer(0)
    baseUrl = `http://127.0.0.1:${server.address().port}`
    browser = await chromium.launch({ headless: true })
  }, 60_000)

  afterAll(async () => {
    await browser?.close()
    await new Promise((done) => server?.close(done))
    if (measured.clips.length) {
      writeFileSync(
        join(projectRoot, 'tmp', 'neural-browser.json'),
        JSON.stringify(measured, null, 2),
      )
    }
  })

  async function runPage(query) {
    const page = await browser.newPage()
    await page.goto(`${baseUrl}/harness/page.html?${query}`, { waitUntil: 'load' })
    await page.waitForFunction(() => document.title === 'DONE', null, { timeout: 180_000 })
    const results = await page.evaluate(() => window.__neuralResults)
    await page.close()
    return results
  }

  it('initializes the model and transcribes real clips in-browser', async () => {
    for (const { file, anchor } of CLIPS) {
      const results = await runPage(`clip=${file}&chunked=1`)
      expect(results.status).toBe('done')
      const heard = new Set(results.fullNotes.map((note) => note.midi))
      for (const midi of anchor) {
        expect(heard.has(midi)).toBe(true)
      }
      measured.clips.push({
        file,
        anchor,
        backend: results.backend,
        initMs: results.initMs,
        fullInferMs: results.fullInferMs,
        audioSeconds: results.audioSeconds,
        noteCount: results.fullNotes.length,
        chunkWindows: results.chunked?.windows?.map((window) => ({
          start: window.windowStartSeconds,
          inferMs: Math.round(window.inferMs * 10) / 10,
          noteCount: window.notes.length,
        })),
        heapDeltaBytes: results.heapDeltaBytes,
        tfNumBytes: results.tfNumBytes,
      })
    }
    // Browser runs CPU or WebGL — record whichever executed, never assume.
    expect(['cpu', 'webgl', 'wasm'].includes(measured.clips[0].backend)).toBe(true)
  }, 300_000)

  it('measures the WebGL backend path when available', async () => {
    const results = await runPage(`clip=${CLIPS[0].file}&backend=webgl`)
    expect(results.status).toBe('done')
    // Numeric parity across backends: same anchors must be heard.
    const heard = new Set(results.fullNotes.map((note) => note.midi))
    for (const midi of CLIPS[0].anchor) {
      expect(heard.has(midi)).toBe(true)
    }
    measured.clips.push({
      file: `${CLIPS[0].file} (webgl)`,
      anchor: CLIPS[0].anchor,
      backend: results.backend,
      initMs: results.initMs,
      fullInferMs: results.fullInferMs,
      audioSeconds: results.audioSeconds,
      noteCount: results.fullNotes.length,
      chunkWindows: null,
      heapDeltaBytes: results.heapDeltaBytes,
      tfNumBytes: results.tfNumBytes,
    })
  }, 300_000)

  it('round-trips the model through IndexedDB and reloads it offline', async () => {
    const cached = await runPage(`clip=${CLIPS[0].file}&idbcache=1`)
    expect(cached.status).toBe('done')
    expect(cached.idbCache.reloadOk).toBe(true)

    // One shared browser context: the second page must see the first
    // page's IndexedDB (browser.newPage() would isolate storage).
    const context = await browser.newContext()
    try {
      const seed = await context.newPage()
      await seed.goto(`${baseUrl}/harness/page.html?clip=${CLIPS[0].file}&idbcache=1`, { waitUntil: 'load' })
      await seed.waitForFunction(() => document.title === 'DONE', null, { timeout: 180_000 })
      await seed.close()
      const page = await context.newPage()
      // Model weights blocked (runtime code still loads): only
      // IndexedDB may serve the graph.
      await page.route('**/vendor/bp/model/**', (route) => route.abort())
      await page.goto(`${baseUrl}/harness/page.html?clip=${CLIPS[0].file}&idbonly=1`, { waitUntil: 'load' })
      await page.waitForFunction(() => document.title === 'DONE', null, { timeout: 180_000 })
      const offline = await page.evaluate(() => window.__neuralResults)
      await page.close()
      expect(offline.status).toBe('done')
      const heard = new Set(offline.fullNotes.map((note) => note.midi))
      expect(heard.has(CLIPS[0].anchor[0])).toBe(true)
      expect(heard.has(CLIPS[0].anchor[1])).toBe(true)
      measured.offline = {
        backend: offline.backend,
        loadMs: offline.loadMs,
        fullInferMs: offline.fullInferMs,
        noteCount: offline.fullNotes.length,
      }
    } finally {
      await context.close()
    }
  }, 300_000)
})
