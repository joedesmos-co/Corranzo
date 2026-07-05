/**
 * End-to-end regression for the LIVE Wait For You mic advance gate against
 * honest audio: Mic Engine V2 tick → attack latch → musical acceptance →
 * pitch-drift-aware confirm. This is the decision path `useWaitForYouMicInput`
 * applies per frame; real WAV fixtures and adversarial synthetic speech run
 * through the entire pipeline (no hand-built frames).
 *
 * Invariants pinned here:
 *  - a real played note advances exactly once,
 *  - silence / noise / room recordings never advance,
 *  - talking (prosody sweeps, jitter, formants) never advances even when the
 *    target note sits at the voice's own pitch.
 */
import { describe, expect, it } from 'vitest'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWavPcm } from '../scripts/lib/readWavPcm.mjs'
import {
  createMicEngineV2RuntimeState,
  processMicEngineV2Tick,
} from '../src/features/microphone-input/v2/micEngineV2Live.js'
import { createMicFrameAnalyzer } from '../src/features/microphone-input/micFrameAnalysis.js'
import { getMicInstrumentProfile } from '../src/features/microphone-input/micInstrumentProfiles.js'
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
import { isMusicalMicFrame } from '../src/features/practice/micMusicalAcceptance.js'
import {
  evaluateMicScoreInformedInput,
  MATCH_OUTCOME,
} from '../src/features/practice/waitForYouNoteMatch.js'
import { normalizeMatchSettings } from '../src/features/practice/waitForYouMatchSettings.js'
import { renderSyntheticClip, synthSpeech } from '../src/features/microphone-input/micSyntheticClips.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const settings = normalizeMatchSettings({})
const SAMPLE_RATE = 44100
const FFT = 2048
const HOP = Math.round(SAMPLE_RATE / 60)

/** Mirrors useWaitForYouMicInput.handleFrame single-note V2 advance decision. */
function runLiveAdvanceGateTrace(samples, sampleRate, expectedMidi, { instrumentId = null } = {}) {
  const v2State = createMicEngineV2RuntimeState()
  const analyzer = createMicFrameAnalyzer()
  const profile = instrumentId ? getMicInstrumentProfile(instrumentId) : null
  const confirm = createMatchConfirmState()
  const latch = createMicAttackLatchState()
  const checkpoint = { id: 'gate', expectedMidi }
  let advances = 0
  let rawGateOpenFrames = 0
  let softGateOpenFrames = 0
  let v2DetectedFrames = 0
  let musicalFrames = 0
  const rejectReasons = {}

  for (let end = FFT; end <= samples.length; end += HOP) {
    const tick = processMicEngineV2Tick({
      buffer: new Float32Array(samples.subarray(end - FFT, end)),
      sampleRate,
      expectedMidis: [expectedMidi],
      noiseFloor: analyzer.noiseFloor,
      state: v2State,
      centsTolerance: settings.micCentsTolerance,
      gateOptions: profile?.gate ?? null,
      timeMs: (end / sampleRate) * 1000,
    })
    const frame = tick.frame
    if (!frame) {
      continue
    }
    if (frame.rawGateOpen) {
      rawGateOpenFrames += 1
    }
    if (frame.softGateOpen) {
      softGateOpenFrames += 1
    }
    if (frame.v2DetectedMidis?.includes(expectedMidi)) {
      v2DetectedFrames += 1
    }
    if (isMusicalMicFrame(frame)) {
      musicalFrames += 1
    }
    const rejectReason = !frame.gateOpen
      ? frame.v2DetectedMidis?.includes(expectedMidi)
        ? 'soft-note-below-gate'
        : 'noise-gate-closed'
      : !frame.v2DetectedMidis?.includes(expectedMidi)
        ? 'v2-below-threshold'
        : !isMusicalMicFrame(frame)
          ? 'non-musical'
          : 'ok'
    rejectReasons[rejectReason] = (rejectReasons[rejectReason] ?? 0) + 1

    updateMicAttackRelease(latch, Boolean(frame.gateOpen))
    if (!canAcceptMicAttackMatch(latch)) {
      resetMatchConfirmState(confirm)
      continue
    }
    const frameConfident = frameConfidentForMatch(frame) && isMusicalMicFrame(frame)
    if (!frame.gateOpen || !frame.v2DetectedMidis?.length) {
      resetMatchConfirmState(confirm)
      continue
    }
    const preview = evaluateMicScoreInformedInput(checkpoint, frame.v2DetectedMidis, settings)
    if (preview.outcome !== MATCH_OUTCOME.COMPLETE) {
      resetMatchConfirmState(confirm)
      continue
    }
    const key = `gate:v2:${[...frame.v2DetectedMidis].sort((a, b) => a - b).join(',')}`
    const pitchCents = frame.midiFloat != null ? frame.midiFloat * 100 : null
    const corroborated = frameCorroboratesSingleNote(frame, expectedMidi, {
      centsTolerance: settings.micCentsTolerance,
    })
    if (confirmConfidentMatch(confirm, key, frameConfident && corroborated, { pitchCents })) {
      resetMatchConfirmState(confirm)
      markMicAttackConsumed(latch)
      advances += 1
    }
  }
  return {
    advances,
    rawGateOpenFrames,
    softGateOpenFrames,
    v2DetectedFrames,
    musicalFrames,
    rejectReasons,
  }
}

