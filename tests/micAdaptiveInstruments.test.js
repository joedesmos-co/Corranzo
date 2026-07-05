/**
 * Adaptive mic behavior across real-instrument-shaped signals.
 *
 * Covers the sprint goals: calibration that stays forgiving without inflating
 * the gate, a "too quiet" label reserved for input genuinely below the gate,
 * strong distorted/harmonic input that is never treated as silence, and
 * quiet / no-input that never false-positives. Uses the offline replay pipeline
 * (calibration → analyzeMicFrame → stabilizer) so it exercises the real code.
 */
import { describe, expect, it } from 'vitest'
import {
  classifyMicSignalShape,
  MIC_SIGNAL_SHAPE,
} from '../src/features/microphone-input/micSignalShape.js'
import {
  classifyMicSignalQuality,
  MIC_SIGNAL_QUALITY,
} from '../src/features/microphone-input/micSignalQuality.js'
import {
  gateOpenThreshold,
  passesNoiseGate,
  passesSoftMusicalGate,
  softGateOpenThreshold,
} from '../src/features/microphone-input/micNoiseGate.js'
import {
  createMicCalibration,
  finalizeMicCalibration,
  pushCalibrationSample,
  shouldAcceptCalibrationSample,
} from '../src/features/microphone-input/micCalibration.js'
import { getMicInstrumentProfile } from '../src/features/microphone-input/micInstrumentProfiles.js'
import { replayMicClip } from '../src/features/microphone-input/micReplayHarness.js'
import {
  midiToFrequency,
  synthHarmonicTone,
  synthPluck,
  synthDistorted,
  synthSpeaker,
  synthSine,
  synthSilence,
  synthWhiteNoise,
} from '../src/features/microphone-input/micSyntheticClips.js'

const SAMPLE_RATE = 44100

// ─── signal shape ─────────────────────────────────────────────────────────────

describe('signal shape classifier', () => {
  it('calls a near-silent frame quiet', () => {
    expect(classifyMicSignalShape({ rms: 0.003 })).toBe(MIC_SIGNAL_SHAPE.QUIET)
  })

  it('calls a clean sustained tone sustained', () => {
    expect(
      classifyMicSignalShape({
        rms: 0.2,
        hasPitch: true,
        clarity: 0.9,
        crestFactor: 1.8,
        spectralEnergy: 0.003,
        zeroCrossingRate: 0.01,
      }),
    ).toBe(MIC_SIGNAL_SHAPE.SUSTAINED)
  })

  it('calls a sharp pitchless transient percussive', () => {
    expect(
      classifyMicSignalShape({
        rms: 0.1,
        hasPitch: false,
        clarity: 0,
        crestFactor: 10,
        spectralEnergy: 0.05,
        zeroCrossingRate: 0.05,
      }),
    ).toBe(MIC_SIGNAL_SHAPE.PERCUSSIVE)
  })

  it('calls a strong, harmonic-rich frame distorted', () => {
    expect(
      classifyMicSignalShape({
        rms: 0.12,
        hasPitch: true,
        clarity: 0.6,
        crestFactor: 2,
        spectralEnergy: 0.25,
        zeroCrossingRate: 0.08,
      }),
    ).toBe(MIC_SIGNAL_SHAPE.DISTORTED)
  })

  it('calls strong broadband aperiodic energy noisy', () => {
    expect(
      classifyMicSignalShape({
        rms: 0.05,
        hasPitch: false,
        clarity: 0,
        crestFactor: 1.7,
        spectralEnergy: 2,
        zeroCrossingRate: 0.5,
      }),
    ).toBe(MIC_SIGNAL_SHAPE.NOISY)
  })

  it('does not promote a faint hiss to noisy', () => {
    expect(
      classifyMicSignalShape({
        rms: 0.008,
        hasPitch: false,
        clarity: 0,
        spectralEnergy: 1.5,
        zeroCrossingRate: 0.45,
      }),
    ).toBe(MIC_SIGNAL_SHAPE.QUIET)
  })
})

// ─── "too quiet" only when truly below gate ───────────────────────────────────

