/**
 * Electric guitar mic detection — regression for amp-colored harmonics and
 * weak-fundamental bass that the acoustic-oriented gates used to reject.
 */
import { describe, expect, it } from 'vitest'
import { renderSyntheticClip, synthSpeech } from '../src/features/microphone-input/micSyntheticClips.js'
import {
  createMicEngineV2RuntimeState,
  processMicEngineV2Tick,
} from '../src/features/microphone-input/v2/micEngineV2Live.js'
import { analyzeMicFrame, createMicFrameAnalyzer } from '../src/features/microphone-input/micFrameAnalysis.js'
import { getMicInstrumentProfile } from '../src/features/microphone-input/micInstrumentProfiles.js'
import { MIC_SIGNAL_SHAPE } from '../src/features/microphone-input/micSignalShape.js'
import { isMusicalMicFrame, micMusicalRejectReason } from '../src/features/practice/micMusicalAcceptance.js'
import {
  confirmConfidentMatch,
  createMatchConfirmState,
  frameConfidentForMatch,
  frameCorroboratesSingleNote,
  resetMatchConfirmState,
} from '../src/features/practice/micMatchConfirm.js'
import {
  canAcceptMicAttackMatch,
  createMicAttackLatchState,
  markMicAttackConsumed,
  updateMicAttackRelease,
} from '../src/features/practice/micAttackLatch.js'
import { evaluateMicScoreInformedInput, MATCH_OUTCOME } from '../src/features/practice/waitForYouNoteMatch.js'
import { normalizeMatchSettings } from '../src/features/practice/waitForYouMatchSettings.js'
import { createMicDebugFrameRecord } from '../src/features/microphone-input/micDebugExport.js'
import { MIC_DIAGNOSTIC, resolveMicDiagnostic } from '../src/features/microphone-input/micDiagnosticState.js'

const SAMPLE_RATE = 44100
const FFT = 2048
const HOP = Math.round(SAMPLE_RATE / 60)
const settings = normalizeMatchSettings({})

function v2FrameFromSamples(samples, expectedMidi, offset = 2048, instrumentId = 'guitar') {
  const analyzer = createMicFrameAnalyzer()
  const profile = getMicInstrumentProfile(instrumentId)
  const window = samples.subarray(offset, offset + FFT)
  const frame = analyzeMicFrame(window, SAMPLE_RATE, analyzer.noiseFloor, {
    gateOptions: profile?.gate ?? null,
  })
  const tick = processMicEngineV2Tick({
    buffer: window,
    sampleRate: SAMPLE_RATE,
    expectedMidis: [expectedMidi],
    noiseFloor: analyzer.noiseFloor,
    state: createMicEngineV2RuntimeState(),
    gateOptions: profile?.gate ?? null,
  })
  return { ...frame, ...tick.frame, v2Active: true }
}

function runLiveAdvanceGate(samples, expectedMidi, { instrumentId = 'guitar' } = {}) {
  const v2State = createMicEngineV2RuntimeState()
  const analyzer = createMicFrameAnalyzer()
  const profile = getMicInstrumentProfile(instrumentId)
  const confirm = createMatchConfirmState()
  const latch = createMicAttackLatchState()
  let advances = 0

  for (let end = FFT; end <= samples.length; end += HOP) {
    const tick = processMicEngineV2Tick({
      buffer: new Float32Array(samples.subarray(end - FFT, end)),
      sampleRate: SAMPLE_RATE,
      expectedMidis: [expectedMidi],
      noiseFloor: analyzer.noiseFloor,
      state: v2State,
      centsTolerance: settings.micCentsTolerance,
      gateOptions: profile?.gate ?? null,
      timeMs: (end / SAMPLE_RATE) * 1000,
    })
    const frame = tick.frame
    if (!frame) {
      continue
    }
    updateMicAttackRelease(latch, Boolean(frame.gateOpen))
    if (!canAcceptMicAttackMatch(latch)) {
      resetMatchConfirmState(confirm)
      continue
    }
    if (!frame.gateOpen || !frame.v2DetectedMidis?.length) {
      resetMatchConfirmState(confirm)
      continue
    }
    const preview = evaluateMicScoreInformedInput({ id: 'electric', expectedMidi }, frame.v2DetectedMidis, settings)
    if (preview.outcome !== MATCH_OUTCOME.COMPLETE) {
      resetMatchConfirmState(confirm)
      continue
    }
    const key = `gate:v2:${expectedMidi}`
    const confident = frameConfidentForMatch(frame) && isMusicalMicFrame(frame)
    const corroborated = frameCorroboratesSingleNote(frame, expectedMidi, {
      centsTolerance: settings.micCentsTolerance,
    })
    if (
      confirmConfidentMatch(confirm, key, confident && corroborated, {
        pitchCents: frame.midiFloat != null ? frame.midiFloat * 100 : null,
      })
    ) {
      markMicAttackConsumed(latch)
      advances += 1
    }
  }
  return advances
}