function runLiveAdvanceGate(samples, sampleRate, expectedMidi, options = {}) {
  return runLiveAdvanceGateTrace(samples, sampleRate, expectedMidi, options).advances
}

function loadWav(relativePath) {
  return readWavPcm(join(root, relativePath))
}

describe('WFY live mic gate — real note fixtures advance exactly once', () => {
  const noteCases = [
    { file: 'benchmarks/mic-accuracy/clips/real-piano-c4.wav', midi: 60, label: 'real piano C4' },
    { file: 'benchmarks/mic-accuracy/clips/real-piano-e4.wav', midi: 64, label: 'real piano E4' },
    { file: 'benchmarks/mic-accuracy/clips/real-guitar-g3.wav', midi: 55, label: 'real guitar G3' },
  ]
  for (const { file, midi, label } of noteCases) {
    it(`${label} advances exactly once`, () => {
      const wav = loadWav(file)
      expect(runLiveAdvanceGate(wav.samples, wav.sampleRate, midi)).toBe(1)
    })
  }

  const syntheticNotes = [
    [{ type: 'sine', frequency: 440, seconds: 0.6, amplitude: 0.35 }, 69, 'sine A4'],
    [{ type: 'speaker', midi: 60, seconds: 0.7, amplitude: 0.34, noise: 0.008, seed: 31 }, 60, 'digital piano C4'],
    [{ type: 'speaker', midi: 60, seconds: 0.7, amplitude: 0.09, noise: 0.003, seed: 32 }, 60, 'quiet piano C4'],
    [{ type: 'speaker', midi: 64, seconds: 0.7, amplitude: 0.55, noise: 0.006, seed: 33 }, 64, 'loud piano E4'],
    [{ type: 'pluck', midi: 40, seconds: 0.9, amplitude: 0.46, decay: 2.4 }, 40, 'guitar open E2'],
    [{ type: 'pluck', midi: 45, seconds: 0.9, amplitude: 0.44, decay: 2.3 }, 45, 'guitar open A2'],
    [{ type: 'pluck', midi: 60, seconds: 0.8, amplitude: 0.38, decay: 2.8 }, 60, 'guitar fretted C4'],
    [{ type: 'pluck', midi: 57, seconds: 0.8, amplitude: 0.34, decay: 1.7 }, 57, 'electric clean A3'],
    [{ type: 'distorted', midi: 40, seconds: 0.8, amplitude: 0.5, drive: 4.5 }, 40, 'distorted E2'],
    [{ type: 'pluck', midi: 36, seconds: 1.0, amplitude: 0.42, decay: 2.0 }, 36, 'piano bass C2'],
  ]
  for (const [spec, midi, label] of syntheticNotes) {
    it(`synthetic ${label} advances exactly once`, () => {
      const samples = renderSyntheticClip(spec, SAMPLE_RATE)
      expect(runLiveAdvanceGate(samples, SAMPLE_RATE, midi)).toBe(1)
    })
  }

  it('weak-fundamental low bass (h2 strongest, like a real piano string) advances', () => {
    // Real piano/guitar bass radiates little fundamental; energy sits on h2/h3.
    const spec = {
      type: 'harmonic',
      midi: 36,
      seconds: 1.0,
      harmonics: [
        { multiple: 1, amplitude: 0.09 },
        { multiple: 2, amplitude: 0.28 },
        { multiple: 3, amplitude: 0.2 },
        { multiple: 4, amplitude: 0.11 },
      ],
    }
    const samples = renderSyntheticClip(spec, SAMPLE_RATE)
    expect(runLiveAdvanceGate(samples, SAMPLE_RATE, 36)).toBe(1)
  })

  it('deep bass below the autocorrelation band (A0, 27.5 Hz) still advances', () => {
    // Autocorrelation cannot track < 55 Hz and reports boundary garbage; the
    // corroboration cross-check must not treat that as contradiction.
    const samples = renderSyntheticClip(
      { type: 'pluck', midi: 21, seconds: 1.2, amplitude: 0.45, decay: 1.8 },
      SAMPLE_RATE,
    )
    expect(runLiveAdvanceGate(samples, SAMPLE_RATE, 21)).toBe(1)
  })

  it('a vibrato note (±18 cents at 5.5 Hz) still advances', () => {
    const f0 = 440 * 2 ** ((55 - 69) / 12)
    const length = Math.floor(SAMPLE_RATE * 0.9)
    const out = new Float32Array(length)
    let phase = 0
    for (let index = 0; index < length; index += 1) {
      const t = index / SAMPLE_RATE
      const cents = 18 * Math.sin(2 * Math.PI * 5.5 * t)
      phase += (f0 * 2 ** (cents / 1200)) / SAMPLE_RATE
      out[index] =
        ((Math.sin(2 * Math.PI * phase) +
          0.55 * Math.sin(4 * Math.PI * phase) +
          0.32 * Math.sin(6 * Math.PI * phase)) /
          1.87) *
        0.4 *
        Math.exp(-1.6 * t)
    }
    expect(runLiveAdvanceGate(out, SAMPLE_RATE, 55)).toBe(1)
  })

  it('quiet piano above the room floor advances via the score-informed soft gate', () => {
    const samples = renderSyntheticClip(
      { type: 'speaker', midi: 60, seconds: 0.7, amplitude: 0.024, noise: 0.003, seed: 42 },
      SAMPLE_RATE,
    )
    const trace = runLiveAdvanceGateTrace(samples, SAMPLE_RATE, 60, { instrumentId: 'piano' })

    expect(trace.advances).toBe(1)
    expect(trace.rawGateOpenFrames).toBe(0)
    expect(trace.softGateOpenFrames).toBeGreaterThan(0)
    expect(trace.v2DetectedFrames).toBeGreaterThan(0)
  })

  it('quiet acoustic guitar above the room floor advances without opening silence/noise', () => {
    const samples = renderSyntheticClip(
      { type: 'pluck', midi: 52, seconds: 0.8, amplitude: 0.045, decay: 3.2 },
      SAMPLE_RATE,
    )
    const trace = runLiveAdvanceGateTrace(samples, SAMPLE_RATE, 52, { instrumentId: 'guitar' })

    expect(trace.advances).toBe(1)
    expect(trace.softGateOpenFrames).toBeGreaterThan(0)
    expect(trace.musicalFrames).toBeGreaterThanOrEqual(3)
  })

  it('quiet electric-style guitar above the room floor advances via the soft gate', () => {
    const samples = renderSyntheticClip(
      { type: 'distorted', midi: 52, seconds: 0.8, amplitude: 0.018, drive: 4.5 },
      SAMPLE_RATE,
    )
    const trace = runLiveAdvanceGateTrace(samples, SAMPLE_RATE, 52, { instrumentId: 'guitar' })

    expect(trace.advances).toBe(1)
    expect(trace.rawGateOpenFrames).toBe(0)
    expect(trace.softGateOpenFrames).toBeGreaterThan(0)
  })

  it('near-floor piano tone still does not advance when it is not clearly above room noise', () => {
    const samples = renderSyntheticClip(
      { type: 'speaker', midi: 60, seconds: 0.7, amplitude: 0.012, noise: 0.003, seed: 42 },
      SAMPLE_RATE,
    )
    const trace = runLiveAdvanceGateTrace(samples, SAMPLE_RATE, 60, { instrumentId: 'piano' })

    expect(trace.advances).toBe(0)
    expect(trace.softGateOpenFrames).toBe(0)
    expect(trace.v2DetectedFrames).toBeGreaterThan(0)
    expect(trace.rejectReasons['soft-note-below-gate']).toBeGreaterThan(0)
  })
})

