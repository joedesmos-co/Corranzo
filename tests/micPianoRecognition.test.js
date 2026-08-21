import { describe, expect, it } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadMicPolyphonyManifest, sliceClipSamples } from '../src/features/microphone-input/micPolyphonyManifest.js'
import { renderSyntheticChordClip } from '../src/features/microphone-input/micSyntheticChordClips.js'
import { replayScoreInformedPolyphonyClip } from '../src/features/microphone-input/v2/micPolyphonyV2ReplayHarness.js'
import { RECOGNITION_OUTCOME } from '../src/features/microphone-input/v3/micRecognitionIr.js'
import {
  PERFORMANCE_MODE,
  buildPerformanceExpectation,
} from '../src/features/microphone-input/v3/performanceExpectation.js'
import {
  createPianoRecognitionState,
  evaluatePianoRecognition,
} from '../src/features/microphone-input/v3/pianoRecognition.js'
import { readWavPcm } from '../scripts/lib/readWavPcm.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const manifestPath = join(root, 'benchmarks/mic-polyphony/manifest.json')
const SAMPLE_RATE = 44100

function expectation(midis, extra = {}) {
  const checkpoint = {
    id: extra.id ?? `piano-${midis.join('-')}`,
    index: 0,
    timeSeconds: extra.timeSeconds ?? 1,
    expectedMidi: midis[0],
    expectedMidis: midis,
    isChord: midis.length > 1,
    rollingWindowMs: extra.rollingWindowMs ?? 720,
    isTiedContinuation: extra.isTiedContinuation ?? false,
    hasTiedSustain: extra.hasTiedSustain ?? false,
    notes: midis.map((midi, index) => ({
      id: `p${index}`,
      midi,
      durationSeconds: extra.durationSeconds ?? 0.6,
      tieStart: extra.tieStart ?? false,
      tieStop: extra.tieStop ?? false,
      suppressPlaybackAttack: extra.isTiedContinuation ?? false,
    })),
  }
  return buildPerformanceExpectation({
    checkpoint,
    checkpointIndex: 0,
    checkpoints: [checkpoint],
    instrument: 'piano',
    mode: PERFORMANCE_MODE.WAIT_FOR_YOU,
  })
}

function frame(midis, extra = {}) {
  return {
    timeMs: extra.timeMs ?? 1000,
    sampleRate: SAMPLE_RATE,
    windowMs: 46.4,
    gateOpen: extra.gateOpen ?? true,
    musical: extra.musical ?? true,
    clarity: extra.clarity ?? 0.8,
    midiFloat: extra.midiFloat ?? midis[0] ?? null,
    ringingMidis: extra.ringingMidis ?? [],
    sustainPedalDown: extra.sustainPedalDown ?? false,
    unexpectedMidis: extra.unexpectedMidis ?? [],
    v2Notes: midis.map((midi, index) => ({
      midi,
      detected: extra.detected?.[index] ?? true,
      confidence: extra.confidences?.[index] ?? 0.65,
      ratio: extra.ratios?.[index] ?? 2.2,
      fundamentalEnergy: extra.fundamentals?.[index] ?? 0.03,
      harmonicSupport: 1.4,
    })),
  }
}

function evaluateOnce(target, heard, extra = {}) {
  return evaluatePianoRecognition({
    expectation: target,
    frame: frame(heard, extra.frame),
    state: createPianoRecognitionState(target),
    timeMs: extra.timeMs ?? 1000,
    attack: extra.attack ?? { id: 'piano-attack-1', fresh: true, confidence: 0.9 },
    musical: extra.musical,
  })
}

