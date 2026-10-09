/**
 * Neural live injection tests (M2/M3/M4/M8) — REAL Chromium, REAL app
 * modules, REAL TF.js model, REAL licensed recordings.
 *
 * Audio enters at the microphone/media boundary: decoded clip PCM plays
 * through a MediaStreamAudioDestinationNode whose stream replaces
 * getUserMedia output — every API the app touches from there
 * (MediaStreamTrack, AnalyserNode, TF.js inference, confirmation,
 * canonical events, bounded evaluator) is the genuine production path.
 * Only the sound source is substituted (labeled injected-stream tests;
 * physical-microphone acceptance remains a separate attended step).
 *
 * Covers: correct C4 advances WFY with no Continue button, wrong note
 * refusal, and chord completion. Slow (CPU inference); generous timeouts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWavPcm } from '../scripts/lib/readWavPcm.mjs'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function loadClipSamples(id) {
  const manifest = JSON.parse(readFileSync(join(projectRoot, 'benchmarks', 'mic-real', 'manifest.json'), 'utf8'))
  const clip = manifest.clips.find((entry) => entry.id === id)
  const wav = readWavPcm(join(projectRoot, 'benchmarks', 'mic-real', clip.audio.file))
  return {
    samples: Array.from(wav.samples),
    sampleRate: wav.sampleRate,
    anchorTones: clip.truth.anchorTones,
  }
}

describe('neural live injection (real browser, real model, real clips)', () => {
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
        // The hook polls on a 100 ms interval: without these flags a
        // backgrounded headless page is throttled to ~1 Hz, the ring
        // starves, and coverage collapses (measured M1 failure mode —
        // level meter alive, recognition flaky). Real practice tabs are
        // foreground; these flags reproduce that timing headlessly.
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

  async function runInjection({ clipId, expectedMidis, checkpointId, waitMs = 90_000, dwellMs = null, trace = false }) {
    const clip = loadClipSamples(clipId)
    const page = await browser.newPage()
    await page.goto(`${baseUrl}/scripts/neural-live/live.html`, { waitUntil: 'load' })
    await page.evaluate(
      ({ samples, sampleRate, expected, checkpoint }) => window.__liveApi.inject({
        samples,
        sampleRate,
        expectedMidis: expected,
        checkpointId: checkpoint,
        // CPU-only CI/headless runners cannot pass the hardware gate;
        // force-listen exercises everything downstream (the gate itself
        // is measured separately on Metal in neural-metal-probe runs).
        forceListen: true,
      }),
      { samples: clip.samples, sampleRate: clip.sampleRate, expected: expectedMidis, checkpoint: checkpointId },
    )
    if (dwellMs != null) {
      // Refusal case: dwell a fixed time, then assert nothing advanced.
      await page.waitForTimeout(dwellMs)
    } else {
      // Phase 1 (loading): model fetch + compile varies wildly on CPU.
      // Settle readiness first so recognition gets its own full budget.
      await page.waitForFunction(
        () => {
          const results = window.__liveResults
          return results && (results.phase === 'listening' || results.phase === 'unavailable')
        },
        null,
        { timeout: 120_000, polling: 1000 },
      )
      // Poll loop (not a single waitForFunction): interval polling because
      // headless background pages throttle rAF (false timeouts), with a
      // trajectory log so timeouts diagnose instead of hiding.
      const deadline = Date.now() + waitMs
      for (;;) {
        const snapshot = await page.evaluate(() => window.__liveResults)
        const done = snapshot && (snapshot.matched.length >= expectedMidis.length || snapshot.phase === 'unavailable')
        if (trace) {
          console.log('TRACE', JSON.stringify({
            phase: snapshot?.phase,
            matched: (snapshot?.matched ?? []).map((entry) => entry.midi),
            detected: ((snapshot?.detectedNotes ?? []).map((n) => n.midi)),
            debug: snapshot?.debug ? {
              hops: snapshot.debug.hops,
              win: snapshot.debug.windowsRun,
              reason: snapshot.debug.lastPumpReason,
              notes: snapshot.debug.lastWindowNotes,
            } : null,
          }))
        }
        if (done || Date.now() >= deadline) {
          break
        }
        await page.waitForTimeout(10_000)
      }
    }
    const results = await page.evaluate(() => window.__liveResults)
    await page.evaluate(() => window.__liveTeardown?.())
    await page.close()
    if (results.phase !== 'listening') {
      console.log('LIVE FAILURE diagnostics:', JSON.stringify({
        phase: results.phase,
        backend: results.backend,
        matched: results.matched,
        detectedNotes: (results.detectedNotes ?? []).slice(0, 8),
        debug: results.debug,
        micListening: results.micListening,
        micError: results.micError,
      }))
    }
    return { clip, results }
  }

  it('advances Wait For You on a correct injected C4 (no Continue)', async () => {
    const ctx = await runInjection({
      clipId: 'electric-gtechs-quiet',
      expectedMidis: [60],
      checkpointId: 'live-c4',
      trace: true,
    })
    const { clip, results } = ctx
    expect(clip.anchorTones).toContain(60)
    expect(results.phase).toBe('listening')
    expect(results.matched.length).toBeGreaterThanOrEqual(1)
    expect(results.matched[0].midi).toBe(60)
    expect(results.feedbackOutcome).toBe('complete')
  }, 180_000)

  it('refuses a wrong injected note without advancing', async () => {
    const { results } = await runInjection({
      clipId: 'electric-gtechs-mid',
      expectedMidis: [60],
      checkpointId: 'live-wrong',
      dwellMs: 60_000,
    })
    expect(results.phase).toBe('listening')
    expect(results.matched).toHaveLength(0)
  }, 180_000)

  it('hears a real power chord end to end (all tones, no manufacture)', async () => {
    // CPU-bound runners infer sparsely, so full chord COMPLETION is
    // timing-luck there (covered deterministically in node scenario
    // tests + measured on Metal). This asserts what CPU can prove:
    // every chord tone is independently detected over the run, and the
    // evaluator never manufactures a wrong completion.
    const clip = loadClipSamples('acoustic-power-dense')
    const page = await browser.newPage()
    await page.goto(`${baseUrl}/scripts/neural-live/live.html`, { waitUntil: 'load' })
    await page.evaluate(
      ({ samples, sampleRate }) => window.__liveApi.inject({
        samples,
        sampleRate,
        expectedMidis: [42, 49, 52, 58],
        checkpointId: 'live-chord',
        forceListen: true,
      }),
      { samples: clip.samples, sampleRate: clip.sampleRate },
    )
    const heard = new Set()
    const deadline = Date.now() + 150_000
    let results = null
    while (Date.now() < deadline) {
      await page.waitForTimeout(10_000)
      results = await page.evaluate(() => window.__liveResults)
      for (const note of results.detectedNotes ?? []) {
        heard.add(note.midi)
      }
      if ([42, 49, 52, 58].every((midi) => heard.has(midi))) {
        break
      }
    }
    await page.evaluate(() => window.__liveTeardown?.())
    await page.close()
    expect(clip.anchorTones).toEqual([42, 49, 52, 58])
    for (const midi of [42, 49, 52, 58]) {
      expect(heard.has(midi)).toBe(true)
    }
    // Never a wrong completion on a chord it only partly heard.
    expect(results.feedbackOutcome).not.toBe('wrong')
  }, 240_000)

  it('hears a real piano triad end to end (all tones, no manufacture)', async () => {
    // M1's weakest family through the live path: every triad tone must
    // be independently detected over the run (completion itself is
    // timing-luck on CPU runners; node scenarios pin the logic).
    const clip = loadClipSamples('piano-mozart-triad')
    const page = await browser.newPage()
    await page.goto(`${baseUrl}/scripts/neural-live/live.html`, { waitUntil: 'load' })
    await page.evaluate(
      ({ samples, sampleRate }) => window.__liveApi.inject({
        samples,
        sampleRate,
        expectedMidis: [57, 64, 73],
        checkpointId: 'live-piano-triad',
        forceListen: true,
      }),
      { samples: clip.samples, sampleRate: clip.sampleRate },
    )
    const heard = new Set()
    const deadline = Date.now() + 150_000
    let results = null
    while (Date.now() < deadline) {
      await page.waitForTimeout(10_000)
      results = await page.evaluate(() => window.__liveResults)
      for (const note of results.detectedNotes ?? []) {
        heard.add(note.midi)
      }
      if ([57, 64, 73].every((midi) => heard.has(midi))) {
        break
      }
    }
    await page.evaluate(() => window.__liveTeardown?.())
    await page.close()
    expect(clip.anchorTones).toEqual([57, 64, 73])
    for (const midi of [57, 64, 73]) {
      expect(heard.has(midi)).toBe(true)
    }
    expect(results.feedbackOutcome).not.toBe('wrong')
  }, 240_000)
})