describe('too-quiet label discipline', () => {
  it('labels genuinely below-gate marginal input as too quiet', () => {
    expect(
      classifyMicSignalQuality({
        rms: 0.01,
        passesGate: false,
        signalShape: MIC_SIGNAL_SHAPE.QUIET,
      }),
    ).toBe(MIC_SIGNAL_QUALITY.TOO_QUIET)
  })

  it('does NOT call a strong audible signal too quiet even if the filtered gate is shut', () => {
    const quality = classifyMicSignalQuality({
      rms: 0.06,
      passesGate: false,
      signalShape: MIC_SIGNAL_SHAPE.DISTORTED,
    })
    expect(quality).not.toBe(MIC_SIGNAL_QUALITY.TOO_QUIET)
    expect(quality).not.toBe(MIC_SIGNAL_QUALITY.SILENT)
  })

  it('never calls a strong distorted, gate-open frame silent', () => {
    const quality = classifyMicSignalQuality({
      rms: 0.18,
      clarity: 0.9,
      hasPitch: true,
      passesGate: true,
      signalShape: MIC_SIGNAL_SHAPE.DISTORTED,
    })
    expect(quality).not.toBe(MIC_SIGNAL_QUALITY.SILENT)
    expect(quality).not.toBe(MIC_SIGNAL_QUALITY.TOO_QUIET)
  })

  it('still reports true silence as silent', () => {
    expect(
      classifyMicSignalQuality({
        rms: 0.001,
        passesGate: false,
        signalShape: MIC_SIGNAL_SHAPE.QUIET,
      }),
    ).toBe(MIC_SIGNAL_QUALITY.SILENT)
  })

  it('routes broadband noise to too-noisy, not too-quiet', () => {
    expect(
      classifyMicSignalQuality({
        rms: 0.05,
        passesGate: true,
        signalShape: MIC_SIGNAL_SHAPE.NOISY,
      }),
    ).toBe(MIC_SIGNAL_QUALITY.TOO_NOISY)
  })
})

// ─── adaptive gate ────────────────────────────────────────────────────────────

describe('adaptive noise gate', () => {
  it('keeps the long-standing default threshold when no options are passed', () => {
    // floor 0.006 → max(0.012, 0.006 * 2.8) = 0.0168
    expect(gateOpenThreshold(0.006)).toBeCloseTo(0.0168, 4)
    expect(passesNoiseGate(0.02, 0.006)).toBe(true)
    expect(passesNoiseGate(0.01, 0.006)).toBe(false)
  })

  it('opens a touch sooner for the plucky guitar profile', () => {
    const guitar = getMicInstrumentProfile('guitar')
    expect(gateOpenThreshold(0.006, guitar.gate)).toBeLessThan(gateOpenThreshold(0.006))
  })

  it('keeps quiet-practice soft gating separate from the normal noise gate', () => {
    const floor = 0.006
    const quietNoteRms = 0.012

    expect(quietNoteRms).toBeLessThan(gateOpenThreshold(floor))
    expect(passesNoiseGate(quietNoteRms, floor)).toBe(false)
    expect(softGateOpenThreshold(floor)).toBeLessThan(gateOpenThreshold(floor))
    expect(passesSoftMusicalGate(quietNoteRms, floor)).toBe(true)
    expect(passesSoftMusicalGate(0.0065, floor)).toBe(false)
  })
})

// ─── calibration hardening ────────────────────────────────────────────────────

describe('calibration hardening', () => {
  it('never counts a pitched frame as room noise', () => {
    expect(shouldAcceptCalibrationSample({ rms: 0.01, hasPitch: true })).toBe(false)
    expect(shouldAcceptCalibrationSample({ rms: 0.006, hasPitch: false })).toBe(true)
    expect(shouldAcceptCalibrationSample({ rms: 0.05, hasPitch: false })).toBe(false)
  })

  it('rejects loud outliers so a note bleeding in cannot inflate the floor', () => {
    const state = createMicCalibration({ frames: 60 })
    // Quiet room baseline.
    for (let i = 0; i < 12; i += 1) {
      pushCalibrationSample(state, 0.005, { acceptSample: true })
    }
    // A few note/pluck bursts bleed in mid-calibration.
    for (let i = 0; i < 4; i += 1) {
      pushCalibrationSample(state, 0.05, { acceptSample: true })
    }

    expect(state.rejectedOutliers).toBeGreaterThanOrEqual(4)
    expect(Math.max(...state.samples)).toBeLessThan(0.02)

    const result = finalizeMicCalibration(state)
    expect(result.noiseFloor).toBeLessThanOrEqual(0.008)
    // Gate stays near the absolute minimum rather than being inflated upward.
    expect(result.gateThreshold).toBeLessThanOrEqual(0.03)
  })

  it('derives forgiving-but-bounded stabilizer thresholds', () => {
    const state = createMicCalibration({ frames: 60 })
    for (let i = 0; i < 20; i += 1) {
      pushCalibrationSample(state, 0.004, { acceptSample: true })
    }
    const result = finalizeMicCalibration(state)
    expect(result.recommendedMinRms).toBeGreaterThanOrEqual(0.008)
    expect(result.recommendedMinRms).toBeLessThanOrEqual(0.06)
  })
})

