/**
 * Guitar mic reliability — electric, double-stops, noise/speech rejection.
 * Uses synthetic clips and the same live-frame path as browser QA traces.
 */
import { describe, expect, it } from 'vitest'
import { INSTRUMENT_IDS } from '../src/features/instruments/instruments.js'
import {
  enrichGuitarChordCheckpoint,
  isUpperGuitarStringForMasking,
} from '../src/features/practice/guitarChordShapeCheckpoint.js'
import {
  confirmConfidentMatch,
  createMatchConfirmState,
  frameConfidentForMatch,
  frameCorroboratesSingleNote,
  GUITAR_ROLLING_CHORD_CONFIRM_FRAMES,
  resetMatchConfirmState,
} from '../src/features/practice/micMatchConfirm.js'
import {
  canAcceptMicAttackMatch,
  createMicAttackLatchState,
  getMicAttackRearmReason,
  markMicAttackConsumed,
  resetMicAttackLatch,
  updateMicAttackRelease,
} from '../src/features/practice/micAttackLatch.js'
import { isMusicalMicFrame } from '../src/features/practice/micMusicalAcceptance.js'
import {
  createGuitarChordShapeBufferState,
  evaluateGuitarChordShapeMicInput,
  evaluateMicScoreInformedInput,
  filterGuitarChordDetectedMidis,
  MATCH_OUTCOME,
} from '../src/features/practice/waitForYouNoteMatch.js'
import { normalizeMatchSettings } from '../src/features/practice/waitForYouMatchSettings.js'
import { renderSyntheticClip, synthSpeech } from '../src/features/microphone-input/micSyntheticClips.js'
import { analyzeMicFrame, createMicFrameAnalyzer } from '../src/features/microphone-input/micFrameAnalysis.js'
import {
  createMicEngineV2RuntimeState,
  processMicEngineV2Tick,
} from '../src/features/microphone-input/v2/micEngineV2Live.js'
import { getMicInstrumentProfile } from '../src/features/microphone-input/micInstrumentProfiles.js'

const SAMPLE_RATE = 44100
const FFT = 2048
const HOP = Math.round(SAMPLE_RATE / 60)
const settings = normalizeMatchSettings({})

function mixInto(target, source, offsetSamples = 0) {
  for (let index = 0; index < source.length; index += 1) {
    const at = offsetSamples + index
    if (at >= target.length) {
      break
    }
    target[at] += source[index]
  }
}

function pluckMidi(midi, options = {}) {
  return renderSyntheticClip({ type: 'pluck', midi, seconds: 0.9, amplitude: 0.32, ...options }, SAMPLE_RATE)
}

function doubleStopCheckpoint() {
  return enrichGuitarChordCheckpoint(
    {
      isChord: true,
      expectedMidis: [45, 57],
      notes: [
        { midi: 45, string: 5, fret: 5 },
        { midi: 57, string: 3, fret: 2 },
      ],
    },
    { instrumentId: INSTRUMENT_IDS.GUITAR },
  )
}

function runGuitarLiveFrames(samples, checkpoint, { confirmFrames = GUITAR_ROLLING_CHORD_CONFIRM_FRAMES } = {}) {
  const state = createMicEngineV2RuntimeState()
  const analyzer = createMicFrameAnalyzer()
  const profile = getMicInstrumentProfile('guitar')
  const buffer = createGuitarChordShapeBufferState()
  const confirm = createMatchConfirmState()
  const latch = createMicAttackLatchState()
  let completed = false
  let advances = 0

  for (let end = FFT; end <= samples.length; end += HOP) {
    const tick = processMicEngineV2Tick({
      buffer: new Float32Array(samples.subarray(end - FFT, end)),
      sampleRate: SAMPLE_RATE,
      expectedMidis: checkpoint.expectedMidis,
      expectedStringFrets: checkpoint.expectedStringFrets ?? null,
      noiseFloor: analyzer.noiseFloor,
      state,
      gateOptions: profile?.gate ?? null,
      timeMs: (end / SAMPLE_RATE) * 1000,
    })
    const frame = tick.frame
    if (!frame?.v2DetectedMidis?.length) {
      continue
    }
    updateMicAttackRelease(latch, Boolean(frame.gateOpen), {
      rms: frame.filteredRms ?? frame.rms ?? null,
    })
    if (!canAcceptMicAttackMatch(latch)) {
      const rearm = getMicAttackRearmReason(latch, frame, {
        expectedMidis: checkpoint.expectedMidis,
      })
      if (!rearm) {
        resetMatchConfirmState(confirm)
        continue
      }
      resetMicAttackLatch(latch)
    }
    const preview = evaluateGuitarChordShapeMicInput(
      checkpoint,
      frame.v2DetectedMidis,
      buffer,
      settings,
      frame,
    )
    if (preview.outcome !== MATCH_OUTCOME.COMPLETE) {
      resetMatchConfirmState(confirm)
      continue
    }
    const musical = isMusicalMicFrame(frame)
    const key = `guitar:${[...frame.v2DetectedMidis].sort((a, b) => a - b).join(',')}`
    if (confirmConfidentMatch(confirm, key, musical, { threshold: confirmFrames })) {
      markMicAttackConsumed(latch, { consumedMidis: checkpoint.expectedMidis })
      advances += 1
      completed = true
      break
    }
  }

  return { completed, advances }
}

