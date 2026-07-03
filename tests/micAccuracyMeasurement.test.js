import { describe, expect, it } from 'vitest'
import {
  midiRegisterBucket,
  sliceClipSamples,
  normalizeMicAccuracyClip,
} from '../src/features/microphone-input/micAccuracyManifest.js'
import {
  evaluateLabeledClip,
  summarizeMicAccuracy,
  formatMicAccuracyReportMarkdown,
} from '../src/features/microphone-input/micAccuracyReport.js'
import { MIC_SIGNAL_QUALITY, classifyMicSignalQuality } from '../src/features/microphone-input/micSignalQuality.js'
import { createNoteStabilizer, resetNoteStabilizer } from '../src/features/microphone-input/noteStabilizer.js'

describe('mic accuracy measurement helpers', () => {
  it('buckets MIDI into bass/mid/treble registers', () => {
    expect(midiRegisterBucket(40)).toBe('bass')
    expect(midiRegisterBucket(60)).toBe('mid')
    expect(midiRegisterBucket(80)).toBe('treble')
  })

  it('normalizes manifest metadata and slices clip windows', () => {
    const clip = normalizeMicAccuracyClip({
      id: 'guitar-g3',
      label: 'note',
      expectedMidi: 55,
      instrument: 'guitar',
      file: 'clips/g3.wav',
      startMs: 100,
      endMs: 200,
      noiseCondition: 'clean',
    })
    expect(clip.instrument).toBe('guitar')
    expect(clip.source).toBe('file')

    const samples = new Float32Array(44100)
    const sliced = sliceClipSamples(samples, 44100, { startMs: 100, endMs: 200 })
    expect(sliced.length).toBe(4410)
  })

  it('marks missing-file clips as skipped instead of false negatives', () => {
    const evaluation = evaluateLabeledClip(
      { id: 'missing', label: 'note', expectedMidi: 60, missingFile: true },
      { stableDetections: [], frames: [] },
    )
    expect(evaluation.skipped).toBe(true)
    expect(evaluation.outcome).toBe('skipped')
    expect(evaluation.falseNegative).toBe(false)
  })

  it('reports unstable pitch frames and breakdown groups', () => {
    const evaluations = [
      evaluateLabeledClip(
        {
          id: 'piano-mid',
          label: 'note',
          expectedMidi: 60,
          instrument: 'piano',
          noiseCondition: 'clean',
          source: 'synthetic',
        },
        {
          stableDetections: [{ midi: 60, timeMs: 200, clarity: 0.8, centsOffset: 2 }],
          frames: [
            { timeMs: 80, midi: 60, clarity: 0.25 },
            { timeMs: 120, midi: 60, clarity: 0.5 },
          ],
        },
      ),
      evaluateLabeledClip(
        {
          id: 'noise',
          label: 'noise',
          expectedMidi: null,
          noiseCondition: 'noisy',
          source: 'synthetic',
        },
        { stableDetections: [], frames: [] },
      ),
    ]

    const summary = summarizeMicAccuracy(evaluations)
    expect(summary.byInstrument.piano.hitRate).toBe(1)
    expect(summary.byNoiseCondition.clean.hitRate).toBe(1)
    expect(summary.byNoiseCondition.noisy.falsePositiveRate).toBe(0)
    expect(summary.tuningRecommendation).toContain('do not tune')
    expect(formatMicAccuracyReportMarkdown(summary)).toContain('By register')
    expect(evaluations[0].unstablePitchFrames).toBe(1)
  })
})

describe('mic signal quality', () => {
  it('classifies unstable pitch while stabilizer is building', () => {
    expect(
      classifyMicSignalQuality({
        rms: 0.05,
        clarity: 0.32,
        passesGate: true,
        hasPitch: true,
        stabilizerPending: true,
      }),
    ).toBe(MIC_SIGNAL_QUALITY.UNSTABLE)
  })
})

describe('note stabilizer reset', () => {
  it('clears pending candidate state when reset', () => {
    const stabilizer = createNoteStabilizer({ holdFrames: 4, minClarity: 0.1, minRms: 0.001 })
    stabilizer.candidateMidi = 60
    stabilizer.stableCount = 2
    resetNoteStabilizer(stabilizer)
    expect(stabilizer.candidateMidi).toBeNull()
    expect(stabilizer.stableCount).toBe(0)
    expect(stabilizer.armed).toBe(true)
  })
})
