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
  MIC_FALSE_NEGATIVE_CAUSE,
} from '../src/features/microphone-input/micAccuracyReport.js'
import { MIC_SIGNAL_QUALITY, classifyMicSignalQuality } from '../src/features/microphone-input/micSignalQuality.js'
import { createNoteStabilizer, resetNoteStabilizer } from '../src/features/microphone-input/noteStabilizer.js'
import {
  createMicDebugFrameRecord,
  pushMicDebugFrame,
  serializeMicDebugFrames,
} from '../src/features/microphone-input/micDebugExport.js'

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
    expect(summary.falseNegativeCauses).toEqual({})
    expect(summary.tuningRecommendation).toContain('do not tune')
    expect(formatMicAccuracyReportMarkdown(summary)).toContain('By register')
    expect(evaluations[0].unstablePitchFrames).toBe(1)
  })

  it('classifies false negative causes from replay frames', () => {
    const wrongPitch = evaluateLabeledClip(
      { id: 'a4', label: 'note', expectedMidi: 69 },
      {
        stableDetections: [],
        stabilizer: { holdFrames: 3, minClarity: 0.42 },
        frames: [
          { timeMs: 0, midi: 35, midiFloat: 35.3, frequency: 62.8, gateOpen: true, clarity: 1 },
          { timeMs: 16, midi: 69, midiFloat: 69.04, frequency: 441, gateOpen: true, clarity: 1 },
          { timeMs: 33, midi: 35, midiFloat: 35.3, frequency: 62.8, gateOpen: true, clarity: 1 },
        ],
      },
    )
    expect(wrongPitch.falseNegativeCause).toBe(MIC_FALSE_NEGATIVE_CAUSE.WRONG_PITCH)

    const gateClosed = evaluateLabeledClip(
      { id: 'quiet', label: 'note', expectedMidi: 60 },
      { stableDetections: [], frames: [{ timeMs: 0, midi: null, gateOpen: false }] },
    )
    expect(gateClosed.falseNegativeCause).toBe(MIC_FALSE_NEGATIVE_CAUSE.GATE_CLOSED)
  })
})

describe('mic debug export', () => {
  it('captures the fields needed to diagnose failed mic attempts', () => {
    const record = createMicDebugFrameRecord({
      frame: {
        midi: 60,
        frequency: 261.63,
        centsOffset: -2,
        rms: 0.04,
        filteredRms: 0.039,
        level: 0.2,
        noiseFloor: 0.006,
        gateOpen: true,
        clarity: 0.91,
        v2MeanConfidence: 0.7,
        v2DetectedMidis: [60],
        v2Notes: [{ midi: 60, confidence: 0.7, ratio: 4.2, detected: true }],
        signalShape: 'sustained',
        signalQuality: 'good',
        midiFloat: 60.01,
        micEngineMode: 'v2-score-informed',
        calibrationStatus: 'ready',
      },
      expectedMidis: [60],
      instrumentId: 'piano',
      inputSource: 'microphone',
      captureSettings: { noiseSuppression: false },
      rejectReason: null,
      timestampMs: 123,
    })

    expect(record).toMatchObject({
      expectedMidis: [60],
      detectedMidi: 60,
      detectedMidis: [60],
      detectedFrequency: 261.63,
      midiFloat: 60.01,
      centsOffset: -2,
      rms: 0.04,
      filteredRms: 0.039,
      level: 0.2,
      noiseFloor: 0.006,
      gateOpen: true,
      clarity: 0.91,
      v2MeanConfidence: 0.7,
      v2DetectedMidis: [60],
      v2Notes: [{ midi: 60, confidence: 0.7, ratio: 4.2, detected: true }],
      signalShape: 'sustained',
      signalQuality: 'good',
      rejectReason: null,
      instrumentId: 'piano',
      inputSource: 'microphone',
      micEngineMode: 'v2-score-informed',
      calibrationStatus: 'ready',
      captureSettings: { noiseSuppression: false },
    })

    const buffer = []
    pushMicDebugFrame(buffer, record, 1)
    pushMicDebugFrame(buffer, { ...record, detectedMidi: 64 }, 1)
    expect(buffer).toHaveLength(1)
    expect(buffer[0].detectedMidi).toBe(64)
    expect(JSON.parse(serializeMicDebugFrames(buffer)).frames[0].detectedMidi).toBe(64)
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