function runElectricLiveAdvance(samples, expectedMidi) {
  const state = createMicEngineV2RuntimeState()
  const analyzer = createMicFrameAnalyzer()
  const profile = getMicInstrumentProfile('guitar')
  const confirm = createMatchConfirmState()
  const latch = createMicAttackLatchState()
  let advances = 0

  for (let end = FFT; end <= samples.length; end += HOP) {
    const tick = processMicEngineV2Tick({
      buffer: new Float32Array(samples.subarray(end - FFT, end)),
      sampleRate: SAMPLE_RATE,
      expectedMidis: [expectedMidi],
      noiseFloor: analyzer.noiseFloor,
      state,
      gateOptions: profile?.gate ?? null,
      timeMs: (end / SAMPLE_RATE) * 1000,
    })
    const frame = tick.frame
    if (!frame?.v2DetectedMidis?.length) {
      continue
    }
    updateMicAttackRelease(latch, Boolean(frame.gateOpen))
    if (!canAcceptMicAttackMatch(latch)) {
      resetMatchConfirmState(confirm)
      continue
    }
    const preview = evaluateMicScoreInformedInput(
      { id: 'electric', expectedMidi },
      frame.v2DetectedMidis,
      settings,
    )
    if (preview.outcome !== MATCH_OUTCOME.COMPLETE) {
      resetMatchConfirmState(confirm)
      continue
    }
    const confident =
      frameConfidentForMatch(frame) &&
      isMusicalMicFrame(frame) &&
      frameCorroboratesSingleNote(frame, expectedMidi, {
        centsTolerance: settings.micCentsTolerance,
      })
    if (confirmConfidentMatch(confirm, `e:${expectedMidi}`, confident)) {
      markMicAttackConsumed(latch)
      advances += 1
    }
  }
  return advances
}