describe('Mic V3 Piano recognition', () => {
  it('requires every independently detected tone for dyads, triads, and four-note chords', () => {
    for (const midis of [[60, 64], [60, 64, 67], [55, 59, 62, 65]]) {
      const target = expectation(midis)
      expect(evaluateOnce(target, midis.slice(0, -1)).decision.advance, `${midis.length}-note partial`).toBe(false)
      expect(evaluateOnce(target, midis).decision.advance, `${midis.length}-note complete`).toBe(true)
    }
  })

  it('accumulates a rolled or split-register chord within the musical window', () => {
    const target = expectation([48, 64, 79], { rollingWindowMs: 500 })
    let state = createPianoRecognitionState(target)
    for (const [index, midi] of [48, 64, 79].entries()) {
      const result = evaluatePianoRecognition({
        expectation: target,
        state,
        frame: frame([midi], { timeMs: 1000 + index * 120 }),
        timeMs: 1000 + index * 120,
        attack: { id: 'rolled-attack', fresh: index === 0, confidence: 0.9 },
        musical: true,
      })
      state = result.state
      expect(result.decision.advance).toBe(index === 2)
    }
  })

  it('retains independently confirmed notes while the sustain pedal is down', () => {
    const target = expectation([48, 60, 67], { rollingWindowMs: 250 })
    let state = createPianoRecognitionState(target)
    const first = evaluatePianoRecognition({
      expectation: target,
      state,
      frame: frame([48], { timeMs: 1000, sustainPedalDown: true }),
      timeMs: 1000,
      attack: { id: 'pedaled-chord', fresh: true },
      musical: true,
    })
    state = first.state
    const completed = evaluatePianoRecognition({
      expectation: target,
      state,
      frame: frame([60, 67], { timeMs: 1800, sustainPedalDown: true, ringingMidis: [48] }),
      timeMs: 1800,
      attack: { id: 'pedaled-chord', fresh: false },
      musical: true,
    })
    expect(completed.decision.advance).toBe(true)
    expect(completed.decision.progress.sustainPedalDown).toBe(true)
  })

  it('recognizes a tied continuation as a hold without inventing a new attack or skip', () => {
    const target = expectation([60], { isTiedContinuation: true, tieStop: true })
    const held = evaluatePianoRecognition({
      expectation: target,
      state: createPianoRecognitionState(target),
      frame: frame([], { ringingMidis: [60], gateOpen: false }),
      timeMs: 1100,
      attack: { fresh: false },
      musical: true,
    })
    expect(held.decision.outcome).toBe(RECOGNITION_OUTCOME.HOLD)
    expect(held.decision.reason).toBe('expected-tied-sustain-held')
    expect(held.decision.advance).toBe(false)
  })

  it('requires a fresh attack for repeated notes instead of accepting the old ring', () => {
    const target = expectation([60], { id: 'repeated-c4' })
    const stale = evaluatePianoRecognition({
      expectation: target,
      state: createPianoRecognitionState(target),
      frame: frame([60], { ringingMidis: [60] }),
      timeMs: 1200,
      attack: { fresh: false },
      musical: true,
    })
    const repeated = evaluateOnce(target, [60])
    expect(stale.decision.reason).toBe('ringing-without-new-attack')
    expect(stale.decision.advance).toBe(false)
    expect(repeated.decision.advance).toBe(true)
  })

  it('keeps quiet notes possible only when existing detector and musical gates agree', () => {
    const target = expectation([60])
    const quietDetected = evaluateOnce(target, [60], {
      musical: true,
      frame: { confidences: [0.29], ratios: [1.36], gateOpen: true },
    })
    const belowDetector = evaluateOnce(target, [60], {
      musical: true,
      frame: { detected: [false], confidences: [0.27], ratios: [1.3], gateOpen: true },
    })
    const speech = evaluateOnce(target, [60], { musical: false })
    expect(quietDetected.decision.advance).toBe(true)
    expect(belowDetector.decision.advance).toBe(false)
    expect(speech.decision.advance).toBe(false)
  })

  it('rejects a wrong tone and never lets one expected note satisfy a chord', () => {
    const target = expectation([60, 64, 67])
    const wrong = evaluateOnce(target, [60], {
      frame: { unexpectedMidis: [66], midiFloat: 66, clarity: 0.9 },
    })
    expect(wrong.decision.outcome).toBe(RECOGNITION_OUTCOME.REJECTED)
    expect(wrong.decision.advance).toBe(false)
    expect(evaluateOnce(target, [60]).decision.advance).toBe(false)
  })

  it('returns immutable JSON-serializable decisions and confidence breakdowns', () => {
    const result = evaluateOnce(expectation([60, 64]), [60, 64])
    expect(result.decision.confidence.instrument).toBe(1)
    expect(result.window.chordProgress.requiredCount).toBe(2)
    expect(Object.isFrozen(result.decision)).toBe(true)
    expect(() => JSON.stringify(result.window)).not.toThrow()
  })
})

describe('Mic V3 Piano real-timbre evaluation gate', () => {
  it('accepts every complete existing piano replay and does not infer the known masked Cmaj7 tone', () => {
    const manifest = loadMicPolyphonyManifest(manifestPath)
    const pianoClips = manifest.clips.filter((clip) => clip.instrument === 'piano' && clip.label === 'chord')
    expect(pianoClips).toHaveLength(12)

    for (const clip of pianoClips) {
      let sampleRate = SAMPLE_RATE
      let samples
      if (clip.synthetic) {
        samples = renderSyntheticChordClip(clip.synthetic, sampleRate)
      } else {
        const wav = readWavPcm(join(root, 'benchmarks/mic-polyphony', clip.file))
        samples = sliceClipSamples(wav.samples, wav.sampleRate, {
          startMs: clip.startMs,
          endMs: clip.endMs,
        })
        sampleRate = wav.sampleRate
      }
      const replay = replayScoreInformedPolyphonyClip(samples, sampleRate, {
        expectedMidis: clip.expectedMidis,
        chordType: clip.chordType,
        rollMs: clip.rollMs,
        expectedOnsetMs: clip.expectedOnsetMs,
      })
      const target = expectation(clip.expectedMidis, {
        id: clip.id,
        rollingWindowMs: Math.max(720, clip.rollMs ?? 0),
      })
      let state = createPianoRecognitionState(target)
      let accepted = false
      let attackStarted = false
      for (const replayFrame of replay.frames) {
        if (!replayFrame.detectedMidis.length) continue
        const result = evaluatePianoRecognition({
          expectation: target,
          state,
          timeMs: replayFrame.timeMs,
          frame: {
            ...replayFrame,
            sampleRate,
            windowMs: replay.fftSize / sampleRate * 1000,
            gateOpen: true,
            musical: true,
            v2Notes: replayFrame.notes,
          },
          attack: { id: `${clip.id}-attack`, fresh: !attackStarted, confidence: 0.9 },
          musical: true,
        })
        state = result.state
        attackStarted = true
        if (result.decision.advance) {
          accepted = true
          break
        }
      }
      if (clip.id === 'uiowa-piano-mf-cmaj7') {
        expect(accepted, clip.id).toBe(false)
        expect(state.matchedNotes.map((note) => note.midi).sort((a, b) => a - b)).toEqual([60, 67, 71])
      } else {
        expect(accepted, clip.id).toBe(true)
      }
    }
  })
})
