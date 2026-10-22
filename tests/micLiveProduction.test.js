/**
 * Production microphone live injection tests — REAL Chromium, REAL app
 * capture code, REAL v2 score-informed recognizer, REAL recorded audio.
 *
 * Audio enters at the microphone/media boundary (decoded clip PCM plays
 * through a MediaStreamAudioDestinationNode whose stream replaces
 * getUserMedia output), so the whole shipped path runs: capture ->
 * analyser -> calibration -> v2 score-informed detection -> V3 performance
 * expectation -> confirmation -> canonical practice callback.
 *
 * Two chord paths exist and BOTH are pinned here:
 *   - the DEFAULT V3 performance-expectation path (V3 on), and
 *   - the V2 chord-collection fallback (V3 off: `?v3=0`), which is also the
 *     path used for imported scores with no performance expectation.
 *
 * Labelled injected-stream tests: physical-microphone acceptance remains a
 * separate attended step.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWavPcm } from '../scripts/lib/readWavPcm.mjs'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function loadAccuracyClip(file) {
  const wav = readWavPcm(join(projectRoot, 'benchmarks', 'mic-accuracy', 'clips', file))
  return { samples: Array.from(wav.samples), sampleRate: wav.sampleRate }
}

function loadPolyphonyClip(file) {
  const wav = readWavPcm(join(projectRoot, 'benchmarks', 'mic-polyphony', 'clips', file))
  return { samples: Array.from(wav.samples), sampleRate: wav.sampleRate }
}

describe('production mic live injection (v2 score-informed)', () => {
  let viteServer
  let browser
  let baseUrl

  beforeAll(async () => {
    viteServer = await createServer({
      root: projectRoot,
      configFile: resolve(projectRoot, 'vite.config.js'),
      logLevel: 'silent',
      server: { host: '127.0.0.1', port: 0, strictPort: false },
    })
    await viteServer.listen()
    const address = viteServer.httpServer.address()
    baseUrl = `http://127.0.0.1:${address.port}`
    browser = await chromium.launch({
      headless: true,
      args: [
        '--autoplay-policy=no-user-gesture-required',
        // The capture hook polls on a 100 ms interval: a backgrounded
        // headless page is throttled to ~1 Hz, the analyser starves and
        // recognition collapses (measured on the neural harness).
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
      ],
    })
  }, 60_000)

  afterAll(async () => {
    await browser?.close()
    await viteServer?.close()
  })

  async function runProductionInjection({
    clip,
    expectedMidis,
    checkpointId,
    instrumentId = 'piano',
    v3 = null,
    dwellMs = null,
    waitMs = 90_000,
  }) {
    const page = await browser.newPage()
    const query = v3 === null ? '' : `?v3=${v3 ? 1 : 0}`
    await page.goto(`${baseUrl}/scripts/mic-live/live.html${query}`, { waitUntil: 'load' })
    await page.evaluate(
      ({ samples, sampleRate, expected, checkpoint, instrument }) =>
        window.__liveApi.inject({
          samples,
          sampleRate,
          expectedMidis: expected,
          checkpointId: checkpoint,
          instrumentId: instrument,
        }),
      {
        samples: clip.samples,
        sampleRate: clip.sampleRate,
        expected: expectedMidis,
        checkpoint: checkpointId,
        instrument: instrumentId,
      },
    )
    if (dwellMs != null) {
      await page.waitForTimeout(dwellMs)
    } else {
      await page.waitForFunction(
        () => window.__liveResults && (window.__liveResults.matched.length >= 1 || window.__liveResults.wrong > 0),
        null,
        { timeout: waitMs, polling: 1000 },
      )
    }
    const results = await page.evaluate(() => window.__liveResults)
    await page.evaluate(() => window.__liveTeardown?.())
    await page.close()
    return results
  }

  it('advances Wait For You on a correct piano note (production path)', async () => {
    const clip = loadAccuracyClip('real-piano-c4.wav')
    const results = await runProductionInjection({
      clip,
      expectedMidis: [60],
      checkpointId: 'prod-c4',
    })
    expect(results.matched.length).toBeGreaterThanOrEqual(1)
    // Production outcome vocabulary: 'correct' (not 'complete').
    expect(results.feedbackOutcome).toBe('correct')
  }, 180_000)

  it('completes a real piano chord on the DEFAULT V3 path', async () => {
    // The V3 performance-expectation engine owns the chord decision by
    // default. It must emit COMPLETE and advance the checkpoint.
    const clip = loadPolyphonyClip('real-c-major-triad.wav')
    const results = await runProductionInjection({
      clip,
      expectedMidis: [60, 64, 67],
      checkpointId: 'prod-triad-v3',
    })
    expect(results.matched.length).toBeGreaterThanOrEqual(1)
    expect(results.feedbackOutcome).toBe('correct')
    expect(results.micEngineMode).toBe('v3-performance-expectation')
  }, 240_000)

  it('completes a real piano chord on the V2 chord-collection fallback', async () => {
    // Regression: the collection consumed ONE monophonic pitch per frame
    // and kept a single pending index, so a real three-note chord never
    // completed (browser-measured: "Heard: C4 + E4 - need G4"). This is
    // the path used when V3 is off and for imported scores with no
    // performance expectation.
    const clip = loadPolyphonyClip('real-c-major-triad.wav')
    const results = await runProductionInjection({
      clip,
      expectedMidis: [60, 64, 67],
      checkpointId: 'prod-triad-v2',
      v3: false,
    })
    expect(results.matched.length).toBeGreaterThanOrEqual(1)
    expect(results.feedbackOutcome).toBe('correct')
  }, 240_000)

  it('never falsely completes a chord it has not heard (V2 collection path)', async () => {
    // SAFETY: only two of the three triad tones are played. The checkpoint
    // must NOT advance and must not be reported as wrong.
    const clip = loadPolyphonyClip('uiowa-piano-mf-c4-e4-dyad.wav')
    const results = await runProductionInjection({
      clip,
      expectedMidis: [60, 64, 67],
      checkpointId: 'prod-partial-v2',
      v3: false,
      dwellMs: 40_000,
    })
    expect(results.matched).toHaveLength(0)
    expect(results.wrong).toBe(0)
    expect(results.feedbackOutcome).not.toBe('correct')
  }, 180_000)

  it('does not advance on room noise (production path)', async () => {
    const clip = loadAccuracyClip('real-room-noisy.wav')
    const results = await runProductionInjection({
      clip,
      expectedMidis: [60],
      checkpointId: 'prod-noise',
      dwellMs: 30_000,
    })
    expect(results.matched).toHaveLength(0)
    expect(results.feedbackOutcome).not.toBe('correct')
  }, 180_000)
})
