/**
 * Production microphone live injection tests — REAL Chromium, REAL app
 * capture code, REAL v2 score-informed recognizer, REAL licensed
 * recordings.
 *
 * Audio enters at the microphone/media boundary (decoded clip PCM plays
 * through a MediaStreamAudioDestinationNode whose stream replaces
 * getUserMedia output), so the whole shipped path runs: capture ->
 * analyser -> calibration -> v2 score-informed detection -> confirmation
 * -> canonical practice callback.
 *
 * This is the production counterpart of tests/neuralLiveInjection.test.js
 * (which covers the EXPERIMENTAL neural path). It exists because the
 * shipped recognizer had no MediaStream injection coverage, so the
 * spectral-vs-neural A/B could not be validated in a browser.
 *
 * Labeled injected-stream tests: physical-microphone acceptance remains a
 * separate attended step.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
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

  async function runProductionInjection({ clip, expectedMidis, checkpointId, instrumentId = 'piano', dwellMs = null, waitMs = 90_000 }) {
    const page = await browser.newPage()
    await page.goto(`${baseUrl}/scripts/mic-live/live.html`, { waitUntil: 'load' })
    await page.evaluate(
      ({ samples, sampleRate, expected, checkpoint, instrument }) => window.__liveApi.inject({
        samples,
        sampleRate,
        expectedMidis: expected,
        checkpointId: checkpoint,
        instrumentId: instrument,
      }),
      { samples: clip.samples, sampleRate: clip.sampleRate, expected: expectedMidis, checkpoint: checkpointId, instrument: instrumentId },
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

  it('never falsely completes or mis-reports a chord in the production path', async () => {
    // The real C-major triad currently does NOT complete in the v2
    // collection path: the adaptive analyser noise floor closes the gate
    // on SUSTAINED chords, so the v2 engine reports zero detections while
    // the chord rings (browser-measured). The chord-collection fix (per
    // expected-tone hit counters + polyphonic evidence) is covered by
    // unit tests (tests/micChordPolyphonyEvidence.test.js); what remains
    // is the gate behaviour, tracked in
    // docs/MIC_ENGINE_AB_BENCHMARK.md.
    //
    // This test pins the SAFETY property that must hold either way: the
    // production path must not advance a chord it has not confirmed, and
    // must not report a wrong note for a legitimate chord.
    //
    // When the sustained-chord gate is fixed, INVERT this assertion
    // (expect matched.length >= 1) — the change must be reviewed.
    const clip = loadPolyphonyClip('real-c-major-triad.wav')
    const results = await runProductionInjection({
      clip,
      expectedMidis: [60, 64, 67],
      checkpointId: 'prod-triad',
      dwellMs: 45_000,
    })
    console.log('PROD-TRIAD', JSON.stringify({
      matched: results.matched?.length ?? 0,
      wrong: results.wrong,
      outcome: results.feedbackOutcome,
      mode: results.micEngineMode,
    }))
    expect(results.matched).toHaveLength(0)
    expect(results.wrong).toBe(0)
    expect(results.feedbackOutcome).not.toBe('wrong')
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
    expect(results.feedbackOutcome).not.toBe('complete')
  }, 180_000)
})