describe('electric guitar mic classification', () => {
  it('accepts amp-colored h3-strong electric on the V2 path', () => {
    const samples = renderSyntheticClip(
      { type: 'electric-amp', midi: 52, seconds: 0.9, profile: 'h3-strong', amplitude: 0.34 },
      SAMPLE_RATE,
    )
    const merged = v2FrameFromSamples(samples, 52)
    expect(merged.gateOpen).toBe(true)
    expect(merged.v2DetectedMidis).toContain(52)
    expect(isMusicalMicFrame(merged)).toBe(true)
    expect(micMusicalRejectReason(merged)).toBeNull()
  })

  it('accepts weak-fundamental h2-strong bass electric sustain', () => {
    const samples = renderSyntheticClip(
      {
        type: 'harmonic',
        midi: 40,
        seconds: 1,
        harmonics: [
          { multiple: 1, amplitude: 0.05 },
          { multiple: 2, amplitude: 0.35 },
          { multiple: 3, amplitude: 0.2 },
        ],
      },
      SAMPLE_RATE,
    )
    const merged = v2FrameFromSamples(samples, 40)
    expect(merged.v2DetectedMidis).toContain(40)
    expect(isMusicalMicFrame(merged)).toBe(true)
    expect(frameConfidentForMatch(merged)).toBe(true)
  })

  it('still rejects bass speech anchored on h4+ partials', () => {
    const frame = {
      gateOpen: true,
      v2Active: true,
      v2DetectedMidis: [40],
      v2MeanConfidence: 0.8,
      v2Notes: [
        {
          midi: 40,
          detected: true,
          isBass: true,
          harmonicMagnitudes: [0.1, 0.15, 0.2, 0.5, 0.45, 0.2],
        },
      ],
      signalShape: MIC_SIGNAL_SHAPE.SUSTAINED,
      clarity: 0.8,
      zeroCrossingRate: 0.02,
      spectralEnergy: 0.005,
      crestFactor: 3,
    }
    expect(isMusicalMicFrame(frame)).toBe(false)
    expect(micMusicalRejectReason(frame)).toBe('non-musical-formant-harmonics')
  })

  it('exports electric debug fields with amp coloration evidence', () => {
    const samples = renderSyntheticClip(
      { type: 'electric-amp', midi: 57, seconds: 0.9, profile: 'h2-strong' },
      SAMPLE_RATE,
    )
    const merged = v2FrameFromSamples(samples, 57)
    const debug = createMicDebugFrameRecord({
      frame: merged,
      expectedMidis: [57],
      instrumentId: 'guitar',
      rejectReason: null,
    })
    expect(debug.electricGuitarSignal.ampColorationLikely).toBe(true)
    expect(debug.electricGuitarSignal.strongestPartial).toBeGreaterThanOrEqual(2)
    expect(debug.harmonicProfile.profiles.length).toBeGreaterThan(0)
  })
})

describe('electric guitar live WFY gate', () => {
  const advanceCases = [
    [
      'clean electric single note',
      { type: 'electric-clean', midi: 57, seconds: 0.9, amplitude: 0.3 },
      57,
    ],
    [
      'distorted electric single note',
      { type: 'distorted', midi: 52, seconds: 0.8, amplitude: 0.44, drive: 4.5 },
      52,
    ],
    [
      'quiet clean electric above noise floor',
      { type: 'pluck', midi: 57, seconds: 0.8, amplitude: 0.08, decay: 2.5 },
      57,
    ],
    [
      'loud distorted electric',
      { type: 'distorted', midi: 52, seconds: 0.8, amplitude: 0.55, drive: 5 },
      52,
    ],
    [
      'amp h2-strong coloration',
      { type: 'electric-amp', midi: 57, seconds: 0.9, profile: 'h2-strong' },
      57,
    ],
    [
      'amp h3-strong coloration',
      { type: 'electric-amp', midi: 52, seconds: 0.9, profile: 'h3-strong' },
      52,
    ],
    [
      'weak-fundamental h2 bass sustain',
      {
        type: 'harmonic',
        midi: 40,
        seconds: 1,
        harmonics: [
          { multiple: 1, amplitude: 0.05 },
          { multiple: 2, amplitude: 0.35 },
          { multiple: 3, amplitude: 0.2 },
        ],
      },
      40,
    ],
    [
      'acoustic guitar pluck still passes',
      { type: 'pluck', midi: 55, seconds: 0.8, amplitude: 0.38, decay: 2.8 },
      55,
    ],
    [
      'piano speaker still passes',
      { type: 'speaker', midi: 60, seconds: 0.7, amplitude: 0.34, noise: 0.008, seed: 31 },
      60,
      { instrumentId: 'piano' },
    ],
  ]

  for (const [label, spec, midi, options = {}] of advanceCases) {
    it(`${label} advances exactly once`, () => {
      const samples = renderSyntheticClip(spec, SAMPLE_RATE)
      expect(runLiveAdvanceGate(samples, midi, options)).toBe(1)
    })
  }

  it('wrong electric note near target does not advance', () => {
    const samples = renderSyntheticClip(
      { type: 'distorted', midi: 55, seconds: 0.8, amplitude: 0.44, drive: 4.5 },
      SAMPLE_RATE,
    )
    expect(runLiveAdvanceGate(samples, 57)).toBe(0)
  })

  it('speech does not advance even at the target pitch', () => {
    const samples = synthSpeech(SAMPLE_RATE, 1.6, { f0: 220, seed: 17, driftSemitones: 2.4 })
    expect(runLiveAdvanceGate(samples, 57)).toBe(0)
  })

  it('silence does not advance', () => {
    const samples = renderSyntheticClip({ type: 'silence', seconds: 0.8 }, SAMPLE_RATE)
    expect(runLiveAdvanceGate(samples, 57)).toBe(0)
  })

  it('noise does not advance', () => {
    const samples = renderSyntheticClip({ type: 'noise', seconds: 0.8, seed: 7 }, SAMPLE_RATE)
    expect(runLiveAdvanceGate(samples, 57)).toBe(0)
  })
})

describe('electric guitar mic diagnostic hint', () => {
  it('surfaces electric help when amp-colored signal is heard but blocked', () => {
    expect(
      resolveMicDiagnostic({
        electricGuitarUnconfirmed: true,
        signalQuality: 'good',
      }),
    ).toBe(MIC_DIAGNOSTIC.ELECTRIC_GUITAR_HELP)
  })
})