describe('WFY live mic gate — non-notes never advance', () => {
  it('silence never advances', () => {
    const samples = renderSyntheticClip({ type: 'silence', seconds: 0.8 }, SAMPLE_RATE)
    expect(runLiveAdvanceGate(samples, SAMPLE_RATE, 60)).toBe(0)
  })

  it('white noise never advances', () => {
    const samples = renderSyntheticClip({ type: 'noise', seconds: 0.8, seed: 7 }, SAMPLE_RATE)
    expect(runLiveAdvanceGate(samples, SAMPLE_RATE, 60)).toBe(0)
  })

  it('real quiet-room recording never advances', () => {
    const wav = loadWav('benchmarks/mic-accuracy/clips/real-room-quiet.wav')
    expect(runLiveAdvanceGate(wav.samples, wav.sampleRate, 60)).toBe(0)
  })

  it('real noisy-room recording never advances', () => {
    const wav = loadWav('benchmarks/mic-accuracy/clips/real-room-noisy.wav')
    expect(runLiveAdvanceGate(wav.samples, wav.sampleRate, 60)).toBe(0)
  })

  const speechCases = [
    [{ f0: 146.8, seed: 91 }, 'modal talking near D3'],
    [{ f0: 220, seed: 17, driftSemitones: 2.4 }, 'higher voice near A3'],
    [{ f0: 110, seed: 55, driftSemitones: 3.5 }, 'low voice near A2'],
    // Droney low voices at bass pitches specifically stress the bass-register
    // acceptance path (h2-strongest allowance must not re-admit voice).
    [{ f0: 110, seed: 55, driftSemitones: 0.4 }, 'droney low voice A2'],
    [{ f0: 82.4, seed: 61, driftSemitones: 0.5 }, 'droney very low voice E2'],
    [{ f0: 110, seed: 62, driftSemitones: 0 }, 'monotone low hum A2'],
  ]
  for (const [options, label] of speechCases) {
    it(`${label} never advances even against its own pitch`, () => {
      const midi = Math.round(69 + 12 * Math.log2(options.f0 / 440))
      const samples = synthSpeech(SAMPLE_RATE, 1.6, options)
      expect(runLiveAdvanceGate(samples, SAMPLE_RATE, midi)).toBe(0)
    })
  }

  const nearMissCases = [
    [60, 61, 'C#4 played against expected C4'],
    [60, 59, 'B3 played against expected C4'],
    [55, 56, 'G#3 played against expected G3'],
    [40, 41, 'F2 played against expected E2'],
  ]
  for (const [expected, played, label] of nearMissCases) {
    it(`wrong note one semitone off — ${label} — never advances`, () => {
      const samples = renderSyntheticClip(
        { type: 'pluck', midi: played, seconds: 0.8, amplitude: 0.4, decay: 2.2 },
        SAMPLE_RATE,
      )
      expect(runLiveAdvanceGate(samples, SAMPLE_RATE, expected)).toBe(0)
    })
  }

  it('a +55 cent detuned note (outside tolerance) never advances', () => {
    const f0 = 440 * 2 ** ((60 - 69) / 12) * 2 ** (55 / 1200)
    const samples = renderSyntheticClip(
      { type: 'pluck', frequency: f0, seconds: 0.8, amplitude: 0.4, decay: 2.2 },
      SAMPLE_RATE,
    )
    expect(runLiveAdvanceGate(samples, SAMPLE_RATE, 60)).toBe(0)
  })

  it('a -22 cent detuned note (inside tolerance) still advances', () => {
    const f0 = 440 * 2 ** ((60 - 69) / 12) * 2 ** (-22 / 1200)
    const samples = renderSyntheticClip(
      { type: 'pluck', frequency: f0, seconds: 0.8, amplitude: 0.4, decay: 2.2 },
      SAMPLE_RATE,
    )
    expect(runLiveAdvanceGate(samples, SAMPLE_RATE, 60)).toBe(1)
  })
})