// ─── instrument profiles ──────────────────────────────────────────────────────

describe('instrument mic profiles', () => {
  it('gives guitar a shorter attack skip than piano', () => {
    expect(getMicInstrumentProfile('guitar').stabilizer.attackFrames).toBe(1)
    expect(getMicInstrumentProfile('piano').stabilizer.attackFrames).toBe(2)
  })

  it('defaults unknown instruments to the piano profile', () => {
    expect(getMicInstrumentProfile('theremin').stabilizer.attackFrames).toBe(2)
    expect(getMicInstrumentProfile(null).id).toBe('piano')
  })
})

// ─── replay across instrument-shaped signals ──────────────────────────────────

function stableMidis(replay) {
  return [...new Set(replay.stableDetections.map((detection) => detection.midi))]
}

describe('replay across real-instrument-shaped signals', () => {
  it('detects a sustained acoustic-piano-style tone', () => {
    const buffer = synthHarmonicTone(
      midiToFrequency(60),
      [
        { multiple: 1, amplitude: 0.3 },
        { multiple: 2, amplitude: 0.18 },
        { multiple: 3, amplitude: 0.08 },
      ],
      SAMPLE_RATE,
      0.9,
    )
    const replay = replayMicClip(buffer, SAMPLE_RATE, { instrumentId: 'piano' })
    expect(stableMidis(replay)).toContain(60)
  })

  it('detects a plucky guitar-style note', () => {
    const buffer = synthPluck(midiToFrequency(55), SAMPLE_RATE, 1.4, { decay: 2 })
    const replay = replayMicClip(buffer, SAMPLE_RATE, { instrumentId: 'guitar' })
    expect(stableMidis(replay)).toContain(55)
  })

  it('detects a digital-piano-through-speakers tone', () => {
    const buffer = synthSpeaker(midiToFrequency(60), SAMPLE_RATE, 1.0)
    const replay = replayMicClip(buffer, SAMPLE_RATE, { instrumentId: 'piano' })
    expect(stableMidis(replay)).toContain(60)
  })

  it('treats a strong distorted electric tone as signal, never silence', () => {
    const buffer = synthDistorted(midiToFrequency(52), SAMPLE_RATE, 1.0, { amplitude: 0.22 })
    const replay = replayMicClip(buffer, SAMPLE_RATE, { instrumentId: 'guitar' })

    // It resolves to the right note …
    expect(stableMidis(replay)).toContain(52)

    // … and no strong frame is ever reported as silence / too quiet.
    const strongFrames = replay.frames.filter((frame) => frame.rms >= 0.05)
    expect(strongFrames.length).toBeGreaterThan(0)
    for (const frame of strongFrames) {
      expect(frame.gateOpen).toBe(true)
      expect(frame.signalShape).not.toBe(MIC_SIGNAL_SHAPE.QUIET)
      expect(frame.signalQuality).not.toBe(MIC_SIGNAL_QUALITY.SILENT)
      expect(frame.signalQuality).not.toBe(MIC_SIGNAL_QUALITY.TOO_QUIET)
    }
  })

  it('does not false-positive on quiet / no-input', () => {
    const silence = replayMicClip(synthSilence(SAMPLE_RATE, 1.0), SAMPLE_RATE, {
      instrumentId: 'piano',
    })
    expect(silence.stableDetections).toHaveLength(0)

    const marginal = replayMicClip(
      synthSine(midiToFrequency(69), SAMPLE_RATE, 1.0, 0.004),
      SAMPLE_RATE,
      { instrumentId: 'piano' },
    )
    expect(marginal.stableDetections).toHaveLength(0)
  })

  it('does not emit a stable pitch on broadband noise', () => {
    const noise = replayMicClip(synthWhiteNoise(SAMPLE_RATE, 1.0, 11), SAMPLE_RATE, {
      instrumentId: 'guitar',
    })
    expect(noise.stableDetections).toHaveLength(0)
  })
})
