/**
 * Audio Rendering / Piano Realism Sprint 1 — renderer-only guarantees.
 * Does not touch Playback Semantics, OMR, or the semantic evaluator.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  createPianoInstrument,
  DEFAULT_PIANO_SAMPLE_BASE_URL,
  LOCAL_PIANO_SAMPLE_BASE_URL,
  CDN_PIANO_SAMPLE_BASE_URL,
  PIANO_SAMPLE_URLS,
  __resetSharedPianoBuffers,
} from '../src/features/playback/pianoInstrument.js'
import { mapPlaybackVelocity } from '../src/features/playback/pianoVelocity.js'
import { MAX_SIMULTANEOUS_VOICES } from '../src/features/playback/pianoVoiceMix.js'
import {
  nearestPianoSample,
  reportPianoKeyboardCoverage,
} from '../src/features/playback/pianoSampleCoverage.js'
import {
  PIANO_LISTENING_FIXTURES,
  fingerprintPerformedTrace,
  runAllPianoAudioFixtures,
  runPianoAudioFixture,
  createBenchmarkToneDouble,
} from '../src/features/playback/pianoAudioBenchmark.js'
import { DYNAMICS_TO_VELOCITY } from '../src/features/musicxml/dynamicsMap.js'
import { INSTRUMENT_STATUS } from '../src/features/playback/instrumentVoiceStatus.js'

afterEach(() => {
  __resetSharedPianoBuffers()
})

describe('Piano Realism Sprint 1 — sample set & coverage', () => {
  it('prefers same-origin Salamander mirror with CDN fallback', () => {
    expect(DEFAULT_PIANO_SAMPLE_BASE_URL).toBe(LOCAL_PIANO_SAMPLE_BASE_URL)
    expect(LOCAL_PIANO_SAMPLE_BASE_URL).toBe('/audio/salamander/')
    expect(CDN_PIANO_SAMPLE_BASE_URL).toMatch(/tonejs\.github\.io\/audio\/salamander/)
  })

  it('ships local Salamander MP3s for all mapped pitches', () => {
    const dir = join(process.cwd(), 'public/audio/salamander')
    expect(existsSync(dir)).toBe(true)
    const files = new Set(readdirSync(dir).filter((name) => name.endsWith('.mp3')))
    for (const file of Object.values(PIANO_SAMPLE_URLS)) {
      expect(files.has(file)).toBe(true)
    }
    expect(Object.keys(PIANO_SAMPLE_URLS)).toHaveLength(30)
  })

  it('covers A0–C8 within a 1.5-semitone pitch-shift budget', () => {
    const coverage = reportPianoKeyboardCoverage()
    expect(coverage.missingMidi).toEqual([])
    expect(coverage.extremeTranspose).toEqual([])
    expect(coverage.coveredCount).toBe(88)
    expect(nearestPianoSample(60).sampleName).toBe('C4')
    expect(Math.abs(nearestPianoSample(61).transposeSemitones)).toBeLessThanOrEqual(1.5)
  })
})

describe('Piano Realism Sprint 1 — velocity response (audio gain only)', () => {
  it('orders pp < p < mp < mf < f < ff after the audio gain curve', () => {
    const marks = ['pp', 'p', 'mp', 'mf', 'f', 'ff']
    const gains = marks.map((mark) => mapPlaybackVelocity(DYNAMICS_TO_VELOCITY[mark]))
    for (let i = 1; i < gains.length; i += 1) {
      expect(gains[i]).toBeGreaterThan(gains[i - 1])
    }
  })

  it('does not crush pp against a high floor', () => {
    const pp = mapPlaybackVelocity(DYNAMICS_TO_VELOCITY.pp)
    const p = mapPlaybackVelocity(DYNAMICS_TO_VELOCITY.p)
    expect(pp).toBeLessThan(0.45)
    expect(p - pp).toBeGreaterThan(0.04)
  })
})

describe('Piano Realism Sprint 1 — polyphony & cleanup', () => {
  it('allows dense chords without early steals (cap 72)', () => {
    expect(MAX_SIMULTANEOUS_VOICES).toBe(72)
  })

  it('releaseAll clears active voices (no stuck notes)', async () => {
    const { tone } = createBenchmarkToneDouble()
    const sampler = {
      calls: [],
      released: [],
      disposed: false,
      connectedTo: [],
      volume: { value: 0 },
      connect(dest) {
        this.connectedTo.push(dest)
      },
      triggerAttackRelease(...args) {
        this.calls.push(args)
      },
      releaseAll(time) {
        this.released.push(time)
      },
      dispose() {
        this.disposed = true
      },
    }
    const inst = createPianoInstrument({
      tone,
      loadSampler: () => Promise.resolve(sampler),
      createSamplerSync: () => null,
      sampleFallbackBaseUrl: null,
    })
    await inst.whenReady()
    for (const midi of [48, 52, 55, 60, 64, 67]) {
      inst.triggerAttackRelease(`N${midi}`, 2, 0, 0.8, { midi })
    }
    expect(inst.getVoiceDiagnostics().activeVoices).toBe(6)
    inst.releaseAll(1)
    expect(inst.getVoiceDiagnostics().activeVoices).toBe(0)
    expect(sampler.released).toContain(1)
  })

  it('logs a real reason when forced onto synth fallback', async () => {
    const { tone } = createBenchmarkToneDouble()
    const inst = createPianoInstrument({
      tone,
      loadSampler: () => Promise.reject(new Error('CDN 404 salamander/C4.mp3')),
      createSamplerSync: () => null,
      sampleFallbackBaseUrl: null,
    })
    await inst.whenReady()
    expect(inst.status).toBe(INSTRUMENT_STATUS.SYNTH)
    expect(inst.getLastLoadError()).toMatch(/CDN 404/)
  })
})

describe('Piano Realism Sprint 1 — audio benchmark fixtures', () => {
  it('defines all 14 listening fixtures', () => {
    expect(Object.keys(PIANO_LISTENING_FIXTURES)).toHaveLength(14)
  })

  it('keeps performed traces stable across renderer runs', async () => {
    const fixture = PIANO_LISTENING_FIXTURES['tied-across-bar']
    const before = fingerprintPerformedTrace(fixture.events)
    const report = await runPianoAudioFixture(fixture)
    const after = fingerprintPerformedTrace(fixture.events)
    expect(after).toBe(before)
    expect(report.tieContinuationReattacks).toBe(0)
    expect(report.engineType).toBe('sampler')
  })

  it('passes the full fixture suite with sampler engine', async () => {
    const suite = await runAllPianoAudioFixtures()
    expect(suite.summary.fixtureCount).toBe(14)
    expect(suite.summary.samplerFixtures).toBe(14)
    expect(suite.summary.totalMissingTriggers).toBe(0)
    expect(suite.summary.tieReattacks).toBe(0)
    expect(suite.summary.stuckVoiceFailures).toBe(0)
    expect(suite.summary.dynamicLadderOk).toBe(true)
    expect(suite.summary.totalClipping).toBe(0)
    expect(suite.summary.maxPeakPolyphony).toBeGreaterThanOrEqual(6)
    expect(suite.coverage.missingMidi).toEqual([])
  })

  it('fires every note in a six-note chord and dense passage', async () => {
    const chords = await runPianoAudioFixture(PIANO_LISTENING_FIXTURES['chords-2-3-6'])
    expect(chords.missingTriggers).toBe(0)
    expect(chords.triggerCount).toBe(11)

    const dense = await runPianoAudioFixture(PIANO_LISTENING_FIXTURES['dense-chord-passage'])
    expect(dense.missingTriggers).toBe(0)
    expect(dense.triggerCount).toBe(48)
    expect(dense.voiceSteals).toBe(0)
  })
})