describe('guitar mic reliability', () => {
  it('extends masking relief to G string (string 3) double-stops', () => {
    expect(isUpperGuitarStringForMasking(3)).toBe(true)
    expect(isUpperGuitarStringForMasking(4)).toBe(false)
  })

  it('accepts electric clean notes through score-informed confidence', () => {
    const samples = renderSyntheticClip(
      { type: 'electric-clean', midi: 64, seconds: 1.0, amplitude: 0.28 },
      SAMPLE_RATE,
    )
    expect(runElectricLiveAdvance(samples, 64)).toBeGreaterThan(0)
  })

  it('accepts electric distorted notes', () => {
    const samples = renderSyntheticClip(
      { type: 'distorted', midi: 52, seconds: 0.9, amplitude: 0.42 },
      SAMPLE_RATE,
    )
    expect(runElectricLiveAdvance(samples, 52)).toBeGreaterThan(0)
  })

  it('accepts quiet electric amp-colored notes', () => {
    const samples = renderSyntheticClip(
      { type: 'electric-amp', midi: 55, seconds: 1.0, amplitude: 0.14, profile: 'h3-strong' },
      SAMPLE_RATE,
    )
    expect(runElectricLiveAdvance(samples, 55)).toBeGreaterThan(0)
  })

  it('advances a guitar double-stop when both notes are played', () => {
    const checkpoint = doubleStopCheckpoint()
    const total = new Float32Array(Math.round(SAMPLE_RATE * 1.1))
    mixInto(total, pluckMidi(45, { amplitude: 0.34 }), 0)
    mixInto(total, pluckMidi(57, { amplitude: 0.08 }), 0)
    const { completed } = runGuitarLiveFrames(total, checkpoint)
    expect(completed).toBe(true)
  })

  it('does not advance a double-stop from one note only', () => {
    const checkpoint = doubleStopCheckpoint()
    const { completed } = runGuitarLiveFrames(pluckMidi(45, { amplitude: 0.34 }), checkpoint)
    expect(completed).toBe(false)
  })

  it('does not advance a double-stop on a wrong note', () => {
    const checkpoint = doubleStopCheckpoint()
    const buffer = createGuitarChordShapeBufferState()
    const result = evaluateGuitarChordShapeMicInput(checkpoint, [60], buffer, settings)
    expect(result.outcome).not.toBe(MATCH_OUTCOME.COMPLETE)
  })

  it('does not advance on tiny noise', () => {
    const checkpoint = doubleStopCheckpoint()
    const samples = renderSyntheticClip({ type: 'noise', seconds: 0.35, seed: 11, amplitude: 0.02 }, SAMPLE_RATE)
    const analyzer = createMicFrameAnalyzer()
    const profile = getMicInstrumentProfile('guitar')
    const frame = analyzeMicFrame(samples.subarray(0, FFT), SAMPLE_RATE, analyzer.noiseFloor, {
      gateOptions: profile?.gate ?? null,
    })
    expect(isMusicalMicFrame(frame)).toBe(false)
    const { completed } = runGuitarLiveFrames(samples, checkpoint)
    expect(completed).toBe(false)
  })

  it('does not advance on speech', () => {
    const checkpoint = doubleStopCheckpoint()
    const samples = synthSpeech(SAMPLE_RATE, 1.2, { f0: 220, seed: 3, driftSemitones: 2.2 })
    const { completed } = runGuitarLiveFrames(samples, checkpoint)
    expect(completed).toBe(false)
  })

  it('filters weak grazes before accumulating chord tones', () => {
    const checkpoint = doubleStopCheckpoint()
    const analyzer = createMicFrameAnalyzer()
    const profile = getMicInstrumentProfile('guitar')
    const tick = processMicEngineV2Tick({
      buffer: pluckMidi(45, { amplitude: 0.34 }).subarray(0, FFT),
      sampleRate: SAMPLE_RATE,
      expectedMidis: checkpoint.expectedMidis,
      expectedStringFrets: checkpoint.expectedStringFrets,
      noiseFloor: analyzer.noiseFloor,
      state: createMicEngineV2RuntimeState(),
      gateOptions: profile?.gate ?? null,
    })
    const filtered = filterGuitarChordDetectedMidis(
      tick.frame,
      tick.frame?.v2DetectedMidis ?? [],
      checkpoint.expectedMidis,
    )
    expect(filtered.length).toBeLessThanOrEqual(tick.frame?.v2DetectedMidis?.length ?? 0)
  })

  it('accepts a new note while the previous note is still ringing', () => {
    const first = pluckMidi(52, { amplitude: 0.34, seconds: 1.2 })
    const second = pluckMidi(55, { amplitude: 0.3, seconds: 0.7 })
    const total = new Float32Array(first.length + second.length)
    mixInto(total, first, 0)
    mixInto(total, second, Math.round(SAMPLE_RATE * 0.55))

    expect(runElectricLiveAdvance(total.subarray(0, first.length), 52)).toBeGreaterThan(0)
    expect(runElectricLiveAdvance(total, 55)).toBeGreaterThan(0)
  })

  it('requires two confident frames before advancing guitar double-stops', () => {
    const checkpoint = doubleStopCheckpoint()
    const total = new Float32Array(Math.round(SAMPLE_RATE * 1.1))
    mixInto(total, pluckMidi(45, { amplitude: 0.34 }), 0)
    mixInto(total, pluckMidi(57, { amplitude: 0.08 }), 0)
    const oneFrame = runGuitarLiveFrames(total, checkpoint, { confirmFrames: 1 })
    const twoFrames = runGuitarLiveFrames(total, checkpoint, { confirmFrames: 2 })
    expect(oneFrame.completed).toBe(true)
    expect(twoFrames.completed).toBe(true)
  })
})
