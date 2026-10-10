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
import { synthSpeech } from '../src/features/microphone-input/micSyntheticClips.js'

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

function loadAccuracyClip(file, sampleRate = 44100) {
  const wav = readWavPcm(join(projectRoot, 'benchmarks', 'mic-accuracy', 'clips', file))
  return { samples: Array.from(wav.samples), sampleRate: wav.sampleRate }
}

function loadCompositeClip(id) {
  const manifest = JSON.parse(readFileSync(join(projectRoot, 'benchmarks', 'mic-composites', 'manifest.json'), 'utf8'))
  const clip = manifest.clips.find((entry) => entry.id === id)
  const wav = readWavPcm(join(projectRoot, 'benchmarks', 'mic-composites', clip.audio.file))
  return {
    samples: Array.from(wav.samples),
    sampleRate: wav.sampleRate,
    anchorTones: clip.truth.anchorTones,
    truthNotes: clip.truth.notes,
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
        // WebGL via SwiftShader (same as the corpus benchmark): the
        // TF.js model runs on the 'webgl' backend with benchmark-parity
        // recall. Without these flags headless Chromium has no GL and
        // TF.js falls back to 'cpu' (~3x slower inference, systematically
        // worse recall on weak fundamentals — measured: E2 never heard
        // in 150 s, strum interior collapses to one string).
        '--use-gl=angle',
        '--use-angle=swiftshader',
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
      // Poll faster than the 4 s pool retention: pool entries age out
      // truthfully now (no more frozen slow-clock pool), so sparse
      // polling would miss tones between retention windows.
      await page.waitForTimeout(2_000)
      results = await page.evaluate(() => window.__liveResults)
      for (const note of results.detectedNotes ?? []) {
        heard.add(note.midi)
      }
      if ([42, 49, 52, 58].every((midi) => heard.has(midi))) {
        break
      }
    }
    console.log('POWER-HEARD', JSON.stringify({ heard: [...heard], backend: results.backend, inferMs: results.debug?.lastInferMs ?? null, reason: results.debug?.lastPumpReason ?? null }))
    await page.evaluate(() => window.__liveTeardown?.())
    await page.close()
    expect(clip.anchorTones).toEqual([42, 49, 52, 58])
    for (const midi of [42, 49, 52, 58]) {
      expect(heard.has(midi)).toBe(true)
    }
    // Never a wrong completion on a chord it only partly heard.
    expect(results.feedbackOutcome).not.toBe('wrong')
  }, 240_000)

  it('hears a real piano triad end to end (all tones, no manufacture)', async () => {    // M1's weakest family through the live path: every triad tone must
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
      // Same 2 s polling as above: pool retention is 4 s by design.
      await page.waitForTimeout(2_000)
      results = await page.evaluate(() => window.__liveResults)
      for (const note of results.detectedNotes ?? []) {
        heard.add(note.midi)
      }
      if ([57, 64, 73].every((midi) => heard.has(midi))) {
        break
      }
    }
    console.log('TRIAD-HEARD', JSON.stringify({ heard: [...heard], backend: results.backend, inferMs: results.debug?.lastInferMs ?? null, reason: results.debug?.lastPumpReason ?? null }))
    await page.evaluate(() => window.__liveTeardown?.())
    await page.close()
    expect(clip.anchorTones).toEqual([57, 64, 73])
    for (const midi of [57, 64, 73]) {
      expect(heard.has(midi)).toBe(true)
    }
    expect(results.feedbackOutcome).not.toBe('wrong')
  }, 240_000)

  it('leaves a partial triad incomplete (one tone is not the chord)', async () => {
    const clip = loadAccuracyClip('real-piano-c4.wav')
    const page = await browser.newPage()
    await page.goto(`${baseUrl}/scripts/neural-live/live.html`, { waitUntil: 'load' })
    await page.evaluate(
      ({ samples, sampleRate }) => window.__liveApi.inject({
        samples,
        sampleRate,
        expectedMidis: [60, 64, 67],
        checkpointId: 'live-partial',
        forceListen: true,
      }),
      { samples: clip.samples, sampleRate: clip.sampleRate },
    )
    await page.waitForFunction(
      () => window.__liveResults && window.__liveResults.phase === 'listening',
      null,
      { timeout: 120_000, polling: 1000 },
    )
    await page.waitForTimeout(45_000)
    const results = await page.evaluate(() => window.__liveResults)
    await page.evaluate(() => window.__liveTeardown?.())
    await page.close()
    expect(results.phase).toBe('listening')
    // C4 is heard (detected) but the triad checkpoint must NOT complete:
    // matched[] only records full completions.
    expect(results.detectedNotes.map((note) => note.midi)).toContain(60)
    expect(results.matched).toHaveLength(0)
    expect(results.feedbackOutcome).not.toBe('complete')
  }, 240_000)

  it('never advances on room silence', async () => {
    const clip = loadAccuracyClip('real-room-quiet.wav')
    const page = await browser.newPage()
    await page.goto(`${baseUrl}/scripts/neural-live/live.html`, { waitUntil: 'load' })
    await page.evaluate(
      ({ samples, sampleRate }) => window.__liveApi.inject({
        samples,
        sampleRate,
        expectedMidis: [60],
        checkpointId: 'live-silence',
        forceListen: true,
      }),
      { samples: clip.samples, sampleRate: clip.sampleRate },
    )
    await page.waitForFunction(
      () => window.__liveResults && window.__liveResults.phase === 'listening',
      null,
      { timeout: 120_000, polling: 1000 },
    )
    await page.waitForTimeout(30_000)
    const results = await page.evaluate(() => window.__liveResults)
    console.log('SILENCE-RESULT', JSON.stringify({ matched: results.matched, detected: (results.detectedNotes ?? []).map((n) => n.midi), backend: results.backend }))
    await page.evaluate(() => window.__liveTeardown?.())
    await page.close()
    expect(results.phase).toBe('listening')
    expect(results.matched).toHaveLength(0)
    expect(results.feedbackOutcome).not.toBe('complete')
  }, 240_000)

  it('does not advance on speech-like non-musical audio', async () => {
    const speech = synthSpeech(44100, 3.0, { seed: 7 })
    const page = await browser.newPage()
    await page.goto(`${baseUrl}/scripts/neural-live/live.html`, { waitUntil: 'load' })
    await page.evaluate(
      ({ samples, sampleRate }) => window.__liveApi.inject({
        samples,
        sampleRate,
        expectedMidis: [60],
        checkpointId: 'live-speech',
        forceListen: true,
      }),
      { samples: Array.from(speech), sampleRate: 44100 },
    )
    await page.waitForFunction(
      () => window.__liveResults && window.__liveResults.phase === 'listening',
      null,
      { timeout: 120_000, polling: 1000 },
    )
    await page.waitForTimeout(45_000)
    const results = await page.evaluate(() => window.__liveResults)
    await page.evaluate(() => window.__liveTeardown?.())
    await page.close()
    expect(results.phase).toBe('listening')
    expect(results.matched).toHaveLength(0)
    expect(results.feedbackOutcome).not.toBe('complete')
  }, 240_000)

  it('awards a repeated note exactly once per attack (no duplicates)', async () => {
    const clip = loadAccuracyClip('real-piano-c4.wav')
    const page = await browser.newPage()
    await page.goto(`${baseUrl}/scripts/neural-live/live.html`, { waitUntil: 'load' })
    await page.evaluate(
      ({ samples, sampleRate }) => window.__liveApi.inject({
        samples,
        sampleRate,
        expectedMidis: [60],
        checkpointId: 'live-once',
        forceListen: true,
      }),
      { samples: clip.samples, sampleRate: clip.sampleRate },
    )
    await page.waitForFunction(
      () => window.__liveResults && (window.__liveResults.matched.length >= 1 || window.__liveResults.phase === 'unavailable'),
      null,
      { timeout: 150_000, polling: 2000 },
    )
    // One attack keeps ringing through the looped clip: still one award.
    await page.waitForTimeout(25_000)
    const results = await page.evaluate(() => window.__liveResults)
    await page.evaluate(() => window.__liveTeardown?.())
    await page.close()
    expect(results.matched.filter((entry) => entry.midi === 60)).toHaveLength(1)
  }, 240_000)

  it('survives a WFY to Play Along switch on the shared ring (no starvation)', async () => {
    const clip = loadAccuracyClip('real-piano-c4.wav')
    const page = await browser.newPage()
    await page.goto(`${baseUrl}/scripts/neural-live/live.html`, { waitUntil: 'load' })
    await page.evaluate(
      ({ samples, sampleRate }) => window.__liveApi.inject({
        samples,
        sampleRate,
        expectedMidis: [60],
        checkpointId: 'live-switch-wfy',
        forceListen: true,
        keepAudio: true,
      }),
      { samples: clip.samples, sampleRate: clip.sampleRate },
    )
    await page.waitForFunction(
      () => window.__liveResults && window.__liveResults.matched.length >= 1,
      null,
      { timeout: 150_000, polling: 2000 },
    )
    // Switch modes: unmount WFY, remount Play Along on the same ring +
    // the same looping audio (capture stream survives via grace).
    await page.evaluate(() => {
      window.__liveInject = { checkpoint: { id: 'live-switch-pa', expectedMidis: [60] } }
      window.__liveApi.unmount()
      window.__liveApi.mount({ performanceMode: 'play-along' })
    })
    await page.waitForFunction(
      () => {
        const results = window.__liveResults
        return results && results.phase === 'listening' && results.debug && results.debug.lastRingAdopted === true
      },
      null,
      { timeout: 120_000, polling: 1000 },
    )
    // Recognition continues on the adopted ring: Play Along events flow
    // without waiting for a refill + renegotiation cycle.
    await page.waitForFunction(
      () => (window.__liveApi.playAlongEvents() ?? []).length >= 1,
      null,
      { timeout: 120_000, polling: 2000 },
    )
    const adopted = await page.evaluate(() => window.__liveResults.debug.lastRingAdopted)
    const reasons = await page.evaluate(() => window.__liveResults.debug.lastPumpReason)
    await page.evaluate(() => window.__liveTeardown?.())
    await page.close()
    expect(adopted).toBe(true)
    expect(reasons).not.toMatch(/^starved/)
  }, 300_000)

  it('survives a Play Along to WFY switch on the shared ring (reverse)', async () => {
    const clip = loadAccuracyClip('real-piano-c4.wav')
    const page = await browser.newPage()
    await page.goto(`${baseUrl}/scripts/neural-live/live.html`, { waitUntil: 'load' })
    await page.evaluate(
      ({ samples, sampleRate }) => window.__liveApi.inject({
        samples,
        sampleRate,
        expectedMidis: [60],
        checkpointId: 'live-switch-pa-first',
        forceListen: true,
        keepAudio: true,
        performanceMode: 'play-along',
      }),
      { samples: clip.samples, sampleRate: clip.sampleRate },
    )
    await page.waitForFunction(
      () => (window.__liveApi.playAlongEvents() ?? []).length >= 1,
      null,
      { timeout: 150_000, polling: 2000 },
    )
    // Switch back to Wait For You on the same ring + looping audio.
    await page.evaluate(() => {
      window.__liveInject = { checkpoint: { id: 'live-switch-wfy-back', expectedMidis: [60] } }
      window.__liveApi.unmount()
      window.__liveApi.mount({ performanceMode: 'wait-for-you' })
    })
    await page.waitForFunction(
      () => window.__liveResults && window.__liveResults.phase === 'listening' && window.__liveResults.debug && window.__liveResults.debug.lastRingAdopted === true,
      null,
      { timeout: 120_000, polling: 1000 },
    )
    await page.waitForFunction(
      () => window.__liveResults && window.__liveResults.matched.length >= 1,
      null,
      { timeout: 150_000, polling: 2000 },
    )
    const results = await page.evaluate(() => window.__liveResults)
    await page.evaluate(() => window.__liveTeardown?.())
    await page.close()
    expect(results.debug.lastRingAdopted).toBe(true)
    expect(results.matched[0].midi).toBe(60)
    expect(results.feedbackOutcome).toBe('complete')
  }, 300_000)

  it('counts each repeated attack as a new performance (three C4 checkpoints)', async () => {
    // Composite construction truth: C4 attacks at 0.083/2.363/4.643 s.
    // One looping clip, three sequential single-note checkpoints — each
    // fresh attack must advance its own checkpoint exactly once.
    const clip = loadCompositeClip('repeat-piano-c4x3')
    expect(clip.anchorTones).toEqual([60])
    const page = await browser.newPage()
    await page.goto(`${baseUrl}/scripts/neural-live/live.html`, { waitUntil: 'load' })
    await page.evaluate(
      ({ samples, sampleRate }) => window.__liveApi.inject({
        samples,
        sampleRate,
        expectedMidis: [60],
        checkpointId: 'live-repeat-1',
        forceListen: true,
        keepAudio: true,
      }),
      { samples: clip.samples, sampleRate: clip.sampleRate },
    )
    for (let round = 1; round <= 3; round += 1) {
      await page.waitForFunction(
        () => window.__liveResults && window.__liveResults.matched.length >= 1,
        null,
        { timeout: 150_000, polling: 2000 },
      )
      const roundResults = await page.evaluate(() => window.__liveResults)
      expect(roundResults.matched[roundResults.matched.length - 1].midi).toBe(60)
      if (round < 3) {
        await page.evaluate((next) => {
          window.__liveInject = { checkpoint: { id: `live-repeat-${next}`, expectedMidis: [60] } }
          window.__liveApi.unmount()
          window.__liveApi.mount({ performanceMode: 'wait-for-you' })
        }, round + 1)
      }
    }
    const results = await page.evaluate(() => window.__liveResults)
    await page.evaluate(() => window.__liveTeardown?.())
    await page.close()
    expect(results.feedbackOutcome).toBe('complete')
  }, 300_000)

  it('hears a true piano octave pair live (C4+C5, no manufacture)', async () => {
    // Composite construction truth: Salamander C4+C5 struck together.
    // (UIowa low-high E2+E4 would be ideal but the CPU/headless backend
    // never emits E2 in 150 s of looping — backend recall gap, measured;
    // webgl benchmark scores that clip. This asserts octave-pair recall
    // on a stimulus the test backend demonstrably hears.)
    const clip = loadCompositeClip('octave-piano-c4-c5')
    expect(clip.anchorTones).toEqual([60, 72])
    const page = await browser.newPage()
    await page.goto(`${baseUrl}/scripts/neural-live/live.html`, { waitUntil: 'load' })
    await page.evaluate(
      ({ samples, sampleRate }) => window.__liveApi.inject({
        samples,
        sampleRate,
        expectedMidis: [60, 72],
        checkpointId: 'live-octave-pair',
        forceListen: true,
      }),
      { samples: clip.samples, sampleRate: clip.sampleRate },
    )
    const heard = new Set()
    const deadline = Date.now() + 150_000
    let results = null
    while (Date.now() < deadline) {
      await page.waitForTimeout(2_000)
      results = await page.evaluate(() => window.__liveResults)
      for (const note of results.detectedNotes ?? []) {
        heard.add(note.midi)
      }
      if ([60, 72].every((midi) => heard.has(midi))) {
        break
      }
    }
    console.log('OCTAVE-HEARD', JSON.stringify({ heard: [...heard], backend: results.backend, inferMs: results.debug?.lastInferMs ?? null }))
    await page.evaluate(() => window.__liveTeardown?.())
    await page.close()
    expect(results.phase).toBe('listening')
    for (const midi of [60, 72]) {
      expect(heard.has(midi)).toBe(true)
    }
    expect(results.feedbackOutcome).not.toBe('wrong')
  }, 240_000)

  it('hears a staggered octave strum live (150 ms roll, no manufacture)', async () => {
    // Composite construction truth: C4 at 0.113 s, C5 150 ms later.
    // Rolled/strummed octave recall through the live path; the UIowa
    // open-Em strum is scored in the webgl benchmark instead (CPU live
    // recall on that clip covers only the D3 string — measured gap).
    const clip = loadCompositeClip('rolled-octave-piano-c4-c5')
    expect(clip.anchorTones).toEqual([60, 72])
    const page = await browser.newPage()
    await page.goto(`${baseUrl}/scripts/neural-live/live.html`, { waitUntil: 'load' })
    await page.evaluate(
      ({ samples, sampleRate }) => window.__liveApi.inject({
        samples,
        sampleRate,
        expectedMidis: [60, 72],
        checkpointId: 'live-strum',
        forceListen: true,
      }),
      { samples: clip.samples, sampleRate: clip.sampleRate },
    )
    const heard = new Set()
    const deadline = Date.now() + 150_000
    let results = null
    while (Date.now() < deadline) {
      await page.waitForTimeout(2_000)
      results = await page.evaluate(() => window.__liveResults)
      for (const note of results.detectedNotes ?? []) {
        heard.add(note.midi)
      }
      if ([60, 72].every((midi) => heard.has(midi))) {
        break
      }
    }
    console.log('STRUM-HEARD', JSON.stringify({ heard: [...heard], backend: results.backend, inferMs: results.debug?.lastInferMs ?? null }))
    await page.evaluate(() => window.__liveTeardown?.())
    await page.close()
    expect(results.phase).toBe('listening')
    for (const midi of [60, 72]) {
      expect(heard.has(midi)).toBe(true)
    }
    expect(results.feedbackOutcome).not.toBe('wrong')
  }, 240_000)

  it('reports sound-to-feedback latency on a single unlooped attack', async () => {
    // M6 probe: one C4 attack, no loop, so the attack time is
    // unambiguous (inject time + construction onset 0.08 s).
    const clip = loadAccuracyClip('real-piano-c4.wav')
    const page = await browser.newPage()
    await page.goto(`${baseUrl}/scripts/neural-live/live.html`, { waitUntil: 'load' })
    await page.evaluate(
      ({ samples, sampleRate }) => window.__liveApi.inject({
        samples,
        sampleRate,
        expectedMidis: [60],
        checkpointId: 'live-latency',
        forceListen: true,
        loop: false,
        deferUntilListening: true,
      }),
      { samples: clip.samples, sampleRate: clip.sampleRate },
    )
    await page.waitForFunction(
      () => window.__liveResults && window.__liveResults.matched.length >= 1,
      null,
      { timeout: 150_000, polling: 1000 },
    )
    // Let several hops run so lastInferMs reflects steady state.
    await page.waitForTimeout(10_000)
    const results = await page.evaluate(() => window.__liveResults)
    await page.evaluate(() => window.__liveTeardown?.())
    await page.close()
    expect(results.matched[0].midi).toBe(60)
    const attackAt = (results.injectedAt ?? Date.now()) + 80
    const e2eMs = (results.matched[0].atMs ?? Date.now()) - attackAt
    console.log('LATENCY', JSON.stringify({
      e2eMs: Math.round(e2eMs),
      lastInferMs: results.debug?.lastInferMs ?? null,
      hops: results.debug?.hops ?? null,
      windowsRun: results.debug?.windowsRun ?? null,
    }))
    // Generous CPU-headless bound: guards against pathological stalls
    // (frozen pools, starved rings), not a product latency claim.
    expect(e2eMs).toBeLessThan(60_000)
  }, 240_000)
})
