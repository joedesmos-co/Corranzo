/**
 * Mic Engine V2 Phase 2 — score-informed polyphonic prototype (offline only).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadMicPolyphonyManifest } from '../src/features/microphone-input/micPolyphonyManifest.js'
import { sliceClipSamples } from '../src/features/microphone-input/micAccuracyManifest.js'
import {
  compareMicPolyphonyEngines,
  evaluatePolyphonyClip,
  summarizeMicPolyphony,
} from '../src/features/microphone-input/micPolyphonyReport.js'
import { replayPolyphonyClip } from '../src/features/microphone-input/micPolyphonyReplayHarness.js'
import {
  renderSyntheticChordClip,
  synthSimultaneousChord,
} from '../src/features/microphone-input/micSyntheticChordClips.js'
import {
  computeMagnitudeSpectrum,
  goertzelMagnitude,
} from '../src/features/microphone-input/v2/micSpectralAnalysis.js'
import {
  scoreExpectedNote,
  scoreInformedChordWindow,
} from '../src/features/microphone-input/v2/scoreInformedChordScorer.js'
import { replayScoreInformedPolyphonyClip } from '../src/features/microphone-input/v2/micPolyphonyV2ReplayHarness.js'
import { normalizeMatchSettings } from '../src/features/practice/waitForYouMatchSettings.js'
import { readWavPcm } from '../scripts/lib/readWavPcm.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const manifestPath = join(root, 'benchmarks/mic-polyphony/manifest.json')
const SAMPLE_RATE = 44100
const settings = normalizeMatchSettings({})

describe('Mic V2 spectral analysis', () => {
  it('detects energy at a synthetic fundamental via Goertzel', () => {
    const samples = synthSimultaneousChord([60], SAMPLE_RATE, { seconds: 0.5, amplitude: 0.35 })
    const window = samples.subarray(samples.length - 2048)
    const c4Energy = goertzelMagnitude(window, SAMPLE_RATE, 261.63)
    const offEnergy = goertzelMagnitude(window, SAMPLE_RATE, 300)
    expect(c4Energy).toBeGreaterThan(offEnergy * 2)
  })

  it('computes an FFT magnitude spectrum for a power-of-2 window', () => {
    const samples = synthSimultaneousChord([64], SAMPLE_RATE, { seconds: 0.5 })
    const window = samples.subarray(0, 2048)
    const spectrum = computeMagnitudeSpectrum(window)
    expect(spectrum.length).toBe(1025)
    const peakBin = spectrum.indexOf(Math.max(...spectrum))
    expect(peakBin).toBeGreaterThan(0)
  })
})

describe('Mic V2 score-informed chord scorer', () => {
  it('scores a synthetic C major triad with all expected notes detected', () => {
    const samples = synthSimultaneousChord([60, 64, 67], SAMPLE_RATE, {
      seconds: 1.2,
      amplitude: 0.35,
    })
    const attack = samples.subarray(Math.floor(SAMPLE_RATE * 0.35), Math.floor(SAMPLE_RATE * 0.35) + 2048)
    const result = scoreInformedChordWindow(attack, SAMPLE_RATE, [60, 64, 67])
    expect(result.chordDetected).toBe(true)
    expect(result.detectedMidis).toEqual(expect.arrayContaining([60, 64, 67]))
    for (const note of result.notes) {
      expect(note.confidence).toBeGreaterThan(0.3)
    }
  })

  it('scores a synthetic dyad with per-note confidence', () => {
    const samples = synthSimultaneousChord([60, 64], SAMPLE_RATE, { seconds: 1, amplitude: 0.32 })
    const window = samples.subarray(Math.floor(SAMPLE_RATE * 0.35), Math.floor(SAMPLE_RATE * 0.35) + 2048)
    const result = scoreInformedChordWindow(window, SAMPLE_RATE, [60, 64])
    expect(result.chordDetected).toBe(true)
    expect(result.notes.every((note) => note.confidence > 0.25)).toBe(true)
    expect(result.notes[0].harmonicSupport).toBeGreaterThan(0)
  })

  it('does not flag silence as a chord', () => {
    const silence = new Float32Array(2048)
    const result = scoreInformedChordWindow(silence, SAMPLE_RATE, [60, 64, 67], {
      minConfidence: 0.5,
      detectionRatio: 3,
    })
    expect(result.chordDetected).toBe(false)
    expect(result.detectedMidis).toEqual([])
  })
})

describe('Mic V2 offline polyphony replay', () => {
  it('beats V1 on synthetic simultaneous chord fixtures', () => {
    const manifest = loadMicPolyphonyManifest(manifestPath)
    const chordClips = manifest.clips.filter(
      (clip) => clip.label === 'chord' && clip.chordType === 'simultaneous' && clip.synthetic,
    )
    expect(chordClips.length).toBeGreaterThan(0)

    const v1Evaluations = []
    const v2Evaluations = []

    for (const clip of chordClips) {
      const samples = renderSyntheticChordClip(clip.synthetic, SAMPLE_RATE)
      const v1Replay = replayPolyphonyClip(samples, SAMPLE_RATE, {
        centsTolerance: settings.micCentsTolerance,
      })
      const v2Replay = replayScoreInformedPolyphonyClip(samples, SAMPLE_RATE, {
        expectedMidis: clip.expectedMidis,
      })
      v1Evaluations.push(
        evaluatePolyphonyClip(clip, v1Replay, { centsTolerance: settings.micCentsTolerance }),
      )
      v2Evaluations.push(
        evaluatePolyphonyClip(clip, v2Replay, { centsTolerance: settings.micCentsTolerance }),
      )
    }

    const v1Summary = summarizeMicPolyphony(v1Evaluations, { engine: 'v1-monophonic-baseline' })
    const v2Summary = summarizeMicPolyphony(v2Evaluations, {
      engine: 'v2-score-informed-phase-2b',
    })
    const comparison = compareMicPolyphonyEngines(v1Summary, v2Summary)

    expect(v2Summary.perNoteHitRate).toBeGreaterThan(v1Summary.perNoteHitRate ?? 0)
    expect(comparison.verdict).not.toBe('v2-insufficient')
  })

  it('replays fixture WAV dyad and triad clips when present', () => {
    const manifest = loadMicPolyphonyManifest(manifestPath)
    const fileClips = manifest.clips.filter((clip) => clip.file && clip.label === 'chord')
    for (const clip of fileClips) {
      const filePath = join(root, 'benchmarks/mic-polyphony', clip.file)
      const wav = readWavPcm(filePath)
      const replay = replayScoreInformedPolyphonyClip(wav.samples, wav.sampleRate, {
        expectedMidis: clip.expectedMidis,
      })
      const evaluation = evaluatePolyphonyClip(clip, replay, {
        centsTolerance: settings.micCentsTolerance,
      })
      expect(evaluation.skipped).toBe(false)
      expect(replay.engine).toBe('v2-score-informed-phase-2b')
      expect(evaluation.perNoteHitRate).toBeGreaterThanOrEqual(0)
    }
  })

  it('recovers split-register E4 when companion relief ratio/confidence gates agree', () => {
    const manifest = loadMicPolyphonyManifest(manifestPath)
    const clip = manifest.clips.find((entry) => entry.id === 'uiowa-piano-mf-split-c3-e4-g4')
    expect(clip).toBeTruthy()
    const filePath = join(root, 'benchmarks/mic-polyphony', clip.file)
    const wav = readWavPcm(filePath)
    const samples = sliceClipSamples(wav.samples, wav.sampleRate, {
      startMs: clip.startMs,
      endMs: clip.endMs,
    })
    const replay = replayScoreInformedPolyphonyClip(samples, wav.sampleRate, {
      expectedMidis: clip.expectedMidis,
      instrumentId: 'piano',
    })
    const evaluation = evaluatePolyphonyClip(clip, replay, {
      centsTolerance: settings.micCentsTolerance,
    })
    expect(evaluation.exactChordHit).toBe(true)
    expect(evaluation.matchedMidis).toEqual(expect.arrayContaining([48, 64, 67]))
    expect(evaluation.wrongToneAccepted).toBe(false)
  })


  it('keeps piano companion relief confidence floor consistent with its ratio floor', () => {
    const scorer = readFileSync(
      join(root, 'src/features/microphone-input/v2/scoreInformedChordScorer.js'),
      'utf8',
    )
    expect(scorer).toContain('const reliefMinRatio = 0.92')
    expect(scorer).toContain('const reliefMinConfidence = ratioToConfidence(reliefMinRatio)')
    expect(scorer).not.toContain('(note.confidence ?? 0) >= 0.02')
  })

  it('documents V2 research in MIC_ENGINE_V2_RESEARCH.md', () => {
    const doc = readFileSync(join(root, 'docs/MIC_ENGINE_V2_RESEARCH.md'), 'utf8')
    expect(doc).toContain('ScoreInformedHarmonicScorer')
    expect(doc).toContain('score-informed')
  })
})