describe('WFY live mic gate — sustain and re-attack behavior', () => {
  it('one sustained soft note advances once only', () => {
    const sustained = renderSyntheticClip(
      { type: 'speaker', midi: 60, seconds: 2, amplitude: 0.024, noise: 0.003, seed: 45 },
      SAMPLE_RATE,
    )
    const trace = runLiveAdvanceGateTrace(sustained, SAMPLE_RATE, 60, { instrumentId: 'piano' })

    expect(trace.advances).toBe(1)
    expect(trace.softGateOpenFrames).toBeGreaterThan(0)
  })

  it('one long sustained note advances only the first of two same-pitch checkpoints', () => {
    // 2s sustained C4 with no release: the attack latch must hold the second
    // checkpoint until the player actually releases.
    const sustained = renderSyntheticClip(
      { type: 'speaker', midi: 60, seconds: 2, amplitude: 0.3, noise: 0.004, seed: 44 },
      SAMPLE_RATE,
    )
    const v2State = createMicEngineV2RuntimeState()
    const analyzer = createMicFrameAnalyzer()
    const confirm = createMatchConfirmState()
    const latch = createMicAttackLatchState()
    const checkpoints = [
      { id: 'cp-1', expectedMidi: 60 },
      { id: 'cp-2', expectedMidi: 60 },
    ]
    let checkpointIndex = 0

    for (let end = FFT; end <= sustained.length; end += HOP) {
      const checkpoint = checkpoints[checkpointIndex]
      if (!checkpoint) {
        break
      }
      const tick = processMicEngineV2Tick({
        buffer: new Float32Array(sustained.subarray(end - FFT, end)),
        sampleRate: SAMPLE_RATE,
        expectedMidis: [checkpoint.expectedMidi],
        noiseFloor: analyzer.noiseFloor,
        state: v2State,
        centsTolerance: settings.micCentsTolerance,
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
      const frameConfident = frameConfidentForMatch(frame) && isMusicalMicFrame(frame)
      if (!frame.gateOpen || !frame.v2DetectedMidis?.length) {
        resetMatchConfirmState(confirm)
        continue
      }
      const preview = evaluateMicScoreInformedInput(checkpoint, frame.v2DetectedMidis, settings)
      if (preview.outcome !== MATCH_OUTCOME.COMPLETE) {
        resetMatchConfirmState(confirm)
        continue
      }
      const key = `${checkpoint.id}:v2:${[...frame.v2DetectedMidis].sort((a, b) => a - b).join(',')}`
      const pitchCents = frame.midiFloat != null ? frame.midiFloat * 100 : null
      if (confirmConfidentMatch(confirm, key, frameConfident, { pitchCents })) {
        resetMatchConfirmState(confirm)
        markMicAttackConsumed(latch)
        checkpointIndex += 1
      }
    }

    expect(checkpointIndex).toBe(1)
  })
})
